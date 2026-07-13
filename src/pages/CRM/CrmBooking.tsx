import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Phone, ChevronRight, IndianRupee, MoreHorizontal, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";

const API     = "/api/crm/bookings";
const APP_API = "/api/crm/applications";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";
const PLAN_API = "/api/crm/payment-plans";

const STATUSES    = ["Pending", "Approved", "Rejected", "Cancelled"];
const PAY_MODES   = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];
const TOKEN_TYPES = ["Percentage", "Amount"];

const statusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-muted-foreground bg-muted/50 border-border",
};

const EMPTY_FORM = {
  ApplicationId: "", UnitId: "", ProjectName: "", UnitNo: "", BlockName: "",
  UnitType: "", AreaSqFt: "", RatePerSqFt: "", TotalValue: "",
  TokenType: "Percentage", TokenValue: "", PaymentPlanId: "",
  BookingDate: "", PaymentMode: "", AssignedTo: "", Notes: "",
};

async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth(PLAN_API); return r.ok ? r.json() : []; } catch { return []; }
}

// This management page still needs to see and filter to Cancelled/Rejected
// bookings for record-keeping (its own Status filter includes them) — every
// other page's booking-selector dropdown deliberately gets the narrower
// default (see crmBookings.js GET /), so only this one opts back in.
async function fetchBookings(applicationId?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({ includeCancelled: "1" });
    if (applicationId) params.set("applicationId", applicationId);
    const res = await fetchWithAuth(`${API}?${params}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchApps(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(APP_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!res.ok) return [];
    const d: any[] = await res.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${(n / 1e5).toFixed(2)}L` : "—";

const inr = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchParkingAllotments(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`/api/crm/parking/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchExtraCharges(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`/api/crm/extra-charges/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchParkingRates(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/parking-master"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAvailableParkingSlots(projectId: number, blockId: number | null): Promise<any[]> {
  try {
    const params = new URLSearchParams({ projectId: String(projectId) });
    if (blockId) params.set("blockId", String(blockId));
    const r = await fetchWithAuth(`/api/parking-matrix?${params}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function fetchExtraChargeTypes(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/extra-charge-master"); return r.ok ? r.json() : []; } catch { return []; }
}

// Booking-scoped Parking + Extra Charges panel — Parking rates and Extra
// Charge types are read-only here (they're maintained in their Setup
// masters); this dialog only allots/removes them against this booking.
const ChargesDialog: React.FC<{ booking: any; onClose: () => void }> = ({ booking, onClose }) => {
  const qc = useQueryClient();
  const [parkingForm, setParkingForm] = useState({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
  const [extraForm, setExtraForm] = useState({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
  const [saving, setSaving] = useState(false);

  const { data: parking = [] } = useQuery({
    queryKey: ["crm-parking", booking.Id],
    queryFn: () => fetchParkingAllotments(booking.Id),
  });
  const { data: extras = [] } = useQuery({
    queryKey: ["crm-extra-charges", booking.Id],
    queryFn: () => fetchExtraCharges(booking.Id),
  });
  const { data: parkingRates = [] } = useQuery({
    queryKey: ["parking-master-all"],
    queryFn: fetchParkingRates,
    staleTime: 5 * 60_000,
  });
  const { data: parkingSlots = [] } = useQuery({
    queryKey: ["parking-matrix-for-booking", booking.ProjectId, booking.BlockId],
    queryFn: () => fetchAvailableParkingSlots(booking.ProjectId, booking.BlockId),
    enabled: !!booking.ProjectId,
    staleTime: 30_000,
  });
  const { data: chargeTypes = [] } = useQuery({
    queryKey: ["extra-charge-master-all"],
    queryFn: fetchExtraChargeTypes,
    staleTime: 5 * 60_000,
  });

  const applicableRates = (parkingRates as any[]).filter(
    (r: any) => r.IsActive && r.ProjectId === booking.ProjectId && (!r.BlockId || r.BlockId === booking.BlockId)
  );
  const selectedRate = applicableRates.find((r: any) => String(r.Id) === parkingForm.ParkingMasterId);
  const availableSlots = (parkingSlots as any[]).filter(
    (s: any) => s.Status === "Available" && (!selectedRate || s.ParkingType === selectedRate.ParkingType)
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-parking", booking.Id] });
    qc.invalidateQueries({ queryKey: ["crm-extra-charges", booking.Id] });
    qc.invalidateQueries({ queryKey: ["crm-bookings"] });
  };

  const handleAddParking = async () => {
    if (!parkingForm.ParkingMasterId) { toast.error("Select a parking rate"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/crm/parking/${booking.Id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ParkingMasterId: parkingForm.ParkingMasterId,
          ParkingSlotId: parkingForm.ParkingSlotId ? parseInt(parkingForm.ParkingSlotId) : null,
          ParkingSlotNo: parkingForm.ParkingSlotId ? undefined : (parkingForm.ParkingSlotNo || null),
          Quantity: parseInt(parkingForm.Quantity) || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking allotted — ${inr(data.TotalAmount)}`);
      setParkingForm({ ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1" });
      qc.invalidateQueries({ queryKey: ["parking-matrix-for-booking", booking.ProjectId, booking.BlockId] });
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveParking = async (id: number) => {
    try {
      const res = await fetchWithAuth(`/api/crm/parking/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Parking allotment removed");
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAddExtra = async () => {
    if (!extraForm.Description.trim() || !extraForm.Amount) { toast.error("Description and Amount are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/crm/extra-charges/${booking.Id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ExtraChargeMasterId: extraForm.ExtraChargeMasterId || null,
          Description: extraForm.Description.trim(),
          Amount: parseFloat(extraForm.Amount),
          GstRate: parseFloat(extraForm.GstRate) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Charge added — ${inr(data.TotalAmount)}`);
      setExtraForm({ ExtraChargeMasterId: "", Description: "", Amount: "", GstRate: "18" });
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveExtra = async (id: number) => {
    try {
      const res = await fetchWithAuth(`/api/crm/extra-charges/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Charge removed");
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const parkingTotal = (parking as any[]).reduce((s, p) => s + p.TotalAmount, 0);
  const extraTotal = (extras as any[]).reduce((s, e) => s + e.TotalAmount, 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Charges — {booking.BookingNo}</DialogTitle>
        </DialogHeader>

        {/* Grand total breakdown */}
        <div className="rounded-lg bg-muted/40 border border-border p-3 grid grid-cols-4 gap-2 text-center text-xs">
          <div><div className="text-muted-foreground">Unit Value</div><div className="font-semibold">{inr(booking.TotalValue)}</div></div>
          <div><div className="text-muted-foreground">Parking</div><div className="font-semibold">{inr(parkingTotal)}</div></div>
          <div><div className="text-muted-foreground">Extra Charges</div><div className="font-semibold">{inr(extraTotal)}</div></div>
          <div><div className="text-muted-foreground">Grand Total</div><div className="font-bold text-primary">{inr((booking.TotalValue || 0) + parkingTotal + extraTotal)}</div></div>
        </div>

        {/* Parking */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Parking Allotment</h3>
          {(parking as any[]).length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              {(parking as any[]).map((p) => (
                <div key={p.Id} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 text-sm">
                  <div>
                    <span className="font-medium">{p.CurrentParkingType}</span>
                    {p.ParkingSlotNo && <span className="text-xs text-muted-foreground"> · {p.ParkingSlotNo}</span>}
                    <span className="text-xs text-muted-foreground"> · Qty {p.Quantity}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{inr(p.TotalAmount)}</span>
                    <button onClick={() => handleRemoveParking(p.Id)} className="text-xs text-red-600 hover:underline">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            <select value={parkingForm.ParkingMasterId}
              onChange={(e) => setParkingForm((f) => ({ ...f, ParkingMasterId: e.target.value, ParkingSlotId: "" }))}
              className="col-span-2 text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select parking rate</option>
              {applicableRates.map((r: any) => (
                <option key={r.Id} value={String(r.Id)}>{r.ParkingType} — {inr(r.Charge)} (+{r.GstRate}% GST)</option>
              ))}
            </select>
            {availableSlots.length > 0 ? (
              <select value={parkingForm.ParkingSlotId} onChange={(e) => setParkingForm((f) => ({ ...f, ParkingSlotId: e.target.value }))}
                className="text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select slot (optional)</option>
                {availableSlots.map((s: any) => (
                  <option key={s.Id} value={String(s.Id)}>{s.SlotNo}{s.BlockName ? ` — ${s.BlockName}` : ""}</option>
                ))}
              </select>
            ) : (
              <input placeholder="Slot No." value={parkingForm.ParkingSlotNo}
                onChange={(e) => setParkingForm((f) => ({ ...f, ParkingSlotNo: e.target.value }))}
                className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
            )}
            <input type="number" min={1} placeholder="Qty" value={parkingForm.Quantity}
              onChange={(e) => setParkingForm((f) => ({ ...f, Quantity: e.target.value }))}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <button onClick={handleAddParking} disabled={saving}
            className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-40">
            + Allot Parking
          </button>
          {applicableRates.length === 0 && (
            <p className="text-xs text-muted-foreground">No parking rate configured for this project/block yet — set one up in Setup → Parking Master.</p>
          )}
          {applicableRates.length > 0 && availableSlots.length === 0 && (
            <p className="text-xs text-muted-foreground">No numbered slot inventory set up for this project/block yet — enter a slot number manually, or add slots in Setup → Parking Slot Master.</p>
          )}
        </div>

        {/* Extra Charges */}
        <div className="space-y-2 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold">Extra Charges (Custom Requirements)</h3>
          {(extras as any[]).length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              {(extras as any[]).map((c) => (
                <div key={c.Id} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 text-sm">
                  <div className="font-medium">{c.Description}</div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{inr(c.TotalAmount)}</span>
                    <button onClick={() => handleRemoveExtra(c.Id)} className="text-xs text-red-600 hover:underline">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select value={extraForm.ExtraChargeMasterId}
              onChange={(e) => {
                const master = (chargeTypes as any[]).find((c) => String(c.Id) === e.target.value);
                setExtraForm((f) => ({
                  ...f,
                  ExtraChargeMasterId: e.target.value,
                  Description: master ? master.ChargeName : f.Description,
                  Amount: master?.DefaultAmount != null ? String(master.DefaultAmount) : f.Amount,
                  GstRate: master ? String(master.GstRate) : f.GstRate,
                }));
              }}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Custom (type below)</option>
              {(chargeTypes as any[]).filter((c) => c.IsActive).map((c) => (
                <option key={c.Id} value={String(c.Id)}>{c.ChargeName}</option>
              ))}
            </select>
            <input placeholder="Description" value={extraForm.Description}
              onChange={(e) => setExtraForm((f) => ({ ...f, Description: e.target.value }))}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <input type="number" placeholder="Amount (₹)" value={extraForm.Amount}
              onChange={(e) => setExtraForm((f) => ({ ...f, Amount: e.target.value }))}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <input type="number" placeholder="GST %" value={extraForm.GstRate}
              onChange={(e) => setExtraForm((f) => ({ ...f, GstRate: e.target.value }))}
              className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <button onClick={handleAddExtra} disabled={saving}
            className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-40">
            + Add Charge
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// The real workflow gate: Welcome Call -> Bank Details -> Agreement (both
// approvals) -> Payments. Only ever surface the ONE step the booking is
// actually sitting at right now — never let staff jump ahead to a later
// step a record hasn't reached yet.
type NextStep = { label: string; color: string; path: string } | null;
function getNextStep(b: any): NextStep {
  if (b.Status !== "Approved") return null; // Pending/Rejected/Cancelled have no forward step
  if (!b.HasWelcomeCall) return { label: "Welcome Call", color: "text-sky-600 border-sky-200 bg-sky-50", path: `/crm/welcome-calls?bookingId=${b.Id}` };
  if (!b.BankDetailsComplete) return { label: "Bank Details", color: "text-amber-600 border-amber-200 bg-amber-50", path: `/crm/customer-bank-details?bookingId=${b.Id}` };
  if (!b.AgreementId || b.SeniorApprovalStatus !== "Approved" || b.CustomerApprovalStatus !== "Approved") {
    return { label: "Agreement", color: "text-purple-600 border-purple-200 bg-purple-50", path: `/crm/agreements?bookingId=${b.Id}` };
  }
  if (b.PendingMilestoneCount > 0) return { label: "Payments", color: "text-primary border-primary/20 bg-primary/5", path: `/crm/payments?bookingId=${b.Id}` };
  return null; // every gated step is complete
}

const CrmBooking: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const appFilter = sp.get("applicationId") || "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, ApplicationId: appFilter });
  const [saving, setSaving] = useState(false);
  const [chargesBooking, setChargesBooking] = useState<any | null>(null);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["crm-bookings", appFilter],
    queryFn: () => fetchBookings(appFilter || undefined),
    staleTime: 60_000,
  });
  const { data: apps = [] } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: plans = [] } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });

  const availableUnits = useMemo(() => {
    const bookedIds = new Set((bookings as any[]).filter((b: any) => b.Status !== "Cancelled" && b.Status !== "Rejected").map((b: any) => b.UnitId));
    return (units as any[]).filter((u: any) => u.IsActive && (!bookedIds.has(u.Id) || String(u.Id) === form.UnitId));
  }, [units, bookings, form.UnitId]);

  const handleUnitSelect = (unitId: string) => {
    const u = (units as any[]).find((x: any) => String(x.Id) === unitId);
    const area = u?.AreaSqFt != null ? String(u.AreaSqFt) : "";
    const rate = parseFloat(form.RatePerSqFt);
    const areaNum = parseFloat(area);
    setForm((f) => ({
      ...f,
      UnitId: unitId,
      UnitNo: u?.UnitName || f.UnitNo,
      ProjectName: u?.ProjectName || f.ProjectName,
      BlockName: u?.BlockName || f.BlockName,
      UnitType: u?.UnitType || "",
      AreaSqFt: area,
      TotalValue: !isNaN(areaNum) && !isNaN(rate) ? String(Math.round(areaNum * rate)) : f.TotalValue,
    }));
  };

  // Area is auto-fetched from the selected unit (Unit Master) — only Rate
  // is entered here, and it recalculates TotalValue against that fixed area.
  const handleRateChange = (val: string) => {
    const rate = parseFloat(val);
    const area = parseFloat(form.AreaSqFt);
    setForm((f) => ({
      ...f,
      RatePerSqFt: val,
      TotalValue: !isNaN(area) && !isNaN(rate) ? String(Math.round(area * rate)) : f.TotalValue,
    }));
  };

  const filtered = useMemo(() => {
    return (bookings as any[]).filter((b: any) => {
      const s = !search || b.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || b.BookingNo?.includes(search) || b.UnitNo?.includes(search);
      const st = statusFilter === "All" || b.Status === statusFilter;
      return s && st;
    });
  }, [bookings, search, statusFilter]);

  const handleSave = async () => {
    if (!form.ApplicationId) { toast.error("Please select an Application"); return; }
    if (!form.UnitId)  { toast.error("A unit must be selected from Unit Master"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ApplicationId: parseInt(form.ApplicationId),
          UnitId:        parseInt(form.UnitId),
          AreaSqFt:      form.AreaSqFt    || null,
          RatePerSqFt:   form.RatePerSqFt || null,
          TotalValue:    form.TotalValue   || null,
          TokenValue:    form.TokenValue   || null,
          PaymentPlanId: form.PaymentPlanId || null,
          AssignedTo:    form.AssignedTo   || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create booking");
      toast.success(`Booking ${data.BookingNo} created — payment milestones auto-generated`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, ApplicationId: appFilter });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Unit change is a rare, authorized-only action (admin/super_admin/
  // marketing_head, enforced server-side) — a lightweight prompt flow
  // matches the other one-off actions on this page rather than a full
  // dialog for something this infrequent.
  const handleChangeUnit = async (b: any) => {
    const options = (units as any[])
      .filter((u: any) => u.IsActive && u.Id !== b.UnitId)
      .map((u: any) => `${u.Id}: ${u.ProjectName} — ${u.BlockName} — ${u.UnitName}`)
      .join("\n");
    const newUnitId = window.prompt(`Enter the new Unit ID for ${b.BookingNo}:\n\n${options}`);
    if (!newUnitId) return;
    const reason = window.prompt("Reason for changing the unit (required):");
    if (!reason?.trim()) { toast.error("Reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${b.Id}/change-unit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NewUnitId: parseInt(newUnitId), Reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Unit changed to ${data.unitNo}`);
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Bookings"
      subtitle="Unit bookings linked to customer applications"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={14} /> New Booking
        </button>
      }
    >
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, booking no, unit..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="All">All Statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                {["Booking No", "Customer", "Project / Unit", "Area", "Value", "Booking Amt", "Status", "Date", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">No bookings found</td></tr>
              ) : (filtered as any[]).map((b: any) => (
                <tr key={b.Id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{b.BookingNo}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.ApplicantName}</div>
                    <div className="text-xs text-muted-foreground">{b.Mobile}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{b.ProjectName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{[b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / ")}</div>
                    {b.CompanyName && <div className="text-xs text-muted-foreground">{b.CompanyName}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm">{b.AreaSqFt ? `${b.AreaSqFt} sqft` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{fmt(b.GrandTotal ?? b.TotalValue)}</div>
                    {(b.ParkingTotal > 0 || b.ExtraChargesTotal > 0) && (
                      <div className="text-[10px] text-muted-foreground">
                        Unit {fmt(b.TotalValue)}
                        {b.ParkingTotal > 0 && ` + Parking ${fmt(b.ParkingTotal)}`}
                        {b.ExtraChargesTotal > 0 && ` + Extra ${fmt(b.ExtraChargesTotal)}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{fmt(b.BookingAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[b.Status] || ""}`}>{b.Status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{b.BookingDate ? String(b.BookingDate).slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* submitOnly: Approve/Reject only ever happen from the
                          Admin Approval Inbox (admin/super_admin/marketing_head) */}
                      <ApprovalActions
                        status={b.Status}
                        recordId={b.Id}
                        endpoint={API}
                        submitOnly
                        onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-bookings"] })}
                      />
                      {b.Status === "Pending" && <span className="text-xs text-muted-foreground">Pending admin approval</span>}
                      {(() => {
                        const step = getNextStep(b);
                        if (step) {
                          return (
                            <button onClick={() => navigate(step.path)}
                              className={`text-xs px-2 py-1 rounded-md border font-medium flex items-center gap-1 ${step.color}`}>
                              {step.label} <ChevronRight size={12} />
                            </button>
                          );
                        }
                        if (b.Status === "Approved") {
                          return (
                            <span className="text-xs px-2 py-1 rounded-md border text-emerald-600 border-emerald-200 bg-emerald-50 font-medium flex items-center gap-1">
                              <CheckCircle2 size={12} /> All Steps Complete
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {/* Non-sequential utility actions — not part of the
                          linear flow, so they live in an overflow menu
                          instead of competing with the one active step. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded-md hover:bg-muted text-muted-foreground" title="More actions">
                            <MoreHorizontal size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/crm/welcome-calls?bookingId=${b.Id}`)}>Welcome Call</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/crm/communication?bookingId=${b.Id}`)}>Communication</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/crm/customer-bank-details?bookingId=${b.Id}`)}>Bank Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/crm/agreements?bookingId=${b.Id}`)}>Agreement</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/crm/payments?bookingId=${b.Id}`)}>Payments</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setChargesBooking(b)}>Charges</DropdownMenuItem>
                          {b.Status !== "Cancelled" && (
                            <DropdownMenuItem onClick={() => handleChangeUnit(b)} className="text-rose-600 focus:text-rose-600">
                              Change Unit
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Booking Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, ApplicationId: appFilter }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">New Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Application *</label>
              <select value={form.ApplicationId} onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select application</option>
                {(apps as any[]).map((a: any) => (
                  <option key={a.Id} value={String(a.Id)}>
                    {a.ApplicationNo} — {a.ApplicantName} ({a.Mobile})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Unit * (from Unit Master — mandatory)</label>
                <select value={form.UnitId} onChange={(e) => handleUnitSelect(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select unit</option>
                  {(availableUnits as any[]).map((u: any) => (
                    <option key={u.Id} value={String(u.Id)}>{u.ProjectName} — {u.BlockName} — {u.UnitName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Project (from selected unit)</label>
                <input type="text" value={form.ProjectName} readOnly disabled
                  placeholder="Auto-filled once a unit is selected"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-muted/40 text-muted-foreground cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Block/Tower (from selected unit)</label>
                <input type="text" value={form.BlockName} readOnly disabled
                  placeholder="Auto-filled once a unit is selected"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-muted/40 text-muted-foreground cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Type of Unit (from selected unit)</label>
                <input type="text" value={form.UnitType} readOnly disabled
                  placeholder="Auto-filled once a unit is selected"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-muted/40 text-muted-foreground cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking Date</label>
                <input type="date" value={form.BookingDate}
                  onChange={(e) => setForm((f) => ({ ...f, BookingDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking Token Type</label>
                <select value={form.TokenType} onChange={(e) => setForm((f) => ({ ...f, TokenType: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {TOKEN_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Token {form.TokenType === "Percentage" ? "(%)" : "Amount (₹)"}
                </label>
                <input type="number" value={form.TokenValue} onChange={(e) => setForm((f) => ({ ...f, TokenValue: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Payment Plan (optional — default 7-stage split used if none selected)</label>
                <select value={form.PaymentPlanId} onChange={(e) => setForm((f) => ({ ...f, PaymentPlanId: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Default split</option>
                  {(plans as any[]).filter((p: any) => p.IsActive).map((p: any) => (
                    <option key={p.Id} value={String(p.Id)}>{p.PlanName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                <select value={form.PaymentMode} onChange={(e) => setForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select</option>
                  {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Area (sq ft) — from Unit Master</label>
                <input type="text" value={form.AreaSqFt} readOnly disabled
                  placeholder="Auto-filled once a unit is selected"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-muted/40 text-muted-foreground cursor-not-allowed" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rate per sq ft (₹)</label>
                <input type="number" value={form.RatePerSqFt} onChange={(e) => handleRateChange(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Total Value (₹) — auto-calculated</label>
                <input type="number" value={form.TotalValue} onChange={(e) => setForm((f) => ({ ...f, TotalValue: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background font-semibold" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Assigned To</label>
                <select value={form.AssignedTo} onChange={(e) => setForm((f) => ({ ...f, AssignedTo: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— Unassigned —</option>
                  {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
            </div>
            {form.TotalValue && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
                Milestone payment schedule (7 stages) will be auto-generated from total value of ₹{Number(form.TotalValue).toLocaleString("en-IN")}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, ApplicationId: appFilter }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? "Creating..." : "Create Booking"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {chargesBooking && (
        <ChargesDialog booking={chargesBooking} onClose={() => setChargesBooking(null)} />
      )}
    </SalesAutoShell>
  );
};

export default CrmBooking;
