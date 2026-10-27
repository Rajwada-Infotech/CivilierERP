import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ExternalLink, X, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { localDay } from "./salesDeed/config";

const API = "/api/crm/parking";
const APP_API = "/api/crm/applications";
const EMPTY_FORM = { ApplicationId: "", BlockId: "", ParkingMasterId: "", ParkingSlotId: "", Notes: "", RateOverride: "" };
const PAYMENT_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Bank Transfer", "DD"];
const RELEASE_ROLES = ["super_admin"];
const DIALOG = "rounded-none p-5 gap-4";
const SEL = `${INP} text-sm`;

const inr = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const formatDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

interface Allotment {
  Id: number; BookingId: number | null; ApplicationId: number | null; BookingNo: string | null; BookingStatus: string | null;
  BookingGrandTotal: number | null; BookingTotalPaid: number | null; ApplicantName: string | null; Mobile: string | null;
  CurrentParkingType: string; SlotNo: string | null; ParkingSlotNo: string | null; Quantity: number; RateSnapshot: number | null;
  GstRateSnapshot: number | null; GstAmount: number | null; TotalAmount: number;
  PaymentStatus: typeof CrmStatus.PENDING | typeof CrmStatus.PAID; ReceiptNo: string | null; PaymentMode: string | null;
  PaymentReceivedDate: string | null; Notes: string | null; CreatedAt: string | null;
}
interface AvailableRate {
  ParkingMasterId: number | null; ParkingType: string; Charge: number | null; GstRate: number;
  AvailableSlots: { Id: number; SlotNo: string }[]; NeedsRate?: boolean;
}

// Not paginated: the standalone pending / collected totals are worked out over the whole set (as on Demands);
// company / project / block narrow it on the server.
async function fetchAllotments(cpb: CrmCompanyProjectBlockValue): Promise<Allotment[]> {
  const params = new URLSearchParams();
  if (cpb.companyId) params.set("companyId", cpb.companyId);
  if (cpb.projectId) params.set("projectId", cpb.projectId);
  if (cpb.blockId) params.set("blockId", cpb.blockId);
  const r = await fetchWithAuth(`${API}${params.toString() ? `?${params}` : ""}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the parking allotments.");
  return Array.isArray(d) ? d : [];
}
async function fetchApplications(): Promise<any[]> {
  const r = await fetchWithAuth(`${APP_API}?includeConverted=1`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the applications.");
  return Array.isArray(d) ? d : [];
}
async function fetchBlocks(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/block-master"); return r.ok ? r.json() : []; } catch { return []; }
}
// The rates for a project (+ block) with the slots that are actually free: not allotted, not under anyone's hold.
async function fetchAvailable(projectId: number, blockId?: string): Promise<AvailableRate[]> {
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (blockId) params.set("blockId", blockId);
  const r = await fetchWithAuth(`${API}/available?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the parking slots.");
  return d?.rates || [];
}

function bookingCollectedPct(a: Allotment): number {
  const total = Number(a.BookingGrandTotal || 0);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((Number(a.BookingTotalPaid || 0) / total) * 100));
}
function AllotmentMark({ a }: { a: Allotment }) {
  if (a.BookingId != null) return <SheetMark text="With booking" tone="done" />;
  return a.PaymentStatus === CrmStatus.PAID ? <SheetMark text="Paid" tone="done" /> : <SheetMark text="Payment pending" tone="waiting" />;
}

// ── One allotment ─────────────────────────────────────────────────────────────

