import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Search, ChevronRight, MoreHorizontal, CheckCircle2,
  Eye, Phone, MessageSquare, Landmark, FileSignature, IndianRupee, Repeat, Building2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { CrmBookingDetail } from "./CrmBookingDetail";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API     = "/api/crm/bookings";
const APP_API = "/api/crm/applications";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";
const PLAN_API = "/api/crm/payment-plans";
const PROJECT_BANK_API = "/api/crm/project-banks";
const BANK_MASTER_API = "/api/bank-master";

const STATUSES    = ["Pending", "Approved", "Rejected", "Cancelled"];
const PAY_MODES   = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];
const TOKEN_TYPES = ["Percentage", "Amount"];

// Shared field styling for the New Booking dialog's restructured 2-column
// layout — same amber-focus-ring convention as the New Application wizard's
// inputCls/labelCls (CrmApplication.tsx).
const inputCls = "w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40";
const inputClsDisabled = "w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-muted/40 text-muted-foreground cursor-not-allowed";
const labelCls = "text-xs text-muted-foreground block mb-1";

const statusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-muted-foreground bg-muted/50 border-border",
};

const workflowStageLabel: Record<string, string> = {
  Review: "Application Review",
  MarketingHeadApproval: "Marketing Head Approval",
  DirectorApproval: "Director Approval",
  Confirmed: "Confirmed",
};

// Manual/direct Booking creation — brought back at the user's explicit
// request after the auto-create-only design proved too rigid in practice
// (e.g. an Application approved with no PreferredUnitId never gets a
// Booking otherwise, with no way through the UI to fix that). Still
// requires picking a real Application, same as before — this is not a
// freeform booking with no Application behind it.
const EMPTY_FORM = {
  ApplicationId: "", UnitId: "", ProjectName: "", UnitNo: "", BlockName: "",
  UnitType: "", AreaSqFt: "", RatePerSqFt: "", TotalValue: "",
  TokenType: "Percentage", TokenValue: "", PaymentPlanId: "",
  BookingDate: "", PaymentMode: "", AssignedTo: "", Notes: "",
  BookingAmount: "", BrokerId: "", BrokerageRatePercent: "", BrokeragePaymentPlan: "OneTime",
  DepositBankId: "",
};

