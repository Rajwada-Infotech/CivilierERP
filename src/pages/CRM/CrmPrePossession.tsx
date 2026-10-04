import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, CheckSquare, Square, ClipboardCheck, ArrowRight,
  AlertCircle, CheckCircle2, Loader2,
  ShieldCheck, ShieldAlert, FileWarning, Building2,
  ChevronRight, Circle, CreditCard, Send, Check,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { CrmSideDrawer } from "@/components/crm/CrmSideDrawer";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const API = "/api/crm/pre-possession";

const MANUAL_CHECKS = [
  { key: "DocumentationCheck",     label: "Documentation Complete",      short: "Docs",    Icon: FileWarning },
  { key: "QualityInspectionCheck", label: "Quality Inspection Passed",   short: "Quality", Icon: ShieldCheck },
  { key: "UtilityReadinessCheck",  label: "Utility Readiness Confirmed", short: "Utility", Icon: Building2 },
] as const;

const STATUS_CONFIG: Record<string, { label: string; badge: string; accent: string }> = {
  Pending:    { label: "Pending",     badge: "bg-orange-50 text-orange-700 border-orange-200", accent: "border-l-orange-400" },
  InProgress: { label: "In Progress", badge: "bg-blue-50 text-blue-700 border-blue-200",       accent: "border-l-blue-500"   },
  Ready:      { label: "Ready",       badge: "bg-green-50 text-green-700 border-green-200",    accent: "border-l-green-500"  },
  Blocked:    { label: "Blocked",     badge: "bg-red-50 text-red-700 border-red-200",          accent: "border-l-red-500"    },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Fetchers (server-side paging) ─────────────────────────────────────────────
interface ListPage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchPage(url: string): Promise<ListPage> {
  const r = await fetchWithAuth(url);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}
const fetchChecks  = (q: CrmListQuery) => fetchPage(`${API}?${listParams(q)}`);
const fetchGateway = (q: CrmListQuery) => fetchPage(`${API}/gateway-status?${listParams(q)}`);
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

function getProgress(c: any) {
  const duesCleared = c.DuesClearedCheck === 1;
  const doneCount = (duesCleared ? 1 : 0) + MANUAL_CHECKS.filter((ch) => !!c[ch.key]).length;
  return { duesCleared, doneCount, pct: Math.round((doneCount / 4) * 100) };
}

// ── Four check indicators for the table row ──────────────────────────────────
function CheckDots({ c }: { c: any }) {
  const { duesCleared, doneCount } = getProgress(c);
  const items = [
    { label: "Dues", ok: duesCleared, bad: !duesCleared, Icon: CreditCard },
    ...MANUAL_CHECKS.map(({ key, short, Icon }) => ({ label: short, ok: !!c[key], bad: false, Icon })),
  ];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5">
        {items.map(({ label, ok, bad, Icon }) => (
          <span key={label} title={`${label}: ${ok ? "done" : bad ? "outstanding" : "pending"}`}
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center",
              ok ? "bg-green-100 text-green-700" : bad ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground/60",
            )}>
            <Icon size={11} />
          </span>
        ))}
      </span>
      <span className={cn("text-xs tabular-nums", doneCount === 4 ? "text-green-600 font-semibold" : "text-muted-foreground")}>{doneCount}/4</span>
    </span>
  );
}

