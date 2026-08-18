import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Search, FileText, FileImage, FileSpreadsheet, File as FileIcon, Eye,
  Clock, XCircle, ArrowUpRight, Download, Check, X, ChevronDown, ChevronRight,
  AlertTriangle, ListChecks, LayoutList, FolderClock, RotateCcw, Upload,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// The Agreement Papers register — a cross-agreement, documents-only view
// scoped to the crm-documents permission (distinct from full crm-agreements
// CRUD rights, e.g. for a documents clerk who reviews submissions but
// shouldn't be able to edit agreement terms). The full per-agreement
// upload/request flow still lives on the Agreements page; this page is for
// scanning and clearing everything that needs review across every
// agreement at once, instead of opening each one individually — so the
// real jobs-to-be-done here are: see what's waiting, triage the oldest/most
// urgent first, review in bulk, and know who touched a document before.
const API = "/api/crm/agreements";

const STATUSES = ["Requested", "Submitted", "Uploaded", "Verified", "Rejected", "Pending"];
const DOC_TYPES = ["SaleAgreement", "AllotmentLetter", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];
const REVIEW_STATUSES = ["Submitted", "Uploaded"]; // has a file, awaiting a decision
const SORTS = [
  { value: "priority", label: "Needs review first" },
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
];

const statusColor: Record<string, string> = {
  Requested: "text-amber-600 bg-amber-50 border-amber-200",
  Submitted: "text-blue-600 bg-blue-50 border-blue-200",
  Uploaded:  "text-blue-600 bg-blue-50 border-blue-200",
  Verified:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
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
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}
function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return String(v).replace("T", " ").slice(0, 16);
}
// Days since a document last moved (uploaded/requested/created) — the
// signal that actually matters for triage: a doc sitting Requested for 9
// days with no upload, or Submitted for 4 days with no review, is the one
// staff need to chase, not just whatever's newest in the list.
function ageDays(d: any): number {
  const ref = d.UploadedAt || d.RequestedAt || d.CreatedAt;
  if (!ref) return 0;
  const ms = Date.now() - new Date(ref).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
// Mirrors CrmAgreement.tsx's agreementStepStates — same five real gates
// (senior approval -> sent -> customer approval -> date agreed -> executed
// -> registered), reduced to short labels since this renders once per
// agreement group in a dense register rather than as the page's centerpiece.
const MINI_STEPS = ["Prepared", "Senior", "Sent", "Cust. Approval", "Dated", "Executed", "Registered"];
function miniStepStates(docs: any[]): { label: string; done: boolean; current: boolean }[] {
  const a = docs[0] || {};
  const senior = a.SeniorApprovalStatus === "Approved";
  const sent = !!a.SentToCustomerAt;
  const custApproved = a.CustomerApprovalStatus === "Approved";
  const dated = !!a.AgreementDate;
  const executed = a.AgreementStatus === "Executed" || a.AgreementStatus === "Registered";
  const registered = a.AgreementStatus === "Registered";
  const flags = [true, senior, sent, custApproved, dated, executed, registered];
  return MINI_STEPS.map((label, i) => ({
    label, done: flags[i],
    current: !flags[i] && (i === 0 || flags[i - 1]),
  }));
}
function MiniStepper({ docs }: { docs: any[] }) {
  const steps = miniStepStates(docs);
  return (
    <div className="flex items-center gap-1 shrink-0">
      {steps.map((s, i) => (
        <span key={s.label} title={s.label}
          className={`w-2 h-2 rounded-full ${s.done ? "bg-green-500" : s.current ? "bg-primary" : "bg-muted"}`} />
      ))}
    </div>
  );
}

function AgeBadge({ days, awaitingUpload }: { days: number; awaitingUpload: boolean }) {
  if (days < 3) return null;
  const overdue = days >= (awaitingUpload ? 5 : 3);
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex items-center gap-1 shrink-0 ${
      overdue ? "text-red-600 bg-red-50 border-red-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>
      <AlertTriangle size={10} /> {days}d {awaitingUpload ? "unuploaded" : "pending"}
    </span>
  );
}

async function fetchAllDocuments(status: string, documentType: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (documentType) params.set("documentType", documentType);
  const qs = params.toString();
  const r = await fetchWithAuth(`${API}/documents/all${qs ? `?${qs}` : ""}`);
  if (!r.ok) return [];
  return r.json();
}
async function fetchDocAudit(docId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${API}/documents/${docId}/audit`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

function ReviewDialog({ doc, onClose, onReviewed }: { doc: any; onClose: () => void; onReviewed: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [remarks, setRemarks] = useState(doc.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [audit, setAudit] = useState<any[] | null>(null);
  const [attaching, setAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const attachFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setAttaching(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithAuth(`${API}/${doc.AgreementId}/documents/${doc.Id}/attach`, { method: "POST", body: formData });
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
    if (tab === "history" && audit === null) {
      fetchDocAudit(doc.Id).then(setAudit);
    }
  }, [tab, audit, doc.Id]);

  const setStatus = async (status: string) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${doc.AgreementId}/documents/${doc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Remarks: remarks || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update");
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
          </DialogTitle>
          <DialogDescription>
            {doc.AgreementNo} · {doc.ApplicantName} · {doc.BookingNo}
          </DialogDescription>
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
              {!doc.FilePath ? (
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
                <span>{doc.FileName} {doc.FileSize ? `· ${fmtBytes(doc.FileSize)}` : ""}</span>
                {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline flex items-center gap-1"><Download size={12} /> Download</a>}
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks {doc.Status !== "Verified" ? "(required to reject)" : ""}</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
                placeholder="Reason for rejection, or any note for the record..."
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
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
                      <span className="font-medium">{h.Field}</span>
                      {": "}
                      <span className="text-muted-foreground">{h.OldValue || "—"}</span>
                      {" → "}
                      <span className={`font-medium ${statusColor[h.NewValue] ? statusColor[h.NewValue].split(" ")[0] : ""}`}>{h.NewValue || "—"}</span>
                    </div>
                    <div className="text-right text-muted-foreground shrink-0">
                      <div>{h.ChangedByName || "System"}</div>
                      <div>{fmtDateTime(h.ChangedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <button onClick={() => navigate(`/crm/agreements?id=${doc.AgreementId}`)}
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            Open in Agreements <ArrowUpRight size={12} />
          </button>
          <div className="flex gap-2">
            {!!doc.FilePath && doc.Status !== "Verified" && (
              <button onClick={() => setStatus("Verified")} disabled={saving}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40">Verify</button>
            )}
            {!!doc.FilePath && doc.Status !== "Rejected" && (
              <button onClick={() => { if (!remarks.trim()) { toast.error("Remarks are required to reject"); return; } setStatus("Rejected"); }}
                disabled={saving} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">Reject</button>
            )}
            {!!doc.FilePath && (doc.Status === "Verified" || doc.Status === "Rejected") && (
              <button onClick={() => setStatus("Submitted")} disabled={saving}
                className="px-3 py-1.5 text-xs border border-amber-300 text-amber-600 rounded-lg font-medium hover:bg-amber-50 disabled:opacity-40">
                Revert to Review
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Compact prompt for a bulk reject — collected once, applied to every
// selected document, since typing the same rejection reason 15 times would
// defeat the point of selecting them together.
function BulkRejectDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: (remarks: string) => void }) {
  const [remarks, setRemarks] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading">Reject {count} document{count === 1 ? "" : "s"}</DialogTitle></DialogHeader>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Remarks (required, applied to all selected)</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} autoFocus
            placeholder="Reason for rejection..."
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={() => { if (!remarks.trim()) { toast.error("Remarks are required"); return; } onConfirm(remarks); }}
            className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700">Reject All</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function exportCsv(rows: any[]) {
  const cols = ["AgreementNo", "ApplicantName", "BookingNo", "UnitNo", "DocumentType", "Label", "Status", "IsMandatory", "UploadedAt", "RequestedAt", "FileName"];
  const lines = [cols.join(",")];
  for (const d of rows) {
    lines.push(cols.map((c) => {
      const v = d[c] ?? "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `agreement-papers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const CrmAgreementPapers: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [sort, setSort] = useState("priority");
  const [grouped, setGrouped] = useState(true);
  const [reviewDoc, setReviewDoc] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: documents = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-agreement-papers", status, documentType],
    queryFn: () => fetchAllDocuments(status, documentType),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => (documents as any[]).filter((d) =>
    !search || d.ApplicantName?.toLowerCase().includes(search.toLowerCase())
      || d.AgreementNo?.toLowerCase().includes(search.toLowerCase())
      || d.BookingNo?.toLowerCase().includes(search.toLowerCase())
  ), [documents, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "priority") {
      // Needs-review (has file, undecided) first, then awaiting-upload,
      // then everything else — each bucket ordered oldest-first so the
      // thing that's been sitting longest surfaces at the top of its bucket.
      const bucket = (d: any) => (REVIEW_STATUSES.includes(d.Status) ? 0 : d.Status === "Requested" && !d.FilePath ? 1 : 2);
      arr.sort((a, b) => bucket(a) - bucket(b) || ageDays(b) - ageDays(a));
    } else if (sort === "oldest") {
      arr.sort((a, b) => ageDays(b) - ageDays(a));
    } else {
      arr.sort((a, b) => ageDays(a) - ageDays(b));
    }
    return arr;
  }, [filtered, sort]);

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = (documents as any[]).filter((d) => d.Status === s).length;
    return acc;
  }, {} as Record<string, number>);
  const needsReviewCount = (documents as any[]).filter((d) => REVIEW_STATUSES.includes(d.Status)).length;
  const overdueCount = (documents as any[]).filter((d) => {
    const days = ageDays(d);
    const awaitingUpload = d.Status === "Requested" && !d.FilePath;
    return days >= (awaitingUpload ? 5 : 3) && d.Status !== "Verified" && d.Status !== "Rejected";
  }).length;

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const d of sorted) {
      const key = d.AgreementNo || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries());
  }, [sorted]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectableIds = useMemo(() => sorted.filter((d) => d.FilePath && d.Status !== "Verified").map((d) => d.Id), [sorted]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const runBulk = async (docIds: number[], newStatus: string, remarks?: string) => {
    setBulkBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/documents/bulk-review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docIds, status: newStatus, remarks: remarks || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk review failed");
      if (data.succeeded?.length) toast.success(`${data.succeeded.length} document(s) marked ${newStatus}`);
      if (data.skipped?.length) toast.error(`${data.skipped.length} skipped — ${data.skipped[0].reason}${data.skipped.length > 1 ? " (+ more)" : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["crm-agreement-papers"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBulkBusy(false);
      setBulkRejectOpen(false);
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // A Verified/Rejected document reachable from either terminal state back
  // to Submitted — a mis-click during a bulk pass shouldn't require going
  // through the full Agreements page to correct. Uses the same single-doc
  // PUT the review dialog itself uses, just with the prior in-review status.
  const revertToReview = async (d: any) => {
    try {
      const res = await fetchWithAuth(`${API}/${d.AgreementId}/documents/${d.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: "Submitted", Remarks: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to revert");
      toast.success("Reverted to Submitted for re-review");
      qc.invalidateQueries({ queryKey: ["crm-agreement-papers"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const renderRow = (d: any) => {
    const awaiting = d.Status === "Requested" && !d.FilePath;
    const canQuickReview = !!d.FilePath && d.Status !== "Verified";
    const canRevert = !!d.FilePath && (d.Status === "Verified" || d.Status === "Rejected");
    const days = ageDays(d);
    return (
      <div key={d.Id}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/20">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {canQuickReview && (
            <input type="checkbox" checked={selected.has(d.Id)} onChange={() => toggleSelect(d.Id)}
              onClick={(e) => e.stopPropagation()} className="shrink-0 accent-primary" />
          )}
          <button onClick={() => setReviewDoc(d)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
            {awaiting ? <Clock size={16} className="text-amber-500 shrink-0" />
              : d.Status === "Rejected" ? <XCircle size={16} className="text-red-500 shrink-0" />
              : mimeIcon(d.MimeType)}
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-1.5">
                {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                {d.IsMandatory ? <span className="text-red-500">*</span> : null}
                {d.UploadedByType === "Customer" && <span className="text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded-full px-1.5 font-normal">customer</span>}
              </div>
              <div className="text-xs text-muted-foreground truncate max-w-md">
                {d.AgreementNo} · {d.ApplicantName} · {d.BookingNo} · {d.UnitNo}
              </div>
            </div>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AgeBadge days={days} awaitingUpload={awaiting} />
          <span className="text-[11px] text-muted-foreground hidden sm:inline">{fmtDate(d.UploadedAt || d.RequestedAt || d.CreatedAt)}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusColor[d.Status] || ""}`}>{d.Status}</span>
          {canQuickReview && (
            <>
              <button title="Quick verify" onClick={() => runBulk([d.Id], "Verified")} disabled={bulkBusy}
                className="p-1 rounded hover:bg-green-100 text-green-600 disabled:opacity-40"><Check size={14} /></button>
              <button title="Reject" onClick={() => { setSelected(new Set([d.Id])); setBulkRejectOpen(true); }} disabled={bulkBusy}
                className="p-1 rounded hover:bg-red-100 text-red-600 disabled:opacity-40"><X size={14} /></button>
            </>
          )}
          {canRevert && (
            <button title="Revert to Submitted for re-review" onClick={() => revertToReview(d)}
              className="p-1 rounded hover:bg-amber-100 text-amber-600"><RotateCcw size={14} /></button>
          )}
          <button title="Open" onClick={() => setReviewDoc(d)} className="p-1 rounded hover:bg-muted text-muted-foreground"><Eye size={14} /></button>
        </div>
      </div>
    );
  };

  return (
    <CrmShell title="CRM — Agreement Papers" subtitle="Every agreement document, across every booking, in one register"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-4">
        {/* Stats bar — doubles as quick filters onto the status dropdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button onClick={() => setStatus("")}
            className={`text-left rounded-xl border px-3 py-2 ${!status ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
            <div className="text-lg font-bold">{(documents as any[]).length}</div>
            <div className="text-[11px] text-muted-foreground">All documents</div>
          </button>
          <button onClick={() => setStatus(status === "Submitted" ? "" : "Submitted")}
            className={`text-left rounded-xl border px-3 py-2 ${status === "Submitted" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
            <div className="text-lg font-bold text-blue-600">{needsReviewCount}</div>
            <div className="text-[11px] text-muted-foreground">Needs review</div>
          </button>
          <button onClick={() => setStatus(status === "Requested" ? "" : "Requested")}
            className={`text-left rounded-xl border px-3 py-2 ${status === "Requested" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
            <div className="text-lg font-bold text-amber-600">{counts.Requested || 0}</div>
            <div className="text-[11px] text-muted-foreground">Awaiting upload</div>
          </button>
          <div className="text-left rounded-xl border border-border px-3 py-2">
            <div className="text-lg font-bold text-red-600 flex items-center gap-1">{overdueCount}{overdueCount > 0 && <AlertTriangle size={14} />}</div>
            <div className="text-[11px] text-muted-foreground">Overdue</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applicant, agreement no, booking no..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="text-sm border border-border rounded-lg px-2 py-2 bg-background">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s} {counts[s] ? `(${counts[s]})` : ""}</option>)}
          </select>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}
            className="text-sm border border-border rounded-lg px-2 py-2 bg-background">
            <option value="">All Document Types</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/([A-Z])/g, " $1").trim()}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="text-sm border border-border rounded-lg px-2 py-2 bg-background">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => setGrouped((g) => !g)} title={grouped ? "Switch to flat list" : "Group by agreement"}
            className="flex items-center gap-1.5 text-sm border border-border rounded-lg px-2.5 py-2 hover:bg-muted">
            {grouped ? <ListChecks size={14} /> : <LayoutList size={14} />}
            <span className="hidden sm:inline">{grouped ? "Grouped" : "Flat"}</span>
          </button>
          <button onClick={() => exportCsv(sorted)} title="Export current view to CSV"
            className="flex items-center gap-1.5 text-sm border border-border rounded-lg px-2.5 py-2 hover:bg-muted">
            <Download size={14} /> <span className="hidden sm:inline">Export</span>
          </button>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/30 rounded-lg px-4 py-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <button onClick={() => runBulk(Array.from(selected), "Verified")} disabled={bulkBusy}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40">
                Verify Selected
              </button>
              <button onClick={() => setBulkRejectOpen(true)} disabled={bulkBusy}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">
                Reject Selected
              </button>
              <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted">
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : sorted.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No documents match this filter</div>
          ) : !grouped ? (
            <>
              {selectableIds.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/10 text-xs text-muted-foreground">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-primary" />
                  Select all reviewable ({selectableIds.length})
                </div>
              )}
              {sorted.map(renderRow)}
            </>
          ) : (
            groups.map(([agreementNo, docs]) => {
              const isCollapsed = collapsed.has(agreementNo);
              const groupNeedsReview = docs.some((d) => REVIEW_STATUSES.includes(d.Status));
              return (
                <div key={agreementNo} className="border-b border-border last:border-0">
                  <button onClick={() => toggleGroup(agreementNo)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/10 hover:bg-muted/20 text-left">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                      <span className="text-sm font-semibold">{agreementNo}</span>
                      <span className="text-xs text-muted-foreground truncate">{docs[0]?.ApplicantName} · {docs[0]?.BookingNo}</span>
                      <MiniStepper docs={docs} />
                      {docs[0]?.LegalExecutiveName ? (
                        <span className="text-[10px] text-muted-foreground border border-border rounded-full px-1.5 py-0.5">Legal: {docs[0].LegalExecutiveName}</span>
                      ) : (
                        <span title="Open the agreement to assign a legal executive"
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border text-amber-600 bg-amber-50 border-amber-200">
                          Legal: Unassigned
                        </span>
                      )}
                      {groupNeedsReview && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border text-blue-600 bg-blue-50 border-blue-200">needs review</span>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{docs.length} doc{docs.length === 1 ? "" : "s"}</span>
                  </button>
                  {!isCollapsed && docs.map(renderRow)}
                </div>
              );
            })
          )}
        </div>
      </div>

      {reviewDoc && (
        <ReviewDialog
          doc={reviewDoc}
          onClose={() => setReviewDoc(null)}
          onReviewed={() => { setReviewDoc(null); refetch(); }}
        />
      )}

      {bulkRejectOpen && (
        <BulkRejectDialog
          count={selected.size}
          onCancel={() => setBulkRejectOpen(false)}
          onConfirm={(remarks) => runBulk(Array.from(selected), "Rejected", remarks)}
        />
      )}
    </CrmShell>
  );
};

export default CrmAgreementPapers;