// CRM Parking Allotments (/crm/parking-booking): enterprise ledger for standalone parking sales,
// collection of pending standalone dues, release workflows, and tracking unit-linked parking allotments.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Car, CheckCircle2, Download, ExternalLink, Grid3X3, Plus,
  RefreshCw, ShieldAlert, Wallet,
} from "lucide-react";
import { CrmStatus } from "@/constants/crmStatuses";
import { sumMoney } from "@/lib/crmPriceQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { useCanApprove } from "@/hooks/useCanApprove";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import {
  CrmGrid, GRID_BTN, GRID_CARD, GRID_KEY, GRID_KEY_BRAND, GridColumnChooser,
  GridGuidance, GridHighlights, GridSearch, GridTabs, GridToneMark, exportGrid,
  useGridPrefs, type GridCol,
} from "@/components/crm/CrmDataTable";
import { cn, naturalCompare } from "@/lib/utils";
import { Initials, asName } from "./payments/parts";
import { localDay } from "./salesDeed/config";
import { MATRIX_BTN, MATRIX_BTN_BRAND, MATRIX_BTN_DANGER, MATRIX_INP, MATRIX_TEXTAREA } from "./matrix/shared";

const API = "/api/crm/parking";
const APP_API = "/api/crm/applications";
const EMPTY_FORM = { ApplicationId: "", BlockId: "", ParkingMasterId: "", ParkingSlotId: "", Notes: "", RateOverride: "" };
const PAYMENT_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Bank Transfer", "DD"];

type ViewTab = "all" | "pending" | "paid" | "linked" | "standalone";

const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";
const TONE_PRIMARY_PILL = "bg-primary/15 border-primary/30 text-primary [[data-theme]_&]:bg-primary/10 [[data-theme]_&]:border-primary/25";