async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
// Needed to resolve a tagged plan's fixed Booking Amount — Booking is no
// longer typed per booking, it's decided when the plan itself was created
// (see CrmPaymentPlans.tsx / crmEntityCreation.js's generateMilestonesForBooking).
async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${PLAN_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
// One Application -> at most one Booking, ever (see crmEntityCreation.js's
// createCrmBookingRecord). This dropdown must only ever offer applications
// that are both COMPLETE (Status = 'Approved' — Draft/Pending haven't
// cleared admin approval yet) and OPEN (not already Converted to a Booking)
// — the exact ?forBooking=1 filter crmApplications.js enforces server-side,
// never left to client-side filtering that could drift.
async function fetchApps(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(`${APP_API}?forBooking=1`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
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
// Which real company bank account this booking's token payment lands in —
// scoped to the selected unit's project (falls back to the open bank list if
// the project has none tagged), same "Deposited To" pattern already used by
// CrmBookingDetail.tsx and CrmPaymentMilestones.tsx's own deposit dialogs.
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAllBanks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BANK_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
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

// The real workflow gate: Welcome Call -> Bank Details -> Agreement (both
// approvals) -> Payments. Only ever surface the ONE step the booking is
// actually sitting at right now — never let staff jump ahead to a later
// step a record hasn't reached yet.
type NextStep = { label: string; color: string; path: string } | null;
function getNextStep(b: any): NextStep {
  if (b.Status !== "Approved") return null; // Pending/Rejected/Cancelled have no forward step
  // HasWelcomeCall means Outcome = 'Welcomed' specifically (see crmBookings.js
  // BOOKING_SELECT) -- a logged call with any other outcome must NOT satisfy
  // this, since that's not what unblocks Agreement auto-creation either.
  if (!b.HasWelcomeCall) return { label: "Welcome Call", color: "text-amber-500 border-amber-200 bg-amber-50", path: `/crm/welcome-calls?bookingId=${b.Id}` };
  if (!b.BankDetailsComplete) return { label: "Bank Details", color: "text-amber-600 border-amber-200 bg-amber-50", path: `/crm/customer-bank-details?bookingId=${b.Id}` };
  // Agreement sub-stages: draft → senior approval → customer approval → date negotiation → date approval → executed
  if (!b.AgreementId || b.SeniorApprovalStatus !== "Approved" || b.CustomerApprovalStatus !== "Approved") {
    return { label: "Agreement", color: "text-orange-600 border-orange-200 bg-orange-50", path: `/crm/agreements?bookingId=${b.Id}` };
  }
  if (!b.AgreementDate) {
    return { label: "Agreement Date", color: "text-orange-600 border-orange-200 bg-orange-50", path: `/crm/agreements?bookingId=${b.Id}` };
  }
  if (b.DateApprovalStatus !== "Approved") {
    return { label: "Date Approval", color: "text-orange-600 border-orange-200 bg-orange-50", path: `/crm/agreements?bookingId=${b.Id}` };
  }
if (b.PendingMilestoneCount > 0) return { label: "Payments", color: "text-amber-700 border-amber-200 bg-amber-50", path: `/crm/payments?bookingId=${b.Id}` };
  return null; // every gated step is complete
}

const CrmBooking: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  // Bookings mainly auto-create on Application approval, with this dialog
  // as the manual fallback (e.g. an Application with no unit preselected).
  // canEdit gates both this and the other mutating actions on this review
  // page (see CrmBookingDetail.tsx).
  const canEdit = canDoAction("crm-bookings", "edit");
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const appFilter = sp.get("applicationId") || "";
  const viewFilter = sp.get("view") || "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, ApplicationId: appFilter });
  const [saving, setSaving] = useState(false);
  const [viewingBookingId, setViewingBookingId] = useState<number | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["crm-bookings", appFilter],
    queryFn: () => fetchBookings(appFilter || undefined),
    staleTime: 60_000,
  });

  // Deep-link support: /crm/bookings?applicationId=X (from "View Booking"
  // elsewhere in the app) opens that booking's detail modal directly in
  // this same tab/page instead of leaving staff to find and click the one
  // filtered row themselves. deepLinkOpened is a one-shot guard — without
  // it, closing the modal would immediately reopen it, since the URL still
  // carries applicationId (same class of bug already fixed on the Bank &
  // Nominee page's own deep link).
  React.useEffect(() => {
    if (viewFilter && !deepLinkOpened) {
      setViewingBookingId(parseInt(viewFilter, 10));
      setDeepLinkOpened(true);
      return;
    }
    if (!appFilter || deepLinkOpened) return;
    const row = (bookings as any[]).find((b: any) => String(b.ApplicationId) === appFilter);
    if (row) { setViewingBookingId(row.Id); setDeepLinkOpened(true); }
  }, [appFilter, viewFilter, bookings, deepLinkOpened]);
  const { data: apps = [] } = useQuery({ queryKey: ["crm-apps"], queryFn: fetchApps, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });
  const { data: paymentPlans = [] } = useQuery({ queryKey: ["crm-payment-plans-active"], queryFn: fetchPaymentPlans, staleTime: 5 * 60_000 });

  // The plan actually tagged to this booking (via the Application) — its
  // BookingAmount is the fixed, authoritative figure; nobody types this by
  // hand anymore.
  const selectedPlan = useMemo(
    () => (paymentPlans as any[]).find((p: any) => String(p.Id) === form.PaymentPlanId) || null,
    [paymentPlans, form.PaymentPlanId],
  );

  // Booking Amount is decided on the Payment Plan itself now, not typed
  // here — whenever the tagged plan (or its BookingAmount) is known, force
  // the form to match it rather than leaving stale/hand-typed data around.
  React.useEffect(() => {
    if (selectedPlan?.BookingAmount == null) return;
    const planAmt = String(selectedPlan.BookingAmount);
    setForm((f) => f.BookingAmount === planAmt ? f : { ...f, BookingAmount: planAmt });
  }, [selectedPlan]);

  const selectedUnitProjectId: number | undefined = useMemo(
    () => (units as any[]).find((u: any) => String(u.Id) === form.UnitId)?.ProjectId,
    [units, form.UnitId],
  );
  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-booking-project-banks", selectedUnitProjectId],
    queryFn: () => fetchProjectBanks(selectedUnitProjectId),
    enabled: dialogOpen && !!selectedUnitProjectId,
  });
  const { data: allBanks = [] } = useQuery({
    queryKey: ["bank-master-dropdown"],
    queryFn: fetchAllBanks,
    enabled: dialogOpen,
    staleTime: 5 * 60_000,
  });
  // /for-project already resolves the full exclusivity rule server-side
  // (tagged-only, or every untagged bank as the fallback pool) — falling
  // back further to the raw, unfiltered bank list here would silently
  // reintroduce banks tagged exclusively to a DIFFERENT project. Only use
  // the raw list when this unit's Project isn't known yet.
  const bankOptions = selectedUnitProjectId ? projectBanks : allBanks;
  React.useEffect(() => {
    if (projectBanks.length === 1) {
      setForm((f) => f.DepositBankId ? f : { ...f, DepositBankId: String(projectBanks[0].BId) });
    }
  }, [projectBanks]);

  const availableUnits = useMemo(() => {
    // Was filtering against the `bookings` query above — but that query is
    // scoped to a single Application whenever this page is opened via
    // ?applicationId= (the common "View Booking" deep link), so it would
    // silently under-report every OTHER application's booked units as still
    // available. unit-master's own LockBookingNo/LockHoldId (computed
    // system-wide, not scoped to this page's filters) is the reliable
    // source — same fields CrmApplication.tsx's own unit picker now uses.
    return (units as any[]).filter((u: any) =>
      u.IsActive && (!(u.LockBookingNo || u.LockHoldId) || String(u.Id) === form.UnitId)
    );
  }, [units, form.UnitId]);

  // The selected Application's own PreferredUnitId — auto-fetched and locked
  // here just like its other fields, since it's already been decided. Only
  // when that unit is still actually available: two Applications can share
  // the same PreferredUnitId, and if a different one already booked it, this
  // dialog's whole reason for existing is to let staff pick a replacement —
  // so it must fall back to a real picker rather than lock onto a unit the
  // booking would then fail to save against.
  const selectedApp = useMemo(
    () => (apps as any[]).find((a: any) => String(a.Id) === form.ApplicationId),
    [apps, form.ApplicationId]
  );
  const appPreferredUnitId: number | undefined = selectedApp?.PreferredUnitId;
  const appPreferredUnitAvailable = appPreferredUnitId != null
    && (availableUnits as any[]).some((u: any) => u.Id === appPreferredUnitId);
  const unitLockedFromApp = !!appPreferredUnitId && appPreferredUnitAvailable;

  // Everything the Application already captured (rate, token, booking
  // amount, payment mode, assignee, plan, brokerage, notes) is auto-fetched
  // and locked here — the exact same data createCrmBookingRecord would have
  // used had auto-booking succeeded at Application-approval time (see
  // crmApplications.js PUT /:id/approve). Staff filling this manual fallback
  // dialog only ever need to pick the Unit; nothing Application-sourced
  // should be re-typed or drift from what was already approved.
  const handleApplicationSelect = (applicationId: string) => {
    const app = (apps as any[]).find((a: any) => String(a.Id) === applicationId);
    const appUnit = app?.PreferredUnitId
      ? (units as any[]).find((u: any) => u.Id === app.PreferredUnitId)
      : null;
    const area = appUnit?.AreaSqFt != null ? String(appUnit.AreaSqFt) : "";
    const rate = app?.RatePerSqFt != null ? String(app.RatePerSqFt) : "";
    const areaNum = parseFloat(area);
    const rateNum = parseFloat(rate);
    setForm((f) => ({
      ...f,
      ApplicationId: applicationId,
      UnitId: appUnit ? String(appUnit.Id) : "",
      UnitNo: appUnit?.UnitName || "",
      ProjectName: appUnit?.ProjectName || "",
      BlockName: appUnit?.BlockName || "",
      UnitType: appUnit?.UnitType || "",
      AreaSqFt: area,
      RatePerSqFt: rate,
      TotalValue: !isNaN(areaNum) && !isNaN(rateNum) ? String(Math.round(areaNum * rateNum)) : "",
      PaymentPlanId: app?.PaymentPlanId ? String(app.PaymentPlanId) : "",
      TokenType: app?.TokenType || "Percentage",
      TokenValue: app?.TokenValue != null ? String(app.TokenValue) : "",
      BookingAmount: app?.BookingAmount != null ? String(app.BookingAmount) : "",
      PaymentMode: app?.PaymentMode || "",
      AssignedTo: app?.AssignedTo != null ? String(app.AssignedTo) : "",
      Notes: app?.Notes || "",
      BrokerId: app?.BrokerId != null ? String(app.BrokerId) : "",
      BrokerageRatePercent: app?.BrokerageRatePercent != null ? String(app.BrokerageRatePercent) : "",
      BrokerageSplitEnabled: !!app?.BrokerageSplitEnabled,
    }));
  };

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
      // PaymentPlanId comes from the Application (mandatory there) — a Unit
      // no longer has a single "default" plan, only 1+ tagged plans, so
      // there's nothing to fall back to here.
      PaymentPlanId: f.PaymentPlanId,
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
    if (bankOptions.length > 0 && !form.DepositBankId) { toast.error("Select which company bank this booking's token payment landed in"); return; }
    setSaving(true);
    try {
      const bankName = form.DepositBankId
        ? (bankOptions as any[]).find((b: any) => String(b.BId) === form.DepositBankId)?.BName
        : undefined;
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
          BookingAmount: form.BookingAmount || null,
          BrokerId:      form.BrokerId || null,
          BrokerageRatePercent: form.BrokerageRatePercent || null,
          BrokeragePaymentPlan: form.BrokerId ? (form.BrokeragePaymentPlan || "OneTime") : "OneTime",
          DepositBankId: form.DepositBankId || null,
          DepositBankName: bankName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create booking");
      toast.success(`Booking ${data.BookingNo} created — payment milestones auto-generated`);
      if (data.tokenWarning) toast.warning(data.tokenWarning, { duration: 8000 });
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, ApplicationId: appFilter });
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
      qc.invalidateQueries({ queryKey: ["crm-apps"] }); // the Application just became Converted — the New Booking dropdown's app list must reflect that immediately, not after the 5-minute staleTime
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const [unitChangeBooking, setUnitChangeBooking] = useState<any | null>(null);
  const [unitChangeNewId, setUnitChangeNewId] = useState("");
  const [unitChangeReason, setUnitChangeReason] = useState("");
  const [unitChangeSaving, setUnitChangeSaving] = useState(false);

  const handleChangeUnit = async () => {
    if (!unitChangeNewId) { toast.error("Select a unit"); return; }
    if (!unitChangeReason.trim()) { toast.error("Reason is required"); return; }
    setUnitChangeSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${unitChangeBooking.Id}/change-unit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NewUnitId: parseInt(unitChangeNewId), Reason: unitChangeReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Unit changed to ${data.unitNo}`);
      setUnitChangeBooking(null);
      setUnitChangeNewId(""); setUnitChangeReason("");
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUnitChangeSaving(false);
    }
  };

  const bookingColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking No", size: 115,
      cell: (i) => (
        <button onClick={() => setViewingBookingId(i.row.original.Id)} className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">
          {i.row.original.BookingNo}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <div onClick={() => setViewingBookingId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / Unit", size: 180, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        return (
          <div onClick={() => setViewingBookingId(b.Id)} className="cursor-pointer">
            <div>{b.ProjectName || "—"}</div>
            <div className="text-xs text-muted-foreground">{[b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / ")}</div>
            {b.CompanyName && <div className="text-xs text-muted-foreground">{b.CompanyName}</div>}
          </div>
        );
      } },
    { accessorKey: "AreaSqFt", header: "Area", size: 90,
      cell: (i) => <span onClick={() => setViewingBookingId(i.row.original.Id)} className="cursor-pointer text-sm">{i.row.original.AreaSqFt ? `${i.row.original.AreaSqFt} sqft` : "—"}</span> },
    { id: "value", header: "Value / Financial", size: 185, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        const storedGrand = Number(b.GrandTotal ?? 0);
        const grand = storedGrand > 0 ? storedGrand : (Number(b.TotalValue || 0) + Number(b.UnitGstAmount || 0) + Number(b.ParkingTotal || 0) + Number(b.ExtraChargesTotal || 0));
        const cleared = Number(b.TotalCleared ?? 0);
        const mrOnAcc = Math.max(0, Number(b.MRReceivedTotal ?? 0) - cleared);
        const onAcc = mrOnAcc + Number(b.ApprovedOnAccount ?? 0);
        const outstanding = Math.max(0, grand - cleared - onAcc);
        const clearedPct = grand > 0 ? Math.min(100, Math.round((cleared / grand) * 100)) : 0;
        const onAccPct = grand > 0 ? Math.min(100 - clearedPct, Math.round((onAcc / grand) * 100)) : 0;
        return (
          <div onClick={() => setViewingBookingId(b.Id)} className="cursor-pointer space-y-1">
            <div className="font-semibold">{fmt(grand)}</div>
            {(b.ParkingTotal > 0 || b.ExtraChargesTotal > 0) && (
              <div className="text-[10px] text-muted-foreground">
                Unit {fmt(b.TotalValue)}
                {b.UnitGstAmount > 0 && ` + Unit GST ${fmt(b.UnitGstAmount)}`}
                {b.ParkingTotal > 0 && ` + Parking ${fmt(b.ParkingTotal)}`}
                {b.ExtraChargesTotal > 0 && ` + Extra ${fmt(b.ExtraChargesTotal)}`}
              </div>
            )}
            {grand > 0 && (
              <div className="space-y-0.5">
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden flex">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${clearedPct}%` }} />
                  <div className="h-full bg-blue-400 transition-all" style={{ width: `${onAccPct}%` }} />
                </div>
                <div className="flex gap-2 text-[9px]">
                  {cleared > 0 && <span className="text-emerald-600">✓ {fmt(cleared)}</span>}
                  {onAcc > 0 && <span className="text-blue-600">⬡ {fmt(onAcc)}</span>}
                  {outstanding > 0 && <span className="text-amber-600">○ {fmt(outstanding)}</span>}
                </div>
              </div>
            )}
          </div>
        );
      } },
    { accessorKey: "BookingAmount", header: "Booking Amt", size: 110,
      cell: (i) => <span onClick={() => setViewingBookingId(i.row.original.Id)} className="cursor-pointer">{fmt(i.row.original.BookingAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span onClick={() => setViewingBookingId(i.row.original.Id)} className={`cursor-pointer text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "BookingDate", header: "Date", size: 95,
      cell: (i) => (
        <span onClick={() => setViewingBookingId(i.row.original.Id)} className="cursor-pointer text-xs text-muted-foreground">
          {i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}
        </span>
      ) },
    { id: "actions", header: "Actions", size: 220, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        const step = getNextStep(b);
        // Same sequential gate getNextStep enforces for the primary
        // step button — a stage is only reachable once every stage
        // before it is actually done, so "Jump to Stage" can't be used
        // to route around the gate the button itself respects.
        const approved = b.Status === "Approved";
        const welcomeCallReached = approved;
        const bankDetailsReached = approved && b.HasWelcomeCall;
        const agreementReached = bankDetailsReached && b.BankDetailsComplete;
        const paymentsReached = agreementReached && !!b.AgreementId
          && b.SeniorApprovalStatus === "Approved" && b.CustomerApprovalStatus === "Approved";
        return (
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
            {b.Status === "Pending" && (
              b.WorkflowStage && b.WorkflowStage !== "Review" ? (
                <span className="text-xs text-muted-foreground">Pending {workflowStageLabel[b.WorkflowStage] || "Approval"}</span>
              ) : b.ReadyForApprovalAt ? (
                <span className="text-xs text-muted-foreground">Ready for Marketing Head Approval</span>
              ) : (
                <button onClick={() => setViewingBookingId(b.Id)}
                  className="text-xs px-2 py-1 rounded-md border text-amber-600 border-amber-200 bg-amber-50 font-medium flex items-center gap-1">
                  Review Checklist Incomplete <ChevronRight size={12} />
                </button>
              )
            )}
            {step ? (
              <button onClick={() => navigate(step.path)}
                className={`text-xs px-2 py-1 rounded-md border font-medium flex items-center gap-1 ${step.color}`}>
                {step.label} <ChevronRight size={12} />
              </button>
            ) : b.Status === "Approved" ? (
              <span className="text-xs px-2 py-1 rounded-md border text-emerald-600 border-emerald-200 bg-emerald-50 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} /> All Steps Complete
              </span>
            ) : null}
            {/* Non-sequential utility actions — not part of the linear
                flow, so they live in an overflow menu instead of competing
                with the one active step. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded-md hover:bg-muted text-muted-foreground" title="More actions">
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setViewingBookingId(b.Id)} className="gap-2">
                  <Eye size={14} className="text-muted-foreground" /> View Details / Invoice / Attachments
                </DropdownMenuItem>
                {(welcomeCallReached || bankDetailsReached || agreementReached || paymentsReached) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Jump to Stage</DropdownMenuLabel>
                  </>
                )}
                {welcomeCallReached && (
                  <DropdownMenuItem onClick={() => navigate(`/crm/welcome-calls?bookingId=${b.Id}`)} className="gap-2">
                    <Phone size={14} className="text-amber-500" /> Welcome Call
                  </DropdownMenuItem>
                )}
                {bankDetailsReached && (
                  <DropdownMenuItem onClick={() => navigate(`/crm/customer-bank-details?bookingId=${b.Id}`)} className="gap-2">
                    <Landmark size={14} className="text-amber-600" /> Bank Details
                  </DropdownMenuItem>
                )}
                {agreementReached && (
                  <DropdownMenuItem onClick={() => navigate(`/crm/agreements?bookingId=${b.Id}`)} className="gap-2">
                    <FileSignature size={14} className="text-orange-500" /> Agreement
                  </DropdownMenuItem>
                )}
                {paymentsReached && (
                  <DropdownMenuItem onClick={() => navigate(`/crm/payments?bookingId=${b.Id}`)} className="gap-2">
                    <IndianRupee size={14} className="text-amber-600" /> Payments
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate(`/crm/communication?bookingId=${b.Id}`)} className="gap-2">
                  <MessageSquare size={14} className="text-amber-700 dark:text-amber-400" /> Communication
                </DropdownMenuItem>
                {b.Status !== "Cancelled" && canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setUnitChangeBooking(b); setUnitChangeNewId(""); setUnitChangeReason(""); }} className="gap-2 text-rose-600 focus:text-rose-600">
                      <Repeat size={14} /> Change Unit
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
  ];

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

  return (
    <CrmShell
      title="CRM — Applications and Bookings"
      subtitle="Applications become pending bookings, then move through review, Marketing Head approval, and Director approval"
      action={
        canEdit ? (
          <button onClick={() => { setForm({ ...EMPTY_FORM, ApplicationId: appFilter }); setDialogOpen(true); }}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
            <Plus size={14} /> New Booking
          </button>
        ) : undefined
      }
    >
      {/* Search + status filter + table live in one continuous glass card,
          same convention as CrmLeads/CrmApplication, instead of a loose
          toolbar row floating above a separately-bordered table. */}
      <div className="rounded-xl overflow-hidden" style={glassStyle}>
        <div className="flex gap-3 flex-wrap items-center px-3.5 py-3 border-b" style={{ borderColor }}>
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, booking no, unit..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-auto min-w-[140px] text-sm border-border focus:ring-amber-500/40">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          data={filtered}
          columns={bookingColumns}
          searchable={false}
          loading={isLoading}
          emptyMessage="No bookings found"
          className="border-0"
        />
      </div>

      {/* New Booking Dialog — manual fallback, still requires a real Application.
          Widened + restructured into a 2-column layout (Unit/Project+Pricing on
          the left, Booking/Payment on the right) so every field fits in one
          screen without an inner scroller, matching the New Application
          wizard's Step 1 convention. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, ApplicationId: appFilter }); } }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-5 gap-3">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="flex items-center gap-2 text-base font-heading font-bold">
              <Building2 size={16} className="text-amber-500" /> New Booking
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Application * (Approved, not yet booked)</label>
              <Select value={form.ApplicationId || undefined} onValueChange={handleApplicationSelect}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Select application" />
                </SelectTrigger>
                <SelectContent>
                  {(apps as any[]).map((a: any) => (
                    <SelectItem key={a.Id} value={String(a.Id)}>
                      {a.ApplicationNo} — {a.ApplicantName} ({a.Mobile})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* ── LEFT: Unit / Project + Pricing ── */}
              <div className="rounded-lg border border-border p-2.5 space-y-2.5">
                <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Unit / Project</p>
                <div>
                  <label className={labelCls}>
                    Unit * {unitLockedFromApp ? "(from Application — already selected)" : "(from Unit Master — mandatory)"}
                  </label>
                  {unitLockedFromApp ? (
                    <input type="text" readOnly disabled
                      value={`${form.ProjectName} — ${form.BlockName} — ${form.UnitNo}`}
                      className={inputClsDisabled} />
                  ) : (
                    <>
                      <Select value={form.UnitId || undefined} onValueChange={handleUnitSelect}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent className="max-w-[min(90vw,420px)]">
                          {(availableUnits as any[]).map((u: any) => (
                            <SelectItem key={u.Id} value={String(u.Id)}>{u.ProjectName} — {u.BlockName} — {u.UnitName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {appPreferredUnitId != null && !appPreferredUnitAvailable && (
                        <p className="text-[11px] text-amber-600 mt-1">
                          This Application's preferred unit is no longer available — select a different one.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelCls}>Project</label>
                    <input type="text" value={form.ProjectName} readOnly disabled
                      placeholder="Auto-filled"
                      className={inputClsDisabled} />
                  </div>
                  <div>
                    <label className={labelCls}>Block/Tower</label>
                    <input type="text" value={form.BlockName} readOnly disabled
                      placeholder="Auto-filled"
                      className={inputClsDisabled} />
                  </div>
                  <div>
                    <label className={labelCls}>Type of Unit</label>
                    <input type="text" value={form.UnitType} readOnly disabled
                      placeholder="Auto-filled"
                      className={inputClsDisabled} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelCls}>Area (sq ft)</label>
                    <input type="text" value={form.AreaSqFt} readOnly disabled
                      placeholder="Auto-filled"
                      className={inputClsDisabled} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Rate/sqft (₹) {form.ApplicationId && form.RatePerSqFt ? "(App)" : ""}
                    </label>
                    <input type="number" value={form.RatePerSqFt} onChange={(e) => handleRateChange(e.target.value)}
                      readOnly={!!form.ApplicationId && !!form.RatePerSqFt} disabled={!!form.ApplicationId && !!form.RatePerSqFt}
                      className={form.ApplicationId && form.RatePerSqFt ? inputClsDisabled : inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Total Value (₹)</label>
                    <input type="number" value={form.TotalValue} onChange={(e) => setForm((f) => ({ ...f, TotalValue: e.target.value }))}
                      className={`${inputCls} font-semibold`} />
                  </div>
                </div>
                {form.TotalValue && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-700">
                    Milestone payment schedule (7 stages) will be auto-generated from total value of ₹{Number(form.TotalValue).toLocaleString("en-IN")}
                  </div>
                )}
              </div>

              {/* ── RIGHT: Booking / Payment ── */}
              <div className="rounded-lg border border-border p-2.5 space-y-2.5">
                <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Booking & Payment</p>
                <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_0.9fr] gap-2.5">
                  <div>
                    <label className={labelCls}>Booking Date</label>
                    <input type="date" value={form.BookingDate}
                      onChange={(e) => setForm((f) => ({ ...f, BookingDate: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Token Type</label>
                    {form.ApplicationId ? (
                      <input type="text" value={form.TokenType} readOnly disabled className={inputClsDisabled} />
                    ) : (
                      <Select value={form.TokenType} onValueChange={(v) => setForm((f) => ({ ...f, TokenType: v }))}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TOKEN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>
                      Token {form.TokenType === "Percentage" ? "(%)" : "(₹)"}
                    </label>
                    <input type="number" value={form.TokenValue}
                      onChange={(e) => setForm((f) => ({ ...f, TokenValue: e.target.value }))}
                      readOnly={!!form.ApplicationId && !!form.TokenValue} disabled={!!form.ApplicationId && !!form.TokenValue}
                      className={form.ApplicationId && form.TokenValue ? inputClsDisabled : inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Payment Plan (from the Application — not editable here)</label>
                  <input type="text" readOnly disabled
                    value={selectedPlan?.PlanName
                      || (apps as any[]).find((a: any) => String(a.Id) === form.ApplicationId)?.PaymentPlanName
                      || "Default 7-stage split"}
                    className={inputClsDisabled} />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelCls}>Payment Mode</label>
                    {form.ApplicationId && form.PaymentMode ? (
                      <input type="text" value={form.PaymentMode} readOnly disabled className={inputClsDisabled} />
                    ) : (
                      <Select value={form.PaymentMode || undefined} onValueChange={(v) => setForm((f) => ({ ...f, PaymentMode: v }))}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>
                      Deposited To{bankOptions.length > 0 ? " *" : ""}
                    </label>
                    <Select value={form.DepositBankId || undefined} onValueChange={(v) => setForm((f) => ({ ...f, DepositBankId: v }))}>
                      <SelectTrigger className={inputCls}>
                        <SelectValue placeholder="— Select bank —" />
                      </SelectTrigger>
                      <SelectContent>
                        {(bankOptions as any[]).map((b: any) => (
                          <SelectItem key={b.BId} value={String(b.BId)}>{b.BName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelCls}>
                      Booking Amount (₹) {selectedPlan ? "(Plan)" : ""}
                    </label>
                    <input type="number" value={form.BookingAmount}
                      onChange={(e) => setForm((f) => ({ ...f, BookingAmount: e.target.value }))}
                      readOnly={!!selectedPlan} disabled={!!selectedPlan}
                      placeholder={selectedPlan ? undefined : "From Payment Plan"}
                      className={selectedPlan ? inputClsDisabled : inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Assigned To</label>
                    {form.ApplicationId && form.AssignedTo ? (
                      <input type="text" readOnly disabled
                        value={users.find((u) => u.value === form.AssignedTo)?.label || "— Assigned on Application —"}
                        className={inputClsDisabled} />
                    ) : (
                      <Select value={form.AssignedTo || undefined} onValueChange={(v) => setForm((f) => ({ ...f, AssignedTo: v }))}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="— Unassigned —" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>
                Notes {form.ApplicationId && form.Notes ? "(from Application — add to it below if needed)" : ""}
              </label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className={`${inputCls} resize-none`} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, ApplicationId: appFilter }); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || (bankOptions.length > 0 && !form.DepositBankId)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
              {saving ? "Creating..." : "Create Booking"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Any close path for the booking-detail card — the X button, clicking
          outside, or pressing Escape — funnels through CrmBookingDetail's
          single onClose prop (its Dialog uses onOpenChange={(o) => !o &&
          onClose()}, which Radix fires for all three). So handling it once
          here covers all three. Besides clearing local state, drop the
          ?applicationId= param back to a plain /crm/bookings — leaving it
          in place kept the underlying list silently filtered to just this
          one application even after the card closed, and left a stale
          deep-link sitting in the address bar.
          Deliberately NOT resetting deepLinkOpened here — appFilter itself
          clears once the URL updates, so the auto-open effect's own
          `!appFilter` guard already covers it. Resetting deepLinkOpened
          too raced against that URL update: for one render, appFilter could
          still read the old id while deepLinkOpened had already flipped
          back to false, matching the effect's condition and reopening the
          same card immediately after it closed. */}
      {viewingBookingId && (
        <CrmBookingDetail
          bookingId={viewingBookingId}
          onClose={() => {
            setViewingBookingId(null);
            if (appFilter) navigate("/crm/bookings", { replace: true });
          }}
        />
      )}

      {unitChangeBooking && (
        <Dialog open onOpenChange={(o) => !o && setUnitChangeBooking(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2">
                <Repeat size={16} className="text-rose-500" /> Change Unit — {unitChangeBooking.BookingNo}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">New Unit</label>
                <select value={unitChangeNewId} onChange={(e) => setUnitChangeNewId(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— Select unit —</option>
                  {(units as any[])
                    .filter((u: any) => u.IsActive && u.Id !== unitChangeBooking.UnitId)
                    .map((u: any) => (
                      <option key={u.Id} value={u.Id}>{u.ProjectName} — {u.BlockName} — {u.UnitName}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Reason *</label>
                <textarea value={unitChangeReason} onChange={(e) => setUnitChangeReason(e.target.value)}
                  rows={3} placeholder="Reason for changing the unit..."
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setUnitChangeBooking(null)}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleChangeUnit} disabled={unitChangeSaving || !unitChangeNewId || !unitChangeReason.trim()}
                  className="px-4 py-1.5 text-sm bg-rose-500 text-white rounded-lg font-medium hover:bg-rose-600 disabled:opacity-40">
                  {unitChangeSaving ? "Changing..." : "Change Unit"}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </CrmShell>
  );
};

export default CrmBooking;
