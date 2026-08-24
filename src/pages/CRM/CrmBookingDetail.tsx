import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Building2, IndianRupee, Paperclip, FileText, Upload, Download, Eye,
  Trash2, Wallet, Car,
  ChevronUp, ChevronDown, ShieldAlert, Check,
  CreditCard, ClipboardCheck, ArrowLeft, ArrowRight,
  KeyRound, ShieldCheck, AlertTriangle, RefreshCw, Mail, Phone, User,
  CalendarCheck, Lock, Clock, Hourglass, Info,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGstRates, computeExtraWorkGst, fmtInr } from "@/lib/crmGst";
import { FinancialStatusBar } from "@/components/crm/FinancialStatusBar";
import { BookingLifecycleBar } from "@/components/crm/BookingLifecycleBar";
import { usePageRights } from "@/hooks/usePageRights";

const API = "/api/crm/bookings";
const PAY_API = "/api/crm/payments";
const AMEND_API = "/api/crm/booking-amendments";
const BANK_DETAIL_API = "/api/crm/customer-bank-details";
const PROJECT_BANK_API = "/api/crm/project-banks";
const BANK_MASTER_API = "/api/bank-master";

const EMPTY_BANK = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "",
};

// Same approver set as CRM_APPROVER_ROLES on the backend (services/
// approvalService.js) — kept in sync manually since it's a small, stable
// list, same pattern CrmCustomerBankDetails.tsx already uses for its own
// frontend-side permission preview.
const AMENDMENT_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const TABS = ["Booking", "Parking & Extra Work", "Payment Plan", "Bank Details", "Customer Portal", "Attachments", "Payment & Invoice"] as const;
type Tab = typeof TABS[number];

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}
// The merged Data Review checklist — the former Application-level Level-1
// checklist (KYC, Project/Unit/Rate, Payment Plan, Bank/Deposit, Broker,
// Source, Documents), now the actual content of this booking's own "Review"
// workflow stage. See crmBookings.js GET/PUT /:id/checklist/*.
async function fetchChecklist(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}/checklist`);
  return r.ok ? r.json() : null;
}
async function fetchInvoices(id: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${id}/invoices`);
  return r.ok ? r.json() : [];
}
async function fetchMoneyReceipts(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`/api/crm/money-receipts?bookingId=${bookingId}`);
  return r.ok ? r.json() : [];
}
async function fetchAttachments(id: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${id}/attachments`);
  return r.ok ? r.json() : [];
}
async function fetchOnAccount(id: number): Promise<any | null> {
  const r = await fetchWithAuth(`${PAY_API}/booking/${id}/on-account`);
  return r.ok ? r.json() : null;
}
// Deposit bank, scoped to the booking's project — empty means "nothing
// linked", so callers fall back to the full bank list themselves.
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (!projectId) return [];
  const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`);
  return r.ok ? r.json() : [];
}
async function fetchAllBanks(): Promise<any[]> {
  const r = await fetchWithAuth(BANK_MASTER_API);
  return r.ok ? r.json() : [];
}
// Same Company/Project/Block/Unit scope filter every other payment-plan
// picker in the app uses (Unit Master, Application) — a plan with no
// scope set applies everywhere, otherwise it must match this booking's own.
async function fetchScopedPaymentPlans(b: any): Promise<any[]> {
  if (!b) return [];
  const params = new URLSearchParams();
  if (b.CompanyId) params.set("companyId", String(b.CompanyId));
  if (b.ProjectId) params.set("projectId", String(b.ProjectId));
  if (b.BlockId) params.set("blockId", String(b.BlockId));
  if (b.UnitId) params.set("unitId", String(b.UnitId));
  const r = await fetchWithAuth(`/api/crm/payment-plans?${params}`);
  return r.ok ? r.json() : [];
}
async function fetchParkingAllotments(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`/api/crm/parking/${bookingId}`);
  return r.ok ? r.json() : [];
}
async function fetchExtraCharges(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`/api/crm/extra-charges/${bookingId}`);
  return r.ok ? r.json() : [];
}
async function fetchExtraChargeTypes(): Promise<any[]> {
  const r = await fetchWithAuth("/api/extra-charge-master");
  return r.ok ? r.json() : [];
}
async function fetchPendingAmendments(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`${AMEND_API}/booking/${bookingId}`);
  return r.ok ? r.json() : [];
}

// Live "what will this actually cost" preview for the Extra Charge add
// form — 18% is fixed from the HSN Master "Extra Work" row (useGstRates
// fetches it live, never hardcoded), matching exactly what the backend will
// charge once submitted.
function ExtraWorkGstPreview({ amount }: { amount: number }) {
  const { data: rates, isLoading } = useGstRates();
  if (isLoading || !rates) return null;
  const gst = computeExtraWorkGst(amount, rates);
  return (
    <div className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
      <span>GST ({gst.rate}%, fixed — HSN Master)</span>
      <span className="font-semibold">{fmtInr(gst.gstAmount)} → Total {fmtInr(gst.total)}</span>
    </div>
  );
}

