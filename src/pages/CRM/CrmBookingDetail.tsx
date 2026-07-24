import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Building2, IndianRupee, Paperclip, FileText, Upload, Download,
  Trash2, Plus, IdCard, Users2, CheckCircle2, Wallet, Car,
  ChevronUp, ChevronDown, ChevronsUpDown, ShieldAlert, Check, X as XIcon,
  CreditCard, ClipboardCheck, ArrowLeft, ArrowRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

const TABS = ["Booking", "Payment Plan", "Parking & Extra Work", "Bank Details", "Attachments", "Payment", "Invoice"] as const;
type Tab = typeof TABS[number];

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}
async function fetchInvoices(id: number): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${id}/invoices`);
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

export function CrmBookingDetail({ bookingId, onClose }: { bookingId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { canDoAction, currentUser } = useAuth();
  const isAmendmentApprover = AMENDMENT_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase());
  const canEdit = canDoAction("crm-bookings", "edit");
  const [tab, setTab] = useState<Tab>("Booking");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ InvoiceType: "Booking", Amount: "", InvoiceDate: "", Description: "" });
  const [parkingForm, setParkingForm] = useState({ Quantity: "1" });
  const [extraForm, setExtraForm] = useState({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
  const [chargesSaving, setChargesSaving] = useState(false);
  const [editingExtraId, setEditingExtraId] = useState<number | null>(null);
  const [editingParkingId, setEditingParkingId] = useState<number | null>(null);
  const [extraReason, setExtraReason] = useState("");
  const [parkingReason, setParkingReason] = useState("");
  const [invoiceSort, setInvoiceSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [bookingAmountInput, setBookingAmountInput] = useState<string | null>(null);
  const [bookingAmountSaving, setBookingAmountSaving] = useState(false);
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
  const customer = data?.customer;
  const agreement = data?.agreement;
  // Once the booking's Agreement has at least one uploaded document, Unit/
  // Parking/Extra-Charge changes route through the amendment-approval queue
  // instead of applying directly (see isLegalWorkStarted in the backend) —
  // the numbers may already be baked into a document under review.
  const legalWorkStarted = !!(agreement && agreement.DocumentCount > 0);
  const paymentSummary = data?.paymentSummary || {};

  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-project-banks-for", booking?.ProjectId],
    queryFn: () => fetchProjectBanks(booking?.ProjectId),
    enabled: tab === "Payment" && !!booking?.ProjectId,
  });
  const { data: allBanks = [] } = useQuery({
    queryKey: ["bank-master-dropdown"],
    queryFn: fetchAllBanks,
    enabled: tab === "Payment",
    staleTime: 5 * 60_000,
  });
  // Project-scoped list if the project has any banks linked, otherwise the
  // full company bank list as a fallback — same rule everywhere this pattern
  // is used (On-Account dialog, Milestone payments page).
  const bankOptions = projectBanks.length > 0 ? projectBanks : allBanks;
  const { data: scopedPlans = [] } = useQuery({
    queryKey: ["crm-payment-plans-for-booking", bookingId],
    queryFn: () => fetchScopedPaymentPlans(booking),
    enabled: tab === "Payment Plan" && planEditOpen && !!booking,
  });
  useEffect(() => {
    if (tab === "Payment" && projectBanks.length === 1 && !payForm.DepositBankId) {
      setPayForm((f) => ({ ...f, DepositBankId: String(projectBanks[0].BId) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectBanks]);
  const { data: invoices = [] } = useQuery({
    queryKey: ["crm-booking-invoices", bookingId],
    queryFn: () => fetchInvoices(bookingId),
    enabled: tab === "Invoice" || tab === "Payment",
  });
  const { data: onAccount } = useQuery({
    queryKey: ["crm-booking-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId),
    enabled: tab === "Payment",
  });
  const { data: attachments = [] } = useQuery({
    queryKey: ["crm-booking-attachments", bookingId],
    queryFn: () => fetchAttachments(bookingId),
    enabled: tab === "Attachments",
  });
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

  // Bank/KYC/Nominee — same shape and API as CrmApplication.tsx's own bank
  // form (both read/write the one CrmCustomerBankDetail row keyed by
  // ApplicationId), so edits made from either place stay in sync.
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankLoaded, setBankLoaded] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
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
      })
      .finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [tab, booking?.ApplicationId]);

  const handleSaveBank = async () => {
    if (!booking?.ApplicationId) return;
    setBankSaving(true);
    try {
      const res = await fetchWithAuth(`${BANK_DETAIL_API}/application/${booking.ApplicationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bank),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success("Bank/KYC details saved");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
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
      toast.error(e.message);
    } finally {
      setReviewingAmendmentId(null);
    }
  };

  const handleRejectAmendment = async (id: number) => {
    const notes = window.prompt("Reason for rejecting this amendment (optional):") || "";
    setReviewingAmendmentId(id);
    try {
      const res = await fetchWithAuth(`${AMEND_API}/${id}/reject`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: notes || undefined }) });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success("Amendment rejected");
      invalidateCharges();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReviewingAmendmentId(null);
    }
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
      toast.error(e.message);
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

  const handleRemoveParking = async (id: number) => {
    let reason = "";
    if (legalWorkStarted) {
      reason = window.prompt("Legal documents are already under verification for this booking. Enter a reason for releasing this parking allotment:") || "";
      if (!reason.trim()) return;
    }
    try {
      const url = legalWorkStarted ? `/api/crm/parking/${id}?reason=${encodeURIComponent(reason.trim())}` : `/api/crm/parking/${id}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : "Parking allotment released");
      invalidateCharges();
    } catch (e: any) {
      toast.error(e.message);
    }
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
          GstRate: parseFloat(extraForm.GstRate) || 0,
          Reason: legalWorkStarted ? extraReason.trim() : undefined,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : (isEdit ? `Charge updated — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}` : `Charge added — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}`));
      setEditingExtraId(null);
      setExtraForm({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
      setExtraReason("");
      invalidateCharges();
    } catch (e: any) {
      toast.error(e.message);
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
      GstRate: c.GstRate != null ? String(c.GstRate) : "18",
    });
  };
  const cancelEditExtra = () => {
    setEditingExtraId(null);
    setExtraForm({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
    setExtraReason("");
  };

  const handleRemoveExtra = async (id: number) => {
    let reason = "";
    if (legalWorkStarted) {
      reason = window.prompt("Legal documents are already under verification for this booking. Enter a reason for removing this charge:") || "";
      if (!reason.trim()) return;
    }
    try {
      const url = legalWorkStarted ? `/api/crm/extra-charges/${id}?reason=${encodeURIComponent(reason.trim())}` : `/api/crm/extra-charges/${id}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : "Charge removed");
      invalidateCharges();
    } catch (e: any) {
      toast.error(e.message);
    }
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

  const [confirmingChecklist, setConfirmingChecklist] = useState<"unit" | "plan" | null>(null);
  const handleConfirmChecklistItem = async (item: "unit" | "plan") => {
    setConfirmingChecklist(item);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/confirm-${item}`, { method: "PUT" });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Confirm failed");
      toast.success(item === "unit" ? "Unit, Rate & Total Value confirmed" : "Payment Plan & Booking Amount confirmed");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConfirmingChecklist(null);
    }
  };

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
      toast.error(e.message);
    } finally {
      setPlanSaving(false);
    }
  };

  // Un-confirm a checklist item — for when a conflict or mistake is spotted
  // after the fact, so staff can re-check rather than being stuck with a
  // Confirm-only, one-way checklist. Also drops the booking out of the Admin
  // Approval Inbox (server clears ReadyForApprovalAt) until re-confirmed and
  // re-submitted via the "Book" action.
  const handleRevertChecklistItem = async (item: "unit" | "plan") => {
    if (!window.confirm(`Revert this confirmation? The booking will need to be re-checked and re-submitted for approval.`)) return;
    setConfirmingChecklist(item);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/revert-${item}`, { method: "PUT" });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Revert failed");
      toast.success("Confirmation reverted — re-check and re-confirm when ready");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConfirmingChecklist(null);
    }
  };

  const activeTabIndex = Math.max(0, TABS.indexOf(tab));
  const firstMilestone = (data?.milestones || []).find((m: any) => Number(m.MilestoneNo) === 1) || (data?.milestones || [])[0];
  const bookingAmountDue = Number(firstMilestone?.AmountDue || booking?.BookingAmount || 0);
  const bookingAmountPaid = Number(firstMilestone?.AmountPaid || booking?.BookingAmountPaid || 0);
  const bookingAmountBalance = Math.max(0, bookingAmountDue - bookingAmountPaid);
  const bookingAmountPaidInFull = bookingAmountDue > 0 && bookingAmountBalance < 1;
  const mandatoryReady = !!booking?.UnitReviewConfirmed && !!booking?.PlanReviewConfirmed && bookingAmountPaidInFull;

  const goStep = (dir: 1 | -1) => {
    const next = TABS[activeTabIndex + dir];
    if (next) setTab(next);
  };

  const [bookingRequesting, setBookingRequesting] = useState(false);
  const handleFinalBook = async () => {
    if (!mandatoryReady) {
      toast.error("Complete unit review, payment plan review, and booking amount payment before booking approval.");
      setTab("Payment");
      return;
    }
    if (booking.Status === "Approved") {
      toast.success("Booking is already approved");
      return;
    }
    setBookingRequesting(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/ready-for-approval`, { method: "PUT" });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Failed to mark ready for approval");
      toast.success(`Booking confirmed — invoice generated, ${resData.notified || 0} admin(s) notified for final approval`);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-booking-invoices", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBookingRequesting(false);
    }
  };

  // Booking Amount is set here, at the Booking stage — never at Application
  // time. Changing it (first time or a correction) re-aligns Milestone #1
  // via the same resync-schedule the server already exposes for exactly
  // this purpose, instead of duplicating that math client-side.
  const handleSaveBookingAmount = async () => {
    if (bookingAmountInput == null || bookingAmountInput === "") return;
    setBookingAmountSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingAmount: parseFloat(bookingAmountInput) }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Save failed");
      const syncRes = await fetchWithAuth(`${API}/${bookingId}/resync-schedule`, { method: "POST" });
      const syncData = await syncRes.json().catch(() => ({}));
      if (!syncRes.ok) throw new Error(syncData.error || "Failed to align milestone schedule");
      toast.success("Booking amount saved");
      setBookingAmountInput(null);
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-milestones", String(bookingId)] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBookingAmountSaving(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!firstMilestone?.Id) { toast.error("Set the Booking Amount first"); return; }
    if (!payForm.Amount || parseFloat(payForm.Amount) <= 0) { toast.error("Enter a valid amount"); return; }
    setPaySaving(true);
    try {
      const bankName = payForm.DepositBankId
        ? (bankOptions as any[]).find((b: any) => String(b.BId) === payForm.DepositBankId)?.BName
        : undefined;
      const res = await fetchWithAuth(`${PAY_API}/${firstMilestone.Id}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payForm, DepositBankName: bankName }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resData.error || "Payment failed");
      toast.success(`Payment recorded — ${resData.ReceiptNo || ""}`.trim());
      setPayForm({ Amount: "", PaymentMode: "Cash", ReceivedDate: "", TransactionRef: "", ChequeDate: "", DepositBankId: "" });
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-milestones", String(bookingId)] });
    } catch (e: any) {
      toast.error(e.message);
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
      toast.error(e.message);
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
      toast.error(e.message);
    }
  };

  const openInvoiceDialog = () => {
    setInvoiceForm({ InvoiceType: "Booking", Amount: booking?.BookingAmount ? String(booking.BookingAmount) : "", InvoiceDate: "", Description: "" });
    setInvoiceDialog(true);
  };

  const handleGenerateInvoice = async () => {
    if (!invoiceForm.Amount) { toast.error("Amount is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...invoiceForm, Amount: parseFloat(invoiceForm.Amount) }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(`Invoice ${resData.InvoiceNo} generated — visible to the customer in their portal`);
      setInvoiceDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-booking-invoices", bookingId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Building2 size={16} className="text-primary" />
            {booking ? `${booking.BookingNo} — ${booking.ApplicantName}` : "Booking Detail"}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !booking ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <>
            {/* 3-step required flow, always visible regardless of which tab
                is open — the flat tab bar alone doesn't show that Booking,
                Payment Plan, and Payment are the only 3 gating steps for
                the Book action; everything else (Parking & Extra Work,
                Bank Details, Attachments, Invoice) is supporting detail,
                not part of the approval path. */}
            {booking.Status !== "Approved" && (
              <div className="flex items-center gap-1.5 px-1 py-2 text-xs overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  { label: "1. Unit & Value", done: !!booking.UnitReviewConfirmed, t: "Booking" as Tab },
                  { label: "2. Payment Plan", done: !!booking.PlanReviewConfirmed, t: "Payment Plan" as Tab },
                  { label: "3. Booking Amount Paid", done: bookingAmountPaidInFull, t: "Payment" as Tab },
                ].map((s, i) => (
                  <React.Fragment key={s.label}>
                    <button onClick={() => setTab(s.t)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium shrink-0 ${
                        s.done ? "text-emerald-700 bg-emerald-50" : tab === s.t ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted/40"
                      }`}>
                      {s.done && <Check size={11} />} {s.label}
                    </button>
                    {i < 2 && <ArrowRight size={11} className="text-muted-foreground shrink-0" />}
                  </React.Fragment>
                ))}
                <span className="ml-4 shrink-0 whitespace-nowrap text-muted-foreground">
                  {mandatoryReady ? "All 3 steps complete — ready to Book" : "Complete all 3 to unlock Book"}
                </span>
              </div>
            )}

            {/* Wraps onto a second line instead of scrolling — simpler and
                more robust than a custom horizontal scroller (which kept
                clipping against the dialog's own bounds), and there's
                always room to wrap inside the dialog's max width. */}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-border px-1">
              {TABS.map((t) => {
                const optional = !["Booking", "Payment Plan", "Payment"].includes(t);
                return (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                      tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}>
                    {t}{optional && <span className="text-[10px] text-muted-foreground/70 font-normal"> (optional)</span>}
                  </button>
                );
              })}
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
                    <label className="text-xs text-muted-foreground block mb-1">Total Value</label>
                    <div className="text-sm px-2.5 py-2 border border-border rounded-lg bg-muted/30 font-semibold">{fmt(booking.GrandTotal ?? booking.TotalValue)}</div>
                  </div>
                </div>

                {booking.Status !== "Approved" && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <p className="text-sm font-medium">Unit, Rate & Total Value are correct</p>
                    {booking.UnitReviewConfirmed ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600"><Check size={13} /> Confirmed</span>
                        {canEdit && (
                          <button onClick={() => handleRevertChecklistItem("unit")} disabled={confirmingChecklist === "unit"}
                            className="px-2 py-0.5 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md font-medium hover:bg-amber-100 disabled:opacity-40">
                            Revert
                          </button>
                        )}
                      </div>
                    ) : canEdit ? (
                      <button onClick={() => handleConfirmChecklistItem("unit")} disabled={confirmingChecklist === "unit"}
                        className="px-2.5 py-1 text-xs border border-border rounded-lg font-medium hover:bg-muted disabled:opacity-40">
                        {confirmingChecklist === "unit" ? "Confirming..." : "Confirm"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not confirmed</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "Payment Plan" && (
              <div className="space-y-4 pt-2">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardCheck size={15} className="text-primary" /> Payment Plan</h3>
                    {!planEditOpen && canEdit && booking.Status !== "Approved" && (
                      <button onClick={() => { setPlanEditOpen(true); setPlanEditValue(booking.PaymentPlanId ? String(booking.PaymentPlanId) : ""); }}
                        className="text-xs text-primary hover:underline shrink-0">
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
                          className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
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

                {booking.Status !== "Approved" && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <p className="text-sm font-medium">Payment Plan is correct</p>
                    {booking.PlanReviewConfirmed ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600"><Check size={13} /> Confirmed</span>
                        {canEdit && (
                          <button onClick={() => handleRevertChecklistItem("plan")} disabled={confirmingChecklist === "plan"}
                            className="px-2 py-0.5 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md font-medium hover:bg-amber-100 disabled:opacity-40">
                            Revert
                          </button>
                        )}
                      </div>
                    ) : canEdit ? (
                      <button onClick={() => handleConfirmChecklistItem("plan")} disabled={confirmingChecklist === "plan"}
                        className="px-2.5 py-1 text-xs border border-border rounded-lg font-medium hover:bg-muted disabled:opacity-40">
                        {confirmingChecklist === "plan" ? "Confirming..." : "Confirm"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not confirmed</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "Payment" && (
              <div className="space-y-3 pt-2">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><CreditCard size={15} className="text-primary" /> Booking Amount</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Due</span><span className="font-semibold">{bookingAmountDue > 0 ? fmt(bookingAmountDue) : "Not set"}</span></div>
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-emerald-700">{fmt(bookingAmountPaid)}</span></div>
                    <div className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground block">Pending</span><span className="font-semibold text-amber-700">{bookingAmountDue > 0 ? fmt(bookingAmountBalance) : "—"}</span></div>
                  </div>
                  {bookingAmountDue <= 0 && (
                    <p className="text-[11px] text-muted-foreground">No default amount is shown here — set the actual Booking Amount below; the rest of the payment schedule is calculated from it.</p>
                  )}
                  {canEdit && booking.Status !== "Approved" && (
                    <div className="flex items-center gap-2 pt-1">
                      <input type="number" placeholder="Set/correct booking amount (₹)"
                        value={bookingAmountInput ?? (booking.BookingAmount != null ? String(booking.BookingAmount) : "")}
                        onChange={(e) => setBookingAmountInput(e.target.value)}
                        className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      <button onClick={handleSaveBookingAmount} disabled={bookingAmountSaving || bookingAmountInput == null}
                        className="px-3 py-1.5 text-sm border border-border rounded-lg font-medium hover:bg-muted disabled:opacity-40 shrink-0">
                        {bookingAmountSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                </div>

                {canEdit && booking.Status !== "Approved" && !bookingAmountPaidInFull && bookingAmountDue > 0 && (
                  <div className="rounded-xl border border-border p-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><IndianRupee size={15} className="text-primary" /> Record Payment</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" placeholder={`Amount (balance ${fmt(bookingAmountBalance)})`} value={payForm.Amount}
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
                        <option value="">— Select deposit bank —</option>
                        {(bankOptions as any[]).map((b: any) => (
                          <option key={b.BId} value={String(b.BId)}>{b.BName}</option>
                        ))}
                      </select>
                      {payForm.PaymentMode === "Cheque" && (
                        <input type="date" value={payForm.ChequeDate} onChange={(e) => setPayForm((f) => ({ ...f, ChequeDate: e.target.value }))}
                          className="text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      )}
                    </div>
                    <button onClick={handleRecordPayment} disabled={paySaving}
                      className="w-full py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40">
                      {paySaving ? "Recording..." : `Record Payment`}
                    </button>
                  </div>
                )}
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

                {/* Parking */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><Car size={15} className="text-primary" /> Parking Allotments</h3>
                  </div>
                  {(parking as any[]).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No parking allotments linked to this booking.</p>
                  ) : (
                    <div className="overflow-x-auto thin-scroll">
                      <div className="min-w-[500px]">
                        {(parking as any[]).map((p: any) => (
                          <div key={p.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 mb-1.5">
                            <div className="space-y-0.5 min-w-0">
                              <span className="text-sm font-medium">{p.ParkingSlotName}</span>
                              <div className="flex gap-3 text-xs text-muted-foreground">
                                <span>Qty: {p.Quantity}</span>
                                <span>Amount: {fmt(p.Amount)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {editingParkingId === p.Id ? (
                                <>
                                  <input type="number" min="1" value={parkingForm.Quantity}
                                    onChange={(e) => setParkingForm((f) => ({ ...f, Quantity: e.target.value }))}
                                    className="w-16 text-sm border border-border rounded px-1.5 py-1 bg-background" />
                                  <button onClick={handleAddParking} disabled={chargesSaving}
                                    className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded font-medium disabled:opacity-40">
                                    Save
                                  </button>
                                  <button onClick={cancelEditParking}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEditParking(p)}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Edit
                                  </button>
                                  {canEdit && (
                                    <button onClick={() => handleRemoveParking(p.Id)}
                                      className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                                      Release
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Extra Charges */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} className="text-primary" /> Extra Charges</h3>
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
                                    className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded font-medium disabled:opacity-40">
                                    Save
                                  </button>
                                  <button onClick={cancelEditExtra}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEditExtra(c)}
                                    className="px-2 py-1 text-xs border border-border rounded text-muted-foreground hover:bg-muted">
                                    Edit
                                  </button>
                                  {canEdit && (
                                    <button onClick={() => handleRemoveExtra(c.Id)}
                                      className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                                      Remove
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {canEdit && !editingExtraId && booking.Status !== "Approved" && (
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
                            GstRate: selected?.GstRate != null ? String(selected.GstRate) : f.GstRate,
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
                        <select value={extraForm.GstRate} onChange={(e) => setExtraForm((f) => ({ ...f, GstRate: e.target.value }))}
                          className="w-20 text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                          {["0", "5", "12", "18", "28"].map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                        <button onClick={handleAddExtra} disabled={chargesSaving}
                          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 shrink-0">
                          {chargesSaving ? "Adding..." : "Add"}
                        </button>
                      </div>
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
                            onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
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
                            onChange={(e) => setBank((b) => ({ ...b, [f.key]: e.target.value }))}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        </div>
                      ))}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Nominee Address</label>
                        <textarea value={bank.NomineeAddress}
                          onChange={(e) => setBank((b) => ({ ...b, NomineeAddress: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background resize-none" rows={2} />
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={handleSaveBank} disabled={bankSaving}
                        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                        {bankSaving ? "Saving..." : "Save Bank/KYC Details"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "Attachments" && (
              <div className="space-y-4 pt-2">
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg cursor-pointer hover:bg-muted">
                      <Upload size={14} />
                      {uploading ? "Uploading..." : "Upload Files"}
                      <input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
                    </label>
                  </div>
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
                                {canEdit && (
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
              </div>
            )}

            {tab === "Invoice" && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileText size={15} className="text-primary" /> Invoices</h3>
                  {canEdit && booking.Status !== "Approved" && (
                    <button onClick={openInvoiceDialog}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg font-medium hover:bg-muted">
                      + Generate Invoice
                    </button>
                  )}
                </div>
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Invoice dialog */}
                {invoiceDialog && (
                  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setInvoiceDialog(false)}>
                    <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
                      <h3 className="text-sm font-semibold">Generate Invoice</h3>
                      <div className="space-y-2">
                        <select value={invoiceForm.InvoiceType} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceType: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                          <option value="Booking">Booking</option>
                          <option value="Maintenance">Maintenance</option>
                          <option value="Other">Other</option>
                        </select>
                        <input type="number" placeholder="Amount" value={invoiceForm.Amount}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, Amount: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        <input type="date" value={invoiceForm.InvoiceDate}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                        <input placeholder="Description" value={invoiceForm.Description}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, Description: e.target.value }))}
                          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setInvoiceDialog(false)}
                          className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
                          Cancel
                        </button>
                        <button onClick={handleGenerateInvoice} disabled={saving}
                          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                          {saving ? "Generating..." : "Generate"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer navigation */}
            <div className="flex items-center justify-between gap-2 pt-4 border-t border-border mt-4">
              <div className="flex items-center gap-2">
                <button onClick={() => goStep(-1)} disabled={activeTabIndex === 0}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center gap-1">
                  <ArrowLeft size={14} /> Previous
                </button>
                <button onClick={() => goStep(1)} disabled={activeTabIndex === TABS.length - 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center gap-1">
                  Next <ArrowRight size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {booking.Status !== "Approved" && mandatoryReady && (
                  <button onClick={handleFinalBook} disabled={bookingRequesting}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                    {bookingRequesting ? "Submitting..." : "Book"}
                    {!bookingRequesting && <Check size={14} />}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
