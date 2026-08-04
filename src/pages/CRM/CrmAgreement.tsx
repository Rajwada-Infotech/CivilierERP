import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, FileText, Upload, FileImage, FileSpreadsheet, File as FileIcon, Eye, Send, Clock, UserCircle2, Pencil, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { promptNextStep } from "@/lib/workflowNav";

const API = "/api/crm/agreements";
const SA_LEADS_API = "/api/sa/leads";

const DOC_TYPES = ["SaleAgreement", "AllotmentLetter", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];
const DOC_STATUSES = ["Pending", "Requested", "Uploaded", "Submitted", "Verified", "Rejected"];

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

async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
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

// Preview dialog for a single uploaded agreement document.
const DocPreviewDialog: React.FC<{ doc: any; onClose: () => void }> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    fetchWithAuth(`${API}/documents/file/${doc.Id}`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => setBlobUrl(null));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            {mimeIcon(doc.MimeType)} {doc.FileName || doc.DocumentType}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/30 rounded-lg overflow-hidden">
          {!blobUrl ? (
            <span className="text-sm text-muted-foreground">Loading preview…</span>
          ) : doc.MimeType?.startsWith("image/") ? (
            <img src={blobUrl} alt={doc.FileName} className="max-w-full max-h-[60vh] object-contain" />
          ) : doc.MimeType === "application/pdf" ? (
            <iframe src={blobUrl} title={doc.FileName} className="w-full h-[60vh] border-0" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-sm">
              {mimeIcon(doc.MimeType)}
              Preview not available for this file type.
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
          <span>{fmtBytes(doc.FileSize)}</span>
          {blobUrl && <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline">Download</a>}
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

  const { data: agreements = [], isLoading } = useQuery({ queryKey: ["crm-agreements"], queryFn: fetchAgreements, staleTime: 60_000 });
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
      if (data.portal?.error) {
        toast.warning(`Agreement created, but customer portal login could not be provisioned: ${data.portal.error}`, { duration: 8000 });
      }
      setAgrDialog(false);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(e.message);
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
      toast.error(e.message);
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
      toast.error(e.message);
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
      toast.error(e.message);
    } finally {
      setUploadingDocs(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  const handleDocStatusChange = async (docId: number, status: string) => {
    if (!selectedId) return;
    try {
      await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(e.message);
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
      toast.success(data.agreementDateSubmittedForApproval
        ? "Agreement sent — both sides now agree on a date, awaiting super admin approval"
        : "Agreement sent to customer portal");
      setSendDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(e.message);
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
      toast.success(data.agreementDateSubmittedForApproval
        ? "Both sides now agree — sent for super admin approval"
        : "Proposed date sent to customer");
      setProposeDateDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(e.message);
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
      }
    } catch (e: any) {
      toast.error(e.message);
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
      toast.error(e.message);
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

  const handleSaveEdit = async () => {
    if (!selectedId) return;
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
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Agreements"
      subtitle="Sale agreements and legal documents"
      action={
        <button onClick={() => setAgrDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Agreement
        </button>
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
              {/* Agreement Info */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-foreground">{detail.agreement?.ApplicantName}</h2>
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ["Booking No",    detail.agreement?.BookingNo],
                    ["Unit",          detail.agreement?.UnitNo],
                    ["Project",       detail.agreement?.ProjectName || "—"],
                    ["Total Value",   detail.agreement?.TotalValue ? `₹${Number(detail.agreement.TotalValue).toLocaleString("en-IN")}` : "—"],
                    ["Agreement Date",detail.agreement?.AgreementDate ? String(detail.agreement.AgreementDate).slice(0, 10) : "—"],
                    ["Legal Name",    detail.agreement?.LegalName || "—"],
                    ["PAN",           detail.agreement?.PanNo || "—"],
                    ["Aadhaar",       detail.agreement?.AadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-xs text-muted-foreground">{k}: </span><span className="font-medium">{v}</span></div>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-muted-foreground">Customer Portal Account: </span>
                      {detail.agreement?.PortalEmail ? (
                        <span className="font-medium">{detail.agreement.PortalEmail}</span>
                      ) : (
                        <span className="text-amber-600">Not yet provisioned — applicant needs an email and mobile on file</span>
                      )}
                    </div>
                    {detail.agreement?.PortalEmail && (
                      <span className={`px-2 py-0.5 rounded-full border font-medium ${detail.agreement.PortalMustChangePassword ? "text-orange-600 bg-orange-50 border-orange-200" : "text-green-600 bg-green-50 border-green-200"}`}>
                        {detail.agreement.PortalMustChangePassword ? "First login pending" : "Password set"}
                      </span>
                    )}
                  </div>
                  {detail.agreement?.PortalEmail && (
                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/60">
                      <span className={`px-2 py-0.5 rounded-full border font-medium ${detail.agreement.PortalActive === false ? "text-rose-600 bg-rose-50 border-rose-200" : "text-green-600 bg-green-50 border-green-200"}`}>
                        {detail.agreement.PortalActive === false ? "Access Deactivated" : "Access Active"}
                      </span>
                      <button
                        onClick={() => handleTogglePortalAccess(detail.agreement.PortalActive !== false)}
                        disabled={togglingPortal}
                        className={`px-2.5 py-1 rounded-md border font-medium hover:bg-muted disabled:opacity-40 ${detail.agreement.PortalActive === false ? "border-green-200 text-green-600" : "border-rose-200 text-rose-600"}`}>
                        {togglingPortal ? "Working..." : detail.agreement.PortalActive === false ? "Reactivate Access" : "Deactivate Access"}
                      </button>
                    </div>
                  )}
                </div>
                {detail.agreement?.PortalEmail && detail.agreement?.PortalMustChangePassword && (
                  <p className="text-[11px] text-muted-foreground">
                    Initial login: email above, password is the applicant's mobile number ({detail.agreement?.Mobile || "on file"}). They'll be asked to set a new password on first login.
                  </p>
                )}
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

              {/* Approval Workflow */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold">Approval Workflow</h3>
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
                <div className="flex flex-wrap gap-1.5">
                  <DateStatusBadge label="Proposed by Company" date={detail.agreement?.ProposedDateByCompany} color="purple" active={!!detail.agreement?.ProposedDateByCompany} />
                  <DateStatusBadge label="Proposed by Customer" date={detail.agreement?.ProposedDateByCustomer} color="blue" active={!!detail.agreement?.ProposedDateByCustomer} />
                  <DateStatusBadge label="Accepted by Company" color="green" active={!!detail.agreement?.AgreementDate} />
                  <DateStatusBadge label="Accepted by Customer" color="green" active={!!detail.agreement?.AgreementDate} />
                </div>
                {!detail.agreement?.AgreementDate && detail.agreement?.ProposedDateByCompany && detail.agreement?.ProposedDateByCustomer && (
                  new Date(detail.agreement.ProposedDateByCompany).toDateString() === new Date(detail.agreement.ProposedDateByCustomer).toDateString() ? (
                    <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                      Both sides agree on this date — Agreement Date will be confirmed automatically.
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      Company and customer proposed different dates — renegotiate via "Resend After Recheck" once the customer requests a recheck, or agree offline and re-send with a matching date.
                    </div>
                  )
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
                      <button onClick={() => { setSendDate(detail.agreement?.ProposedDateByCompany ? String(detail.agreement.ProposedDateByCompany).slice(0, 10) : ""); setSendDialog(true); }}
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
                      <button onClick={() => { setSendDate(detail.agreement?.ProposedDateByCompany ? String(detail.agreement.ProposedDateByCompany).slice(0, 10) : ""); setSendDialog(true); }}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                        Resend After Recheck
                      </button>
                    )
                  )}
                  {/* Date negotiation is the step AFTER both ends approve the
                      agreement's content (spec: "...CUSTOMER APPROVAL ->
                      APPROVAL FROM BOTH END -> DATE OF AGREEMENT..."), so
                      this shows once CustomerApprovalStatus is Approved —
                      not "Pending", which is the state *before* that. */}
                  {detail.agreement?.SentToCustomerAt && detail.agreement?.CustomerApprovalStatus === "Approved" && !detail.agreement?.AgreementDate && (
                    detail.agreement?.DateApprovalStatus === "Pending" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-amber-600 bg-amber-50 border-amber-200">
                        Awaiting Super Admin Approval
                      </span>
                    ) : isBookingCancelled(detail.agreement) ? (
                      <span title="Booking is cancelled — cannot propose a date" className="text-xs px-3 py-1.5 border border-dashed border-border rounded-lg text-muted-foreground/40 cursor-not-allowed">
                        {detail.agreement?.ProposedDateByCompany ? "Update Proposed Date" : "Propose Agreement Date"}
                      </span>
                    ) : (
                      <button onClick={() => { setSendDate(detail.agreement?.ProposedDateByCompany ? String(detail.agreement.ProposedDateByCompany).slice(0, 10) : ""); setProposeDateDialog(true); }}
                        className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                        {detail.agreement?.ProposedDateByCompany ? "Update Proposed Date" : "Propose Agreement Date"}
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

              {/* Documents */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Agreement Documents ({detail.documents?.length || 0})</h3>
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
                  const awaitingCustomer = d.Status === "Requested" && !d.FilePath && !d.DocumentUrl;
                  return (
                    <div key={d.Id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-3">
                      <button
                        onClick={() => (d.FilePath ? setPreviewDoc(d) : d.DocumentUrl && window.open(d.DocumentUrl, "_blank"))}
                        disabled={!d.FilePath && !d.DocumentUrl}
                        className="flex items-center gap-3 text-left disabled:cursor-default min-w-0"
                      >
                        {awaitingCustomer ? <Clock size={16} className="text-amber-500 shrink-0" /> : mimeIcon(d.MimeType)}
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
                          ) : (
                            <>
                              {d.FileName && <div className="text-xs text-muted-foreground truncate max-w-xs">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</div>}
                              {d.IssuedBy && <div className="text-xs text-muted-foreground">by {d.IssuedBy}</div>}
                            </>
                          )}
                        </div>
                      </button>
                      <select value={d.Status} onChange={(e) => handleDocStatusChange(d.Id, e.target.value)}
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${docStatusColor[d.Status] || ""} bg-transparent cursor-pointer`}>
                        {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
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
                    onChange={(e) => setAgrForm((f) => ({ ...f, [key]: e.target.value }))}
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

      {/* Propose/Update Agreement Date — the agreement itself now sends to
          the customer automatically on senior approval, so this is the
          standalone way to propose or renegotiate a date afterward. */}
      <Dialog open={proposeDateDialog} onOpenChange={(o) => { if (!o) { setProposeDateDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Propose Agreement Date</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              If the customer proposes (or has already proposed) the same date, it's confirmed automatically as the Agreement Date.
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

      {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}

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
                <input type="text" value={editForm.PanNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, PanNo: e.target.value }))}
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
    </SalesAutoShell>
  );
};

export default CrmAgreement;