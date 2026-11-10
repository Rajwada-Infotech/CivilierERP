// CRM Possession & Handover: one page for one job. Every booking on one list; opening it shows the Pre-Possession checklist, the
// Possession Notice and the Handover together. Each step keeps its own page right and its own server rules.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Circle, ClipboardCheck, ListChecks, Download, ExternalLink, Eye, FileText, Key, Loader2,
  Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2, Upload, UserCircle2, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import {
  CrmGrid, CrmRowMenu, GridDialog, GridFormField, GridFormSection, GridMiniTable, GridRelated, GridSearch, GridSegment, GridTabs, GridToneMark,
  exportGrid, useFileUrl, useGridPrefs, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_LABEL, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type RowMenuItem,
} from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { CERTIFICATE_TERMS, CrmStatus, POSSESSION_PAGE, bookingWorkflowStageLabel } from "@/constants/crmStatuses";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, MoneyBand, asName as lowerName } from "./payments/parts";
import { fmtShort } from "./payments/config";

const CHECK_API = "/api/crm/pre-possession";
const NOTICE_API = "/api/crm/possession-notice";
const HANDOVER_API = "/api/crm/handover";
const BOARD_API = `${CHECK_API}/board`;
const DOCS_API = "/api/crm/booking-documents";
const KEY = "crm-possession";
const OTHER_KEYS = ["crm-booking-lifecycle", "crm-dashboard", "crm-legal-milestones", "crm-oc-cc", "crm-oc-cc-board"];

const STAGE_LABEL: Record<string, string> = { NotReady: "Not ready", Checklist: "Checklist", Notice: "Notice", Handover: "Handover", Completed: "Completed", Closed: "Closed" };
const MANUAL_CHECKS = [
  { key: "DocumentationCheck", label: "Documentation complete", short: "Documentation" },
  { key: "QualityInspectionCheck", label: "Quality inspection passed", short: "Quality" },
  { key: "UtilityReadinessCheck", label: "Utilities ready", short: "Utilities" },
] as const;
const CHECK_LABEL: Record<string, string> = { Pending: "Pending", InProgress: "In progress", Ready: "Ready", Blocked: "Blocked" };
const NOTICE_LABEL: Record<string, string> = { Draft: "Draft", Sent: "Sent", Acknowledged: "Acknowledged", Disputed: "Disputed" };
const DELIVERY_MODES = ["Portal", "Email", "Post", "Courier", "InPerson"] as const;
const MODE_LABEL: Record<string, string> = { Portal: "Customer portal", Email: "Email", Post: "Post", Courier: "Courier", InPerson: "In person" };
const RESPONSE_DAYS = 15;
const HANDOVER_DEFAULT_DAYS = 7;
// The server's state machine, mirrored so no step is offered that it would refuse.
const HANDOVER_NEXT: Record<string, string[]> = { Scheduled: ["SnagInspection"], SnagInspection: ["SnagPending", "Completed"], SnagPending: ["Completed"], Completed: [], Cancelled: [] };
const HANDOVER_LABEL: Record<string, string> = { Scheduled: "Scheduled", SnagInspection: "Inspecting", SnagPending: "Snags to fix", Completed: "Completed", Cancelled: "Cancelled" };
const HANDOVER_ACTION: Record<string, string> = { SnagInspection: "Start Inspection", SnagPending: "Inspection Done", Completed: "Complete Handover" };
const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];
const SMALL = "h-8 px-3";
const KEY_LINE = cn(GRID_SHEET_KEYS.KEY_LINE, SMALL);
const KEY_MAIN = cn(GRID_SHEET_KEYS.KEY_INK, SMALL);
const NOTE = "flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs";

