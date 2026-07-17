import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Phone, X, FileCheck, Users, ChevronRight, Check, Upload, FileImage, File as FileIcon, FileSpreadsheet, Eye, Trash2, IndianRupee, Landmark, ClipboardCheck, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActionBar } from "@/components/crm/ContactActionBar";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/welcome-calls";
const CO_API = "/api/crm/co-applicants";
const DOC_API = "/api/crm/booking-documents";
const BKG_API = "/api/crm/bookings";
const PAY_API = "/api/crm/payments";
const SA_LEADS_API = "/api/sa/leads";

const OUTCOMES = ["Welcomed", "NotReachable", "RequestedCallback", "VoiceMail", "Busy", "SwitchedOff"];
const outcomeColor: Record<string, string> = {
  Welcomed:          "text-green-600 bg-green-50 border-green-200",
  NotReachable:      "text-red-500 bg-red-50 border-red-200",
  RequestedCallback: "text-orange-600 bg-orange-50 border-orange-200",
  VoiceMail:         "text-blue-500 bg-blue-50 border-blue-200",
  Busy:              "text-yellow-600 bg-yellow-50 border-yellow-200",
  SwitchedOff:       "text-muted-foreground bg-muted/50 border-border",
};

const EMPTY_FORM = {
  CalledBy: "", CallDate: "", DurationSeconds: "",
  Outcome: "", NextCallDate: "", Notes: "", PreferredAgreementDate: "", PaymentPlanConfirmed: false,
};
const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchQueue(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/queue`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCalls(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}
async function fetchChecklist(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/checklist`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchDocs(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${DOC_API}/booking/${bookingId}`); return r.ok ? r.json() : { documents: [], standardTypes: [] }; } catch { return { documents: [], standardTypes: [] }; }
}
async function fetchCoApplicants(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${CO_API}/booking/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookingById(bookingId: number): Promise<any | null> {
  try {
    const r = await fetchWithAuth(`${BKG_API}/${bookingId}`);
    if (!r.ok) return null;
    const d = await r.json();
    return { BookingId: d.Id, BookingNo: d.BookingNo, ApplicantName: d.ApplicantName, Mobile: d.Mobile, ProjectName: d.ProjectName, UnitNo: d.UnitNo };
  } catch { return null; }
}
async function fetchCallContext(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/call-context`); return r.ok ? r.json() : null; } catch { return null; }
}

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileCheck size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Preview dialog for a single uploaded document ──────────────────────────
const DocPreviewDialog: React.FC<{ doc: any; onClose: () => void }> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    fetchWithAuth(`${DOC_API}/file/${doc.Id}`)
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
          {blobUrl && (
            <a href={blobUrl} download={doc.FileName} className="text-primary hover:underline">Download</a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Intake dialog: log the call + work through the rest of the checklist ──
const IntakeDialog: React.FC<{ booking: any; onClose: () => void }> = ({ booking, onClose }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coForm, setCoForm] = useState({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "" });
  const [addingCo, setAddingCo] = useState(false);
  const [onAccountDialog, setOnAccountDialog] = useState(false);
  const [onAccountForm, setOnAccountForm] = useState({ Amount: "", PaymentMode: "", TransactionRef: "", Notes: "" });
  const [recordingOnAccount, setRecordingOnAccount] = useState(false);

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: checklist, refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-welcome-checklist", booking.BookingId],
    queryFn: () => fetchChecklist(booking.BookingId),
  });
  const { data: callContext, refetch: refetchCallContext } = useQuery({
    queryKey: ["crm-welcome-call-context", booking.BookingId],
    queryFn: () => fetchCallContext(booking.BookingId),
  });
  const { data: docData = { documents: [], standardTypes: [] }, refetch: refetchDocs } = useQuery({
    queryKey: ["crm-booking-documents", booking.BookingId],
    queryFn: () => fetchDocs(booking.BookingId),
  });
  const { data: coApplicants = [], refetch: refetchCo } = useQuery({
    queryKey: ["crm-co-applicants", booking.BookingId],
    queryFn: () => fetchCoApplicants(booking.BookingId),
  });

  const invalidateQueue = () => qc.invalidateQueries({ queryKey: ["crm-welcome-queue"] });

  const handleLogCall = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: booking.BookingId,
          CalledBy: form.CalledBy || null,
          CallDate: form.CallDate || null,
          DurationSeconds: form.DurationSeconds || null,
          Outcome: form.Outcome || null,
          NextCallDate: form.NextCallDate || null,
          Notes: form.Notes || null,
          PreferredAgreementDate: form.PreferredAgreementDate || null,
          PaymentPlanConfirmed: form.PaymentPlanConfirmed,
          CustomFields: customFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log call");
      setForm({ ...EMPTY_FORM });
      setCustomFields([]);
      refetchChecklist();
      invalidateQueue();
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
      qc.invalidateQueries({ queryKey: ["crm-communication"] });

      // Auto-flow: every logged call is seeded into the Communication Log
      // server-side already — once the customer is actually Welcomed, hand
      // the whole flow off to that page for ongoing follow-up/tasks instead
      // of leaving staff sitting on this dialog.
      if (form.Outcome === "Welcomed") {
        toast.success("Welcome call logged — continuing in Communication Log");
        onClose();
        navigate(`/crm/communication?bookingId=${booking.BookingId}`);
      } else {
        toast.success("Welcome call logged");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // "If the customer is paying extra amount" — recorded straight from the
  // call as an on-account deposit, not tied to any milestone yet.
  const handleRecordOnAccount = async () => {
    if (!onAccountForm.Amount) { toast.error("Amount is required"); return; }
    setRecordingOnAccount(true);
    try {
      const res = await fetchWithAuth(`${PAY_API}/booking/${booking.BookingId}/on-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...onAccountForm, Amount: parseFloat(onAccountForm.Amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`On-account deposit ${data.ReceiptNo} recorded`);
      setOnAccountDialog(false);
      setOnAccountForm({ Amount: "", PaymentMode: "", TransactionRef: "", Notes: "" });
      refetchCallContext();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRecordingOnAccount(false);
    }
  };

  const handleAddDoc = async () => {
    if (!docType) { toast.error("Select a document type"); return; }
    if (!docUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    try {
      const res = await fetchWithAuth(`${DOC_API}/booking/${booking.BookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentType: docType, DocumentUrl: docUrl || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDocType(""); setDocUrl("");
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!docType) { toast.error("Select a document type before uploading"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docType);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${DOC_API}/booking/${booking.BookingId}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocType("");
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${DOC_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleVerifyDoc = async (id: number, verified: boolean) => {
    try {
      await fetchWithAuth(`${DOC_API}/${id}/verify`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsVerified: verified }),
      });
      refetchDocs();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAddCoApplicant = async () => {
    if (!coForm.Name.trim()) { toast.error("Name is required"); return; }
    try {
      const res = await fetchWithAuth(`${CO_API}/booking/${booking.BookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coForm),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setCoForm({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "" });
      setAddingCo(false);
      refetchCo();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemoveCoApplicant = async (id: number) => {
    try {
      await fetchWithAuth(`${CO_API}/${id}`, { method: "DELETE" });
      refetchCo();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Welcome Call — {booking.ApplicantName} <span className="text-muted-foreground font-normal text-sm">({booking.BookingNo})</span>
          </DialogTitle>
        </DialogHeader>

        {/* ── Customer Snapshot — everything the telecaller needs on-screen
             DURING the call, in one glance ── */}
        {callContext && (
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <ContactActionBar
                applicantName={callContext.customer?.CustomerName || booking.ApplicantName}
                mobile={callContext.customer?.Mobile || booking.Mobile}
                email={callContext.customer?.Email || null}
              />
              <button onClick={() => setOnAccountDialog(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100">
                <Wallet size={13} /> Customer Paying Extra? Record On-Account
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-border bg-background p-2.5">
                <div className="flex items-center gap-1 text-muted-foreground mb-0.5"><IndianRupee size={11} /> Total Value</div>
                <div className="font-bold">{fmt(callContext.booking?.GrandTotal ?? callContext.booking?.TotalValue)}</div>
              </div>
              <div className={`rounded-lg border p-2.5 ${callContext.outstanding?.balance > 0 ? "border-amber-200 bg-amber-50" : "border-border bg-background"}`}>
                <div className="flex items-center gap-1 text-muted-foreground mb-0.5"><IndianRupee size={11} /> Outstanding</div>
                <div className={`font-bold ${callContext.outstanding?.balance > 0 ? "text-amber-700" : ""}`}>{fmt(callContext.outstanding?.balance)}</div>
              </div>
              <div className="rounded-lg border border-border bg-background p-2.5">
                <div className="flex items-center gap-1 text-muted-foreground mb-0.5"><ClipboardCheck size={11} /> Payment Plan</div>
                <div className="font-medium truncate" title={callContext.booking?.PaymentPlanName}>{callContext.booking?.PaymentPlanName || "7-stage default"}</div>
              </div>
              <div className="rounded-lg border border-border bg-background p-2.5">
                <div className="flex items-center gap-1 text-muted-foreground mb-0.5"><Landmark size={11} /> Bank Preference</div>
                <div className="font-medium truncate" title={callContext.loan?.BankName}>{callContext.loan?.BankName || "Not on file"}</div>
              </div>
            </div>

            {callContext.invoices?.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Invoices: </span>
                {callContext.invoices.map((inv: any) => (
                  <span key={inv.InvoiceNo} className="inline-block mr-1.5 px-1.5 py-0.5 rounded border border-border font-mono">{inv.InvoiceNo} ({fmt(inv.Amount)})</span>
                ))}
              </div>
            )}
            {callContext.onAccount?.availableBalance > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium">
                <Wallet size={12} /> {fmt(callContext.onAccount.availableBalance)} sitting on account, not yet applied to a milestone
              </div>
            )}
          </div>
        )}

        {/* ── Checklist strip ── */}
        {checklist && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            {[
              { label: "Call", done: checklist.welcomeCall.done },
              { label: "Docs", done: checklist.documents.total > 0 && checklist.documents.verified === checklist.documents.total },
              { label: "Co-App.", done: checklist.coApplicants.count > 0 },
              { label: "Bank", done: checklist.bankDetails.complete },
              { label: "NOC", done: checklist.noc.some((n: any) => n.Status === "Issued") },
              { label: "Agreement", done: !!checklist.agreement },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border p-2 text-[11px] font-medium ${s.done ? "border-green-200 bg-green-50 text-green-700" : "border-border bg-muted/30 text-muted-foreground"}`}>
                {s.done && <Check size={11} className="inline mr-0.5 -mt-0.5" />} {s.label}
              </div>
            ))}
          </div>
        )}

        {/* ── Log Call ── */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Log This Call</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Called By</label>
              <select value={form.CalledBy} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Self —</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
              <select value={form.Outcome} onChange={(e) => setForm((f) => ({ ...f, Outcome: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select outcome</option>
                {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Call Date & Time</label>
              <input type="datetime-local" value={form.CallDate}
                onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Duration (seconds)</label>
              <input type="number" value={form.DurationSeconds}
                onChange={(e) => setForm((f) => ({ ...f, DurationSeconds: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="e.g. 180" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Schedule Follow-up Call</label>
              <input type="date" value={form.NextCallDate}
                onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Preferred Agreement Date</label>
              <input type="date" value={form.PreferredAgreementDate}
                onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-xs rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/30">
              <input type="checkbox" checked={form.PaymentPlanConfirmed}
                onChange={(e) => setForm((f) => ({ ...f, PaymentPlanConfirmed: e.target.checked }))}
                className="rounded border-border" />
              <ClipboardCheck size={13} className="text-muted-foreground" />
              Customer confirmed the payment plan{callContext?.booking?.PaymentPlanName ? ` (${callContext.booking.PaymentPlanName})` : ""} on this call
            </label>
          </div>

          {/* Dynamic custom fields */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">Additional Fields</label>
              <button onClick={() => setCustomFields((f) => [...f, { key: "", value: "" }])}
                className="text-xs text-primary hover:underline flex items-center gap-0.5">
                <Plus size={11} /> Add Field
              </button>
            </div>
            {customFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <input placeholder="Field name" value={f.key}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                  className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="Value" value={f.value}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <button onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-red-600 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <button onClick={handleLogCall} disabled={saving}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Logging..." : "Log Call"}
          </button>
        </div>

        {/* ── Document Verification ── */}
        <div className="rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileCheck size={14} /> Document & Attachment Verification</h3>

          {docData.documents.map((d: any) => (
            <div key={d.Id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0 gap-2">
              <button
                onClick={() => (d.FilePath ? setPreviewDoc(d) : d.DocumentUrl && window.open(d.DocumentUrl, "_blank"))}
                disabled={!d.FilePath && !d.DocumentUrl}
                className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default"
              >
                {mimeIcon(d.MimeType)}
                <span className="min-w-0">
                  <span className="font-medium">{d.DocumentType}</span>
                  {d.FileName && <span className="block text-[11px] text-muted-foreground truncate max-w-[220px]">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</span>}
                </span>
                {(d.FilePath || d.DocumentUrl) && <Eye size={13} className="text-muted-foreground shrink-0" />}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleVerifyDoc(d.Id, !d.IsVerified)}
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${d.IsVerified ? "text-green-600 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                  {d.IsVerified ? "Verified" : "Mark Verified"}
                </button>
                <button onClick={() => handleRemoveDoc(d.Id)} className="text-muted-foreground hover:text-red-600">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <select value={docType} onChange={(e) => setDocType(e.target.value)}
              className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select document type</option>
              {docData.standardTypes.map((t: string) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="file" multiple ref={fileInputRef}
              onChange={(e) => handleUploadFiles(e.target.files)}
              className="hidden" />
            <button onClick={() => { if (!docType) { toast.error("Select a document type first"); return; } fileInputRef.current?.click(); }}
              disabled={uploading}
              className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted shrink-0 flex items-center gap-1 disabled:opacity-40">
              <Upload size={13} /> {uploading ? "Uploading..." : "Upload File(s)"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input placeholder="...or paste an external document URL instead" value={docUrl} onChange={(e) => setDocUrl(e.target.value)}
              className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <button onClick={handleAddDoc} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted shrink-0">
              + Add Link
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>
        </div>

        {/* ── Co-Applicant ── */}
        <div className="rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Users size={14} /> Co-Applicant</h3>
          {coApplicants.map((c: any) => (
            <div key={c.Id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
              <div>
                <span className="font-medium">{c.Name}</span>
                {c.Relation && <span className="text-xs text-muted-foreground"> · {c.Relation}</span>}
                {c.Mobile && <span className="text-xs text-muted-foreground"> · {c.Mobile}</span>}
              </div>
              <button onClick={() => handleRemoveCoApplicant(c.Id)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
          ))}
          {!addingCo ? (
            <button onClick={() => setAddingCo(true)} className="text-xs text-primary hover:underline flex items-center gap-0.5">
              <Plus size={11} /> Add Co-Applicant
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Name *" value={coForm.Name} onChange={(e) => setCoForm((f) => ({ ...f, Name: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="Relation" value={coForm.Relation} onChange={(e) => setCoForm((f) => ({ ...f, Relation: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="Mobile" value={coForm.Mobile} onChange={(e) => setCoForm((f) => ({ ...f, Mobile: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="Email" value={coForm.Email} onChange={(e) => setCoForm((f) => ({ ...f, Email: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="PAN No." value={coForm.PanNo} onChange={(e) => setCoForm((f) => ({ ...f, PanNo: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
                <input placeholder="Aadhaar No." value={coForm.AadhaarNo} onChange={(e) => setCoForm((f) => ({ ...f, AadhaarNo: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddCoApplicant} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">Save</button>
                <button onClick={() => setAddingCo(false)} className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Rest of the checklist: link out, don't duplicate ── */}
        <div className="rounded-xl border border-border overflow-hidden">
          {[
            { label: "Communication Log", path: `/crm/communication?bookingId=${booking.BookingId}`, done: checklist?.welcomeCall.done, sub: "further follow-ups & tasks" },
            { label: "Nominee & Bank Details", path: `/crm/customer-bank-details?bookingId=${booking.BookingId}`, done: checklist?.bankDetails.complete },
            { label: "NOC", path: `/crm/noc?bookingId=${booking.BookingId}`, done: checklist?.noc?.some((n: any) => n.Status === "Issued"), sub: checklist?.noc?.length ? `${checklist.noc.length} raised` : "Not raised" },
            { label: "Agreement", path: `/crm/agreements?bookingId=${booking.BookingId}`, done: !!checklist?.agreement, sub: checklist?.agreement?.Status || "Not yet created" },
          ].map((row) => (
            <button key={row.label} onClick={() => navigate(row.path)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/20 text-left">
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${row.done ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                {row.label}
                {row.sub && <span className="text-xs text-muted-foreground">({row.sub})</span>}
              </div>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>

    {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}

    {/* On-Account Deposit Dialog */}
    <Dialog open={onAccountDialog} onOpenChange={(o) => { if (!o) setOnAccountDialog(false); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><Wallet size={16} className="text-blue-600" /> Record On-Account Deposit</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">For a customer paying more than what's currently due — held as a credit and applied to milestones as they come up, in order.</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Amount (₹) *</label>
            <input type="number" value={onAccountForm.Amount}
              onChange={(e) => setOnAccountForm((f) => ({ ...f, Amount: e.target.value }))}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
            <input type="text" value={onAccountForm.PaymentMode}
              onChange={(e) => setOnAccountForm((f) => ({ ...f, PaymentMode: e.target.value }))}
              placeholder="e.g. UPI, NEFT, Cheque"
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Transaction Ref</label>
            <input type="text" value={onAccountForm.TransactionRef}
              onChange={(e) => setOnAccountForm((f) => ({ ...f, TransactionRef: e.target.value }))}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <textarea value={onAccountForm.Notes} onChange={(e) => setOnAccountForm((f) => ({ ...f, Notes: e.target.value }))}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={() => setOnAccountDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={handleRecordOnAccount} disabled={recordingOnAccount || !onAccountForm.Amount}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {recordingOnAccount ? "Recording..." : "Record Deposit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

// ─── Edit dialog: correct a previously-logged call from Call History ───────
const EditCallDialog: React.FC<{ call: any; onClose: () => void; onSaved: () => void }> = ({ call, onClose, onSaved }) => {
  const [form, setForm] = useState({
    CalledBy: call.CalledBy ? String(call.CalledBy) : "",
    CallDate: call.CallDate ? String(call.CallDate).slice(0, 16) : "",
    DurationSeconds: call.DurationSeconds != null ? String(call.DurationSeconds) : "",
    Outcome: call.Outcome || "",
    NextCallDate: call.NextCallDate ? String(call.NextCallDate).slice(0, 10) : "",
    Notes: call.Notes || "",
    PreferredAgreementDate: call.PreferredAgreementDate ? String(call.PreferredAgreementDate).slice(0, 10) : "",
  });
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(() => {
    try { return call.CustomFields ? JSON.parse(call.CustomFields) : []; } catch { return []; }
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${call.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CalledBy: form.CalledBy || null,
          CallDate: form.CallDate || null,
          DurationSeconds: form.DurationSeconds || null,
          Outcome: form.Outcome || null,
          NextCallDate: form.NextCallDate || null,
          Notes: form.Notes || null,
          PreferredAgreementDate: form.PreferredAgreementDate || null,
          CustomFields: customFields,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Call updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`${API}/${call.Id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Call log removed");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const selectedOutcomeStyle = form.Outcome ? outcomeColor[form.Outcome] : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Phone size={16} className="text-primary" /> Edit Welcome Call
          </DialogTitle>
        </DialogHeader>

        {/* ── Customer / booking context ── */}
        <div className="rounded-xl border border-border bg-muted/20 p-3.5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{call.ApplicantName}</span>
              <span className="text-xs font-mono text-muted-foreground">{call.BookingNo}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {call.Mobile} · {call.ProjectName || "—"}{call.UnitNo ? ` · Unit ${call.UnitNo}` : ""}
            </div>
            {call.CalledByName && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Originally logged by <span className="font-medium">{call.CalledByName}</span>
                {call.CreatedAt && <> on {new Date(call.CreatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
              </div>
            )}
          </div>
          {call.Outcome && (
            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold whitespace-nowrap ${outcomeColor[call.Outcome] || ""}`}>
              {call.Outcome}
            </span>
          )}
        </div>

        <div className="space-y-4">
          {/* ── Call details ── */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><Phone size={14} /> Call Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Called By</label>
                <select value={form.CalledBy} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">—</option>
                  {users.map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Call Date/Time</label>
                <input type="datetime-local" value={form.CallDate} onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                <select value={form.Outcome} onChange={(e) => setForm((f) => ({ ...f, Outcome: e.target.value }))}
                  className={`w-full text-sm border rounded-lg px-2.5 py-2 font-medium ${selectedOutcomeStyle || "bg-background border-border"}`}>
                  <option value="">—</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Duration</label>
                <div className="relative">
                  <input type="number" min={0} value={form.DurationSeconds} onChange={(e) => setForm((f) => ({ ...f, DurationSeconds: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background pr-16" placeholder="seconds" />
                  {form.DurationSeconds && Number(form.DurationSeconds) > 0 && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                      {Math.floor(Number(form.DurationSeconds) / 60)}m {Number(form.DurationSeconds) % 60}s
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Follow-up & agreement scheduling ── */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><Check size={14} /> Follow-up & Agreement</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Next Call Date</label>
                <input type="date" value={form.NextCallDate} onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Preferred Agreement Date</label>
                <input type="date" value={form.PreferredAgreementDate} onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><FileCheck size={14} /> Notes</h3>
            <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
              rows={3} placeholder="What was discussed on this call..."
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background resize-none" />
          </div>

          {/* ── Custom fields ── */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><Users size={14} /> Custom Fields</h3>
            {customFields.length === 0 && <p className="text-xs text-muted-foreground">No custom fields added for this call.</p>}
            {customFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="Field name" value={f.key}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                  className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                <input placeholder="Value" value={f.value}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                <button onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-red-600 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={() => setCustomFields((cf) => [...cf, { key: "", value: "" }])}
              className="text-xs text-primary hover:underline font-medium">+ Add field</button>
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-border">
          <button onClick={handleDelete} disabled={deleting}
            className="text-xs px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-40">
            {deleting ? "Removing..." : "Delete Call"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const CrmWelcomeCall: React.FC = () => {
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"queue" | "history">("queue");
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  const [editingCall, setEditingCall] = useState<any | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const { data: queue = [], isLoading: queueLoading } = useQuery({
    queryKey: ["crm-welcome-queue"],
    queryFn: fetchQueue,
    staleTime: 30_000,
  });

  // Deep-link support: /crm/welcome-calls?bookingId=X (e.g. from the Booking
  // list's "Welcome Call" action) opens the intake dialog for that booking
  // directly, whether or not it's currently in the queue.
  React.useEffect(() => {
    if (!bkgFilter || deepLinkOpened) return;
    setDeepLinkOpened(true);
    const id = parseInt(bkgFilter);
    const fromQueue = (queue as any[]).find((c: any) => c.BookingId === id);
    if (fromQueue) {
      setActiveBooking(fromQueue);
    } else {
      fetchBookingById(id).then((b) => { if (b) setActiveBooking(b); });
    }
  }, [bkgFilter, deepLinkOpened, queue]);
  const { data: history = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ["crm-welcome-calls-history"],
    queryFn: fetchCalls,
    staleTime: 60_000,
  });

  const filteredQueue = useMemo(() =>
    (queue as any[]).filter((c: any) =>
      !search || c.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || c.BookingNo?.includes(search)
    ), [queue, search]);

  const filteredHistory = useMemo(() =>
    (history as any[]).filter((c: any) =>
      !search || c.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || c.BookingNo?.includes(search)
    ), [history, search]);

  const overdueCount = useMemo(() =>
    (queue as any[]).filter((c: any) => c.NextCallDate && new Date(c.NextCallDate) <= new Date()).length,
    [queue]
  );

  const queueColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 140,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / Unit", size: 130, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.ProjectName || "—"} · {i.row.original.UnitNo}</span> },
    { accessorKey: "LastOutcome", header: "Last Outcome", size: 120,
      cell: (i) => i.row.original.LastOutcome ? (
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${outcomeColor[i.row.original.LastOutcome] || ""}`}>{i.row.original.LastOutcome}</span>
      ) : <span className="text-xs text-muted-foreground">Never called</span> },
    { accessorKey: "NextCallDate", header: "Follow-up Due", size: 110,
      cell: (i) => i.row.original.NextCallDate ? (
        <span className={new Date(i.row.original.NextCallDate) <= new Date() ? "text-orange-600 font-medium text-xs" : "text-muted-foreground text-xs"}>
          {String(i.row.original.NextCallDate).slice(0, 10)}
        </span>
      ) : <span className="text-xs">—</span> },
    { id: "actions", header: "Action", size: 100, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setActiveBooking(i.row.original)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
          <Phone size={12} /> Call Now
        </button>
      ) },
  ];

  return (
    <SalesAutoShell
      title="CRM — Welcome Calls"
      subtitle="Work the call queue, then verify documents, co-applicant, bank, NOC, and agreement readiness"
    >
      {overdueCount > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-2.5 text-sm text-orange-700 flex items-center gap-2">
          <Phone size={14} />
          <span><strong>{overdueCount}</strong> booking{overdueCount > 1 ? "s" : ""} due for a call today or overdue</span>
        </div>
      )}

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or booking no..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView("queue")}
            className={`px-3 py-2 text-xs font-medium ${view === "queue" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
            Queue ({queue.length})
          </button>
          <button onClick={() => setView("history")}
            className={`px-3 py-2 text-xs font-medium ${view === "history" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
            Call History
          </button>
        </div>
      </div>

      {view === "queue" ? (
        <DataTable
          data={filteredQueue}
          columns={queueColumns}
          searchable={false}
          loading={queueLoading}
          emptyMessage="Queue is clear — no calls pending"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      ) : (
        <div className="space-y-2">
          {historyLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No welcome calls logged yet</div>
          ) : (filteredHistory as any[]).map((c: any) => {
            let custom: { key: string; value: string }[] = [];
            try { custom = c.CustomFields ? JSON.parse(c.CustomFields) : []; } catch { /* ignore */ }
            return (
              <button
                key={c.Id}
                onClick={() => setEditingCall(c)}
                className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/10 hover:border-primary/40 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{c.ApplicantName}</span>
                      <span className="text-xs text-muted-foreground font-mono">{c.BookingNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.Mobile} · {c.ProjectName || c.UnitNo}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.Outcome && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${outcomeColor[c.Outcome] || ""}`}>
                        {c.Outcome}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {c.CallDate ? String(c.CallDate).slice(0, 16).replace("T", " ") : "—"}
                    </span>
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </div>
                </div>
                {(c.Notes || c.DurationSeconds || c.NextCallDate || c.PreferredAgreementDate || custom.length > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {c.DurationSeconds && <span>{Math.floor(c.DurationSeconds / 60)}m {c.DurationSeconds % 60}s</span>}
                    {c.CalledByName && <span>by {c.CalledByName}</span>}
                    {c.NextCallDate && <span className="text-orange-600">Follow-up: {String(c.NextCallDate).slice(0, 10)}</span>}
                    {c.PreferredAgreementDate && <span className="text-purple-600">Preferred agreement date: {String(c.PreferredAgreementDate).slice(0, 10)}</span>}
                    {c.Notes && <span className="truncate max-w-xs">{c.Notes}</span>}
                    {custom.map((f, i) => <span key={i}>{f.key}: {f.value}</span>)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeBooking && (
        <IntakeDialog booking={activeBooking} onClose={() => setActiveBooking(null)} />
      )}
      {editingCall && (
        <EditCallDialog call={editingCall} onClose={() => setEditingCall(null)} onSaved={() => refetchHistory()} />
      )}
    </SalesAutoShell>
  );
};

export default CrmWelcomeCall;