const inr = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const formatDate = (s: string | null | undefined) =>
  (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

interface Allotment {
  Id: number;
  BookingId: number | null;
  ApplicationId: number | null;
  BookingNo: string | null;
  BookingStatus: string | null;
  BookingGrandTotal: number | null;
  BookingTotalPaid: number | null;
  ApplicantName: string | null;
  Mobile: string | null;
  CurrentParkingType: string;
  SlotNo: string | null;
  ParkingSlotNo: string | null;
  Quantity: number;
  RateSnapshot: number | null;
  GstRateSnapshot: number | null;
  GstAmount: number | null;
  TotalAmount: number;
  PaymentStatus: typeof CrmStatus.PENDING | typeof CrmStatus.PAID | string;
  ReceiptNo: string | null;
  PaymentMode: string | null;
  PaymentReceivedDate: string | null;
  Notes: string | null;
  CreatedAt: string | null;
}

interface AvailableRate {
  ParkingMasterId: number | null;
  ParkingType: string;
  Charge: number | null;
  GstRate: number;
  AvailableSlots: { Id: number; SlotNo: string }[];
  NeedsRate?: boolean;
}

interface AppOption {
  Id: number;
  ApplicationNo: string;
  ApplicantName: string | null;
  Mobile: string | null;
  ProjectId: number | null;
  ProjectMasterName?: string | null;
  IsPlotSale?: boolean | number;
}

interface BlockOption {
  Id: number;
  ProjectId: number;
  Name?: string;
  BlockName?: string;
}

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

async function fetchApplications(): Promise<AppOption[]> {
  const r = await fetchWithAuth(`${APP_API}?includeConverted=1`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the applications.");
  return Array.isArray(d) ? d : [];
}

async function fetchBlocks(): Promise<BlockOption[]> {
  try {
    const r = await fetchWithAuth("/api/block-master");
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

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

function allotmentStateLabel(a: Allotment): string {
  if (a.BookingId != null) return "With Booking";
  return a.PaymentStatus === CrmStatus.PAID ? "Paid" : "Payment Pending";
}

function slotCodeOf(a: Allotment): string {
  return a.SlotNo || a.ParkingSlotNo || "—";
}

// ─── Allotment Inspection, Payment Collection & Release Modal ────────────────
function DetailDialog({
  a, canPay, canRelease, onClose, onMarkPaid, onRequestRelease, navigate,
}: {
  a: Allotment;
  canPay: boolean;
  canRelease: boolean;
  onClose: () => void;
  onMarkPaid: (mode: string, date: string) => Promise<void>;
  onRequestRelease: (a: Allotment) => void;
  navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState("");
  const [date, setDate] = useState(localDay());
  const [paying, setPaying] = useState(false);
  const isLinked = a.BookingId != null;
  const isPaid = a.PaymentStatus === CrmStatus.PAID;
  const pct = bookingCollectedPct(a);

  const handlePay = async () => {
    setPaying(true);
    try {
      await onMarkPaid(mode, date);
    } catch (e: unknown) {
      toast.error(translateError(errMessage(e, "Could not record the payment.")));
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
        <DialogHeader className="sr-only">
          <DialogTitle>Parking allotment {slotCodeOf(a)}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <GridHighlights
            icon={Car}
            object={`${a.CurrentParkingType || "Parking"} · ${isLinked ? "Unit-linked" : "Standalone Sale"}`}
            title={<span className="capitalize">{asName(a.ApplicantName)}</span>}
            status={
              <GridToneMark
                tone={isLinked || isPaid ? "done" : "waiting"}
                text={allotmentStateLabel(a)}
              />
            }
            sub={`Slot ${slotCodeOf(a)}${a.BookingNo ? ` · ${a.BookingNo}` : ""}${a.Mobile ? ` · ${a.Mobile}` : ""}`}
            actions={
              <div className="pr-8 flex items-center gap-2">
                {a.BookingId != null ? (
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(`/crm/bookings?view=${a.BookingId}`); }}
                    className={`${MATRIX_BTN} text-foreground`}
                  >
                    <ExternalLink size={12} /> Booking
                  </button>
                ) : a.ApplicationId != null ? (
                  <Link
                    to={`/crm/applications?id=${a.ApplicationId}`}
                    className={`${MATRIX_BTN} text-foreground`}
                  >
                    <ExternalLink size={12} /> Application
                  </Link>
                ) : null}
              </div>
            }
            fields={[
              { label: "Slot", value: <span className="font-mono">{slotCodeOf(a)}</span> },
              { label: "Parking type", value: a.CurrentParkingType || "—" },
              { label: "Base rate", value: inr(a.RateSnapshot) },
              { label: `GST${a.GstRateSnapshot ? ` (${a.GstRateSnapshot}%)` : ""}`, value: inr(a.GstAmount) },
              { label: "Total charge", value: inr(a.TotalAmount) },
              { label: "Allotted on", value: formatDate(a.CreatedAt) },
            ]}
          />

          {a.Notes && (
            <div className="rounded-lg border border-border bg-muted/25 px-3.5 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {a.Notes}
            </div>
          )}

          {/* Unit-linked Booking Progress Card */}
          {isLinked ? (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => { onClose(); navigate(`/crm/bookings?view=${a.BookingId}`); }}
                  className="font-semibold font-mono text-foreground inline-flex items-center gap-1.5 hover:text-primary hover:underline cursor-pointer"
                >
                  <span>{a.BookingNo}</span>
                  <ExternalLink size={11} />
                </button>
                {a.BookingStatus && (
                  <span className="text-[0.6875rem] font-medium text-muted-foreground">{a.BookingStatus}</span>
                )}
              </div>

              <div className="p-4 space-y-3">
                {Number(a.BookingGrandTotal) > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="text-muted-foreground">Booking collected</span>
                      <span className="font-medium text-foreground">
                        {inr(a.BookingTotalPaid)} <span className="text-muted-foreground">of</span> {inr(a.BookingGrandTotal)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                <GridGuidance
                  tone="moving"
                  title="Collected via booking payment schedule"
                  text="This parking charge is rolled into the unit booking's grand total and milestones. Open the booking to record or inspect payments."
                />
              </div>
            </div>
          ) : isPaid ? (
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2 text-xs font-semibold text-foreground">
                <CheckCircle2 size={14} className={TONE_EMERALD_TEXT} />
                <span>Payment Received</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 text-xs">
                <div>
                  <div className="text-muted-foreground">Receipt No.</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5 tabular-nums">{a.ReceiptNo || "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Payment mode</div>
                  <div className="font-medium text-foreground mt-0.5">{a.PaymentMode || "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Received date</div>
                  <div className="font-medium text-foreground mt-0.5 tabular-nums">{formatDate(a.PaymentReceivedDate)}</div>
                </div>
              </div>
            </section>
          ) : canPay ? (
            <section className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-amber-500/20 flex items-center justify-between gap-2 text-xs">
                <span className={cn("font-semibold", TONE_AMBER_TEXT)}>Collect Standalone Payment</span>
                <span className="font-bold text-foreground tabular-nums text-sm">{inr(a.TotalAmount)} due</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground block">
                      Payment mode <span className="text-destructive">*</span>
                    </span>
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger className="h-9 text-xs bg-card border-border rounded-lg">
                        <SelectValue placeholder="Select mode…" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground block">
                      Received on <span className="text-destructive">*</span>
                    </span>
                    <DateInput
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      max={localDay()}
                      className="h-9 rounded-lg border-border bg-card px-2.5 text-xs tabular-nums"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[0.6875rem] text-muted-foreground">
                    Generates a PARK receipt number and posts automatically to the ledger.
                  </span>
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={paying || !mode || !date}
                    className={MATRIX_BTN_BRAND}
                  >
                    <CheckCircle2 size={13} />
                    <span>{paying ? "Recording…" : `Record payment · ${inr(a.TotalAmount)}`}</span>
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <GridGuidance
              tone="waiting"
              title="Standalone payment pending"
              text={`Amount due: ${inr(a.TotalAmount)}. You don't have permission to record payment here.`}
            />
          )}

          {/* Release Slot Zone (restricted by CRM Parking Release approval setup) */}
          {canRelease && (
            <section className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <ShieldAlert size={13} />
                  <span>Release Slot Back to Inventory</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isPaid
                    ? "This allotment is paid — release is blocked."
                    : isLinked
                      ? "Frees the slot and recalculates the booking's grand total and remaining milestones."
                      : "Returns this standalone slot to available inventory."}
                </p>
              </div>
              {!isPaid && (
                <button
                  type="button"
                  onClick={() => onRequestRelease(a)}
                  className={MATRIX_BTN_DANGER}
                >
                  Release slot…
                </button>
              )}
            </section>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Parking Allotments Page ────────────────────────────────────────────
const CrmParkingBooking: React.FC = () => {
  const rights = usePageRights("crm-parking-booking");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canRelease = useCanApprove("crm-parking-release");

  const [sp, setSp] = useSearchParams();
  const allotmentIdFilter = sp.get("allotmentId");
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const [tab, setTab] = useState<ViewTab>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpbRaw] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [sort, setSort] = useState<CrmSort>({ key: "CreatedAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Allotment | null>(null);

  const [releaseTarget, setReleaseTarget] = useState<Allotment | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseConfirmText, setReleaseConfirmText] = useState("");
  const [releaseSaving, setReleaseSaving] = useState(false);

  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

  const { data: allotments = [], isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-parking-all", cpb],
    queryFn: () => fetchAllotments(cpb),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const openAllotment = useCallback((a: Allotment) => {
    setSelected(a);
    setSp((p) => { p.set("allotmentId", String(a.Id)); return p; }, { replace: true });
  }, [setSp]);
  const closeAllotment = useCallback(() => {
    setSelected(null);
    setSp((p) => { p.delete("allotmentId"); return p; }, { replace: true });
  }, [setSp]);

  useEffect(() => {
    if (!allotmentIdFilter || deepLinkDone || isLoading) return;
    const match = allotments.find((a) => String(a.Id) === allotmentIdFilter);
    if (match) {
      setDeepLinkDone(true);
      setSelected(match);
    } else {
      setSp((p) => { p.delete("allotmentId"); return p; }, { replace: true });
    }
  }, [allotmentIdFilter, deepLinkDone, allotments, isLoading, setSp]);

  // New Standalone Sale dropdown queries (lazy loaded when modal opens)
  const { data: applications = [], isError: appsError, error: appsErr } = useQuery({
    queryKey: ["crm-applications-dropdown"],
    queryFn: fetchApplications,
    staleTime: 60_000,
    enabled: newDialogOpen,
  });
  const { data: blocks = [] } = useQuery({
    queryKey: ["block-master"],
    queryFn: fetchBlocks,
    staleTime: 5 * 60_000,
    enabled: newDialogOpen,
  });
  const selectedApp = applications.find((a) => String(a.Id) === form.ApplicationId);
  const formProjectId = selectedApp?.ProjectId ?? null;
  const { data: rates = [], isLoading: ratesLoading, isError: ratesError, error: ratesErr } = useQuery({
    queryKey: ["crm-parking-available", formProjectId, form.BlockId],
    queryFn: () => fetchAvailable(formProjectId as number, form.BlockId),
    enabled: newDialogOpen && formProjectId != null,
  });

  const blocksForProject = useMemo(
    () => blocks.filter((b) => formProjectId != null && String(b.ProjectId) === String(formProjectId)),
    [blocks, formProjectId],
  );
  const sellableRates = useMemo(() => rates.filter((r) => r.ParkingMasterId != null), [rates]);
  const selectedRate = sellableRates.find((r) => String(r.ParkingMasterId) === form.ParkingMasterId);

  const parkingTypes = useMemo(() => {
    const set = new Set<string>();
    for (const a of allotments) if (a.CurrentParkingType) set.add(a.CurrentParkingType);
    return Array.from(set).sort(naturalCompare);
  }, [allotments]);

  const matchesSearchAndType = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (a: Allotment) => {
      if (typeFilter !== "all" && a.CurrentParkingType !== typeFilter) return false;
      if (q) {
        const hay = [a.ApplicantName, a.Mobile, a.BookingNo, a.SlotNo, a.ParkingSlotNo, a.CurrentParkingType, a.ReceiptNo]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
  }, [typeFilter, search]);

  const metrics = useMemo(() => {
    const scoped = allotments.filter(matchesSearchAndType);
    const standalone = scoped.filter((a) => a.BookingId == null);
    const pending = standalone.filter((a) => a.PaymentStatus !== CrmStatus.PAID);
    const paid = standalone.filter((a) => a.PaymentStatus === CrmStatus.PAID);
    const linked = scoped.filter((a) => a.BookingId != null);
    return {
      scopedCount: scoped.length,
      standaloneCount: standalone.length,
      pendingCount: pending.length,
      pendingSum: sumMoney(pending, (a) => a.TotalAmount),
      paidCount: paid.length,
      paidSum: sumMoney(paid, (a) => a.TotalAmount),
      linkedCount: linked.length,
      linkedSum: sumMoney(linked, (a) => a.TotalAmount),
    };
  }, [allotments, matchesSearchAndType]);

  const filtered = useMemo(() => {
    return allotments.filter((a) => {
      if (!matchesSearchAndType(a)) return false;
      if (tab === "pending") return a.BookingId == null && a.PaymentStatus !== CrmStatus.PAID;
      if (tab === "paid") return a.BookingId == null && a.PaymentStatus === CrmStatus.PAID;
      if (tab === "linked") return a.BookingId != null;
      if (tab === "standalone") return a.BookingId == null;
      return true;
    });
  }, [allotments, matchesSearchAndType, tab]);

  const invalidateAllParking = () => {
    ["crm-parking-all", "crm-parking-available", "parking-matrix"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  };

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setNewDialogOpen(false); };
  const handleCreate = async () => {
    if (!form.ApplicationId) return void toast.error("Select the customer's application");
    if (!form.ParkingMasterId) return void toast.error("Select a parking type");
    if (!form.ParkingSlotId) return void toast.error("Select a slot");
    if (form.RateOverride !== "" && (!Number.isFinite(Number(form.RateOverride)) || Number(form.RateOverride) <= 0)) {
      return void toast.error("Rate override must be a positive amount");
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/standalone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: form.ApplicationId,
          ParkingMasterId: form.ParkingMasterId,
          ParkingSlotId: parseInt(form.ParkingSlotId, 10),
          Quantity: 1,
          Notes: form.Notes.trim() || null,
          Immediate: true,
          ...(form.RateOverride ? { RateOverride: Number(form.RateOverride) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create standalone parking sale.");
      toast.success(`Parking allotted — ${inr(data.TotalAmount)}`);
      resetForm();
      invalidateAllParking();
    } catch (e: unknown) {
      toast.error(translateError(errMessage(e, "Could not create standalone parking sale.")));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (mode: string, date: string) => {
    if (!selected) return;
    const res = await fetchWithAuth(`${API}/${selected.Id}/mark-paid`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ PaymentMode: mode || null, ReceivedDate: date || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not record the payment");
    toast.success(`Payment recorded — receipt ${data.ReceiptNo}`);
    closeAllotment();
    invalidateAllParking();
  };

  const closeRelease = () => { setReleaseTarget(null); setReleaseReason(""); setReleaseConfirmText(""); };
  const handleRelease = async () => {
    if (!releaseTarget) return;
    const reason = releaseReason.trim();
    if (!reason) return void toast.error("A reason is required");
    if (releaseConfirmText.toUpperCase() !== "RELEASE") return void toast.error("Type RELEASE to confirm");
    setReleaseSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${releaseTarget.Id}?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(translateError(data.error || "Release failed"));
        return;
      }
      toast.success(data.pending
        ? "Amendment queued — legal documents are under verification, so this release awaits approval."
        : "Parking released and slot returned to inventory");
      closeRelease();
      closeAllotment();
      invalidateAllParking();
    } catch (e: unknown) {
      toast.error(translateError(errMessage(e, "Network error")));
    } finally {
      setReleaseSaving(false);
    }
  };

  // ── Table Columns & Sorting ────────────────────────────────────────────────
  const cols: GridCol<Allotment>[] = useMemo(() => [
    {
      id: "customer",
      label: "Customer",
      sortKey: "ApplicantName",
      locked: true,
      csv: (a) => a.ApplicantName || "",
      cell: (a) => (
        <div className="flex items-center gap-2.5 min-w-0 max-w-[260px] py-0.5">
          <Initials name={a.ApplicantName} />
          <div className="min-w-0">
            <div className="text-[0.8125rem] font-medium text-foreground capitalize truncate">
              <ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} />
            </div>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums truncate">
              {a.Mobile || "No mobile"}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "slot",
      label: "Parking · Slot",
      sortKey: "SlotNo",
      csv: (a) => `${a.CurrentParkingType || ""} ${slotCodeOf(a)}`,
      cell: (a) => (
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-medium text-foreground">
            {a.CurrentParkingType || "Parking"}{a.Quantity > 1 ? ` ×${a.Quantity}` : ""}
          </div>
          <div className="text-[0.6875rem] font-mono text-muted-foreground tabular-nums mt-0.5">
            {slotCodeOf(a)}
          </div>
        </div>
      ),
    },
    {
      id: "booking",
      label: "Allocation Mode",
      sortKey: "BookingNo",
      csv: (a) => a.BookingNo || "Standalone",
      cell: (a) => a.BookingNo ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(`/crm/bookings?view=${a.BookingId}`); }}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[0.6875rem] font-mono font-medium text-foreground hover:border-primary/45 hover:text-primary transition-colors cursor-pointer"
        >
          <span>{a.BookingNo}</span>
          <ExternalLink size={10} />
        </button>
      ) : (
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_PRIMARY_PILL)}>
          Standalone
        </span>
      ),
    },
    {
      id: "amount",
      label: "Amount",
      sortKey: "TotalAmount",
      align: "right",
      csv: (a) => a.TotalAmount ?? "",
      cell: (a) => (
        <div className="text-right leading-tight">
          <div className="text-[0.8125rem] font-semibold text-foreground tabular-nums">{inr(a.TotalAmount)}</div>
          {a.RateSnapshot != null && (
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">
              {inr(a.RateSnapshot)}{a.GstRateSnapshot ? ` + ${a.GstRateSnapshot}%` : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "state",
      label: "Collection State",
      sortKey: "State",
      csv: (a) => allotmentStateLabel(a),
      cell: (a) => {
        const pct = bookingCollectedPct(a);
        if (a.BookingId != null) {
          return (
            <div className="min-w-[130px] leading-tight">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> With Booking
              </span>
              {Number(a.BookingGrandTotal) > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="w-20 h-1.5 rounded-full bg-muted overflow-hidden inline-block">
                    <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{pct}%</span>
                </div>
              )}
            </div>
          );
        }
        if (a.PaymentStatus === CrmStatus.PAID) {
          return (
            <div className="leading-tight">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Paid
              </span>
              {a.ReceiptNo && (
                <div className="text-[0.6875rem] font-mono text-muted-foreground mt-0.5 tabular-nums">{a.ReceiptNo}</div>
              )}
            </div>
          );
        }
        return (
          <div className="leading-tight">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_AMBER_PILL)}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Payment Pending
            </span>
          </div>
        );
      },
    },
    {
      id: "allotted",
      label: "Allotted On",
      sortKey: "CreatedAt",
      csv: (a) => (a.CreatedAt ? String(a.CreatedAt).slice(0, 10) : ""),
      cell: (a) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(a.CreatedAt)}</span>,
    },
    // Export / optional chooser columns
    { id: "base", label: "Base Rate", hiddenByDefault: true, align: "right", csv: (a) => a.RateSnapshot ?? "", cell: (a) => <span className="text-xs tabular-nums">{inr(a.RateSnapshot)}</span> },
    { id: "gst", label: "GST", hiddenByDefault: true, align: "right", csv: (a) => a.GstAmount ?? "", cell: (a) => <span className="text-xs tabular-nums">{inr(a.GstAmount)}</span> },
    { id: "receipt", label: "Receipt No.", hiddenByDefault: true, csv: (a) => a.ReceiptNo || "", cell: (a) => <span className="font-mono text-xs">{a.ReceiptNo || "—"}</span> },
    { id: "mode", label: "Payment Mode", hiddenByDefault: true, csv: (a) => a.PaymentMode || "", cell: (a) => <span className="text-xs">{a.PaymentMode || "—"}</span> },
    {
      id: "actions",
      label: "",
      align: "right",
      locked: true,
      cell: (a) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {a.BookingId == null && a.PaymentStatus !== CrmStatus.PAID && rights.canEdit ? (
            <button
              type="button"
              onClick={() => openAllotment(a)}
              className={`${GRID_BTN} !h-7 !px-2.5 text-xs`}
            >
              <Wallet size={12} /> Collect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAllotment(a)}
              className={`${GRID_BTN} !h-7 !px-2.5 text-xs`}
            >
              View
            </button>
          )}
        </div>
      ),
    },
  ], [navigate, rights.canEdit, openAllotment]);

  const [prefs, setPrefs] = useGridPrefs("crm-parking-booking-grid-v1", cols);

  const sortedRows = useMemo(() => {
    const dir = sort.dir === "desc" ? -1 : 1;
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "ApplicantName": cmp = naturalCompare(a.ApplicantName || "", b.ApplicantName || ""); break;
        case "SlotNo": cmp = naturalCompare(slotCodeOf(a), slotCodeOf(b)); break;
        case "BookingNo": cmp = naturalCompare(a.BookingNo || "Standalone", b.BookingNo || "Standalone"); break;
        case "TotalAmount": cmp = (Number(a.TotalAmount) || 0) - (Number(b.TotalAmount) || 0); break;
        case "State": cmp = naturalCompare(allotmentStateLabel(a), allotmentStateLabel(b)); break;
        default: cmp = (a.CreatedAt || "").localeCompare(b.CreatedAt || "");
      }
      return cmp * dir;
    });
    return list;
  }, [filtered, sort]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  const tabs = useMemo(() => [
    { key: "all" as ViewTab, label: "All Allotments", count: metrics.scopedCount },
    { key: "pending" as ViewTab, label: "Payment Pending", count: metrics.pendingCount },
    { key: "paid" as ViewTab, label: "Paid Standalone", count: metrics.paidCount },
    { key: "linked" as ViewTab, label: "Unit-linked", count: metrics.linkedCount },
    { key: "standalone" as ViewTab, label: "All Standalone", count: metrics.standaloneCount },
  ], [metrics]);

  const hasFilters = !!(search || tab !== "all" || typeFilter !== "all" || cpb.companyId || cpb.projectId || cpb.blockId);
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setTab("all");
    setTypeFilter("all");
    setCpbRaw({ companyId: "", projectId: "", blockId: "" });
    setPage(1);
  };

  return (
    <>
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Parking Booking", path: "/crm/parking-booking" }]} />

        {/* Enterprise Header Card */}
        <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Car size={13} className="text-primary" />
                <span>CRM · Finance &amp; Parking Sales</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Parking Allotments</h1>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[82ch]">
                Collect payments on standalone parking sales, create new direct allotments, or track unit-linked parking across bookings.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className={cn(GRID_KEY, "h-9 w-9 !px-0")}
                title="Refresh allotments"
                aria-label="Refresh allotments"
              >
                <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              </button>
              {sortedRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    exportGrid(sortedRows, cols, "parking-allotments.csv");
                    toast.success(`Exported ${sortedRows.length} allotments`);
                  }}
                  className={GRID_BTN}
                >
                  <Download size={13} />
                  <span>Export CSV</span>
                </button>
              )}
              <button type="button" onClick={() => navigate("/crm/parking-matrix")} className={GRID_BTN}>
                <Grid3X3 size={13} />
                <span className="hidden sm:inline">Parking Matrix</span>
              </button>
              {rights.canCreate && (
                <button type="button" onClick={() => setNewDialogOpen(true)} className={`${GRID_KEY_BRAND} h-9 px-3.5`}>
                  <Plus size={14} />
                  <span>New standalone sale</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Clean Financial & Allocation KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => { setTab("pending"); setPage(1); }}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-left transition-all cursor-pointer hover:border-primary/40",
              tab === "pending" ? "border-amber-500/60 ring-1 ring-amber-500/25" : "border-border",
            )}
          >
            <div className="text-xs text-muted-foreground font-medium">Standalone pending</div>
            <div className={cn(
              "text-lg sm:text-xl font-bold tabular-nums mt-1",
              metrics.pendingCount > 0 ? TONE_AMBER_TEXT : "text-foreground",
            )}>
              {isLoading ? "…" : inr(metrics.pendingSum)}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">
              {metrics.pendingCount} {metrics.pendingCount === 1 ? "sale" : "sales"} to collect
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setTab("paid"); setPage(1); }}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-left transition-all cursor-pointer hover:border-primary/40",
              tab === "paid" ? "border-emerald-500/60 ring-1 ring-emerald-500/25" : "border-border",
            )}
          >
            <div className="text-xs text-muted-foreground font-medium">Standalone collected</div>
            <div className={cn(
              "text-lg sm:text-xl font-bold tabular-nums mt-1",
              metrics.paidCount > 0 ? TONE_EMERALD_TEXT : "text-foreground",
            )}>
              {isLoading ? "…" : inr(metrics.paidSum)}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">
              {metrics.paidCount} receipted
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setTab("linked"); setPage(1); }}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-left transition-all cursor-pointer hover:border-primary/40",
              tab === "linked" ? "border-primary/60 ring-1 ring-primary/25" : "border-border",
            )}
          >
            <div className="text-xs text-muted-foreground font-medium">With unit booking</div>
            <div className="text-lg sm:text-xl font-bold text-foreground tabular-nums mt-1">
              {isLoading ? "…" : metrics.linkedCount}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">
              {inr(metrics.linkedSum)} via bookings
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setTab("all"); setPage(1); }}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-left transition-all cursor-pointer hover:border-primary/40",
              tab === "all" ? "border-primary/60 ring-1 ring-primary/25" : "border-border",
            )}
          >
            <div className="text-xs text-muted-foreground font-medium">All allotments</div>
            <div className="text-lg sm:text-xl font-bold text-foreground tabular-nums mt-1">
              {isLoading ? "…" : metrics.scopedCount}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
              Active parking records
            </div>
          </button>
        </div>

        {/* Main Workspace Card */}
        <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
          <GridTabs
            tabs={tabs}
            active={tab}
            onChange={(k) => { setTab(k); setPage(1); }}
            label="Parking allotment views"
          />

          {/* Filter & Controls Toolbar */}
          <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2.5">
            <GridSearch
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Search customer, mobile, booking, slot, receipt…"
            />

            <CrmCompanyProjectBlockFilter
              value={cpb}
              onChange={(next) => { setCpbRaw(next); setPage(1); }}
            />

            {parkingTypes.length > 1 && (
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-[140px] text-xs bg-card border-border rounded-md">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {parkingTypes.map((pt) => (
                    <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasFilters && (
              <button type="button" onClick={clearFilters} className={GRID_BTN}>
                Clear
              </button>
            )}

            <div className="ml-auto">
              <GridColumnChooser cols={cols} prefs={prefs} onChange={setPrefs} />
            </div>
          </div>

          {isError ? (
            <div role="alert" className="py-14 px-4 text-center space-y-2">
              <p className="text-sm text-destructive">{translateError(errMessage(error, "Could not load parking allotments."))}</p>
              <button type="button" onClick={() => refetch()} className={GRID_BTN}>Try again</button>
            </div>
          ) : (
            <CrmGrid
              cols={cols}
              prefs={prefs}
              onPrefs={setPrefs}
              rows={pagedRows}
              rowKey={(a) => a.Id}
              loading={isLoading}
              fetching={isFetching}
              sort={sort}
              onSort={(k) => {
                setSort((prev) => (prev.key === k ? { key: k, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
                setPage(1);
              }}
              page={page}
              pageSize={pageSize}
              total={sortedRows.length}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
              onRowClick={openAllotment}
              empty={allotments.length ? "No parking allotments match these filters." : "No parking allotments recorded yet."}
              mobileCardRenderer={(a) => (
                <div
                  onClick={() => openAllotment(a)}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground capitalize truncate">
                        <ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.CurrentParkingType} · <span className="font-mono">{slotCodeOf(a)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tabular-nums text-foreground">{inr(a.TotalAmount)}</div>
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium mt-1",
                        a.BookingId != null ? "border-border bg-card text-foreground" : a.PaymentStatus === CrmStatus.PAID ? TONE_EMERALD_PILL : TONE_AMBER_PILL,
                      )}>
                        {allotmentStateLabel(a)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground pt-1 border-t border-border/60">
                    <span>{a.BookingNo || "Standalone sale"}</span>
                    <span className="tabular-nums">{formatDate(a.CreatedAt)}</span>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>

      {/* Allotment Detail / Payment Collection Dialog */}
      {selected && (
        <DetailDialog
          a={selected}
          canPay={rights.canEdit}
          canRelease={canRelease}
          onClose={closeAllotment}
          onMarkPaid={handleMarkPaid}
          onRequestRelease={(a) => { setReleaseTarget(a); closeAllotment(); }}
          navigate={navigate}
        />
      )}

      {/* Release Confirmation Dialog */}
      <Dialog open={!!releaseTarget} onOpenChange={(o) => { if (!o) closeRelease(); }}>
        <DialogContent className="max-w-md rounded-xl p-5 gap-4">
          <DialogHeader className="pr-8">
            <div className="flex items-center gap-2 text-xs text-destructive font-medium">
              <ShieldAlert size={13} />
              <span>Release Parking Slot</span>
            </div>
            <DialogTitle className="text-lg font-bold tabular-nums">
              Release slot {releaseTarget ? slotCodeOf(releaseTarget) : "—"}?
            </DialogTitle>
            <DialogDescription className="text-xs">
              {releaseTarget?.CurrentParkingType} allotted to <strong className="capitalize">{asName(releaseTarget?.ApplicantName)}</strong>.
              {releaseTarget?.BookingId != null ? " The booking's grand total and remaining milestones will be recalculated." : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">
                Reason <span className="text-destructive">*</span>
              </span>
              <textarea
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                placeholder="Recorded in the audit trail…"
                rows={3}
                className={MATRIX_TEXTAREA}
                autoFocus
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">
                Type <span className="font-mono font-semibold text-foreground">RELEASE</span> to confirm
              </span>
              <input
                value={releaseConfirmText}
                onChange={(e) => setReleaseConfirmText(e.target.value)}
                placeholder="RELEASE"
                className={`${MATRIX_INP} font-mono tracking-wider uppercase`}
              />
            </label>
          </div>

          <DialogFooter className="gap-2 pt-3 border-t border-border">
            <button type="button" onClick={closeRelease} disabled={releaseSaving} className={`${MATRIX_BTN} text-foreground`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRelease}
              disabled={releaseSaving || !releaseReason.trim() || releaseConfirmText.toUpperCase() !== "RELEASE"}
              className={MATRIX_BTN_DANGER}
            >
              {releaseSaving ? "Releasing…" : "Release slot"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Standalone Parking Sale Dialog */}
      <Dialog open={newDialogOpen} onOpenChange={(o) => { if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
          <DialogHeader className="pr-8">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Car size={13} className="text-primary" />
              <span>Standalone Parking Allotments</span>
            </div>
            <DialogTitle className="text-lg font-bold">New standalone parking sale</DialogTitle>
            <DialogDescription className="text-xs">
              Sells a specific slot on its own. To attach parking to a unit booking schedule, open that booking&apos;s Details tab.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">
                Customer&apos;s application <span className="text-destructive">*</span>
              </span>
              <SearchableSelect
                value={form.ApplicationId}
                onChange={(v) => setForm((f) => ({ ...EMPTY_FORM, ApplicationId: v, Notes: f.Notes }))}
                placeholder="Select application…"
                searchPlaceholder="Search name, mobile, application no…"
                options={applications
                  .filter((a) => !a.IsPlotSale)
                  .map((a) => ({
                    value: String(a.Id),
                    label: [a.ApplicantName || "—", a.Mobile || "—", a.ApplicationNo].join(" · "),
                  }))}
              />
              {appsError && <p className="text-xs text-destructive pt-0.5">{errMessage(appsErr, "Could not load applications.")}</p>}
            </label>

            {selectedApp && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3">
                <div>
                  <div className="text-[0.6875rem] font-medium text-muted-foreground">Project</div>
                  <div className="text-xs font-semibold text-foreground mt-1">
                    {selectedApp.ProjectMasterName || (formProjectId != null ? `Project #${formProjectId}` : "No project linked")}
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="text-[0.6875rem] font-medium text-muted-foreground block">Filter by block</span>
                  <Select
                    value={form.BlockId || "__any__"}
                    onValueChange={(v) => setForm((f) => ({ ...f, BlockId: v === "__any__" ? "" : v, ParkingMasterId: "", ParkingSlotId: "", RateOverride: "" }))}
                    disabled={formProjectId == null}
                  >
                    <SelectTrigger className="h-8 text-xs bg-card border-border rounded-md">
                      <SelectValue placeholder="Any block" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any block</SelectItem>
                      {blocksForProject.map((b) => (
                        <SelectItem key={b.Id} value={String(b.Id)}>{b.Name || b.BlockName || `Block #${b.Id}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
            )}

            {formProjectId != null && (
              ratesError ? (
                <p className="text-xs text-destructive">{errMessage(ratesErr, "Could not load available slots.")}</p>
              ) : ratesLoading ? (
                <p className="text-xs text-muted-foreground py-2">Loading available parking types &amp; slots…</p>
              ) : sellableRates.length === 0 ? (
                <GridGuidance
                  tone="waiting"
                  title="No parking rate configured"
                  text={`No parking rate is configured for this project${form.BlockId ? " / block" : ""}. Configure one in Parking Rates before selling.`}
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground block">
                      Parking type <span className="text-destructive">*</span>
                    </span>
                    <Select
                      value={form.ParkingMasterId}
                      onValueChange={(v) => {
                        const r = sellableRates.find((x) => String(x.ParkingMasterId) === v);
                        setForm((f) => ({
                          ...f,
                          ParkingMasterId: v,
                          ParkingSlotId: "",
                          RateOverride: r?.Charge != null ? String(r.Charge) : "",
                        }));
                      }}
                    >
                      <SelectTrigger className="h-9 text-xs bg-card border-border rounded-lg">
                        <SelectValue placeholder="Select type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {sellableRates.map((r) => (
                          <SelectItem
                            key={r.ParkingMasterId}
                            value={String(r.ParkingMasterId)}
                            disabled={r.AvailableSlots.length === 0}
                          >
                            {`${r.ParkingType} — ${inr(r.Charge)} + ${r.GstRate}% GST (${r.AvailableSlots.length ? `${r.AvailableSlots.length} free` : "full"})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground block">
                      Slot <span className="text-destructive">*</span>
                    </span>
                    <SearchableSelect
                      value={form.ParkingSlotId}
                      onChange={(v) => setForm((f) => ({ ...f, ParkingSlotId: v }))}
                      disabled={!selectedRate}
                      placeholder={selectedRate ? "Select free slot…" : "Pick a type first"}
                      searchPlaceholder="Search slot number…"
                      options={(selectedRate?.AvailableSlots || []).map((s) => ({
                        value: String(s.Id),
                        label: s.SlotNo,
                      }))}
                    />
                  </label>
                </div>
              )
            )}

            {selectedRate && (() => {
              const effectiveRate = form.RateOverride !== "" ? Number(form.RateOverride) || 0 : Number(selectedRate.Charge || 0);
              const gst = Math.round(effectiveRate * selectedRate.GstRate) / 100;
              return (
                <>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground block">Rate (₹)</span>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={form.RateOverride}
                      onChange={(e) => setForm((f) => ({ ...f, RateOverride: e.target.value }))}
                      placeholder={String(selectedRate.Charge ?? "")}
                      className={`${MATRIX_INP} tabular-nums`}
                    />
                    <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">
                      Master rate is {inr(selectedRate.Charge)}; edit only for a negotiated customer price.
                    </span>
                  </label>

                  <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border/70 text-xs">
                    <div className="flex justify-between px-3.5 py-2">
                      <span className="text-muted-foreground">Base amount</span>
                      <span className="font-medium tabular-nums text-foreground">{inr(effectiveRate)}</span>
                    </div>
                    <div className="flex justify-between px-3.5 py-2">
                      <span className="text-muted-foreground">GST ({selectedRate.GstRate}%)</span>
                      <span className="font-medium tabular-nums text-foreground">{inr(gst)}</span>
                    </div>
                    <div className="flex justify-between px-3.5 py-2.5 font-semibold text-sm text-foreground">
                      <span>Total payable</span>
                      <span className="tabular-nums">{inr(effectiveRate + gst)}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground block">Notes (optional)</span>
              <textarea
                value={form.Notes}
                onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2}
                placeholder="Optional remarks…"
                className={MATRIX_TEXTAREA}
              />
            </label>
          </div>

          <DialogFooter className="gap-2 pt-3 border-t border-border">
            <button type="button" onClick={resetForm} className={`${MATRIX_BTN} text-foreground`}>Cancel</button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving || !form.ApplicationId || !form.ParkingMasterId || !form.ParkingSlotId}
              className={MATRIX_BTN_BRAND}
            >
              {saving ? "Allotting…" : "Allot parking"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmParkingBooking;
