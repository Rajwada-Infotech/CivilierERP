// CRM Pre-Possession Check: four checks before a Possession Notice can go out (dues cleared, which ticks itself, plus
// documentation, quality and utilities). A check can start once the agreement is registered and the OC / CC received;
// the "Awaiting gates" tab shows which step each other booking is stuck at.
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  AlertCircle, ArrowLeft, Building2, CheckSquare, ChevronRight, ClipboardCheck, Download, FileWarning, Loader2, Plus, RefreshCw,
  Send, ShieldAlert, ShieldCheck, Square, Wallet,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridColumnChooser, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

import { useUrlParam } from "@/hooks/useUrlParam";
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
async function fetchCheck(id: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/${encodeURIComponent(id)}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load this check.");
  return d;
}
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

function getProgress(c: any) {
  const duesCleared = !!c.DuesClearedCheck;
  const doneCount = (duesCleared ? 1 : 0) + MANUAL_CHECKS.filter((ch) => !!c[ch.key]).length;
  return { duesCleared, doneCount, pct: Math.round((doneCount / 4) * 100) };
}

// The four checks as one line: filled when done, red when the money is still owed.
function CheckBar({ c, onDark }: { c: any; onDark?: boolean }) {
  const { duesCleared } = getProgress(c);
  const items = [{ label: "Dues cleared", ok: duesCleared, bad: !duesCleared }, ...MANUAL_CHECKS.map(({ key, label }) => ({ label, ok: !!c[key], bad: false }))];
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full">
      {items.map((x) => <span key={x.label} title={`${x.label}: ${x.ok ? "done" : x.bad ? "outstanding" : "pending"}`} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5", x.ok ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : x.bad ? "bg-rose-500" : off)} />)}
    </span>
  );
}
function CheckTrack({ c }: { c: any }) {
  const { duesCleared, doneCount } = getProgress(c);
  const left = [duesCleared ? null : "Dues", ...MANUAL_CHECKS.map(({ key, short }) => (c[key] ? null : short))].filter(Boolean);
  return (
    <span className="block min-w-[13rem] py-1.5">
      <CheckBar c={c} />
      <span className="mt-1.5 flex justify-between gap-3 text-xs">
        <span className={cn(left.length ? "text-muted-foreground" : "font-medium text-foreground", !duesCleared && "text-destructive")}>{left.length ? `Left: ${left.join(", ")}` : "All done"}</span>
        <span className="text-muted-foreground tabular-nums">{doneCount} of 4</span>
      </span>
    </span>
  );
}

// ── The record's body: checklist, dates, notes ──────────────────────────────────────
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

  const { duesCleared } = getProgress(c);
  const outstanding = c.OutstandingDemandCount ?? 0;

  return (
    <div className="space-y-5">
      {saving && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={11} className="animate-spin" /> Saving…</p>}
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

function GateTrack({ g }: { g: any }) {
  const steps = [
    { label: "Agreement executed", ok: !!g.Gate0_AgreementExecuted },
    { label: "AFS payment", ok: !!g.Gate1a_AfsQueryPayment },
    { label: "Registry visit", ok: !!g.Gate1b_AfsRegistryCompleted },
    { label: "Agreement registered", ok: !!g.Gate1_AfsRegistered },
    { label: "OC / CC received", ok: !!g.Gate2_OcCcReceived },
  ];
  const next = gatewayNext(g);
  return (
    <span className="block min-w-[16rem] py-1.5">
      <span className="flex gap-0.5 w-full">
        {steps.map((s) => <span key={s.label} title={`${s.label}: ${s.ok ? "done" : "pending"}`} className={cn("flex-1 h-1.5 rounded-full", s.ok ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700")} />)}
      </span>
      <span className="mt-1.5 flex justify-between gap-3 text-xs">
        <span className={next ? "text-muted-foreground" : "font-medium text-foreground"}>{next ? `Held at: ${next.label}` : "Can start"}</span>
        <span className="text-muted-foreground tabular-nums">{steps.filter((s) => s.ok).length} of {steps.length}</span>
      </span>
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
type Tab = "All" | "Ready" | "InProgress" | "Pending" | "Blocked" | "gateAll" | "gateEligible";
const CHECK_TABS: Tab[] = ["All", "Ready", "InProgress", "Pending", "Blocked"];
const TAB_LABEL: Record<Tab, string> = { All: "All checks", Ready: "Ready", InProgress: "In progress", Pending: "Pending", Blocked: "Blocked", gateAll: "Awaiting gates", gateEligible: "Can start" };
const SMALL = "h-7 px-2.5";
const DEFAULT_SORT: CrmSort = { key: "Priority", dir: "asc" };
const GATE_SORT: CrmSort = { key: "BookingNo", dir: "asc" };

const customerCell = (r: any) => (
  <span className="flex items-center gap-3 py-1.5 min-w-0">
    <Initials name={r.ApplicantName} />
    <span className="min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo} · {r.UnitNo}</span>
    </span>
  </span>
);

function checkCols(actions: (c: any) => React.ReactNode): GridCol<any>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (c) => c.ApplicantName, cell: customerCell },
    { id: "checks", label: "Checks", csv: (c) => `${getProgress(c).doneCount} of 4`, cell: (c) => <CheckTrack c={c} /> },
    { id: "scheduled", label: "Inspection scheduled", sortKey: "ScheduledInspectionDate", csv: (c) => c.ScheduledInspectionDate, cell: (c) => <span className="tabular-nums">{fmtDate(c.ScheduledInspectionDate)}</span> },
    { id: "completed", label: "Inspection completed", sortKey: "InspectionCompletedDate", csv: (c) => c.InspectionCompletedDate, cell: (c) => <span className="tabular-nums">{fmtDate(c.InspectionCompletedDate)}</span> },
    { id: "status", label: "Status", sortKey: "Priority", csv: (c) => (STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending).label, cell: (c) => { const st = STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending; return <GridToneMark text={st.label} tone={st.tone} />; } },
    { id: "act", label: "Actions", cell: actions },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (c) => c.BookingNo, cell: (c) => <span className="tabular-nums">{c.BookingNo}</span> },
    { id: "unit", label: "Unit", hiddenByDefault: true, csv: (c) => c.UnitNo, cell: (c) => c.UnitNo },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (c) => c.Mobile, cell: (c) => <span className="tabular-nums">{c.Mobile || "—"}</span> },
    { id: "notes", label: "Notes", hiddenByDefault: true, csv: (c) => c.Notes, cell: (c) => c.Notes || "—" },
  ];
}
function gateCols(actions: (g: any) => React.ReactNode): GridCol<any>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (g) => g.ApplicantName, cell: customerCell },
    { id: "gates", label: "Gates", csv: (g) => gatewayNext(g)?.label ?? "Can start", cell: (g) => <GateTrack g={g} /> },
    { id: "act", label: "Actions", cell: actions },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (g) => g.BookingNo, cell: (g) => <span className="tabular-nums">{g.BookingNo}</span> },
    { id: "unit", label: "Unit", hiddenByDefault: true, sortKey: "UnitNo", csv: (g) => g.UnitNo, cell: (g) => g.UnitNo },
  ];
}