function DetailDialog({ a, canPay, canRelease, onClose, onMarkPaid, onRequestRelease, navigate }: {
  a: Allotment; canPay: boolean; canRelease: boolean; onClose: () => void; onMarkPaid: (mode: string, date: string) => Promise<void>;
  onRequestRelease: (a: Allotment) => void; navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState("");
  const [date, setDate] = useState(localDay());
  const [paying, setPaying] = useState(false);
  const isLinked = a.BookingId != null;
  const pct = bookingCollectedPct(a);
  const handlePay = async () => {
    setPaying(true);
    try { await onMarkPaid(mode, date); } catch (e: any) { toast.error(translateError(e.message)); } finally { setPaying(false); }
  };
  const cell = (l: string, v: React.ReactNode, num = false) => (
    <div className="px-3 py-2">
      <div className={LBL}>{l}</div>
      <div className={`mt-1 text-sm ${num ? "font-heading tabular-nums" : "font-medium"}`}>{v}</div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`max-w-lg max-h-[90vh] overflow-y-auto ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading">{a.ApplicantName || "—"}</DialogTitle>
          <DialogDescription className="text-xs flex items-center gap-3 flex-wrap tabular-nums">
            {a.Mobile || "—"} <AllotmentMark a={a} />
          </DialogDescription>
        </DialogHeader>

        <div style={{ border: RULE_SOFT }}>
          <div className="grid grid-cols-2" style={{ borderBottom: RULE_SOFT }}>
            {cell("Type", a.CurrentParkingType)}
            <div style={{ borderLeft: RULE_SOFT }}>{cell("Slot", a.SlotNo || a.ParkingSlotNo || "—", true)}</div>
          </div>
          <div className="grid grid-cols-3" style={{ borderBottom: RULE_SOFT }}>
            {cell("Base rate", inr(a.RateSnapshot), true)}
            <div style={{ borderLeft: RULE_SOFT }}>{cell(`GST${a.GstRateSnapshot ? ` (${a.GstRateSnapshot}%)` : ""}`, inr(a.GstAmount), true)}</div>
            <div style={{ borderLeft: RULE_SOFT }}>{cell("Total", <b>{inr(a.TotalAmount)}</b>, true)}</div>
          </div>
          {a.Notes && <div style={{ borderBottom: RULE_SOFT }}>{cell("Notes", <span className="font-normal text-muted-foreground">{a.Notes}</span>)}</div>}
          {cell("Allotted on", formatDate(a.CreatedAt), true)}
        </div>

        {isLinked ? (
          <div style={{ border: RULE_SOFT }}>
            <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ borderBottom: RULE_SOFT }}>
              <button onClick={() => { onClose(); navigate(`/crm/bookings?view=${a.BookingId}`); }} className="font-heading text-sm font-semibold tabular-nums inline-flex items-center gap-1.5 hover:underline">
                {a.BookingNo} <ExternalLink size={11} />
              </button>
              {a.BookingStatus && <span className={LBL}>{a.BookingStatus}</span>}
            </div>
            {Number(a.BookingGrandTotal) > 0 && (
              <div className="px-3 py-3 space-y-1.5" style={{ borderBottom: RULE_SOFT }}>
                <div className="flex justify-between text-sm tabular-nums">
                  <span className="text-muted-foreground">Booking collected</span>
                  <span className="font-heading">{inr(a.BookingTotalPaid)} <span className="text-muted-foreground">of</span> {inr(a.BookingGrandTotal)}</span>
                </div>
                <div className="h-1.5" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
              </div>
            )}
            <p className="px-3 py-2 text-xs text-muted-foreground">Parking is in this booking's grand total and is collected through its milestones — open the booking to see or record payments.</p>
          </div>
        ) : a.PaymentStatus === CrmStatus.PAID ? (
          <div style={{ border: RULE_SOFT }}>
            <div className="px-3 py-2 text-sm font-semibold flex items-center gap-2" style={{ borderBottom: RULE_SOFT }}><CheckCircle2 size={14} /> Payment received</div>
            <div className="grid grid-cols-3">
              {cell("Receipt", a.ReceiptNo || "—", true)}
              <div style={{ borderLeft: RULE_SOFT }}>{cell("Mode", a.PaymentMode || "—")}</div>
              <div style={{ borderLeft: RULE_SOFT }}>{cell("Received", formatDate(a.PaymentReceivedDate), true)}</div>
            </div>
          </div>
        ) : canPay ? (
          <div className="p-3 space-y-3" style={{ border: RULE_SOFT }}>
            <div className="flex items-center justify-between">
              <span className={LBL}>Amount due</span>
              <span className="font-heading text-base font-bold tabular-nums">{inr(a.TotalAmount)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block mb-1 ${LBL}`}>Payment mode *</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={SEL}>
                  <option value="">Select mode</option>
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={`block mb-1 ${LBL}`}>Received on *</label>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} max={localDay()} className="!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-sm tabular-nums" />
              </div>
            </div>
            <button onClick={handlePay} disabled={paying || !mode || !date} className={`${KEY_INK} h-9 w-full`}>
              <CheckCircle2 size={13} /> {paying ? "Recording…" : `Record payment — ${inr(a.TotalAmount)}`}
            </button>
            <p className="text-[0.6875rem] text-muted-foreground text-center">A receipt number is given on recording.</p>
          </div>
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground" style={{ border: RULE_SOFT }}>Payment pending — {inr(a.TotalAmount)}.</p>
        )}

        {canRelease && (
          <div className="p-3 space-y-2" style={{ border: "1px solid hsl(var(--destructive) / 0.4)", borderLeft: "3px solid hsl(var(--destructive))" }}>
            <div className={`${LBL} !text-destructive flex items-center gap-1.5`}><ShieldAlert size={12} /> Release</div>
            <p className="text-xs text-muted-foreground">
              Frees the slot back to inventory.{isLinked && " The booking's grand total and milestones are recalculated."}
              {a.PaymentStatus === CrmStatus.PAID && " This allotment is paid — release is blocked."}
            </p>
            {a.PaymentStatus !== CrmStatus.PAID && (
              <button onClick={() => onRequestRelease(a)} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}>Release…</button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const CrmParkingBooking: React.FC = () => {
  const rights = usePageRights("crm-parking-booking");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const canRelease = RELEASE_ROLES.includes(currentUser?.role ?? "");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "Pending" | "Paid">("");
  const [linkFilter, setLinkFilter] = useState<"" | "linked" | "standalone">("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Allotment | null>(null);
  const [sp, setSp] = useSearchParams();
  const allotmentIdFilter = sp.get("allotmentId");
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  // Release — super admin only; a written reason and RELEASE typed
  const [releaseTarget, setReleaseTarget] = useState<Allotment | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseConfirmText, setReleaseConfirmText] = useState("");
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });

  const { data: allotments = [], isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-parking-all", cpb], queryFn: () => fetchAllotments(cpb), staleTime: 30_000, placeholderData: (prev) => prev,
  });

  // ?allotmentId= keeps the open allotment in the URL, so a refresh or a shared link comes back to it.
  const openAllotment = (a: Allotment) => { setSelected(a); setSp((p) => { p.set("allotmentId", String(a.Id)); return p; }, { replace: true }); };
  const closeAllotment = () => { setSelected(null); setSp((p) => { p.delete("allotmentId"); return p; }, { replace: true }); };
  useEffect(() => {
    if (!allotmentIdFilter || deepLinkDone || isLoading) return;
    const match = allotments.find((a) => String(a.Id) === allotmentIdFilter);
    if (match) { setDeepLinkDone(true); setSelected(match); }
    else setSp((p) => { p.delete("allotmentId"); return p; }, { replace: true });
  }, [allotmentIdFilter, deepLinkDone, allotments, isLoading, setSp]);

  const { data: applications = [], isError: appsError, error: appsErr } = useQuery({
    queryKey: ["crm-applications-dropdown"], queryFn: fetchApplications, staleTime: 60_000, enabled: newDialogOpen,
  });
  const { data: blocks = [] } = useQuery({ queryKey: ["block-master"], queryFn: fetchBlocks, staleTime: 5 * 60_000, enabled: newDialogOpen });
  // The sale is in the application's own project (the server refuses any other), so the project comes from it.
  const app = (applications as any[]).find((a) => String(a.Id) === form.ApplicationId);
  const projectId: number | null = app?.ProjectId ?? null;
  const { data: rates = [], isLoading: ratesLoading, isError: ratesError, error: ratesErr } = useQuery({
    queryKey: ["crm-parking-available", projectId, form.BlockId],
    queryFn: () => fetchAvailable(projectId as number, form.BlockId),
    enabled: newDialogOpen && projectId != null,
  });
  const blocksForProject = useMemo(() => (blocks as any[]).filter((b: any) => projectId != null && String(b.ProjectId) === String(projectId)), [blocks, projectId]);
  const sellable = (rates as AvailableRate[]).filter((r) => r.ParkingMasterId != null);
  const selectedRate = sellable.find((r) => String(r.ParkingMasterId) === form.ParkingMasterId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allotments.filter((a) => {
      const matchSearch = !q || [a.ApplicantName, a.Mobile, a.BookingNo, a.SlotNo || a.ParkingSlotNo].some((v) => String(v || "").toLowerCase().includes(q));
      // Pending / Paid only applies to standalone rows — unit-linked parking is paid with its booking.
      const matchStatus = !statusFilter || a.BookingId != null || a.PaymentStatus === statusFilter;
      const matchLink = !linkFilter || (linkFilter === "linked" ? a.BookingId != null : a.BookingId == null);
      return matchSearch && matchStatus && matchLink;
    });
  }, [allotments, search, statusFilter, linkFilter]);

  const standalone = allotments.filter((a) => a.BookingId == null);
  const standalonePending = standalone.filter((a) => a.PaymentStatus !== CrmStatus.PAID);
  const standalonePaid = standalone.filter((a) => a.PaymentStatus === CrmStatus.PAID);
  const sum = (list: Allotment[]) => list.reduce((s, a) => s + Number(a.TotalAmount || 0), 0);
  const linkedCount = allotments.length - standalone.length;

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setNewDialogOpen(false); };
  const handleCreate = async () => {
    if (!form.ApplicationId) { toast.error("Select the customer's application"); return; }
    if (!form.ParkingMasterId) { toast.error("Select a parking type"); return; }
    if (!form.ParkingSlotId) { toast.error("Select a slot"); return; }
    if (form.RateOverride !== "" && !(Number(form.RateOverride) >= 0)) { toast.error("Enter a valid rate"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/standalone`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: form.ApplicationId, ParkingMasterId: form.ParkingMasterId, ParkingSlotId: parseInt(form.ParkingSlotId, 10),
          Quantity: 1, Notes: form.Notes || null, Immediate: true, ...(form.RateOverride ? { RateOverride: form.RateOverride } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking allotted — ${inr(data.TotalAmount)}`);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
      qc.invalidateQueries({ queryKey: ["crm-parking-available"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (mode: string, date: string) => {
    if (!selected) return;
    const res = await fetchWithAuth(`${API}/${selected.Id}/mark-paid`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ PaymentMode: mode || null, ReceivedDate: date || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not record the payment");
    toast.success(`Payment recorded — receipt ${data.ReceiptNo}`);
    closeAllotment();
    qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
  };

  const closeRelease = () => { setReleaseTarget(null); setReleaseReason(""); setReleaseConfirmText(""); };
  const handleRelease = async () => {
    if (!releaseTarget) return;
    const reason = releaseReason.trim();
    if (!reason) { toast.error("A reason is required"); return; }
    if (releaseConfirmText.toUpperCase() !== "RELEASE") { toast.error("Type RELEASE to confirm"); return; }
    setReleaseSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${releaseTarget.Id}?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Release failed"); return; }
      toast.success(data.pending
        ? "Amendment queued — the legal documents are under verification, so it needs sign-off before the slot is released."
        : "Parking released and the slot returned to inventory");
      closeRelease();
      closeAllotment();
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
    } catch (e: any) {
      toast.error(e.message || "Network error");
    } finally {
      setReleaseSaving(false);
    }
  };

  const figures = [
    { label: "Standalone pending", value: inr(sum(standalonePending)), note: `${standalonePending.length} to collect`, onClick: () => { setLinkFilter("standalone"); setStatusFilter("Pending"); }, red: standalonePending.length > 0 },
    { label: "Standalone collected", value: inr(sum(standalonePaid)), note: `${standalonePaid.length} paid`, onClick: () => { setLinkFilter("standalone"); setStatusFilter("Paid"); } },
    { label: "With a unit booking", value: String(linkedCount), note: "Paid through the booking", onClick: () => { setLinkFilter("linked"); setStatusFilter(""); } },
    { label: "All allotments", value: String(allotments.length), note: "In these company / project / block", onClick: () => { setLinkFilter(""); setStatusFilter(""); } },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";
  const LINK_TABS = [
    { k: "" as const, l: "All", n: allotments.length },
    { k: "linked" as const, l: "Unit-linked", n: linkedCount },
    { k: "standalone" as const, l: "Standalone", n: standalone.length },
  ];
  const STATUS_TABS = [
    { k: "" as const, l: "Any payment" },
    { k: "Pending" as const, l: "Pending", n: standalonePending.length },
    { k: "Paid" as const, l: "Paid", n: standalonePaid.length },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Parking Booking"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Parking Allotments"
        subtitle="Every allotted parking slot: sold on its own to a customer (collected here), or with a unit booking (collected through the booking)."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setNewDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New standalone sale</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={x.onClick} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {LINK_TABS.map((t) => (
                    <button key={t.k || "all"} onClick={() => setLinkFilter(t.k)} className={tabClass(linkFilter === t.k)} style={{ borderRight: RULE_SOFT }}>
                      {t.l} <span className="tabular-nums">{t.n}</span>
                    </button>
                  ))}
                </div>
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {STATUS_TABS.map((t) => (
                    <button key={t.k || "any"} onClick={() => setStatusFilter(t.k)} className={tabClass(statusFilter === t.k)} style={{ borderRight: RULE_SOFT }}>
                      {t.l} {t.n != null && <span className="tabular-nums">{t.n}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, mobile, booking no, slot…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
                {(statusFilter || linkFilter || search) && (
                  <button onClick={() => { setStatusFilter(""); setLinkFilter(""); setSearch(""); }} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Customer</th><th className={th}>Booking</th><th className={th}>Parking · slot</th>
                    <th className={`${th} !text-right`}>Amount</th><th className={th}>State</th><th className={th}>Allotted</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={6} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>{allotments.length ? "No allotment matches." : "No parking allotted yet."}</td></tr>
                  ) : filtered.map((a) => {
                    const pct = bookingCollectedPct(a);
                    return (
                      <tr key={a.Id} onClick={() => openAllotment(a)} className="align-top cursor-pointer hover:bg-primary/5 transition-colors"
                        style={{ borderBottom: RULE_SOFT, boxShadow: a.BookingId == null && a.PaymentStatus !== CrmStatus.PAID ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
                        <td className={td}>
                          <div className="text-xs font-medium"><ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} /></div>
                          {a.Mobile && <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{a.Mobile}</div>}
                        </td>
                        <td className={td}>
                          {a.BookingNo ? (
                            <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/bookings?view=${a.BookingId}`); }} className="font-heading text-xs tabular-nums inline-flex items-center gap-1 hover:underline">
                              {a.BookingNo} <ExternalLink size={10} />
                            </button>
                          ) : <span className="text-xs text-muted-foreground">Standalone</span>}
                        </td>
                        <td className={td}>
                          <div className="text-xs">{a.CurrentParkingType}</div>
                          <div className="mt-1 font-heading text-[0.6875rem] text-muted-foreground tabular-nums">{a.SlotNo || a.ParkingSlotNo || "—"}</div>
                        </td>
                        <td className={`${td} text-right font-heading font-semibold tabular-nums`}>{inr(a.TotalAmount)}</td>
                        <td className={td}>
                          <AllotmentMark a={a} />
                          {a.BookingId != null && Number(a.BookingGrandTotal) > 0 && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="w-20 h-1" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
                              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{pct}% of booking</span>
                            </div>
                          )}
                        </td>
                        <td className={`${td} text-xs text-muted-foreground tabular-nums whitespace-nowrap`}>{formatDate(a.CreatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selected && (
          <DetailDialog a={selected} canPay={rights.canEdit} canRelease={canRelease} onClose={closeAllotment} onMarkPaid={handleMarkPaid}
            onRequestRelease={(a) => { setReleaseTarget(a); closeAllotment(); }} navigate={navigate} />
        )}

        <Dialog open={!!releaseTarget} onOpenChange={(o) => { if (!o) closeRelease(); }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Release slot {releaseTarget?.SlotNo || releaseTarget?.ParkingSlotNo || "—"}?</DialogTitle>
              <DialogDescription className="text-xs">
                {releaseTarget?.CurrentParkingType} allotted to {releaseTarget?.ApplicantName}.
                {releaseTarget?.BookingId != null && " The booking's grand total and milestones are recalculated."} It can't be undone without allotting again.
              </DialogDescription>
            </DialogHeader>
            <div>
              <label className={`block mb-1 ${LBL}`}>Reason *</label>
              <textarea value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="Recorded in the audit trail." rows={3} className={TEXTAREA} autoFocus />
            </div>
            <div>
              <label className={`block mb-1 ${LBL}`}>Type RELEASE to confirm</label>
              <input value={releaseConfirmText} onChange={(e) => setReleaseConfirmText(e.target.value)} placeholder="RELEASE" className={`${INP} font-heading tracking-[0.1em]`} />
            </div>
            <DialogFooter className="gap-2">
              <button onClick={closeRelease} disabled={releaseSaving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleRelease} disabled={releaseSaving || !releaseReason.trim() || releaseConfirmText.toUpperCase() !== "RELEASE"} className={`${KEY_RED} h-9 px-4`}>
                {releaseSaving ? "Releasing…" : "Release"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={newDialogOpen} onOpenChange={(o) => { if (!o) resetForm(); }}>
          <DialogContent className={`max-w-lg max-h-[90vh] overflow-y-auto ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">New standalone parking sale</DialogTitle>
              <DialogDescription className="text-xs">Sells parking to a customer with no unit booking. To add parking to a unit booking, open that booking's Details tab.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className={`block mb-1 ${LBL}`}>Customer's application *</label>
                <SearchableNativeSelect value={form.ApplicationId} searchPlaceholder="Search name, mobile, application no…"
                  onChange={(e) => setForm((f) => ({ ...EMPTY_FORM, ApplicationId: e.target.value, Notes: f.Notes }))} className={SEL}>
                  <option value="">Select application</option>
                  {/* A plot (land) sale has no parking, so its applications aren't offered. */}
                  {(applications as any[]).filter((a: any) => !a.IsPlotSale).map((a: any) => (
                    <option key={a.Id} value={String(a.Id)}>{`${a.ApplicantName || "—"} — ${a.Mobile || "—"} (${a.ApplicationNo})`}</option>
                  ))}
                </SearchableNativeSelect>
                {appsError && <p className="mt-1 text-xs text-destructive">{(appsErr as Error)?.message}</p>}
              </div>
              {app && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={`mb-1 ${LBL}`}>Project</div>
                    <div className="h-9 flex items-center text-sm font-medium" title="From the application">{app.ProjectMasterName || (projectId != null ? `Project #${projectId}` : "— (the application has no project)")}</div>
                  </div>
                  <div>
                    <label className={`block mb-1 ${LBL}`}>Block</label>
                    <select value={form.BlockId} onChange={(e) => setForm((f) => ({ ...f, BlockId: e.target.value, ParkingMasterId: "", ParkingSlotId: "", RateOverride: "" }))} className={SEL} disabled={projectId == null}>
                      <option value="">Any block</option>
                      {blocksForProject.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.Name || b.BlockName}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {projectId != null && (
                ratesError ? (
                  <p className="text-xs text-destructive">{(ratesErr as Error)?.message}</p>
                ) : ratesLoading ? (
                  <p className="text-xs text-muted-foreground">Loading parking types…</p>
                ) : sellable.length === 0 ? (
                  <p className="px-3 py-2 text-xs" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    No parking rate is set for this project{form.BlockId ? " / block" : ""}. Set one up in Parking Master before selling.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block mb-1 ${LBL}`}>Parking type *</label>
                      <select value={form.ParkingMasterId} className={SEL}
                        onChange={(e) => {
                          const r = sellable.find((x) => String(x.ParkingMasterId) === e.target.value);
                          setForm((f) => ({ ...f, ParkingMasterId: e.target.value, ParkingSlotId: "", RateOverride: r?.Charge != null ? String(r.Charge) : "" }));
                        }}>
                        <option value="">Select type</option>
                        {sellable.map((r) => (
                          <option key={r.ParkingMasterId} value={String(r.ParkingMasterId)} disabled={r.AvailableSlots.length === 0}>
                            {`${r.ParkingType} — ${inr(r.Charge)} + ${r.GstRate}% GST ${r.AvailableSlots.length ? `(${r.AvailableSlots.length} free)` : "— full"}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block mb-1 ${LBL}`}>Slot *</label>
                      <select value={form.ParkingSlotId} onChange={(e) => setForm((f) => ({ ...f, ParkingSlotId: e.target.value }))} disabled={!selectedRate} className={`${SEL} disabled:opacity-50`}>
                        <option value="">{selectedRate ? "Select slot" : "Pick a type first"}</option>
                        {(selectedRate?.AvailableSlots || []).map((s) => <option key={s.Id} value={String(s.Id)}>{s.SlotNo}</option>)}
                      </select>
                    </div>
                  </div>
                )
              )}
              {selectedRate && (() => {
                const effectiveRate = form.RateOverride !== "" ? Number(form.RateOverride) || 0 : Number(selectedRate.Charge || 0);
                const gst = Math.round(effectiveRate * selectedRate.GstRate) / 100;
                return (
                  <>
                    <div>
                      <label className={`block mb-1 ${LBL}`}>Rate (₹)</label>
                      <input type="number" min={0} value={form.RateOverride} onChange={(e) => setForm((f) => ({ ...f, RateOverride: e.target.value }))}
                        placeholder={String(selectedRate.Charge ?? "")} className={`${INP} tabular-nums`} />
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">The master rate is {inr(selectedRate.Charge)}; change it only for a price agreed with this customer.</p>
                    </div>
                    <div className="text-sm" style={{ border: RULE_SOFT }}>
                      {[["Base amount", inr(effectiveRate)], [`GST (${selectedRate.GstRate}%)`, inr(gst)]].map(([l, v]) => (
                        <div key={l} className="flex justify-between px-3 py-1.5" style={{ borderBottom: RULE_SOFT }}><span className="text-muted-foreground">{l}</span><span className="font-heading tabular-nums">{v}</span></div>
                      ))}
                      <div className="flex justify-between px-3 py-2 font-semibold"><span>Total payable</span><span className="font-heading tabular-nums">{inr(effectiveRate + gst)}</span></div>
                    </div>
                  </>
                );
              })()}
              <div>
                <label className={`block mb-1 ${LBL}`}>Notes</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} className={TEXTAREA} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={resetForm} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.ApplicationId || !form.ParkingMasterId || !form.ParkingSlotId} className={`${KEY_INK} h-9 px-4`}>
                {saving ? "Allotting…" : "Allot parking"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmParkingBooking;
