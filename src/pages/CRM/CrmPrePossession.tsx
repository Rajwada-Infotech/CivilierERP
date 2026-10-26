// CRM Pre-Possession Check: four checks before a Possession Notice can go out (dues cleared, which ticks itself, plus
// documentation, quality and utilities). A check can start once the agreement is registered and the OC / CC received;
// the "Awaiting gates" tab shows which step each other booking is stuck at.
import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, Building2, Check, CheckSquare, ChevronRight, ClipboardCheck, CreditCard, FileWarning, Loader2, Plus, RefreshCw,
  Send, ShieldAlert, ShieldCheck, Square,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { CrmSideDrawer } from "@/components/crm/CrmSideDrawer";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/pre-possession";

const MANUAL_CHECKS = [
  { key: "DocumentationCheck",     label: "Documentation complete",      short: "Docs",    Icon: FileWarning },
  { key: "QualityInspectionCheck", label: "Quality inspection passed",   short: "Quality", Icon: ShieldCheck },
  { key: "UtilityReadinessCheck",  label: "Utility readiness confirmed", short: "Utility", Icon: Building2 },
] as const;

// Ready is settled; in progress and pending are in hand; blocked has stopped. The row edge follows.
const STATUS_CONFIG: Record<string, { label: string; tone: "done" | "waiting" | "stopped"; accent: string }> = {
  Pending:    { label: "Pending",     tone: "waiting", accent: "border-l-foreground/20" },
  InProgress: { label: "In progress", tone: "waiting", accent: "border-l-foreground/50" },
  Ready:      { label: "Ready",       tone: "done",    accent: "border-l-foreground" },
  Blocked:    { label: "Blocked",     tone: "stopped", accent: "border-l-destructive" },
};

const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none disabled:bg-muted/30 disabled:border-foreground/20";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

interface ListPage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchPage(url: string): Promise<ListPage> {
  const r = await fetchWithAuth(url);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `Could not load (${r.status}).`); }
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

// Four square marks: solid done, red for dues outstanding, open pending.
function CheckDots({ c }: { c: any }) {
  const { duesCleared, doneCount } = getProgress(c);
  const items = [
    { label: "Dues", ok: duesCleared, bad: !duesCleared, Icon: CreditCard },
    ...MANUAL_CHECKS.map(({ key, short, Icon }) => ({ label: short, ok: !!c[key], bad: false, Icon })),
  ];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-0.5">
        {items.map(({ label, ok, bad, Icon }) => (
          <span key={label} title={`${label}: ${ok ? "done" : bad ? "outstanding" : "pending"}`}
            className={`w-5 h-5 flex items-center justify-center ${ok ? "bg-foreground text-card" : bad ? "bg-card text-destructive border border-destructive" : "bg-card text-muted-foreground border border-foreground/25"}`}>
            <Icon size={11} />
          </span>
        ))}
      </span>
      <span className={`font-heading text-xs font-bold tabular-nums ${doneCount === 4 ? "text-foreground" : "text-muted-foreground"}`}>{doneCount}/4</span>
    </span>
  );
}