// Auth here is a bearer token via fetchWithAuth, same reason the Customer
// Portal's own invoice/document previews (PortalAgreement.tsx) fetch as a
// blob rather than using a plain <a href> — a raw link can't carry the
// Authorization header, so the PDF has to come through fetchWithAuth first.
function InvoicePdfDialog({ bookingId, invoice, onClose }: { bookingId: number; invoice: any; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${bookingId}/invoices/${invoice.Id}/pdf`)
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
            <DialogTitle className="flex items-center gap-2"><FileText size={16} className="text-amber-600 dark:text-amber-400" /> {invoice.InvoiceNo}</DialogTitle>
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
}

function ReceiptPdfPreview({ receipt, onClose }: { receipt: any; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`/api/crm/money-receipts/${receipt.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {});
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <FileText size={16} className="text-primary" /> {receipt.ReceiptNo}
            </DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${receipt.ReceiptNo}.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
          <DialogDescription>
            {receipt.BookingNo || ""} · {receipt.Amount != null ? `₹${Number(receipt.Amount).toLocaleString("en-IN")}` : ""} · {receipt.Status}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 rounded-lg overflow-hidden border border-border">
          {!blobUrl
            ? <span className="text-sm text-muted-foreground flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading preview…</span>
            : <iframe src={blobUrl} title={receipt.ReceiptNo} className="w-full h-[60vh] border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CrmBookingDetail({ bookingId, onClose }: { bookingId: number; onClose: () => void }) {
  const qc = useQueryClient();
  usePageRights("crm-bookings");
  const { canDoAction, currentUser } = useAuth();
  const isAmendmentApprover = AMENDMENT_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase());
  const canEdit = canDoAction("crm-bookings", "edit");
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [tab, setTab] = useState<Tab>("Booking");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<any | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<any | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ InvoiceType: "Booking", Amount: "", InvoiceDate: "", Description: "", MilestoneId: "", OnAccountPaymentId: "" });
  const [parkingForm, setParkingForm] = useState({ Quantity: "1" });
  const [discountForm, setDiscountForm] = useState({ Amount: "", Note: "" });

  const handleDownloadReceiptPdf = async (receipt: any) => {
    try {
      const toastId = toast.loading("Generating PDF...");
      const res = await fetchWithAuth(`/api/crm/money-receipts/${receipt.Id}/pdf`);
      if (!res.ok) {
        toast.dismiss(toastId);
        throw new Error("Failed to load PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${receipt.ReceiptNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleDownloadInvoicePdf = async (invoice: any) => {
    try {
      const toastId = toast.loading("Generating PDF...");
      const res = await fetchWithAuth(`/api/crm/invoices/${invoice.Id}/pdf`);
      if (!res.ok) {
        toast.dismiss(toastId);
        throw new Error("Failed to load PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.InvoiceNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // No GstRate field here anymore — Extra Charges are always taxed at the
  // fixed 18% HSN Master rate (backend ignores any client-supplied rate),
  // so there's nothing left to pick.
  const [extraForm, setExtraForm] = useState({ ExtraChargeMasterId: "", Description: "", Amount: "" });
  const [chargesSaving, setChargesSaving] = useState(false);
  const [editingExtraId, setEditingExtraId] = useState<number | null>(null);
  const [editingParkingId, setEditingParkingId] = useState<number | null>(null);
  const [extraReason, setExtraReason] = useState("");
  const [parkingReason, setParkingReason] = useState("");
  const [invoiceSort, setInvoiceSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [payForm, setPayForm] = useState({ Amount: "", PaymentMode: "Cash", ReceivedDate: "", TransactionRef: "", ChequeDate: "", DepositBankId: "" });
  const [paySaving, setPaySaving] = useState(false);
  const [planEditOpen, setPlanEditOpen] = useState(false);
  const [planEditValue, setPlanEditValue] = useState("");
  const [planSaving, setPlanSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["crm-booking-detail", bookingId],
    queryFn: () => fetchDetail(bookingId),
  });
  const booking = data?.booking;
  const stageState = data?.stageState;
  const { data: checklistData, refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-booking-checklist", bookingId],
    queryFn: () => fetchChecklist(bookingId),
  });
  const checklistItems: any[] = checklistData?.items || [];
  const checklistAllChecked = !!checklistData?.allChecked;
  const [checklistBusyKey, setChecklistBusyKey] = useState<string | null>(null);
  const [checklistFlaggingKey, setChecklistFlaggingKey] = useState<string | null>(null);
  const [checklistFlagRemark, setChecklistFlagRemark] = useState("");
  // customer is available via data?.customer if needed in future tabs
  const agreement = data?.agreement;
  // Once the booking's Agreement has at least one uploaded document, Unit/
  // Parking/Extra-Charge changes route through the amendment-approval queue
  // instead of applying directly (see isLegalWorkStarted in the backend) —
  // the numbers may already be baked into a document under review.
  const legalWorkStarted = !!(agreement && agreement.DocumentCount > 0);
  // paymentSummary available via data?.paymentSummary if reinstated

  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-project-banks-for", booking?.ProjectId],
    queryFn: () => fetchProjectBanks(booking?.ProjectId),
    enabled: tab === "Payment & Invoice" && !!booking?.ProjectId,
  });
  const { data: allBanks = [] } = useQuery({
    queryKey: ["bank-master-dropdown"],
    queryFn: fetchAllBanks,
    enabled: tab === "Payment & Invoice",
    staleTime: 5 * 60_000,
  });
  // /for-project already resolves the full exclusivity rule server-side
  // (tagged-only, or every untagged bank as the fallback pool) — falling
  // back further to the raw, unfiltered bank list here would silently
  // reintroduce banks tagged exclusively to a DIFFERENT project. Only use
  // the raw list when this booking's Project isn't known yet.
  const bankOptions = booking?.ProjectId ? projectBanks : allBanks;
  const { data: scopedPlans = [] } = useQuery({
    queryKey: ["crm-payment-plans-for-booking", bookingId],
    queryFn: () => fetchScopedPaymentPlans(booking),
    enabled: tab === "Payment Plan" && planEditOpen && !!booking,
  });
  useEffect(() => {
    if (tab === "Payment & Invoice" && projectBanks.length === 1 && !payForm.DepositBankId) {
      setPayForm((f) => ({ ...f, DepositBankId: String(projectBanks[0].BId) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectBanks]);
  // The Payment Mode was already captured on the Application's own Payment
  // Details step (booking.PaymentMode is copied from it at Booking
  // creation) — pre-fill this form with it instead of always defaulting to
  // "Cash" and making staff re-pick something they already told the system
  // once. Only applies while the form is still untouched (still "Cash",
  // its own initial value) so it never clobbers a deliberate change.
  useEffect(() => {
    if (tab === "Payment & Invoice" && booking?.PaymentMode && payForm.PaymentMode === "Cash" && booking.PaymentMode !== "Cash") {
      setPayForm((f) => ({ ...f, PaymentMode: booking.PaymentMode }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, booking?.PaymentMode]);
  const { data: invoices = [] } = useQuery({
    queryKey: ["crm-booking-invoices", bookingId],
    queryFn: () => fetchInvoices(bookingId),
    // Also needed on the Payment Plan tab now — the milestone list there
    // shows an "Invoice Generation Pending" badge for any paid milestone
    // with no matching invoice, which requires this data to actually be
    // loaded rather than sitting on its stale/empty default.
    enabled: tab === "Payment & Invoice" || tab === "Payment Plan",
  });
  const { data: moneyReceipts = [] } = useQuery({
    queryKey: ["crm-booking-money-receipts", bookingId],
    queryFn: () => fetchMoneyReceipts(bookingId),
    enabled: !!bookingId,
  });
  const { data: onAccountData } = useQuery({
    queryKey: ["crm-booking-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId),
    enabled: !!bookingId,
  });
  const { data: attachments = [] } = useQuery({
    queryKey: ["crm-booking-attachments", bookingId],
    queryFn: () => fetchAttachments(bookingId),
    enabled: tab === "Attachments",
  });
  const { data: portalStatus, isFetching: portalFetching, refetch: refetchPortal } = useQuery({
    queryKey: ["crm-booking-portal-status", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${bookingId}/portal-status`);
      return r.ok ? r.json() : null;
    },
    enabled: tab === "Customer Portal",
  });
  const [provisioning, setProvisioning] = useState(false);
  const [togglingPortal, setTogglingPortal] = useState(false);
  async function handleTogglePortalAccess(deactivate: boolean) {
    setTogglingPortal(true);
    try {
      const r = await fetchWithAuth(`${API}/${bookingId}/portal/${deactivate ? "deactivate" : "reactivate"}`, { method: "PUT" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(body.error || "Failed to update portal access"); return; }
      toast.success(deactivate ? "Portal access deactivated" : "Portal access reactivated");
      refetchPortal();
    } finally {
      setTogglingPortal(false);
    }
  }
  async function handleProvisionPortal() {
    setProvisioning(true);
    try {
      const r = await fetchWithAuth(`${API}/${bookingId}/provision-portal`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(body.error || "Provisioning failed"); return; }
      toast.success("Customer portal provisioned successfully");
      refetchPortal();
    } finally {
      setProvisioning(false);
    }
  }
  const { data: parking = [] } = useQuery({
    queryKey: ["crm-parking", bookingId],
    queryFn: () => fetchParkingAllotments(bookingId),
    enabled: tab === "Parking & Extra Work",
  });
  const { data: extras = [] } = useQuery({
    queryKey: ["crm-extra-charges", bookingId],
    queryFn: () => fetchExtraCharges(bookingId),
    enabled: tab === "Parking & Extra Work",
  });
  const { data: chargeTypes = [] } = useQuery({
    queryKey: ["extra-charge-master-all"],
    queryFn: fetchExtraChargeTypes,
    enabled: tab === "Parking & Extra Work",
    staleTime: 5 * 60_000,
  });
  const { data: pendingAmendments = [] } = useQuery({
    queryKey: ["crm-booking-amendments", bookingId],
    queryFn: () => fetchPendingAmendments(bookingId),
    enabled: tab === "Parking & Extra Work",
    staleTime: 15_000,
  });
  const [reviewingAmendmentId, setReviewingAmendmentId] = useState<number | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{
    title: string; label: string; required: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);

  // Bank/KYC/Nominee — same shape and API as CrmApplication.tsx's own bank
  // form (both read/write the one CrmCustomerBankDetail row keyed by
  // ApplicationId), so edits made from either place stay in sync.
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankLoaded, setBankLoaded] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  // Locked = read-only "Saved" state, distinct from booking.Status ===
  // "Approved" (which is a permanent, backend-enforced lock). This one is
  // purely a local UX guard: once Save succeeds the fields lock and show
  // "Saved" so nobody edits KYC/nominee data by accident, but Edit is
  // always available to reopen them right up until the Booking itself is
  // Approved. Defaults to locked if a row was already saved before this
  // tab was opened, so returning to an already-filled-in booking doesn't
  // present open, editable fields as if nothing had been saved yet.
  const [bankLocked, setBankLocked] = useState(false);
  // Persisted proof that a staff member explicitly reviewed/confirmed this
  // data at the Booking stage (BookingStageVerifiedAt/By on
  // CrmCustomerBankDetail) — distinct from bankLocked above, which is just
  // "does the row have data". Cleared server-side the instant the row is
  // edited from any other save path, so this can never point at stale data.
  const [bankVerifiedAt, setBankVerifiedAt] = useState<string | null>(null);
  const [bankVerifiedByName, setBankVerifiedByName] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "Bank Details" || !booking?.ApplicationId) return;
    let cancelled = false;
    setBankLoaded(false);
    fetchWithAuth(`${BANK_DETAIL_API}/application/${booking.ApplicationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setBank({
          BankName: d?.BankName || "", BranchName: d?.BranchName || "", AccountNo: d?.AccountNo || "",
          IfscCode: d?.IfscCode || "", AccountHolderName: d?.AccountHolderName || "",
          NomineeName: d?.NomineeName || "", NomineeRelation: d?.NomineeRelation || "",
          NomineeDob: d?.NomineeDob ? String(d.NomineeDob).slice(0, 10) : "",
          NomineeContact: d?.NomineeContact || "", NomineeAddress: d?.NomineeAddress || "",
          PanNo: d?.PanNo || "", AadhaarNo: d?.AadhaarNo || "",
          Occupation: d?.Occupation || "", AnnualIncome: d?.AnnualIncome != null ? String(d.AnnualIncome) : "",
        });
        setBankLocked(!!(d && (d.BankName || d.AccountNo || d.PanNo)));
        setBankVerifiedAt(d?.BookingStageVerifiedAt || null);
        setBankVerifiedByName(d?.BookingStageVerifiedByName || null);
      })
      .finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [tab, booking?.ApplicationId]);

  const handleSaveBank = async () => {
    if (!booking?.ApplicationId) return;
    if (bank.PanNo && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(bank.PanNo.trim())) { toast.error("PAN must be in the format ABCDE1234F"); return; }
    if (bank.AadhaarNo && !/^\d{12}$/.test(bank.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    if (bank.IfscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(bank.IfscCode.trim())) { toast.error("IFSC must be in the format ABCD0123456"); return; }
    if (bank.NomineeContact && !/^\d{10}$/.test(bank.NomineeContact.trim())) { toast.error("Nominee contact must be exactly 10 digits"); return; }
    setBankSaving(true);
    try {
      const res = await fetchWithAuth(`${BANK_DETAIL_API}/application/${booking.ApplicationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bank, VerifyBookingStage: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success("Bank/KYC details verified and saved");
      setBankLocked(true);
      setBankVerifiedAt(new Date().toISOString());
      setBankVerifiedByName(currentUser?.name || null);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBankSaving(false);
    }
  };

  const invalidateCharges = () => {
    qc.invalidateQueries({ queryKey: ["crm-parking", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-extra-charges", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-amendments", bookingId] });
  };

  const handleApproveAmendment = async (id: number) => {
    setReviewingAmendmentId(id);
    try {
      const res = await fetchWithAuth(`${AMEND_API}/${id}/approve`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success("Amendment approved and applied");
      invalidateCharges();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setReviewingAmendmentId(null);
    }
  };

  const handleRejectAmendment = (id: number) => {
    setReasonDialog({
      title: "Reject Amendment", label: "Reason for rejection (optional)", required: false,
      onConfirm: async (notes) => {
        setReviewingAmendmentId(id);
        try {
          const res = await fetchWithAuth(`${AMEND_API}/${id}/reject`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: notes || undefined }) });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error);
          toast.success("Amendment rejected");
          invalidateCharges();
        } catch (e: any) {
          toast.error(translateError(e.message));
        } finally {
          setReviewingAmendmentId(null);
        }
      },
    });
  };

  // New parking allotments are only ever created from the Application
  // wizard (ParkingSelectionStep in CrmApplication.tsx) — this page is
  // edit-quantity/release only, since new allotments here used to bypass
  // the Application's own selection flow entirely.
  const handleAddParking = async () => {
    if (!editingParkingId) return;
    if (legalWorkStarted && !parkingReason.trim()) { toast.error("A reason is required — legal documents are already under verification for this booking"); return; }
    setChargesSaving(true);
    try {
      const res = await fetchWithAuth(`/api/crm/parking/${editingParkingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Quantity: parseInt(parkingForm.Quantity) || 1, Reason: legalWorkStarted ? parkingReason.trim() : undefined }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : `Parking updated — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}`);
      setEditingParkingId(null);
      setParkingForm({ Quantity: "1" });
      setParkingReason("");
      invalidateCharges();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setChargesSaving(false);
    }
  };

  const startEditParking = (p: any) => {
    setEditingParkingId(p.Id);
    setParkingForm({ Quantity: String(p.Quantity) });
  };
  const cancelEditParking = () => {
    setEditingParkingId(null);
    setParkingForm({ Quantity: "1" });
    setParkingReason("");
  };

  const handleRemoveParking = (id: number) => {
    // Reason is mandatory unconditionally — backend enforces this regardless
    // of legal-work state. The dialog label adapts to whether it's an
    // immediate release or an amendment-queue submission.
    setReasonDialog({
      title: "Release Parking Allotment",
      label: legalWorkStarted
        ? "Legal documents are under verification — this will queue an amendment for approval. State the reason:"
        : "State the reason for releasing this parking allotment. This is recorded in the audit trail:",
      required: true,
      onConfirm: async (reason) => {
        try {
          const res = await fetchWithAuth(`/api/crm/parking/${id}?reason=${encodeURIComponent(reason.trim())}`, { method: "DELETE" });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error);
          toast.success(resData.pending ? "Amendment queued — needs sign-off before the slot is released" : "Parking allotment released");
          invalidateCharges();
        } catch (e: any) { toast.error(translateError(e.message)); }
      },
    });
  };

  const handleAddExtra = async () => {
    if (!extraForm.Description.trim() || !extraForm.Amount) { toast.error("Description and Amount are required"); return; }
    if (legalWorkStarted && !extraReason.trim()) { toast.error("A reason is required — legal documents are already under verification for this booking"); return; }
    setChargesSaving(true);
    try {
      const isEdit = editingExtraId != null;
      const res = await fetchWithAuth(isEdit ? `/api/crm/extra-charges/${editingExtraId}` : `/api/crm/extra-charges/${bookingId}`, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ExtraChargeMasterId: extraForm.ExtraChargeMasterId || null,
          Description: extraForm.Description.trim(),
          Amount: parseFloat(extraForm.Amount),
          Reason: legalWorkStarted ? extraReason.trim() : undefined,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : (isEdit ? `Charge updated — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}` : `Charge added — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}`));
      setEditingExtraId(null);
      setExtraForm({ ExtraChargeMasterId: "", Description: "", Amount: "" });
      setExtraReason("");
      invalidateCharges();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setChargesSaving(false);
    }
  };

  const startEditExtra = (c: any) => {
    setEditingExtraId(c.Id);
    setExtraForm({
      ExtraChargeMasterId: c.ExtraChargeMasterId ? String(c.ExtraChargeMasterId) : "",
      Description: c.Description || "",
      Amount: c.Amount != null ? String(c.Amount) : "",
    });
  };
  const cancelEditExtra = () => {
    setEditingExtraId(null);
    setExtraForm({ ExtraChargeMasterId: "", Description: "", Amount: "" });
    setExtraReason("");
  };

  const handleRemoveExtra = (id: number) => {
    if (!legalWorkStarted) {
      (async () => {
        try {
          const res = await fetchWithAuth(`/api/crm/extra-charges/${id}`, { method: "DELETE" });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error);
          toast.success("Charge removed");
          invalidateCharges();
        } catch (e: any) { toast.error(translateError(e.message)); }
      })();
      return;
    }
    setReasonDialog({
      title: "Remove Extra Charge",
      label: "Legal documents are already under verification. Enter a reason for removing this charge:",
      required: true,
      onConfirm: async (reason) => {
        try {
          const res = await fetchWithAuth(`/api/crm/extra-charges/${id}?reason=${encodeURIComponent(reason.trim())}`, { method: "DELETE" });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error);
          toast.success(resData.pending ? "Amendment request submitted — pending approval" : "Charge removed");
          invalidateCharges();
        } catch (e: any) { toast.error(translateError(e.message)); }
      },
    });
  };

  const INVOICE_SORT_COLS: { key: string; label: string }[] = [
    { key: "InvoiceNo", label: "Invoice No" },
    { key: "InvoiceType", label: "Type" },
    { key: "Amount", label: "Amount" },
    { key: "InvoiceDate", label: "Date" },
    { key: "Status", label: "Status" },
    { key: "CreatedByName", label: "By" },
  ];

  const toggleInvoiceSort = (key: string) => {
    setInvoiceSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const sortedInvoices = useMemo(() => {
    const rows = (invoices as any[]).slice();
    if (!invoiceSort) return rows;
    const { key, dir } = invoiceSort;
    rows.sort((a, b) => {
      let av = a?.[key];
      let bv = b?.[key];
      if (key === "Amount") {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      } else if (key === "InvoiceDate") {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = (av ?? "").toString().toLowerCase();
        bv = (bv ?? "").toString().toLowerCase();
      }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [invoices, invoiceSort]);

  // Locked/read-only by default (auto-fetched from the Application, itself
  // auto-fetched from the Unit's own default) — this is the deliberate
  // escape hatch for when the deal genuinely needs a different plan than
  // what was decided upstream. The backend (crmBookings.js PUT /:id) blocks
  // the change outright once any real payment has been recorded against the
  // existing schedule, and regenerates the milestone schedule from scratch
  // for the new plan otherwise — same rule as every other plan-scope check.
  const handleSavePaymentPlan = async () => {
    setPlanSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PaymentPlanId: planEditValue || null }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Failed to update payment plan");
      toast.success(resData.milestonesRegenerated
        ? "Payment Plan updated — milestone schedule regenerated"
        : "Payment Plan updated");
      setPlanEditOpen(false);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-milestones", String(bookingId)] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setPlanSaving(false);
    }
  };

  const activeTabIndex = Math.max(0, TABS.indexOf(tab));
  // MilestoneNo alone isn't a safe key — a parking/extra-charge line item
  // added while a booking briefly had zero milestones yet could have been
  // numbered 1 too (a real, now-fixed backend bug; see
  // crmEntityCreation.js), leaving old data with two rows both claiming
  // MilestoneNo=1. Excluding anything tagged as a parking/extra-charge line
  // item guarantees this always resolves to the real Booking Amount
  // milestone, not whichever row a plain `.find` happens to hit first.
  const milestoneList = (data?.milestones || []) as any[];
  const firstMilestone = milestoneList.find((m: any) => Number(m.MilestoneNo) === 1 && !m.ParkingAllotmentId && !m.ExtraChargeId)
    || milestoneList.find((m: any) => Number(m.MilestoneNo) === 1)
    || milestoneList[0];
  const bookingAmountDue = Number(firstMilestone?.AmountDue || booking?.BookingAmount || 0);
  const bookingAmountPaid = Number(firstMilestone?.AmountPaid || booking?.BookingAmountPaid || 0);
  const bookingAmountBalance = Math.max(0, bookingAmountDue - bookingAmountPaid);
  // Real, tracked on-account credit for this booking — CrmOnAccountPayment
  // rows submitted separately from milestone payments (their own approval,
  // their own OACC-xxxx doc, their own Applied/Pending state), NOT something
  // derivable from Milestone 1's own Paid vs Due. A customer can be exactly
  // paid-in-full on the Booking Amount and still be sitting on an unrelated
  // on-account deposit — the two numbers are independent.
  const bookingOnAccountBalance = Number(onAccountData?.availableBalance || 0);
  const bookingAmountPaidInFull = bookingAmountDue > 0 && bookingAmountBalance < 1;
  // "Unit confirmed" / "Plan confirmed" are no longer separate booking
  // columns — they ARE the Data Review checklist's own ProjectUnitRate /
  // PaymentPlanAmounts items being Checked. One source of truth for both
  // the top progress strip below and the booking-approval gate.
  const unitConfirmed = checklistItems.find((it: any) => it.ItemKey === "ProjectUnitRate")?.CheckStatus === "Checked";
  const planConfirmed = checklistItems.find((it: any) => it.ItemKey === "PaymentPlanAmounts")?.CheckStatus === "Checked";
  const mandatoryReady = checklistAllChecked;
  // Which specific gating step to point staff at, in the order they must be
  // completed — replaces the old generic "complete the checklist" message
  // with the actual step name and where to go do it, since the gates live
  // on 3 different tabs (Booking, Payment Plan, Payment & Invoice).
  const pendingStepMessage = !unitConfirmed
    ? { tab: "Booking" as Tab, text: "Step 1 (Unit & Value) is pending — check \"Project, Unit and Rate/SqFt are correct\" on the Booking tab." }
    : !planConfirmed
    ? { tab: "Payment Plan" as Tab, text: "Step 2 (Payment Plan) is pending — check the Payment Plan item on the Payment Plan tab." }
    : !checklistAllChecked
    ? { tab: "Booking" as Tab, text: "The Data Review checklist still has unchecked items." }
    : null;

  const goStep = (dir: 1 | -1) => {
    const next = TABS[activeTabIndex + dir];
    if (next) setTab(next);
  };
  const isLastTab = activeTabIndex === TABS.length - 1;

  const [bookingRequesting, setBookingRequesting] = useState(false);
  const [stageActioning, setStageActioning] = useState<"approve" | "reject" | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectRemark, setRejectRemark] = useState("");
  const currentStage = booking?.WorkflowStage || stageState?.WorkflowStage || "Review";
  const stageLabels: Record<string, string> = {
    Review: "Data Review",
    MarketingHeadApproval: "Marketing Head Approval (L1)",
    DirectorApproval: "Director Approval (L2 — Final)",
    Confirmed: "Confirmed",
  };
  const userRole = String(currentUser?.role || "").toLowerCase();
  const stageRoles: Record<string, string[]> = {
    MarketingHeadApproval: ["admin", "super_admin", "marketing_head"],
    DirectorApproval: ["admin", "super_admin", "director"],
  };
  const canActOnStage = booking?.Status === CrmStatus.PENDING
    && Array.isArray(stageRoles[currentStage])
    && stageRoles[currentStage].includes(userRole);

  const handleStageApprove = async () => {
    setStageActioning("approve");
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/approve`, { method: "PUT" });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Approval failed");
      toast.success(resData.confirmed ? "Booking confirmed" : `Approved - moved to ${resData.label || "next stage"}`);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
      qc.invalidateQueries({ queryKey: ["approval-inbox"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setStageActioning(null);
    }
  };

  const handleStageReject = async () => {
    if (!rejectRemark.trim()) {
      toast.error("Remarks are required when sending a booking back for correction");
      return;
    }
    setStageActioning("reject");
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: rejectRemark.trim() }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Reject failed");
      toast.success(`Sent back to ${resData.label || "previous stage"}`);
      setRejectOpen(false);
      setRejectRemark("");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
      qc.invalidateQueries({ queryKey: ["approval-inbox"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setStageActioning(null);
    }
  };

  // Data Review checklist actions — check/uncheck/flag/resubmit, one item at
  // a time, same shape as the Welcome Call and old Application-verify
  // checklists elsewhere in this app.
  const fireChecklistAction = async (itemKey: string, action: "check" | "uncheck" | "flag" | "resubmit", remarks?: string) => {
    setChecklistBusyKey(itemKey);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/checklist/${itemKey}/${action}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: action === "check" || action === "flag" ? JSON.stringify({ remarks }) : undefined,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Action failed");
      if (action === "flag") { setChecklistFlaggingKey(null); setChecklistFlagRemark(""); }
      await refetchChecklist();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setChecklistBusyKey(null);
    }
  };

  const handleFinalBook = async () => {
    if (!checklistAllChecked) {
      toast.error("Complete the data review checklist before booking approval.");
      return;
    }
    if (booking.Status === CrmStatus.APPROVED) {
      toast.success("Booking is already approved");
      return;
    }
    setBookingRequesting(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/ready-for-approval`, { method: "PUT" });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Failed to mark ready for approval");
      toast.success(`Data review complete — sent to ${resData.label || "Marketing Head Approval"}`);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-booking-invoices", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBookingRequesting(false);
    }
  };

  // Booking Amount is set here, at the Booking stage — never at Application
  // time. Changing it (first time or a correction) re-aligns Milestone #1
  // via the same resync-schedule the server already exposes for exactly
  // this purpose, instead of duplicating that math client-side.

  const handleRecordPayment = async () => {
    if (!payForm.Amount || parseFloat(payForm.Amount) <= 0) { toast.error("Enter a valid amount"); return; }
    setPaySaving(true);
    try {
      const bankName = payForm.DepositBankId
        ? (bankOptions as any[]).find((b: any) => String(b.BId) === payForm.DepositBankId)?.BName
        : undefined;
      const res = await fetchWithAuth(`/api/crm/money-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: bookingId,
          Amount: payForm.Amount,
          PaymentMode: payForm.PaymentMode,
          ReceivedDate: payForm.ReceivedDate,
          TransactionRef: payForm.TransactionRef,
          ChequeDate: payForm.ChequeDate,
          DepositBankName: bankName,
        }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Submission failed");
      toast.success(`Money Receipt ${resData.ReceiptNo || ""} created — Pending approval.`);
      setPayForm({ Amount: "", PaymentMode: "Cash", ReceivedDate: "", TransactionRef: "", ChequeDate: "", DepositBankId: "" });
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-booking-money-receipts", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setPaySaving(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetchWithAuth(`${API}/${bookingId}/attachments`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("File(s) uploaded");
      qc.invalidateQueries({ queryKey: ["crm-booking-attachments", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/attachments/${attId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Attachment removed");
      qc.invalidateQueries({ queryKey: ["crm-booking-attachments", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // This page generates exactly one invoice type: the Booking Amount
  // invoice (Milestone #1) — the one thing every booking always has and
  // that staff need right here the moment it's paid+demanded. Every other
  // invoice (later milestones, Maintenance, Other, On-Account) now belongs
  // exclusively to the dedicated CRM Invoices page, which lists and
  // generates across every booking rather than duplicating that flow here
  // per-booking. Keeping this page single-purpose avoids the same "two
  // places do the same thing" trap the checklist/payment-form duplication
  // bugs earlier in this build all came from.
  const bookingMilestone = milestoneList.find((m: any) => Number(m.MilestoneNo) === 1);
  const bookingMilestoneInvoiced = !!bookingMilestone
    && (invoices as any[]).some((inv: any) => inv.MilestoneId === bookingMilestone.Id && inv.Status !== "Void");
  const bookingInvoiceReady = !!bookingMilestone && bookingMilestone.Status === CrmStatus.PAID && bookingMilestone.DemandStatus !== CrmStatus.PENDING
    && !bookingMilestoneInvoiced;
  const canGenerateAnything = bookingInvoiceReady;

  // The real, specific reason the Booking Amount invoice isn't generatable
  // yet — not a single hardcoded guess. Previously this said "pending a
  // Demand being raised" unconditionally, which is simply wrong once the
  // demand actually has been raised and the real blocker is an unpaid
  // balance instead; and it was gated on the WHOLE booking having zero
  // invoices, so it silently disappeared the moment any unrelated invoice
  // (Maintenance, Other, a later milestone) existed — exactly the situation
  // that let a ₹5,000 shortfall on the Booking Amount go unexplained next
  // to an unrelated ₹10,000 Maintenance invoice.
  const bookingInvoiceGapMessage = (() => {
    if (!bookingMilestone || bookingMilestoneInvoiced || bookingInvoiceReady) return null;
    if (bookingMilestone.Status !== CrmStatus.PAID && bookingMilestone.Status !== "Waived") {
      const due = Number(bookingMilestone.AmountDue || 0) - Number(bookingMilestone.AmountPaid || 0);
      return `Booking Amount is short by ${fmt(due)} (${fmt(bookingMilestone.AmountPaid)} of ${fmt(bookingMilestone.AmountDue)} paid) — invoice generation unlocks once it's fully paid`;
    }
    if (bookingMilestone.DemandStatus === CrmStatus.PENDING) {
      return "Booking Amount is fully paid — raise a Demand (Demands page) to unlock invoice generation";
    }
    return null;
  })();

  const openInvoiceDialog = () => {
    setInvoiceForm({ InvoiceType: "Milestone", Amount: "", InvoiceDate: "", Description: "", MilestoneId: bookingMilestone ? String(bookingMilestone.Id) : "", OnAccountPaymentId: "" });
    setInvoiceDialog(true);
  };

  const handleGenerateInvoice = async () => {
    if (!invoiceForm.MilestoneId) { toast.error("Booking milestone not found"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ InvoiceType: "Milestone", MilestoneId: parseInt(invoiceForm.MilestoneId), Description: invoiceForm.Description }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(`Invoice ${resData.InvoiceNo} generated — visible to the customer in their portal`);
      setInvoiceDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-booking-invoices", bookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // Renders ONE Data Review checklist item — tick box, status, remarks, Flag
  // for Recheck / resend-for-recheck controls — placed directly inside the
  // tab/card whose data it actually verifies, instead of one disconnected
  // "Data Review Checklist" block dumped above the tabs. Same tick/flag/
  // remarks logic as before (fireChecklistAction et al.), just rendered per
  // item, in place, card by card. Only interactive while the booking is at
  // the Review stage; still visible read-only afterward so the verified
  // state/remarks stay visible in context.
  //
  // ProjectUnitRate and PaymentPlanAmounts used to ALSO drive a separate
  // booking.UnitReviewConfirmed/PlanReviewConfirmed field via a second pair
  // of confirm-unit/confirm-plan API calls fired alongside this one — two
  // backend facts for what's really one fact, glued together only by this
  // component calling both endpoints on the same click. That second system
  // (columns + routes) is gone; this checkbox is now the single, real
  // action for both what it visibly checks and what the readiness gate
  // (checkBookingApprovalReadiness / submitForApproval) actually reads.
  const renderChecklistItem = (itemKey: string) => {
    const it = checklistItems.find((c: any) => c.ItemKey === itemKey);
    if (!it) return null;
    const interactive = currentStage === "Review";

    return (
      <div className="rounded-lg border border-border/70 px-3 py-2 bg-muted/10">
        <div className="flex items-start gap-2">
          <button
            type="button"
            disabled={!interactive || !canEdit || checklistBusyKey === it.ItemKey}
            onClick={() => fireChecklistAction(it.ItemKey, it.CheckStatus === "Checked" ? "uncheck" : "check")}
            className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
              it.CheckStatus === "Checked" ? "bg-emerald-600 border-emerald-600"
              : it.CheckStatus === "NeedsRecheck" ? "border-red-400 bg-red-50" : "border-border"
            }`}
          >
            {it.CheckStatus === "Checked" && <Check size={10} className="text-white" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{it.ItemLabel}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${
                it.CheckStatus === "Checked" ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : it.CheckStatus === "NeedsRecheck" ? "text-red-600 bg-red-50 border-red-200"
                : "text-muted-foreground bg-muted/50 border-border"
              }`}>
                {it.CheckStatus}
              </span>
            </div>
            {it.Remarks && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {it.CheckStatus === "NeedsRecheck" ? "Flagged: " : "Remark: "}{it.Remarks}
              </p>
            )}
            {interactive && canEdit && it.CheckStatus !== "NeedsRecheck" && (
              checklistFlaggingKey === it.ItemKey ? (
                <div className="mt-1.5 space-y-1">
                  <textarea value={checklistFlagRemark} onChange={(e) => setChecklistFlagRemark(e.target.value)}
                    placeholder="What needs to be fixed? (required)" rows={2}
                    className="w-full text-[11px] rounded border border-border px-2 py-1 bg-background" />
                  <div className="flex gap-1.5">
                    <button disabled={checklistBusyKey === it.ItemKey || !checklistFlagRemark.trim()}
                      onClick={() => fireChecklistAction(it.ItemKey, "flag", checklistFlagRemark)}
                      className="text-[11px] px-2 py-0.5 rounded bg-red-600 text-white disabled:opacity-40">
                      Send for Recheck
                    </button>
                    <button onClick={() => setChecklistFlaggingKey(null)} className="text-[11px] px-2 py-0.5 rounded border border-border">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setChecklistFlaggingKey(it.ItemKey)} className="mt-1 text-[10px] text-red-600 hover:underline">
                  Flag for Recheck
                </button>
              )
            )}
            {interactive && it.CheckStatus === "NeedsRecheck" && (
              <button onClick={() => fireChecklistAction(it.ItemKey, "resubmit")} disabled={checklistBusyKey === it.ItemKey}
                className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 disabled:opacity-40">
                I've revised this — resend for recheck
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (<>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Building2 size={16} className="text-amber-600 dark:text-amber-400" />
            {booking ? `${booking.BookingNo} — ${booking.ApplicantName}` : "Booking Detail"}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !booking ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current Stage</div>
                <div className="text-sm font-semibold">{stageLabels[currentStage] || currentStage}</div>
                {booking.StageRemarks && (
                  <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    <span className="font-semibold">Correction remarks: </span>{booking.StageRemarks}
                  </div>
                )}
              </div>
            </div>

            {/* ── Financial Status Bar ── always visible across all tabs ── */}
            {(() => {
              const totalCleared = milestoneList.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
              const mrReceived = (moneyReceipts as any[]).filter((r: any) => r.Status !== "Bounced").reduce((s: number, r: any) => s + Number(r.Amount || 0), 0);
              const storedGrand = Number(booking.GrandTotal ?? 0);
              const computedGrand = Number(booking.TotalValue || 0) + Number(booking.UnitGstAmount || 0) + Number(booking.ParkingTotal || 0) + Number(booking.ExtraChargesTotal || 0);
              const grandTotal = storedGrand > 0 ? storedGrand : computedGrand;
              return (
                <FinancialStatusBar
                  grandTotal={grandTotal}
                  cleared={totalCleared}
                  pendingReceipts={Math.max(0, mrReceived - totalCleared)}
                  approvedOnAccount={Number(onAccountData?.availableBalance || 0)}
                  overdueCount={milestoneList.filter((m: any) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date()).length}
                />
              );
            })()}

            {/* ── Booking Lifecycle Stepper ── */}
            <BookingLifecycleBar bookingId={booking.Id} />

            {rejectOpen && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={() => !stageActioning && setRejectOpen(false)}>
                <div className="bg-background border border-border rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold">Send Back for Correction</h3>
                  <textarea value={rejectRemark} onChange={(e) => setRejectRemark(e.target.value)}
                    placeholder="Required remarks"
                    className="w-full min-h-[110px] text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setRejectOpen(false)} disabled={stageActioning !== null}
                      className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40">
                      Cancel
                    </button>
                    <button onClick={handleStageReject} disabled={stageActioning !== null || !rejectRemark.trim()}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">
                      {stageActioning === "reject" ? "Sending..." : "Send Back"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2-step required flow (Unit & Value, Payment Plan — both are
                Data Review checklist items) plus a 3rd, INFORMATIONAL-ONLY
                Money Receipt status chip. Money Receipt does not gate
                the Verify/L1/L2 approval flow — that's the whole point of the
                decoupled design — but it was invisible from this header
                before, so staff had no way to tell it existed without
                clicking into the Payment & Invoice tab. This chip answers
                "where is the payment record" directly from the summary. */}
            {booking.Status !== CrmStatus.APPROVED && (() => {
              const latestReceipt = (moneyReceipts as any[])[0];
              const mrStatus: string = latestReceipt?.Status
                || (currentStage !== "Review" ? "Not created yet" : "Available once submitted for approval");
              const mrChipClass = latestReceipt?.Status === CrmStatus.APPROVED
                ? "text-emerald-700 bg-emerald-50"
                : latestReceipt?.Status === "Bounced"
                ? "text-red-700 bg-red-50"
                : latestReceipt?.Status === CrmStatus.PENDING
                ? "text-amber-700 bg-amber-50"
                : "text-muted-foreground bg-muted/40";
              return (
                <div className="flex items-center gap-1.5 px-1 py-2 text-xs overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[
                    { label: "1. Unit & Value", done: unitConfirmed, t: "Booking" as Tab },
                    { label: "2. Payment Plan", done: planConfirmed, t: "Payment Plan" as Tab },
                  ].map((s, i) => (
                    <React.Fragment key={s.label}>
                      <button onClick={() => setTab(s.t)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium shrink-0 ${
                          s.done ? "text-emerald-700 bg-emerald-50" : tab === s.t ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted/40"
                        }`}>
                        {s.done && <Check size={11} />} {s.label}
                      </button>
                      <ArrowRight size={11} className="text-muted-foreground shrink-0" />
                    </React.Fragment>
                  ))}
                  <button onClick={() => setTab("Payment & Invoice")}
                    title="Not required to book — informational only"
                    className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium shrink-0 ${mrChipClass}`}>
                    {latestReceipt?.Status === CrmStatus.APPROVED && <Check size={11} />} 3. Money Receipt: {mrStatus}
                  </button>
                  <span className="ml-4 shrink-0 whitespace-nowrap text-muted-foreground">
                    {mandatoryReady ? "Both required steps complete — ready to submit" : "Complete both required steps to submit"}
                  </span>
                </div>
              );
            })()}

            {/* Overall Data Review progress — a small at-a-glance readout;
                each item's actual tick/flag/remarks controls now live in
                the specific tab/card whose data they verify (see
                renderChecklistItem calls below), not dumped here as one
                block. */}
            {currentStage === "Review" && checklistItems.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                <span className="font-medium flex items-center gap-1.5"><ClipboardCheck size={13} className="text-primary" /> Data Review Checklist</span>
                <span className="text-muted-foreground">
                  {checklistItems.filter((it: any) => it.CheckStatus === "Checked").length}/{checklistItems.length} verified — tick each item on its own tab below
                </span>
              </div>
            )}

            {/* Wraps onto a second line instead of scrolling — simpler and
                more robust than a custom horizontal scroller (which kept
                clipping against the dialog's own bounds), and there's
                always room to wrap inside the dialog's max width. */}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-border px-1">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    tab === t ? "border-amber-500 text-amber-600 dark:text-amber-400" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "Booking" && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Application</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.ApplicationNo}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Company</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.CompanyName || "—"}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Project</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{booking.ProjectName || "—"}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Unit / Block</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{[booking.UnitNo, booking.BlockName].filter(Boolean).join(" / ") || "—"}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Rate / sqft</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30">{fmt(booking.RatePerSqFt)}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Grand Total</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30 font-semibold">{fmt(booking.GrandTotal ?? booking.TotalValue)}</div>
                  </div>
                </div>

                {/* GST is fixed, HSN-Master-driven — never a per-booking
                    input anywhere in this app. Unit+Parking picks 1% or 5%
                    off the Rs. 45L bracket automatically; Extra Work is
                    always 18%. The only way to change a rate is editing the
                    HSN Master row itself (9954AFH/9954OTH/9954EXW). */}
                <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">GST</p>
                    {booking.HsnCode && <span className="text-[11px] font-mono text-muted-foreground">{booking.HsnCode} · {booking.UnitParkingGstRate != null ? `${booking.UnitParkingGstRate}%` : "—"}</span>}
                  </div>

                  {/* Same explicit sequence everywhere this is shown (see
                      GstBreakdownBox in CrmApplication.tsx): Unit (+ its own
                      GST), Parking (+ its own GST), Extra Work (+ its own
                      GST) -> Amount (all three bases combined) -> GST
                      (combined) -> Total Amount. Unit and Parking share the
                      same HSN-resolved rate (the Rs. 45L bracket); Extra
                      Work is always 18% regardless of that bracket. */}
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Unit</span>
                    <span>{fmt(Number(booking.TotalValue))}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground pl-2">
                    <span>Unit GST</span>
                    <span>{fmt(booking.UnitGstAmount)}</span>
                  </div>
                  {Number(booking.ParkingTotal) > 0 && (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Parking</span>
                        <span>{fmt(Number(booking.ParkingTotal) - Number(booking.ParkingGstAmount || 0))}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground pl-2">
                        <span>Parking GST</span>
                        <span>{fmt(booking.ParkingGstAmount)}</span>
                      </div>
                    </>
                  )}
                  {Number(booking.ExtraChargesTotal) > 0 && (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Extra Work</span>
                        <span>{fmt(Number(booking.ExtraChargesTotal) - Number(booking.ExtraWorkGstAmount || 0))}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground pl-2">
                        <span>Extra Work GST (18%)</span>
                        <span>{fmt(booking.ExtraWorkGstAmount)}</span>
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between border-t border-border pt-1">
                    <span className="text-foreground">Amount</span>
                    <span className="font-medium text-foreground">
                      {fmt(Number(booking.TotalValue) + (Number(booking.ParkingTotal) - Number(booking.ParkingGstAmount || 0)) + (Number(booking.ExtraChargesTotal) - Number(booking.ExtraWorkGstAmount || 0)))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-foreground">GST</span>
                    <span className="font-medium text-foreground">{fmt(booking.TotalGstAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1 font-semibold">
                    <span>Total Amount</span>
                    <span className="text-amber-600 dark:text-amber-400">{fmt(booking.GrandTotal)}</span>
                  </div>
                </div>

                {/* Project, Unit and Rate/SqFt — a single checklist item,
                    a single action. See renderChecklistItem's own comment
                    for why there's no longer a separate Confirm button
                    here. */}
                {renderChecklistItem("ProjectUnitRate")}
                {renderChecklistItem("BrokerDetails")}
                {renderChecklistItem("SourceAssignment")}
              </div>
            )}

            {tab === "Payment Plan" && (
              <div className="space-y-4 pt-2">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardCheck size={15} className="text-amber-600 dark:text-amber-400" /> Payment Plan</h3>
                    {!planEditOpen && canEdit && booking.Status !== CrmStatus.APPROVED && (
                      <button onClick={() => { setPlanEditOpen(true); setPlanEditValue(booking.PaymentPlanId ? String(booking.PaymentPlanId) : ""); }}
                        className="text-xs text-amber-600 dark:text-amber-400 hover:underline shrink-0">
                        Edit
                      </button>
                    )}
                  </div>
                  {planEditOpen ? (
                    <div className="space-y-2">
                      <select value={planEditValue} onChange={(e) => setPlanEditValue(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                        <option value="">— Use default milestone schedule —</option>
                        {(scopedPlans as any[]).filter((p: any) => p.IsActive).map((p: any) => (
                          <option key={p.Id} value={String(p.Id)}>{p.PlanName}</option>
                        ))}
                      </select>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setPlanEditOpen(false)}
                          className="px-2.5 py-1 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted">
                          Cancel
                        </button>
                        <button onClick={handleSavePaymentPlan} disabled={planSaving}
                          className="px-2.5 py-1 text-xs text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40">
                          {planSaving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                      <span className="text-sm text-foreground">{booking.PaymentPlanName || "No plan set — 7-stage default schedule"}</span>
                    </div>
                  )}
                </div>

                {/* Where the Grand Total actually comes from — base Unit
                    Value plus whatever Parking/Extra Charges have been
                    added on the Parking & Extra Work tab. Pulled straight
                    from the CrmBooking row's own TotalValue/ParkingTotal/
                    ExtraChargesTotal/GrandTotal columns (GrandTotal is kept
                    in sync with these server-side on every update — see
                    crmBookings.js), so this can never drift from what the
                    Book action itself is checking. */}
                {(() => {
                  const unitValue = Number(booking.TotalValue || 0);
                  const parkingTotal = Number(booking.ParkingTotal || 0);
                  const extraTotal = Number(booking.ExtraChargesTotal || 0);
                  const grandTotal = Number(booking.GrandTotal ?? (unitValue + parkingTotal + extraTotal));
                  return (
                    <div className="rounded-xl border border-border p-4 space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={15} className="text-amber-600 dark:text-amber-400" /> Total Price Breakdown</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                          <div className="text-xs text-muted-foreground mb-0.5">Unit Base</div>
                          <div className="font-medium">{fmt(unitValue)}</div>
                        </div>
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                          <div className="text-xs text-muted-foreground mb-0.5">Unit GST</div>
                          <div className="font-medium">{fmt(booking.UnitGstAmount)}</div>
                        </div>
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                          <div className="text-xs text-muted-foreground mb-0.5">Parking incl. GST</div>
                          <div className="font-medium">{fmt(parkingTotal)}</div>
                        </div>
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                          <div className="text-xs text-muted-foreground mb-0.5">Extra incl. GST</div>
                          <div className="font-medium">{fmt(extraTotal)}</div>
                        </div>
                        <div className="rounded-lg bg-amber-500/10 px-2.5 py-2">
                          <div className="text-xs text-muted-foreground mb-0.5">Grand Total</div>
                          <div className="font-semibold text-amber-600 dark:text-amber-400">{fmt(grandTotal)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Full payment breakdown across every milestone category —
                    base schedule, Parking, and Extra Charges alike (all
                    three live in CrmPaymentMilestone; previously this only
                    showed the base schedule and silently left Parking/Extra
                    Charges out of both the table and the totals, so "paid
                    of total" never matched the real Grand Total). Grouped
                    by category so it stays readable, with one combined
                    total across all of them at the top. */}
                {(() => {
                  const scheduleRows = milestoneList.filter((m: any) => !m.ParkingAllotmentId && !m.ExtraChargeId);
                  const parkingRows = milestoneList.filter((m: any) => !!m.ParkingAllotmentId);
                  const extraRows = milestoneList.filter((m: any) => !!m.ExtraChargeId);
                  if (!milestoneList.length) return null;
                  const totalDue = milestoneList.reduce((s: number, m: any) => s + Number(m.AmountDue || 0), 0);
                  const totalPaid = milestoneList.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
                  const mrOnAccount = Math.max(0, (moneyReceipts as any[]).filter((r: any) => r.Status !== "Bounced").reduce((s: number, r: any) => s + Number(r.Amount || 0), 0) - totalPaid);
                  const firstUnpaidId = milestoneList.find((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived")?.Id;

                  const renderGroupRows = (label: string, rows: any[]) => rows.length > 0 && (
                    <React.Fragment key={label}>
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</td>
                      </tr>
                      {rows.map((m: any) => {
                        const paid = Number(m.AmountPaid || 0);
                        const due = Number(m.AmountDue || 0);
                        const isFirstUnpaid = m.Id === firstUnpaidId;
                        const mrForThis = isFirstUnpaid ? mrOnAccount : 0;
                        const effectivePaid = paid + mrForThis;
                        const bal = Math.max(0, due - effectivePaid);
                        const isOverdue = m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date();
                        return (
                        <tr key={m.Id} className={`border-b border-border ${isOverdue ? "bg-red-50/30 dark:bg-red-950/20" : ""}`}>
                          <td className="px-2.5 py-1.5 text-xs text-muted-foreground">{m.MilestoneNo}</td>
                          <td className="px-2.5 py-1.5">
                            <div>{m.MilestoneName}</div>
                            {isOverdue && <div className="text-[10px] text-red-600 font-medium flex items-center gap-0.5"><AlertTriangle size={9} /> Overdue since {new Date(m.DueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-xs text-muted-foreground">{m.Percent != null ? `${m.Percent}%` : "—"}</td>
                          <td className="px-2.5 py-1.5 text-right font-medium">
                            {fmt(due)}
                            {due > 0 && (
                              <div className="text-[10px] text-muted-foreground font-normal leading-tight mt-0.5">
                                Prin {fmt(due / (1 + (m.ExtraChargeId ? 18 : Number(booking?.UnitParkingGstRate || 0)) / 100))}<br/>
                                GST {fmt(due - (due / (1 + (m.ExtraChargeId ? 18 : Number(booking?.UnitParkingGstRate || 0)) / 100)))}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-emerald-700">
                            {fmt(paid)}
                            {mrForThis > 0 && (
                              <div className="text-[10px] text-blue-600 font-normal">+{fmt(mrForThis)} on account</div>
                            )}
                            {Number(m.PendingVerificationAmount) > 0 && (
                              <div className="text-[10px] text-amber-700 font-normal">+{fmt(m.PendingVerificationAmount)} pending verification</div>
                            )}
                          </td>
                          <td className={`px-2.5 py-1.5 text-right font-semibold ${bal > 0 ? (isOverdue ? "text-red-600" : "text-amber-700") : "text-muted-foreground"}`}>
                            {bal > 0 ? fmt(bal) : "—"}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                              m.Status === CrmStatus.PAID ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                : m.Status === "Waived" ? "text-muted-foreground bg-muted/40 border-border"
                                : isOverdue ? "text-red-700 bg-red-50 border-red-200"
                                : "text-amber-700 bg-amber-50 border-amber-200"
                            }`}>{isOverdue ? "Overdue" : m.Status}</span>
                            {/* Same "no orphan money" principle as the
                                On-Account section above: a milestone that's
                                fully paid but has no matching invoice yet is
                                real money sitting un-invoiced. Milestone 1
                                (Booking) is excluded — that one's generated
                                from this page's own Payment & Invoice tab;
                                every later milestone is generated from the
                                dedicated CRM Invoices page instead. Read-only
                                here, just a pointer. */}
                            {m.Status === CrmStatus.PAID && Number(m.MilestoneNo) !== 1
                              && !(invoices as any[]).some((inv: any) => inv.MilestoneId === m.Id && inv.Status !== "Void") && (
                              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-amber-700 bg-amber-50 border-amber-200">
                                Invoice Generation Pending
                              </span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </React.Fragment>
                  );

                  return (
                    <div className="rounded-xl border border-border p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={15} className="text-amber-600 dark:text-amber-400" /> Payment Breakdown</h3>
                        <span className="text-xs text-muted-foreground">
                          {fmt(totalPaid)} of {fmt(totalDue)} cleared
                          {mrOnAccount > 0 && <span className="text-blue-600"> · {fmt(mrOnAccount)} on account</span>}
                        </span>
                      </div>
                      <div className="overflow-x-auto thin-scroll">
                        <div className="min-w-[520px]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left px-2.5 py-1.5 text-xs text-muted-foreground font-medium">#</th>
                                <th className="text-left px-2.5 py-1.5 text-xs text-muted-foreground font-medium">Milestone</th>
                                <th className="text-right px-2.5 py-1.5 text-xs text-muted-foreground font-medium">%</th>
                                <th className="text-right px-2.5 py-1.5 text-xs text-muted-foreground font-medium">Amount Due</th>
                                <th className="text-right px-2.5 py-1.5 text-xs text-muted-foreground font-medium">Paid</th>
                                <th className="text-right px-2.5 py-1.5 text-xs text-muted-foreground font-medium">Balance</th>
                                <th className="text-left px-2.5 py-1.5 text-xs text-muted-foreground font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {renderGroupRows("Base Value Schedule", scheduleRows)}
                              {renderGroupRows("Parking", parkingRows)}
                              {renderGroupRows("Extra Charges", extraRows)}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Payment Plan and Token/Booking Amount — a single
                    checklist item, a single action. See
                    renderChecklistItem's own comment for why there's no
                    longer a separate Confirm button here. */}
                {renderChecklistItem("PaymentPlanAmounts")}
              </div>
            )}

            {tab === "Payment & Invoice" && (
              <div className="space-y-3 pt-2">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><CreditCard size={15} className="text-amber-600 dark:text-amber-400" /> Booking Amount</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Total Due</span><span className="font-semibold">{bookingAmountDue > 0 ? fmt(bookingAmountDue) : "Not set"}</span></div>
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-emerald-700">{fmt(bookingAmountPaid)}</span></div>
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Due Remaining</span><span className="font-semibold text-amber-700">{bookingAmountDue > 0 ? fmt(bookingAmountBalance) : "—"}</span></div>
                    {/* The customer's real, tracked on-account credit
                        (CrmOnAccountPayment, its own OACC-xxxx deposits) —
                        independent of whether Milestone 1 itself is exactly
                        paid. Shown only when non-zero so a booking with no
                        on-account deposits doesn't display a redundant ₹0
                        card. */}
                    {bookingOnAccountBalance > 0 && (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2"><span className="text-sky-700 block">Balance (On Account)</span><span className="font-semibold text-sky-700">{fmt(bookingOnAccountBalance)}</span></div>
                    )}
                  </div>
                  {/* Token payment transparency — shows whenever the customer
                      has paid a token amount and it hasn't yet been fully
                      approved by Finance. Covers four states:
                      A) Token exists, no Money Receipt yet (still at Review)
                      B) Money Receipt created but not yet submitted to Finance
                      C) Submitted to Finance, awaiting approval
                      D) Bounced — needs resubmission */}
                  {Number(booking?.TokenValue) > 0 && (() => {
                    const receipt = (moneyReceipts as any[])[0];
                    const tokenAmt = Number(booking.TokenValue);
                    const pmode = booking.PaymentMode || "—";

                    // State D — bounced
                    if (receipt?.Status === "Bounced") {
                      return (
                        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 px-3 py-2.5 text-xs mt-1">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                          <div>
                            <p className="font-semibold text-red-700 dark:text-red-300">Token Payment Bounced — {fmt(tokenAmt)}</p>
                            <p className="text-red-600 dark:text-red-400 mt-0.5">
                              {receipt.BouncedReason ? `Reason: ${receipt.BouncedReason}. ` : ""}
                              A new Money Receipt must be submitted.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // State C — submitted to Finance (RPStatus = Pending)
                    if (receipt?.Status === CrmStatus.PENDING && receipt?.RPStatus === CrmStatus.PENDING) {
                      return (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2.5 text-xs mt-1">
                          <Hourglass size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                          <div className="space-y-0.5">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              {fmt(receipt.Amount || tokenAmt)} held — awaiting Finance approval
                            </p>
                            <p className="text-amber-700 dark:text-amber-400">
                              Receipt {receipt.ReceiptNo} · {pmode} · submitted to Finance (Account's Head / Admin).
                              This amount will count as paid once approved.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // State B — Money Receipt created, not yet submitted to Finance
                    if (receipt?.Status === CrmStatus.PENDING && !receipt?.RPStatus) {
                      return (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2.5 text-xs mt-1">
                          <Clock size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                          <div className="space-y-0.5">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              {fmt(receipt.Amount || tokenAmt)} on hold — Money Receipt pending Finance submission
                            </p>
                            <p className="text-amber-700 dark:text-amber-400">
                              Receipt {receipt.ReceiptNo} · {pmode} · created but not yet sent to Finance for approval.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // State A — no receipt yet (booking still at Review / before submission)
                    if (!receipt) {
                      return (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2.5 text-xs mt-1">
                          <Clock size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                          <div className="space-y-0.5">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              Token Received &amp; On Hold — {fmt(tokenAmt)} via {pmode}
                            </p>
                            <p className="text-amber-700 dark:text-amber-400">
                              Payment recorded but not yet processed. A Money Receipt is auto-generated when this booking is submitted for approval
                              ("Verify &amp; Send for Approval"). Finance approves it — only then does it count as paid.
                            </p>
                          </div>
                        </div>
                      );
                    }

                    return null; // Approved — reflected in AmountPaid already
                  })()}
                  {bookingAmountDue <= 0 && (
                    <p className="text-[11px] text-muted-foreground">Booking Amount not set on the payment plan — open the Payment Plan Master and set a fixed Booking Amount.</p>
                  )}
                  {bookingAmountPaidInFull && (
                    <p className="text-[11px] text-emerald-700">Booking Amount fully paid.</p>
                  )}
                </div>

                {/* On-account deposits — money received in excess of what's
                    currently due (CrmOnAccountPayment), auto-parked and later
                    auto-applied to future milestones as they come due. Real
                    cash received, so each one needs an invoice just like a
                    paid milestone — this card is where that gets raised.
                    Only rendered when the booking actually has any deposits,
                    so a booking with none doesn't show an empty card. */}
                {(onAccountData?.payments || []).length > 0 && (
                  <div className="rounded-xl border border-border p-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} className="text-amber-600 dark:text-amber-400" /> On-Account Payments</h3>
                    <div className="space-y-1.5">
                      {(onAccountData.payments as any[]).map((p: any) => {
                        const inv = (invoices as any[]).find((i: any) => i.OnAccountPaymentId === p.Id)
                          || (p.InvoiceId ? { Id: p.InvoiceId, InvoiceNo: p.InvoiceNo, InvoiceType: "OnAccount", Amount: p.Amount, InvoiceDate: p.InvoiceDate, Status: p.InvoiceStatus, OnAccountPaymentId: p.Id } : null);
                        return (
                          <div key={p.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                            <div className="space-y-0.5">
                              <div className="font-medium">{p.ReceiptNo} — {fmt(p.Amount)}</div>
                              <div className="text-muted-foreground">
                                {p.ReceivedDate ? new Date(p.ReceivedDate).toLocaleDateString("en-IN") : "—"} · {p.PaymentMode || "—"}
                              </div>
                              {(() => {
                                const unapplied = Number(p.Amount || 0) - Number(p.AppliedAmount || 0);
                                const statusColor = p.Status === "Applied" ? "text-emerald-700" : p.Status === "PartiallyApplied" ? "text-amber-700" : "text-blue-700";
                                return (
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`font-medium ${statusColor}`}>{p.Status || "Unapplied"}</span>
                                    {unapplied > 0 && <span className="text-blue-700 font-medium">· {fmt(unapplied)} unapplied</span>}
                                  </div>
                                );
                              })()}
                            </div>
                            {inv ? (
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="flex items-center gap-1 text-xs font-medium text-green-600"><Check size={13} /> Invoiced</span>
                                <button onClick={() => setPreviewInvoice(inv)}
                                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
                                  <Eye size={12} /> View
                                </button>
                                <button onClick={() => handleDownloadInvoicePdf(inv)}
                                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
                                  <Download size={12} /> Download
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border text-amber-700 bg-amber-50 border-amber-200">
                                  Invoice Generation Pending
                                </span>
                                {canEdit && (
                                  <a href={`/crm/invoices?bookingId=${bookingId}`} className="px-2.5 py-1 text-xs border border-border rounded-md font-medium hover:bg-muted">
                                    Generate from Invoices page
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Legacy fallback ONLY — Money Receipt (create -> approve) is
                    the real path for the Booking Amount now, auto-created
                    the moment the booking is actually submitted for approval
                    (Confirm & Book), not merely once the checklist is
                    complete — see PUT /:id/ready-for-approval. This must
                    never show before that submission (the server-side gate
                    would reject it anyway), or a booking still sitting at
                    Review could get a payment submitted with no
                    CrmMoneyReceipt attached, and the auto-create trigger
                    would then create a second, duplicate receipt for the
                    same money once it's actually submitted. It only exists
                    for bookings that had already moved past Review before
                    this feature shipped, so the auto-create trigger never
                    fired for them. */}
                {canEdit && booking.Status !== CrmStatus.APPROVED && !bookingAmountPaidInFull && bookingAmountDue > 0
                  && !(Number(firstMilestone?.PendingVerificationAmount) > 0)
                  && currentStage !== "Review" && moneyReceipts.length === 0 && (
                  <div className="rounded-xl border border-border p-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={15} className="text-amber-600 dark:text-amber-400" /> Submit Payment for Approval</h3>
                    <p className="text-[11px] text-muted-foreground">Creates the Money Receipt for this booking — it goes Pending until Finance/Account's Head approves it.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" placeholder={`Amount — Balance Due ${fmt(bookingAmountBalance)}`} value={payForm.Amount}
                        onChange={(e) => setPayForm((f) => ({ ...f, Amount: e.target.value }))}
                        className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      <select value={payForm.PaymentMode} onChange={(e) => setPayForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                        className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                        {["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Card"].map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <input type="date" value={payForm.ReceivedDate} onChange={(e) => setPayForm((f) => ({ ...f, ReceivedDate: e.target.value }))}
                        className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      {payForm.PaymentMode === "Cheque" ? (
                        <input placeholder="Cheque No" value={payForm.TransactionRef} onChange={(e) => setPayForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                          className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      ) : payForm.PaymentMode !== "Cash" ? (
                        <input placeholder="Transaction Ref / UTR" value={payForm.TransactionRef} onChange={(e) => setPayForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                          className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      ) : null}
                      <select value={payForm.DepositBankId} onChange={(e) => setPayForm((f) => ({ ...f, DepositBankId: e.target.value }))}
                        className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                        <option value="">— Select deposit bank —{bankOptions.length > 0 ? " *" : ""}</option>
                        {(bankOptions as any[]).map((b: any) => (
                          <option key={b.BId} value={String(b.BId)}>{b.BName}</option>
                        ))}
                      </select>
                      {payForm.PaymentMode === "Cheque" && (
                        <input type="date" value={payForm.ChequeDate} onChange={(e) => setPayForm((f) => ({ ...f, ChequeDate: e.target.value }))}
                          className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      )}
                    </div>
                    <button onClick={handleRecordPayment} disabled={paySaving || (bankOptions.length > 0 && !payForm.DepositBankId)}
                      className="w-full py-2 text-sm font-medium text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40">
                      {paySaving ? "Submitting..." : `Submit for Approval`}
                    </button>
                  </div>
                )}

                {renderChecklistItem("BankDepositMode")}
              </div>
            )}

            {tab === "Parking & Extra Work" && (
              <div className="space-y-4 pt-2">
                {/* Pending amendments banner */}
                {isAmendmentApprover && (pendingAmendments as any[]).length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-amber-800"><ShieldAlert size={14} /> Pending Amendments ({pendingAmendments.length})</h3>
                    {(pendingAmendments as any[]).map((a: any) => (
                      <div key={a.Id} className="text-xs bg-white rounded-lg p-2 border border-amber-100 flex items-start justify-between gap-2">
                        <div><span className="font-medium">{a.FieldName}</span> — {a.NewValue ? `→ ${a.NewValue}` : "Removed"} <span className="text-muted-foreground">by {a.CreatedByName}</span></div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => handleApproveAmendment(a.Id)} disabled={reviewingAmendmentId === a.Id}
                            className="px-2 py-0.5 text-[10px] bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-40">
                            Approve
                          </button>
                          <button onClick={() => handleRejectAmendment(a.Id)} disabled={reviewingAmendmentId === a.Id}
                            className="px-2 py-0.5 text-[10px] bg-red-600 text-white rounded font-medium hover:bg-red-700 disabled:opacity-40">
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Status summary — at-a-glance health of parking + extras for this booking */}
                {(() => {
                  const totalCleared = milestoneList.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
                  const grandTotal = Number(booking?.GrandTotal || 0);
                  const collectedPct = grandTotal > 0 ? Math.min(100, Math.round((totalCleared / grandTotal) * 100)) : 0;
                  const parkingCount = (parking as any[]).length;
                  const extrasCount = (extras as any[]).length;
                  const hasParking = parkingCount > 0;
                  const parkingTotal = (parking as any[]).reduce((s: number, p: any) => s + Number(p.TotalAmount || 0), 0);
                  const extrasTotal = (extras as any[]).reduce((s: number, c: any) => s + Number(c.TotalAmount || 0), 0);
                  const checks = [
                    {
                      label: "Parking allotted",
                      ok: hasParking,
                      detail: hasParking ? `${parkingCount} slot${parkingCount > 1 ? "s" : ""} — ${fmt(parkingTotal)}` : "No parking added to this booking",
                      na: false,
                    },
                    {
                      label: "Extra charges",
                      ok: extrasCount > 0,
                      detail: extrasCount > 0 ? `${extrasCount} item${extrasCount > 1 ? "s" : ""} — ${fmt(extrasTotal)}` : "None added",
                      na: extrasCount === 0,
                    },
                    {
                      label: "Grand total reflects all additions",
                      ok: grandTotal > 0,
                      detail: grandTotal > 0 ? `${fmt(grandTotal)} (unit + parking + extras + GST)` : "Grand total not yet computed",
                      na: false,
                    },
                    {
                      label: "Payment collection in progress",
                      ok: collectedPct > 0,
                      detail: collectedPct >= 100 ? "Fully collected" : collectedPct > 0 ? `${fmt(totalCleared)} collected (${collectedPct}% of grand total)` : "No payments received yet",
                      na: false,
                    },
                  ];
                  return (
                    <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Section Status</h3>
                      {checks.map((c) => (
                        <div key={c.label} className="flex items-start gap-2.5">
                          <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                            c.ok ? "bg-green-100 text-green-600" : c.na ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-600"
                          }`}>
                            {c.ok ? "✓" : c.na ? "—" : "!"}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium">{c.label}</div>
                            <div className="text-[11px] text-muted-foreground">{c.detail}</div>
                          </div>
                        </div>
                      ))}
                      {grandTotal > 0 && (
                        <div className="pt-2 mt-1 border-t border-border space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Booking collection progress</span>
                            <span className="font-medium text-foreground">{collectedPct}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all ${collectedPct >= 100 ? "bg-green-500" : collectedPct > 0 ? "bg-amber-400" : "bg-muted-foreground/20"}`}
                              style={{ width: `${Math.max(collectedPct, 2)}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-muted-foreground">{fmt(totalCleared)} of {fmt(grandTotal)} collected</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Parking */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><Car size={15} className="text-amber-600 dark:text-amber-400" /> Parking Allotments</h3>
                    {(parking as any[]).length > 0 && (
                      <span className="text-xs font-semibold text-foreground">
                        Total {fmt((parking as any[]).reduce((s: number, p: any) => s + Number(p.TotalAmount || 0), 0))}
                      </span>
                    )}
                  </div>
                  {(parking as any[]).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No parking allotments linked to this booking.</p>
                  ) : (
                    <div className="space-y-2">
                      {(parking as any[]).map((p: any) => (
                        <div key={p.Id} className="rounded-lg border border-border px-3 py-2.5 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{p.SlotNo || p.ParkingSlotNo || `Slot #${p.ParkingSlotId ?? "—"}`}</span>
                                {p.CurrentParkingType && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-muted-foreground bg-muted/40">{p.CurrentParkingType}</span>
                                )}
                                {/* Unit-linked parking has no independent payment status —
                                    its value is merged into the booking's milestone schedule.
                                    "With Booking" is the only honest label here; "Pending"
                                    would stay forever until 100% booking settlement. */}
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium text-blue-600 bg-blue-50 border-blue-200"
                                  title="Parking cost is included in this booking's grand total and collected via the booking's payment milestones">
                                  With Booking
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {editingParkingId === p.Id ? (
                                <>
                                  <input type="number" min="1" value={parkingForm.Quantity}
                                    onChange={(e) => setParkingForm((f) => ({ ...f, Quantity: e.target.value }))}
                                    className="w-16 text-sm border border-border rounded px-1.5 py-1 bg-background" />
                                  {/* Approximate preview at the booking's CURRENT bracket
                                      rate — if this quantity change itself crosses the
                                      Rs. 45L bracket, the confirmed rate/amount (possibly
                                      different) is what actually saves. */}
                                  {parkingForm.Quantity && Number(parkingForm.Quantity) > 0 && booking.UnitParkingGstRate != null && (
                                    <span className="text-[11px] text-sky-700 whitespace-nowrap">
                                      ≈ {fmtInr(Number(p.RateSnapshot) * Number(parkingForm.Quantity) * (1 + Number(booking.UnitParkingGstRate) / 100))} incl. GST
                                    </span>
                                  )}
                                  <button onClick={handleAddParking} disabled={chargesSaving}
                                    className="px-2 py-1 text-xs text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded font-medium disabled:opacity-40">
                                    Save
                                  </button>
                                  <button onClick={cancelEditParking}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Cancel
                                  </button>
                                </>
                              ) : canEdit ? (
                                <>
                                  <button onClick={() => startEditParking(p)}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Edit
                                  </button>
                                  {isSuperAdmin && (
                                    <button onClick={() => handleRemoveParking(p.Id)}
                                      className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                                      Release
                                    </button>
                                  )}
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                            <div><span className="text-muted-foreground block">Qty</span><span className="font-medium">{p.Quantity}</span></div>
                            <div><span className="text-muted-foreground block">Rate</span><span className="font-medium">{fmt(p.RateSnapshot)}</span></div>
                            <div><span className="text-muted-foreground block">GST</span><span className="font-medium">{p.GstRateSnapshot != null ? `${p.GstRateSnapshot}% (${fmt(p.GstAmount)})` : "—"}</span></div>
                            <div><span className="text-muted-foreground block">Total</span><span className="font-semibold text-foreground">{fmt(p.TotalAmount)}</span></div>
                            <div><span className="text-muted-foreground block">Receipt</span><span className="font-medium">{p.ReceiptNo || "—"}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Extra Charges */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} className="text-amber-600 dark:text-amber-400" /> Extra Charges</h3>
                  <div className="overflow-x-auto thin-scroll">
                    {(extras as any[]).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No extra charges added yet.</p>
                    ) : (
                      <div className="min-w-[500px]">
                        {(extras as any[]).map((c: any) => (
                          <div key={c.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 mb-1.5">
                            <div className="space-y-0.5 min-w-0">
                              <span className="text-sm font-medium">{c.Description}</span>
                              <div className="flex gap-3 text-xs text-muted-foreground">
                                <span>{fmt(c.Amount)}</span>
                                <span>GST: {c.GstRate}%</span>
                                <span>Total: {fmt(c.TotalAmount)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {editingExtraId === c.Id ? (
                                <>
                                  <input placeholder="Description" value={extraForm.Description}
                                    onChange={(e) => setExtraForm((f) => ({ ...f, Description: e.target.value }))}
                                    className="w-28 text-xs border border-border rounded px-1.5 py-1 bg-background" />
                                  <input type="number" placeholder="Amount" value={extraForm.Amount}
                                    onChange={(e) => setExtraForm((f) => ({ ...f, Amount: e.target.value }))}
                                    className="w-20 text-xs border border-border rounded px-1.5 py-1 bg-background" />
                                  <button onClick={handleAddExtra} disabled={chargesSaving}
                                    className="px-2 py-1 text-xs text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded font-medium disabled:opacity-40">
                                    Save
                                  </button>
                                  <button onClick={cancelEditExtra}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Cancel
                                  </button>
                                </>
                              ) : canEdit ? (
                                <>
                                  <button onClick={() => startEditExtra(c)}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Edit
                                  </button>
                                  <button onClick={() => handleRemoveExtra(c.Id)}
                                    className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                                    Remove
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {canEdit && !editingExtraId && booking.Status !== CrmStatus.APPROVED && (
                    <>
                      {legalWorkStarted && (
                        <input placeholder="Reason for amendment (required)" value={extraReason}
                          onChange={(e) => setExtraReason(e.target.value)}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      )}
                      <div className="flex items-center gap-2">
                        <select value={extraForm.ExtraChargeMasterId} onChange={(e) => {
                          const selected = (chargeTypes as any[]).find((ct: any) => String(ct.Id) === e.target.value);
                          setExtraForm((f) => ({
                            ...f,
                            ExtraChargeMasterId: e.target.value,
                            Description: selected?.Name || f.Description,
                            Amount: selected?.DefaultAmount ? String(selected.DefaultAmount) : f.Amount,
                          }));
                        }}
                          className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                          <option value="">— Select charge type —</option>
                          {(chargeTypes as any[]).map((ct: any) => (
                            <option key={ct.Id} value={String(ct.Id)}>{ct.Name} {ct.DefaultAmount ? `(${fmt(ct.DefaultAmount)})` : ""}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <input placeholder="Description" value={extraForm.Description}
                          onChange={(e) => setExtraForm((f) => ({ ...f, Description: e.target.value }))}
                          className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        <input type="number" placeholder="Amount" value={extraForm.Amount}
                          onChange={(e) => setExtraForm((f) => ({ ...f, Amount: e.target.value }))}
                          className="w-32 text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        <button onClick={handleAddExtra} disabled={chargesSaving}
                          className="px-3 py-1.5 text-sm text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 shrink-0">
                          {chargesSaving ? "Adding..." : "Add"}
                        </button>
                      </div>
                      {/* Live GST preview — 18% is fixed from the HSN Master
                          "Extra Work" row; there's no rate to pick anymore. */}
                      {extraForm.Amount && Number(extraForm.Amount) > 0 && (
                        <ExtraWorkGstPreview amount={Number(extraForm.Amount)} />
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === "Bank Details" && (
              <div className="space-y-4 pt-2">
                {!bankLoaded ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">Loading bank details...</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {[
                        { key: "BankName", label: "Bank Name", type: "text" },
                        { key: "BranchName", label: "Branch Name", type: "text" },
                        { key: "AccountNo", label: "Account Number", type: "text" },
                        { key: "IfscCode", label: "IFSC Code", type: "text" },
                        { key: "AccountHolderName", label: "Account Holder Name", type: "text" },
                        { key: "PanNo", label: "PAN Number", type: "text" },
                        { key: "AadhaarNo", label: "Aadhaar Number", type: "text" },
                        { key: "Occupation", label: "Occupation", type: "text" },
                        { key: "AnnualIncome", label: "Annual Income", type: "number" },
                      ].map((f) => (
                        <div key={f.key}>
                          <label className="text-xs text-muted-foreground block mb-1">{f.label}</label>
                          <input type={f.type} value={(bank as any)[f.key] || ""}
                            disabled={booking.Status === CrmStatus.APPROVED || bankLocked}
                            onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60 disabled:cursor-not-allowed" />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {[
                        { key: "NomineeName", label: "Nominee Name", type: "text" },
                        { key: "NomineeRelation", label: "Relation", type: "text" },
                        { key: "NomineeDob", label: "Nominee DOB", type: "date" },
                        { key: "NomineeContact", label: "Nominee Contact", type: "text" },
                      ].map((f) => (
                        <div key={f.key}>
                          <label className="text-xs text-muted-foreground block mb-1">{f.label}</label>
                          <input type={f.type} value={(bank as any)[f.key] || ""}
                            disabled={booking.Status === CrmStatus.APPROVED || bankLocked}
                            onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60 disabled:cursor-not-allowed" />
                        </div>
                      ))}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Nominee Address</label>
                        <textarea value={bank.NomineeAddress}
                          disabled={booking.Status === CrmStatus.APPROVED || bankLocked}
                          onChange={(e) => setBank((b) => ({ ...b, NomineeAddress: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background resize-none disabled:opacity-60 disabled:cursor-not-allowed" rows={2} />
                      </div>
                    </div>
                    {booking.Status === CrmStatus.APPROVED && (
                      <p className="text-xs text-muted-foreground">Locked — this Booking is Approved. Bank/KYC details can no longer be edited here.</p>
                    )}
                    {booking.Status !== CrmStatus.APPROVED && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">Bank/KYC Details</p>
                          {bankLocked && bankVerifiedAt && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Verified by {bankVerifiedByName || "—"} on {new Date(bankVerifiedAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        {bankLocked ? (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                              <Check size={13} /> {bankVerifiedAt ? "Verified" : "Saved"}
                            </span>
                            {canEdit && (
                              <button onClick={() => setBankLocked(false)}
                                className="px-2 py-0.5 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md font-medium hover:bg-amber-100">
                                Edit
                              </button>
                            )}
                          </div>
                        ) : canEdit ? (
                          <button onClick={handleSaveBank} disabled={bankSaving}
                            className="px-2.5 py-1 text-xs border border-border rounded-lg font-medium hover:bg-muted disabled:opacity-40">
                            {bankSaving ? "Saving..." : "Verify & Save Bank/KYC Details"}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not saved</span>
                        )}
                      </div>
                    )}
                  </>
                )}

                {renderChecklistItem("ApplicantKyc")}
              </div>
            )}

            {tab === "Customer Portal" && (
              <div className="space-y-4 pt-2">
                {portalFetching ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <RefreshCw size={15} className="animate-spin" />
                    Checking portal status…
                  </div>
                ) : portalStatus?.hasPortal ? (
                  <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                    {/* Header stripe */}
                    <div className={`px-5 py-4 flex items-center justify-between gap-4 border-b border-border ${portalStatus.isActive ? "bg-emerald-500/8 dark:bg-emerald-500/10" : "bg-rose-500/8 dark:bg-rose-500/10"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${portalStatus.isActive ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-rose-100 dark:bg-rose-500/20"}`}>
                          <ShieldCheck size={20} className={portalStatus.isActive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"} />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Customer Portal</p>
                          <p className={`text-sm font-bold mt-0.5 ${portalStatus.isActive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {portalStatus.isActive ? "Access Active" : "Access Deactivated"}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleTogglePortalAccess(portalStatus.isActive)}
                        disabled={togglingPortal}
                        className={`shrink-0 px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                          portalStatus.isActive
                            ? "border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/40"
                            : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/40"
                        }`}
                      >
                        {togglingPortal ? "Updating…" : portalStatus.isActive ? "Deactivate Access" : "Reactivate Access"}
                      </button>
                    </div>

                    {/* Detail rows */}
                    <div className="divide-y divide-border/60">
                      <div className="px-5 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                          <Mail size={13} className="text-primary shrink-0" />
                          <span>Login Email</span>
                        </div>
                        <span className="text-xs font-medium text-foreground font-mono">{portalStatus.email || "—"}</span>
                      </div>
                      <div className="px-5 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                          <KeyRound size={13} className="text-primary shrink-0" />
                          <span>Password Status</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                          portalStatus.mustChangePassword
                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-700"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-700"
                        }`}>
                          {portalStatus.mustChangePassword ? "First login pending" : "Password set by customer"}
                        </span>
                      </div>
                      {portalStatus.customerName && (
                        <div className="px-5 py-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                            <User size={13} className="text-primary shrink-0" />
                            <span>Account Holder</span>
                          </div>
                          <span className="text-xs font-medium text-foreground">{portalStatus.customerName}</span>
                        </div>
                      )}
                      {portalStatus.portalCreatedAt && (
                        <div className="px-5 py-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                            <CalendarCheck size={13} className="text-primary shrink-0" />
                            <span>Provisioned</span>
                          </div>
                          <span className="text-xs text-foreground">
                            {new Date(portalStatus.portalCreatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Initial password hint */}
                    {portalStatus.mustChangePassword && portalStatus.maskedMobile && (
                      <div className="px-5 py-3 bg-muted/30 border-t border-border flex items-start gap-2.5 text-xs text-muted-foreground">
                        <Hourglass size={13} className="shrink-0 mt-0.5 text-amber-500" />
                        <p>
                          Initial password is the applicant's mobile number <span className="font-mono font-medium text-foreground">{portalStatus.maskedMobile}</span>. They'll be prompted to set a new password on first login.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center text-center gap-3">
                    <div className="h-14 w-14 rounded-full bg-muted/60 border border-border flex items-center justify-center">
                      <Lock size={24} className="text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">Portal Not Provisioned</h4>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                        {portalStatus?.workflowStage !== "Confirmed"
                          ? "The customer portal is provisioned automatically once this booking reaches Confirmed status."
                          : "This booking is Confirmed but no portal account exists yet. Provision it manually below."}
                      </p>
                    </div>
                    {portalStatus?.workflowStage === "Confirmed" && (
                      <button
                        onClick={handleProvisionPortal}
                        disabled={provisioning}
                        className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl shadow-sm hover:opacity-90 disabled:opacity-50 transition-all"
                      >
                        <KeyRound size={15} />
                        {provisioning ? "Provisioning…" : "Provision Customer Portal"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "Attachments" && (
              <div className="space-y-4 pt-2">
                {canEdit && booking.Status !== CrmStatus.APPROVED && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg cursor-pointer hover:bg-muted">
                      <Upload size={14} />
                      {uploading ? "Uploading..." : "Upload Files"}
                      <input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
                    </label>
                  </div>
                )}
                {booking.Status === CrmStatus.APPROVED && (
                  <p className="text-xs text-muted-foreground">Locked — this Booking is Approved. Attachments can no longer be added or removed here.</p>
                )}
                {(attachments as any[]).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No attachments yet.</p>
                ) : (
                  <div className="overflow-x-auto thin-scroll">
                    <div className="min-w-[600px]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium">File</th>
                            <th className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium">Date</th>
                            <th className="text-right px-2.5 py-2 text-xs text-muted-foreground font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(attachments as any[]).map((a: any) => (
                            <tr key={a.Id} className="border-b border-border hover:bg-muted/30">
                              <td className="px-2.5 py-2 flex items-center gap-1.5">
                                <Paperclip size={12} className="text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[200px] sm:max-w-[300px]">{a.FileName}</span>
                              </td>
                              <td className="px-2.5 py-2 text-xs text-muted-foreground">{a.CreatedAt ? new Date(a.CreatedAt).toLocaleDateString("en-IN") : "—"}</td>
                              <td className="px-2.5 py-2 text-right">
                                <a href={a.FileUrl} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted">
                                  <Download size={11} /> Download
                                </a>
                                {canEdit && booking.Status !== CrmStatus.APPROVED && (
                                  <button onClick={() => handleDeleteAttachment(a.Id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded ml-1">
                                    <Trash2 size={11} /> Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {renderChecklistItem("Documents")}
              </div>
            )}

            {tab === "Payment & Invoice" && (
              <div className="space-y-4 pt-4 mt-1 border-t border-border">
                {/* Money Receipt — inline card with View + Download, no page navigation */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <FileText size={15} className="text-primary" /> Money Receipt
                  </h3>

                  {(moneyReceipts as any[]).length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {currentStage === "Review"
                        ? "Auto-generated when this booking is submitted for approval (Verify & Send for Approval)."
                        : "No money receipt yet."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(moneyReceipts as any[]).map((mr: any) => {
                        const statusColor =
                          mr.Status === CrmStatus.APPROVED ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800"
                          : mr.Status === "Bounced" ? "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800"
                          : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800";
                        const pdfUrl = `/api/crm/money-receipts/${mr.Id}/pdf`;
                        return (
                          <div key={mr.Id} className="rounded-lg border border-border bg-muted/10 px-3 py-2.5 space-y-2">
                            {/* top row: receipt no + status + actions */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold">{mr.ReceiptNo}</span>
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusColor}`}>
                                  {mr.Status}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button onClick={() => setPreviewReceipt(mr)}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-lg hover:bg-muted font-medium">
                                  <Eye size={11} /> View
                                </button>
                                <button onClick={() => handleDownloadReceiptPdf(mr)}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-lg hover:bg-muted font-medium">
                                  <Download size={11} /> Download PDF
                                </button>
                              </div>
                            </div>
                            {/* detail grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                              <div><span className="font-medium text-foreground">{fmt(mr.Amount)}</span><span className="block">Amount</span></div>
                              <div><span className="font-medium text-foreground">{mr.PaymentMode || "—"}</span><span className="block">Mode</span></div>
                              <div>
                                <span className="font-medium text-foreground">
                                  {mr.ChequeNo || mr.TransactionRef || "—"}
                                </span>
                                <span className="block">{mr.PaymentMode === "Cheque" ? "Cheque No" : "Ref / UTR"}</span>
                              </div>
                              <div>
                                <span className="font-medium text-foreground">
                                  {mr.ReceivedDate ? new Date(mr.ReceivedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                                </span>
                                <span className="block">Received Date</span>
                              </div>
                            </div>
                            {mr.BouncedReason && (
                              <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertTriangle size={11} /> {mr.BouncedReason}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileText size={15} className="text-amber-600 dark:text-amber-400" /> Invoices</h3>
                  {/* Invoices are manual-only, gated on a milestone's own
                      Demand — not on whether the booking is still Approved.
                      That used to hide this button once Approved (a leftover
                      from the old auto-invoice design, back when Approved
                      meant "everything already happened automatically"), but
                      that's backwards now: Approved is exactly when staff
                      actually need to generate the Booking-amount invoice
                      and every milestone invoice after it. */}
                  {canEdit && canGenerateAnything && (
                    <button onClick={openInvoiceDialog}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg font-medium hover:bg-muted">
                      + Generate Invoice
                    </button>
                  )}
                </div>
                {booking.Status === CrmStatus.APPROVED && bookingInvoiceGapMessage && (
                  <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {bookingInvoiceGapMessage}
                  </div>
                )}
                {(invoices as any[]).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No invoices generated yet.</p>
                ) : (
                  <div className="overflow-x-auto thin-scroll">
                    <div className="min-w-[700px]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            {INVOICE_SORT_COLS.map((c) => (
                              <th key={c.key} onClick={() => toggleInvoiceSort(c.key)}
                                className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap">
                                <span className="flex items-center gap-0.5">
                                  {c.label}
                                  {invoiceSort?.key === c.key && (
                                    invoiceSort.dir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                                  )}
                                </span>
                              </th>
                            ))}
                            <th className="text-left px-2.5 py-2 text-xs text-muted-foreground font-medium whitespace-nowrap">PDF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedInvoices.map((inv: any) => (
                            <tr key={inv.Id} className="border-b border-border hover:bg-muted/30">
                              <td className="px-2.5 py-2 whitespace-nowrap">{inv.InvoiceNo}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap">{inv.InvoiceType}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap font-medium">{fmt(inv.Amount)}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap text-xs text-muted-foreground">{inv.InvoiceDate ? new Date(inv.InvoiceDate).toLocaleDateString("en-IN") : "—"}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap">{inv.Status || "Active"}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap text-xs">{inv.CreatedByName || "—"}</td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <button onClick={() => setPreviewInvoice(inv)}
                                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline">
                                  <Eye size={12} /> View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Invoice dialog — Booking Amount invoice only, one click.
                    Every other invoice type lives on the dedicated CRM
                    Invoices page now. */}
                {invoiceDialog && (
                  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setInvoiceDialog(false)}>
                    <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
                      <h3 className="text-sm font-semibold">Generate Booking Invoice</h3>
                      {!canGenerateAnything ? (
                        <p className="text-xs text-muted-foreground">
                          The Booking Amount milestone isn't paid-and-demanded yet, or already has an invoice.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {bookingMilestone.MilestoneName} — {fmt(bookingMilestone.AmountPaid)} paid. Amount and date come from the milestone's own payment record.
                          </p>
                          <input placeholder="Description (optional)" value={invoiceForm.Description}
                            onChange={(e) => setInvoiceForm((f) => ({ ...f, Description: e.target.value }))}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        </>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setInvoiceDialog(false)}
                          className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
                          {canGenerateAnything ? "Cancel" : "Close"}
                        </button>
                        {canGenerateAnything && (
                          <button onClick={handleGenerateInvoice} disabled={saving}
                            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                            {saving ? "Generating..." : "Generate"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {previewInvoice && (
                  <InvoicePdfDialog bookingId={bookingId} invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
                )}
              </div>
            )}

            {/* Footer navigation — Previous + one dynamic primary action on
                the last tab only, all in a single bottom-right cluster. This
                is the ONLY place any stage action lives now — Approve/Reject
                used to also have their own duplicate buttons up in the
                header; consolidated here so there's one button per action,
                its label telling you exactly what stage it's for:
                Review -> "Verify & Send for Approval", Marketing Head (L1)
                -> "Approve", Director (L2, final) -> "Final Approve", then
                "Approved & Booked" once Confirmed. No separate Close button
                here either — the dialog's own "X" (top-right) covers that. */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-4">
              {isLastTab && !mandatoryReady && booking.Status !== CrmStatus.APPROVED && pendingStepMessage && (
                <button onClick={() => setTab(pendingStepMessage.tab)}
                  className="flex-1 text-left text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 hover:bg-amber-100">
                  {pendingStepMessage.text}
                </button>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => goStep(-1)} disabled={activeTabIndex === 0}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center gap-1">
                  <ArrowLeft size={14} /> Previous
                </button>
                {!isLastTab ? (
                  <button onClick={() => goStep(1)}
                    className="px-4 py-1.5 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center gap-1">
                    Save &amp; Next <ArrowRight size={14} />
                  </button>
                ) : booking.Status === CrmStatus.APPROVED ? (
                  <button disabled
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium cursor-default flex items-center gap-1">
                    <Check size={14} /> Approved &amp; Booked
                  </button>
                ) : canEdit && currentStage === "Review" ? (
                  <button onClick={handleFinalBook} disabled={bookingRequesting || !mandatoryReady || !checklistAllChecked}
                    title={!mandatoryReady || !checklistAllChecked ? pendingStepMessage?.text : undefined}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                    {bookingRequesting ? "Submitting..." : "Verify & Send for Approval"}
                    {!bookingRequesting && <Check size={14} />}
                  </button>
                ) : canActOnStage ? (
                  <>
                    <button onClick={() => setRejectOpen(true)} disabled={stageActioning !== null}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">
                      Reject
                    </button>
                    <button onClick={handleStageApprove} disabled={stageActioning !== null}
                      className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                      {stageActioning === "approve"
                        ? "Approving..."
                        : <>{currentStage === "DirectorApproval" ? "Final Approve" : "Approve"} <Check size={14} /></>}
                    </button>
                  </>
                ) : canEdit ? (
                  <button disabled
                    className="px-4 py-1.5 text-sm bg-emerald-100 text-emerald-700 rounded-lg font-medium cursor-default flex items-center gap-1">
                    <Check size={14} /> Sent for {currentStage === "DirectorApproval" ? "Final (L2) Approval" : "L1 Approval"}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    {previewReceipt && (
      <ReceiptPdfPreview receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} />
    )}
    {reasonDialog && (
      <Dialog open onOpenChange={(o) => { if (!o) setReasonDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{reasonDialog.title}</DialogTitle>
            <DialogDescription>{reasonDialog.label}</DialogDescription>
          </DialogHeader>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const reason = (e.currentTarget.elements.namedItem("reason") as HTMLTextAreaElement).value;
            if (reasonDialog.required && !reason.trim()) { toast.error("Reason is required"); return; }
            await reasonDialog.onConfirm(reason);
            setReasonDialog(null);
          }}>
            <textarea name="reason" rows={3} className="w-full border rounded-lg p-2 text-sm" autoFocus />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setReasonDialog(null)} className="px-4 py-1.5 text-sm border rounded-lg">Cancel</button>
              <button type="submit" className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg">Confirm</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    )}
  </>);
}