async function fetchAllPages(url: (page: number) => string): Promise<any[]> {
  const first = await fetchPage(url(1));
  let rows = first.rows;
  for (let n = 2; rows.length < first.total; n++) { const more = await fetchPage(url(n)); if (!more.rows.length) break; rows = rows.concat(more.rows); }
  return rows;
}

/** One check on its own page: the money gate, the three checks, dates and notes. */
function CheckRecord({ id, canEdit, checkLoading, onToggle, onSaved, onBack, onSend }: {
  id: string; canEdit: boolean; checkLoading: Record<string, boolean>; onToggle: (record: any, field: string, current: boolean) => void; onSaved: () => void; onBack: () => void; onSend: (c: any) => void;
}) {
  const navigate = useNavigate();
  const { data: c, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-pre-possession", "record", id], queryFn: () => fetchCheck(id), retry: false });
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !c) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{translateError((error as Error)?.message || "Check not found")}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All checks</button>
    </div>
  );
  const st = STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending;
  const { duesCleared, doneCount } = getProgress(c);
  const outstanding = c.OutstandingDemandCount ?? 0;
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Pre-Possession · ${c.BookingNo}`} title={<span className="capitalize">{asName(c.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{st.label}</span>}
        sub={[c.UnitNo, c.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All checks</button>
          <Link to={`/crm/payments?bookingId=${c.BookingId}`} className={BAND_KEY}><Wallet size={13} /> Payment plan</Link>
          {c.Status === "Ready" && <button type="button" onClick={() => onSend(c)} className={BAND_KEY_MAIN}><Send size={13} /> Send Possession Notice</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={`${doneCount} of 4`} leadNote="checks done"
        bar={<CheckBar c={c} onDark />}
        figures={[
          { label: "Dues", dot: duesCleared ? BAND_DOT.collected : BAND_DOT.overdue, value: duesCleared ? "Cleared" : String(outstanding), note: duesCleared ? "Fully funded" : "Milestones outstanding", alert: !duesCleared },
          { label: "Inspection scheduled", value: fmtDate(c.ScheduledInspectionDate), note: "Planned date" },
          { label: "Inspection completed", value: fmtDate(c.InspectionCompletedDate), note: "Actual date" },
          { label: "Possession Notice", dot: c.Status === "Ready" ? BAND_DOT.collected : undefined, value: c.Status === "Ready" ? "Can go" : "Held", note: c.Status === "Ready" ? "All four checks done" : `${4 - doneCount} check${4 - doneCount === 1 ? "" : "s"} left` },
        ]} />
      <GridRelated icon={ClipboardCheck} title="Checks, dates and notes">
        <div className="p-4">
          <CheckDetails key={`${c.Id}_${c.Status}_${c.ScheduledInspectionDate ?? ""}_${c.InspectionCompletedDate ?? ""}`} c={c} checkLoading={checkLoading} onToggle={onToggle} onSaved={onSaved} navigate={navigate} canEdit={canEdit} />
        </div>
      </GridRelated>
    </div>
  );
}

const CrmPrePossession: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  // Starting needs the create right, ticking checks and dates the edit right (the server checks both).
  const { canCreate, canEdit } = usePageRights("crm-pre-possession");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefillId, setCreatePrefillId] = useState<string | undefined>(undefined);
  const [checkLoading, setCheckLoading] = useState<Record<string, boolean>>({});
  // In the address, so a refresh or a shared link keeps it.
  const [tab, setTabRaw] = useUrlParam<Tab>("tab", "All", Object.keys(TAB_LABEL) as Tab[]);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  const onChecks = CHECK_TABS.includes(tab);
  const openId = sp.get("open");
  const openCheck = (id: number) => setSp((p) => { p.set("open", String(id)); return p; });
  const closeCheck = () => setSp((p) => { p.delete("open"); return p; });

  // Each list keeps its own page, sort and filters.
  const checks = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT });
  const gw = useCrmListState({ pageSize, defaultSort: GATE_SORT });
  const setTab = (t: Tab) => { setTabRaw(t); checks.setPage(1); gw.setPage(1); };
  const list = onChecks ? checks : gw;
  const checksQuery = { ...checks.query, status: onChecks ? tab : "All" };
  const gwQuery = { ...gw.query, status: tab === "gateEligible" ? "Eligible" : "All" };
  const checksQ = useQuery({ queryKey: ["crm-pre-possession", checksQuery], queryFn: () => fetchChecks(checksQuery), staleTime: 30_000 });
  const gwQ = useQuery({ queryKey: ["crm-pre-possession-gateway", gwQuery], queryFn: () => fetchGateway(gwQuery), staleTime: 30_000 });
  const checksData = useSticky(checksQ.data);
  const gwData = useSticky(gwQ.data);
  const cCounts = checksData?.counts ?? {};
  const gCounts = gwData?.counts ?? {};
  const activeQ = onChecks ? checksQ : gwQ;

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

  const cols = checkCols((c) => (c.Status === "Ready" ? <button type="button" onClick={(e) => { e.stopPropagation(); sendNotice(c); }} className={cn(GRID_SHEET_KEYS.KEY_INK, SMALL)}><Send size={12} /> Send notice</button> : null));
  const gCols = gateCols((g) => {
    const next = gatewayNext(g);
    return next
      ? <button type="button" onClick={() => navigate(next.path)} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL)}>Go there <ChevronRight size={12} /></button>
      : canCreate ? <button type="button" onClick={() => openCreate(String(g.BookingId))} className={cn(GRID_SHEET_KEYS.KEY_INK, SMALL)}><Plus size={12} /> Start</button> : null;
  });
  const [cPrefs, setCPrefs] = useGridPrefs("crm-pre-possession-cols-v1", cols);
  const [gPrefs, setGPrefs] = useGridPrefs("crm-pre-possession-gate-cols-v1", gCols);

  const all = cCounts.All ?? 0, ready = cCounts.Ready ?? 0, inProgress = cCounts.InProgress ?? 0, blocked = cCounts.Blocked ?? 0;
  const countOf: Record<Tab, number> = { All: all, Ready: ready, InProgress: inProgress, Pending: cCounts.Pending ?? 0, Blocked: blocked, gateAll: gCounts.All ?? 0, gateEligible: gCounts.Eligible ?? 0 };
  const handleExport = async () => {
    setExporting(true);
    try {
      if (onChecks) exportGrid(await fetchAllPages((n) => `${API}?${listParams({ ...checksQuery, page: n, pageSize: 100 })}`), cols, `pre-possession-${tab}`);
      else exportGrid(await fetchAllPages((n) => `${API}/gateway-status?${listParams({ ...gwQuery, page: n, pageSize: 100 })}`), gCols, `pre-possession-${tab}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Pre-Possession Check"]} />
      {openId ? <CheckRecord id={openId} canEdit={canEdit} checkLoading={checkLoading} onToggle={toggleCheck} onSaved={invalidate} onBack={closeCheck} onSend={sendNotice} /> : (
      <>
      <MoneyBand eyebrow="CRM · Possession" title="Pre-Possession Check" sub="Four checks before a Possession Notice can go out: dues cleared, documentation, quality inspection and utilities."
        actions={<>
          {canCreate && <button type="button" onClick={() => openCreate()} className={BAND_KEY_MAIN}><Plus size={13} /> Start check</button>}
          <button type="button" onClick={handleRefresh} disabled={activeQ.isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={activeQ.isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={`${ready} of ${all}`} leadNote="checks ready for the Possession Notice"
        bar={<CollectionBar onDark due={all} collected={ready} finance={inProgress} recorded={0} />}
        figures={[
          { label: "Ready", dot: BAND_DOT.collected, value: String(ready), note: "Possession Notice can go" },
          { label: "In progress", dot: BAND_DOT.finance, value: String(inProgress), note: `${cCounts.Pending ?? 0} not started` },
          { label: "Blocked", dot: BAND_DOT.overdue, value: String(blocked), note: "A check failed", alert: blocked > 0 },
          { label: "Awaiting gates", dot: BAND_DOT.notDue, value: String(gCounts.All ?? 0), note: `${gCounts.Eligible ?? 0} can start now` },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<Tab> label="Pre-possession" active={tab} onChange={setTab} tabs={(Object.keys(TAB_LABEL) as Tab[]).map((key) => ({ key, label: TAB_LABEL[key], count: checksData && gwData ? countOf[key] : null }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking, unit or mobile" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey="crm-pre-possession-views"
              current={{ status: tab, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                const t = Object.hasOwn(TAB_LABEL, v.status) ? (v.status as Tab) : "All";
                setTabRaw(t);
                (CHECK_TABS.includes(t) ? checks : gw).apply({ ...v, status: "All" });
              }} />
            {onChecks ? <GridColumnChooser cols={cols} prefs={cPrefs} onChange={setCPrefs} /> : <GridColumnChooser cols={gCols} prefs={gPrefs} onChange={setGPrefs} />}
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        {onChecks ? (
          <CrmGrid cols={cols} prefs={cPrefs} onPrefs={setCPrefs} rows={checksData?.rows ?? []} rowKey={(c) => c.Id} noRowNumbers
            loading={checksQ.isLoading} fetching={checksQ.isFetching} error={checksQ.isError ? translateError((checksQ.error as Error)?.message) : null} onRetry={() => checksQ.refetch()}
            sort={checks.sort} onSort={checks.toggleSort} onRowClick={(c) => openCheck(c.Id)}
            empty={checks.hasFilters || tab !== "All" ? "No check matches these filters." : "No checks yet. A check can start once the agreement is registered and the OC / CC is received."}
            page={checks.page} pageSize={pageSize} total={checksData?.total ?? 0} onPage={checks.setPage} onPageSize={(n) => { setPageSize(n); checks.setPage(1); }} />
        ) : (
          <CrmGrid cols={gCols} prefs={gPrefs} onPrefs={setGPrefs} rows={gwData?.rows ?? []} rowKey={(g) => g.BookingId} noRowNumbers
            loading={gwQ.isLoading} fetching={gwQ.isFetching} error={gwQ.isError ? translateError((gwQ.error as Error)?.message) : null} onRetry={() => gwQ.refetch()}
            sort={gw.sort} onSort={gw.toggleSort}
            empty={gw.hasFilters ? "No booking matches these filters." : "Every booking has been through the gates."}
            page={gw.page} pageSize={pageSize} total={gwData?.total ?? 0} onPage={gw.setPage} onPageSize={(n) => { setPageSize(n); gw.setPage(1); }} />
        )}
      </div>
      </>
      )}

      {createOpen && canCreate && (
        <CreateDialog prefillBookingId={createPrefillId}
          onClose={() => { setCreateOpen(false); setCreatePrefillId(undefined); }}
          onCreated={invalidate} onViewGateway={() => setTab("gateAll")} />
      )}
    </div>
  );
};

export default CrmPrePossession;
