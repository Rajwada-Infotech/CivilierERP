import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, FileText, Upload, FileImage, FileSpreadsheet, File as FileIcon, Eye, Send, Clock, UserCircle2, Pencil, Lock, Check, ArrowRight, ShieldAlert, Building2, ScrollText, X, FolderClock, Download, CheckCircle2, AlertCircle, Info, CalendarDays, BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { promptNextStep } from "@/lib/workflowNav";
import { FinancialStatusBar } from "@/components/crm/FinancialStatusBar";
import { ProxyActionDialog, PROXY_METHODS, type ProxyMethod, PROXY_METHOD_LABELS } from "@/components/crm/ProxyActionDialog";

const API = "/api/crm/agreements";
// NOTE: mount path assumed as "/api/users" to match users.js's PRIVILEGED_ROLES
// comment ("Password Reset, User Management") — unverified against server.js,
// which wasn't available. If it's mounted elsewhere, this is a one-line fix.
const USERS_API = "/api/users";

const DOC_TYPES = ["SaleAgreement", "AllotmentLetter", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];

const agrStatusColor: Record<string, string> = {
  Draft:      "text-muted-foreground bg-muted/50 border-border",
  Executed:   "text-blue-600 bg-blue-50 border-blue-200",
  Registered: "text-green-600 bg-green-50 border-green-200",
  Cancelled:  "text-red-600 bg-red-50 border-red-200",
};
// A Booking can be cancelled independently, from the Bookings module, after
// its Agreement already exists — this flags that so the workflow actions
// below (Edit, Send, Mark Executed, etc.) can be locked, matching the
// server-side guard in crmAgreements.js.
function isBookingCancelled(a: { BookingStatus?: string | null; BookingIsActive?: boolean | null }): boolean {
  return a.BookingIsActive === false || ["Cancelled", "Rejected"].includes(a.BookingStatus || "");
}

// Consolidated Agreement Date status — replaces the old spread of separate
// "Agreement Date" / "Proposed Date (Company)" / "Proposed Date (Customer)"
// raw-value lines with one badge cluster. "Accepted by Company/Customer"
// both light up together the instant AgreementDate is confirmed — matching
// proposals is a single mutual event (finalizeAgreementDate on the backend),
// there's no separate per-side "accept" action, so both badges reflect that
// same moment rather than implying an extra step that doesn't exist.
const DATE_BADGE_COLORS: Record<string, string> = {
  purple: "text-purple-600 bg-purple-50 border-purple-200",
  blue:   "text-blue-600 bg-blue-50 border-blue-200",
  green:  "text-green-600 bg-green-50 border-green-200",
};
// Only ever rendered once actually true — a grey placeholder for a status
// that hasn't happened yet ("Proposed by Customer" showing before anyone
// has proposed anything) is misleading, not informative.
function DateStatusBadge({ label, date, color, active }: { label: string; date?: string | null; color: "purple" | "blue" | "green"; active: boolean }) {
  if (!active) return null;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${DATE_BADGE_COLORS[color]}`}>
      {label}{date ? `: ${String(date).slice(0, 10)}` : ""}
    </span>
  );
}

// Mirrors the backend's mark-executed check (crmAgreements.js) — mandatory
// documents must be Verified before execution, not just present.
function unverifiedMandatoryDocs(documents: any[] | undefined): any[] {
  return (documents || []).filter((d) => d.IsMandatory && d.Status !== "Verified");
}

// Agreement Followup — % of mandatory document TYPES that actually have a
// file attached. Computed live from the same `documents` array already
// fetched (never a stored/stale snapshot), mirroring the backend's own
// agreementFollowupProgress() in crmAgreements.js exactly — 0 required docs
// means 0%, not a vacuous 100%, since "nothing requested yet" isn't "done."
function followupProgress(documents: any[] | undefined): { required: number; uploaded: number; percent: number } {
  const mandatory = (documents || []).filter((d) => d.IsMandatory);
  const required = mandatory.length;
  const uploaded = mandatory.filter((d) => d.FilePath).length;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

// Module-level so both agreementStepStates() and the component's own
// useState can share the exact same type — the stepper's steps and the tab
// bar below it must always agree on what tabs actually exist.
const AGR_TABS = ["Overview", "Legal & Approval", "Documents"] as const;
type AgrTab = typeof AGR_TABS[number];

// A single, honest read of where this agreement actually is in its real
// lifecycle — mirrors the exact same gates the buttons below already
// enforce (legal exec -> followup -> senior approval -> sent -> customer
// approval -> date agreed -> executed -> registered), just rendered as a
// progress trail instead of scattered status pills, so the workflow is
// legible at a glance instead of something staff have to piece together
// from separate fields. Each step carries the tab it belongs to — same
// pattern as CrmBookingDetail.tsx's own checklist row, where tapping a step
// jumps straight to the section that covers it.
type StepState = "done" | "current" | "upcoming";
function agreementStepStates(a: any, documents: any[] | undefined): { label: string; state: StepState; tab: AgrTab }[] {
  const legalAssigned = !!a?.LegalExecutiveId;
  const followup = followupProgress(documents);
  const followupDone = followup.required > 0 && followup.percent === 100;
  const senior = a?.SeniorApprovalStatus === CrmStatus.APPROVED;
  const sent = !!a?.SentToCustomerAt;
  const custApproved = a?.CustomerApprovalStatus === CrmStatus.APPROVED;
  const dated = !!a?.AgreementDate;
  const executed = a?.Status === CrmStatus.EXECUTED || a?.Status === CrmStatus.REGISTERED;
  const registered = a?.Status === CrmStatus.REGISTERED;
  return [
    { label: "Initialisation",       state: "done" as StepState,                                                    tab: "Overview" as AgrTab },
    { label: "Legal Exec. Assigned", state: (legalAssigned ? "done" : "current") as StepState,                      tab: "Legal & Approval" as AgrTab },
    { label: `Agreement Followup${followup.required > 0 ? ` (${followup.percent}%)` : ""}`,
      state: (followupDone ? "done" : legalAssigned ? "current" : "upcoming") as StepState,                         tab: "Documents" as AgrTab },
    { label: "Senior Approval",      state: (senior ? "done" : followupDone ? "current" : "upcoming") as StepState,       tab: "Legal & Approval" as AgrTab },
    { label: "Sent to Customer",     state: (sent ? "done" : senior ? "current" : "upcoming") as StepState,               tab: "Legal & Approval" as AgrTab },
    { label: "Customer Approval",    state: (custApproved ? "done" : sent ? "current" : "upcoming") as StepState,         tab: "Legal & Approval" as AgrTab },
    { label: "Date Agreed",          state: (dated ? "done" : custApproved ? "current" : "upcoming") as StepState,        tab: "Legal & Approval" as AgrTab },
    { label: "Execution Follow-ups", state: (executed ? "done" : dated ? "current" : "upcoming") as StepState,            tab: "Documents" as AgrTab },
    { label: "Registered",           state: (registered ? "done" : executed ? "current" : "upcoming") as StepState,       tab: "Overview" as AgrTab },
  ];
}
function AgreementStepper({ steps, activeTab, onStepClick }: { steps: { label: string; state: StepState; tab: AgrTab }[]; activeTab: AgrTab; onStepClick: (t: AgrTab) => void }) {
  return (
    <div className="flex items-center overflow-x-auto thin-scroll pb-1">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            className={`flex items-center gap-1.5 shrink-0 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors group ${activeTab === s.tab ? "bg-muted/50" : ""}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ring-2 ${
              s.state === "done"
                ? "bg-green-500 text-white ring-green-200 dark:ring-green-900"
                : s.state === "current"
                ? "bg-primary text-primary-foreground ring-primary/25"
                : "bg-muted text-muted-foreground ring-transparent"}`}>
              {s.state === "done" ? <Check size={11} /> : i + 1}
            </span>
            <span className={`text-[11px] font-semibold whitespace-nowrap leading-tight ${
              s.state === "done" ? "text-green-600 dark:text-green-400"
              : s.state === "current" ? "text-foreground"
              : "text-muted-foreground/60"}`}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px mx-0.5 shrink-0 ${steps[i + 1].state !== "upcoming" ? "bg-green-400" : "bg-border"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
const docStatusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Requested: "text-amber-600 bg-amber-50 border-amber-200",
  Uploaded:  "text-blue-600 bg-blue-50 border-blue-200",
  Submitted: "text-blue-600 bg-blue-50 border-blue-200",
  Verified:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_AGR_FORM = {
  BookingId: "", LegalName: "", LegalAddress: "",
  PanNo: "", AadhaarNo: "", Notes: "", LegalExecutiveId: "",
};

// Legal Executive picker — deliberately NOT the Sales Automation leads
// module's /users endpoint (that's what this called before; unrelated
// module, likely scoped to salespeople, and also required the
// Users-page-admin permission that most CRM/legal staff don't have — which
// is why the dropdown was rendering empty). This hits a dedicated endpoint
// scoped server-side to legal_head/legal_person roles only, open to any
// authenticated user (the page itself is already gated by
// crm-agreements:view, so no extra restriction needed here).
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${USERS_API}/legal-executives`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.id), label: u.name }));
  } catch { return []; }
}