// ── Drawer body: checklist, dates, notes ──────────────────────────────────────
function CheckDetails({ c, checkLoading, onToggle, onSaved, navigate, canEdit }: {
  c: any; checkLoading: Record<string, boolean>; onToggle: (record: any, field: string, current: boolean) => void;
  onSaved: () => void; navigate: ReturnType<typeof useNavigate>; canEdit: boolean;
}) {
  const [sdt, setSdt] = useState<string>(c.ScheduledInspectionDate?.slice(0, 10) ?? "");
  const [icd, setIcd] = useState<string>(c.InspectionCompletedDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState<string>(c.Notes ?? "");
  const [saving, setSaving] = useState(false);

  // Saves one field when it is left, and only when it changed (it saved on every blur).
  const patch = async (body: Record<string, string | null>) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${c.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      onSaved();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };
  const saveDate = (field: "ScheduledInspectionDate" | "InspectionCompletedDate", v: string, was: string) => {
    if (v === was) return;
    const other = field === "ScheduledInspectionDate" ? icd : sdt;
    if (v && other && (field === "InspectionCompletedDate" ? v < other : other < v)) return void toast.error("The inspection can't be completed before it was scheduled.");
    patch({ [field]: v || null });
  };

  const { duesCleared, doneCount, pct } = getProgress(c);
  const outstanding = c.OutstandingDemandCount ?? 0;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span className={LBL}>Checks</span>
          <span className="flex items-center gap-1.5 font-heading text-sm font-bold tabular-nums">
            {saving && <Loader2 size={11} className="animate-spin" />} {doneCount} of 4 · {pct}%
          </span>
        </div>
        <div className="h-2 w-full" style={{ border: RULE_SOFT }}>
          <div className="h-full bg-foreground transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div style={{ border: RULE }}>
        <div className="flex items-center gap-2 text-sm px-3 py-2.5" style={{ borderBottom: RULE_SOFT }}>
          {duesCleared ? <CheckSquare size={15} className="shrink-0" /> : <AlertCircle size={15} className="text-destructive shrink-0" />}
          <span className={`flex-1 font-medium ${duesCleared ? "" : "text-destructive"}`}>Dues cleared</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            {duesCleared ? "Automatic · all clear" : (
              <>
                <span className="tabular-nums">{outstanding} outstanding</span>
                <button onClick={() => navigate(`/crm/payments?bookingId=${c.BookingId}`)} className="font-semibold text-foreground hover:underline">Payments</button>
              </>
            )}
          </span>
        </div>
        {MANUAL_CHECKS.map(({ key, label, Icon }, i) => {
          const isLoadingThis = !!checkLoading[`${c.Id}:${key}`];
          const isChecked = !!c[key];
          return (
            <button key={key} onClick={() => onToggle(c, key, isChecked)} disabled={isLoadingThis || !canEdit}
              title={!canEdit ? "You don't have the right to change the checks." : undefined}
              className="flex items-center gap-2 text-sm w-full text-left px-3 py-2.5 transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              style={i < MANUAL_CHECKS.length - 1 ? { borderBottom: RULE_SOFT } : undefined}>
              {isLoadingThis ? <Loader2 size={15} className="animate-spin text-muted-foreground shrink-0" />
                : isChecked ? <CheckSquare size={15} className="shrink-0" /> : <Square size={15} className="text-muted-foreground shrink-0" />}
              <Icon size={12} className="shrink-0 text-muted-foreground" />
              <span className={`font-medium ${isChecked ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={`block ${LBL}`}>Inspection scheduled</span>
          <DateInput value={sdt} disabled={!canEdit} onChange={(e) => setSdt(e.target.value)}
            onBlur={(e) => saveDate("ScheduledInspectionDate", e.target.value, c.ScheduledInspectionDate?.slice(0, 10) ?? "")} className={INP} />
        </label>
        <label className="block space-y-1">
          <span className={`block ${LBL}`}>Inspection completed</span>
          <DateInput value={icd} disabled={!canEdit} onChange={(e) => setIcd(e.target.value)}
            onBlur={(e) => saveDate("InspectionCompletedDate", e.target.value, c.InspectionCompletedDate?.slice(0, 10) ?? "")} className={INP} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className={`block ${LBL}`}>Notes</span>
        <textarea value={notes} rows={3} placeholder="Inspection remarks" disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => { if (e.target.value !== (c.Notes ?? "")) patch({ Notes: e.target.value || null }); }}
          className={`${INP} h-auto py-2 resize-none`} />
      </label>
    </div>
  );
}

// Gate 1 passes when the agreement is registered; the first failing sub-step is what needs fixing. Gate 2 is OC / CC.
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
  if (!g.Gate2_OcCcReceived) return { label: "OC / CC not received", path: "/crm/oc-cc" };
  return null;
}

function GateSteps({ g }: { g: any }) {
  const steps = [
    { label: "Agreement executed",   ok: !!g.Gate0_AgreementExecuted },
    { label: "AFS payment",          ok: !!g.Gate1a_AfsQueryPayment },
    { label: "Registry visit",       ok: !!g.Gate1b_AfsRegistryCompleted },
    { label: "Agreement registered", ok: !!g.Gate1_AfsRegistered },
    { label: "OC / CC received",     ok: !!g.Gate2_OcCcReceived },
  ];
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Gate progress">
      {steps.map((s) => (
        <span key={s.label} title={`${s.label}: ${s.ok ? "done" : "pending"}`}
          className={`w-4 h-4 flex items-center justify-center ${s.ok ? "bg-foreground text-card" : "bg-card border border-foreground/30"}`}>
          {s.ok && <Check size={9} strokeWidth={3} />}
        </span>
      ))}
    </span>
  );
}

// ── Start dialog ──────────────────────────────────────────────────────────────
function CreateDialog({ onClose, onCreated, onViewGateway, prefillBookingId }: {
  onClose: () => void; onCreated: () => void; onViewGateway: () => void; prefillBookingId?: string;
}) {
  const [bookingId, setBookingId] = useState(prefillBookingId ?? "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: eligible = [], isFetching } = useQuery({ queryKey: ["crm-pre-possession-eligible"], queryFn: fetchEligibleBookings, staleTime: 0 });

  const handleCreate = async () => {
    if (!bookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId), ScheduledInspectionDate: scheduledDate || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the check.");
      toast.success("Pre-possession check started");
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">Start pre-possession check</DialogTitle></DialogHeader>
        {isFetching ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading eligible bookings…</p>
        ) : (eligible as any[]).length === 0 ? (
          <div className="text-xs px-3 py-2.5 space-y-2" style={{ border: RULE_SOFT }}>
            <p className="font-semibold flex items-center gap-1.5"><ShieldAlert size={13} /> No booking can start a check yet</p>
            <p className="text-muted-foreground">Both gates must pass first:</p>
            <ul className="space-y-1 text-muted-foreground list-disc pl-4">
              <li><strong className="text-foreground">Agreement registered:</strong> AFS payment confirmed, registry visit completed, agreement marked Registered.</li>
              <li><strong className="text-foreground">OC / CC received</strong> for the project or block.</li>
            </ul>
            <button onClick={() => { onClose(); onViewGateway(); }} className="font-semibold text-foreground hover:underline flex items-center gap-1">
              See where each booking is held <ChevronRight size={11} />
            </button>
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Booking *</span>
              {/* Plain text options: a component inside an option rendered no name. */}
              <SearchableSelect value={bookingId} onChange={setBookingId} placeholder="Select booking" searchPlaceholder="Search booking, customer or unit…"
                options={(eligible as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo].filter(Boolean).join(" · ") }))} />
            </label>
            <label className="block space-y-1">
              <span className={`block ${LBL}`}>Inspection scheduled for</span>
              <DateInput value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={INP} />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={handleCreate} disabled={saving || !bookingId || (eligible as any[]).length === 0} className={`${KEY_INK} h-9 px-4`}>{saving ? "Starting…" : "Start check"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPrePossession: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Starting needs the create right, ticking checks and dates the edit right (the server checks both; the page
  // offered them to anyone).
  const { canCreate, canEdit } = usePageRights("crm-pre-possession");

  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefillId, setCreatePrefillId] = useState<string | undefined>(undefined);
  const [checkLoading, setCheckLoading] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<"checks" | "gateway">("checks");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Each tab keeps its own page / sort / filters.
  const checks = useCrmListState({ pageSize: 25, defaultSort: { key: "Priority", dir: "asc" } });
  const gw = useCrmListState({ pageSize: 25, defaultSort: { key: "BookingNo", dir: "asc" } });
  const checksQ = useQuery({ queryKey: ["crm-pre-possession", checks.query], queryFn: () => fetchChecks(checks.query), staleTime: 30_000 });
  const gwQ = useQuery({ queryKey: ["crm-pre-possession-gateway", gw.query], queryFn: () => fetchGateway(gw.query), staleTime: 30_000 });
  const checksData = useSticky(checksQ.data);
  const gwData = useSticky(gwQ.data);
  const checkRows = checksData?.rows ?? [];
  const gwRows = gwData?.rows ?? [];
  const cCounts = checksData?.counts ?? {};
  const gCounts = gwData?.counts ?? {};

  // The open drawer keeps its record even if a status filter drops the row after an edit.
  const snapRef = useRef<any>(null);
  const found = selectedId != null ? checkRows.find((r: any) => r.Id === selectedId) ?? null : null;
  if (found) snapRef.current = found;
  const selected = selectedId != null ? (found ?? (snapRef.current?.Id === selectedId ? snapRef.current : null)) : null;

  const invalidate = () => ["crm-pre-possession", "crm-pre-possession-gateway", "crm-pre-possession-eligible", "crm-booking-lifecycle", "crm-dashboard", "crm-legal-milestones", "crm-possession-notice-eligible"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const toggleCheck = async (record: any, field: string, current: boolean) => {
    if (!canEdit) return;
    const loadKey = `${record.Id}:${field}`;
    if (checkLoading[loadKey]) return;
    setCheckLoading((prev) => ({ ...prev, [loadKey]: true }));
    try {
      const res = await fetchWithAuth(`${API}/${record.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: !current }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the check.");
      invalidate();
      if (data?.status === "Ready") promptNextStep(navigate, "All checks cleared: ready to send the Possession Notice.", "/crm/possession-notice", "Go to Possession Notice");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setCheckLoading((prev) => ({ ...prev, [loadKey]: false }));
    }
  };

  const openCreate = (prefillId?: string) => { setCreatePrefillId(prefillId); setCreateOpen(true); };
  const handleRefresh = () => { checksQ.refetch(); gwQ.refetch(); };
  const sendNotice = (c: any) => navigate(`/crm/possession-notice?bookingId=${c.BookingId}&open=1`);

  const checkTabs: CrmStatusTab[] = [
    { key: "All", label: "All", count: cCounts.All ?? 0 },
    { key: "Ready", label: "Ready", count: cCounts.Ready ?? 0, dot: "bg-foreground" },
    { key: "InProgress", label: "In progress", count: cCounts.InProgress ?? 0, dot: "bg-foreground/50" },
    { key: "Pending", label: "Pending", count: cCounts.Pending ?? 0, dot: "bg-foreground/20" },
    { key: "Blocked", label: "Blocked", count: cCounts.Blocked ?? 0, dot: "bg-destructive" },
  ];
  const checkColumns: CrmColumn<any>[] = [
    { key: "applicant", header: "Customer", sortKey: "ApplicantName", cell: (c) => (
      <span className="font-medium block truncate max-w-[220px]" title={c.ApplicantName}><ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /></span>
    ) },
    { key: "booking", header: "Booking", sortKey: "BookingNo", className: "hidden md:table-cell",
      cell: (c) => <span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{c.BookingNo}</span> },
    { key: "unit", header: "Unit", className: "hidden md:table-cell", cell: (c) => <span className="text-xs whitespace-nowrap">{c.UnitNo}</span> },
    { key: "status", header: "Status", sortKey: "Priority", cell: (c) => {
      const st = STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending;
      return <SheetMark text={st.label} tone={st.tone} />;
    } },
    { key: "checks", header: "Checks", cell: (c) => <CheckDots c={c} /> },
    { key: "scheduled", header: "Scheduled", sortKey: "ScheduledInspectionDate", className: "hidden lg:table-cell",
      cell: (c) => <span className="text-xs whitespace-nowrap tabular-nums">{fmtDate(c.ScheduledInspectionDate)}</span> },
    { key: "completed", header: "Completed", sortKey: "InspectionCompletedDate", className: "hidden xl:table-cell",
      cell: (c) => <span className="text-xs whitespace-nowrap tabular-nums">{fmtDate(c.InspectionCompletedDate)}</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: (c) => (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {c.Status === "Ready" && <button onClick={() => sendNotice(c)} className={`${KEY_INK} h-7 px-2.5`}><Send size={11} /> Send notice</button>}
        <button onClick={() => setSelectedId(c.Id)} aria-label="Open check" className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-foreground">
          <ChevronRight size={15} />
        </button>
      </div>
    ) },
  ];

  const gwTabs: CrmStatusTab[] = [
    { key: "All", label: "All", count: gCounts.All ?? 0 },
    { key: "Eligible", label: "Can start", count: gCounts.Eligible ?? 0, dot: "bg-foreground" },
  ];
  const gwColumns: CrmColumn<any>[] = [
    { key: "booking", header: "Booking", sortKey: "BookingNo", cell: (g) => <span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{g.BookingNo}</span> },
    { key: "applicant", header: "Customer", sortKey: "ApplicantName", cell: (g) => (
      <span className="block truncate max-w-[220px]" title={g.ApplicantName}><ApplicantNames name={g.ApplicantName} bookingId={g.BookingId} applicationId={g.ApplicationId} /></span>
    ) },
    { key: "unit", header: "Unit", sortKey: "UnitNo", className: "hidden md:table-cell", cell: (g) => <span className="text-xs whitespace-nowrap">{g.UnitNo}</span> },
    { key: "steps", header: "Gates", className: "hidden sm:table-cell", cell: (g) => <GateSteps g={g} /> },
    { key: "waiting", header: "Held at", cell: (g) => {
      const next = gatewayNext(g);
      return next ? <span className="text-xs text-muted-foreground whitespace-nowrap">{next.label}</span> : <SheetMark text="Can start" tone="done" />;
    } },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: (g) => {
      const next = gatewayNext(g);
      return next ? (
        <button onClick={() => navigate(next.path)} className={`${KEY_LINE} h-7 px-2.5`}>Go there <ChevronRight size={11} /></button>
      ) : canCreate ? (
        <button onClick={() => openCreate(String(g.BookingId))} className={`${KEY_INK} h-7 px-2.5`}><Plus size={11} /> Start</button>
      ) : null;
    } },
  ];

  const checksOnboarding = !checksQ.isLoading && !checksQ.isError && (cCounts.All ?? 0) === 0 && !checks.hasFilters;
  const st = selected ? (STATUS_CONFIG[selected.Status] ?? STATUS_CONFIG.Pending) : null;

  const figures = [
    { label: "Checks", value: cCounts.All ?? 0, note: `${cCounts.InProgress ?? 0} in progress`, go: () => { setActiveTab("checks"); checks.setStatus("All"); } },
    { label: "Ready", value: cCounts.Ready ?? 0, note: "Possession Notice can go", go: () => { setActiveTab("checks"); checks.setStatus("Ready"); } },
    { label: "Blocked", value: cCounts.Blocked ?? 0, note: "Dues outstanding or a check failed", go: () => { setActiveTab("checks"); checks.setStatus("Blocked"); } },
    { label: "Awaiting gates", value: gCounts.All ?? 0, note: `${gCounts.Eligible ?? 0} can start now`, go: () => setActiveTab("gateway") },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Pre-Possession Check"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Possession"
        title="Pre-Possession Check"
        subtitle="Four checks before a Possession Notice can go out: dues cleared, documentation, quality inspection and utilities."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={handleRefresh} disabled={checksQ.isFetching || gwQ.isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
              <RefreshCw size={13} className={checksQ.isFetching || gwQ.isFetching ? "animate-spin" : ""} />
            </button>
            {canCreate && <button onClick={() => openCreate()} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Start check</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={x.go} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{checksQ.isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-stretch bg-card overflow-x-auto" style={{ border: RULE }}>
            {([
              { key: "checks", label: "Checks", count: cCounts.All ?? 0 },
              { key: "gateway", label: "Awaiting gates", count: gwQ.isLoading ? undefined : (gCounts.All ?? 0) },
            ] as const).map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${activeTab === t.key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                style={{ borderRight: RULE_SOFT }}>
                {t.label} <span className="tabular-nums">{t.count ?? "—"}</span>
              </button>
            ))}
          </div>

          {activeTab === "checks" && (
            checksOnboarding ? (
              <div className="py-12 text-center space-y-3 bg-card" style={{ border: RULE_SOFT }}>
                <ClipboardCheck size={22} className="mx-auto text-muted-foreground" />
                <p className="font-medium text-foreground">No checks yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">A check can start once the agreement is registered and the project's OC / CC is received.</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => setActiveTab("gateway")} className={`${KEY_LINE} h-9 px-3`}>See awaiting gates</button>
                  {canCreate && <button onClick={() => openCreate()} className={`${KEY_INK} h-9 px-3`}><Plus size={13} /> Start check</button>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <CrmListToolbar tabs={checkTabs} status={checks.status} onStatus={checks.setStatus}
                  searchValue={checks.searchInput} onSearch={checks.setSearchInput} placeholder="Search customer, booking, unit, mobile…">
                  <CrmCompanyProjectBlockFilter value={checks.cpb} onChange={checks.setCpb} />
                </CrmListToolbar>
                <CrmDataTable
                  columns={checkColumns} rows={checkRows} rowKey={(c) => c.Id}
                  loading={checksQ.isLoading} fetching={checksQ.isFetching}
                  error={checksQ.isError ? (checksQ.error as Error)?.message : null} onRetry={() => checksQ.refetch()}
                  sort={checks.sort} onSort={checks.toggleSort}
                  onRowClick={(c) => setSelectedId(c.Id)} activeKey={selectedId}
                  rowAccent={(c) => (STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending).accent}
                  empty={<>No check matches these filters. <button onClick={checks.reset} className="font-semibold text-foreground hover:underline ml-1">Clear filters</button></>}
                  page={checks.page} pageSize={checks.pageSize} total={checksData?.total ?? 0} onPage={checks.setPage}
                />
              </div>
            )
          )}

          {activeTab === "gateway" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                A check can start once the agreement is registered (executed, AFS payment, registry visit, registered) and the OC / CC is received. Hover the squares for each step.
              </p>
              <CrmListToolbar tabs={gwTabs} status={gw.status} onStatus={gw.setStatus}
                searchValue={gw.searchInput} onSearch={gw.setSearchInput} placeholder="Search booking, customer, unit, mobile…">
                <CrmCompanyProjectBlockFilter value={gw.cpb} onChange={gw.setCpb} />
              </CrmListToolbar>
              <CrmDataTable
                columns={gwColumns} rows={gwRows} rowKey={(g) => g.BookingId}
                loading={gwQ.isLoading} fetching={gwQ.isFetching}
                error={gwQ.isError ? (gwQ.error as Error)?.message : null} onRetry={() => gwQ.refetch()}
                sort={gw.sort} onSort={gw.toggleSort}
                rowAccent={(g) => (gatewayNext(g) ? "border-l-foreground/20" : "border-l-foreground")}
                empty={gw.hasFilters
                  ? <>No booking matches these filters. <button onClick={gw.reset} className="font-semibold text-foreground hover:underline ml-1">Clear filters</button></>
                  : <span className="inline-flex items-center gap-2"><ShieldCheck size={15} /> Every booking has been through the gates.</span>}
                page={gw.page} pageSize={gw.pageSize} total={gwData?.total ?? 0} onPage={gw.setPage}
              />
            </div>
          )}
        </div>
      </SheetShell>

      <CrmSideDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? <ApplicantNames name={selected.ApplicantName} bookingId={selected.BookingId} applicationId={selected.ApplicationId} /> : ""}
        subtitle={selected ? `${selected.BookingNo} · ${selected.UnitNo}` : undefined}
        badge={st && <SheetMark text={st.label} tone={st.tone} />}
        footer={selected?.Status === "Ready" ? (
          <button onClick={() => sendNotice(selected)} className={`${KEY_INK} h-10 w-full`}><Send size={13} /> Send Possession Notice</button>
        ) : undefined}
      >
        {selected && (
          <CheckDetails key={`${selected.Id}_${selected.Status}_${selected.ScheduledInspectionDate ?? ""}_${selected.InspectionCompletedDate ?? ""}`}
            c={selected} checkLoading={checkLoading} onToggle={toggleCheck} onSaved={invalidate} navigate={navigate} canEdit={canEdit} />
        )}
      </CrmSideDrawer>

      {createOpen && canCreate && (
        <CreateDialog prefillBookingId={createPrefillId}
          onClose={() => { setCreateOpen(false); setCreatePrefillId(undefined); }}
          onCreated={invalidate} onViewGateway={() => setActiveTab("gateway")} />
      )}
    </>
  );
};

export default CrmPrePossession;