// Dates where the user is (toISOString gives the UTC date, a day behind before 05:30 IST).
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const dayOf = (d?: string | null) => (d ? String(d).slice(0, 10) : "");
// asName lower-cases for the CSS to capitalise; dialog subtitles and exports need the capitals in the text itself.
const asName = (n?: string | null) => String(lowerName(n ?? "") ?? "").replace(/(^|[\s.&-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const modeText = (m?: string | null) => (m ? MODE_LABEL[m] ?? m : "—");

async function api(url: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetchWithAuth(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `The request could not be completed (${res.status}).`);
  return data;
}
const fetchBoard = async (q: CrmListQuery) => {
  const d = await api(`${BOARD_API}?${listParams(q)}`);
  return { rows: (d.rows ?? []) as any[], total: Number(d.total ?? 0), counts: (d.counts ?? {}) as Record<string, number>, summary: d.summary ?? {} };
};
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  const d: any[] = await api("/api/sa/leads/users");
  return d.map((u) => ({ value: String(u.Id), label: u.Name }));
}

/** Runs one change: the busy flag, the server's message on refusal, and a refresh. Returns whether it worked. */
function useChange(refresh: () => void) {
  const [saving, setSaving] = useState(false);
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setSaving(true);
    try {
      await work();
      if (done) toast.success(done);
      refresh();
      return true;
    } catch (e: any) {
      toast.error(translateError(e.message));
      return false;
    } finally { setSaving(false); }
  };
  return { saving, run };
}

// Where a booking stands, worked out once for the list and the record.
const hasLiveHandover = (r: any) => !!r.HandoverId && r.HandoverStatus !== "Cancelled";
const checksLeft = (r: any) => [r.FullyFunded ? null : "Dues", ...MANUAL_CHECKS.map((c) => (r[c.key] ? null : c.short))].filter(Boolean) as string[];
const amountBlock = (r: any): string | undefined => r.AgreementBlocks?.find((e: string) => e.includes("Milestone 1"));
/** The first thing actually holding this booking back, and where to deal with it. Never offers to create what exists. */
export function gateHold(r: any): { step: string; label: string; path: string; action: string } | null {
  const id = r.BookingId;
  if (r.BookingStatus !== CrmStatus.APPROVED) return { step: "approval", label: `Booking awaiting ${bookingWorkflowStageLabel[r.WorkflowStage] ?? "approval"}`, path: `/crm/bookings?view=${id}`, action: "Open Booking" };
  if (!r.Gate1_AfsRegistered) {
    const agreement = { path: `/crm/agreements?bookingId=${id}`, action: "Open Agreement" };
    if (!r.AgreementId) {
      if (!r.WelcomeDone) return { step: "welcome", label: "Welcome call not completed", path: `/crm/welcome-calls?bookingId=${id}`, action: "Open Welcome Call" };
      if (amountBlock(r)) return { step: "amount", label: "Booking amount not received", path: `/crm/payments?bookingId=${id}`, action: "Open Payments" };
      if (r.AgreementBlocks?.length) return { step: "executed", label: r.AgreementBlocks[0], path: `/crm/bookings?view=${id}`, action: "Open Booking" };
      return { step: "executed", label: "Agreement not created", path: agreement.path, action: "Create Agreement" };
    }
    if (!r.Gate0_AgreementExecuted) return { step: "executed", label: `Agreement is ${r.AgreementStatus}`, ...agreement };
    if (!r.Gate1a_AfsQueryPayment) return { step: "payment", label: "Agreement registration payment not confirmed", path: `${agreement.path}&tab=afs-payment`, action: agreement.action };
    if (!r.Gate1b_AfsRegistryCompleted) return { step: "registry", label: "Registry visit pending", path: `${agreement.path}&tab=afs-registry`, action: agreement.action };
    return { step: "registered", label: "Agreement not registered", ...agreement };
  }
  if (!r.Gate2_OcCcReceived) return { step: "certificate", label: `${CERTIFICATE_TERMS.ONE} not issued`, path: `/crm/oc-cc?open=${r.ProjectId}`, action: "Open Certificates" };
  return null;
}
/** Everything that must be true before possession can start, in the order it happens. */
export const eligibilitySteps = (r: any): { key: string; label: string; ok: boolean }[] => [
  { key: "approval", label: "Booking approved", ok: r.BookingStatus === CrmStatus.APPROVED },
  { key: "welcome", label: "Welcome call completed", ok: !!r.WelcomeDone || !!r.AgreementId },
  { key: "amount", label: "Booking amount received", ok: !!r.AgreementId || (r.BookingStatus === CrmStatus.APPROVED && !amountBlock(r)) },
  { key: "executed", label: "Agreement executed", ok: !!r.Gate0_AgreementExecuted },
  { key: "payment", label: "Registration payment confirmed", ok: !!r.Gate1a_AfsQueryPayment },
  { key: "registry", label: "Registry visit completed", ok: !!r.Gate1b_AfsRegistryCompleted },
  { key: "registered", label: "Agreement registered", ok: !!r.Gate1_AfsRegistered },
  { key: "certificate", label: `${CERTIFICATE_TERMS.ONE} issued`, ok: !!r.Gate2_OcCcReceived },
];
export function handoverHolds(r: any): string[] {
  return [
    r.NoticeStatus !== "Acknowledged" ? "Possession notice not acknowledged" : null,
    !r.FullyFunded ? `Balance due of ${fmtRupees(r.Balance)}` : null,
    r.NocPending ? "NOC still to be issued" : null,
    r.CheckId && checksLeft(r).length ? "Checklist not complete" : null,
  ].filter(Boolean) as string[];
}
export function nextStep(r: any): { text: string; late?: boolean } {
  switch (r.Stage) {
    case "Closed": return { text: `Booking ${r.BookingStatus}` };
    case "Completed": return { text: "Keys handed over" };
    case "NotReady": return { text: gateHold(r)?.label ?? "Ready to start" };
    case "Checklist":
      if (!r.CheckId) return { text: "Start the checklist" };
      if (r.CheckStatus === "Blocked") return { text: "Checklist blocked", late: true };
      return { text: `Pending: ${checksLeft(r).join(", ")}` };
    case "Notice":
      if (!r.NoticeId) return { text: "Create the possession notice" };
      if (r.NoticeStatus === "Draft") return { text: "Send the notice" };
      if (r.NoticeStatus === "Disputed") return { text: "Customer objected to the notice", late: true };
      return r.NoticeOverdue ? { text: "Customer response overdue", late: true } : { text: "Awaiting customer response" };
    case "Handover": {
      if (!hasLiveHandover(r)) { const holds = handoverHolds(r); return holds.length ? { text: holds[0], late: !r.FullyFunded } : { text: "Schedule the handover" }; }
      if (r.OpenSnags > 0) return { text: `${r.OpenSnags} snag${r.OpenSnags === 1 ? "" : "s"} to fix`, late: true };
      return { text: r.HandoverStatus === "Scheduled" ? "Start the inspection" : "Complete the handover" };
    }
    default: return { text: "" };
  }
}
type StepState = "done" | "active" | "stopped" | "off";
export const stepsOf = (r: any): { label: string; state: StepState }[] => [
  { label: "Eligibility", state: r.Gate1_AfsRegistered && r.Gate2_OcCcReceived ? "done" : r.Stage === "Closed" ? "off" : "active" },
  { label: "Checklist", state: r.CheckStatus === "Ready" ? "done" : r.CheckStatus === "Blocked" ? "stopped" : r.CheckId ? "active" : "off" },
  { label: "Notice", state: r.NoticeStatus === "Acknowledged" ? "done" : r.NoticeStatus === "Disputed" ? "stopped" : r.NoticeId ? "active" : "off" },
  { label: "Handover", state: r.HandoverStatus === "Completed" ? "done" : hasLiveHandover(r) ? "active" : "off" },
];
function Tracker({ r, onDark }: { r: any; onDark?: boolean }) {
  const fill: Record<StepState, string> = {
    done: onDark ? BAND_DOT.collected : "bg-emerald-500", active: onDark ? BAND_DOT.finance : "bg-amber-400", stopped: "bg-rose-500",
    off: onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700",
  };
  const ink: Record<StepState, string> = {
    done: onDark ? "text-slate-200" : "text-foreground", active: onDark ? "text-white font-semibold" : "text-foreground font-semibold",
    stopped: onDark ? "text-rose-300 font-semibold" : "text-destructive font-semibold", off: onDark ? "text-slate-400" : "text-muted-foreground",
  };
  return (
    <span className="grid grid-cols-4 gap-1 w-full">
      {stepsOf(r).map((s) => (
        <span key={s.label} className="min-w-0">
          <span className={cn("block rounded-full", onDark ? "h-2.5" : "h-1.5", fill[s.state])} />
          <span className={cn("mt-1 block text-[0.6875rem] truncate", ink[s.state])}>{s.label}</span>
        </span>
      ))}
    </span>
  );
}

/** A step's facts, four to a row; anything not yet recorded is left out. */
function Facts({ items }: { items: { label: string; value: React.ReactNode; wide?: boolean }[] }) {
  const shown = items.filter((i) => i.value != null && i.value !== "" && i.value !== "—");
  return (
    <dl className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
      {shown.map((f) => (
        <div key={f.label} className={cn("min-w-0", f.wide && "col-span-2 md:col-span-4")}>
          <dt className={GRID_LABEL}>{f.label}</dt>
          <dd className="mt-0.5 text-[0.8125rem] font-medium break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (r) => asName(r.ApplicantName), cell: (r) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo}</span>
    </span>
  ) },
  { id: "project", label: "Project and unit", sortKey: "ProjectName", csv: (r) => [r.ProjectName, r.BlockName, r.UnitNo].filter(Boolean).join(" / "), cell: (r) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{r.ProjectName || "—"}</span>
      <span className="block text-xs text-muted-foreground truncate">{[r.BlockName && `Block ${r.BlockName}`, r.UnitNo && `Unit ${r.UnitNo}`].filter(Boolean).join(" · ")}</span>
    </span>
  ) },
  { id: "progress", label: "Progress", sortKey: "Priority", csv: (r) => STAGE_LABEL[r.Stage], cell: (r) => <span className="block min-w-[17rem] py-1.5"><Tracker r={r} /></span> },
  { id: "next", label: "Next step", csv: (r) => nextStep(r).text, cell: (r) => { const n = nextStep(r); return <span className={cn("block whitespace-normal text-[0.8125rem] leading-snug", n.late && "font-semibold text-destructive")}>{n.text}</span>; } },
  { id: "balance", label: "Balance due", align: "right", sortKey: "Balance", csv: (r) => r.Balance, cell: (r) => (Number(r.Balance) > 0 ? <span className="tabular-nums font-semibold" title={fmtRupees(r.Balance)}>{fmtShort(r.Balance)}</span> : <span className="text-muted-foreground">Nil</span>) },
];

// ── Checklist ───────────────────────────────────────────────────────────────────
function ChecklistForm({ c, canEdit, onSaved, bookingId }: { c: any; canEdit: boolean; onSaved: () => void; bookingId: number }) {
  const { saving, run } = useChange(onSaved);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(dayOf(c.ScheduledInspectionDate));
  const [completed, setCompleted] = useState(dayOf(c.InspectionCompletedDate));
  const [notes, setNotes] = useState<string>(c.Notes ?? "");
  const save = (body: Record<string, unknown>) => run(() => api(`${CHECK_API}/${c.Id}`, "PUT", body));
  const toggle = async (key: string) => { setBusyKey(key); await save({ [key]: !c[key] }); setBusyKey(null); };
  // Saved when a date is chosen or cleared. The calendar control's blur fires as it opens and carries no date, so
  // saving on blur blanked the stored date.
  const pickDate = (field: "ScheduledInspectionDate" | "InspectionCompletedDate", v: string) => {
    const other = field === "ScheduledInspectionDate" ? completed : scheduled;
    if (v && other && (field === "InspectionCompletedDate" ? v < other : other < v)) return void toast.error("The inspection can't be completed before it was scheduled.");
    (field === "ScheduledInspectionDate" ? setScheduled : setCompleted)(v);
    if (v !== dayOf(c[field])) save({ [field]: v || null });
  };
  const dues = !!c.DuesClearedCheck;
  const row = "flex items-center gap-2.5 h-10 px-3 rounded-md border border-border text-[0.8125rem]";
  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className={row}>
          {dues ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={16} className="text-destructive shrink-0" />}
          <span className={cn("font-medium", !dues && "text-destructive")}>Dues cleared</span>
          <span className="ml-auto text-xs text-muted-foreground">{dues ? "Automatic" : <Link to={`/crm/payments?bookingId=${bookingId}`} className="text-primary hover:underline">{c.OutstandingDemandCount ?? 0} outstanding</Link>}</span>
        </div>
        {MANUAL_CHECKS.map(({ key, label }) => (
          <button key={key} type="button" onClick={() => toggle(key)} disabled={!canEdit || busyKey === key} className={cn(row, "text-left hover:bg-muted disabled:cursor-not-allowed disabled:hover:bg-transparent")}>
            {busyKey === key ? <Loader2 size={16} className="animate-spin text-muted-foreground shrink-0" /> : c[key] ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> : <Circle size={16} className="text-muted-foreground shrink-0" />}
            <span className={cn("font-medium", !c[key] && "text-muted-foreground")}>{label}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-4">
        <GridFormField label="Inspection scheduled">
          <DateInput value={scheduled} disabled={!canEdit} onChange={(e) => pickDate("ScheduledInspectionDate", e.target.value)} className={GRID_INPUT} />
        </GridFormField>
        <GridFormField label="Inspection completed">
          <DateInput value={completed} disabled={!canEdit} onChange={(e) => pickDate("InspectionCompletedDate", e.target.value)} className={GRID_INPUT} />
        </GridFormField>
        <GridFormField label={saving ? "Notes (saving…)" : "Notes"}>
          <input type="text" value={notes} disabled={!canEdit} placeholder="Inspection remarks" onChange={(e) => setNotes(e.target.value)} onBlur={(e) => { if (e.target.value !== (c.Notes ?? "")) save({ Notes: e.target.value || null }); }} className={GRID_INPUT} />
        </GridFormField>
      </div>
    </div>
  );
}

function ChecklistSection({ r, refresh, focus, setPrimary }: { r: any; refresh: () => void; focus: boolean; setPrimary: (p: Primary | null) => void }) {
  const rights = usePageRights("crm-pre-possession");
  const navigate = useNavigate();
  const { data: c, isLoading } = useQuery({ queryKey: [KEY, "check", r.CheckId], queryFn: () => api(`${CHECK_API}/${r.CheckId}`), enabled: !!r.CheckId && rights.canView });
  const [startOpen, setStartOpen] = useState(false);
  const [date, setDate] = useState("");
  const { saving, run } = useChange(refresh);
  const hold = gateHold(r);
  const start = async () => { if (await run(() => api(CHECK_API, "POST", { BookingId: r.BookingId, ScheduledInspectionDate: date || null }), "Checklist started")) setStartOpen(false); };
  usePrimary(setPrimary, focus, !r.CheckId && !hold && rights.canCreate && r.Stage !== "Closed" ? "Start Checklist" : null, () => setStartOpen(true));
  return (
    <GridRelated icon={ClipboardCheck} title="Pre-Possession Checklist" action={r.CheckId ? <GridToneMark text={CHECK_LABEL[r.CheckStatus] ?? r.CheckStatus} tone={r.CheckStatus === "Ready" ? "done" : r.CheckStatus === "Blocked" ? "stopped" : "waiting"} /> : undefined}>
      {!r.CheckId ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">{r.Stage === "Closed" ? "This booking is closed." : "All requirements are met. The checklist can be started."}</p>
      ) : !rights.canView ? <p className="px-4 py-4 text-xs text-muted-foreground">You don't have access to this step.</p>
        : isLoading || !c ? <p className="px-4 py-4 text-xs text-muted-foreground">Loading…</p>
        : <ChecklistForm key={`${c.Id}_${c.UpdatedAt ?? ""}`} c={c} canEdit={rights.canEdit && r.Stage !== "Closed"} onSaved={refresh} bookingId={r.BookingId} />}
      {startOpen && (
        <GridDialog onClose={() => setStartOpen(false)} icon={ClipboardCheck} width="max-w-xl" title="Start Pre-Possession Checklist" description={`${asName(r.ApplicantName)} · ${r.BookingNo}`}
          footer={<><button onClick={() => setStartOpen(false)} className={GRID_BTN}>Cancel</button><button onClick={start} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Start Checklist"}</button></>}>
          <GridFormField label="Inspection scheduled for"><DateInput value={date} onChange={(e) => setDate(e.target.value)} className={GRID_INPUT} /></GridFormField>
        </GridDialog>
      )}
    </GridRelated>
  );
}

type Primary = { label: string; run: () => void };
/** The step in focus offers its one main action to the band at the top of the booking. */
function usePrimary(set: (p: Primary | null) => void, active: boolean, label: string | null, run: () => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => { if (active) set(label ? { label, run: () => latest.current() } : null); }, [active, label, set]);
}

/** A protected file in a wide preview, with its download. */
function FilePreview({ url, title, description, fileName, onClose }: { url: string; title: string; description?: string; fileName: string; onClose: () => void }) {
  const { fileUrl, failed } = useFileUrl(url);
  return (
    <GridDialog onClose={onClose} icon={FileText} width="max-w-4xl" title={title} description={description}
      footer={fileUrl ? <a href={fileUrl} download={fileName} className={GRID_BTN_BRAND}><Download size={13} /> Download</a> : undefined}>
      <div className="flex items-center justify-center min-h-[300px] rounded-md border border-border overflow-hidden">
        {failed ? <span className="text-sm text-destructive">Could not load this file.</span>
          : !fileUrl ? <span className="text-sm text-muted-foreground">Loading…</span>
          : <iframe src={fileUrl} title={title} className="w-full h-[65vh] border-0" />}
      </div>
    </GridDialog>
  );
}

// ── Notice ──────────────────────────────────────────────────────────────────────
const emptyNotice = () => ({ OfferedDate: localDay(), ResponseDeadline: localDay(RESPONSE_DAYS), DeliveryMode: "Courier", Notes: "" });
const badNoticeDates = (f: { OfferedDate: string; ResponseDeadline: string }) => (f.OfferedDate && f.ResponseDeadline && f.ResponseDeadline < f.OfferedDate ? "The response deadline can't be before the offered date." : null);
const ModePicker: React.FC<{ value: string; onChange: (m: string) => void }> = ({ value, onChange }) => (
  <span className="block"><GridSegment<string> label="Delivery" value={value} onChange={onChange} options={DELIVERY_MODES.map((m) => ({ key: m, label: MODE_LABEL[m] }))} /></span>
);
function NoticeFields({ form, set }: { form: ReturnType<typeof emptyNotice>; set: (k: string, v: string) => void }) {
  return (
    <GridFormSection>
      <GridFormField label="Offered on"><DateInput value={form.OfferedDate} onChange={(e) => set("OfferedDate", e.target.value)} className={GRID_INPUT} /></GridFormField>
      <GridFormField label="Respond by"><DateInput value={form.ResponseDeadline} onChange={(e) => set("ResponseDeadline", e.target.value)} className={GRID_INPUT} /></GridFormField>
      <GridFormField label="Delivery" wide><ModePicker value={form.DeliveryMode} onChange={(m) => set("DeliveryMode", m)} /></GridFormField>
      <GridFormField label="Notes" wide><textarea value={form.Notes} rows={2} onChange={(e) => set("Notes", e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
    </GridFormSection>
  );
}

type NoticeDialog = "create" | "edit" | "sent" | "ack" | "delete" | "dispute" | "retract" | "proxyAck" | "proxyDispute" | "letter" | null;
function NoticeSection({ r, refresh, focus, setPrimary }: { r: any; refresh: () => void; focus: boolean; setPrimary: (p: Primary | null) => void }) {
  const rights = usePageRights("crm-possession-notice");
  const { data: n, isLoading } = useQuery({ queryKey: [KEY, "notice", r.NoticeId], queryFn: () => api(`${NOTICE_API}/${r.NoticeId}`), enabled: !!r.NoticeId && rights.canView });
  // A booking can have older notices; they stay on record here.
  const { data: earlier = [] } = useQuery({
    queryKey: [KEY, "notices", r.BookingId], enabled: !!r.NoticeId && rights.canView,
    queryFn: () => api(`${NOTICE_API}?page=1&pageSize=100&search=${encodeURIComponent(r.BookingNo)}`).then((d) => (d.rows ?? []).filter((x: any) => x.BookingId === r.BookingId && x.Id !== r.NoticeId)),
  });
  const { saving, run } = useChange(refresh);
  const [dialog, setDialog] = useState<NoticeDialog>(null);
  const [form, setForm] = useState(emptyNotice);
  const [mode, setMode] = useState("");
  const [reason, setReason] = useState("");
  const close = () => setDialog(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const url = `${NOTICE_API}/${r.NoticeId}`;
  const finish = async (work: () => Promise<unknown>, done: string) => { if (await run(work, done)) close(); };
  const withDates = (work: () => Promise<unknown>, done: string) => { const bad = badNoticeDates(form); if (bad) return void toast.error(bad); finish(work, done); };
  const openEdit = () => { setForm({ OfferedDate: dayOf(n.OfferedDate), ResponseDeadline: dayOf(n.ResponseDeadline), DeliveryMode: n.DeliveryMode || "", Notes: n.Notes || "" }); setDialog("edit"); };
  const proxy = (path: string, done: string) => async (ProxyMethod: ProxyMethod, ProxyRemarks: string) => { await finish(() => api(`${url}/${path}`, "PUT", { ProxyMethod, ProxyRemarks }), done); };

  const canCreateNotice = rights.canCreate && !r.NoticeId && r.CheckStatus === "Ready" && !!r.Gate2_OcCcReceived && r.Stage !== "Closed";
  let main: Primary | null = null;
  let more: RowMenuItem[] = [];
  if (n && rights.canEdit && r.Stage !== "Closed") {
    if (n.Status === CrmStatus.DRAFT) {
      main = { label: "Mark as Sent", run: () => { setMode(n.DeliveryMode || ""); setDialog("sent"); } };
      more = [{ label: "Edit", icon: Pencil, onClick: openEdit }, { label: "Delete", icon: Trash2, danger: true, onClick: () => setDialog("delete") }];
    } else if (n.Status === "Sent") {
      main = { label: "Acknowledge", run: () => setDialog("ack") };
      more = [
        { label: "Mark as Disputed", icon: AlertTriangle, onClick: () => { setReason(""); setDialog("dispute"); } },
        { heading: "Customer replied off the portal" },
        { label: "Record acknowledgement", icon: UserCircle2, onClick: () => setDialog("proxyAck") },
        { label: "Record dispute", icon: UserCircle2, onClick: () => setDialog("proxyDispute") },
      ];
    } else if (n.Status === "Disputed") {
      main = { label: "Withdraw Dispute", run: () => { setReason(""); setDialog("retract"); } };
    }
  }
  const createNotice = () => { setForm(emptyNotice()); setDialog("create"); };
  usePrimary(setPrimary, focus, canCreateNotice ? "Create Notice" : main?.label ?? null, () => (canCreateNotice ? createNotice() : main?.run()));
  const sub = n ? `${n.NoticeNo} · ${asName(r.ApplicantName)}` : asName(r.ApplicantName);
  return (
    <GridRelated icon={FileText} title="Possession Notice" action={(
      <span className="inline-flex items-center gap-2">
        {r.NoticeId && <GridToneMark text={NOTICE_LABEL[r.NoticeStatus] ?? r.NoticeStatus} tone={r.NoticeStatus === "Acknowledged" ? "done" : r.NoticeStatus === "Disputed" ? "stopped" : "waiting"} />}
        {n && <button type="button" onClick={() => setDialog("letter")} className={KEY_LINE}><Eye size={12} /> View Letter</button>}
        {!focus && canCreateNotice && <button type="button" onClick={createNotice} className={KEY_MAIN}><Plus size={12} /> Create Notice</button>}
        {!focus && main && <button type="button" onClick={main.run} className={KEY_LINE}>{main.label}</button>}
        {more.length > 0 && <CrmRowMenu items={more} />}
      </span>
    )}>
      {!r.NoticeId ? <p className="px-4 py-4 text-xs text-muted-foreground">{r.CheckStatus === "Ready" ? "No notice created yet." : "Available once the checklist is Ready."}</p>
        : !rights.canView ? <p className="px-4 py-4 text-xs text-muted-foreground">You don't have access to this step.</p>
        : isLoading || !n ? <p className="px-4 py-4 text-xs text-muted-foreground">Loading…</p>
        : <Facts items={[
            { label: "Notice number", value: <span className="tabular-nums">{n.NoticeNo}</span> },
            { label: "Offered on", value: fmtDate(n.OfferedDate) },
            { label: "Respond by", value: <span className={r.NoticeOverdue ? "font-semibold text-destructive" : ""}>{fmtDate(n.ResponseDeadline)}{r.NoticeOverdue ? " (overdue)" : ""}</span> },
            { label: "Delivery", value: modeText(n.DeliveryMode) },
            { label: "Sent on", value: fmtDate(n.SentAt) },
            { label: "Acknowledged on", value: fmtDate(n.AcknowledgedAt) },
            ...(n.DisputeReason ? [{ label: "Customer's objection", value: <span className="text-destructive">{n.DisputeReason}</span>, wide: true }] : []),
            { label: "Notes", value: n.Notes || "—", wide: true },
          ]} />}
      {earlier.length > 0 && <p className="px-4 pb-3 text-xs text-muted-foreground tabular-nums">Earlier: {earlier.map((x: any) => `${x.NoticeNo} (${NOTICE_LABEL[x.Status] ?? x.Status}, ${fmtDate(x.OfferedDate)})`).join(" · ")}</p>}

      {(dialog === "create" || dialog === "edit") && (
        <GridDialog onClose={close} icon={FileText} width="max-w-2xl" title={dialog === "create" ? "Create Possession Notice" : "Edit Possession Notice"} description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button>
            <button disabled={saving} className={GRID_BTN_BRAND} onClick={() => (dialog === "create"
              ? withDates(() => api(NOTICE_API, "POST", { ...form, BookingId: r.BookingId }), "Notice created")
              : withDates(() => api(url, "PUT", { OfferedDate: form.OfferedDate || undefined, ResponseDeadline: form.ResponseDeadline || undefined, DeliveryMode: form.DeliveryMode || undefined, Notes: form.Notes }), "Notice saved"))}>{saving ? "Saving…" : dialog === "create" ? "Create Notice" : "Save Changes"}</button></>}>
          <NoticeFields form={form} set={set} />
        </GridDialog>
      )}
      {dialog === "sent" && (
        <GridDialog onClose={close} icon={Send} width="max-w-xl" title="Mark as Sent" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving || !mode} className={GRID_BTN_BRAND} onClick={() => finish(() => api(`${url}/mark-sent`, "PUT", { DeliveryMode: mode }), "Notice marked as sent")}>{saving ? "Saving…" : "Mark as Sent"}</button></>}>
          <GridFormField label="Sent by" required hint="However it is delivered, the customer can read this letter and respond on their portal as soon as it is marked as sent."><ModePicker value={mode} onChange={setMode} /></GridFormField>
        </GridDialog>
      )}
      {dialog === "ack" && (
        <GridDialog onClose={close} icon={CheckCircle2} width="max-w-xl" title="Acknowledge Notice" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving} className={GRID_BTN_BRAND} onClick={() => finish(() => api(`${url}/mark-acknowledged`, "PUT"), "Notice acknowledged")}>{saving ? "Saving…" : "Acknowledge"}</button></>}>
          <p className="text-sm">The customer has accepted this offer of possession. The handover can then be scheduled.</p>
        </GridDialog>
      )}
      {dialog === "delete" && (
        <GridDialog onClose={close} icon={Trash2} width="max-w-xl" title="Delete Draft Notice" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Keep</button><button disabled={saving} className={cn(GRID_SHEET_KEYS.KEY_RED, "h-9 px-3")} onClick={() => finish(() => api(url, "DELETE"), "Notice deleted")}>{saving ? "Deleting…" : "Delete"}</button></>}>
          <p className="text-sm">Delete this draft for good? A new notice can then be created for the booking.</p>
        </GridDialog>
      )}
      {(dialog === "dispute" || dialog === "retract") && (
        <GridDialog onClose={close} icon={dialog === "dispute" ? AlertTriangle : RotateCcw} width="max-w-xl" title={dialog === "dispute" ? "Mark as Disputed" : "Withdraw Dispute"}
          description={dialog === "dispute" ? "The notice stays disputed until the objection is settled." : "The notice goes back to Draft so it can be revised and sent again."}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving || !reason.trim()} className={dialog === "dispute" ? cn(GRID_SHEET_KEYS.KEY_RED, "h-9 px-3") : GRID_BTN_BRAND}
            onClick={() => (dialog === "dispute"
              ? finish(() => api(`${url}/mark-disputed`, "PUT", { DisputeReason: reason.trim() }), "Notice marked as disputed")
              : finish(() => api(`${url}/retract-dispute`, "PUT", { RetractReason: reason.trim() }), "Dispute withdrawn; the notice is back to Draft"))}>{dialog === "dispute" ? "Mark as Disputed" : "Back to Draft"}</button></>}>
          <GridFormField label={dialog === "dispute" ? "Customer's objection" : "How it was settled"} required><textarea value={reason} rows={3} onChange={(e) => setReason(e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
        </GridDialog>
      )}
      {dialog === "letter" && n && <FilePreview url={`${url}/pdf`} title="Possession Letter" description={sub} fileName={`${n.NoticeNo}.pdf`} onClose={close} />}
      {dialog === "proxyAck" && <ProxyActionDialog title="Record customer's acknowledgement" description="The customer acknowledged the possession notice without using their portal." confirmLabel="Record acknowledgement" saving={saving} onClose={close} onConfirm={proxy("proxy-acknowledge", "Customer's acknowledgement recorded")} />}
      {dialog === "proxyDispute" && <ProxyActionDialog title="Record customer's dispute" description="The customer disputed the possession notice without using their portal. Put their reason in the notes." confirmLabel="Record dispute" saving={saving} onClose={close} onConfirm={proxy("proxy-dispute", "Customer's dispute recorded")} />}
    </GridRelated>
  );
}