const EMPTY_DOC_FORM = {
  DocumentType: "SaleAgreement", DocumentUrl: "", IssuedBy: "", Remarks: "",
};
const EMPTY_DOC_REQUEST_FORM = {
  DocumentType: "IdentityProof", Label: "", IsMandatory: true,
};

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchDocAudit(docId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${API}/documents/${docId}/audit`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

// Review dialog for a single agreement document — preview, verify/reject
// (rejecting a legal document with no reason on record is never allowed,
// server-enforced too, see PUT /:id/documents/:docId), and a History tab
// showing every prior status change from CrmAuditLog. Replaces the old
// preview-only dialog + bare status <select>, which let a document be
// silently flipped to Rejected with zero explanation and no easy way to see
// what happened to it before — not acceptable for real contractual paperwork.
const DocumentReviewDialog: React.FC<{ agreementId: number; doc: any; onClose: () => void; onReviewed: () => void }> =
  ({ agreementId, doc, onClose, onReviewed }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [audit, setAudit] = useState<any[] | null>(null);
  const [remarks, setRemarks] = useState(doc.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const proxyAttachRef = useRef<HTMLInputElement>(null);
  const [proxyUploadOpen, setProxyUploadOpen] = useState(false);
  const [proxyUploadMethod, setProxyUploadMethod] = useState<ProxyMethod>("Phone");
  const [proxyUploadRemarks, setProxyUploadRemarks] = useState("");
  const [proxyUploadFile, setProxyUploadFile] = useState<File | null>(null);
  const [proxyUploading, setProxyUploading] = useState(false);

  const attachFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setAttaching(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/attach`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("File uploaded");
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAttaching(false);
    }
  };

  const handleProxyAttach = async () => {
    if (!proxyUploadFile || !proxyUploadRemarks.trim()) return;
    setProxyUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", proxyUploadFile);
      formData.append("ProxyMethod", proxyUploadMethod);
      formData.append("ProxyRemarks", proxyUploadRemarks.trim());
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/proxy-attach`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success("Document submitted on customer's behalf");
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxyUploading(false);
    }
  };

  // Opening this dialog shouldn't inherit an error toast left over from
  // whatever the user did right before (e.g. a failed date proposal) —
  // that stale toast otherwise sits on screen looking like it's about
  // this document, when it isn't.
  useEffect(() => {
    toast.dismiss();
  }, []);

  useEffect(() => {
    if (!doc.FilePath) return;
    let objectUrl: string | null = null;
    fetchWithAuth(`${API}/documents/file/${doc.Id}`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id, doc.FilePath]);

  useEffect(() => {
    if (tab === "history" && audit === null) fetchDocAudit(doc.Id).then(setAudit);
  }, [tab, audit, doc.Id]);

  const setStatus = async (status: string) => {
    if (status === CrmStatus.REJECTED && !remarks.trim()) { toast.error("Remarks are required to reject"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Remarks: remarks || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      toast.success(`Marked ${status}`);
      onReviewed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            {mimeIcon(doc.MimeType)} {doc.Label || doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${docStatusColor[doc.Status] || ""}`}>{doc.Status}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border -mt-1">
          <button onClick={() => setTab("preview")}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 -mb-px ${tab === "preview" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Preview
          </button>
          <button onClick={() => setTab("history")}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 -mb-px flex items-center gap-1 ${tab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Clock size={12} /> History
          </button>
        </div>

        {tab === "preview" ? (
          <>
            <div className="flex items-center justify-center min-h-[240px] bg-muted/30 rounded-lg overflow-hidden">
              {!doc.FilePath && !doc.DocumentUrl ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
                  <Clock size={22} />
                  {doc.UploadedByType === "Customer" ? (
                    <p className="text-sm text-muted-foreground px-4 text-center">Awaiting upload from customer — nothing to preview yet.</p>
                  ) : (
                    <>
                      Not yet uploaded — Legal Executive to attach.
                      <input type="file" ref={attachInputRef} className="hidden"
                        onChange={(e) => attachFile(e.target.files)} />
                      <button type="button" onClick={() => attachInputRef.current?.click()} disabled={attaching}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                        <Upload size={12} /> {attaching ? "Uploading..." : "Upload File"}
                      </button>
                    </>
                  )}
                </div>
              ) : doc.DocumentUrl && !doc.FilePath ? (
                <a href={doc.DocumentUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2 py-8 text-primary text-sm hover:underline">
                  <FileIcon size={22} /> Open external document link
                </a>
              ) : !blobUrl ? (
                <span className="text-sm text-muted-foreground">Loading preview…</span>
              ) : doc.MimeType?.startsWith("image/") ? (
                <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[50vh] object-contain" />
              ) : doc.MimeType === "application/pdf" ? (
                <iframe src={blobUrl} title={doc.FileName} className="w-full h-[50vh] border-0" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">{mimeIcon(doc.MimeType)} Preview not available.</div>
              )}
            </div>

            {doc.UploadedByType === "Customer" && !doc.FilePath && !doc.DocumentUrl && (
              <div className="rounded-lg border border-border overflow-hidden">
                {!proxyUploadOpen ? (
                  <button type="button" onClick={() => setProxyUploadOpen(true)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors text-left">
                    <UserCircle2 size={13} className="shrink-0" />
                    Customer provided this document off-portal? Submit on their behalf
                  </button>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <UserCircle2 size={13} /> Submit on Customer's Behalf
                      </div>
                      <button type="button" onClick={() => setProxyUploadOpen(false)}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded">
                        <X size={14} />
                      </button>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1.5">How did the customer provide this document?</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {PROXY_METHODS.map((m) => (
                          <button type="button" key={m} onClick={() => setProxyUploadMethod(m)}
                            className={`text-[11px] px-2 py-1.5 rounded-md border font-medium transition-colors ${
                              proxyUploadMethod === m
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}>
                            {PROXY_METHOD_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      value={proxyUploadRemarks} onChange={(e) => setProxyUploadRemarks(e.target.value)}
                      placeholder="Brief note on how/when the document was received…"
                      rows={2}
                      className="w-full text-xs border border-border rounded-md px-2.5 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input type="file" ref={proxyAttachRef} className="hidden"
                        onChange={(e) => setProxyUploadFile(e.target.files?.[0] || null)} />
                      <button type="button" onClick={() => proxyAttachRef.current?.click()}
                        className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-dashed border-border rounded-md font-medium hover:bg-muted flex items-center gap-1.5 text-muted-foreground transition-colors">
                        <Upload size={11} className="shrink-0" />
                        <span className="truncate">{proxyUploadFile ? proxyUploadFile.name : "Choose File…"}</span>
                      </button>
                      <button type="button" onClick={handleProxyAttach}
                        disabled={proxyUploading || !proxyUploadFile || !proxyUploadRemarks.trim()}
                        className="shrink-0 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                        {proxyUploading ? "Uploading…" : "Submit"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!!doc.FilePath && (
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>{doc.FileName} {doc.FileSize ? `· ${fmtBytes(doc.FileSize)}` : ""}{doc.IssuedBy ? ` · by ${doc.IssuedBy}` : ""}</span>
                {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline flex items-center gap-1"><Download size={12} /> Download</a>}
              </div>
            )}
            {!!doc.FilePath && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Remarks {doc.Status !== "Verified" ? "(required to reject)" : ""}</label>
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
                  placeholder="Reason for rejection, or any note for the record..."
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            )}
          </>
        ) : (
          <div className="min-h-[240px] max-h-[50vh] overflow-y-auto">
            {audit === null ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading history…</div>
            ) : audit.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <FolderClock size={20} /> No review history yet for this document.
              </div>
            ) : (
              <ul className="space-y-2">
                {audit.map((h: any) => (
                  <li key={h.Id} className="text-xs border border-border rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                    <div>
                      <span className="font-medium">{h.Field}</span>{": "}
                      <span className="text-muted-foreground">{h.OldValue || "—"}</span>{" → "}
                      <span className="font-medium">{h.NewValue || "—"}</span>
                    </div>
                    <div className="text-right text-muted-foreground shrink-0">
                      <div>{h.ChangedByName || "System"}</div>
                      <div>{String(h.ChangedAt).replace("T", " ").slice(0, 16)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          {!!doc.FilePath && doc.Status !== "Verified" && (
            <button onClick={() => setStatus("Verified")} disabled={saving}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40">Verify</button>
          )}
          {!!doc.FilePath && doc.Status !== CrmStatus.REJECTED && (
            <button onClick={() => setStatus("Rejected")} disabled={saving}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">Reject</button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

async function fetchAgreements(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAgreementDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Failed to load agreement");
  return r.json();
}
async function fetchDateHistory(id: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${id}/date-history`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchRevisions(id: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${id}/revisions`); return r.ok ? r.json() : []; } catch { return []; }
}
// Only bookings that are Approved, have no Agreement yet, and pass every
// agreement-prep prerequisite (welcome call Welcomed, bank/nominee/PAN/
// Aadhaar details, unit linked, email/mobile present) — same gate
// POST /api/crm/agreements enforces server-side, so a booking picked here
// can never be rejected for "prerequisites incomplete" on save. Deliberately
// NOT the raw /api/crm/bookings list, which includes Pending/Draft bookings
// and bookings that already have an agreement.
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchWelcomeCallsForBooking(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`/api/crm/welcome-calls?bookingId=${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmAgreement: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const idFilter = sp.get("id") ? parseInt(sp.get("id")!, 10) : null;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(idFilter);
  // Selecting a row only ever set local state — the URL stayed at whatever
  // it loaded with, so a refresh or shared link lost track of which
  // agreement was open. Keeps ?id= in sync with the actual selection,
  // matching the read side above (idFilter).
  const selectAgreement = (id: number) => {
    setSelectedId(id);
    setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });
  };
  const [agrDialog, setAgrDialog] = useState(false);
  const [docDialog, setDocDialog] = useState(false);
  const [docRequestDialog, setDocRequestDialog] = useState(false);
  const [sendDialog, setSendDialog] = useState(false);
  const [proposeDateDialog, setProposeDateDialog] = useState(false);
  const [sendDate, setSendDate] = useState("");
  const [regDialog, setRegDialog] = useState(false);
  const [regForm, setRegForm] = useState({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
  const [regFeesLocked, setRegFeesLocked] = useState(false);
  const [regSaving, setRegSaving] = useState(false);
  const [agrForm, setAgrForm] = useState({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
  const [docForm, setDocForm] = useState({ ...EMPTY_DOC_FORM });
  const [docRequestForm, setDocRequestForm] = useState({ ...EMPTY_DOC_REQUEST_FORM });
  const [showUrlField, setShowUrlField] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ LegalName: "", LegalAddress: "", PanNo: "", AadhaarNo: "", RevisionReason: "", LegalExecutiveId: "" });
  // Always opens on an existing agreement, so always opens locked.
  const [editLocked, setEditLocked] = useState(true);
  const editInputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${editLocked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;
  const [saving, setSaving] = useState(false);
  // Same tabbed pattern as CrmBookingDetail.tsx — the detail panel used to
  // be one long stack of cards (Overview, Approval Workflow, Documents all
  // scrolling together), which read as a messy wall of text rather than a
  // step-by-step flow. Header actions + the lifecycle Stepper/Next-Action
  // banner stay always visible above the tabs since they're global, not
  // section-specific. AGR_TABS/AgrTab are declared at module scope (shared
  // with agreementStepStates) so the stepper's steps can each carry a real
  // tab and stay clickable, same as Booking's own checklist row.
  const [agrTab, setAgrTab] = useState<AgrTab>("Overview");
  useEffect(() => { setAgrTab("Overview"); setEditingLegalExec(false); }, [selectedId]);

  const { data: agreements = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-agreements"], queryFn: fetchAgreements, staleTime: 30_000 });
  const { data: detail } = useQuery({
    queryKey: ["crm-agreement-detail", selectedId],
    queryFn: () => fetchAgreementDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: dateHistory = [] } = useQuery({
    queryKey: ["crm-agreement-date-history", selectedId],
    queryFn: () => fetchDateHistory(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const { data: revisions = [] } = useQuery({
    queryKey: ["crm-agreement-revisions", selectedId],
    queryFn: () => fetchRevisions(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const { data: welcomeCallsForBkg = [] } = useQuery({
    queryKey: ["crm-welcome-calls-for-bkg", (detail as any)?.BookingId],
    queryFn: () => fetchWelcomeCallsForBooking((detail as any).BookingId),
    enabled: !!selectedId && !!(detail as any)?.BookingId,
    staleTime: 60_000,
  });
  const preferredAgrDate = (() => {
    const hit = (welcomeCallsForBkg as any[]).find((c: any) => c.PreferredAgreementDate);
    return hit ? String(hit.PreferredAgreementDate).slice(0, 10) : "";
  })();

  const filtered = useMemo(() =>
    (agreements as any[]).filter((a: any) =>
      !search || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.AgreementNo?.includes(search) || a.BookingNo?.includes(search)
    ), [agreements, search]);

  // Arriving here via CrmBooking.tsx's "Agreement" next-step link
  // (`/crm/agreements?bookingId=X`) means the booking already cleared
  // Welcome Call + Bank Details, so an Agreement has usually already been
  // auto-created for it (see maybeAutoCreateAgreement). Jump straight to
  // reviewing/approving that agreement instead of dropping staff on the
  // unfiltered list to go find it themselves. Only falls back to opening
  // the New Agreement dialog (pre-filled) for the rare case where
  // auto-create hasn't fired yet — e.g. a prerequisite landed through a
  // path that doesn't call it, or a previous auto-create attempt failed.
  // Runs once per bkgFilter value so it doesn't fight with the user closing
  // the dialog or switching to a different agreement afterward. Explicit
  // ?id= links (opening a specific agreement directly) always take
  // priority and skip this entirely.
  const handledBkgFilterRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bkgFilter || idFilter || isLoading) return;
    if (handledBkgFilterRef.current === bkgFilter) return;
    handledBkgFilterRef.current = bkgFilter;
    const existing = (agreements as any[]).find((a) => String(a.BookingId) === String(bkgFilter));
    if (existing) {
      setSelectedId(existing.Id);
    } else {
      setAgrForm((f) => ({ ...f, BookingId: bkgFilter }));
      setAgrDialog(true);
    }
  }, [bkgFilter, idFilter, agreements, isLoading]);

  const handleSaveAgreement = async () => {
    if (!agrForm.BookingId) { toast.error("Booking is required"); return; }
    if (agrForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(agrForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (agrForm.AadhaarNo && !/^\d{12}$/.test(agrForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...agrForm,
          BookingId: parseInt(agrForm.BookingId),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create agreement");
      toast.success(`Agreement ${data.AgreementNo} created`);
      setAgrDialog(false);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAddDocument = async () => {
    if (!selectedId) return;
    if (!docForm.DocumentUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add document");
      toast.success("Document added");
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestDocument = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docRequestForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request document");
      toast.success("Document requested — the customer will see it in their portal");
      setDocRequestDialog(false);
      setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDocFiles = async (files: FileList | null) => {
    if (!selectedId || !files?.length) return;
    setUploadingDocs(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docForm.DocumentType);
      if (docForm.IssuedBy) formData.append("IssuedBy", docForm.IssuedBy);
      if (docForm.Remarks) formData.append("Remarks", docForm.Remarks);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploadingDocs(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  // Quick-verify only (Rejected always requires remarks, server-enforced —
  // that path goes through DocumentReviewDialog instead). Previously this
  // never checked res.ok, so a failed verify (e.g. the "not uploaded yet"
  // guard firing) silently did nothing with no error shown — fixed to
  // actually surface the real outcome.
  const handleDocStatusChange = async (docId: number, status: string) => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update document");
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleSendToCustomer = async (proposedDate: string) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/send-to-customer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate: proposedDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement sent to customer portal");
      setSendDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleProposeDate = async (proposedDate: string) => {
    if (!selectedId || !proposedDate) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proposed date sent to customer");
      setProposeDateDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // Accept the customer's currently-proposed date as-is — no re-typing it.
  // Only enabled when ProposedDateStatus shows it's the company's turn.
  const handleAcceptDate = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/date/accept`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Date accepted — sent for super admin approval");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAgreementAction = async (action: "mark-executed" | "mark-registered" | "cancel") => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${action}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Agreement marked ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      if (action === "mark-executed") {
        promptNextStep(navigate, "Agreement executed — Legal Milestones and NOC can now begin.", "/crm/legal-milestones", "Go to Legal Milestones");
      } else if (action === "mark-registered") {
        promptNextStep(navigate, "Agreement registered — you may now request NOC and begin the possession process.", "/crm/noc", "Go to NOC");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleMarkRegistered = async () => {
    if (!selectedId) return;
    if (!regForm.AfsRegistrationNo.trim()) { toast.error("AFS Registration No. is required"); return; }
    if (!regForm.AfsRegistrationDate) { toast.error("AFS Registration Date is required"); return; }
    setRegSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/mark-registered`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AfsRegistrationNo: regForm.AfsRegistrationNo.trim(),
          AfsRegistrationDate: regForm.AfsRegistrationDate,
          AfsStampDuty: regForm.AfsStampDuty !== "" ? regForm.AfsStampDuty : undefined,
          AfsRegistrationFee: regForm.AfsRegistrationFee !== "" ? regForm.AfsRegistrationFee : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement marked Registered");
      setRegDialog(false);
      setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      promptNextStep(navigate, "Agreement registered — you may now request Bank / Organisation NOC.", "/crm/noc", "Go to NOC");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setRegSaving(false);
    }
  };

  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxyDateDialog, setProxyDateDialog] = useState(false);
  const [proxyProposeDateDialog, setProxyProposeDateDialog] = useState(false);
  const [proxyProposedDate, setProxyProposedDate] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  const handleProxyCustomerApprove = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer approval recorded on their behalf");
      setProxyApproveDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyDateAccept = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-date-accept`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer date acceptance recorded on their behalf");
      setProxyDateDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyCustomerRecheck = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-recheck`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer recheck request recorded on their behalf");
      setProxyRecheckDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyProposeDate = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId || !proxyProposedDate) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks, ProposedDate: proxyProposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer's proposed date recorded on their behalf");
      setProxyProposeDateDialog(false);
      setProxyProposedDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const [togglingPortal, setTogglingPortal] = useState(false);
  const handleTogglePortalAccess = async (deactivate: boolean) => {
    if (!selectedId) return;
    setTogglingPortal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/portal/${deactivate ? "deactivate" : "reactivate"}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(deactivate ? "Portal access deactivated" : "Portal access reactivated");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setTogglingPortal(false);
    }
  };

  const openEdit = () => {
    if (!detail?.agreement) return;
    setEditForm({
      LegalName: detail.agreement.LegalName || "",
      LegalAddress: detail.agreement.LegalAddress || "",
      PanNo: detail.agreement.PanNo || "",
      AadhaarNo: detail.agreement.AadhaarNo || "",
      RevisionReason: "",
      LegalExecutiveId: detail.agreement.LegalExecutiveId ? String(detail.agreement.LegalExecutiveId) : "",
    });
    setEditLocked(true);
    setEditDialog(true);
  };

  const [assigningLegal, setAssigningLegal] = useState(false);
  const [editingLegalExec, setEditingLegalExec] = useState(false);
  // Deliberately its own action, not folded into Edit Details — assigning
  // "who is handling this" isn't a legal-content correction, so it
  // shouldn't require unlocking Edit, filling a revision reason, or
  // bumping VersionNo the way a PAN/address fix does.
  const handleAssignLegal = async (legalExecutiveId: string) => {
    if (!selectedId) return;
    setAssigningLegal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/assign-legal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ LegalExecutiveId: legalExecutiveId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(legalExecutiveId ? "Legal executive assigned" : "Legal executive unassigned");
      setEditingLegalExec(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAssigningLegal(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedId) return;
    if (editForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (editForm.AadhaarNo && !/^\d{12}$/.test(editForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    const alIssued = detail?.agreement?.AllotmentLetterStatus === "Issued";
    const touchesLegal = editForm.LegalName !== (detail?.agreement?.LegalName || "")
      || editForm.LegalAddress !== (detail?.agreement?.LegalAddress || "")
      || editForm.PanNo !== (detail?.agreement?.PanNo || "")
      || editForm.AadhaarNo !== (detail?.agreement?.AadhaarNo || "");
    if (alIssued && touchesLegal && !editForm.RevisionReason.trim()) {
      toast.error("Amendment reason is required — the Allotment Letter has been issued for this booking. State why this change is needed.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.versionBumped ? "Details updated — prior version preserved in history" : "Details updated");
      setEditDialog(false);
      setEditLocked(true);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-revisions", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  usePageRights("crm-agreements");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Agreements"]} />
      <CrmShell
        title="CRM — Agreements"
      subtitle="Sale agreements and legal documents"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setAgrDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Agreement
        </button>
        </div>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        {/* List */}
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agreements..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll space-y-1.5">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No agreements found</div>
            ) : (filtered as any[]).map((a: any) => {
              const railColor = a.Status === "Registered" ? "#22c55e" : a.Status === "Executed" ? "#3b82f6" : a.Status === "Cancelled" ? "#ef4444" : "var(--border)";
              return (
              <button key={a.Id} onClick={() => selectAgreement(a.Id)}
                className={`w-full text-left rounded-lg border overflow-hidden transition-colors ${selectedId === a.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
                <div className="flex">
                  <div className="w-[3px] shrink-0 self-stretch" style={{ background: railColor }} />
                  <div className="flex-1 min-w-0 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold leading-tight truncate">{a.ApplicantName}</span>
                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${agrStatusColor[a.Status] || ""}`}>{a.Status}</span>
                    </div>
                    {isBookingCancelled(a) && (
                      <div className="text-[10px] font-semibold text-red-600">⚠ Booking {a.BookingStatus || "inactive"} — locked</div>
                    )}
                    <div className="text-[11px] font-mono text-muted-foreground">{a.AgreementNo}</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-muted-foreground truncate">{a.BookingNo} · {a.UnitNo}</div>
                      <div className="shrink-0 text-[10px] text-muted-foreground">{a.DocumentCount || 0} doc{a.DocumentCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-[11px] flex items-center gap-1">
                      <UserCircle2 size={10} className="text-muted-foreground shrink-0" />
                      {a.LegalExecutiveName
                        ? <span className="text-foreground font-medium truncate">{a.LegalExecutiveName}</span>
                        : <span className="text-amber-600 font-medium">Unassigned</span>}
                    </div>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto thin-scroll space-y-4">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Select an agreement to view details
            </div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              {/* Lifecycle progress + the one thing to actually do right now —
                  replaces staff having to piece the current state together
                  from separate status pills scattered further down. */}
              {detail.agreement?.Status !== CrmStatus.CANCELLED && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <AgreementStepper steps={agreementStepStates(detail.agreement, detail.documents)} activeTab={agrTab} onStepClick={setAgrTab} />
                  {(() => {
                    const a = detail.agreement;
                    const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                    const cancelled = isBookingCancelled(a);
                    type BannerVariant = "error" | "warning" | "info" | "success" | "action";
                    let variant: BannerVariant = "info";
                    let text = "";
                    let subtext = "";
                    let cta: { label: string; onClick: () => void } | null = null;
                    if (cancelled) {
                      variant = "error";
                      text = `Booking is ${a?.BookingStatus || "inactive"} — this agreement is locked.`;
                      subtext = "Cancel the agreement to formally close it out.";
                    } else if (a?.Status === CrmStatus.REGISTERED) {
                      variant = "success";
                      text = "Agreement fully complete — Registered at Sub-Registrar.";
                    } else if (a?.Status === CrmStatus.EXECUTED) {
                      variant = "info";
                      text = "Agreement executed.";
                      subtext = "Record the Sub-Registrar Registration No. to mark it Registered.";
                    } else if (!a?.LegalExecutiveId) {
                      variant = "warning";
                      text = "No Legal Executive assigned.";
                      subtext = "Assign someone responsible for preparing the paperwork — required before execution (server-enforced).";
                    } else if (a?.SeniorApprovalStatus !== CrmStatus.APPROVED) {
                      variant = "warning";
                      text = "Awaiting senior approval.";
                      subtext = "Submit via the Legal & Approval tab, then an admin approves from the Admin Approval Inbox.";
                    } else if (!a?.SentToCustomerAt) {
                      variant = "action";
                      text = "Senior-approved — ready to share with the customer.";
                      cta = { label: "Send to Customer Portal", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus === "RecheckRequested") {
                      variant = "error";
                      text = "Customer requested a recheck.";
                      subtext = a?.LastRecheckRemarks ? `"${a.LastRecheckRemarks}"` : "Address the issue and resend.";
                      cta = { label: "Resend After Recheck", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus !== CrmStatus.APPROVED) {
                      variant = "info";
                      text = "Sent to customer — awaiting their review and approval.";
                      subtext = a?.SentToCustomerAt ? `Sent ${String(a.SentToCustomerAt).slice(0, 10)}` : "";
                    } else if (!a?.AgreementDate) {
                      if (a?.DateApprovalStatus === CrmStatus.PENDING) {
                        variant = "warning";
                        text = "Date agreed by both sides — awaiting super admin confirmation.";
                      } else if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) {
                        variant = "info";
                        text = `We proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"} — waiting for customer's response.`;
                      } else if (a?.ProposedDateStatus === "PendingCompanyReview") {
                        variant = "action";
                        text = `Customer proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"} — your turn to accept or counter.`;
                        cta = { label: "Accept Date", onClick: handleAcceptDate };
                      } else {
                        variant = "action";
                        text = "Customer approved — now propose an agreement signing date.";
                        cta = { label: "Propose Agreement Date", onClick: () => { setSendDate(preferredAgrDate); setProposeDateDialog(true); } };
                      }
                    } else if (pendingDocs.length) {
                      variant = "warning";
                      text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still need verification.`;
                      subtext = pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ");
                    } else {
                      variant = "action";
                      text = "All checks passed — ready to mark this agreement executed.";
                      cta = { label: "Mark Executed", onClick: () => handleAgreementAction("mark-executed") };
                    }
                    type VariantDef = { card: string; text: string; sub: string; icon: React.ReactNode };
                    const variantDef: Record<BannerVariant, VariantDef> = {
                      error:   { card: "border-red-300 bg-red-500/10 dark:border-red-800 dark:bg-red-950/50",     text: "text-red-700 dark:text-red-300",   sub: "text-red-600/80 dark:text-red-400/80",   icon: <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" /> },
                      warning: { card: "border-amber-300 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-950/50", text: "text-amber-800 dark:text-amber-200", sub: "text-amber-700/80 dark:text-amber-400/80", icon: <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" /> },
                      info:    { card: "border-blue-300 bg-blue-500/10 dark:border-blue-800 dark:bg-blue-950/50",   text: "text-blue-800 dark:text-blue-200",   sub: "text-blue-700/80 dark:text-blue-400/80",   icon: <Info size={16} className="text-blue-500 shrink-0 mt-0.5" /> },
                      success: { card: "border-green-300 bg-green-500/10 dark:border-green-800 dark:bg-green-950/50", text: "text-green-800 dark:text-green-200", sub: "text-green-700/80 dark:text-green-400/80", icon: <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" /> },
                      action:  { card: "border-primary/40 bg-primary/10",                                            text: "text-foreground",                   sub: "text-muted-foreground",                   icon: <ArrowRight size={16} className="text-primary shrink-0 mt-0.5" /> },
                    };
                    const vd = variantDef[variant];
                    return (
                      <div className={`flex items-start justify-between gap-3 flex-wrap rounded-xl border px-4 py-3 ${vd.card}`}>
                        <div className="flex items-start gap-2.5">
                          {vd.icon}
                          <div>
                            <p className={`text-sm font-semibold leading-snug ${vd.text}`}>{text}</p>
                            {subtext && <p className={`text-xs mt-0.5 ${vd.sub}`}>{subtext}</p>}
                          </div>
                        </div>
                        {cta && (
                          <button onClick={cta.onClick}
                            className="shrink-0 px-3.5 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 whitespace-nowrap">
                            {cta.label}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Header — name, status, and every global action. Stays
                  visible across all tabs since these apply to the whole
                  agreement, not one section of it. */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className={`px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${
                  detail.agreement?.Status === "Registered" ? "bg-gradient-to-r from-green-500/10 to-green-500/5 border-b border-green-200/60 dark:border-green-900/40"
                  : detail.agreement?.Status === "Executed" ? "bg-gradient-to-r from-blue-500/10 to-blue-500/5 border-b border-blue-200/60 dark:border-blue-900/40"
                  : detail.agreement?.Status === "Cancelled" ? "bg-gradient-to-r from-red-500/10 to-red-500/5 border-b border-red-200/60 dark:border-red-900/40"
                  : "bg-muted/20 border-b border-border"
                }`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${
                      detail.agreement?.Status === "Registered" ? "bg-green-100 dark:bg-green-900/40"
                      : detail.agreement?.Status === "Executed" ? "bg-blue-100 dark:bg-blue-900/40"
                      : detail.agreement?.Status === "Cancelled" ? "bg-red-100 dark:bg-red-900/40"
                      : "bg-primary/10"}`}>
                      <Building2 size={16} className={
                        detail.agreement?.Status === "Registered" ? "text-green-600"
                        : detail.agreement?.Status === "Executed" ? "text-blue-600"
                        : detail.agreement?.Status === "Cancelled" ? "text-red-600"
                        : "text-primary"} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-bold text-[15px] text-foreground leading-tight truncate">{detail.agreement?.ApplicantName}</h2>
                      <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        {detail.agreement?.AgreementNo}
                        {detail.agreement?.VersionNo > 1 && <span className="ml-1.5 text-violet-600">· v{detail.agreement.VersionNo}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2.5 py-1 rounded-lg border font-semibold ${agrStatusColor[detail.agreement?.Status] || ""}`}>
                      {detail.agreement?.Status}
                    </span>
                    {detail.agreement && isBookingCancelled(detail.agreement) && (
                      <span title={`Booking ${detail.agreement.BookingStatus || "inactive"} — Edit/Send/Mark actions are locked. Cancel the agreement instead.`}
                        className="text-xs px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-medium cursor-help">
                        ⚠ Booking {detail.agreement.BookingStatus || "Inactive"}
                      </span>
                    )}
                    {detail.agreement?.Status === CrmStatus.DRAFT && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot edit" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                          Edit Details
                        </span>
                      ) : detail.agreement?.AllotmentLetterStatus === "Issued" ? (
                        <button onClick={openEdit} title="Allotment Letter issued — any change to legal details requires an amendment reason"
                          className="flex items-center gap-1 text-xs px-2 py-0.5 border border-amber-300 rounded-full text-amber-700 bg-amber-50 hover:bg-amber-100">
                          <Lock size={10} /> Amend Details
                        </button>
                      ) : (
                        <button onClick={openEdit}
                          className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                          Edit Details
                        </button>
                      )
                    )}
                    {detail.agreement?.Status === CrmStatus.DRAFT && (() => {
                      const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                      if (isBookingCancelled(detail.agreement)) {
                        return (
                          <span title="Booking is cancelled — cannot mark executed" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                            Mark Executed
                          </span>
                        );
                      }
                      const approvalsReady = detail.agreement?.SeniorApprovalStatus === CrmStatus.APPROVED
                        && detail.agreement?.CustomerApprovalStatus === CrmStatus.APPROVED
                        && detail.agreement?.AgreementDate;
                      if (!approvalsReady) {
                        return (
                          <span title="Requires senior approval, customer approval, and a mutually agreed date"
                            className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/60 cursor-help">
                            Mark Executed (not ready)
                          </span>
                        );
                      }
                      if (!detail.agreement?.LegalExecutiveId) {
                        // Same order as the backend (LegalExecutiveId before
                        // mandatory docs) and the Next Action banner above.
                        return (
                          <span title="A Legal Executive must be assigned first — pick one from the Legal Executive field above"
                            className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/60 cursor-help">
                            Mark Executed (legal exec. unassigned)
                          </span>
                        );
                      }
                      if (pendingDocs.length) {
                        return (
                          <span title={`Mandatory document(s) not yet verified: ${pendingDocs.map((d) => d.Label || d.DocumentType).join(", ")}`}
                            className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/60 cursor-help">
                            Mark Executed (docs pending)
                          </span>
                        );
                      }
                      return (
                        <button onClick={() => handleAgreementAction("mark-executed")}
                          className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                          Mark Executed
                        </button>
                      );
                    })()}
                    {detail.agreement?.Status === CrmStatus.EXECUTED && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot mark registered" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                          Mark Registered
                        </span>
                      ) : (
                        <button onClick={() => {
                            const ag = detail.agreement;
                            // Priority 1: ConfirmedAmount from the AFS QP record (what the
                            // customer actually paid, as attested during AFS QP confirmation).
                            // Priority 2: individual StampDuty / RegistrationFee from the QP
                            // record (the estimate that was sent to the customer).
                            // Priority 3: whatever was previously saved on the Agreement itself
                            // (non-null only if mark-registered was run before and already had
                            // a value). Blank as last resort — same as before this fix.
                            const hasConfirmed = ag?.AfsQpConfirmedAmount != null;
                            let prefillStamp = "";
                            let prefillFee   = "";
                            if (hasConfirmed) {
                              // ConfirmedAmount is a single total — split proportionally to
                              // QP's own Stamp/Fee split if both exist, otherwise put it all
                              // in StampDuty and leave Fee blank for staff to split manually.
                              if (ag.AfsQpStampDuty != null && ag.AfsQpRegistrationFee != null) {
                                prefillStamp = String(ag.AfsQpStampDuty);
                                prefillFee   = String(ag.AfsQpRegistrationFee);
                              } else {
                                prefillStamp = String(ag.AfsQpConfirmedAmount);
                              }
                            } else if (ag?.AfsQpStampDuty != null || ag?.AfsQpRegistrationFee != null) {
                              prefillStamp = ag.AfsQpStampDuty   != null ? String(ag.AfsQpStampDuty)        : "";
                              prefillFee   = ag.AfsQpRegistrationFee != null ? String(ag.AfsQpRegistrationFee) : "";
                            } else {
                              prefillStamp = ag?.AfsStampDuty      != null ? String(ag.AfsStampDuty)      : "";
                              prefillFee   = ag?.AfsRegistrationFee != null ? String(ag.AfsRegistrationFee) : "";
                            }
                            setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: prefillStamp, AfsRegistrationFee: prefillFee });
                            setRegFeesLocked(prefillStamp !== "" || prefillFee !== "");
                            setRegDialog(true);
                          }}
                          className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                          Mark Registered
                        </button>
                      )
                    )}
                    {(detail.agreement?.Status === CrmStatus.DRAFT || detail.agreement?.Status === CrmStatus.EXECUTED) && (
                      <button onClick={() => { if (window.confirm("Cancel this agreement?")) handleAgreementAction("cancel"); }}
                        className="text-xs px-2.5 py-1 border border-red-200 rounded-lg text-red-600 bg-red-50/50 hover:bg-red-100 font-medium">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tab bar — same visual pattern as CrmBookingDetail.tsx's own
                  tabs (underline style), so the two most-used CRM detail
                  pages feel like one consistent system instead of each
                  inventing their own step UI. */}
              <div className="flex items-center gap-x-1 border-b border-border px-1 -mt-1">
                {AGR_TABS.map((t, i) => (
                  <button key={t} onClick={() => setAgrTab(t)}
                    className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                      agrTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      agrTab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                    {t}
                  </button>
                ))}
              </div>

              {agrTab === "Overview" && (
              <div className="rounded-xl border border-border overflow-hidden space-y-0">
                {detail.agreement?.AllotmentLetterStatus === "Issued" && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900/40 px-4 py-2.5">
                    <Lock size={11} className="shrink-0" />
                    Allotment Letter issued{detail.agreement?.AllotmentLetterIssuedOn ? ` on ${String(detail.agreement.AllotmentLetterIssuedOn).slice(0, 10)}` : ""} — legal details are locked. Use <strong className="mx-0.5">Amend Details</strong> to make a recorded change.
                  </div>
                )}

                {/* Key summary row */}
                <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                  <div className="px-4 py-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Booking</p>
                    <p className="text-sm font-semibold">{detail.agreement?.BookingNo}</p>
                    <p className="text-[11px] text-muted-foreground">{detail.agreement?.UnitNo}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Project</p>
                    <p className="text-sm font-semibold truncate">{detail.agreement?.ProjectName || "—"}</p>
                    <p className={`text-[11px] font-medium ${detail.agreement?.AllotmentLetterStatus === "Issued" ? "text-green-600" : "text-muted-foreground"}`}>
                      AL: {detail.agreement?.AllotmentLetterStatus || "—"}
                    </p>
                  </div>
                  <div className={`px-4 py-3 ${detail.agreement?.AgreementDate ? "bg-green-500/[0.04]" : ""}`}>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Agreement Date</p>
                    {detail.agreement?.AgreementDate ? (
                      <p className="text-sm font-bold text-green-700 dark:text-green-400">{String(detail.agreement.AgreementDate).slice(0, 10)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60 italic">Not set</p>
                    )}
                  </div>
                </div>

                {/* Legal details */}
                <div className="px-4 py-3 space-y-2 border-b border-border">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Legal Details</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {[
                    ["Legal Name",       detail.agreement?.LegalName || "—"],
                    ["PAN",              detail.agreement?.PanNo || "—"],
                    ["Aadhaar",          detail.agreement?.AadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span className="text-[11px] text-muted-foreground block">{k}</span>
                      <span className="font-medium text-sm">{v}</span>
                    </div>
                  ))}
                  {detail.agreement?.LegalAddress && (
                    <div className="col-span-2">
                      <span className="text-[11px] text-muted-foreground block">Legal Address</span>
                      <span className="text-sm text-muted-foreground">{detail.agreement.LegalAddress}</span>
                    </div>
                  )}
                  {/* GrandTotal (GST-inclusive) */}
                  <div className="col-span-2 pt-1 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground block">Total Value (incl. GST)</span>
                    <span className="text-sm font-bold font-mono">
                      {detail.agreement?.GrandTotal ? `₹${Number(detail.agreement.GrandTotal).toLocaleString("en-IN")}` : "—"}
                    </span>
                    {detail.agreement?.GrandTotal > 0 && (
                      <span className="text-[11px] text-muted-foreground block mt-0.5">
                        Unit ₹{Number(detail.agreement.TotalValue).toLocaleString("en-IN")}
                        {detail.agreement?.UnitGstAmount > 0 && ` + GST ₹${Number(detail.agreement.UnitGstAmount).toLocaleString("en-IN")}`}
                        {detail.agreement?.ParkingTotal > 0 && ` + Parking ₹${Number(detail.agreement.ParkingTotal).toLocaleString("en-IN")}`}
                        {detail.agreement?.ExtraChargesTotal > 0 && ` + Extra ₹${Number(detail.agreement.ExtraChargesTotal).toLocaleString("en-IN")}`}
                      </span>
                    )}
                  </div>
                </div>
                </div>

                {/* Financial progress bar */}
                {detail?.financialSummary && (() => {
                  const ag = detail.agreement;
                  const storedGrand = Number(ag?.GrandTotal ?? 0);
                  const grandTotal = storedGrand > 0 ? storedGrand : (Number(ag?.TotalValue || 0) + Number(ag?.UnitGstAmount || 0) + Number(ag?.ParkingTotal || 0) + Number(ag?.ExtraChargesTotal || 0));
                  return (
                  <div className="px-4 py-3 border-b border-border">
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={Number(detail.financialSummary.cleared || 0)}
                    pendingReceipts={Number(detail.financialSummary.mrOnAccount || 0)}
                    approvedOnAccount={Number(detail.financialSummary.approvedOnAccount || 0)}
                    compact
                  />
                  </div>
                  );
                })()}

                {/* AFS Registration */}
                {detail.agreement?.Status === CrmStatus.REGISTERED && (
                  <div className="px-4 py-3 bg-green-500/[0.04] border-b border-green-200/60 dark:border-green-900/40 space-y-2">
                    <p className="text-[11px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> AFS Registration (Sub-Registrar)
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-[11px] text-muted-foreground block">Doc No.</span>
                        <span className="font-semibold font-mono">{detail.agreement.AfsRegistrationNo || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-foreground block">Registration Date</span>
                        <span className="font-semibold">{detail.agreement.AfsRegistrationDate ? String(detail.agreement.AfsRegistrationDate).slice(0, 10) : "—"}</span>
                      </div>
                      {detail.agreement.AfsStampDuty != null && (
                        <div>
                          <span className="text-[11px] text-muted-foreground block">Stamp Duty Paid</span>
                          <span className="font-semibold font-mono">{Number(detail.agreement.AfsStampDuty).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      {detail.agreement.AfsRegistrationFee != null && (
                        <div>
                          <span className="text-[11px] text-muted-foreground block">Registration Fee</span>
                          <span className="font-semibold font-mono">{Number(detail.agreement.AfsRegistrationFee).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Version history */}
                {revisions.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Version History (prior to v{detail.agreement?.VersionNo})</p>
                    <div className="space-y-1.5 text-xs">
                      {(revisions as any[]).map((r) => (
                        <div key={r.Id} className="rounded-lg border border-border p-2.5 bg-muted/20">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-600 text-[10px] font-medium">v{r.VersionNo}</span>
                            <span>{r.Reason}</span>
                            <span className="text-[10px]">({String(r.CreatedAt).slice(0,16).replace("T"," ")}{r.CreatedByName ? ` · ${r.CreatedByName}` : ""})</span>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                            {r.LegalName && <div><span className="text-muted-foreground">Legal Name: </span>{r.LegalName}</div>}
                            {r.AgreementDate && <div><span className="text-muted-foreground">Agreement Date: </span>{String(r.AgreementDate).slice(0,10)}</div>}
                            {r.PanNo && <div><span className="text-muted-foreground">PAN: </span>{r.PanNo}</div>}
                            {r.AadhaarNo && <div><span className="text-muted-foreground">Aadhaar: </span>{r.AadhaarNo}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              )}

              {agrTab === "Legal & Approval" && (() => {
                const a = detail.agreement;
                const cancelled = isBookingCancelled(a);
                const legalAssigned = !!a?.LegalExecutiveId;
                const seniorStatus = a?.SeniorApprovalStatus;
                const seniorApproved = seniorStatus === CrmStatus.APPROVED;
                const seniorPending  = seniorStatus === CrmStatus.PENDING;
                const seniorRejected = seniorStatus === CrmStatus.REJECTED;
                const sent        = !!a?.SentToCustomerAt;
                const custStatus  = a?.CustomerApprovalStatus;
                const custApproved = custStatus === CrmStatus.APPROVED;
                const custRecheck  = custStatus === "RecheckRequested";
                const dated   = !!a?.AgreementDate;
                const executed = [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(a?.Status);
                const stepsComplete = [seniorApproved, sent, custApproved, dated, executed].filter(Boolean).length;

                const circleCls = (s: "done"|"active"|"warn"|"upcoming") =>
                  s === "done"     ? "bg-green-500 text-white ring-2 ring-green-200 dark:ring-green-900" :
                  s === "active"   ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                  s === "warn"     ? "bg-red-500 text-white ring-2 ring-red-200 dark:ring-red-900" :
                  "bg-muted text-muted-foreground";

                return (
                  <div className="space-y-4">
                    {/* Legal Executive */}
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                          <UserCircle2 size={15} className="text-primary" /> Legal Executive
                        </h3>
                        {legalAssigned
                          ? <span className="text-[11px] text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-semibold">Assigned</span>
                          : <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">Unassigned</span>
                        }
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <p className="text-xs text-muted-foreground">The person responsible for preparing this agreement's paperwork. Required before execution (server-enforced).</p>
                        {/* Locked display when assigned and not actively changing */}
                        {a?.LegalExecutiveId && !editingLegalExec && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 flex-1 bg-muted/40 border border-border rounded-lg px-3 py-1.5">
                              <UserCircle2 size={14} className="text-primary shrink-0" />
                              <span className="text-sm font-medium">{a.LegalExecutiveName}</span>
                              <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                            </div>
                            <button
                              onClick={() => setEditingLegalExec(true)}
                              className="text-xs px-2.5 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted shrink-0">
                              Change
                            </button>
                          </div>
                        ) : ["Registered", "Cancelled"].includes(a?.Status) || cancelled ? (
                          <div className="font-medium text-sm">{a?.LegalExecutiveName || <span className="text-amber-600">Unassigned</span>}</div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              value={a?.LegalExecutiveId ? String(a.LegalExecutiveId) : ""}
                              disabled={assigningLegal}
                              onChange={(e) => handleAssignLegal(e.target.value)}
                              className={`flex-1 text-sm border rounded-lg px-2 py-1.5 bg-background disabled:opacity-40 ${
                                a?.LegalExecutiveId ? "border-border" : "border-amber-300 text-amber-600"}`}>
                              <option value="">— Unassigned —</option>
                              {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                            </select>
                            {editingLegalExec && (
                              <button
                                onClick={() => setEditingLegalExec(false)}
                                className="text-xs px-2.5 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted shrink-0">
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                        {!a?.LegalExecutiveId && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                            Assign someone now so they receive an immediate notification and can start preparing the paperwork.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Approval Timeline */}
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                          <ShieldAlert size={15} className="text-primary" /> Approval Timeline
                        </h3>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[0,1,2,3,4].map((i) => (
                              <div key={i} className={`w-2 h-2 rounded-full ${i < stepsComplete ? "bg-green-500" : "bg-muted"}`} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{stepsComplete}/5</span>
                        </div>
                      </div>

                      {/* Step 1 — Senior Review */}
                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${seniorApproved ? "bg-green-500/[0.04]" : seniorRejected ? "bg-red-500/[0.04]" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${circleCls(seniorApproved ? "done" : seniorRejected ? "warn" : seniorPending ? "active" : "upcoming")}`}>
                          {seniorApproved ? <Check size={14} /> : seniorRejected ? <AlertCircle size={13} /> : 1}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Senior Review</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                              seniorApproved ? "text-green-600 bg-green-50 border-green-200"
                              : seniorRejected ? "text-red-600 bg-red-50 border-red-200"
                              : "text-amber-600 bg-amber-50 border-amber-200"
                            }`}>{seniorStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            An admin or super-admin approves this agreement before it's shared with the customer. Once submitted, review happens from the <strong>Admin Approval Inbox</strong>.
                          </p>
                          {seniorApproved && a?.SeniorApprovedAt && (
                            <p className="text-xs text-green-700 flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved {String(a.SeniorApprovedAt).slice(0,10)}
                              {a?.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {a.SeniorApprovalRemarks}</span>}
                            </p>
                          )}
                          {seniorRejected && a?.SeniorApprovalRemarks && (
                            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                              <strong>Rejection reason:</strong> {a.SeniorApprovalRemarks}
                            </div>
                          )}
                          {!cancelled && !seniorApproved && (
                            <div className="flex items-center gap-2 flex-wrap pt-0.5">
                              <ApprovalActions
                                status={a?.SeniorApprovalStatus}
                                recordId={a?.Id}
                                endpoint={API}
                                submitOnly
                                onSuccess={() => {
                                  qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                                  qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                                }}
                              />
                              {seniorPending && <span className="text-xs text-muted-foreground">Awaiting review in Admin Inbox</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Step 2 — Shared with Customer */}
                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${sent ? "bg-blue-500/[0.04]" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${circleCls(sent ? "done" : seniorApproved ? "active" : "upcoming")}`}>
                          {sent ? <Check size={14} /> : 2}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Shared with Customer</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                              sent ? "text-blue-600 bg-blue-50 border-blue-200" : "text-muted-foreground bg-muted/30 border-border"
                            }`}>{sent ? "Sent" : "Not sent"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            The customer can view this agreement in their portal and approve it or request a recheck.
                          </p>
                          {sent && a?.SentToCustomerAt && (
                            <p className="text-xs text-blue-600 flex items-center gap-1">
                              <Send size={11} /> Sent {String(a.SentToCustomerAt).slice(0,16).replace("T"," ")}
                            </p>
                          )}
                          {seniorApproved && !sent && !cancelled && (
                            <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                              className="mt-0.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
                              Send to Customer Portal
                            </button>
                          )}
                          {custRecheck && seniorApproved && !cancelled && (
                            <div className="space-y-1.5 pt-0.5">
                              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                <strong>Recheck requested ({a.RecheckCount}x):</strong> {a.LastRecheckRemarks || "No remark provided"}
                              </div>
                              <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
                                Resend After Recheck
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Step 3 — Customer Approval */}
                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${custApproved ? "bg-green-500/[0.04]" : custRecheck ? "bg-red-500/[0.04]" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${circleCls(custApproved ? "done" : custRecheck ? "warn" : sent ? "active" : "upcoming")}`}>
                          {custApproved ? <Check size={14} /> : custRecheck ? <AlertCircle size={13} /> : 3}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Customer Approval</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                              custApproved ? "text-green-600 bg-green-50 border-green-200"
                              : custRecheck ? "text-red-600 bg-red-50 border-red-200"
                              : "text-amber-600 bg-amber-50 border-amber-200"
                            }`}>{custStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Customer reviews the agreement from their portal and approves it or flags issues.
                          </p>
                          {custApproved && a?.CustomerApprovedAt && (
                            <p className="text-xs text-green-700 flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved by customer {String(a.CustomerApprovedAt).slice(0,10)}
                            </p>
                          )}
                          {a?.RecheckCount > 0 && !custApproved && (
                            <p className="text-xs text-red-600">Recheck count: {a.RecheckCount} · Last remark: {a.LastRecheckRemarks || "—"}</p>
                          )}
                          {sent && !custApproved && !custRecheck && !cancelled && (
                            <div className="pt-1 border-t border-border/60 mt-1">
                              <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                                <UserCircle2 size={11} /> Customer not on portal?
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setProxyApproveDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Approval on Their Behalf
                                </button>
                                <button
                                  onClick={() => setProxyRecheckDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-red-50 border border-red-200 text-red-800 rounded-lg font-semibold hover:bg-red-100 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Recheck Request on Their Behalf
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Step 4 — Agreement Date */}
                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${dated ? "bg-green-500/[0.04]" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${circleCls(dated ? "done" : a?.DateApprovalStatus === CrmStatus.PENDING ? "warn" : custApproved ? "active" : "upcoming")}`}>
                          {dated ? <Check size={14} /> : <CalendarDays size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Agreement Date</span>
                            {dated ? (
                              <span className="text-[11px] px-2 py-0.5 rounded-full border font-semibold text-green-600 bg-green-50 border-green-200">
                                Confirmed: {String(a.AgreementDate).slice(0,10)}
                              </span>
                            ) : a?.ProposedDate ? (
                              <span className="text-[11px] px-2 py-0.5 rounded-full border font-semibold text-purple-600 bg-purple-50 border-purple-200">
                                Proposed: {String(a.ProposedDate).slice(0,10)}
                              </span>
                            ) : (
                              <span className="text-[11px] px-2 py-0.5 rounded-full border font-semibold text-muted-foreground bg-muted/30 border-border">Not set</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Both sides negotiate a mutually acceptable signing date through the portal. A super-admin confirms the final agreed date.
                          </p>
                          {!dated && custApproved && !cancelled && (() => {
                            if (a?.DateApprovalStatus === CrmStatus.PENDING) return (
                              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                                <Clock size={11} /> Date matched — awaiting super admin sign-off
                              </p>
                            );
                            if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) return (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={11} /> Awaiting customer's response on proposed date {String(a.ProposedDate).slice(0,10)}</p>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer not on portal?</p>
                                  <button
                                    onClick={() => setProxyDateDialog(true)}
                                    className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 flex items-center gap-1.5"
                                  >
                                    <UserCircle2 size={12} /> Accept Date on Their Behalf
                                  </button>
                                </div>
                              </div>
                            );
                            if (a?.ProposedDateStatus === "PendingCompanyReview") return (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <button onClick={handleAcceptDate} disabled={saving}
                                  className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-40">
                                  Accept {String(a.ProposedDate).slice(0,10)}
                                </button>
                                <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setProposeDateDialog(true); }}
                                  className="text-xs px-3 py-1.5 border border-border rounded-lg font-medium hover:bg-muted">
                                  Propose Different Date
                                </button>
                              </div>
                            );
                            return (
                              <div className="space-y-2">
                                <button onClick={() => { setSendDate(preferredAgrDate); setProposeDateDialog(true); }}
                                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
                                  Propose Agreement Date
                                </button>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer communicated a date off-portal?</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <input type="date" value={proxyProposedDate} onChange={(e) => setProxyProposedDate(e.target.value)}
                                      className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                                    <button onClick={() => proxyProposedDate && setProxyProposeDateDialog(true)}
                                      disabled={!proxyProposedDate}
                                      className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 disabled:opacity-40 flex items-center gap-1.5">
                                      <UserCircle2 size={12} /> Record Customer's Proposed Date
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {dateHistory.length > 0 && (
                            <div className="mt-1 space-y-1 border-t border-border/60 pt-2">
                              <p className="text-[11px] text-muted-foreground font-medium flex items-center gap-1"><FolderClock size={11} /> Negotiation history</p>
                              {(dateHistory as any[]).map((h) => (
                                <div key={h.Id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <span className={`px-1.5 py-0.5 rounded-full border font-medium ${h.ProposedBy === "Company" ? "text-purple-600 bg-purple-50 border-purple-200" : "text-blue-600 bg-blue-50 border-blue-200"}`}>
                                    {h.ProposedBy}
                                  </span>
                                  proposed {String(h.ProposedDate).slice(0,10)}
                                  <span className="text-[10px]">· {String(h.CreatedAt).slice(0,10)}{h.CreatedByName ? ` by ${h.CreatedByName}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Step 5 — Execution & Registration */}
                      <div className={`px-4 py-4 flex items-start gap-3 ${executed ? "bg-green-500/[0.04]" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${circleCls(a?.Status === CrmStatus.REGISTERED ? "done" : a?.Status === CrmStatus.EXECUTED ? "active" : dated ? "active" : "upcoming")}`}>
                          {a?.Status === CrmStatus.REGISTERED ? <Check size={14} /> : <BarChart3 size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Execution &amp; Registration</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                              a?.Status === CrmStatus.REGISTERED ? "text-green-600 bg-green-50 border-green-200"
                              : a?.Status === CrmStatus.EXECUTED ? "text-blue-600 bg-blue-50 border-blue-200"
                              : "text-muted-foreground bg-muted/30 border-border"
                            }`}>
                              {a?.Status === CrmStatus.REGISTERED ? "Registered" : a?.Status === CrmStatus.EXECUTED ? "Executed" : "Pending"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            All mandatory documents verified → signed &amp; executed → registered at the Sub-Registrar's office with a Doc No.
                          </p>
                          {a?.Status === CrmStatus.EXECUTED && (
                            <p className="text-xs text-blue-600">Agreement executed. Record the Sub-Registrar Doc No. to mark it Registered.</p>
                          )}
                          {a?.Status === CrmStatus.REGISTERED && a?.AfsRegistrationNo && (
                            <p className="text-xs text-green-700 flex items-center gap-1">
                              <CheckCircle2 size={11} /> Reg. No. {a.AfsRegistrationNo} · {a?.AfsRegistrationDate ? String(a.AfsRegistrationDate).slice(0,10) : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {agrTab === "Documents" && (() => {
                const fp = followupProgress(detail.documents);
                const allVerified = (detail.documents || []).filter((d: any) => d.IsMandatory).every((d: any) => d.Status === "Verified");
                return (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 bg-muted/30 border-b border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><ScrollText size={15} className="text-primary" /> Agreement Documents ({detail.documents?.length || 0})</h3>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDocRequestDialog(true)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Send size={12} /> Request from Customer
                      </button>
                      <button onClick={() => setDocDialog(true)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Upload size={12} /> Add Document
                      </button>
                    </div>
                  </div>
                  {fp.required > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Mandatory docs: {fp.uploaded}/{fp.required} uploaded{allVerified ? "" : ` · ${(detail.documents || []).filter((d: any) => d.IsMandatory && d.Status === "Verified").length} verified`}</span>
                        <span className={`font-semibold ${fp.percent === 100 && allVerified ? "text-green-600" : fp.percent === 100 ? "text-amber-600" : "text-muted-foreground"}`}>{fp.percent}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            allVerified ? "bg-green-500" : fp.percent === 100 ? "bg-amber-500" : "bg-primary"
                          }`}
                          style={{ width: `${fp.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {!detail.documents?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No documents uploaded yet</div>
                ) : (detail.documents as any[]).map((d: any) => {
                  // "Requested" no longer always means waiting on the
                  // customer — the SaleAgreement baseline document (seeded
                  // automatically on every agreement) is staff/Legal-
                  // Executive-uploaded, so it needs its own label instead of
                  // the misleading "Awaiting upload from customer" that was
                  // previously shown for every Requested-status document
                  // regardless of who's actually supposed to attach it.
                  const awaitingUpload = d.Status === "Requested" && !d.FilePath && !d.DocumentUrl;
                  const awaitingCustomer = awaitingUpload && d.UploadedByType === "Customer";
                  const awaitingStaff = awaitingUpload && d.UploadedByType !== "Customer";
                  const statusBg = d.Status === "Verified" ? "bg-green-500/[0.06] dark:bg-green-900/20" : d.Status === "Rejected" ? "bg-red-500/[0.06] dark:bg-red-900/20" : "";
                  const docRail = d.Status === "Verified" ? "#22c55e" : d.Status === "Rejected" ? "#ef4444" : d.Status === "Uploaded" || d.Status === "Submitted" ? "#3b82f6" : awaitingUpload ? "#f59e0b" : "var(--border)";
                  return (
                    <div key={d.Id} className={`border-b border-border last:border-0 flex ${statusBg}`}>
                      <div className="w-[3px] shrink-0 self-stretch" style={{ background: docRail }} />
                      <div className="flex-1 min-w-0 px-4 py-3.5 flex items-center gap-4">

                        {/* Icon box */}
                        <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center border ${
                          d.Status === "Verified" ? "bg-green-100 border-green-200 dark:bg-green-900/40 dark:border-green-800" :
                          d.Status === "Rejected" ? "bg-red-100 border-red-200 dark:bg-red-900/40 dark:border-red-800" :
                          awaitingUpload ? "bg-amber-100 border-amber-200 dark:bg-amber-900/40 dark:border-amber-800" :
                          "bg-muted/60 border-border"
                        }`}>
                          {awaitingUpload
                            ? <Clock size={15} className="text-amber-500" />
                            : React.cloneElement(mimeIcon(d.MimeType) as React.ReactElement, { size: 15 })}
                        </div>

                        {/* Name + meta */}
                        <button onClick={() => setPreviewDoc(d)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold leading-tight">
                              {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                            </span>
                            {d.IsMandatory && <span className="text-[10px] text-red-500 font-bold">REQUIRED</span>}
                            {d.VersionNo > 1 && <span className="text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded px-1 font-medium">v{d.VersionNo}</span>}
                            {d.UploadedByType === "Customer" && (
                              <span className="flex items-center gap-0.5 text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded px-1.5 py-0.5 font-medium">
                                <UserCircle2 size={9} /> Customer
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                            {awaitingCustomer ? (
                              <span className="text-[11px] text-amber-600">Awaiting customer upload{d.RequestedAt ? ` · requested ${String(d.RequestedAt).slice(0, 10)}` : ""}</span>
                            ) : awaitingStaff ? (
                              <span className="text-[11px] text-amber-600">Pending — Legal Executive to attach{d.RequestedAt ? ` · ${String(d.RequestedAt).slice(0, 10)}` : ""}</span>
                            ) : (
                              <>
                                {d.FileName && <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">{d.FileName}</span>}
                                {d.FileSize && <span className="text-[11px] text-muted-foreground">{fmtBytes(d.FileSize)}</span>}
                                {d.IssuedBy && <span className="text-[11px] text-muted-foreground">by {d.IssuedBy}</span>}
                                {(d.FilePath || d.DocumentUrl) && <Eye size={11} className="text-muted-foreground/60" />}
                              </>
                            )}
                          </div>
                        </button>

                        {/* Status + actions */}
                        <div className="shrink-0 flex items-center gap-2">
                          <span className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold ${docStatusColor[d.Status] || "text-muted-foreground border-border"}`}>
                            {d.Status}
                          </span>
                          {!!d.FilePath && d.Status !== "Verified" && (
                            <button title="Quick verify" onClick={() => handleDocStatusChange(d.Id, "Verified")}
                              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 font-semibold dark:bg-green-900/30 dark:border-green-800 dark:text-green-400">
                              <Check size={11} /> Verify
                            </button>
                          )}
                          {!!d.FilePath && d.Status !== CrmStatus.REJECTED && (
                            <button title="Reject (opens review — a reason is required)" onClick={() => setPreviewDoc(d)}
                              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 font-semibold dark:bg-red-900/30 dark:border-red-800">
                              <X size={11} /> Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* New Agreement Dialog */}
      <Dialog open={agrDialog} onOpenChange={(o) => { if (!o) setAgrDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">New Agreement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={agrForm.BookingId} onChange={(e) => setAgrForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
              {bookings.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No bookings are eligible yet — a booking needs to be Approved, have its welcome call marked
                  Welcomed, and have customer bank/nominee/PAN/Aadhaar details on file before an agreement can be created.
                </p>
              )}
              {bkgFilter && !(bookings as any[]).some((b) => String(b.Id) === String(bkgFilter)) && (
                <p className="text-xs text-amber-600 mt-1">
                  This dialog was opened for a specific booking, but that booking isn't eligible for an agreement yet
                  — pick from the list above, or complete its remaining prerequisites first.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
              <select value={agrForm.LegalExecutiveId} onChange={(e) => setAgrForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Unassigned —</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "LegalName",    label: "Legal Name",      type: "text" },
                { key: "PanNo",        label: "PAN No",          type: "text" },
                { key: "AadhaarNo",    label: "Aadhaar No",      type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={agrForm[key as keyof typeof agrForm]}
                    onChange={(e) => setAgrForm((f) => ({ ...f, [key]: key === "PanNo" ? e.target.value.toUpperCase() : e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Legal Address</label>
              <textarea value={agrForm.LegalAddress} onChange={(e) => setAgrForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={agrForm.Notes} onChange={(e) => setAgrForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAgrDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSaveAgreement} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create Agreement"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to Customer Portal Dialog — proposed date is a real date
          picker now (was a bare window.prompt), and pre-fills with the
          agreement's existing company-proposed date on resend. */}
      <Dialog open={sendDialog} onOpenChange={(o) => { if (!o) { setSendDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Send to Customer Portal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The customer will be able to review this agreement and its documents from their portal, and either approve it or request a recheck.
            </p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Proposed Agreement Date (optional)</label>
              <input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              <p className="text-[11px] text-muted-foreground mt-1">If the customer proposes the same date, it's confirmed automatically as the Agreement Date.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setSendDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleSendToCustomer(sendDate)} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Sending..." : "Send"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Proxy: Record customer approval on their behalf (off-portal) */}
      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval"
          description="You are recording that the customer has reviewed and approved the agreement without logging into their portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={handleProxyCustomerApprove}
        />
      )}

      {/* Proxy: Record customer recheck request on their behalf (off-portal) */}
      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request"
          description="You are recording that the customer has flagged an issue or requested changes to the agreement without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={handleProxyCustomerRecheck}
        />
      )}

      {/* Proxy: Record date proposed by customer off-portal */}
      {proxyProposeDateDialog && (
        <ProxyActionDialog
          title="Record Customer's Proposed Date"
          description={`You are recording that the customer proposed ${proxyProposedDate} as the agreement signing date without using the portal.`}
          confirmLabel="Record Proposed Date"
          saving={proxySaving}
          onClose={() => setProxyProposeDateDialog(false)}
          onConfirm={handleProxyProposeDate}
        />
      )}

      {/* Proxy: Accept proposed date on customer's behalf (off-portal) */}
      {proxyDateDialog && (
        <ProxyActionDialog
          title="Accept Date on Customer's Behalf"
          description="You are recording that the customer has agreed to the proposed signing date without using their portal."
          confirmLabel="Confirm Date Acceptance"
          saving={proxySaving}
          onClose={() => setProxyDateDialog(false)}
          onConfirm={handleProxyDateAccept}
        />
      )}

      {/* Propose/Revise Agreement Date — one live proposed date, turn-based
          between company and customer. Submitting here always moves the
          negotiation to the customer's turn next (PendingCustomerReview). */}
      <Dialog open={proposeDateDialog} onOpenChange={(o) => { if (!o) { setProposeDateDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Propose Agreement Date</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This date goes to the customer for their review. They can accept it as-is, or propose a different one back to you.
            </p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Proposed Agreement Date</label>
              <input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              {preferredAgrDate && sendDate === preferredAgrDate && (
                <p className="text-[11px] text-blue-600 mt-1 flex items-center gap-1">
                  <span>ⓘ</span> Pre-filled from welcome call discussion
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setProposeDateDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleProposeDate(sendDate)} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Propose Date"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark Registered Dialog — collects the AFS registration details received
          from the Sub-Registrar (Doc No + date). The physical AFS is registered
          outside the system; this records the outcome of that event. */}
      <Dialog open={regDialog} onOpenChange={(o) => { if (!o) { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Mark Agreement Registered</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-xs text-muted-foreground">
              Enter the details from the Sub-Registrar's office. The AFS registration is a separate legal event from the Sale Deed — it happens now, early in the process.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration No. <span className="text-red-500">*</span></label>
              <input
                type="text"
                placeholder="e.g. SRO/MH/2024/001234"
                value={regForm.AfsRegistrationNo}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationNo: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Doc No. issued by Sub-Registrar at the time of AFS registration.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={regForm.AfsRegistrationDate}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              />
            </div>
            {/* Fee fields — locked when pre-filled from AFS QP, unlock to edit */}
            <div className={`rounded-lg border ${regFeesLocked ? "border-green-200 bg-green-500/[0.04] dark:border-green-900/50" : "border-border"} p-3 space-y-2`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">Government Fees</p>
                  {regFeesLocked && (
                    <p className="text-[11px] text-green-700 dark:text-green-400 mt-0.5">Pre-filled from confirmed AFS Query Payment — verify against Sub-Registrar receipt</p>
                  )}
                </div>
                {regFeesLocked ? (
                  <button type="button" onClick={() => setRegFeesLocked(false)}
                    className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted font-medium">
                    Edit amounts
                  </button>
                ) : (regForm.AfsStampDuty !== "" || regForm.AfsRegistrationFee !== "") ? (
                  <button type="button" onClick={() => setRegFeesLocked(true)}
                    className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 font-medium dark:border-green-700 dark:text-green-400">
                    Lock amounts
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsStampDuty}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsStampDuty: e.target.value }))}
                    className={`w-full text-sm border rounded px-2 py-1.5 font-mono ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Registration Fee (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsRegistrationFee}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationFee: e.target.value }))}
                    className={`w-full text-sm border rounded px-2 py-1.5 font-mono ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Stamp duty paid at AFS registration is creditable against Sale Deed stamp duty — the Sale Deed fee calculation will use this figure.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleMarkRegistered} disabled={regSaving || !regForm.AfsRegistrationNo.trim() || !regForm.AfsRegistrationDate}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {regSaving ? "Saving..." : "Confirm Registration"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Document Dialog — file upload is the primary path; File Name/
          type/size are always taken from the real uploaded file, never
          hand-typed, so the record can't drift from what was actually
          attached. Pasting an external URL stays available as a fallback
          for links that live outside our own storage. */}
      <Dialog open={docDialog} onOpenChange={(o) => { if (!o) { setDocDialog(false); setShowUrlField(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Document Type *</label>
              <select value={docForm.DocumentType} onChange={(e) => setDocForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Issued By</label>
              <input type="text" value={docForm.IssuedBy} onChange={(e) => setDocForm((f) => ({ ...f, IssuedBy: e.target.value }))}
                placeholder="e.g. Legal team, Bank, Registrar office"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks (optional)</label>
              <textarea value={docForm.Remarks} onChange={(e) => setDocForm((f) => ({ ...f, Remarks: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>

            <input type="file" multiple ref={docFileInputRef}
              onChange={(e) => handleUploadDocFiles(e.target.files)}
              className="hidden" />
            <button onClick={() => docFileInputRef.current?.click()} disabled={uploadingDocs}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-2 border-dashed border-border rounded-lg text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40">
              <Upload size={14} /> {uploadingDocs ? "Uploading..." : "Upload File(s)"}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>

            {showUrlField ? (
              <div className="flex items-center gap-2 pt-1">
                <input placeholder="https://..." value={docForm.DocumentUrl} onChange={(e) => setDocForm((f) => ({ ...f, DocumentUrl: e.target.value }))}
                  className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <button onClick={handleAddDocument} disabled={saving}
                  className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted shrink-0 disabled:opacity-40">
                  {saving ? "Adding..." : "Add Link"}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowUrlField(true)} className="text-xs text-primary hover:underline">
                ...or paste an external document URL instead
              </button>
            )}
          </div>
          <div className="flex justify-end pt-3 border-t border-border">
            <button onClick={() => { setDocDialog(false); setShowUrlField(false); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request Document Dialog — asks the customer for a document via
          their portal instead of staff attaching it on their behalf. Shows
          up there immediately as an open request once the agreement is
          sent; their upload flips it to Submitted for review here. */}
      <Dialog open={docRequestDialog} onOpenChange={(o) => { if (!o) setDocRequestDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Request Document from Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Document Type *</label>
              <select value={docRequestForm.DocumentType} onChange={(e) => setDocRequestForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Label shown to customer (optional)</label>
              <input type="text" value={docRequestForm.Label} onChange={(e) => setDocRequestForm((f) => ({ ...f, Label: e.target.value }))}
                placeholder="e.g. Latest bank statement"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={docRequestForm.IsMandatory}
                onChange={(e) => setDocRequestForm((f) => ({ ...f, IsMandatory: e.target.checked }))} />
              Required before the customer can approve the agreement
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDocRequestDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRequestDocument} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Requesting..." : "Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {previewDoc && (
        <DocumentReviewDialog
          agreementId={previewDoc.AgreementId || selectedId!}
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onReviewed={() => { setPreviewDoc(null); qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] }); }}
        />
      )}

      {/* Edit Details — every save snapshots the prior values into Version
          History (see backend PUT /:id) rather than silently overwriting them.
          When Allotment Letter is Issued, legal fields are formally committed
          and any change is treated as an amendment: reason becomes mandatory. */}
      <Dialog open={editDialog} onOpenChange={(o) => { if (!o) { setEditDialog(false); setEditLocked(true); } }}>
        <DialogContent className="max-w-lg">
          {(() => {
            const alIssued = detail?.agreement?.AllotmentLetterStatus === "Issued";
            const alIssuedOn = detail?.agreement?.AllotmentLetterIssuedOn;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
                    <span className="flex items-center gap-1.5">
                      {alIssued && <Lock size={14} className="text-amber-600 shrink-0" />}
                      {alIssued ? "Amend Agreement Details" : "Edit Agreement Details"}
                    </span>
                    {editLocked && (
                      <button onClick={() => setEditLocked(false)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-lg hover:bg-muted transition-colors shrink-0 ${
                          alIssued ? "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100" : "border-border"
                        }`}>
                        <Pencil size={12} /> {alIssued ? "Unlock for Amendment" : "Edit"}
                      </button>
                    )}
                  </DialogTitle>
                </DialogHeader>
                {editLocked ? (
                  alIssued ? (
                    <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mt-1">
                      <Lock size={12} className="shrink-0 mt-0.5" />
                      <span>
                        Allotment Letter issued{alIssuedOn ? ` on ${String(alIssuedOn).slice(0, 10)}` : ""} — legal details are formally committed.
                        Any change is a recorded amendment and requires a stated reason.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 -mt-1">
                      <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
                    </div>
                  )
                ) : alIssued ? (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mt-1">
                    <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>Amendment mode</strong> — the Allotment Letter has been issued. Any changes to legal details
                      (name, PAN, Aadhaar, address) will be version-stamped and require a reason.
                      This is recorded in the audit trail.
                    </span>
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
                    <select value={editForm.LegalExecutiveId} disabled={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                      className={editInputCls}>
                      <option value="">— Unassigned —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Legal Name</label>
                      <input type="text" value={editForm.LegalName} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalName: e.target.value }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">PAN No.</label>
                      <input type="text" value={editForm.PanNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, PanNo: e.target.value.toUpperCase() }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Aadhaar No.</label>
                      <input type="text" value={editForm.AadhaarNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, AadhaarNo: e.target.value }))}
                        className={editInputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Legal Address</label>
                    <textarea value={editForm.LegalAddress} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                      rows={2} className={`${editInputCls} resize-none`} />
                  </div>
                  {!editLocked && (
                    <div>
                      <label className={`text-xs block mb-1 ${alIssued ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
                        {alIssued ? <>Amendment Reason <span className="text-red-500">*</span></> : "Reason for this revision"}
                      </label>
                      <input type="text" value={editForm.RevisionReason} onChange={(e) => setEditForm((f) => ({ ...f, RevisionReason: e.target.value }))}
                        placeholder={alIssued ? "Required — e.g. Customer requested name correction (affidavit attached)" : "e.g. Customer requested recheck — corrected spelling"}
                        className={`w-full text-sm border rounded px-2 py-1.5 bg-background ${alIssued ? "border-amber-300 focus:border-amber-500" : "border-border"}`} />
                      {alIssued && <p className="text-[11px] text-amber-600 mt-1">Required when legal details change after Allotment Letter is issued. Saved permanently in version history.</p>}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  {editLocked ? (
                    <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
                  ) : (
                    <>
                      <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                      <button onClick={handleSaveEdit} disabled={saving}
                        className={`px-4 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40 ${
                          alIssued ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}>
                        {saving ? "Saving..." : alIssued ? "Save Amendment" : "Save"}
                      </button>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </CrmShell>
    </>
  );
};

export default CrmAgreement;