// ── Drawer body: editable dates, checklist, notes ────────────────────────────
interface CheckDetailsProps {
  c: any;
  checkLoading: Record<string, boolean>;
  onToggle: (record: any, field: string, current: boolean) => void;
  onSaved: () => void;
  navigate: ReturnType<typeof useNavigate>;
}
function CheckDetails({ c, checkLoading, onToggle, onSaved, navigate }: CheckDetailsProps) {
  const [sdt,    setSdt]    = useState<string>(c.ScheduledInspectionDate?.slice(0, 10) ?? "");
  const [icd,    setIcd]    = useState<string>(c.InspectionCompletedDate?.slice(0, 10) ?? "");
  const [notes,  setNotes]  = useState<string>(c.Notes ?? "");
  const [saving, setSaving] = useState(false);

  // Patch a single field on blur so the user doesn't have to click Save
  const patch = async (body: Record<string, string | null>) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${c.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  const { duesCleared, doneCount, pct } = getProgress(c);
  const outstanding = c.OutstandingDemandCount ?? 0;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{doneCount} of 4 checks complete</span>
          <span className="flex items-center gap-1.5">
            {saving && <Loader2 size={11} className="animate-spin" />}
            <span className={pct === 100 ? "text-green-600 font-semibold" : ""}>{pct}%</span>
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500", pct === 100 ? "bg-green-500" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-1">
        <div className={cn("flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg", duesCleared ? "bg-green-50" : "bg-red-50")}>
          {duesCleared ? <CheckCircle2 size={15} className="text-green-600 shrink-0" /> : <AlertCircle size={15} className="text-red-500 shrink-0" />}
          <CreditCard size={12} className={cn("shrink-0", duesCleared ? "text-green-600" : "text-red-500")} />
          <span className={cn("flex-1 font-medium", duesCleared ? "text-green-700" : "text-red-700")}>Dues Cleared</span>
          <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            {duesCleared ? "Auto · all clear" : (
              <>
                {outstanding} outstanding
                <button onClick={() => navigate(`/crm/payments?bookingId=${c.BookingId}`)}
                  className="text-blue-600 hover:underline font-medium not-italic">View →</button>
              </>
            )}
          </span>
        </div>

        {MANUAL_CHECKS.map(({ key, label, Icon }) => {
          const isLoadingThis = !!checkLoading[`${c.Id}:${key}`];
          const isChecked = !!c[key];
          return (
            <button key={key} onClick={() => onToggle(c, key, isChecked)} disabled={isLoadingThis}
              className={cn(
                "flex items-center gap-2 text-sm w-full text-left rounded-lg px-2 py-1.5 transition-all disabled:opacity-60 disabled:cursor-wait",
                isChecked ? "bg-green-50 hover:bg-green-100" : "hover:bg-muted/60",
              )}>
              {isLoadingThis ? <Loader2 size={15} className="animate-spin text-muted-foreground shrink-0" />
                : isChecked ? <CheckSquare size={15} className="text-green-600 shrink-0" />
                : <Square size={15} className="text-muted-foreground shrink-0" />}
              <Icon size={12} className={cn("shrink-0", isChecked ? "text-green-600" : "text-muted-foreground")} />
              <span className={cn("font-medium", isChecked ? "text-green-700" : "text-foreground")}>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Inspection scheduled</label>
          <DateInput value={sdt} onChange={(e) => setSdt(e.target.value)}
            onBlur={(e) => patch({ ScheduledInspectionDate: e.target.value || null })}
            className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Inspection completed</label>
          <DateInput value={icd} onChange={(e) => setIcd(e.target.value)}
            onBlur={(e) => patch({ InspectionCompletedDate: e.target.value || null })}
            className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Notes</label>
        <textarea value={notes} rows={3} placeholder="Add inspection remarks…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => { if (e.target.value !== (c.Notes ?? "")) patch({ Notes: e.target.value || null }); }}
          className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </div>
  );
}

// ── Gateway helpers ───────────────────────────────────────────────────────────
// Gate 1 passes when the agreement is Registered; the first failing sub-step is
// what the user needs to fix. Gate 2 is the project/block OC/CC.
function gatewayNext(g: any): { label: string; path: string } | null {
  const id = g.BookingId;
  if (!g.Gate1_AfsRegistered) {
    if (!g.Gate0_AgreementExecuted)
      return { label: `Agreement not executed ${g.AgreementStatus ? `(${g.AgreementStatus})` : "(no agreement)"}`, path: `/crm/agreements?bookingId=${id}` };
    if (!g.Gate1a_AfsQueryPayment)
      return { label: `AFS payment not confirmed ${g.AfsQpStatus ? `(${g.AfsQpStatus})` : ""}`.trim(), path: `/crm/agreements?bookingId=${id}&tab=afs-payment` };
    if (!g.Gate1b_AfsRegistryCompleted)
      return { label: `Registry visit pending ${g.AfsRegStatus ? `(${g.AfsRegStatus})` : ""}`.trim(), path: `/crm/agreements?bookingId=${id}&tab=afs-registry` };
    return { label: "Agreement not registered", path: `/crm/agreements?bookingId=${id}` };
  }
  if (!g.Gate2_OcCcReceived) return { label: "OC/CC not received", path: "/crm/oc-cc" };
  return null;
}

function GateSteps({ g }: { g: any }) {
  const steps = [
    { label: "Agreement executed",   ok: !!g.Gate0_AgreementExecuted },
    { label: "AFS payment",          ok: !!g.Gate1a_AfsQueryPayment },
    { label: "Registry visit",       ok: !!g.Gate1b_AfsRegistryCompleted },
    { label: "Agreement registered", ok: !!g.Gate1_AfsRegistered },
    { label: "OC/CC received",       ok: !!g.Gate2_OcCcReceived },
  ];
  return (
    <span className="inline-flex items-center gap-1" aria-label="Gate progress">
      {steps.map((s) => (
        <span key={s.label} title={`${s.label}: ${s.ok ? "done" : "pending"}`}
          className={cn(
            "w-4 h-4 rounded-full flex items-center justify-center border",
            s.ok ? "bg-green-500 border-green-500 text-white" : "border-sky-400 bg-background",
          )}>
          {s.ok && <Check size={9} strokeWidth={3} />}
        </span>
      ))}
    </span>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────
interface CreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
  onViewGateway: () => void;
  prefillBookingId?: string;
}
function CreateDialog({ onClose, onCreated, onViewGateway, prefillBookingId }: CreateDialogProps) {
  const [bookingId, setBookingId] = useState(prefillBookingId ?? "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: eligible = [], isFetching } = useQuery({
    queryKey: ["crm-pre-possession-eligible"],
    queryFn: fetchEligibleBookings,
    staleTime: 0,
  });

  const handleCreate = async () => {
    if (!bookingId) { toast.error("Select a booking"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId), ScheduledInspectionDate: scheduledDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Pre-possession check started");
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent accent="crm" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Start Pre-Possession Check</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            {isFetching ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Loading eligible bookings…
              </p>
            ) : (eligible as any[]).length === 0 ? (
              <div className="text-xs bg-sky-50 border border-sky-200 rounded px-3 py-2.5 space-y-2">
                <p className="font-semibold text-sky-800 flex items-center gap-1.5">
                  <ShieldAlert size={13} /> No eligible bookings
                </p>
                <p className="text-sky-700">Both gates must pass before a check can be started:</p>
                <ul className="space-y-1 text-sky-700">
                  <li className="flex items-start gap-1.5">
                    <Circle size={5} className="mt-1.5 shrink-0 fill-sky-500 text-sky-500" />
                    <span><strong>Gate 1 — AFS Registered:</strong> AFS Query Payment confirmed → AFS Registry visit completed → Agreement marked Registered</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Circle size={5} className="mt-1.5 shrink-0 fill-sky-500 text-sky-500" />
                    <span><strong>Gate 2 — OC/CC Received:</strong> project must have a received occupancy certificate</span>
                  </li>
                </ul>
                <button onClick={() => { onClose(); onViewGateway(); }}
                  className="flex items-center gap-1 text-blue-600 hover:underline text-xs pt-0.5">
                  View Gateway Status — see which step is blocking each booking <ChevronRight size={11} />
                </button>
              </div>
            ) : (
              <SearchableNativeSelect value={bookingId} onChange={(e) => setBookingId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(eligible as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>
                    {b.BookingNo} — {b.ApplicantName} ({b.UnitNo})
                  </option>
                ))}
              </SearchableNativeSelect>
            )}
          </div>
          {(eligible as any[]).length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Scheduled Inspection Date</label>
              <DateInput value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button onClick={handleCreate}
            disabled={saving || !bookingId || (eligible as any[]).length === 0}
            className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
            {saving ? "Starting…" : "Start Check"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPrePossession: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  usePageRights("crm-pre-possession");

  const [createOpen,      setCreateOpen]      = useState(false);
  const [createPrefillId, setCreatePrefillId] = useState<string | undefined>(undefined);
  const [checkLoading,    setCheckLoading]    = useState<Record<string, boolean>>({});
  const [activeTab,       setActiveTab]       = useState<"checks" | "gateway">("checks");
  const [selectedId,      setSelectedId]      = useState<number | null>(null);

  // Each tab keeps its own page / sort / filters.
  const checks = useCrmListState({ pageSize: 25, defaultSort: { key: "Priority", dir: "asc" } });
  const gw     = useCrmListState({ pageSize: 25, defaultSort: { key: "BookingNo", dir: "asc" } });

  const checksQ = useQuery({ queryKey: ["crm-pre-possession", checks.query],         queryFn: () => fetchChecks(checks.query),  staleTime: 30_000 });
  const gwQ     = useQuery({ queryKey: ["crm-pre-possession-gateway", gw.query],     queryFn: () => fetchGateway(gw.query),     staleTime: 30_000 });
  const checksData = useSticky(checksQ.data);
  const gwData     = useSticky(gwQ.data);
  const checkRows  = checksData?.rows ?? [];
  const gwRows     = gwData?.rows ?? [];
  const cCounts    = checksData?.counts ?? {};
  const gCounts    = gwData?.counts ?? {};

  // The open drawer keeps its record even if a status filter drops the row after an edit.
  const snapRef = useRef<any>(null);
  const found = selectedId != null ? checkRows.find((r: any) => r.Id === selectedId) ?? null : null;
  if (found) snapRef.current = found;
  const selected = selectedId != null ? (found ?? (snapRef.current?.Id === selectedId ? snapRef.current : null)) : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-pre-possession"] });
    qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
    qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const toggleCheck = async (record: any, field: string, current: boolean) => {
    const loadKey = `${record.Id}:${field}`;
    if (checkLoading[loadKey]) return;
    setCheckLoading((prev) => ({ ...prev, [loadKey]: true }));
    try {
      const res = await fetchWithAuth(`${API}/${record.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      invalidate();
      if (data?.status === "Ready") {
        promptNextStep(navigate, "All checks cleared — ready to send the Possession Notice.", "/crm/possession-notice", "Go to Possession Notice");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setCheckLoading((prev) => ({ ...prev, [loadKey]: false }));
    }
  };

  const openCreate = (prefillId?: string) => { setCreatePrefillId(prefillId); setCreateOpen(true); };
  const handleRefresh = () => { checksQ.refetch(); gwQ.refetch(); };
  const sendNotice = (c: any) => navigate(`/crm/possession-notice?bookingId=${c.BookingId}&open=1`);

  // ── Checks table ──
  const checkTabs: CrmStatusTab[] = [
    { key: "All",        label: "All",         count: cCounts.All ?? 0 },
    { key: "Ready",      label: "Ready",       count: cCounts.Ready ?? 0,      dot: "bg-green-500"  },
    { key: "InProgress", label: "In Progress", count: cCounts.InProgress ?? 0, dot: "bg-blue-500"   },
    { key: "Pending",    label: "Pending",     count: cCounts.Pending ?? 0,    dot: "bg-orange-400" },
    { key: "Blocked",    label: "Blocked",     count: cCounts.Blocked ?? 0,    dot: "bg-red-500"    },
  ];
  const checkColumns: CrmColumn<any>[] = [
    { key: "applicant", header: "Applicant", sortKey: "ApplicantName", cell: (c) => (
      <span className="font-medium block truncate max-w-[220px]" title={c.ApplicantName}>{c.ApplicantName}</span>
    ) },
    { key: "booking", header: "Booking", sortKey: "BookingNo", className: "hidden md:table-cell",
      cell: (c) => <span className="text-xs text-muted-foreground whitespace-nowrap">{c.BookingNo}</span> },
    { key: "unit", header: "Unit", className: "hidden md:table-cell",
      cell: (c) => <span className="text-xs whitespace-nowrap">{c.UnitNo}</span> },
    { key: "status", header: "Status", sortKey: "Priority", cell: (c) => {
      const st = STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending;
      return <span className={cn("text-[0.6875rem] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap", st.badge)}>{st.label}</span>;
    } },
    { key: "checks", header: "Checks", cell: (c) => <CheckDots c={c} /> },
    { key: "scheduled", header: "Scheduled", sortKey: "ScheduledInspectionDate", className: "hidden lg:table-cell",
      cell: (c) => <span className="text-xs whitespace-nowrap">{fmtDate(c.ScheduledInspectionDate)}</span> },
    { key: "completed", header: "Completed", sortKey: "InspectionCompletedDate", className: "hidden xl:table-cell",
      cell: (c) => <span className="text-xs whitespace-nowrap">{fmtDate(c.InspectionCompletedDate)}</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: (c) => (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {c.Status === "Ready" && (
          <button onClick={() => sendNotice(c)}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors whitespace-nowrap">
            <Send size={11} /> Send notice
          </button>
        )}
        <button onClick={() => setSelectedId(c.Id)} aria-label="Open check"
          className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronRight size={15} />
        </button>
      </div>
    ) },
  ];

  // ── Gateway table ──
  const gwTabs: CrmStatusTab[] = [
    { key: "All",      label: "All",             count: gCounts.All ?? 0 },
    { key: "Eligible", label: "Eligible to start", count: gCounts.Eligible ?? 0, dot: "bg-green-500" },
  ];
  const gwColumns: CrmColumn<any>[] = [
    { key: "booking", header: "Booking", sortKey: "BookingNo", cell: (g) => <span className="font-medium whitespace-nowrap">{g.BookingNo}</span> },
    { key: "applicant", header: "Applicant", sortKey: "ApplicantName", cell: (g) => (
      <span className="block truncate max-w-[220px]" title={g.ApplicantName}>{g.ApplicantName}</span>
    ) },
    { key: "unit", header: "Unit", sortKey: "UnitNo", className: "hidden md:table-cell",
      cell: (g) => <span className="text-xs whitespace-nowrap">{g.UnitNo}</span> },
    { key: "steps", header: "Gates", className: "hidden sm:table-cell", cell: (g) => <GateSteps g={g} /> },
    { key: "waiting", header: "Waiting on", cell: (g) => {
      const next = gatewayNext(g);
      return next
        ? <span className="text-xs text-amber-700 whitespace-nowrap">{next.label}</span>
        : <span className="text-xs text-green-700 font-medium">Ready to start</span>;
    } },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: (g) => {
      const next = gatewayNext(g);
      return next ? (
        <button onClick={() => navigate(next.path)}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border border-border text-foreground hover:bg-muted transition-colors whitespace-nowrap">
          Fix <ChevronRight size={11} />
        </button>
      ) : (
        <button onClick={() => openCreate(String(g.BookingId))}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap">
          <Plus size={11} /> Start
        </button>
      );
    } },
  ];

  const checksOnboarding = !checksQ.isLoading && !checksQ.isError && (cCounts.All ?? 0) === 0 && !checks.hasFilters;
  const st = selected ? (STATUS_CONFIG[selected.Status] ?? STATUS_CONFIG.Pending) : null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Pre-Possession Check"]} />
      <CrmShell
        title="Pre-Possession Check"
        subtitle="All four checks must pass before a Possession Notice can be sent"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={checksQ.dataUpdatedAt} isFetching={checksQ.isFetching || gwQ.isFetching} onRefresh={handleRefresh} />
            <button onClick={() => openCreate()}
              className="flex items-center gap-1.5 px-3 py-1.5 btn-module text-white text-sm font-medium rounded-lg ">
              <Plus size={14} /> Start Check
            </button>
          </div>
        }
      >
        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {([
            { key: "checks",  label: "Checks",          count: cCounts.All ?? 0 },
            { key: "gateway", label: "Awaiting gates",  count: gwQ.isLoading ? undefined : (gCounts.All ?? 0) },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}>
              {t.label} <span className="tabular-nums opacity-70">{t.count ?? "—"}</span>
            </button>
          ))}
        </div>

        {/* ── Checks ── */}
        {activeTab === "checks" && (
          checksOnboarding ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                <ClipboardCheck size={22} className="text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">No active checks</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  A check can be started once the Agreement is Registered and the project's OC / CC is received.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setActiveTab("gateway")} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  View awaiting gates <ChevronRight size={14} />
                </button>
                <button onClick={() => openCreate()} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  Start Check <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <CrmListToolbar tabs={checkTabs} status={checks.status} onStatus={checks.setStatus}
                searchValue={checks.searchInput} onSearch={checks.setSearchInput}
                placeholder="Search applicant, booking, unit, mobile…">
                <CrmCompanyProjectBlockFilter value={checks.cpb} onChange={checks.setCpb} />
              </CrmListToolbar>
              <CrmDataTable
                columns={checkColumns} rows={checkRows} rowKey={(c) => c.Id}
                loading={checksQ.isLoading} fetching={checksQ.isFetching}
                error={checksQ.isError ? (checksQ.error as Error)?.message : null} onRetry={() => checksQ.refetch()}
                sort={checks.sort} onSort={checks.toggleSort}
                onRowClick={(c) => setSelectedId(c.Id)} activeKey={selectedId}
                rowAccent={(c) => (STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending).accent}
                empty={<>No checks match these filters. <button onClick={checks.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
                page={checks.page} pageSize={checks.pageSize} total={checksData?.total ?? 0} onPage={checks.setPage}
              />
            </div>
          )
        )}

        {/* ── Awaiting gates ── */}
        {activeTab === "gateway" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              A check can start once the agreement is registered (executed → AFS payment → registry visit → registered) and the OC/CC is received.
              Hover the dots to see each step.
            </p>
            <CrmListToolbar tabs={gwTabs} status={gw.status} onStatus={gw.setStatus}
              searchValue={gw.searchInput} onSearch={gw.setSearchInput}
              placeholder="Search booking, applicant, unit, mobile…">
              <CrmCompanyProjectBlockFilter value={gw.cpb} onChange={gw.setCpb} />
            </CrmListToolbar>
            <CrmDataTable
              columns={gwColumns} rows={gwRows} rowKey={(g) => g.BookingId}
              loading={gwQ.isLoading} fetching={gwQ.isFetching}
              error={gwQ.isError ? (gwQ.error as Error)?.message : null} onRetry={() => gwQ.refetch()}
              sort={gw.sort} onSort={gw.toggleSort}
              rowAccent={(g) => (gatewayNext(g) ? "border-l-sky-400" : "border-l-green-500")}
              empty={gw.hasFilters
                ? <>No bookings match these filters. <button onClick={gw.reset} className="text-primary hover:underline ml-1">Clear filters</button></>
                : <span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-green-600" /> All bookings have been through the gates.</span>}
              page={gw.page} pageSize={gw.pageSize} total={gwData?.total ?? 0} onPage={gw.setPage}
            />
          </div>
        )}
      </CrmShell>

      {/* Detail / edit drawer */}
      <CrmSideDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.ApplicantName ?? ""}
        subtitle={selected ? `${selected.BookingNo} · ${selected.UnitNo}` : undefined}
        badge={st && <span className={cn("text-[0.6875rem] px-2 py-0.5 rounded-full border font-semibold", st.badge)}>{st.label}</span>}
        footer={selected?.Status === "Ready" ? (
          <button onClick={() => sendNotice(selected)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
            <Send size={14} /> Send Possession Notice
          </button>
        ) : undefined}
      >
        {selected && (
          <CheckDetails key={`${selected.Id}_${selected.Status}_${selected.ScheduledInspectionDate ?? ""}_${selected.InspectionCompletedDate ?? ""}`} c={selected} checkLoading={checkLoading}
            onToggle={toggleCheck} onSaved={invalidate} navigate={navigate} />
        )}
      </CrmSideDrawer>

      {/* Dialogs */}
      {createOpen && (
        <CreateDialog
          prefillBookingId={createPrefillId}
          onClose={() => { setCreateOpen(false); setCreatePrefillId(undefined); }}
          onCreated={invalidate}
          onViewGateway={() => setActiveTab("gateway")}
        />
      )}
    </>
  );
};

export default CrmPrePossession;