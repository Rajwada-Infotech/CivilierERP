import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Plus, Search, Phone, X, FileCheck, Users, ChevronRight, Check, Upload, FileImage, File as FileIcon, FileSpreadsheet, Eye, Trash2, IndianRupee, Landmark, ClipboardCheck, Wallet, Pencil, Lock, Timer, PhoneCall, CalendarClock, StickyNote, ListPlus, Building2, Car, AlertTriangle, Download, ShieldCheck, ShieldAlert, RotateCcw, ClipboardList, Send, Unlock, MapPin } from "lucide-react";
import { FinancialStatusBar } from "@/components/crm/FinancialStatusBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActionBar } from "@/components/crm/ContactActionBar";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";

const API = "/api/crm/welcome-calls";
const CO_API = "/api/crm/co-applicants";
const DOC_API = "/api/crm/booking-documents";
const BKG_API = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";
const BANK_DETAIL_API = "/api/crm/customer-bank-details";
const PARKING_API = "/api/crm/parking";
const EXTRA_CHARGE_API = "/api/crm/extra-charges";
const VC_API = "/api/crm/welcome-checklist"; // per-item verification checklist: checkbox + remarks + recheck + submit

const EMPTY_BANK = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
};

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
  Outcome: "", NextCallDate: "", Notes: "", PreferredAgreementDate: "",
};
const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
// datetime-local input value for "right now" — pre-filling this is the
// common case (logging the call as it happens); staff can still change it
// for a call being logged after the fact.
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

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
    // GET /api/crm/bookings/:id returns { booking: {...}, customer, ... } —
    // not the flat booking row itself.
    const { booking: d } = await r.json();
    if (!d) return null;
    return { BookingId: d.Id, BookingNo: d.BookingNo, ApplicantName: d.ApplicantName, Mobile: d.Mobile, ProjectName: d.ProjectName, UnitNo: d.UnitNo };
  } catch { return null; }
}
async function fetchCallContext(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/call-context`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchBankDetail(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${BANK_DETAIL_API}/booking/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}
// Full loan/bank-preference record — the call-context endpoint only carries
// a trimmed subset (BankName/LoanAmount/SanctionStatus/LoanAccountNo); this
// is the same GET the Home Loan Tracking page itself uses, so the expanded
// Bank Preference card can show Branch/RM name/contact/disbursed amount too
// without a second bespoke endpoint.
async function fetchLoanDetail(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/loan`); return r.ok ? r.json() : null; } catch { return null; }
}
// Real milestone schedule for the expandable Payment Plan card — same
// endpoint CrmBookingDetail.tsx's own "Payment Plan" tab reads .milestones
// off of.
async function fetchBookingMilestones(bookingId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${BKG_API}/${bookingId}`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.milestones || [];
  } catch { return []; }
}
// Full invoice rows (Description/Status/CreatedByName included) — richer
// than call-context's trimmed InvoiceNo/InvoiceType/Amount/InvoiceDate-only
// projection, so the click-to-detail dialog doesn't need its own endpoint.
async function fetchBookingInvoices(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`); return r.ok ? r.json() : []; } catch { return []; }
}
// Read-only reference data for the new Parking / Extra Charges checklist
// items — staff need to actually see what was sold before they can confirm
// it with the customer. Neither of these was fetched anywhere on this page
// before; both fail soft to an empty list (e.g. a role without crm-bookings
// view rights) rather than blocking the rest of the dossier from loading.
async function fetchParkingAllotments(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${PARKING_API}/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchExtraCharges(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
// ─── Verification checklist (per-item checkbox + remarks + recheck) ────────
type VcItem = {
  Section: string; SectionLabel: string; ItemKey: string; Label: string;
  IsChecked: boolean; Remarks: string;
  RecheckStatus: CrmStatus.OPEN | "Resolved" | null; RecheckReason: string | null;
  RecheckRequestedAt: string | null; ResolvedAt: string | null;
};
type VcSection = { section: string; label: string; items: VcItem[]; complete: boolean; hasOpenRecheck: boolean };
type VcState = {
  items: VcItem[]; sections: VcSection[]; totalCount: number; checkedCount: number; openRecheckCount: number; canSubmit: boolean;
  submission: { IsLocked: boolean; SubmittedBy: number | null; SubmittedAt: string | null } | null;
};
async function fetchVerificationChecklist(bookingId: number): Promise<VcState | null> {
  try { const r = await fetchWithAuth(`${VC_API}/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchRecheckQueue(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${VC_API}/recheck/queue`); return r.ok ? r.json() : []; } catch { return []; }
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
            <a href={blobUrl} download={doc.FileName} className="text-amber-600 dark:text-amber-400 hover:underline">Download</a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Real PDF preview for an invoice — same blob-fetch pattern as
// DocPreviewDialog above, pointed at the actual invoice PDF route
// (CrmBookingDetail.tsx's Payment & Invoice tab uses the identical
// component) instead of the old plain-text Type/Amount/Date summary.
const InvoicePdfDialog: React.FC<{ bookingId: number; invoice: any; onClose: () => void }> = ({ bookingId, invoice, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${BKG_API}/${bookingId}/invoices/${invoice.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [bookingId, invoice.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="font-heading flex items-center gap-1.5"><FileCheck size={16} className="text-amber-600 dark:text-amber-400" /> {invoice.InvoiceNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 rounded-lg overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          {invoice.InvoiceType} · {fmt(invoice.Amount)}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Verification Checklist — every mandatory item across every section,
// ticked and saved one at a time, with a remarks field and a "Send for
// Recheck" escape hatch for anything that doesn't match what the customer
// says. This is the actual substance of the rebuilt page: nothing here is
// derived/computed, it's explicit staff sign-off per fact. ──────────────────
const ChecklistItemRow: React.FC<{
  item: VcItem; bookingId: number; locked: boolean; onChanged: () => void;
}> = ({ item, bookingId, locked, onChanged }) => {
  const [checked, setChecked] = useState(item.IsChecked);
  const [remarks, setRemarks] = useState(item.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [recheckReason, setRecheckReason] = useState("");
  const [showRecheckBox, setShowRecheckBox] = useState(false);
  const [showRemarksBox, setShowRemarksBox] = useState(false);
  const dirty = checked !== item.IsChecked || remarks !== (item.Remarks || "");
  const isOpenRecheck = item.RecheckStatus === CrmStatus.OPEN;

  useEffect(() => { setChecked(item.IsChecked); setRemarks(item.Remarks || ""); }, [item.IsChecked, item.Remarks]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: checked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(`Saved — ${item.Label}`);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSendRecheck = async () => {
    if (!recheckReason.trim()) { toast.error("Describe the mismatch or conflict before sending for recheck"); return; }
    setFlagging(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: recheckReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to flag for recheck");
      toast.success("Sent for recheck — assigned salesperson notified");
      setRecheckReason("");
      setShowRecheckBox(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFlagging(false);
    }
  };

  const handleResolve = async () => {
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/resolve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <div className={`rounded-lg border p-2.5 space-y-1.5 ${
      isOpenRecheck ? "border-red-200 bg-red-50/50" : item.IsChecked ? "border-emerald-200 bg-emerald-50/30" : "border-border"
    }`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} disabled={locked || isOpenRecheck}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 shrink-0 w-4 h-4 accent-amber-500 disabled:opacity-50" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm ${item.IsChecked ? "text-foreground" : "text-foreground/90"}`}>{item.Label}</span>
            {isOpenRecheck ? (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <ShieldAlert size={10} /> Recheck Open
              </span>
            ) : item.IsChecked ? (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <ShieldCheck size={10} /> Verified
              </span>
            ) : null}
          </div>

          {isOpenRecheck ? (
            <div className="mt-1 text-[11px] text-red-700 space-y-1">
              <div><span className="font-medium">Flagged:</span> {item.RecheckReason}</div>
              {!locked && (
                <button type="button" onClick={handleResolve}
                  className="flex items-center gap-1 text-[11px] font-medium text-red-700 hover:underline">
                  <RotateCcw size={11} /> Mark resolved (issue fixed)
                </button>
              )}
            </div>
          ) : (
            <>
              {!locked && (
                <div className="flex items-center gap-3 mt-1">
                  <button type="button" onClick={handleSave} disabled={saving || !dirty}
                    className="text-[11px] font-medium px-2 py-1 rounded text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 disabled:opacity-40 hover:shadow-lg hover:shadow-amber-500/20">
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setShowRemarksBox((v) => !v)}
                    className="text-[11px] text-muted-foreground hover:text-primary hover:underline">
                    {showRemarksBox ? "Hide" : remarks ? "Remarks noted · edit" : "Remarks"}
                  </button>
                  <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
                    className="text-[11px] font-medium text-red-600 hover:underline flex items-center gap-1">
                    <Send size={11} /> Send for Recheck
                  </button>
                </div>
              )}
              {locked && remarks && <p className="mt-1 text-[11px] text-muted-foreground">— {remarks}</p>}

              {showRemarksBox && !locked && (
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Remarks (optional) — anything noted while confirming this with the customer"
                  rows={2} className="mt-1.5 w-full text-xs border border-border rounded px-2 py-1 bg-background resize-none" />
              )}

              {showRecheckBox && !locked && (
                <div className="mt-1.5 space-y-1">
                  <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                    placeholder="What doesn't match / what's the conflict with the customer's data..."
                    rows={2} className="w-full text-xs border border-red-300 rounded px-2 py-1.5 bg-background resize-none" />
                  <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                    className="text-[11px] font-medium px-2 py-1 rounded bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">
                    {flagging ? "Sending..." : "Confirm — flag for recheck"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Inline verify — the mandatory tick sits directly under the field it
// confirms (Name/Mobile/Project/Bank Account/...), not in a separate list
// further down the page. This is the point: while the telecaller is
// reading a field out loud to the customer, the tick for that exact fact
// is right there to hit immediately, not scrolled away in a block of 7
// other unrelated items. Remarks and the recheck reason both start
// collapsed behind "Remarks" / "Flag for Recheck" — a call in progress
// doesn't need an empty textarea taking up space under every single field
// until there's actually something to write. Same API calls as
// ChecklistItemRow, just laid out for this purpose. ──────────────────────
const InlineVerify: React.FC<{
  item: VcItem | undefined; bookingId: number; locked: boolean; onChanged: () => void;
}> = ({ item, bookingId, locked, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState(item?.Remarks || "");
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [recheckReason, setRecheckReason] = useState("");
  const [showRecheckBox, setShowRecheckBox] = useState(false);

  useEffect(() => { setRemarks(item?.Remarks || ""); }, [item?.Remarks]);

  if (!item) return null;
  const isOpenRecheck = item.RecheckStatus === CrmStatus.OPEN;

  const handleToggleChecked = async () => {
    if (locked || isOpenRecheck || saving) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: !item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRemarks = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsChecked: item.IsChecked, Remarks: remarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Remarks saved");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSendRecheck = async () => {
    if (!recheckReason.trim()) { toast.error("Describe the mismatch or conflict before sending for recheck"); return; }
    setFlagging(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: recheckReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to flag for recheck");
      toast.success("Sent for recheck — assigned salesperson notified");
      setRecheckReason("");
      setShowRecheckBox(false);
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFlagging(false);
    }
  };

  const handleResolve = async () => {
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/items/${item.ItemKey}/resolve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to resolve");
      toast.success("Recheck resolved — please re-verify and tick the item");
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  if (isOpenRecheck) {
    return (
      <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-700 bg-red-50/50 border border-red-200 rounded px-2 py-1">
        <ShieldAlert size={12} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="font-medium">Flagged:</span> {item.RecheckReason}
          {!locked && (
            <button type="button" onClick={handleResolve} className="ml-2 font-medium hover:underline inline-flex items-center gap-0.5">
              <RotateCcw size={10} /> Mark resolved
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <input type="checkbox" checked={item.IsChecked} disabled={locked || saving}
          onChange={handleToggleChecked}
          className="w-3.5 h-3.5 accent-primary disabled:opacity-50" />
        <span className={item.IsChecked ? "text-emerald-700 font-medium" : "text-muted-foreground"}>
          {item.IsChecked ? "Verified" : "Verify"}
        </span>
      </label>
      {!locked && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-primary hover:underline">
          {open ? "Hide" : item.Remarks ? "Remarks noted · edit" : "Remarks / Flag"}
        </button>
      )}
      {locked && item.Remarks && <span className="text-[10px] text-muted-foreground truncate">— {item.Remarks}</span>}

      {open && !locked && (
        <div className="absolute z-10 mt-7 w-72 rounded-lg border border-border bg-background shadow-lg p-2.5 space-y-1.5">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks (optional) — anything noted while confirming this with the customer"
            rows={2} className="w-full text-xs border border-border rounded px-2 py-1 bg-background resize-none" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSaveRemarks} disabled={saving || remarks === (item.Remarks || "")}
              className="text-[11px] font-medium px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90">
              {saving ? "Saving..." : "Save Remarks"}
            </button>
            <button type="button" onClick={() => setShowRecheckBox((v) => !v)}
              className="text-[11px] font-medium text-red-600 hover:underline flex items-center gap-1">
              <Send size={11} /> Flag for Recheck
            </button>
          </div>
          {showRecheckBox && (
            <div className="space-y-1 pt-1 border-t border-border">
              <textarea value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)}
                placeholder="What doesn't match / what's the conflict with the customer's data..."
                rows={2} className="w-full text-xs border border-red-300 rounded px-2 py-1.5 bg-background resize-none" />
              <button type="button" onClick={handleSendRecheck} disabled={flagging || !recheckReason.trim()}
                className="text-[11px] font-medium px-2 py-1 rounded bg-red-500 text-white disabled:opacity-40 hover:bg-red-600">
                {flagging ? "Sending..." : "Confirm — flag for recheck"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Verification checklist — split into composable pieces ─────────────────
// Was one monolithic component rendering all 8 sections back-to-back before
// ANY of the actual customer data (Documents, Co-Applicant, Nominee & Bank
// Details all render further down the page) — so staff hit "PAN confirmed" /
// "Bank account confirmed" checkboxes before they'd even scrolled far enough
// to see the actual PAN or account number to read out to the customer.
// useVerificationChecklist is the single shared data/mutation source (one
// fetch, one refetch keeps every section in sync); ChecklistProgressBar and
// ChecklistSubmitFooter are the non-section chrome; ChecklistSectionBlock
// renders exactly one section's items and is dropped in directly under that
// section's own data card, wherever that card actually lives on the page.
function useVerificationChecklist(bookingId: number) {
  const { data: vc, refetch } = useQuery({
    queryKey: ["crm-welcome-verification-checklist", bookingId],
    queryFn: () => fetchVerificationChecklist(bookingId),
  });
  const [submitting, setSubmitting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const locked = !!vc?.submission?.IsLocked;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/submit`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      toast.success("Welcome call verification submitted and locked");
      refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setReopening(true);
    try {
      const res = await fetchWithAuth(`${VC_API}/${bookingId}/reopen`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reopen");
      toast.success("Checklist reopened for edits");
      refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setReopening(false);
    }
  };

  return { vc, refetch, locked, submitting, reopening, handleSubmit, handleReopen };
}

// Slim, sticky-friendly progress readout — dropped in once near the top of
// the working area (not tied to any one section) so staff always know
// overall completion without needing to scroll to the very end.
const ChecklistProgressBar: React.FC<{ vc: any; bookingId: number }> = ({ vc, bookingId }) => {
  if (!vc) return <div className="text-xs text-muted-foreground">Loading verification checklist…</div>;
  return (
    <div className="rounded-xl border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardList size={14} className="text-amber-600 dark:text-amber-400" /> Verification Checklist</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{vc.checkedCount}/{vc.totalCount} verified</span>
          {vc.openRecheckCount > 0 && (
            <span className="flex items-center gap-1 font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
              <ShieldAlert size={11} /> {vc.openRecheckCount} in recheck
            </span>
          )}
          {vc.submission?.IsLocked && (
            <span className="flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <Lock size={11} /> Locked
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// One section's worth of checklist items — dropped in directly under that
// section's own data card (e.g. sectionKey="BankNominee" right after the
// Nominee & Bank Details card) so the real value being confirmed is always
// the thing staff just looked at, never something further down the page.
const ChecklistSectionBlock: React.FC<{
  vc: any; bookingId: number; locked: boolean; onChanged: () => void; sectionKey: string;
}> = ({ vc, bookingId, locked, onChanged, sectionKey }) => {
  if (!vc) return null;
  const s = vc.sections.find((sec: any) => sec.section === sectionKey);
  if (!s) return null;
  return (
    <div className="rounded-xl border border-border p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ClipboardCheck size={12} className="text-primary" /> Verify: {s.label}
        </h4>
        {s.complete && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700"><ShieldCheck size={11} /> Complete</span>}
      </div>
      <div className="space-y-1.5">
        {s.items.map((item: VcItem) => (
          <ChecklistItemRow key={item.ItemKey} item={item} bookingId={bookingId} locked={locked} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
};

// Final action bar — placed after the last section in DOM order (Nominee &
// Bank Details, currently the last data card on the page). Submitting here
// requires every section's items checked with zero open rechecks, exactly
// as the old single-block version did — this only changes where the items
// themselves render, not the gate itself.
const ChecklistSubmitFooter: React.FC<{
  vc: any; locked: boolean; submitting: boolean; reopening: boolean;
  onSubmit: () => void; onReopen: () => void;
}> = ({ vc, locked, submitting, reopening, onSubmit, onReopen }) => {
  if (!vc) return null;
  return (
    <div className="rounded-xl border border-border p-3.5 space-y-2">
      {locked ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <span className="flex items-center gap-1.5 font-medium"><Lock size={12} /> Submitted and locked{vc.submission?.SubmittedAt ? ` — ${String(vc.submission.SubmittedAt).slice(0, 16).replace("T", " ")}` : ""}</span>
          <button type="button" onClick={onReopen} disabled={reopening}
            className="flex items-center gap-1 font-medium text-emerald-700 hover:underline disabled:opacity-40">
            <Unlock size={12} /> {reopening ? "Reopening..." : "Reopen"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {vc.canSubmit ? "All items verified — ready to submit." : "Every item must be checked, with no open rechecks, before this can be submitted."}
          </p>
          <button type="button" onClick={onSubmit} disabled={!vc.canSubmit || submitting}
            className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 shrink-0">
            {submitting ? "Submitting..." : "Submit Verification"}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Intake dialog: log the call + work through the rest of the checklist ──
const IntakeDialog: React.FC<{ booking: any; onClose: () => void }> = ({ booking, onClose }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  // Auto-fetched, locked by default: the call is almost always logged by
  // whoever is on this screen right now, and the moment it happens — not
  // something staff should have to re-pick/re-type every single time.
  // "Change" unlocks both for the (rarer) case someone is logging a call on
  // a colleague's behalf, or after the fact.
  const [form, setForm] = useState({ ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });
  const [calledByLocked, setCalledByLocked] = useState(true);
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Live call-duration timer — a real "dynamic" touch for a page whose whole
  // job is timing/logging a phone call: start it when the call begins, and
  // Duration auto-fills from the elapsed time when stopped (still editable
  // afterward, in case it needs correcting).
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  useEffect(() => {
    if (!timerRunning) return;
    const start = Date.now() - timerSeconds * 1000;
    const id = setInterval(() => setTimerSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);
  const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const [coForm, setCoForm] = useState({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "" });
  const [addingCo, setAddingCo] = useState(false);

  // Nominee & Bank Details — done inline here now instead of a "go to
  // Customer Bank & Nominee page" link, same shape/API CrmBookingDetail.tsx's
  // own Bank Details tab uses (both read/write the one CrmCustomerBankDetail
  // row keyed by BookingId). Starts locked/read-only — same "re-verify"
  // pattern as this file's own EditCallDialog — since this is often already
  // on file from the Application stage; the point of showing it here is to
  // confirm it out loud with the customer on the call, not silently retype it.
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankLoaded, setBankLoaded] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankLocked, setBankLocked] = useState(true);

  // Which Financial Summary card is expanded — Payment Plan and Bank
  // Preference are collapsed by default; tapping either flexes it open to
  // show the real detail (milestone schedule / full loan record) instead of
  // just the one-line teaser.
  const [expandedCard, setExpandedCard] = useState<"plan" | "bank" | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);
  // Was a fixed 300px sidebar + narrow column crammed into max-w-6xl with
  // 11px fonts everywhere — genuinely well-architected underneath (single
  // shared checklist source, verify-next-to-the-real-data placement, a live
  // call timer, a tri-state readiness stepper) but unreadable. Same fix as
  // CrmBookingDetail.tsx: tabs, with each checklist section still dropped in
  // right next to the data card it verifies — just given actual room.
  const WC_TABS = ["Overview", "Documents", "Co-Applicant", "Bank & Nominee"] as const;
  type WcTab = typeof WC_TABS[number];
  const [wcTab, setWcTab] = useState<WcTab>("Overview");

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: checklist, refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-welcome-checklist", booking.BookingId],
    queryFn: () => fetchChecklist(booking.BookingId),
  });
  const { data: callContext } = useQuery({
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
  const { data: parkingAllotments = [] } = useQuery({
    queryKey: ["crm-welcome-parking", booking.BookingId],
    queryFn: () => fetchParkingAllotments(booking.BookingId),
  });
  const { data: extraCharges = [] } = useQuery({
    queryKey: ["crm-welcome-extra-charges", booking.BookingId],
    queryFn: () => fetchExtraCharges(booking.BookingId),
  });
  // Only fetched once its card is actually expanded — no point loading the
  // full milestone schedule / full loan record on every call just to show a
  // one-line teaser.
  const { data: milestones = [] } = useQuery({
    queryKey: ["crm-welcome-milestones", booking.BookingId],
    queryFn: () => fetchBookingMilestones(booking.BookingId),
    enabled: expandedCard === "plan",
  });
  const { data: loanDetail, isLoading: loanLoading } = useQuery({
    queryKey: ["crm-welcome-loan", booking.BookingId],
    queryFn: () => fetchLoanDetail(booking.BookingId),
    enabled: expandedCard === "bank",
  });
  // Single shared source for the verification checklist — every
  // ChecklistSectionBlock dropped in near its matching data card below
  // reads from this same vc/refetch pair, so ticking an item in one place
  // and the progress bar / submit gate elsewhere always agree.
  const vcState = useVerificationChecklist(booking.BookingId);
  useEffect(() => {
    let cancelled = false;
    setBankLoaded(false);
    fetchBankDetail(booking.BookingId).then((d) => {
      if (cancelled) return;
      setBank({
        BankName: d?.BankName || "", BranchName: d?.BranchName || "", AccountNo: d?.AccountNo || "",
        IfscCode: d?.IfscCode || "", AccountHolderName: d?.AccountHolderName || "",
        PanNo: d?.PanNo || "", AadhaarNo: d?.AadhaarNo || "",
        Occupation: d?.Occupation || "", AnnualIncome: d?.AnnualIncome != null ? String(d.AnnualIncome) : "",
        NomineeName: d?.NomineeName || "", NomineeRelation: d?.NomineeRelation || "",
        NomineeDob: d?.NomineeDob ? String(d.NomineeDob).slice(0, 10) : "",
        NomineeContact: d?.NomineeContact || "", NomineeAddress: d?.NomineeAddress || "",
      });
    }).finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [booking.BookingId]);

  const invalidateQueue = () => qc.invalidateQueries({ queryKey: ["crm-welcome-queue"] });

  // Saving here also refetches the checklist — Bank/Nominee completeness
  // feeds both the checklist strip AND (server-side) the Agreement
  // auto-creation gate (maybeAutoCreateAgreement), so this is the one save
  // that can silently unlock a Draft Agreement the moment it lands.
  const handleSaveBank = async () => {
    setBankSaving(true);
    try {
      const res = await fetchWithAuth(`${BANK_DETAIL_API}/booking/${booking.BookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bank),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Bank & Nominee details saved");
      setBankLocked(true);
      refetchChecklist();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBankSaving(false);
    }
  };

  // Full invoice rows aren't in call-context's trimmed projection — fetch
  // the real list (same endpoint CrmBookingDetail.tsx's own Invoices tab
  // reads) on demand and pull out the one that was tapped, rather than
  // needing a dedicated single-invoice endpoint that doesn't exist.
  const handleViewInvoice = async (invoiceNo: string) => {
    const list = await fetchBookingInvoices(booking.BookingId);
    const found = list.find((i: any) => i.InvoiceNo === invoiceNo);
    if (found) setViewingInvoice(found);
    else toast.error("Could not load invoice detail");
  };

  const handleLogCall = async () => {
    // Without this, "Log Call" happily saves a row with nothing but who
    // called and when — Outcome is the one field every other screen
    // (queue, history, checklist) actually reads to know what happened on
    // the call, so a blank one is a useless log entry masquerading as a
    // real one.
    if (!form.Outcome) { toast.error("Select an outcome before logging the call"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: booking.BookingId,
          CalledBy: form.CalledBy || null,
          CallDate: form.CallDate || null,
          // The live timer wins if it was used and nobody typed a manual
          // override — matches what actually happened on the call instead
          // of staff having to copy the number across by hand.
          DurationSeconds: form.DurationSeconds || (timerSeconds > 0 ? String(timerSeconds) : null),
          Outcome: form.Outcome || null,
          NextCallDate: form.NextCallDate || null,
          Notes: form.Notes || null,
          PreferredAgreementDate: form.PreferredAgreementDate || null,
          CustomFields: customFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log call");
      setForm({ ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });
      setCustomFields([]);
      setTimerRunning(false);
      setTimerSeconds(0);
      refetchChecklist();
      invalidateQueue();
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
      qc.invalidateQueries({ queryKey: ["crm-communication"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });

      // Auto-flow: every logged call is seeded into the Communication Log
      // server-side already — once the customer is actually Welcomed, hand
      // the whole flow off to that page for ongoing follow-up/tasks instead
      // of leaving staff sitting on this dialog.
      if (form.Outcome === "Welcomed") {
        toast.success("Welcome call logged — continuing in Communication Log");
        onClose();
        navigate(`/crm/communication?bookingId=${booking.BookingId}`);
      } else if (["NotReachable", "Busy", "SwitchedOff", "VoiceMail"].includes(form.Outcome)) {
        // Auto-set next call date to tomorrow so the booking doesn't
        // silently fall out of queue without a follow-up scheduled.
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
        const tomorrowStr = tomorrow.toISOString().slice(0, 16);
        setForm((f) => ({ ...f, NextCallDate: f.NextCallDate || tomorrowStr }));
        toast.info("Call logged. Next call auto-scheduled for tomorrow — edit if needed.");
      } else {
        toast.success("Welcome call logged");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    }
  };

  const handleRemoveCoApplicant = async (id: number) => {
    try {
      await fetchWithAuth(`${CO_API}/${id}`, { method: "DELETE" });
      refetchCo();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <PhoneCall size={18} className="text-amber-600 dark:text-amber-400" />
            Welcome Call — {booking.ApplicantName} <span className="text-muted-foreground font-normal text-sm">({booking.BookingNo})</span>
          </DialogTitle>
        </DialogHeader>

        {/* Persistent header — contact + project/unit + address, stays
            visible across every tab since it's what the telecaller needs on
            screen for the entire call, not just one section of it. */}
        <div className="rounded-xl border border-border bg-muted/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <ContactActionBar
            applicantName={callContext?.customer?.CustomerName || booking.ApplicantName}
            mobile={callContext?.customer?.Mobile || booking.Mobile}
            email={callContext?.customer?.Email || null}
          />
          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:text-right sm:border-l sm:border-border sm:pl-4">
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Building2 size={12} className="shrink-0" />
              <span className="truncate">{callContext?.booking?.ProjectName || booking.ProjectName || "—"}</span>
            </div>
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Car size={12} className="shrink-0" />
              <span className="truncate">Unit {callContext?.booking?.UnitNo || booking.UnitNo || "—"}</span>
            </div>
            {/* Backs the "Communication address confirmed" checklist item on
                the Overview tab — call-context previously only carried
                Name/Mobile/Email/PAN, so that item had no data anywhere on
                the page to actually verify against. */}
            {(callContext?.customer?.Address || callContext?.customer?.City) && (
              <div className="flex items-start gap-1.5 sm:justify-end max-w-xs">
                <MapPin size={12} className="shrink-0 mt-0.5" />
                <span>
                  {[callContext.customer.Address, callContext.customer.City, callContext.customer.State, callContext.customer.Pincode]
                    .filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Persistent verification progress — the master submit-readiness
            gate, same "always visible regardless of which tab you're on"
            treatment as CrmBookingDetail.tsx's Data Review Checklist strip. */}
        <ChecklistProgressBar vc={vcState.vc} bookingId={booking.BookingId} />

        {/* F3 — Escalation banner: fires when customer has been unreachable 3+ consecutive times */}
        {(callContext?.consecutiveNonReached ?? 0) >= 3 && (
          <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">
                Customer unreachable — {callContext!.consecutiveNonReached} consecutive attempt{callContext!.consecutiveNonReached !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                Consider escalating to a manager or trying a different contact method before logging another attempt.
              </p>
            </div>
          </div>
        )}

        {/* Split from the middle: Log Call is the one thing staff are
            actively doing on every single call, so it stays permanently on
            screen on the left — never buried behind a tab click mid-call.
            Everything else (customer/booking reference data + its matching
            verify ticks, documents, co-applicant, bank/nominee) lives in
            tabs on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
          <div className="lg:sticky lg:top-0 space-y-4">
            {/* ── Log Call ── */}
            <div className="rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Phone size={14} className="text-primary" /> Log This Call</h3>
                {/* Live duration timer — a genuinely dynamic touch: start it the
                    moment the call connects, it counts up on-screen, and Duration
                    below auto-fills from it when stopped. */}
                <div className="flex items-center gap-2">
                  {timerRunning && <span className="font-mono text-sm font-semibold text-primary tabular-nums">{fmtTimer(timerSeconds)}</span>}
                  <button type="button" onClick={() => setTimerRunning((r) => !r)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
                      timerRunning ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}>
                    <Timer size={13} /> {timerRunning ? "Stop Timer" : "Start Call Timer"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Called By</label>
                  {calledByLocked ? (
                    <div className="flex items-center justify-between gap-2 bg-muted/30 rounded px-2 py-1.5 border border-border">
                      <span className="text-sm text-foreground truncate">{currentUser?.name || "Self"} <span className="text-xs text-muted-foreground">(you)</span></span>
                      <button type="button" onClick={() => setCalledByLocked(false)} className="text-xs text-primary hover:underline shrink-0">Change</button>
                    </div>
                  ) : (
                    <select value={form.CalledBy} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">— Self —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Call Date & Time</label>
                  <input type="datetime-local" value={form.CallDate}
                    onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1">
                    Duration {timerSeconds > 0 && !form.DurationSeconds ? <span className="text-emerald-600">(from timer — edit if needed)</span> : ""}
                  </label>
                  {/* MM:SS picker — converts to seconds on change */}
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={0} max={999}
                      value={form.DurationSeconds ? String(Math.floor(Number(form.DurationSeconds) / 60)) : timerSeconds > 0 ? String(Math.floor(timerSeconds / 60)) : ""}
                      onChange={(e) => {
                        const mm = Math.max(0, Number(e.target.value) || 0);
                        const ss = form.DurationSeconds ? Number(form.DurationSeconds) % 60 : timerSeconds % 60;
                        setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                      }}
                      placeholder="MM"
                      className="w-16 text-sm border border-border rounded px-2 py-1.5 bg-background text-center" />
                    <span className="text-muted-foreground font-semibold">:</span>
                    <input type="number" min={0} max={59}
                      value={form.DurationSeconds ? String(Number(form.DurationSeconds) % 60).padStart(2, "0") : timerSeconds > 0 ? String(timerSeconds % 60).padStart(2, "0") : ""}
                      onChange={(e) => {
                        const ss = Math.min(59, Math.max(0, Number(e.target.value) || 0));
                        const mm = form.DurationSeconds ? Math.floor(Number(form.DurationSeconds) / 60) : Math.floor(timerSeconds / 60);
                        setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                      }}
                      placeholder="SS"
                      className="w-16 text-sm border border-border rounded px-2 py-1.5 bg-background text-center" />
                    <span className="text-xs text-muted-foreground ml-1">min : sec</span>
                    {form.DurationSeconds && Number(form.DurationSeconds) > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto">{Number(form.DurationSeconds)}s total</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick-pick outcome chips — one tap instead of a dropdown, colored
                  to match the same outcomeColor scheme used everywhere else this
                  value is shown (queue, history, edit dialog). */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Outcome</label>
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOMES.map((o) => (
                    <button key={o} type="button" onClick={() => setForm((f) => ({ ...f, Outcome: o }))}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                        form.Outcome === o ? outcomeColor[o] : "border-border text-muted-foreground hover:bg-muted/40"
                      }`}>
                      {form.Outcome === o && <Check size={11} className="inline mr-1 -mt-0.5" />}{o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><CalendarClock size={11} /> Schedule Follow-up Call</label>
                  <input type="date" value={form.NextCallDate}
                    onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div>
                  {/* Purely an informal note for whoever preps the real
                      Agreement later — this is never what actually sets
                      AgreementDate. The real date is only ever proposed
                      once the Agreement exists (CrmAgreement.tsx's Propose
                      Agreement Date flow, requiring both sides to match and
                      a super_admin sign-off). Labeled explicitly so this
                      never reads as if it's already the confirmed date. */}
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><CalendarClock size={11} /> Discussed Agreement Date (note only)</label>
                  <input type="date" value={form.PreferredAgreementDate}
                    onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                  <p className="text-[10px] text-muted-foreground mt-1">Not the formal proposal — that happens later on the Agreement page.</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><StickyNote size={11} /> Notes</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={3} placeholder="What was discussed on this call..."
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>

              {/* Dynamic custom fields */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><ListPlus size={11} /> Additional Fields</label>
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

              <button onClick={handleLogCall} disabled={saving || !form.Outcome}
                title={!form.Outcome ? "Select an outcome above first" : undefined}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Logging..." : "Log Call"}
              </button>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto thin-scroll">
          {WC_TABS.map((t) => (
            <button key={t} onClick={() => setWcTab(t)}
              className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                wcTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {t}
            </button>
          ))}
        </div>

        {wcTab === "Overview" && (
        <div className="space-y-4 pt-1">
            {/* ── Customer — each field with its own mandatory tick directly
                underneath, so while the telecaller reads the field out loud
                to the customer, the tick for that exact fact is right there
                to hit immediately, not scrolled off in a separate list. ── */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Users size={14} className="text-primary" /> Customer</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Name</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.CustomerName || booking.ApplicantName || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "applicant_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Mobile</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.Mobile || booking.Mobile || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "mobile_number")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Email</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.Email || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "email")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative col-span-2 md:col-span-1">
                  <label className="text-[11px] text-muted-foreground block">Address</label>
                  <div className="text-sm font-medium truncate" title={[callContext?.customer?.Address, callContext?.customer?.City, callContext?.customer?.State, callContext?.customer?.Pincode].filter(Boolean).join(", ")}>
                    {[callContext?.customer?.Address, callContext?.customer?.City].filter(Boolean).join(", ") || "—"}
                  </div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "address")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
              </div>
            </div>

            {/* ── Application & Booking details — same pairing pattern ── */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Building2 size={14} className="text-primary" /> Application &amp; Booking</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Project</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.ProjectName || booking.ProjectName || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "project_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Unit</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.UnitNo || booking.UnitNo || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "unit_no")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Booking Date</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.BookingDate ? new Date(callContext.booking.BookingDate).toLocaleDateString("en-IN") : "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "booking_date")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="text-[11px] text-muted-foreground block">Total Value</label>
                  <div className="text-sm font-medium truncate">{fmt(callContext?.booking?.GrandTotal ?? callContext?.booking?.TotalValue)}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "total_value")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3.5 space-y-2.5">
              {(() => {
                const cleared = Number(callContext?.outstanding?.totalPaid ?? 0);
                const mrReceived = Number(callContext?.mrReceived ?? 0);
                const bk = callContext?.booking;
                const storedGrand = Number(bk?.GrandTotal ?? 0);
                const grandTotal = storedGrand > 0 ? storedGrand : (Number(bk?.TotalValue || 0) + Number(bk?.ParkingTotal || 0) + Number(bk?.ExtraChargesTotal || 0));
                return (
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={cleared}
                    pendingReceipts={Math.max(0, mrReceived - cleared)}
                    approvedOnAccount={Number(callContext?.onAccount?.availableBalance ?? 0)}
                    overdueCount={milestones.filter((m: any) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date()).length}
                    compact
                  />
                );
              })()}
              <div className="pt-1">
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "outstanding_balance")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
              {/* Payment Plan — tap to flex open the real milestone
                  schedule instead of just the plan name. */}
              <div className="relative rounded-lg border border-border bg-background overflow-hidden">
                <button type="button" onClick={() => setExpandedCard((c) => c === "plan" ? null : "plan")}
                  className="w-full text-left p-2.5 text-xs hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-muted-foreground"><ClipboardCheck size={11} /> Payment Plan</span>
                    <ChevronRight size={12} className={`text-muted-foreground transition-transform ${expandedCard === "plan" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="font-medium text-sm truncate" title={callContext?.booking?.PaymentPlanName}>{callContext?.booking?.PaymentPlanName || "7-stage default"}</div>
                </button>
                <div className="px-2.5 pb-2">
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "plan_structure")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                {expandedCard === "plan" && (
                  <div className="border-t border-border px-2.5 py-1.5 space-y-1.5 bg-muted/10">
                    {milestones.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No milestone schedule generated yet.</p>
                    ) : milestones.map((m: any) => {
                      // Due/Paid per milestone are already the real, live
                      // numbers — including any excess from an earlier
                      // milestone auto-swept in via on-account (crmPayments.js's
                      // autoApplyOnAccount caps a milestone's own AmountPaid at
                      // its AmountDue and carries any further excess forward to
                      // the next milestone), so this stays accurate with zero
                      // extra plumbing here — just render what's already there.
                      const due = Number(m.AmountDue || 0);
                      const paid = Number(m.AmountPaid || 0);
                      const balance = Math.max(0, due - paid);
                      const isDone = m.Status === CrmStatus.PAID || m.Status === "Waived";
                      const label = m.Status === "Waived" ? "Waived" : isDone ? "Paid" : paid > 0 ? "Partially Paid" : "Pending";
                      return (
                        <div key={m.Id} className="text-[11px] space-y-0.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-foreground/90 truncate">{m.MilestoneNo}. {m.MilestoneName}</span>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded-full border font-medium ${
                              isDone ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                : paid > 0 ? "text-amber-700 bg-amber-50 border-amber-200"
                                : "text-muted-foreground bg-muted/40 border-border"
                            }`}>{label}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Due {fmt(due)}</span>
                            {paid > 0 && <span className="text-emerald-700">Paid {fmt(paid)}</span>}
                            {!isDone && balance > 0 && <span className="text-amber-700">Balance {fmt(balance)}</span>}
                          </div>
                        </div>
                      );
                    })}
                    <div className="relative pt-0.5">
                      <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "milestone_dates")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                    </div>
                  </div>
                )}
              </div>

              {/* Bank Preference (home loan) — a genuinely separate record
                  from the customer's own Nominee & Bank Details below (that's
                  KYC/refund banking; this is which bank is financing the
                  purchase). Tap to flex open the full loan record, sourced
                  straight from the same GET the Home Loan Tracking page
                  itself uses (dbo.CrmLoanDetail via GET /:id/loan) rather
                  than the trimmed subset call-context carries. */}
              <div className="rounded-lg border border-border bg-background overflow-hidden">
                <button type="button" onClick={() => setExpandedCard((c) => c === "bank" ? null : "bank")}
                  className="w-full text-left p-2.5 text-xs hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-muted-foreground"><Landmark size={11} /> Bank Preference (Home Loan)</span>
                    <ChevronRight size={12} className={`text-muted-foreground transition-transform ${expandedCard === "bank" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="font-medium text-sm truncate" title={callContext?.loan?.BankName}>{callContext?.loan?.BankName || "Not on file"}</div>
                </button>
                {expandedCard === "bank" && (
                  <div className="border-t border-border px-2.5 py-2 space-y-1 bg-muted/10 text-[11px]">
                    {loanLoading ? (
                      <p className="text-muted-foreground">Loading...</p>
                    ) : !loanDetail ? (
                      <p className="text-muted-foreground">No loan/bank preference on file — record one from the Home Loan Tracking page.</p>
                    ) : (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">Bank / Branch</span><span className="font-medium">{loanDetail.BankName || "—"}{loanDetail.BranchName ? ` · ${loanDetail.BranchName}` : ""}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Loan Amount</span><span className="font-medium">{fmt(loanDetail.LoanAmount)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Sanction Status</span><span className="font-medium">{loanDetail.SanctionStatus || "NotApplied"}</span></div>
                        {loanDetail.DisbursedAmount > 0 && (
                          <div className="flex justify-between"><span className="text-muted-foreground">Disbursed</span><span className="font-medium">{fmt(loanDetail.DisbursedAmount)}</span></div>
                        )}
                        {loanDetail.LoanAccountNo && (
                          <div className="flex justify-between"><span className="text-muted-foreground">Loan A/c No.</span><span className="font-medium font-mono">{loanDetail.LoanAccountNo}</span></div>
                        )}
                        {loanDetail.RmName && (
                          <div className="flex justify-between"><span className="text-muted-foreground">RM</span><span className="font-medium">{loanDetail.RmName}{loanDetail.RmContact ? ` · ${loanDetail.RmContact}` : ""}</span></div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {(callContext?.invoices?.length ?? 0) > 0 && (
                <div className="text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground block mb-1">Invoices</span>
                  <div className="flex flex-wrap gap-1">
                    {callContext.invoices.map((inv: any) => (
                      <button key={inv.InvoiceNo} type="button" onClick={() => handleViewInvoice(inv.InvoiceNo)}
                        className="inline-block px-1.5 py-0.5 rounded border border-border font-mono text-[11px] hover:bg-muted hover:border-amber-500/40">
                        {inv.InvoiceNo} ({fmt(inv.Amount)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Parking & Extra Charges — read-only reference so staff can
                actually see what was sold before confirming it with the
                customer. Always shown (even with nothing sold) since both
                checklist items are "confirmed... or marked N/A if none" —
                the tick still needs a place to live either way. */}
            <div className="rounded-xl border border-border p-3.5 space-y-2.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Parking &amp; Extra Charges</h4>
              <div className="relative space-y-1">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Car size={11} /> Parking</span>
                {parkingAllotments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None on this booking.</p>
                ) : parkingAllotments.map((p: any) => (
                  <div key={p.Id} className="flex items-center justify-between text-xs rounded-lg border border-border bg-background px-2.5 py-1.5">
                    <span className="truncate">{p.ParkingSlotNo || p.ParkingType || "Slot"} {p.Quantity > 1 ? `× ${p.Quantity}` : ""}</span>
                    <span className="font-medium shrink-0">{fmt(p.TotalAmount)}</span>
                  </div>
                ))}
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "parking_selection")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
              <div className="relative space-y-1 pt-1">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><IndianRupee size={11} /> Extra Charges</span>
                {extraCharges.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None on this booking.</p>
                ) : extraCharges.map((c: any) => (
                  <div key={c.Id} className="flex items-center justify-between text-xs rounded-lg border border-border bg-background px-2.5 py-1.5">
                    <span className="truncate">{c.Description || c.MasterChargeName || "Extra charge"}</span>
                    <span className="font-medium shrink-0">{fmt(c.TotalAmount)}</span>
                  </div>
                ))}
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "extra_charges")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
            </div>

            {/* Booking Readiness — horizontal strip now that there's actual
                room, same tri-state logic as before: "blank" (never
                touched), "progress" (started but not yet clean/complete —
                amber), "done" (green — genuinely finished, e.g. the
                customer was actually Welcomed, not just called). */}
            {checklist && (
              <div className="rounded-xl border border-border p-3.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Booking Readiness</h4>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {(() => {
                    const hasNoc = checklist.noc.length > 0;
                    const nocIssued = checklist.noc.some((n: any) => n.Status === "Issued");
                    const steps: { label: string; state: "blank" | "progress" | "done" }[] = [
                      { label: "Welcome Call", state: checklist.welcomeCall.done ? "done" : checklist.welcomeCall.called ? "progress" : "blank" },
                      { label: "Documents Verified", state:
                        checklist.documents.total === 0 ? "blank"
                        : checklist.documents.verified === checklist.documents.total ? "done" : "progress" },
                      { label: "Co-Applicant Added", state: checklist.coApplicants.count > 0 ? "done" : "blank" },
                      { label: "Bank & Nominee", state: checklist.bankDetails.complete ? "done" : checklist.bankDetails.started ? "progress" : "blank" },
                      { label: "NOC Issued", state: nocIssued ? "done" : hasNoc ? "progress" : "blank" },
                      { label: "Agreement", state: checklist.agreement?.Status === CrmStatus.EXECUTED ? "done" : checklist.agreement ? "progress" : "blank" },
                    ];
                    return steps.map((s) => (
                      <div key={s.label} className="flex items-center gap-1.5 text-xs">
                        <span className={`flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                          s.state === "done" ? "bg-emerald-500 text-white"
                          : s.state === "progress" ? "bg-amber-400 text-white"
                          : "border border-border text-transparent"
                        }`}>
                          {s.state === "done" && <Check size={10} />}
                        </span>
                        <span className={s.state === "done" ? "text-foreground" : s.state === "progress" ? "text-amber-600" : "text-muted-foreground"}>{s.label}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
        </div>
        )}

        {wcTab === "Documents" && (
        <div className="space-y-4 pt-1">
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

            <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="Documents" />
        </div>
        )}

        {wcTab === "Co-Applicant" && (
        <div className="space-y-4 pt-1">
            {/* ── Co-Applicant — full detail cards, not a one-line summary ── */}
            <div className="rounded-xl border border-border p-4 space-y-2.5">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Users size={14} /> Co-Applicant</h3>
              {coApplicants.length === 0 && !addingCo && (
                <p className="text-xs text-muted-foreground">No co-applicant on this booking yet.</p>
              )}
              {coApplicants.map((c: any) => (
                <div key={c.Id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm text-foreground">{c.Name}{c.Relation ? <span className="text-muted-foreground font-normal"> · {c.Relation}</span> : ""}</div>
                    <button onClick={() => handleRemoveCoApplicant(c.Id)} className="text-xs text-red-600 hover:underline shrink-0">Remove</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
                    <div><span className="text-muted-foreground block">Mobile</span>{c.Mobile || "—"}</div>
                    <div><span className="text-muted-foreground block">Email</span>{c.Email || "—"}</div>
                    <div><span className="text-muted-foreground block">PAN</span>{c.PanNo || "—"}</div>
                    <div><span className="text-muted-foreground block">Aadhaar</span>{c.AadhaarNo || "—"}</div>
                  </div>
                </div>
              ))}
              {!addingCo ? (
                <button onClick={() => setAddingCo(true)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5">
                  <Plus size={11} /> Add Co-Applicant
                </button>
              ) : (
                <div className="space-y-2 pt-1 rounded-lg border border-border p-3">
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
                    <button onClick={handleAddCoApplicant} className="text-xs px-3 py-1.5 text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20">Save</button>
                    <button onClick={() => setAddingCo(false)} className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="CoApplicant" />
        </div>
        )}

        {wcTab === "Bank & Nominee" && (
        <div className="space-y-4 pt-1">
            {/* ── Nominee & Bank Details — done here, not a link to another
                page. Starts locked/read-only (this is usually already on
                file from the Application stage) — "Edit" unlocks it for a
                genuine re-verify-on-the-call correction, and saving re-locks
                automatically. Saving also refetches the checklist so "Bank &
                Nominee" on the left updates immediately, and (server-side)
                can unlock the Agreement auto-creation the moment this is the
                last prerequisite still missing. ── */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Landmark size={14} /> Nominee & Bank Details</h3>
                <div className="flex items-center gap-2">
                  {checklist?.bankDetails.complete && (
                    <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Complete</span>
                  )}
                  {bankLoaded && bankLocked && (
                    <button onClick={() => setBankLocked(false)}
                      className="flex items-center gap-1 text-xs px-2 py-1 border border-border rounded-lg font-medium hover:bg-muted">
                      <Pencil size={11} /> Edit / Re-verify
                    </button>
                  )}
                </div>
              </div>
              {/* Portal hint — customer already has a login since booking was
                  confirmed. If they prefer to self-fill bank/nominee details,
                  tell them to log in. Staff still verify the data here during
                  the welcome call either way. */}
              {!checklist?.bankDetails.complete && (
                <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                  <Send size={12} className="shrink-0 mt-0.5" />
                  <span>
                    <span className="font-medium">Tip:</span> The customer already has a portal login (auto-created at booking confirmation). If they prefer to self-enter their bank &amp; nominee details, ask them to log in at the Customer Portal — their entries will reflect here automatically.
                  </span>
                </div>
              )}
              {bankLocked && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                  <Lock size={10} /> Locked for viewing — read this back to the customer to confirm, or click "Edit / Re-verify" to correct it.
                </p>
              )}
              {!bankLoaded ? (
                <p className="text-xs text-muted-foreground py-2">Loading...</p>
              ) : (
                <>
                  {/* Grouped exactly the way the checklist items themselves
                      are defined (e.g. "Bank name & account number" is one
                      tick covering two fields) — the tick sits once, right
                      under the group of fields it actually confirms. */}
                  {[
                    { itemKey: "bank_account", fields: [{ key: "BankName", label: "Bank Name" }, { key: "AccountNo", label: "Account Number" }, { key: "AccountHolderName", label: "Account Holder Name" }] },
                    { itemKey: "ifsc_branch", fields: [{ key: "IfscCode", label: "IFSC Code" }, { key: "BranchName", label: "Branch Name" }] },
                    { itemKey: "pan", fields: [{ key: "PanNo", label: "PAN Number" }] },
                    { itemKey: "aadhaar", fields: [{ key: "AadhaarNo", label: "Aadhaar Number" }] },
                    { itemKey: "occupation_income", fields: [{ key: "Occupation", label: "Occupation" }, { key: "AnnualIncome", label: "Annual Income", type: "number" }] },
                  ].map((group) => (
                    <div key={group.itemKey} className="relative rounded-lg border border-border/60 p-2.5">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                        {group.fields.map((f) => (
                          <div key={f.key}>
                            <label className="text-[11px] text-muted-foreground block mb-1">{f.label}</label>
                            <input type={f.type || "text"} value={(bank as any)[f.key] || ""}
                              disabled={bankLocked}
                              onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background disabled:opacity-60 disabled:cursor-not-allowed" />
                          </div>
                        ))}
                      </div>
                      <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === group.itemKey)} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                    </div>
                  ))}

                  {[
                    { itemKey: "nominee_details", fields: [{ key: "NomineeName", label: "Nominee Name" }, { key: "NomineeRelation", label: "Relation" }, { key: "NomineeDob", label: "Nominee DOB", type: "date" }] },
                    { itemKey: "nominee_contact", fields: [{ key: "NomineeContact", label: "Nominee Contact" }] },
                  ].map((group) => (
                    <div key={group.itemKey} className="relative rounded-lg border border-border/60 p-2.5">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                        {group.fields.map((f) => (
                          <div key={f.key}>
                            <label className="text-[11px] text-muted-foreground block mb-1">{f.label}</label>
                            <input type={f.type || "text"} value={(bank as any)[f.key] || ""}
                              disabled={bankLocked}
                              onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background disabled:opacity-60 disabled:cursor-not-allowed" />
                          </div>
                        ))}
                        {group.itemKey === "nominee_contact" && (
                          <div className="col-span-2">
                            <label className="text-[11px] text-muted-foreground block mb-1">Nominee Address</label>
                            <textarea value={bank.NomineeAddress} disabled={bankLocked}
                              onChange={(e) => setBank((b) => ({ ...b, NomineeAddress: e.target.value }))}
                              rows={1} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none disabled:opacity-60 disabled:cursor-not-allowed" />
                          </div>
                        )}
                      </div>
                      <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === group.itemKey)} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                    </div>
                  ))}
                  {!bankLocked && (
                    <div className="flex gap-2">
                      <button onClick={handleSaveBank} disabled={bankSaving}
                        className="px-4 py-1.5 text-sm text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40">
                        {bankSaving ? "Saving..." : "Save Bank & Nominee Details"}
                      </button>
                      <button onClick={() => setBankLocked(true)}
                        className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <ChecklistSubmitFooter
              vc={vcState.vc} locked={vcState.locked} submitting={vcState.submitting} reopening={vcState.reopening}
              onSubmit={vcState.handleSubmit} onReopen={vcState.handleReopen}
            />
        </div>
        )}
          </div>
        </div>

        <div className="flex justify-end pt-3 mt-1 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>

    {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}

    {/* Invoice PDF preview — real generated PDF, same as CrmBookingDetail.tsx's Payment & Invoice tab */}
    {viewingInvoice && (
      <InvoicePdfDialog bookingId={booking.BookingId} invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
    )}
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
  // Always opens on an existing logged call, so always opens locked.
  const [locked, setLocked] = useState(true);
  const inputCls = `w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

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
      setLocked(true);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    } finally {
      setDeleting(false);
    }
  };

  const selectedOutcomeStyle = form.Outcome ? outcomeColor[form.Outcome] : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
            <span className="flex items-center gap-2">
              <Phone size={16} className="text-amber-600 dark:text-amber-400" /> Edit Welcome Call
            </span>
            {locked && (
              <button onClick={() => setLocked(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                <Pencil size={12} /> Edit
              </button>
            )}
          </DialogTitle>
        </DialogHeader>
        {locked && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5">
            <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
          </div>
        )}

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
                <select value={form.CalledBy} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                  className={inputCls}>
                  <option value="">—</option>
                  {users.map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Call Date/Time</label>
                <input type="datetime-local" value={form.CallDate} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                <select value={form.Outcome} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, Outcome: e.target.value }))}
                  className={`w-full text-sm border rounded-lg px-2.5 py-2 font-medium ${selectedOutcomeStyle || "bg-background border-border"} ${locked ? "opacity-70 cursor-not-allowed" : ""}`}>
                  <option value="">—</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Duration</label>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} max={999} disabled={locked}
                    value={form.DurationSeconds ? String(Math.floor(Number(form.DurationSeconds) / 60)) : ""}
                    onChange={(e) => {
                      const mm = Math.max(0, Number(e.target.value) || 0);
                      const ss = form.DurationSeconds ? Number(form.DurationSeconds) % 60 : 0;
                      setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                    }}
                    placeholder="MM"
                    className={`w-14 text-sm border border-border rounded px-2 py-1.5 bg-background text-center ${locked ? "opacity-70 cursor-not-allowed" : ""}`} />
                  <span className="text-muted-foreground font-semibold">:</span>
                  <input type="number" min={0} max={59} disabled={locked}
                    value={form.DurationSeconds ? String(Number(form.DurationSeconds) % 60).padStart(2, "0") : ""}
                    onChange={(e) => {
                      const ss = Math.min(59, Math.max(0, Number(e.target.value) || 0));
                      const mm = form.DurationSeconds ? Math.floor(Number(form.DurationSeconds) / 60) : 0;
                      setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                    }}
                    placeholder="SS"
                    className={`w-14 text-sm border border-border rounded px-2 py-1.5 bg-background text-center ${locked ? "opacity-70 cursor-not-allowed" : ""}`} />
                  <span className="text-xs text-muted-foreground">m:s</span>
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
                <input type="date" value={form.NextCallDate} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Discussed Agreement Date (note only)</label>
                <input type="date" value={form.PreferredAgreementDate} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><FileCheck size={14} /> Notes</h3>
            <textarea value={form.Notes} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
              rows={3} placeholder="What was discussed on this call..."
              className={`${inputCls} resize-none`} />
          </div>

          {/* ── Custom fields ── */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground"><Users size={14} /> Custom Fields</h3>
            {customFields.length === 0 && <p className="text-xs text-muted-foreground">No custom fields added for this call.</p>}
            {customFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="Field name" value={f.key} readOnly={locked}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                  className={`flex-1 ${inputCls}`} />
                <input placeholder="Value" value={f.value} readOnly={locked}
                  onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className={`flex-1 ${inputCls}`} />
                <button onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))} disabled={locked}
                  className="text-muted-foreground hover:text-red-600 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={() => setCustomFields((cf) => [...cf, { key: "", value: "" }])} disabled={locked}
              className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">+ Add field</button>
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-border">
          <button onClick={handleDelete} disabled={deleting}
            className="text-xs px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-40">
            {deleting ? "Removing..." : "Delete Call"}
          </button>
          <div className="flex gap-2">
            {locked ? (
              <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={() => { setLocked(true); onClose(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 text-sm text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const CrmWelcomeCall: React.FC = () => {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"queue" | "recheck" | "history">("queue");
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
  const { data: recheckQueue = [], isLoading: recheckLoading } = useQuery({
    queryKey: ["crm-welcome-recheck-queue"],
    queryFn: fetchRecheckQueue,
    staleTime: 30_000,
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

  const filteredRecheckQueue = useMemo(() =>
    (recheckQueue as any[]).filter((c: any) =>
      !search || c.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || c.BookingNo?.includes(search)
    ), [recheckQueue, search]);

  const recheckColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking No", size: 110,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 140,
      cell: (i) => (
        <div onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / Unit", size: 130, enableSorting: false,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs">{i.row.original.ProjectName || "—"} · {i.row.original.UnitNo}</span> },
    { accessorKey: "OpenRecheckCount", header: "Flagged Items", size: 110,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">{i.row.original.OpenRecheckCount}</span> },
    { accessorKey: "OldestFlaggedAt", header: "Flagged Since", size: 110,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs text-muted-foreground">{i.row.original.OldestFlaggedAt ? String(i.row.original.OldestFlaggedAt).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "Action", size: 100, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setActiveBooking(i.row.original)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">
          <ShieldAlert size={12} /> Resolve
        </button>
      ) },
  ];

  const queueColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking No", size: 110,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 140,
      cell: (i) => (
        <div onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / Unit", size: 130, enableSorting: false,
      cell: (i) => <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs">{i.row.original.ProjectName || "—"} · {i.row.original.UnitNo}</span> },
    { accessorKey: "LastOutcome", header: "Last Outcome", size: 120,
      cell: (i) => i.row.original.LastOutcome ? (
        <span onClick={() => setActiveBooking(i.row.original)} className={`cursor-pointer text-xs px-2 py-0.5 rounded-full border font-medium ${outcomeColor[i.row.original.LastOutcome] || ""}`}>{i.row.original.LastOutcome}</span>
      ) : <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs text-muted-foreground">Never called</span> },
    { accessorKey: "NextCallDate", header: "Follow-up Due", size: 110,
      cell: (i) => i.row.original.NextCallDate ? (
        <span onClick={() => setActiveBooking(i.row.original)} className={`cursor-pointer ${new Date(i.row.original.NextCallDate) <= new Date() ? "text-orange-600 font-medium text-xs" : "text-muted-foreground text-xs"}`}>
          {String(i.row.original.NextCallDate).slice(0, 10)}
        </span>
      ) : <span onClick={() => setActiveBooking(i.row.original)} className="cursor-pointer text-xs">—</span> },
    { id: "actions", header: "Action", size: 100, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setActiveBooking(i.row.original)}
          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
          <Phone size={12} /> Call Now
        </button>
      ) },
  ];

  const { theme } = useTheme();
  const isDark = theme !== "light";
  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(245,158,11,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };
  const borderColor = isDark ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.12)";

  usePageRights("crm-welcome-calls");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Welcome Calls"]} />
      <CrmShell
        title="CRM — Welcome Calls"
      subtitle="Work the call queue, verify documents, co-applicant, and bank/nominee details"
    >
      {overdueCount > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-2.5 text-sm text-orange-700 flex items-center gap-2">
          <Phone size={14} />
          <span><strong>{overdueCount}</strong> booking{overdueCount > 1 ? "s" : ""} due for a call today or overdue</span>
        </div>
      )}

      {/* Search + view toggle + queue/recheck table (or history list) live in
          one continuous glass card, same convention as the other wrapped
          CRM pages, instead of a loose toolbar row floating above a
          separately-bordered table. */}
      <div className="rounded-xl overflow-hidden" style={glassStyle}>
        <div className="flex gap-3 items-center flex-wrap px-3.5 py-3 border-b" style={{ borderColor }}>
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer or booking no..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted/20 p-1 shrink-0">
            <button onClick={() => setView("queue")}
              className={`px-3 py-1.5 text-xs font-heading font-medium rounded-lg transition-all ${
                view === "queue" ? "text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}>
              Queue ({queue.length})
            </button>
            <button onClick={() => setView("recheck")}
              className={`px-3 py-1.5 text-xs font-heading font-medium rounded-lg flex items-center gap-1 transition-all ${
                view === "recheck" ? "text-white shadow-sm bg-red-500" : "text-red-600 hover:bg-muted"
              }`}>
              <ShieldAlert size={12} /> Recheck ({recheckQueue.length})
            </button>
            <button onClick={() => setView("history")}
              className={`px-3 py-1.5 text-xs font-heading font-medium rounded-lg transition-all ${
                view === "history" ? "text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}>
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
            className="border-0"
          />
        ) : view === "recheck" ? (
          <DataTable
            data={filteredRecheckQueue}
            columns={recheckColumns}
            searchable={false}
            loading={recheckLoading}
            emptyMessage="No open recheck flags — everything is clean"
            className="border-0"
          />
        ) : (
          <div className="space-y-2 p-3.5">
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
                className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/10 hover:border-amber-500/40 transition-colors cursor-pointer"
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
                    {c.PreferredAgreementDate && <span className="text-purple-600">Discussed agreement date (note only): {String(c.PreferredAgreementDate).slice(0, 10)}</span>}
                    {c.Notes && <span className="truncate max-w-xs">{c.Notes}</span>}
                    {custom.map((f, i) => <span key={i}>{f.key}: {f.value}</span>)}
                  </div>
                )}
              </button>
            );
          })}
          </div>
        )}
      </div>

      {/* Same pattern as CrmBooking.tsx's own ?applicationId= deep link:
          closing the dialog clears the URL back to the plain page instead
          of leaving ?bookingId=X sitting there — deepLinkOpened is
          deliberately NOT reset here, since bkgFilter itself clears once
          the URL updates and the effect above already guards on `!bkgFilter`. */}
      {activeBooking && (
        <IntakeDialog booking={activeBooking} onClose={() => {
          setActiveBooking(null);
          if (bkgFilter) navigate("/crm/welcome-calls", { replace: true });
        }} />
      )}
      {editingCall && (
        <EditCallDialog call={editingCall} onClose={() => setEditingCall(null)} onSaved={() => refetchHistory()} />
      )}
    </CrmShell>
    </>
  );
};

export default CrmWelcomeCall;