// ── Handover ────────────────────────────────────────────────────────────────────
type HoDialog = "schedule" | "snag" | "complete" | "cancel" | null;
function HandoverSection({ r, refresh, focus, setPrimary }: { r: any; refresh: () => void; focus: boolean; setPrimary: (p: Primary | null) => void }) {
  const rights = usePageRights("crm-handover");
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: [KEY, "handover", r.HandoverId], queryFn: () => api(`${HANDOVER_API}/${r.HandoverId}`), enabled: !!r.HandoverId && rights.canView });
  const { data: earlier = [] } = useQuery({
    queryKey: [KEY, "handovers", r.BookingId], enabled: !!r.HandoverId && rights.canView,
    queryFn: () => api(`${HANDOVER_API}?bookingId=${r.BookingId}`).then((d) => (Array.isArray(d) ? d : []).filter((x: any) => x.Id !== r.HandoverId)),
  });
  const { saving, run } = useChange(refresh);
  const [dialog, setDialog] = useState<HoDialog>(null);
  const [schedule, setSchedule] = useState({ ScheduledDate: "", Notes: "" });
  const [snag, setSnag] = useState({ Category: SNAG_CATEGORIES[0], Description: "" });
  const [complete, setComplete] = useState({ ActualHandoverDate: "", KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000, enabled: dialog === "complete" });
  const close = () => setDialog(null);
  const h = data?.handover;
  const snags: any[] = data?.snags ?? [];
  const openSnags = snags.filter((s) => s.Status !== CrmStatus.RESOLVED).length;
  const url = `${HANDOVER_API}/${r.HandoverId}`;
  const live = hasLiveHandover(r);
  const finish = async (work: () => Promise<unknown>, done: string) => { const ok = await run(work, done); if (ok) close(); return ok; };
  const holds = handoverHolds(r);
  const canSchedule = rights.canCreate && !live && r.HandoverStatus !== "Completed" && r.NoticeStatus === "Acknowledged" && r.Stage !== "Closed";

  const submitComplete = async () => {
    if (!complete.ActualHandoverDate) return void toast.error("Enter the handover date.");
    if (complete.ActualHandoverDate > localDay()) return void toast.error("The handover date can't be in the future.");
    if (!complete.KeyHandoverBy) return void toast.error("Select who handed over the keys.");
    if (!complete.FinalDuesCleared) return void toast.error("Confirm that every final due is cleared.");
    if (!complete.CustomerAcknowledged) return void toast.error("Confirm that the customer took possession.");
    const ok = await finish(() => api(url, "PUT", { Status: "Completed", ActualHandoverDate: complete.ActualHandoverDate, KeyHandoverBy: parseInt(complete.KeyHandoverBy), FinalDuesCleared: true, CustomerAcknowledged: true }), "Handover completed");
    if (ok) promptNextStep(navigate, "Handover completed: raise after-sales service tickets for any warranty or follow-up issue.", "/crm/service-tickets", "Go to Service Tickets");
  };
  const moveTo = (s: string) => {
    if (s === "Completed") { setComplete({ ActualHandoverDate: localDay(), KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false }); return setDialog("complete"); }
    run(() => api(url, "PUT", { Status: s }), `Handover: ${HANDOVER_LABEL[s] ?? s}`);
  };
  const active = h && !["Completed", "Cancelled"].includes(h.Status);
  const openSchedule = () => { setSchedule({ ScheduledDate: localDay(HANDOVER_DEFAULT_DAYS), Notes: "" }); setDialog("schedule"); };
  // The furthest step that can be taken now is the main one; any other stays beside the section.
  const nextMoves = h && rights.canEdit && r.Stage !== "Closed" ? (HANDOVER_NEXT[h.Status] ?? []) : [];
  const usable = nextMoves.filter((m) => !(m === "Completed" && openSnags > 0));
  const mainMove = focus ? usable[usable.length - 1] ?? null : null;
  usePrimary(setPrimary, focus, canSchedule && !holds.length ? "Schedule Handover" : mainMove ? HANDOVER_ACTION[mainMove] : null, () => (canSchedule && !holds.length ? openSchedule() : mainMove && moveTo(mainMove)));
  const more: RowMenuItem[] = h && active && rights.canEdit && r.Stage !== "Closed" ? [{ label: "Cancel Handover", icon: AlertTriangle, danger: true, onClick: () => setDialog("cancel") }] : [];
  const sub = `${asName(r.ApplicantName)} · ${r.BookingNo}`;
  return (
    <GridRelated icon={Key} title="Handover" action={(
      <span className="inline-flex items-center gap-2">
        {r.HandoverId && <GridToneMark text={HANDOVER_LABEL[r.HandoverStatus] ?? r.HandoverStatus} tone={r.HandoverStatus === "Completed" ? "done" : r.HandoverStatus === "Cancelled" ? "stopped" : "waiting"} />}
        {canSchedule && holds.length > 0 && <button type="button" disabled title={holds.join(". ")} className={cn(KEY_MAIN, "disabled:opacity-50")}><Key size={12} /> Schedule Handover</button>}
        {canSchedule && !holds.length && !focus && <button type="button" onClick={openSchedule} className={KEY_MAIN}><Key size={12} /> Schedule Handover</button>}
        {nextMoves.filter((m) => m !== mainMove).map((m) => (
          <button key={m} type="button" disabled={saving || (m === "Completed" && openSnags > 0)} title={m === "Completed" && openSnags > 0 ? "Resolve the open snags first." : undefined} onClick={() => moveTo(m)} className={cn(KEY_LINE, "disabled:opacity-50")}>{HANDOVER_ACTION[m]} <ArrowRight size={12} /></button>
        ))}
        {more.length > 0 && <CrmRowMenu items={more} />}
      </span>
    )}>
      {!r.HandoverId || !live && r.HandoverStatus === "Cancelled" && canSchedule ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">{r.NoticeStatus === "Acknowledged" ? (holds.length ? `On hold: ${holds.join(", ")}.` : r.HandoverStatus === "Cancelled" ? "The last handover was cancelled. A new one can be scheduled." : "Ready to be scheduled.") : "Available once the customer acknowledges the notice."}</p>
      ) : !rights.canView ? <p className="px-4 py-4 text-xs text-muted-foreground">You don't have access to this step.</p>
        : isLoading || !h ? <p className="px-4 py-4 text-xs text-muted-foreground">Loading…</p> : (
        <>
          <Facts items={[
            { label: "Scheduled for", value: fmtDate(h.ScheduledDate) },
            { label: "Handed over on", value: fmtDate(h.ActualHandoverDate) },
            { label: "Keys handed by", value: h.KeyHandoverByName || "—" },
            { label: "Final dues", value: h.FinalDuesCleared ? "Cleared" : "Not confirmed" },
            { label: "Customer", value: h.CustomerAcknowledged ? "Took possession" : "Not yet" },
            { label: "Notes", value: h.Notes || "—" },
          ]} />
          <div className="px-4 pt-2 pb-2 flex items-center justify-between">
            <h4 className="text-[0.8125rem] font-semibold">Snags <span className="font-normal text-muted-foreground tabular-nums">({snags.length})</span></h4>
            {rights.canCreate && active && <button type="button" onClick={() => { setSnag({ Category: SNAG_CATEGORIES[0], Description: "" }); setDialog("snag"); }} className={KEY_LINE}><Plus size={12} /> Raise Snag</button>}
          </div>
          <GridMiniTable rows={snags} rowKey={(s: any) => s.Id} empty="No snags raised." cols={[
            { header: "Category", cell: (s: any) => <span className="font-medium">{s.Category}</span> },
            { header: "Defect", cell: (s: any) => <span className="block whitespace-normal max-w-[28rem]">{s.Description}</span> },
            { header: "Raised by", cell: (s: any) => <span className="text-muted-foreground">{s.RaisedByName || "—"}{s.CreatedAt ? ` · ${fmtDate(s.CreatedAt)}` : ""}</span> },
            { header: "Resolved by", cell: (s: any) => <span className="text-muted-foreground">{s.ResolvedByName ? `${s.ResolvedByName}${s.ResolvedAt ? ` · ${fmtDate(s.ResolvedAt)}` : ""}` : "—"}</span> },
            { header: "Status", cell: (s: any) => <GridToneMark text={s.Status === CrmStatus.RESOLVED ? "Resolved" : "Open"} tone={s.Status === CrmStatus.RESOLVED ? "done" : "stopped"} /> },
            { header: "Actions", cell: (s: any) => (s.Status !== CrmStatus.RESOLVED && rights.canEdit ? <button type="button" disabled={saving} onClick={() => run(() => api(`${url}/snags/${s.Id}`, "PUT", { Status: CrmStatus.RESOLVED }), "Snag resolved")} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}>Mark Resolved</button> : null) },
          ]} />
        </>
      )}
      {earlier.length > 0 && <p className="px-4 py-3 text-xs text-muted-foreground tabular-nums">Earlier: {earlier.map((x: any) => `${HANDOVER_LABEL[x.Status] ?? x.Status} (scheduled for ${fmtDate(x.ScheduledDate)})`).join(" · ")}</p>}

      {dialog === "schedule" && (
        <GridDialog onClose={close} icon={Key} width="max-w-2xl" title="Schedule Handover" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving} className={GRID_BTN_BRAND} onClick={() => finish(() => api(HANDOVER_API, "POST", { BookingId: r.BookingId, ScheduledDate: schedule.ScheduledDate || null, Notes: schedule.Notes || null }), "Handover scheduled")}>{saving ? "Scheduling…" : "Schedule Handover"}</button></>}>
          <GridFormSection>
            <GridFormField label="Scheduled for"><DateInput value={schedule.ScheduledDate} onChange={(e) => setSchedule((f) => ({ ...f, ScheduledDate: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Notes"><input type="text" value={schedule.Notes} onChange={(e) => setSchedule((f) => ({ ...f, Notes: e.target.value }))} className={GRID_INPUT} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
      {dialog === "snag" && (
        <GridDialog onClose={close} icon={AlertTriangle} width="max-w-2xl" title="Raise Snag" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving || !snag.Description.trim()} className={GRID_BTN_BRAND} onClick={() => finish(() => api(`${url}/snags`, "POST", snag), "Snag raised")}>{saving ? "Raising…" : "Raise Snag"}</button></>}>
          <GridFormSection>
            <GridFormField label="Category" wide><select value={snag.Category} onChange={(e) => setSnag((f) => ({ ...f, Category: e.target.value }))} className={GRID_INPUT}>{SNAG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></GridFormField>
            <GridFormField label="Defect" required wide><textarea value={snag.Description} rows={3} onChange={(e) => setSnag((f) => ({ ...f, Description: e.target.value }))} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
      {dialog === "cancel" && (
        <GridDialog onClose={close} icon={AlertTriangle} width="max-w-xl" title="Cancel Handover" description={sub}
          footer={<><button onClick={close} className={GRID_BTN}>Keep</button><button disabled={saving} className={cn(GRID_SHEET_KEYS.KEY_RED, "h-9 px-3")} onClick={() => finish(() => api(url, "PUT", { Status: "Cancelled" }), "Handover cancelled")}>{saving ? "Cancelling…" : "Cancel Handover"}</button></>}>
          <p className="text-sm">This handover can't be resumed; a new one would have to be scheduled.</p>
        </GridDialog>
      )}
      {dialog === "complete" && (
        <GridDialog onClose={close} icon={Key} width="max-w-2xl" title="Complete Handover" description="The permanent record of the key handover. Every item is required."
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button disabled={saving} className={GRID_BTN_BRAND} onClick={submitComplete}>{saving ? "Completing…" : "Complete Handover"}</button></>}>
          <GridFormSection>
            <GridFormField label="Handed over on" required><DateInput value={complete.ActualHandoverDate} onChange={(e) => setComplete((f) => ({ ...f, ActualHandoverDate: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Keys handed by" required><SearchableSelect value={complete.KeyHandoverBy} onChange={(v) => setComplete((f) => ({ ...f, KeyHandoverBy: v }))} placeholder={users.length ? "Select staff" : "No staff listed"} searchPlaceholder="Search staff…" options={users} /></GridFormField>
          </GridFormSection>
          <div className="space-y-2">
            {([["FinalDuesCleared", "Every final due is cleared: no payment demand remains on this booking."], ["CustomerAcknowledged", "The customer took possession and received the keys."]] as const).map(([k, text]) => (
              <label key={k} className={cn(NOTE, "cursor-pointer text-[0.8125rem]")}><input type="checkbox" checked={complete[k]} onChange={(e) => setComplete((f) => ({ ...f, [k]: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-primary" /><span>{text}</span></label>
            ))}
          </div>
        </GridDialog>
      )}
    </GridRelated>
  );
}

// ── Signed copies ───────────────────────────────────────────────────────────────
function SignedDocuments({ r }: { r: any }) {
  const notice = usePageRights("crm-possession-notice");
  const handover = usePageRights("crm-handover");
  const qc = useQueryClient();
  const queryKey = [KEY, "documents", r.BookingId];
  const { data } = useQuery({ queryKey, queryFn: () => api(`${DOCS_API}/booking/${r.BookingId}/possession`) });
  const docs: any[] = data?.documents ?? [];
  const types: string[] = data?.types ?? [];
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [type, setType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const canUpload = (notice.canEdit || handover.canEdit) && r.Stage !== "Closed";
  const submit = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      fd.append("DocumentType", type || types[0]);
      const res = await fetchWithAuth(`${DOCS_API}/booking/${r.BookingId}/possession-upload`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Could not upload the file.");
      toast.success("Document uploaded");
      setOpen(false); setFile(null);
      qc.invalidateQueries({ queryKey });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <GridRelated icon={FileText} title="Signed Documents" count={docs.length} action={canUpload ? <button type="button" onClick={() => { setType(types[0] ?? ""); setFile(null); setOpen(true); }} className={KEY_LINE}><Upload size={12} /> Upload</button> : undefined}>
      <GridMiniTable rows={docs} rowKey={(d: any) => d.Id} empty="No signed copy uploaded yet." cols={[
        { header: "Document", cell: (d: any) => <span className="font-medium">{d.DocumentType}</span> },
        { header: "File", cell: (d: any) => <span className="text-muted-foreground">{d.FileName}</span> },
        { header: "Uploaded by", cell: (d: any) => <span className="text-muted-foreground">{d.UploadedByName || "—"}</span> },
        { header: "Uploaded on", cell: (d: any) => <span className="tabular-nums">{fmtDate(d.CreatedAt)}</span> },
        { header: "Actions", cell: (d: any) => <button type="button" onClick={() => setViewing(d)} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}><Eye size={12} /> View</button> },
      ]} />
      {open && (
        <GridDialog onClose={() => setOpen(false)} icon={Upload} width="max-w-2xl" title="Upload Signed Document" description={`${asName(r.ApplicantName)} · ${r.BookingNo}`}
          footer={<><button onClick={() => setOpen(false)} className={GRID_BTN}>Cancel</button><button onClick={submit} disabled={saving || !file} className={GRID_BTN_BRAND}>{saving ? "Uploading…" : "Upload"}</button></>}>
          <GridFormSection>
            <GridFormField label="Document" required><select value={type} onChange={(e) => setType(e.target.value)} className={GRID_INPUT}>{types.map((t) => <option key={t}>{t}</option>)}</select></GridFormField>
            <GridFormField label="File" required hint="PDF or image, up to 25 MB."><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-border file:bg-card file:text-primary file:text-xs file:font-medium" /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
      {viewing && <FilePreview url={`${DOCS_API}/possession-file/${viewing.Id}`} title={viewing.DocumentType} description={viewing.FileName} fileName={viewing.FileName || "document"} onClose={() => setViewing(null)} />}
    </GridRelated>
  );
}

// ── Not ready yet ───────────────────────────────────────────────────────────────
function EligibilityCard({ r }: { r: any }) {
  const hold = gateHold(r);
  const steps = eligibilitySteps(r);
  return (
    <GridRelated icon={ListChecks} title="Steps Before Possession" action={<span className="text-xs text-muted-foreground tabular-nums">{steps.filter((x) => x.ok).length} of {steps.length} complete</span>}>
      <ol>
        {steps.map((x, i) => {
          const current = hold?.step === x.key;
          return (
            <li key={x.key} className={cn("flex items-center gap-3 px-4 h-11 border-b border-border/70 text-[0.8125rem]", current && "bg-primary/5")}>
              {x.ok ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                : <span className={cn("w-[18px] h-[18px] rounded-full flex items-center justify-center text-[0.625rem] font-semibold tabular-nums shrink-0", current ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground")}>{i + 1}</span>}
              <span className={cn("min-w-0 truncate", current ? "font-semibold text-foreground" : x.ok ? "text-foreground" : "text-muted-foreground")}>{x.label}</span>
              <span className={cn("ml-auto text-xs whitespace-nowrap", current ? "font-medium text-primary" : "text-muted-foreground")}>{x.ok ? "Done" : current ? hold!.label : "Pending"}</span>
            </li>
          );
        })}
      </ol>
      <p className="px-4 py-3 text-xs text-muted-foreground">The checklist, possession notice and handover open here once these steps are complete.</p>
    </GridRelated>
  );
}

// ── One booking ─────────────────────────────────────────────────────────────────
function PossessionRecord({ id, onBack, refresh }: { id: string; onBack: () => void; refresh: () => void }) {
  const navigate = useNavigate();
  const [primary, setPrimary] = useState<Primary | null>(null);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: [KEY, "row", id], staleTime: 0, retry: false,
    queryFn: () => api(`${BOARD_API}?bookingId=${encodeURIComponent(id)}&page=1&pageSize=1`).then((d) => d.rows?.[0] ?? null),
  });
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{isError ? translateError((error as Error)?.message) : "Booking not found."}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All bookings</button>
    </div>
  );
  const r = data;
  const required = Number(r.RequiredAmount), collected = Number(r.Collected), balance = Number(r.Balance);
  const focus = r.Stage === "Notice" ? "notice" : r.Stage === "Handover" ? "handover" : r.Stage === "Checklist" ? "check" : null;
  const step = (k: string, node: React.ReactNode) => <div className={cn("rounded-lg", focus === k && "ring-2 ring-primary/50")}>{node}</div>;
  const started = !!r.CheckId || !!r.NoticeId || !!r.HandoverId;
  const notReady = r.Stage === "NotReady" && !started;
  const hold = notReady ? gateHold(r) : null;
  const steps = eligibilitySteps(r);
  const finished = ["Completed", "Closed"].includes(r.Stage);
  const next = nextStep(r).text;
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`${POSSESSION_PAGE} · ${r.BookingNo}`} title={<span className="capitalize">{asName(r.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{STAGE_LABEL[r.Stage]}</span>}
        sub={[r.ProjectName, r.BlockName && `Block ${r.BlockName}`, r.UnitNo && `Unit ${r.UnitNo}`, r.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All bookings</button>
          {hold?.action !== "Open Booking" && <Link to={`/crm/bookings?view=${r.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</Link>}
          {hold?.action !== "Open Payments" && <Link to={`/crm/payments?bookingId=${r.BookingId}`} className={BAND_KEY}><Wallet size={13} /> Payments</Link>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={balance > 0 ? fmtShort(balance) : "Paid in full"} leadNote={balance > 0 ? `balance due of ${fmtShort(required)}` : `${fmtShort(collected)} collected`}
        bar={<Tracker r={r} onDark />}
        figures={[
          { label: "Booking value", value: fmtShort(required), exact: fmtRupees(required), note: "Payable on this booking" },
          { label: "Collected", dot: BAND_DOT.collected, value: fmtShort(collected), exact: fmtRupees(collected), note: collected > required + 0.009 ? `${fmtShort(collected - required)} above booking value` : "Received so far" },
          ...(notReady ? [{ label: "Steps complete", value: `${steps.filter((x) => x.ok).length} of ${steps.length}`, note: "Before possession" }] : [
            { label: "Agreement", dot: r.Gate1_AfsRegistered ? BAND_DOT.collected : BAND_DOT.finance, value: r.AgreementStatus || "Not started", note: r.Gate1_AfsRegistered ? "Agreement for sale" : "Must be registered" },
            { label: "Certificate", dot: r.Gate2_OcCcReceived ? BAND_DOT.collected : BAND_DOT.overdue, value: r.Gate2_OcCcReceived ? "Issued" : "Not issued", note: "Occupancy or Completion" },
          ]),
        ]}
        footer={(
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{finished ? next : <>Next step: <strong className="font-semibold text-white">{next}</strong></>}</span>
            {hold && <button type="button" onClick={() => navigate(hold.path)} className={BAND_KEY_MAIN}>{hold.action} <ArrowRight size={13} /></button>}
            {!hold && primary && <button type="button" onClick={primary.run} className={BAND_KEY_MAIN}>{primary.label} <ArrowRight size={13} /></button>}
          </span>
        )} />
      {notReady ? <EligibilityCard r={r} /> : (
        <>
          {step("check", <ChecklistSection r={r} refresh={refresh} focus={focus === "check"} setPrimary={setPrimary} />)}
          {step("notice", <NoticeSection r={r} refresh={refresh} focus={focus === "notice"} setPrimary={setPrimary} />)}
          {step("handover", <HandoverSection r={r} refresh={refresh} focus={focus === "handover"} setPrimary={setPrimary} />)}
        </>
      )}
      {r.NoticeId && <SignedDocuments r={r} />}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────
const CrmPossession: React.FC = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  const list = useCrmListState({ pageSize, defaultSort: { key: "Priority", dir: "asc" } });
  const [prefs, setPrefs] = useGridPrefs("crm-possession-cols-v1", COLS);
  const open = sp.get("booking");
  const openBooking = (id: number) => setSp((p) => { p.set("booking", String(id)); return p; });
  const closeBooking = () => setSp((p) => { p.delete("booking"); return p; });

  // Links from elsewhere name the booking as ?bookingId=.
  const linked = sp.get("bookingId");
  useEffect(() => {
    if (linked) setSp((p) => { p.delete("bookingId"); p.delete("open"); p.set("booking", linked); return p; }, { replace: true });
  }, [linked, setSp]);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, "list", list.query], queryFn: () => fetchBoard(list.query), staleTime: 0, enabled: !open });
  const board = useSticky(data);
  const counts = board?.counts ?? {};
  const s = board?.summary ?? {};
  const refresh = () => [KEY, ...OTHER_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const tabs = useMemo(() => ["All", "NotReady", "Checklist", "Notice", "Handover", "Completed", ...(counts.Closed ? ["Closed"] : [])], [counts.Closed]);
  const running = (counts.Checklist ?? 0) + (counts.Notice ?? 0) + (counts.Handover ?? 0);
  const completed = counts.Completed ?? 0;
  const open_ = (counts.All ?? 0) - (counts.Closed ?? 0);
  const attention = Number(s.Overdue ?? 0) + Number(s.Disputed ?? 0) + Number(s.OpenSnags ?? 0);

  const handleExport = async () => {
    setExporting(true);
    try {
      const first = await fetchBoard({ ...list.query, page: 1, pageSize: 100 });
      let out = first.rows;
      for (let n = 2; out.length < first.total; n++) { const more = await fetchBoard({ ...list.query, page: n, pageSize: 100 }); if (!more.rows.length) break; out = out.concat(more.rows); }
      exportGrid(out, COLS, `possession-${list.status}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", POSSESSION_PAGE]} />
      {open ? <PossessionRecord key={open} id={open} onBack={closeBooking} refresh={refresh} /> : (
        <>
          <MoneyBand eyebrow="CRM" title={POSSESSION_PAGE} sub="Pre-possession checklist, possession notice and handover for every booking."
            actions={<button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>}
            lead={`${completed} of ${open_}`} leadNote="bookings handed over"
            bar={<CollectionBar onDark due={open_} collected={completed} finance={running} recorded={0} />}
            figures={[
              { label: "Collected", dot: BAND_DOT.collected, value: fmtShort(s.Collected), exact: fmtRupees(s.Collected ?? 0), note: "On open bookings" },
              { label: "Balance due", dot: Number(s.Balance) > 0 ? BAND_DOT.overdue : undefined, value: fmtShort(s.Balance), exact: fmtRupees(s.Balance ?? 0), note: "On open bookings" },
              { label: "In progress", dot: BAND_DOT.finance, value: String(running), note: `${counts.NotReady ?? 0} not ready to start` },
              { label: "Needs attention", dot: attention > 0 ? BAND_DOT.overdue : undefined, value: String(attention), note: attention > 0 ? `${s.Overdue ?? 0} overdue · ${s.Disputed ?? 0} disputed · ${s.OpenSnags ?? 0} snags` : "Nothing overdue or disputed", alert: attention > 0 },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<string> label={POSSESSION_PAGE} active={list.status} onChange={list.setStatus} tabs={tabs.map((k) => ({ key: k, label: k === "All" ? "All bookings" : STAGE_LABEL[k], count: board ? counts[k] ?? 0 : null }))} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking, unit or mobile" />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={board?.rows ?? []} rowKey={(r) => r.BookingId} noRowNumbers
              loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openBooking(r.BookingId)}
              empty={list.hasFilters ? "No booking matches these filters." : "No bookings yet."}
              page={list.page} pageSize={pageSize} total={board?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          </div>
        </>
      )}
    </div>
  );
};

export default CrmPossession;
