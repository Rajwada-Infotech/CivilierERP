import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Building2, IndianRupee, Paperclip, FileText, Upload, Download,
  Trash2, Plus, IdCard, Users2, CheckCircle2, Wallet, Car,
  ChevronUp, ChevronDown, ChevronsUpDown, ShieldAlert, Check, X as XIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/bookings";
const PAY_API = "/api/crm/payments";
const PLAN_API = "/api/crm/payment-plans";
const AMEND_API = "/api/crm/booking-amendments";

// Same approver set as CRM_APPROVER_ROLES on the backend (services/
// approvalService.js) — kept in sync manually since it's a small, stable
// list, same pattern CrmCustomerBankDetails.tsx already uses for its own
// frontend-side permission preview.
const AMENDMENT_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const TABS = ["Main", "Details", "Attachments", "Invoice"] as const;
type Tab = typeof TABS[number];

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}
async function fetchScopedPlans(companyId?: number, projectId?: number): Promise<any[]> {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  if (projectId) params.set("projectId", String(projectId));
  const r = await fetchWithAuth(`${PLAN_API}?${params}`);
  return r.ok ? r.json() : [];
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
async function fetchParkingAllotments(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`/api/crm/parking/${bookingId}`);
  return r.ok ? r.json() : [];
}
async function fetchExtraCharges(bookingId: number): Promise<any[]> {
  const r = await fetchWithAuth(`/api/crm/extra-charges/${bookingId}`);
  return r.ok ? r.json() : [];
}
async function fetchParkingRates(): Promise<any[]> {
  const r = await fetchWithAuth("/api/parking-master");
  return r.ok ? r.json() : [];
}
async function fetchAvailableParkingSlots(projectId?: number, blockId?: number | null): Promise<any[]> {
  if (!projectId) return [];
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (blockId) params.set("blockId", String(blockId));
  const r = await fetchWithAuth(`/api/parking-matrix?${params}`);
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
  // Bookings is now a review + restricted-edit surface (Applications and
  // Bookings) — super admin grants "crm-bookings" edit per-user via Menu
  // Rights instead of it being a broad role default, so every mutating
  // control here must check this explicitly rather than assume anyone who
  // can view the page can also edit it.
  const canEdit = canDoAction("crm-bookings", "edit");
  const [tab, setTab] = useState<Tab>("Main");
  const [paymentPlanId, setPaymentPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ InvoiceType: "Booking", Amount: "", InvoiceDate: "", Description: "" });
  const [parkingForm, setParkingForm] = useState({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
  const [extraForm, setExtraForm] = useState({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
  const [chargesSaving, setChargesSaving] = useState(false);
  const [editingExtraId, setEditingExtraId] = useState<number | null>(null);
  const [editingParkingId, setEditingParkingId] = useState<number | null>(null);
  const [extraReason, setExtraReason] = useState("");
  const [parkingReason, setParkingReason] = useState("");
  const [invoiceSort, setInvoiceSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

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

  const { data: plans = [] } = useQuery({
    queryKey: ["crm-payment-plans-scoped", booking?.CompanyId, booking?.ProjectId],
    queryFn: () => fetchScopedPlans(booking?.CompanyId, booking?.ProjectId),
    enabled: !!booking,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["crm-booking-invoices", bookingId],
    queryFn: () => fetchInvoices(bookingId),
    enabled: tab === "Invoice" || tab === "Details",
  });
  const { data: onAccount } = useQuery({
    queryKey: ["crm-booking-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId),
    enabled: tab === "Details",
  });
  const { data: attachments = [] } = useQuery({
    queryKey: ["crm-booking-attachments", bookingId],
    queryFn: () => fetchAttachments(bookingId),
    enabled: tab === "Attachments",
  });
  const { data: parking = [] } = useQuery({
    queryKey: ["crm-parking", bookingId],
    queryFn: () => fetchParkingAllotments(bookingId),
    enabled: tab === "Details",
  });
  const { data: extras = [] } = useQuery({
    queryKey: ["crm-extra-charges", bookingId],
    queryFn: () => fetchExtraCharges(bookingId),
    enabled: tab === "Details",
  });
  const { data: parkingRates = [] } = useQuery({
    queryKey: ["parking-master-all"],
    queryFn: fetchParkingRates,
    enabled: tab === "Details",
    staleTime: 5 * 60_000,
  });
  const { data: parkingSlots = [] } = useQuery({
    queryKey: ["parking-matrix-for-booking", booking?.ProjectId, booking?.BlockId],
    queryFn: () => fetchAvailableParkingSlots(booking?.ProjectId, booking?.BlockId),
    enabled: tab === "Details" && !!booking?.ProjectId,
    staleTime: 30_000,
  });
  const { data: chargeTypes = [] } = useQuery({
    queryKey: ["extra-charge-master-all"],
    queryFn: fetchExtraChargeTypes,
    enabled: tab === "Details",
    staleTime: 5 * 60_000,
  });
  const { data: pendingAmendments = [] } = useQuery({
    queryKey: ["crm-booking-amendments", bookingId],
    queryFn: () => fetchPendingAmendments(bookingId),
    enabled: tab === "Details",
    staleTime: 15_000,
  });
  const [reviewingAmendmentId, setReviewingAmendmentId] = useState<number | null>(null);

  const applicableParkingRates = (parkingRates as any[]).filter(
    (r: any) => r.IsActive && r.ProjectId === booking?.ProjectId && (!r.BlockId || r.BlockId === booking?.BlockId)
  );
  const selectedParkingRate = applicableParkingRates.find((r: any) => String(r.Id) === parkingForm.ParkingMasterId);
  const availableParkingSlots = (parkingSlots as any[]).filter(
    (s: any) => s.Status === "Available" && (!selectedParkingRate || s.ParkingType === selectedParkingRate.ParkingType)
  );

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

  const handleAddParking = async () => {
    if (legalWorkStarted && !parkingReason.trim()) { toast.error("A reason is required — legal documents are already under verification for this booking"); return; }
    if (editingParkingId) {
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
        setParkingForm({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
        setParkingReason("");
        invalidateCharges();
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setChargesSaving(false);
      }
      return;
    }
    if (!parkingForm.ParkingMasterId) { toast.error("Select a parking rate"); return; }
    setChargesSaving(true);
    try {
      const res = await fetchWithAuth(`/api/crm/parking/${bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ParkingMasterId: parkingForm.ParkingMasterId,
          ParkingSlotId: parkingForm.ParkingSlotId ? parseInt(parkingForm.ParkingSlotId) : null,
          ParkingSlotNo: parkingForm.ParkingSlotId ? undefined : (parkingForm.ParkingSlotNo || null),
          Quantity: parseInt(parkingForm.Quantity) || 1,
          Reason: legalWorkStarted ? parkingReason.trim() : undefined,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      toast.success(resData.pending ? "Amendment request submitted — pending approval" : `Parking allotted — ₹${Number(resData.TotalAmount).toLocaleString("en-IN")}`);
      setParkingForm({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
      setParkingReason("");
      qc.invalidateQueries({ queryKey: ["parking-matrix-for-booking", booking?.ProjectId, booking?.BlockId] });
      invalidateCharges();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChargesSaving(false);
    }
  };

  const startEditParking = (p: any) => {
    setEditingParkingId(p.Id);
    setParkingForm({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: String(p.Quantity) });
  };
  const cancelEditParking = () => {
    setEditingParkingId(null);
    setParkingForm({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
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

  const effectivePlanId = paymentPlanId ?? (booking?.PaymentPlanId ? String(booking.PaymentPlanId) : "");

  const handleSaveMain = async () => {
    const currentPlanId = booking?.PaymentPlanId ? String(booking.PaymentPlanId) : "";
    if (effectivePlanId !== currentPlanId) {
      const ok = window.confirm(
        "Changing the payment plan will regenerate this booking's entire payment milestone schedule from the new plan (it's blocked automatically if any payment has already been recorded). Continue?"
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PaymentPlanId: effectivePlanId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.milestonesRegenerated ? "Payment plan updated — milestone schedule regenerated" : "Payment plan updated");
      qc.invalidateQueries({ queryKey: ["crm-booking-detail", bookingId] });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
      qc.invalidateQueries({ queryKey: ["crm-milestones", String(bookingId)] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
            <div className="flex items-center gap-1 border-b border-border">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>
                  {t}
                </button>
              ))}
            </div>

            {/* ── Tab 1: Main ── */}
            {tab === "Main" && (
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
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Payment Plan</label>
                    <select value={effectivePlanId} onChange={(e) => setPaymentPlanId(e.target.value)} disabled={!canEdit}
                      className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60">
                      <option value="">— No plan (7-stage default) —</option>
                      {(plans as any[]).map((p: any) => (
                        <option key={p.Id} value={String(p.Id)}>{p.PlanName}{!p.CompanyId && !p.ProjectId ? " (Global)" : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveMain} disabled={saving || paymentPlanId === null}
                      className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                      {saving ? "Saving..." : "Save Payment Plan"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 2: Details ── */}
            {tab === "Details" && (
              <div className="space-y-4 pt-2">
                {customer && (
                  <div className="rounded-xl border border-border p-3.5">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><IdCard size={13} /> Customer</h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div><span className="text-muted-foreground block">Name</span><span className="font-medium">{customer.CustomerName}</span></div>
                      <div><span className="text-muted-foreground block">Mobile</span><span className="font-medium">{customer.Mobile}{customer.AltMobile ? ` / ${customer.AltMobile}` : ""}</span></div>
                      <div><span className="text-muted-foreground block">Email</span><span className="font-medium">{customer.Email || "—"}</span></div>
                      <div><span className="text-muted-foreground block">PAN</span><span className="font-medium font-mono">{customer.PanNo || "—"}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block">Address</span><span className="font-medium">{customer.Address || "—"}{[customer.City, customer.State, customer.Pincode].filter(Boolean).length ? ` · ${[customer.City, customer.State, customer.Pincode].filter(Boolean).join(", ")}` : ""}</span></div>
                    </div>
                  </div>
                )}

                {/* Co-applicants: sourced from dbo.CrmCoApplicant (the per-booking
                    table), not CrmCustomer's intake-time fields — this is the
                    authoritative list once a booking exists, same source Welcome
                    Call's checklist uses, so the two never disagree. */}
                <div className="rounded-xl border border-border p-3.5">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><Users2 size={13} /> Co-Applicants</h3>
                  {(data?.coApplicants || []).length > 0 ? (
                    <div className="space-y-1.5">
                      {(data.coApplicants as any[]).map((ca) => (
                        <div key={ca.Id} className="text-xs flex items-center gap-1.5">
                          <span className="font-medium">{ca.Name}</span>
                          {ca.Relation && <span className="text-muted-foreground">({ca.Relation})</span>}
                          <span className="text-muted-foreground">— {ca.Mobile || "—"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No co-applicant on record.</p>
                  )}
                </div>

                <div className="rounded-xl border border-border p-3.5">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><Building2 size={13} /> Booking</h3>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                    <div><span className="text-muted-foreground block">Unit</span><span className="font-medium">{booking.UnitNo || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Block</span><span className="font-medium">{booking.BlockName || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Floor</span><span className="font-medium">{booking.FloorName || "—"}</span></div>
                    <div><span className="text-muted-foreground block">Area</span><span className="font-medium">{booking.AreaSqFt ? `${booking.AreaSqFt} sqft` : "—"}</span></div>
                    <div><span className="text-muted-foreground block">Rate / sqft</span><span className="font-medium">{fmt(booking.RatePerSqFt)}</span></div>
                    <div><span className="text-muted-foreground block">Booking Date</span><span className="font-medium">{booking.BookingDate ? String(booking.BookingDate).slice(0, 10) : "—"}</span></div>
                    <div><span className="text-muted-foreground block">Total Value</span><span className="font-semibold">{fmt(booking.TotalValue)}</span></div>
                    <div><span className="text-muted-foreground block">Booking Amount</span><span className="font-semibold">{fmt(booking.BookingAmount)}</span></div>
                    <div><span className="text-muted-foreground block">Token</span><span className="font-medium">{booking.TokenType === "Percentage" ? `${booking.TokenValue}%` : fmt(booking.TokenValue)}</span></div>
                    <div><span className="text-muted-foreground block">Parking</span><span className="font-medium">{fmt(booking.ParkingTotal)}</span></div>
                    <div><span className="text-muted-foreground block">Extra Charges</span><span className="font-medium">{fmt(booking.ExtraChargesTotal)}</span></div>
                    <div><span className="text-muted-foreground block">Grand Total</span><span className="font-bold text-primary">{fmt(booking.GrandTotal)}</span></div>
                  </div>
                </div>

                {legalWorkStarted && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                    Legal documents are already under verification for this booking — Unit/Parking/Extra Charge changes below now require a reason and admin/marketing_head approval before they apply.
                  </div>
                )}

                {pendingAmendments.length > 0 && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-2">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                      <ShieldAlert size={13} className="text-primary" /> Pending Amendment Requests ({pendingAmendments.length})
                    </h3>
                    <div className="space-y-2">
                      {(pendingAmendments as any[]).map((r: any) => (
                        <div key={r.Id} className="rounded-lg border border-border bg-card p-2.5 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{r.Action} — {r.ChangeType === "ExtraCharge" ? "Extra Charge" : "Parking Allotment"}</span>
                            <span className="text-muted-foreground">{r.RequestedByName || "—"} · {r.RequestedAt ? String(r.RequestedAt).slice(0, 10) : "—"}</span>
                          </div>
                          <p className="text-muted-foreground">Reason: {r.Reason}</p>
                          {isAmendmentApprover && (
                            <div className="flex items-center gap-1.5 pt-1">
                              <button onClick={() => handleApproveAmendment(r.Id)} disabled={reviewingAmendmentId === r.Id}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-40">
                                <Check size={12} /> Approve
                              </button>
                              <button onClick={() => handleRejectAmendment(r.Id)} disabled={reviewingAmendmentId === r.Id}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-40">
                                <XIcon size={12} /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parking & Extra Charges — allot/remove directly here, not a
                    separate hidden dialog, so the numbers above and the
                    line items behind them live in the same place. */}
                <div className="rounded-xl border border-border p-3.5 space-y-3">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground"><Car size={13} /> Parking Allotment</h3>
                  {(parking as any[]).length > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      {(parking as any[]).map((p: any) => (
                        <div key={p.Id} className="flex items-center justify-between px-2.5 py-1.5 border-b border-border last:border-0 text-xs">
                          <div>
                            <span className="font-medium">{p.CurrentParkingType}</span>
                            {p.ParkingSlotNo && <span className="text-muted-foreground"> · {p.ParkingSlotNo}</span>}
                            <span className="text-muted-foreground"> · Qty {p.Quantity}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{fmt(p.TotalAmount)}</span>
                            {canEdit && p.Id !== editingParkingId && <button onClick={() => startEditParking(p)} className="text-primary hover:underline">Edit</button>}
                            {canEdit && <button onClick={() => handleRemoveParking(p.Id)} className="text-red-600 hover:underline">{legalWorkStarted ? "Request Release" : "Release"}</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {canEdit && editingParkingId != null && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">Editing quantity only — to change rate or slot, release this allotment and add a new one.</p>
                      {legalWorkStarted && (
                        <input placeholder="Reason for this change (required)" value={parkingReason}
                          onChange={(e) => setParkingReason(e.target.value)}
                          className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-background" />
                      )}
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={1} placeholder="Qty" value={parkingForm.Quantity}
                          onChange={(e) => setParkingForm((f) => ({ ...f, Quantity: e.target.value }))}
                          className="w-24 text-xs border border-border rounded px-2 py-1.5 bg-background" />
                        <button onClick={handleAddParking} disabled={chargesSaving}
                          className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                          {chargesSaving ? "Saving..." : legalWorkStarted ? "Request Amendment" : "Save Changes"}
                        </button>
                        <button onClick={cancelEditParking} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted">Cancel</button>
                      </div>
                    </div>
                  )}
                  {canEdit && editingParkingId == null && (
                    <>
                      <div className="grid grid-cols-4 gap-1.5">
                        <select value={parkingForm.ParkingMasterId}
                          onChange={(e) => setParkingForm((f) => ({ ...f, ParkingMasterId: e.target.value, ParkingSlotId: "" }))}
                          className="col-span-2 text-xs border border-border rounded px-2 py-1.5 bg-background">
                          <option value="">Select parking rate</option>
                          {applicableParkingRates.map((r: any) => (
                            <option key={r.Id} value={String(r.Id)}>{r.ParkingType} — ₹{Number(r.Charge).toLocaleString("en-IN")} (+{r.GstRate}% GST)</option>
                          ))}
                        </select>
                        {availableParkingSlots.length > 0 ? (
                          <select value={parkingForm.ParkingSlotId} onChange={(e) => setParkingForm((f) => ({ ...f, ParkingSlotId: e.target.value }))}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background">
                            <option value="">Slot (optional)</option>
                            {availableParkingSlots.map((s: any) => (
                              <option key={s.Id} value={String(s.Id)}>{s.SlotNo}{s.BlockName ? ` — ${s.BlockName}` : ""}</option>
                            ))}
                          </select>
                        ) : (
                          <input placeholder="Slot No." value={parkingForm.ParkingSlotNo}
                            onChange={(e) => setParkingForm((f) => ({ ...f, ParkingSlotNo: e.target.value }))}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
                        )}
                        <input type="number" min={1} placeholder="Qty" value={parkingForm.Quantity}
                          onChange={(e) => setParkingForm((f) => ({ ...f, Quantity: e.target.value }))}
                          className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
                      </div>
                      {legalWorkStarted && (
                        <input placeholder="Reason for this change (required)" value={parkingReason}
                          onChange={(e) => setParkingReason(e.target.value)}
                          className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-background" />
                      )}
                      <button onClick={handleAddParking} disabled={chargesSaving}
                        className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-40">
                        {legalWorkStarted ? "Request Amendment" : "+ Allot Parking"}
                      </button>
                      {applicableParkingRates.length === 0 && (
                        <p className="text-xs text-muted-foreground">No parking rate configured for this project/block yet — set one up in Setup → Parking Master.</p>
                      )}
                    </>
                  )}

                  <div className="pt-2 border-t border-border/60 space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">Extra Charges (Custom Requirements)</h3>
                    {(extras as any[]).length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        {(extras as any[]).map((c: any) => (
                          <div key={c.Id} className="flex items-center justify-between px-2.5 py-1.5 border-b border-border last:border-0 text-xs">
                            <span className="font-medium">{c.Description}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{fmt(c.TotalAmount)}</span>
                              {canEdit && c.Id !== editingExtraId && <button onClick={() => startEditExtra(c)} className="text-primary hover:underline">Edit</button>}
                              {canEdit && <button onClick={() => handleRemoveExtra(c.Id)} className="text-red-600 hover:underline">{legalWorkStarted ? "Request Removal" : "Remove"}</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {canEdit && (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          <select value={extraForm.ExtraChargeMasterId}
                            onChange={(e) => {
                              const master = (chargeTypes as any[]).find((c: any) => String(c.Id) === e.target.value);
                              setExtraForm((f) => ({
                                ...f,
                                ExtraChargeMasterId: e.target.value,
                                Description: master ? master.ChargeName : f.Description,
                                Amount: master?.DefaultAmount != null ? String(master.DefaultAmount) : f.Amount,
                                GstRate: master ? String(master.GstRate) : f.GstRate,
                              }));
                            }}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background">
                            <option value="">Custom (type below)</option>
                            {(chargeTypes as any[]).filter((c: any) => c.IsActive).map((c: any) => (
                              <option key={c.Id} value={String(c.Id)}>{c.ChargeName}</option>
                            ))}
                          </select>
                          <input placeholder="Description" value={extraForm.Description}
                            onChange={(e) => setExtraForm((f) => ({ ...f, Description: e.target.value }))}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
                          <input type="number" placeholder="Amount (₹)" value={extraForm.Amount}
                            onChange={(e) => setExtraForm((f) => ({ ...f, Amount: e.target.value }))}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
                          <input type="number" placeholder="GST %" value={extraForm.GstRate}
                            onChange={(e) => setExtraForm((f) => ({ ...f, GstRate: e.target.value }))}
                            className="text-xs border border-border rounded px-2 py-1.5 bg-background" />
                        </div>
                        {legalWorkStarted && (
                          <input placeholder="Reason for this change (required)" value={extraReason}
                            onChange={(e) => setExtraReason(e.target.value)}
                            className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-background" />
                        )}
                        <div className="flex items-center gap-1.5">
                          <button onClick={handleAddExtra} disabled={chargesSaving}
                            className={editingExtraId != null || legalWorkStarted
                              ? "text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40"
                              : "text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-40"}>
                            {chargesSaving ? "Saving..." : legalWorkStarted ? "Request Amendment" : editingExtraId != null ? "Save Changes" : "+ Add Charge"}
                          </button>
                          {editingExtraId != null && (
                            <button onClick={cancelEditExtra} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted">Cancel</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={`rounded-xl border p-3.5 ${paymentSummary.balance > 0 ? "border-amber-200 bg-amber-50/40" : "border-border"}`}>
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><IndianRupee size={13} /> Payment Summary</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-muted-foreground block">Total Due</span><span className="font-semibold">{fmt(paymentSummary.totalDue)}</span></div>
                    <div><span className="text-muted-foreground block">Paid</span><span className="font-semibold text-green-700">{fmt(paymentSummary.totalPaid)}</span></div>
                    <div><span className="text-muted-foreground block">Balance</span><span className="font-semibold text-amber-700">{fmt(paymentSummary.balance)}</span></div>
                  </div>
                  {onAccount?.availableBalance > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium mt-2 pt-2 border-t border-border/60">
                      <Wallet size={12} /> {fmt(onAccount.availableBalance)} sitting on account, not yet applied to a milestone
                    </div>
                  )}
                </div>

                {invoices.length > 0 && (
                  <div className="rounded-xl border border-border p-3.5">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><FileText size={13} /> Invoices</h3>
                    <div className="space-y-1.5">
                      {invoices.map((inv: any) => (
                        <div key={inv.Id} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-primary">{inv.InvoiceNo}</span>
                          <span className="text-muted-foreground">{inv.InvoiceType}</span>
                          <span className="font-semibold">{fmt(inv.Amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 3: Attachments ── */}
            {tab === "Attachments" && (
              <div className="space-y-3 pt-2">
                {canEdit && (
                  <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-6 cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors">
                    <Upload size={16} className="text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Click to upload files (PDF, images, Office docs — up to 25MB each)"}</span>
                    <input type="file" multiple className="hidden" disabled={uploading}
                      onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
                  </label>
                )}

                {attachments.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-sm">No attachments yet</div>
                ) : (
                  <div className="space-y-2">
                    {(attachments as any[]).map((a: any) => (
                      <div key={a.Id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip size={14} className="text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{a.Label || a.FileName}</div>
                            <div className="text-[11px] text-muted-foreground">{a.FileName} · {a.FileSize ? `${(a.FileSize / 1024).toFixed(0)} KB` : ""} · {a.UploadedByName || "—"}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a href={`${API}/${bookingId}/attachments/file/${a.Id}`} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><Download size={14} /></a>
                          {canEdit && (
                            <button onClick={() => handleDeleteAttachment(a.Id)} className="p-1.5 rounded-md hover:bg-rose-50 text-muted-foreground hover:text-rose-600">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 4: Invoice ── */}
            {tab === "Invoice" && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Every invoice generated here is immediately visible to the customer in their portal.</p>
                  {canEdit && (
                    <button onClick={openInvoiceDialog}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 shrink-0">
                      <Plus size={14} /> Generate Invoice
                    </button>
                  )}
                </div>

                {invoices.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">No invoices generated yet</div>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-left">
                          {INVOICE_SORT_COLS.map(({ key, label }) => {
                            const sorted = invoiceSort?.key === key ? invoiceSort.dir : null;
                            return (
                              <th key={key} onClick={() => toggleInvoiceSort(key)}
                                className="px-3 py-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                                <span className="inline-flex items-center gap-1">
                                  {label}
                                  <span className="text-muted-foreground/50">
                                    {sorted === "asc" ? (
                                      <ChevronUp size={11} className="text-emerald-500" />
                                    ) : sorted === "desc" ? (
                                      <ChevronDown size={11} className="text-emerald-500" />
                                    ) : (
                                      <ChevronsUpDown size={11} />
                                    )}
                                  </span>
                                </span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedInvoices.map((inv: any) => (
                          <tr key={inv.Id} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{inv.InvoiceNo}</td>
                            <td className="px-3 py-2 text-xs">{inv.InvoiceType}</td>
                            <td className="px-3 py-2 font-semibold">{fmt(inv.Amount)}</td>
                            <td className="px-3 py-2 text-xs">{String(inv.InvoiceDate).slice(0, 10)}</td>
                            <td className="px-3 py-2">
                              <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200 flex items-center gap-1 w-fit">
                                <CheckCircle2 size={10} /> {inv.Status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{inv.CreatedByName || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>

      {/* Generate Invoice Dialog */}
      <Dialog open={invoiceDialog} onOpenChange={(o) => { if (!o) setInvoiceDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><FileText size={16} className="text-primary" /> Generate Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Invoice Type</label>
              <select value={invoiceForm.InvoiceType} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="Booking">Booking</option>
                <option value="Agreement">Agreement</option>
                <option value="Possession">Possession</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Amount (₹) *</label>
              <input type="number" value={invoiceForm.Amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, Amount: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Invoice Date</label>
              <input type="date" value={invoiceForm.InvoiceDate} onChange={(e) => setInvoiceForm((f) => ({ ...f, InvoiceDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <textarea value={invoiceForm.Description} onChange={(e) => setInvoiceForm((f) => ({ ...f, Description: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setInvoiceDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleGenerateInvoice} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Generating..." : "Generate"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
