import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, FileText, Upload, FileImage, FileSpreadsheet, File as FileIcon, Eye, Send, Clock, UserCircle2, Pencil, Lock, Check, ArrowRight, ShieldAlert, Building2, ScrollText, X, FolderClock, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { promptNextStep } from "@/lib/workflowNav";
import { FinancialStatusBar } from "@/components/crm/FinancialStatusBar";

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
  const senior = a?.SeniorApprovalStatus === "Approved";
  const sent = !!a?.SentToCustomerAt;
  const custApproved = a?.CustomerApprovalStatus === "Approved";
  const dated = !!a?.AgreementDate;
  const executed = a?.Status === "Executed" || a?.Status === "Registered";
  const registered = a?.Status === "Registered";
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
    <div className="flex items-center overflow-x-auto thin-scroll">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            className={`flex items-center gap-1.5 shrink-0 rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/60 transition-colors ${activeTab === s.tab ? "bg-muted/40" : ""}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
              s.state === "done" ? "bg-green-500 text-white"
              : s.state === "current" ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"}`}>
              {s.state === "done" ? <Check size={11} /> : i + 1}
            </span>
            <span className={`text-xs font-medium whitespace-nowrap ${s.state === "upcoming" ? "text-muted-foreground" : ""}`}>{s.label}</span>
          </button>
          {i < steps.length - 1 && (
            <div className={`w-5 sm:w-8 h-px mx-1.5 shrink-0 ${steps[i + 1].state !== "upcoming" ? "bg-green-400" : "bg-border"}`} />
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
    if (status === "Rejected" && !remarks.trim()) { toast.error("Remarks are required to reject"); return; }
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
                    "Awaiting upload from customer — nothing to preview yet."
                  ) : (
                    <>
                      Not yet uploaded — Legal Executive to attach.
                      <input type="file" ref={attachInputRef} className="hidden"
                        onChange={(e) => attachFile(e.target.files)} />
                      <button onClick={() => attachInputRef.current?.click()} disabled={attaching}
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
          {!!doc.FilePath && doc.Status !== "Rejected" && (
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

const CrmAgreement: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const idFilter = sp.get("id") ? parseInt(sp.get("id")!, 10) : null;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(idFilter);
  const [agrDialog, setAgrDialog] = useState(false);
  const [docDialog, setDocDialog] = useState(false);
  const [docRequestDialog, setDocRequestDialog] = useState(false);
  const [sendDialog, setSendDialog] = useState(false);
  const [proposeDateDialog, setProposeDateDialog] = useState(false);
  const [sendDate, setSendDate] = useState("");
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
  useEffect(() => { setAgrTab("Overview"); }, [selectedId]);

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
        promptNextStep(navigate, "Agreement registered — Sales Deed can now be created.", "/crm/sales-deed", "Go to Sales Deed");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
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
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No agreements found</div>
            ) : (filtered as any[]).map((a: any) => (
              <button key={a.Id} onClick={() => setSelectedId(a.Id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === a.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{a.ApplicantName}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${agrStatusColor[a.Status] || ""}`}>{a.Status}</span>
                </div>
                {isBookingCancelled(a) && (
                  <div className="text-[10px] font-semibold text-red-600 mt-0.5">⚠ Booking {a.BookingStatus || "inactive"} — locked</div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">{a.AgreementNo}</div>
                <div className="text-xs text-muted-foreground">{a.BookingNo} · {a.UnitNo}</div>
                <div className="text-xs text-muted-foreground">{a.DocumentCount || 0} document(s)</div>
                <div className="text-xs text-muted-foreground">
                  Legal: {a.LegalExecutiveName ? <span className="text-foreground font-medium">{a.LegalExecutiveName}</span> : <span className="text-amber-600">Unassigned</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto space-y-4">
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
              {detail.agreement?.Status !== "Cancelled" && (
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <AgreementStepper steps={agreementStepStates(detail.agreement, detail.documents)} activeTab={agrTab} onStepClick={setAgrTab} />
                  {(() => {
                    const a = detail.agreement;
                    const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                    const cancelled = isBookingCancelled(a);
                    let text = "";
                    let cta: { label: string; onClick: () => void } | null = null;
                    if (cancelled) {
                      text = `The underlying booking is ${a?.BookingStatus || "inactive"} — this agreement is locked. Cancel it to close it out.`;
                    } else if (a?.Status === "Registered") {
                      text = "Registered — this agreement is fully complete.";
                    } else if (a?.Status === "Executed") {
                      text = "Executed — mark it Registered once the Sales Deed carries a Registration No.";
                    } else if (!a?.LegalExecutiveId) {
                      // Advisory, not a hard block on this step specifically —
                      // Senior Approval doesn't actually require it — but
                      // surfaced first to match its position in the stepper
                      // above and get it assigned early rather than only
                      // being discovered as a blocker at the very last step.
                      text = "Assign a Legal Executive to take ownership of preparing this agreement's paperwork — required before it can be marked executed.";
                    } else if (a?.SeniorApprovalStatus !== "Approved") {
                      text = "Awaiting senior approval — visit the Admin Approval Inbox to approve or reject it.";
                    } else if (!a?.SentToCustomerAt) {
                      text = "Senior-approved — ready to send to the customer for their review.";
                      cta = { label: "Send to Customer Portal", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus === "RecheckRequested") {
                      text = `Customer requested a recheck${a?.LastRecheckRemarks ? `: "${a.LastRecheckRemarks}"` : ""} — address it and resend.`;
                      cta = { label: "Resend After Recheck", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus !== "Approved") {
                      text = "Sent to the customer — awaiting their review and approval.";
                    } else if (!a?.AgreementDate) {
                      if (a?.DateApprovalStatus === "Pending") {
                        text = "Both sides agreed on a date — awaiting super admin sign-off.";
                      } else if (a?.ProposedDateStatus === "PendingCustomerReview") {
                        text = `We proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"} — awaiting the customer's response.`;
                      } else if (a?.ProposedDateStatus === "PendingCompanyReview") {
                        text = `Customer ${a?.ProposedDate ? `proposed ${String(a.ProposedDate).slice(0, 10)}` : "revised the date"} — accept it or propose a different one.`;
                        cta = { label: "Accept Date", onClick: handleAcceptDate };
                      } else {
                        text = "Customer approved — propose an agreement date.";
                        cta = { label: "Propose Agreement Date", onClick: () => { setSendDate(""); setProposeDateDialog(true); } };
                      }
                    } else if (pendingDocs.length) {
                      text = `${pendingDocs.length} mandatory document(s) still need verification before this can be executed: ${pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ")}.`;
                    } else {
                      text = "Everything is ready — mark this agreement executed.";
                      cta = { label: "Mark Executed", onClick: () => handleAgreementAction("mark-executed") };
                    }
                    return (
                      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                        <div className="flex items-start gap-2 text-sm">
                          <ArrowRight size={15} className="text-primary shrink-0 mt-0.5" />
                          <span>{text}</span>
                        </div>
                        {cta && (
                          <button onClick={cta.onClick}
                            className="shrink-0 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
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
              <div className="rounded-xl border border-border p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-lg text-foreground flex items-center gap-1.5"><Building2 size={16} className="text-primary" /> {detail.agreement?.ApplicantName}</h2>
                    <p className="text-xs font-mono text-muted-foreground">
                      {detail.agreement?.AgreementNo}
                      {detail.agreement?.VersionNo > 1 && <span className="ml-1.5 text-violet-600">· v{detail.agreement.VersionNo}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${agrStatusColor[detail.agreement?.Status] || ""}`}>
                      {detail.agreement?.Status}
                    </span>
                    {detail.agreement && isBookingCancelled(detail.agreement) && (
                      <span title={`Booking ${detail.agreement.BookingStatus || "inactive"} — Edit/Send/Mark actions are locked. Cancel the agreement instead.`}
                        className="text-xs px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-medium cursor-help">
                        ⚠ Booking {detail.agreement.BookingStatus || "Inactive"}
                      </span>
                    )}
                    {detail.agreement?.Status === "Draft" && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot edit" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                          Edit Details
                        </span>
                      ) : (
                        <button onClick={openEdit}
                          className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                          Edit Details
                        </button>
                      )
                    )}
                    {detail.agreement?.Status === "Draft" && (() => {
                      const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                      if (isBookingCancelled(detail.agreement)) {
                        return (
                          <span title="Booking is cancelled — cannot mark executed" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                            Mark Executed
                          </span>
                        );
                      }
                      const approvalsReady = detail.agreement?.SeniorApprovalStatus === "Approved"
                        && detail.agreement?.CustomerApprovalStatus === "Approved"
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
                    {detail.agreement?.Status === "Executed" && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot mark registered" className="text-xs px-2 py-0.5 border border-dashed border-border rounded-full text-muted-foreground/40 cursor-not-allowed">
                          Mark Registered
                        </span>
                      ) : (
                        <button onClick={() => handleAgreementAction("mark-registered")}
                          className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                          Mark Registered
                        </button>
                      )
                    )}
                    {(detail.agreement?.Status === "Draft" || detail.agreement?.Status === "Executed") && (
                      <button onClick={() => { if (window.confirm("Cancel this agreement?")) handleAgreementAction("cancel"); }}
                        className="text-xs px-2 py-0.5 border border-border rounded-full text-red-600 hover:bg-red-50">
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
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ["Booking No",    detail.agreement?.BookingNo],
                    ["Unit",          detail.agreement?.UnitNo],
                    ["Project",       detail.agreement?.ProjectName || "—"],
                    ["Agreement Date",detail.agreement?.AgreementDate ? String(detail.agreement.AgreementDate).slice(0, 10) : "—"],
                    ["Legal Name",    detail.agreement?.LegalName || "—"],
                    ["PAN",           detail.agreement?.PanNo || "—"],
                    ["Aadhaar",       detail.agreement?.AadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-xs text-muted-foreground">{k}: </span><span className="font-medium">{v}</span></div>
                  ))}
                  {/* GrandTotal (GST-inclusive), not the raw pre-GST TotalValue
                      — every other financial surface in the CRM (Booking
                      list, Booking Detail, Invoices) shows the GST-inclusive
                      figure as the real total, so this page showing the bare
                      base value was a genuine inconsistency, not just a
                      display choice. The breakdown line lists every real
                      component GrandTotal is actually built from (Unit + its
                      GST, Parking as a tax-inclusive lump since Parking's own
                      GST is baked into ParkingTotal rather than split out as
                      its own column, Extra Work if any) — a plain "Base +
                      GST" summary silently dropped Parking/Extra Work, which
                      made the numbers not add up to GrandTotal at all. */}
                  <div>
                    <span className="text-xs text-muted-foreground">Total Value (incl. GST): </span>
                    <span className="font-medium">
                      {detail.agreement?.GrandTotal ? `₹${Number(detail.agreement.GrandTotal).toLocaleString("en-IN")}` : "—"}
                    </span>
                    {detail.agreement?.GrandTotal > 0 && (
                      <span className="text-[11px] text-muted-foreground block">
                        Unit ₹{Number(detail.agreement.TotalValue).toLocaleString("en-IN")}
                        {detail.agreement?.UnitGstAmount > 0 && ` + Unit GST ₹${Number(detail.agreement.UnitGstAmount).toLocaleString("en-IN")}`}
                        {detail.agreement?.ParkingTotal > 0 && ` + Parking ₹${Number(detail.agreement.ParkingTotal).toLocaleString("en-IN")}${detail.agreement?.ParkingGstAmount > 0 ? ` (incl. GST ₹${Number(detail.agreement.ParkingGstAmount).toLocaleString("en-IN")})` : ""}`}
                        {detail.agreement?.ExtraChargesTotal > 0 && ` + Extra Work ₹${Number(detail.agreement.ExtraChargesTotal).toLocaleString("en-IN")}${detail.agreement?.ExtraWorkGstAmount > 0 ? ` (incl. GST ₹${Number(detail.agreement.ExtraWorkGstAmount).toLocaleString("en-IN")})` : ""}`}
                      </span>
                    )}
                  </div>
                </div>
                {detail?.financialSummary && (() => {
                  const ag = detail.agreement;
                  const storedGrand = Number(ag?.GrandTotal ?? 0);
                  const grandTotal = storedGrand > 0 ? storedGrand : (Number(ag?.TotalValue || 0) + Number(ag?.UnitGstAmount || 0) + Number(ag?.ParkingTotal || 0) + Number(ag?.ExtraChargesTotal || 0));
                  return (
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={Number(detail.financialSummary.cleared || 0)}
                    pendingReceipts={Number(detail.financialSummary.mrOnAccount || 0)}
                    approvedOnAccount={Number(detail.financialSummary.approvedOnAccount || 0)}
                    compact
                  />
                  );
                })()}
                {revisions.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Version History (prior to v{detail.agreement?.VersionNo})</div>
                    <div className="space-y-1.5">
                      {(revisions as any[]).map((r) => (
                        <div key={r.Id} className="rounded-lg border border-border p-2">
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
                {detail.agreement?.LegalAddress && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{detail.agreement.LegalAddress}</div>
                )}
              </div>
              )}

              {agrTab === "Legal & Approval" && (
              <div className="space-y-4">
              <div className="rounded-xl border border-border p-4 space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><UserCircle2 size={15} className="text-primary" /> Legal Executive</h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Responsible for preparing this agreement's paperwork: </span>
                  {["Registered", "Cancelled"].includes(detail.agreement?.Status) || isBookingCancelled(detail.agreement) ? (
                    <span className="font-medium">
                      {detail.agreement?.LegalExecutiveName || <span className="text-amber-600">Unassigned</span>}
                    </span>
                  ) : (
                    <select
                      value={detail.agreement?.LegalExecutiveId ? String(detail.agreement.LegalExecutiveId) : ""}
                      disabled={assigningLegal}
                      onChange={(e) => handleAssignLegal(e.target.value)}
                      className={`text-sm border rounded px-1.5 py-0.5 bg-background disabled:opacity-40 ${
                        detail.agreement?.LegalExecutiveId ? "border-border" : "border-amber-300 text-amber-600"}`}>
                      <option value="">— Unassigned —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  )}
                </div>
                {!detail.agreement?.LegalExecutiveId && !["Registered", "Cancelled"].includes(detail.agreement?.Status) && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    No Legal Executive assigned yet — this is required before the agreement can be marked executed (server-enforced, not just a reminder). Assign someone above once it's clear who's preparing the paperwork.
                  </div>
                )}
              </div>

              {/* Approval Workflow */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><ShieldAlert size={15} className="text-primary" /> Approval Workflow</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Senior Approval</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      detail.agreement?.SeniorApprovalStatus === "Approved" ? "text-green-600 bg-green-50 border-green-200"
                      : detail.agreement?.SeniorApprovalStatus === "Rejected" ? "text-red-600 bg-red-50 border-red-200"
                      : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                      {detail.agreement?.SeniorApprovalStatus || "Pending"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Customer Approval</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      detail.agreement?.CustomerApprovalStatus === "Approved" ? "text-green-600 bg-green-50 border-green-200"
                      : detail.agreement?.CustomerApprovalStatus === "RecheckRequested" ? "text-red-600 bg-red-50 border-red-200"
                      : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                      {detail.agreement?.CustomerApprovalStatus || "Pending"}
                    </span>
                  </div>
                </div>
                {(detail.agreement?.ProposedDate || detail.agreement?.AgreementDate) && (
                  <div className="flex flex-wrap gap-1.5">
                    <DateStatusBadge
                      label={
                        detail.agreement?.AgreementDate ? "Agreed by Both"
                        : detail.agreement?.ProposedDateStatus === "Matched" ? "Matched"
                        : detail.agreement?.ProposedDateStatus === "PendingCustomerReview" ? "Proposed by Company — awaiting Customer"
                        : detail.agreement?.ProposedDateStatus === "PendingCompanyReview" ? "Proposed by Customer — awaiting Company"
                        : "Proposed"
                      }
                      date={detail.agreement?.AgreementDate || detail.agreement?.ProposedDate}
                      color={detail.agreement?.AgreementDate ? "green" : detail.agreement?.ProposedDateStatus === "PendingCompanyReview" ? "blue" : "purple"}
                      active
                    />
                  </div>
                )}
                {!detail.agreement?.AgreementDate && detail.agreement?.ProposedDateStatus === "Matched" && (
                  <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                    Both sides agree on this date — awaiting super admin sign-off before it's confirmed.
                  </div>
                )}
                {dateHistory.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Reschedule History</div>
                    <div className="space-y-1">
                      {(dateHistory as any[]).map((h) => (
                        <div key={h.Id} className="flex items-center gap-2 text-muted-foreground">
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${h.ProposedBy === "Company" ? "text-purple-600 bg-purple-50 border-purple-200" : "text-blue-600 bg-blue-50 border-blue-200"}`}>
                            {h.ProposedBy}
                          </span>
                          <span>proposed {String(h.ProposedDate).slice(0,10)}</span>
                          <span className="text-[10px]">({String(h.CreatedAt).slice(0,16).replace("T"," ")}{h.CreatedByName ? ` · ${h.CreatedByName}` : ""})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.agreement?.RecheckCount > 0 && (
                  <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                    Rechecked {detail.agreement.RecheckCount}x — latest remark: {detail.agreement.LastRecheckRemarks || "—"}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap items-center">
                  {/* submitOnly: senior Approve/Reject only ever happen from the
                      Admin Approval Inbox (admin/super_admin/dba) — no self-approve here */}
                  <ApprovalActions
                    status={detail.agreement?.SeniorApprovalStatus}
                    recordId={detail.agreement?.Id}
                    endpoint={API}
                    submitOnly
                    onSuccess={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                    }}
                  />
                  {detail.agreement?.SeniorApprovalStatus === "Pending" && (
                    <span className="text-xs text-muted-foreground">Pending admin approval</span>
                  )}
                  {detail.agreement?.SeniorApprovalStatus === "Approved" && !detail.agreement?.SentToCustomerAt && (
                    isBookingCancelled(detail.agreement) ? (
                      <span title="Booking is cancelled — cannot send to customer" className="text-xs px-3 py-1.5 border border-dashed border-border rounded-lg text-muted-foreground/40 cursor-not-allowed">
                        Send to Customer Portal
                      </span>
                    ) : (
                      <button onClick={() => { setSendDate(detail.agreement?.ProposedDate ? String(detail.agreement.ProposedDate).slice(0, 10) : ""); setSendDialog(true); }}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                        Send to Customer Portal
                      </button>
                    )
                  )}
                  {detail.agreement?.CustomerApprovalStatus === "RecheckRequested" && detail.agreement?.SeniorApprovalStatus === "Approved" && (
                    isBookingCancelled(detail.agreement) ? (
                      <span title="Booking is cancelled — cannot resend" className="text-xs px-3 py-1.5 border border-dashed border-border rounded-lg text-muted-foreground/40 cursor-not-allowed">
                        Resend After Recheck
                      </span>
                    ) : (
                      <button onClick={() => { setSendDate(detail.agreement?.ProposedDate ? String(detail.agreement.ProposedDate).slice(0, 10) : ""); setSendDialog(true); }}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                        Resend After Recheck
                      </button>
                    )
                  )}
                  {/* Date negotiation is the step AFTER both ends approve the
                      agreement's content (spec: "...CUSTOMER APPROVAL ->
                      APPROVAL FROM BOTH END -> DATE OF AGREEMENT..."), so
                      this shows once CustomerApprovalStatus is Approved —
                      not "Pending", which is the state *before* that.
                      Turn-based: company can act (Accept or Revise) only
                      when ProposedDateStatus shows it's waiting on them
                      ('PendingCompanyReview') or nothing's been proposed
                      yet; while waiting on the customer, no button shows. */}
                  {detail.agreement?.SentToCustomerAt && detail.agreement?.CustomerApprovalStatus === "Approved" && !detail.agreement?.AgreementDate && (
                    detail.agreement?.DateApprovalStatus === "Pending" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-amber-600 bg-amber-50 border-amber-200">
                        Awaiting Super Admin Approval
                      </span>
                    ) : detail.agreement?.ProposedDateStatus === "PendingCustomerReview" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40 border-border">
                        Awaiting customer's response
                      </span>
                    ) : isBookingCancelled(detail.agreement) ? (
                      <span title="Booking is cancelled — cannot act on a date" className="text-xs px-3 py-1.5 border border-dashed border-border rounded-lg text-muted-foreground/40 cursor-not-allowed">
                        {detail.agreement?.ProposedDateStatus === "PendingCompanyReview" ? "Accept Date" : "Propose Agreement Date"}
                      </span>
                    ) : detail.agreement?.ProposedDateStatus === "PendingCompanyReview" ? (
                      <>
                        <button onClick={handleAcceptDate} disabled={saving}
                          className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                          Accept Date
                        </button>
                        <button onClick={() => { setSendDate(detail.agreement?.ProposedDate ? String(detail.agreement.ProposedDate).slice(0, 10) : ""); setProposeDateDialog(true); }}
                          className="text-xs px-3 py-1.5 border border-border rounded-lg font-medium hover:bg-muted">
                          Propose a Different Date
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { setSendDate(""); setProposeDateDialog(true); }}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                        Propose Agreement Date
                      </button>
                    )
                  )}
                  {detail.agreement?.SentToCustomerAt && (
                    <span className="text-xs text-muted-foreground">
                      Sent to customer {String(detail.agreement.SentToCustomerAt).slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                </div>
              </div>
              </div>
              )}

              {agrTab === "Documents" && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
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
                  return (
                    <div key={d.Id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-3">
                      <button
                        onClick={() => setPreviewDoc(d)}
                        className="flex items-center gap-3 text-left min-w-0"
                      >
                        {awaitingUpload ? <Clock size={16} className="text-amber-500 shrink-0" /> : mimeIcon(d.MimeType)}
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-1.5">
                            {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                            {d.IsMandatory ? <span className="text-red-500">*</span> : null}
                            {d.VersionNo > 1 && <span className="text-xs text-violet-600 font-normal">v{d.VersionNo}</span>}
                            {d.UploadedByType === "Customer" && (
                              <span className="flex items-center gap-0.5 text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded-full px-1.5 py-0 font-normal">
                                <UserCircle2 size={10} /> customer
                              </span>
                            )}
                            {(d.FilePath || d.DocumentUrl) && <Eye size={12} className="text-muted-foreground" />}
                          </div>
                          {awaitingCustomer ? (
                            <div className="text-xs text-amber-600">Awaiting upload from customer{d.RequestedAt ? ` · requested ${String(d.RequestedAt).slice(0, 10)}` : ""}</div>
                          ) : awaitingStaff ? (
                            <div className="text-xs text-amber-600">Not yet uploaded — Legal Executive to attach{d.RequestedAt ? ` · requested ${String(d.RequestedAt).slice(0, 10)}` : ""}</div>
                          ) : (
                            <>
                              {d.FileName && <div className="text-xs text-muted-foreground truncate max-w-xs">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</div>}
                              {d.IssuedBy && <div className="text-xs text-muted-foreground">by {d.IssuedBy}</div>}
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${docStatusColor[d.Status] || ""}`}>{d.Status}</span>
                        {!!d.FilePath && d.Status !== "Verified" && (
                          <button title="Quick verify" onClick={() => handleDocStatusChange(d.Id, "Verified")}
                            className="p-1 rounded hover:bg-green-100 text-green-600"><Check size={14} /></button>
                        )}
                        {!!d.FilePath && d.Status !== "Rejected" && (
                          <button title="Reject (opens review — a reason is required)" onClick={() => setPreviewDoc(d)}
                            className="p-1 rounded hover:bg-red-100 text-red-600"><X size={14} /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
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
          History (see backend PUT /:id) rather than silently overwriting them. */}
      <Dialog open={editDialog} onOpenChange={(o) => { if (!o) { setEditDialog(false); setEditLocked(true); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span>Edit Agreement Details</span>
              {editLocked && (
                <button onClick={() => setEditLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                  <Pencil size={12} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {editLocked && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 -mt-1">
              <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
            </div>
          )}
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
                <label className="text-xs text-muted-foreground block mb-1">Reason for this revision</label>
                <input type="text" value={editForm.RevisionReason} onChange={(e) => setEditForm((f) => ({ ...f, RevisionReason: e.target.value }))}
                  placeholder="e.g. Customer requested recheck — corrected spelling"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
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
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmAgreement;