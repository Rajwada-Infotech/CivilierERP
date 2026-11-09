import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, CheckCircle2, XCircle, ExternalLink, Lock, Pencil, ScrollText, UserCircle2,
  FileText, Upload, Send, AlertCircle, Info, ArrowRight, ShieldAlert, RefreshCw, History, ArrowLeft, Download, Copy, RotateCcw, Home, BarChart3, CalendarDays, Clock, Landmark, FolderClock, X,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridGuidance, GridHighlights, GridMetric, GridPath, GridProgress,
  GridRelated, GridSavedViews, GridSearch, GridSegment, GridStatusPill, GridTabs, GridToneMark, exportGrid, gridListMeta, gridVisibleCols,
  resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange, type GridGuidanceTone,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { TlRow } from "./agreement/Timeline";
import {
  API, DEED_TABS, DeedTab, EMPTY_FORM, CRM_REGISTRY_APPROVER_ROLES, LOG_ACTION_LABEL, STATUSES,
  deedTone, roleKey, fmtDate, deedDocumentProgress, deedStepStates, fetchBookingContext, fetchDeedsList, fetchAllDeeds,
  fetchEligible, fetchLegalExecutives, rowDeedProgress, deedCurrentStep, deedAlerts, DEED_ALERTS, DEED_STEP_NAMES, type DeedAlertTone,
} from "./salesDeed/config";
import { DeedDetailsSection, DocumentCentre, Panel, StepBox, auditToHistory } from "./salesDeed/parts";
import { QueryPaymentTab, useDeedQueryPayment } from "./salesDeed/QueryPaymentTab";
import { RegistryTab, useDeedRegistry } from "./salesDeed/RegistryTab";

import { useUrlParam } from "@/hooks/useUrlParam";

// Drawn with the CRM record kit (components/crm/CrmDataTable.tsx); the keys, labels, inputs and rules its tabs and
// dialogs use map onto it, and the sheet's status mark becomes the kit's pill.
const { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } = GRID_SHEET_KEYS;
const SheetMark = GridToneMark;
const ALL = "All";
const DEED_DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const DEED_PREFS_KEY = "crm-sales-deed-grid";
const DEED_VIEWS_KEY = "crm-sales-deed-saved-views";
const DEED_INSIGHTS_KEY = "crm-sales-deed-insights";
const BOARD_STEP = 30;
const ALERT_INK: Record<DeedAlertTone, string> = {
  stopped: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  moving: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
};
const AlertPill: React.FC<{ tone: DeedAlertTone; label: string }> = ({ tone, label }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full border text-[0.6875rem] font-medium whitespace-nowrap", ALERT_INK[tone])}>{label}</span>
);

const DEED_COLS: GridCol<any>[] = [
  { id: "no", label: "Deed", sortKey: "DeedNo", locked: true, cell: (d) => <span className="font-semibold text-primary hover:underline tabular-nums">{d.DeedNo}{d.VersionNo > 1 ? <span className="text-muted-foreground font-normal"> v{d.VersionNo}</span> : null}</span>, csv: (d) => d.DeedNo },
  {
    id: "customer", label: "Customer", sortKey: "ApplicantName",
    cell: (d) => <span className="truncate block max-w-[16rem]" onClick={(e) => e.stopPropagation()}><ApplicantNames name={d.ApplicantName} bookingId={d.BookingId} applicationId={d.ApplicationId} /></span>,
    csv: (d) => d.ApplicantName,
  },
  { id: "booking", label: "Booking", sortKey: "BookingNo", cell: (d) => <span className="tabular-nums">{d.BookingNo}{d.UnitNo ? <span className="text-muted-foreground"> · {d.UnitNo}</span> : null}</span>, csv: (d) => [d.BookingNo, d.UnitNo].filter(Boolean).join(" · ") },
  {
    id: "stage", label: "Stage",
    cell: (d) => d.BookingStatus === "Cancelled" ? <span className="text-destructive font-semibold">Booking cancelled: locked</span> : deedCurrentStep(d),
    csv: (d) => (d.BookingStatus === "Cancelled" ? "Booking cancelled" : deedCurrentStep(d)),
  },
  {
    id: "alerts", label: "Needs action",
    cell: (d) => { const al = deedAlerts(d); return al.length ? <span className="inline-flex gap-1">{al.slice(0, 2).map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}{al.length > 2 && <span className="text-[0.6875rem] text-muted-foreground">+{al.length - 2}</span>}</span> : <span className="text-muted-foreground">—</span>; },
    csv: (d) => deedAlerts(d).map((x) => x.label).join("; "),
  },
  { id: "legal", label: "Legal executive", sortKey: "LegalExecutiveName", cell: (d) => d.LegalExecutiveName || <span className="text-amber-700 dark:text-amber-300 font-medium">Not assigned</span>, csv: (d) => d.LegalExecutiveName },
  { id: "papers", label: "Papers", cell: (d) => { const f = rowDeedProgress(d); return <GridProgress done={f.uploaded} total={f.required} title={`${f.uploaded} of ${f.required} mandatory papers uploaded`} />; }, csv: (d) => `${rowDeedProgress(d).uploaded}/${rowDeedProgress(d).required}` },
  { id: "deedDate", label: "Deed date", sortKey: "DeedDate", cell: (d) => <span className="tabular-nums">{fmtDate(d.DeedDate)}</span>, csv: (d) => fmtDate(d.DeedDate) },
  { id: "deadline", label: "Registration deadline", sortKey: "RegistrationDeadline", cell: (d) => <span className={cn("tabular-nums", d.Status === "Overdue" && "text-destructive font-semibold")}>{fmtDate(d.RegistrationDeadline)}</span>, csv: (d) => fmtDate(d.RegistrationDeadline) },
  { id: "value", label: "Deed value", sortKey: "DeedValue", align: "right", cell: (d) => <span className="tabular-nums">{d.DeedValue ? fmtRupees(d.DeedValue) : "—"}</span>, csv: (d) => d.DeedValue },
  { id: "status", label: "Status", sortKey: "Status", cell: (d) => <GridStatusPill status={d.Status} />, csv: (d) => d.Status },
  { id: "stamp", label: "Stamp duty", sortKey: "StampDuty", align: "right", hiddenByDefault: true, cell: (d) => <span className="tabular-nums">{d.StampDuty ? fmtRupees(d.StampDuty) : "—"}</span>, csv: (d) => d.StampDuty },
  { id: "qp", label: "Stamp duty payment", hiddenByDefault: true, cell: (d) => d.ListQpStatus ? <GridStatusPill status={d.ListQpStatus} /> : "—", csv: (d) => d.ListQpStatus },
  { id: "registry", label: "Registry", hiddenByDefault: true, cell: (d) => d.ListRegistryStatus ? <GridStatusPill status={d.ListRegistryStatus} /> : "—", csv: (d) => d.ListRegistryStatus },
  { id: "regNo", label: "Registration no.", hiddenByDefault: true, cell: (d) => <span className="tabular-nums">{d.RegistrationNo || "—"}</span>, csv: (d) => d.RegistrationNo },
  { id: "regDate", label: "Registered on", sortKey: "RegistrationDate", hiddenByDefault: true, cell: (d) => <span className="tabular-nums">{fmtDate(d.RegistrationDate)}</span>, csv: (d) => fmtDate(d.RegistrationDate) },
];

// ── Insights and board (counted on the server: GET /insights, GET /board) ─────
interface DeedInsightsData {
  total: number; registered: number; open: number; avgDaysAtStep: number | null; byStep: number[];
  alerts: Record<string, number>;
  thisMonth: { made: number; deedDates: number; registered: number };
  deadlines: { overdue: number; thisWeek: number; thisMonth: number; later: number; notSet: number; upcoming: any[] };
  money: { deedValue: number; stampDuty: number; registrationFee: number; stampDutyCredit: number; netPayable: number };
  workload: { name: string | null; open: number; oldestDays: number | null }[];
  longest: { Id: number; DeedNo: string; ApplicantName: string; StepIndex: number; DaysAtStep: number }[];
}
const daysText = (d: number | null | undefined) => (d == null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`);

const InsightBar: React.FC<{ label: React.ReactNode; value: number; max: number; tone?: string; onClick?: () => void; note?: string }> = ({ label, value, max, tone = "bg-primary", onClick, note }) => (
  <button type="button" onClick={onClick} disabled={!onClick} title={note}
    className="w-full grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 py-1 text-left text-xs enabled:hover:bg-muted/50 rounded">
    <span className="truncate text-muted-foreground">{label}</span>
    <span className="h-2 rounded-full bg-muted overflow-hidden">
      <span className={cn("block h-full rounded-full", tone)} style={{ width: `${max ? Math.max(value ? 4 : 0, Math.round((value / max) * 100)) : 0}%` }} />
    </span>
    <span className="tabular-nums text-right font-semibold">{value.toLocaleString("en-IN")}</span>
  </button>
);

const DeedInsights: React.FC<{ data?: DeedInsightsData; loading: boolean; onOpen: (id: number) => void; onBoard: () => void; onAlert: (key: string) => void }> = ({ data, loading, onOpen, onBoard, onAlert }) => {
  if (loading && !data) {
    return <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className={cn(GRID_CARD, "h-52 animate-pulse bg-muted/40")} />)}</div>;
  }
  if (!data) return null;
  const stepMax = Math.max(1, data.registered, ...data.byStep);
  const loadMax = Math.max(1, ...data.workload.map((w) => w.open));
  const dl = data.deadlines;
  const dlTotal = dl.overdue + dl.thisWeek + dl.thisMonth + dl.later + dl.notSet;
  const segs: [string, number, string][] = [
    ["Overdue", dl.overdue, "bg-rose-500"], ["This week", dl.thisWeek, "bg-amber-500"], ["Later this month", dl.thisMonth, "bg-sky-500"],
    ["Later", dl.later, "bg-emerald-500"], ["No deadline set", dl.notSet, "bg-muted-foreground/40"],
  ];
  const money = data.money;
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <section className={cn(GRID_CARD, "p-4")}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5"><BarChart3 size={14} className="text-primary" /> Deeds by step</h3>
          <button type="button" className="text-xs text-primary hover:underline" onClick={onBoard}>Open board</button>
        </div>
        {DEED_STEP_NAMES.slice(1).map((name, k) => <InsightBar key={name} label={name} value={data.byStep[k + 1] ?? 0} max={stepMax} onClick={onBoard} />)}
        <InsightBar label="Registered" value={data.registered} max={stepMax} tone="bg-emerald-600" />
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><AlertCircle size={14} className="text-destructive" /> Needs action</h3>
        {DEED_ALERTS.every((a) => !data.alerts[a.key]) ? <p className="text-xs text-muted-foreground py-6 text-center">Nothing needs action right now.</p> : (
          <ul className="space-y-1.5">
            {DEED_ALERTS.filter((a) => data.alerts[a.key]).map((a) => (
              <li key={a.key}>
                <button type="button" onClick={() => onAlert(a.key)} className="w-full flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted/50 text-left" title="Show these deeds">
                  <AlertPill tone={a.tone} label={a.label} />
                  <span className="text-sm font-bold tabular-nums">{data.alerts[a.key].toLocaleString("en-IN")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><UserCircle2 size={14} className="text-primary" /> Legal executive workload</h3>
        {data.workload.length === 0 ? <p className="text-xs text-muted-foreground py-6 text-center">No open deeds.</p> : (
          <div className="max-h-48 overflow-y-auto pr-1">
            {data.workload.map((w) => (
              <InsightBar key={w.name ?? "none"} label={w.name ?? "Not assigned"} value={w.open} max={loadMax} tone={w.name ? "bg-primary" : "bg-amber-500"}
                note={`${w.open} open · oldest ${daysText(w.oldestDays)} at its step`} />
            ))}
          </div>
        )}
      </section>

      <section className={cn(GRID_CARD, "p-4 lg:col-span-2 xl:col-span-1")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-3"><CalendarDays size={14} className="text-primary" /> Registration deadlines</h3>
        <div className="flex h-3 rounded-full overflow-hidden bg-muted" role="img" aria-label="Open deeds by registration deadline">
          {segs.map(([l, v, tone]) => v > 0 && <span key={l} className={tone} style={{ width: `${(v / Math.max(1, dlTotal)) * 100}%` }} title={`${l}: ${v}`} />)}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
          {segs.map(([l, v, tone]) => (
            <span key={l} className="flex items-center gap-1.5 text-[0.6875rem]"><span className={cn("w-2 h-2 rounded-full", tone)} /><span className="text-muted-foreground truncate">{l}</span><span className="ml-auto font-semibold tabular-nums">{v}</span></span>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground mb-1">Next deadlines</div>
        <ul className="space-y-0.5">
          {dl.upcoming.length === 0 && <li className="text-xs text-muted-foreground">No deadline set on any open deed.</li>}
          {dl.upcoming.map((u: any) => {
            const late = new Date(String(u.RegistrationDeadline).slice(0, 10)) < new Date(new Date().toDateString());
            return (
              <li key={u.Id}>
                <button type="button" onClick={() => onOpen(u.Id)} className="w-full flex items-center justify-between gap-2 text-xs hover:bg-muted/50 rounded px-1 py-0.5 text-left">
                  <span className="truncate"><span className="text-primary tabular-nums">{u.DeedNo}</span> <span className="text-muted-foreground">· {u.ApplicantName}</span></span>
                  <span className={cn("tabular-nums shrink-0", late ? "text-destructive font-semibold" : "font-medium")}>{fmtDate(u.RegistrationDeadline)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-3"><Landmark size={14} className="text-primary" /> Money</h3>
        <dl className="grid grid-cols-2 gap-2">
          {([
            ["Deed value", money.deedValue, false], ["Stamp duty", money.stampDuty, false], ["Registration fee", money.registrationFee, false],
            ["AFS credit applied", money.stampDutyCredit, false], ["Net payable to government", money.netPayable, true],
          ] as [string, number, boolean][]).map(([l, v, strong]) => (
            <div key={l} className={cn("rounded-md px-2.5 py-2", strong ? "col-span-2 bg-primary/10" : "bg-muted/50")}>
              <dt className="text-[0.6875rem] text-muted-foreground">{l}</dt>
              <dd className={cn("tabular-nums mt-0.5", strong ? "text-base font-bold" : "text-sm font-semibold")}>{fmtRupees(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">Across the deeds shown, cancelled ones left out. Net payable is stamp duty and fee less the AFS stamp duty already paid.</p>
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><Clock size={14} className="text-primary" /> This month</h3>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([["New deeds", data.thisMonth.made], ["Deed dates", data.thisMonth.deedDates], ["Registered", data.thisMonth.registered]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="rounded-md bg-muted/50 px-2 py-2 text-center">
              <div className="text-lg font-bold tabular-nums">{v.toLocaleString("en-IN")}</div>
              <div className="text-[0.6875rem] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mb-1">Longest at their step{data.avgDaysAtStep != null ? ` · average ${daysText(data.avgDaysAtStep)}` : ""}</div>
        <ul className="space-y-0.5">
          {data.longest.length === 0 && <li className="text-xs text-muted-foreground">No open deeds.</li>}
          {data.longest.map((x) => (
            <li key={x.Id}>
              <button type="button" onClick={() => onOpen(x.Id)} className="w-full flex items-center justify-between gap-2 text-xs hover:bg-muted/50 rounded px-1 py-0.5 text-left">
                <span className="truncate"><span className="text-primary tabular-nums">{x.DeedNo}</span> <span className="text-muted-foreground">· {DEED_STEP_NAMES[x.StepIndex] ?? "—"}</span></span>
                <span className="tabular-nums font-semibold shrink-0">{daysText(x.DaysAtStep)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

/** One column per step; each column holds its count and its longest-waiting deeds, from the server. */
const DeedBoard: React.FC<{ columns?: { index: number; count: number; cards: any[] }[]; limit: number; loading: boolean; onMore: () => void; onOpen: (id: number) => void; activeId: number | null }> = ({ columns, limit, loading, onMore, onOpen, activeId }) => {
  if (loading && !columns) return <div className="h-80 rounded-lg bg-muted/40 animate-pulse" />;
  const cols = (columns ?? []).filter((c) => c.index > 0);
  const more = cols.some((c) => c.count > c.cards.length);
  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {cols.map((col) => (
            <section key={col.index} className="w-64 shrink-0 rounded-lg bg-muted/40 border border-border flex flex-col max-h-[calc(100vh-20rem)]">
              <header className="px-3 h-10 flex items-center justify-between gap-2 border-b border-border">
                <h3 className="text-xs font-bold truncate">{DEED_STEP_NAMES[col.index]}</h3>
                <span className="text-[0.6875rem] tabular-nums px-1.5 rounded-full bg-card border border-border">{col.count.toLocaleString("en-IN")}</span>
              </header>
              <div className="p-2 space-y-2 overflow-y-auto">
                {col.cards.length === 0 && <p className="text-[0.6875rem] text-muted-foreground text-center py-4">None here</p>}
                {col.cards.map((d) => {
                  const alerts = deedAlerts(d);
                  return (
                    <button key={d.Id} type="button" onClick={() => onOpen(d.Id)}
                      className={cn(GRID_CARD, "w-full text-left p-2.5 hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", activeId === d.Id && "border-primary")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-primary tabular-nums truncate">{d.DeedNo}</span>
                        <span className={cn("text-[0.6875rem] tabular-nums shrink-0", d.A_overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>{daysText(d.DaysAtStep)}</span>
                      </div>
                      <div className="text-[0.8125rem] font-medium truncate mt-0.5">{d.ApplicantName}</div>
                      <div className="text-[0.6875rem] text-muted-foreground truncate">{[d.ProjectName, d.UnitNo].filter(Boolean).join(" · ") || d.BookingNo}</div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[0.6875rem] truncate">{d.LegalExecutiveName || <span className="text-amber-700 dark:text-amber-300">No legal executive</span>}</span>
                        {Number(d.MandatoryDocCount) > 0 && <GridProgress done={Number(d.MandatoryUploadedCount) || 0} total={Number(d.MandatoryDocCount)} />}
                      </div>
                      {d.RegistrationDeadline && <div className={cn("mt-1 text-[0.6875rem] tabular-nums", d.A_overdue ? "text-destructive" : "text-muted-foreground")}>Register by {fmtDate(d.RegistrationDeadline)}</div>}
                      {alerts.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{alerts.map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}</div>}
                    </button>
                  );
                })}
                {col.count > col.cards.length && <p className="text-[0.6875rem] text-muted-foreground text-center py-1">+{(col.count - col.cards.length).toLocaleString("en-IN")} more</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
      {more && (
        <div className="flex justify-center pt-1">
          <button type="button" className={GRID_BTN} onClick={onMore}>Show {limit} more in each column</button>
        </div>
      )}
    </div>
  );
};

const CrmSalesDeed: React.FC = () => {
  const ask = useSheetAsk();
  const rights = usePageRights("crm-sales-deed");
  // Query Payment and Registry were their own pages; either their own right or the deed's works their tabs.
  const qpRights = usePageRights("crm-query-payment");
  const regRights = usePageRights("crm-registry");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deedIdParam = sp.get("deedId");
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEED_DEFAULT_SORT, defaultStatus: ALL });
  // The deed-date filter, this page's own beyond the common list ones.
  const [deedDates, setDeedDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  // "Needs action" narrows the list to one alert's deeds (worked out on the server).
  const [alertKey, setAlertKeyRaw] = useState<string>("");
  const setAlertKey = (k: string) => { setAlertKeyRaw(k); s.setPage(1); };
  const setDeedDates = (v: GridDateRange) => { setDeedDatesRaw(v); s.setPage(1); };
  const listFiltered = s.hasFilters || deedDates.preset !== "any" || !!alertKey;
  const clearFilters = () => { s.reset(); setDeedDatesRaw(GRID_ANY_DATE); setAlertKeyRaw(""); };
  const [selectedRows, setSelectedRows] = useState<Map<string | number, any>>(new Map());
  const view: "list" | "board" = sp.get("view") === "board" ? "board" : "list";
  const setView = (v: "list" | "board") => setSp((p) => { if (v === "board") p.set("view", "board"); else p.delete("view"); return p; }, { replace: true });
  const [showInsights, setShowInsightsRaw] = useState<boolean>(() => { try { return localStorage.getItem(DEED_INSIGHTS_KEY) !== "0"; } catch { return true; } });
  const setShowInsights = (on: boolean) => { setShowInsightsRaw(on); try { localStorage.setItem(DEED_INSIGHTS_KEY, on ? "1" : "0"); } catch { /* not kept: fine */ } };
  const [boardLimit, setBoardLimit] = useState(BOARD_STEP);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [stepSaving, setStepSaving] = useState(false);
  const [deedDetailSaving, setDeedDetailSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(deedIdParam && /^\d+$/.test(deedIdParam) ? Number(deedIdParam) : null);
  const [sendingToCustomer, setSendingToCustomer] = useState(false);
  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);

  const [execForm, setExecForm] = useState({ ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" });
  const [execSaving, setExecSaving] = useState(false);
  const [execEditing, setExecEditing] = useState(false);

  // In the address (?tab=), so a refresh or a shared link opens the same tab.
  const [activeTab, setActiveTab] = useUrlParam<DeedTab>("tab", "Timeline", DEED_TABS);
  const [assigningLegal, setAssigningLegal] = useState(false);
  const [selectedLegalExec, setSelectedLegalExec] = useState("");
  const [requestingDoc, setRequestingDoc] = useState(false);

  // Documents open in an in-page preview (image / PDF) fetched with the page's auth; a bare window.open can't carry
  // the bearer token.
  const deedFileUrl = (doc: any) => `${API}/documents/file/${doc.Id}`;

  const listQs = useMemo(() => {
    const p = listParams(s.query, ALL);
    const { from, to } = resolveGridDateRange(deedDates);
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    if (alertKey) p.set("alert", alertKey);
    return p;
  }, [s.query, deedDates, alertKey]);
  // The insights and the board cover every deed under the search and filters (any status, no paging).
  const scopeQs = useMemo(() => {
    const p = new URLSearchParams(listQs);
    ["page", "pageSize", "status", "sortKey", "sortDir", "alert"].forEach((k) => p.delete(k));
    return p;
  }, [listQs]);
  const getJson = async (url: string) => {
    const r = await fetchWithAuth(url);
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || `Could not load (${r.status}).`);
    return d;
  };
  const { data: insights, isFetching: insightsLoading } = useQuery({
    queryKey: ["crm-sales-deed", "insights", scopeQs.toString()],
    queryFn: () => getJson(`${API}/insights?${scopeQs}`) as Promise<DeedInsightsData>,
    staleTime: 60_000,
    enabled: detailId == null && showInsights,
  });
  const { data: board, isFetching: boardLoading } = useQuery({
    queryKey: ["crm-sales-deed", "board", scopeQs.toString(), boardLimit],
    queryFn: () => getJson(`${API}/board?${scopeQs}&limit=${boardLimit}`) as Promise<{ columns: { index: number; count: number; cards: any[] }[] }>,
    staleTime: 30_000,
    enabled: detailId == null && view === "board",
  });
  const { data: listData, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-sales-deed", listQs.toString()], queryFn: () => fetchDeedsList(listQs), staleTime: 30_000,
  });
  const listResult = useSticky(listData);
  const [gridPrefs, setGridPrefs] = useGridPrefs(DEED_PREFS_KEY, DEED_COLS);
  const deeds = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);
  const { data: eligible = [] } = useQuery({
    queryKey: ["crm-sales-deed-eligible"], queryFn: fetchEligible, staleTime: 60_000, enabled: rights.canCreate,
  });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-sales-deed-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });

  const { data: deedDetail, isError: detailIsError, error: detailError } = useQuery({
    queryKey: ["crm-sale-deed-detail", detailId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${detailId}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Could not load the sale deed (${r.status}).`);
      return data;
    },
    enabled: detailId != null,
    staleTime: 15_000,
    retry: false,
  });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchLegalExecutives, staleTime: 300_000 });

  const detail = deedDetail?.deed ?? (detailId != null ? (deeds as any[]).find((d: any) => d.Id === detailId) : null);

  const { data: detailContext } = useQuery({
    queryKey: ["crm-sales-deed-context", detail ? String(detail.BookingId) : ""],
    queryFn: () => fetchBookingContext(String(detail?.BookingId ?? "")),
    enabled: detail?.BookingId != null,
  });
  const { data: qpDetail } = useDeedQueryPayment(detail?.BookingId);
  const { registry, history: registryHistory } = useDeedRegistry(detail?.BookingId);

  const role = roleKey(currentUser?.role);
  const legalOrInbox = CRM_REGISTRY_APPROVER_ROLES.includes(role) || canDoAction("approval-inbox" as any, "edit");
  const qpCanCreate = rights.canCreate || qpRights.canCreate;
  const qpCanEdit = rights.canEdit || qpRights.canEdit;
  const regCanCreate = rights.canCreate || regRights.canCreate;
  const regCanEdit = rights.canEdit || regRights.canEdit;

  const agreementRegistered = context?.agreement?.Status === "Registered";
  const isLoanFinanced = context?.booking?.FinancingType === "LoanFinanced";
  const loanCleared = !context?.loanBlockReason;
  const handoverCleared = !context?.requiresHandoverBeforeDeed || context?.handoverStatus === "Completed";
  const canCreate = !!form.BookingId && agreementRegistered && loanCleared && handoverCleared && !contextLoading;

  const bookingCancelled = detail?.BookingStatus === "Cancelled";
  const progressLocked = detail?.Status === CrmStatus.REGISTERED || detail?.Status === CrmStatus.CANCELLED;
  // Every change to the deed needs the edit right (the server refuses otherwise; most keys used to show to anyone).
  const canWork = rights.canEdit && !bookingCancelled;

  // Mirrors the server's requireAssignedLegalOrApprover: the deed's documents are worked by its assigned Legal
  // Executive (or Legal / admin), not anyone with page rights.
  const canActAsLegal = !detail?.LegalExecutiveId
    ? false
    : CRM_REGISTRY_APPROVER_ROLES.includes(role) || String(detail.LegalExecutiveId) === String(currentUser?.id ?? "");
  const legalLockReason = !detail?.LegalExecutiveId
    ? "Assign a Legal Executive to this deed first"
    : "Locked to the assigned Legal Executive (or Legal/admin)";

  // Deep links: ?deedId opens that deed; ?bookingId opens the booking's deed (found on the server: the page used to
  // look for it in the 20 rows on screen) or, when it has none and is eligible, the New deed dialog.
  useEffect(() => {
    if (deepLinkDone || !deepLinkBookingId || deedIdParam) return;
    let stop = false;
    (async () => {
      const r = await fetchWithAuth(`${API}/booking/${deepLinkBookingId}/deed`).catch(() => null);
      const row = r?.ok ? await r.json().catch(() => null) : null;
      if (stop) return;
      if (row?.Id) { setDeepLinkDone(true); selectDetail(row.Id, true); return; }
      if (rights.canCreate && (eligible as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
        setDeepLinkDone(true);
        setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
        setDialogOpen(true);
      }
    })();
    return () => { stop = true; };
  }, [deepLinkBookingId, deedIdParam, deepLinkDone, eligible.length, rights.canCreate]);


  useEffect(() => {
    if (!context?.agreement) return;
    const credit = Number(context.agreement.AfsStampDuty ?? 0) || 0;
    if (credit > 0) setForm((f) => ({ ...f, StampDutyCredit: f.StampDutyCredit === "" ? String(credit) : f.StampDutyCredit }));
  }, [context?.agreement?.AfsStampDuty]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-context"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    if (detailId != null) qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });
  };
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });

  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!canCreate) { toast.error("This booking isn't eligible yet"); return; }
    setSaving(true);
    try {
      const data = await send(API, "POST", { ...form, BookingId: parseInt(form.BookingId) });
      toast.success(`Sale deed ${data.DeedNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const backToList = () => {
    setDetailId(null);
    setSp((p) => { p.delete("deedId"); p.delete("tab"); p.delete("bookingId"); return p; }, { replace: true });
  };
  const selectDetail = (id: number, keepTab = false) => {
    setExecEditing(false);
    setSelectedLegalExec("");
    setDetailId(id);
    setSp((p) => { p.set("deedId", String(id)); return p; }, { replace: true });
    if (!keepTab) setActiveTab("Timeline");
  };

  const startExec = () => {
    setExecForm({
      ExecutedBy: detail?.ExecutedBy || "", RegistrationNo: detail?.RegistrationNo || "",
      BookNo: detail?.BookNo || "", PartNo: detail?.PartNo || "",
      RegistrationDate: detail?.RegistrationDate ? String(detail.RegistrationDate).slice(0, 10) : "",
      PossessionDate: detail?.PossessionDate ? String(detail.PossessionDate).slice(0, 10) : "",
    });
    setExecEditing(true);
  };

  const saveFields = (fields: Record<string, any>) => send(`${API}/${detailId}`, "PUT", fields);

  const handleSaveDeedDetails = async (fields: Record<string, string>) => {
    setDeedDetailSaving(true);
    try { await saveFields(fields); toast.success("Deed details updated"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setDeedDetailSaving(false); }
  };
  const handleSaveIndex2 = async (date: string) => {
    setStepSaving(true);
    try { await saveFields({ Index2ReceivedDate: date || null }); toast.success("Index II received date saved"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStepSaving(false); }
  };
  const handleSaveExecution = async () => {
    if (!execForm.ExecutedBy.trim()) { toast.error("Enter who executed the deed"); return; }
    setExecSaving(true);
    try {
      const data = await saveFields(execForm);
      toast.success(`Deed status: ${data?.status || "updated"}`);
      setExecEditing(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ["crm-handover-eligible"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExecSaving(false); }
  };
  const handleSendToCustomer = async () => {
    setSendingToCustomer(true);
    try { await send(`${API}/${detailId}/send-to-customer`, "PUT"); toast.success("Sent to customer for approval"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSendingToCustomer(false); }
  };
  const handleProxy = async (path: "proxy-customer-approve" | "proxy-customer-recheck", method: ProxyMethod, remarks: string) => {
    setProxySaving(true);
    try {
      await send(`${API}/${detailId}/${path}`, "PUT", { ProxyMethod: method, ProxyRemarks: remarks });
      toast.success(path === "proxy-customer-approve" ? "Customer approval recorded" : "Customer recheck request recorded");
      setProxyApproveDialog(false); setProxyRecheckDialog(false);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };
  const handleAssignLegal = async (legalExecutiveId: string) => {
    setAssigningLegal(true);
    try {
      await send(`${API}/${detailId}/assign-legal`, "PUT", { LegalExecutiveId: legalExecutiveId || null });
      toast.success("Legal executive assigned");
      setSelectedLegalExec("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setAssigningLegal(false); }
  };
  // The document centre's calls (the server's own rules decide who may do each).
  const docAttach = (doc: any, file: File) => { const fd = new FormData(); fd.append("file", file); return send(`${API}/${detailId}/documents/${doc.Id}/attach`, "POST", fd); };
  const docUpload = (files: File[], documentType: string, label?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("DocumentType", documentType);
    if (label) fd.append("Label", label);
    return send(`${API}/${detailId}/documents/upload`, "POST", fd);
  };
  const docReview = (doc: any, verify: boolean, remarks?: string) =>
    send(`${API}/${detailId}/documents/${doc.Id}`, "PUT", verify ? { Status: "Verified" } : { Status: "Rejected", Remarks: remarks });
  const docHistory = async (doc: any) => {
    const r = await fetchWithAuth(`${API}/documents/${doc.Id}/audit`);
    return r.ok ? auditToHistory(await r.json()) : [];
  };
  // Asks for a mandatory document: the way out when the deed has none to approve on.
  const handleRequestDoc = async (documentType: string, label?: string) => {
    setRequestingDoc(true);
    try {
      await send(`${API}/${detailId}/documents/request`, "POST", { DocumentType: documentType, Label: label, IsMandatory: true });
      toast.success("Mandatory document requested");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };
  const handleResubmit = async () => {
    try { await send(`${API}/${detailId}/submit`, "PUT"); toast.success("Submitted for senior approval"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };
  const handleCancelDeed = async () => {
    if (!(await ask.confirm(`Cancel sale deed ${detail?.DeedNo}?`, { okLabel: "Cancel deed", cancelLabel: "Keep it", danger: true }))) return;
    try { await send(`${API}/${detailId}/cancel`, "PUT"); toast.success("Sale deed cancelled"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };


  return (
    <>
      <Breadcrumbs items={detailId != null ? ["Dashboard", "CRM", "Sale Deeds", "Record"] : ["Dashboard", "CRM", "Sale Deeds"]} />
      {ask.node}
      <CrmAppPage icon={ScrollText} section="CRM · Legal & Possession" title="Sale Deeds"
        subtitle={detailId != null ? undefined : "Conveyance deeds transferring legal ownership (s.54 TPA 1882): legal paperwork, senior, customer and director approval, stamp duty, execution, then registry."}
        actions={<>
          {detailId != null && <button type="button" onClick={backToList} className={GRID_BTN}><ArrowLeft size={13} /> All sale deeds</button>}
          {rights.canCreate && <button type="button" onClick={() => setDialogOpen(true)} className={GRID_BTN_BRAND}><Plus size={13} /> New deed</button>}
        </>}>

        {detailId == null && showInsights && (
          <DeedInsights data={insights} loading={insightsLoading} onOpen={(id) => selectDetail(id)} onBoard={() => setView("board")}
            onAlert={(k) => { setView("list"); setAlertKey(k); }} />
        )}

        {/* The list stays mounted while a record is open, so its tab, search, filters, sort and page survive the round trip. */}
        <div hidden={detailId != null} className={cn(GRID_CARD, "overflow-hidden")}>
          <div className="px-4 pt-3 pb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold leading-tight">{s.status === ALL ? "All sale deeds" : s.status}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {view === "board" ? "Every open deed on the step it is on, longest waiting first" : gridListMeta(total, DEED_COLS, s.sort, listFiltered)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowInsights(!showInsights)} aria-pressed={showInsights}
                className={cn(GRID_BTN, showInsights && "bg-primary/10 border-primary/30")}><BarChart3 size={13} /> Insights</button>
              <GridSegment<"list" | "board"> label="View" value={view} onChange={setView} options={[
                { key: "list", label: "List", icon: ScrollText },
                { key: "board", label: "Board", icon: FolderClock },
              ]} />
            </div>
          </div>
          <GridTabs label="Status" active={s.status} onChange={s.setStatus}
            tabs={[ALL, ...STATUSES].map((k) => ({ key: k, label: k, count: listResult ? (k === ALL ? allCount : counts[k] ?? 0) : null }))} />
          <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-border border-b border-border">
            <GridMetric label="Sale deeds" value={total.toLocaleString("en-IN")} />
            <GridMetric label="Being prepared" value={(counts.Draft ?? 0).toLocaleString("en-IN")} />
            <GridMetric label="Executed, to register" value={(counts.Executed ?? 0).toLocaleString("en-IN")} strong />
            <GridMetric label="Overdue" value={<span className={(counts.Overdue ?? 0) > 0 ? "text-destructive" : ""}>{(counts.Overdue ?? 0).toLocaleString("en-IN")}</span>} />
            <GridMetric label="Registered" value={(counts.Registered ?? 0).toLocaleString("en-IN")} />
          </div>

          {selectedRows.size > 0 && (
            <GridBulkBar count={selectedRows.size} onClear={() => setSelectedRows(new Map())}>
              <button type="button" className={GRID_BTN} onClick={() => exportGrid([...selectedRows.values()], gridVisibleCols(DEED_COLS, gridPrefs), `sale-deeds-selected-${selectedRows.size}`)}>
                <Download size={13} /> Export selected
              </button>
              <button type="button" className={GRID_BTN} onClick={async () => {
                try { await navigator.clipboard.writeText([...selectedRows.values()].map((d) => d.DeedNo).join("\n")); toast.success(`Copied ${selectedRows.size} deed number${selectedRows.size === 1 ? "" : "s"}`); }
                catch { toast.error("Could not copy. Your browser blocked the clipboard."); }
              }}><Copy size={13} /> Copy numbers</button>
            </GridBulkBar>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, deed or booking" />
            <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
            <GridDateFilter label="Deed date" value={deedDates} onChange={setDeedDates} />
            {alertKey && (
              <span className="inline-flex items-center gap-1.5 h-9 pl-3 pr-1.5 rounded-full border border-primary/30 bg-primary/10 text-xs font-medium">
                Needs action: {DEED_ALERTS.find((a) => a.key === alertKey)?.label}
                <button type="button" onClick={() => setAlertKey("")} aria-label="Remove this filter" className="h-6 w-6 rounded-full inline-flex items-center justify-center hover:bg-primary/20"><X size={12} /></button>
              </span>
            )}
            {listFiltered && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-primary hover:underline">
                <RotateCcw size={12} /> Clear filters
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {exportError && <span className="text-xs text-destructive">{exportError}</span>}
              <button type="button" className={cn(GRID_BTN, "w-9 px-0")} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              <GridSavedViews storageKey={DEED_VIEWS_KEY}
                current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize, extra: { deedDates } }}
                onApply={(v) => {
                  setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                  s.apply(v);
                  const x = (v.extra ?? {}) as { deedDates?: GridDateRange };
                  setDeedDatesRaw(x.deedDates?.preset ? x.deedDates : GRID_ANY_DATE);
                }} />
              <GridColumnChooser cols={DEED_COLS} prefs={gridPrefs} onChange={setGridPrefs} />
              <button type="button" className={GRID_BTN} disabled={exporting || total === 0} title="Export to Excel" onClick={async () => {
                setExporting(true); setExportError(null);
                try { exportGrid(await fetchAllDeeds(listQs), gridVisibleCols(DEED_COLS, gridPrefs), `sale-deeds-${s.status.toLowerCase()}`); }
                catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
              }}>
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
          </div>

          {view === "board" ? (
            <div className="p-3"><DeedBoard columns={board?.columns} limit={BOARD_STEP} loading={boardLoading} onMore={() => setBoardLimit((n) => n + BOARD_STEP)} onOpen={(id) => selectDetail(id)} activeId={detailId} /></div>
          ) : (
          <CrmGrid cols={DEED_COLS} prefs={gridPrefs} onPrefs={setGridPrefs} rows={deeds} rowKey={(d: any) => d.Id}
            loading={isLoading} fetching={isFetching} error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
            sort={s.sort} onSort={s.toggleSort} onRowClick={(d: any) => selectDetail(d.Id)} activeKey={detailId}
            selected={selectedRows} onSelect={setSelectedRows}
            empty={listFiltered ? "No sale deed matches these filters." : "No sale deeds yet. One is made once a booking's agreement is registered."}
            page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          )}
        </div>

        {detailId != null && (
          detailIsError && !detail ? (
            <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{(detailError as Error)?.message}</div>
          ) : !detail ? (
            <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>
          ) : (
            <div className="space-y-4">
              <GridHighlights icon={ScrollText}
                object={`Sale deed · ${detail.DeedNo ?? ""}${detail.VersionNo > 1 ? ` · version ${detail.VersionNo}` : ""}`}
                title={<ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} />}
                status={<span className="inline-flex flex-wrap items-center gap-2">
                  <GridStatusPill status={detail.Status} />
                  {bookingCancelled && <GridStatusPill status="Rejected" label="Booking cancelled" />}
                  {deedAlerts(detail).filter((x) => x.key !== "overdue").map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}
                </span>}
                sub={[detail.BookingNo, detail.UnitNo].filter(Boolean).join(" · ")}
                actions={<>
                  {canWork && detail.Status !== "Cancelled" && !detail.SentToCustomerAt && (
                    <button type="button" onClick={() => setActiveTab("Overview")} className={GRID_BTN}><Pencil size={13} /> Edit details</button>
                  )}
                  {rights.canEdit && detail.Status !== "Registered" && detail.Status !== "Cancelled" && (
                    <button type="button" onClick={handleCancelDeed} className={cn(GRID_BTN, "text-destructive hover:bg-destructive/5")}><XCircle size={13} /> Cancel deed</button>
                  )}
                  <button type="button" onClick={() => navigate(`/crm/bookings?view=${detail.BookingId}`)} className={GRID_BTN}><Home size={13} /> Open booking</button>
                </>}
                fields={[
                  { label: "Deed value", value: detail.DeedValue ? fmtRupees(detail.DeedValue) : "—" },
                  { label: "Stamp duty", value: detail.StampDuty ? fmtRupees(detail.StampDuty) : "—" },
                  { label: "Deed date", value: fmtDate(detail.DeedDate) },
                  { label: "Registration deadline", value: <span className={detail.Status === "Overdue" ? "text-destructive font-semibold" : ""}>{fmtDate(detail.RegistrationDeadline)}</span> },
                  { label: "Legal executive", value: detail.LegalExecutiveName || "Not assigned" },
                  { label: "Papers uploaded", value: (() => { const f = deedDocumentProgress(deedDetail?.documents); return <GridProgress done={f.uploaded} total={f.required} title={`${f.uploaded} of ${f.required} mandatory papers uploaded`} />; })() },
                ]} />

              {detail.Status !== "Cancelled" && (
                <GridPath steps={deedStepStates(detail).map((st) => ({
                  label: st.label,
                  state: bookingCancelled && st.state === "current" ? "failed" as const : st.state === "upcoming" ? "todo" as const : st.state,
                  onClick: () => setActiveTab(st.tab),
                  active: activeTab === st.tab && st.state === "current",
                }))} />
              )}

              {detail.Status !== "Cancelled" && (() => {
                const d = detail;
                const pendingDocs = deedDetail?.documents?.filter((doc: any) => doc.IsMandatory && doc.Status !== "Verified") || [];
                let tone: GridGuidanceTone = "moving";
                let text = "";
                let subtext = "";
                let cta: { label: string; onClick: () => void } | null = null;
                if (bookingCancelled) {
                  tone = "stopped";
                  text = `The booking is ${d.BookingStatus || "inactive"}: this deed is locked.`;
                  subtext = "Cancel the deed to close it out.";
                } else if (d.Status === "Registered") {
                  tone = "done";
                  text = "Complete: registered at the Sub-Registrar.";
                } else if (d.Status === "Executed") {
                  text = "Executed.";
                  subtext = "Complete the registry (Registry tab) to record the registration no.";
                } else if (!d.LegalExecutiveId) {
                  tone = "waiting";
                  text = "No legal executive assigned.";
                  subtext = "Assign the person who prepares the paperwork, on the Legal & Approval tab. It is needed before execution.";
                } else if (d.SeniorApprovalStatus !== "Approved") {
                  tone = "waiting";
                  text = "Waiting for senior approval.";
                  subtext = "Upload every mandatory paper on the Documents tab, then submit it for senior approval.";
                } else if (!d.SentToCustomerAt) {
                  text = "Senior-approved: ready to share with the customer.";
                  cta = { label: "Send to customer portal", onClick: handleSendToCustomer };
                } else if (d.CustomerApprovalStatus === "RecheckRequested") {
                  tone = "stopped";
                  text = "The customer asked for a recheck.";
                  subtext = d.CustomerRecheckRemarks ? `"${d.CustomerRecheckRemarks}"` : "Fix the point raised and send it again.";
                  cta = { label: "Resend after recheck", onClick: handleSendToCustomer };
                } else if (d.CustomerApprovalStatus !== "Approved") {
                  tone = "waiting";
                  text = "Sent to the customer: waiting for them to review and approve.";
                  subtext = d.SentToCustomerAt ? `Sent ${fmtDate(d.SentToCustomerAt)}` : "";
                } else if (d.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired" && d.DirectorApprovalStatus !== "Approved") {
                  tone = "waiting";
                  text = "The customer approved: waiting for the director's sign-off.";
                } else if (detailContext?.queryPaymentStatus !== "Confirmed") {
                  tone = "waiting";
                  text = "Waiting for the stamp duty payment to be confirmed.";
                  subtext = "Confirm the customer's government payment on the Query Payment tab.";
                } else if (pendingDocs.length) {
                  tone = "waiting";
                  text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still to verify.`;
                  subtext = pendingDocs.map((doc: any) => doc.Label || doc.DocumentType).join(", ");
                } else {
                  text = "Every check has passed: ready to record the execution.";
                  cta = { label: "Record execution", onClick: () => { setActiveTab("Legal & Approval"); startExec(); } };
                }
                return (
                  <GridGuidance tone={tone} title={text} text={subtext}
                    action={cta && canWork ? <button type="button" onClick={cta.onClick} disabled={sendingToCustomer} className={GRID_BTN_BRAND}>{cta.label}</button> : undefined} />
                );
              })()}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] items-start">
              <section className={cn(GRID_CARD, "overflow-hidden min-w-0")}>
                <GridTabs label="Sale deed record" active={activeTab} onChange={setActiveTab}
                  tabs={DEED_TABS.map((t) => ({ key: t, label: t, count: t === "Documents" ? (deedDetail?.documents?.length ?? 0) : t === "History" ? (deedDetail?.approvalLog?.length ?? 0) : undefined }))} />
                <div className="p-4 space-y-4">
              {activeTab === "Timeline" && (() => {
                const steps = deedStepStates(detail);
                const docs = deedDocumentProgress(deedDetail?.documents);
                const badges: (string | undefined)[] = [
                  detail.Status, undefined, docs.required > 0 ? `${docs.percent}%` : undefined,
                  detail.SeniorApprovalStatus, detail.CustomerApprovalStatus, detail.DirectorApprovalStatus,
                  qpDetail?.Status, undefined, registry?.Status,
                ];
                return (
                  <Panel title="Workflow timeline" icon={<ScrollText size={13} />}>
                    <div className="p-4">
                      {steps.map((s, i) => (
                        <TlRow key={s.label} n={i + 1} title={s.label} state={s.state}
                          badge={badges[i] || undefined} onJump={() => setActiveTab(s.tab)} last={i === steps.length - 1} />
                      ))}
                    </div>
                  </Panel>
                );
              })()}

              {activeTab === "Overview" && (
                <div className="space-y-4">
                  <div className="bg-card" style={{ border: RULE }}>
                    <div className="grid grid-cols-1 sm:grid-cols-3" style={{ borderBottom: RULE_SOFT }}>
                      <div className="px-4 py-3" style={{ borderRight: RULE_SOFT }}>
                        <p className={LBL}>Booking</p>
                        <p className="text-sm font-semibold tabular-nums mt-0.5">{detail.BookingNo}</p>
                        <p className="text-[0.6875rem] text-muted-foreground">{detail.UnitNo}</p>
                      </div>
                      <div className="px-4 py-3" style={{ borderRight: RULE_SOFT }}>
                        <p className={LBL}>Applicant</p>
                        <p className="text-sm font-semibold truncate mt-0.5">{detail.ApplicantName || "—"}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className={LBL}>Deed date</p>
                        {detail.DeedDate ? <p className="text-sm font-heading font-bold tabular-nums mt-0.5">{fmtDate(detail.DeedDate)}</p>
                          : <p className="text-sm text-muted-foreground/60 italic mt-0.5">Not set</p>}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3" style={{ borderBottom: RULE_SOFT }}>
                      {([["Deed value", detail.DeedValue, true], ["Stamp duty", detail.StampDuty, false], ["Registration fee", detail.RegistrationFee, false]] as [string, any, boolean][]).map(([l, v, strong], i) => (
                        <div key={l} className="px-4 py-3" style={i < 2 ? { borderRight: RULE_SOFT } : undefined}>
                          <p className={LBL}>{l}</p>
                          <p className={`text-sm tabular-nums mt-0.5 ${strong ? "font-bold" : "font-semibold"}`}>{v ? fmtRupees(v) : "—"}</p>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-3">
                      <p className={LBL}>Sub-Registrar office</p>
                      <p className="text-sm font-medium mt-0.5">{detail.SubRegistrarOffice || "—"}</p>
                    </div>
                  </div>
                  <DeedDetailsSection key={`${detail.Id}-${detail.UpdatedAt ?? ""}`} detail={detail} onSave={handleSaveDeedDetails} saving={deedDetailSaving} canEdit={canWork && !progressLocked} />
                </div>
              )}

              {activeTab === "Legal & Approval" && (
                <div className="space-y-4">
                  <Panel title="Legal executive" icon={<UserCircle2 size={13} />}
                    right={<SheetMark text={detail.LegalExecutiveId ? "Assigned" : "Unassigned"} tone={detail.LegalExecutiveId ? "done" : "waiting"} />}>
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-xs text-muted-foreground">The person responsible for preparing this deed's paperwork. Required before execution.</p>
                      {detail.LegalExecutiveId && !selectedLegalExec ? (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 flex-1 px-3 h-9" style={{ border: RULE_SOFT }}>
                            <UserCircle2 size={14} className="shrink-0" />
                            <span className="text-sm font-medium">{detail.LegalExecutiveName}</span>
                            <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                          </div>
                          {canWork && !progressLocked && (
                            <button onClick={() => setSelectedLegalExec(String(detail.LegalExecutiveId))} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Change</button>
                          )}
                        </div>
                      ) : progressLocked || !canWork ? (
                        <div className="font-medium text-sm">{detail.LegalExecutiveName || <span className="text-muted-foreground">Unassigned</span>}</div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <SearchableNativeSelect value={selectedLegalExec} disabled={assigningLegal}
                            onChange={(e) => setSelectedLegalExec(e.target.value)} className={`${INP} flex-1`}>
                            <option value="">— Unassigned —</option>
                            {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                          </SearchableNativeSelect>
                          <button onClick={() => handleAssignLegal(selectedLegalExec)}
                            disabled={!selectedLegalExec || assigningLegal || selectedLegalExec === String(detail.LegalExecutiveId ?? "")}
                            className={`${KEY_INK} h-9 px-3`}>
                            {assigningLegal ? "Assigning…" : "Assign"}
                          </button>
                          {detail.LegalExecutiveId && (
                            <button onClick={() => setSelectedLegalExec("")} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Cancel</button>
                          )}
                        </div>
                      )}
                      {!detail.LegalExecutiveId && !progressLocked && canWork && (
                        <p className="text-xs text-muted-foreground">Assign someone now so they're notified and can start preparing the paperwork.</p>
                      )}
                    </div>
                  </Panel>

                  <Panel title="Approval timeline" icon={<ShieldAlert size={13} />}>
                    {/* Step 1 — Senior review. A deed never submitted (status NULL) is not the same as one awaiting a
                        decision: it gets its own Submit key instead of Approve / Reject (which the server refuses). */}
                    {(() => {
                      const status = detail.SeniorApprovalStatus;
                      const done = status === "Approved";
                      const rejected = status === "Rejected";
                      const notSubmitted = status == null;
                      const docs = deedDocumentProgress(deedDetail?.documents);
                      const docsReady = docs.required > 0 && docs.percent === 100;
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={1} done={done} active={status === "Pending"} stopped={rejected} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[0.8125rem] font-semibold">Senior review</span>
                              <SheetMark text={notSubmitted ? "Not submitted" : status} tone={notSubmitted ? "waiting" : deedTone(status)} />
                            </div>
                            <p className="text-xs text-muted-foreground">An admin or super-admin approves this deed before it's shared with the customer.</p>
                            {done && detail.SeniorApprovedAt && (
                              <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.SeniorApprovedAt)}
                                {detail.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {detail.SeniorApprovalRemarks}</span>}</p>
                            )}
                            {rejected && detail.SeniorApprovalRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Rejection reason:</strong> {detail.SeniorApprovalRemarks}</p>
                            )}
                            {notSubmitted && canWork && (
                              <div className="pt-0.5">
                                <button onClick={handleResubmit} disabled={!docsReady || !canActAsLegal}
                                  title={!canActAsLegal ? legalLockReason : !docsReady ? `${docs.uploaded}/${docs.required} mandatory documents verified — all must be verified first` : undefined}
                                  className={`${KEY_INK} h-8 px-3`}>
                                  Submit for senior approval
                                </button>
                                {!docsReady && (
                                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                                    {docs.required === 0 ? "Request a mandatory document from the Documents tab first." : `${docs.uploaded}/${docs.required} mandatory documents verified.`}
                                  </p>
                                )}
                              </div>
                            )}
                            {status === "Pending" && !bookingCancelled && (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <ApprovalActions status={status} recordId={detail.Id} endpoint={API} actionPathSuffix=""
                                  module="crm-sales-deed-senior" submitOnly={false} onSuccess={invalidate} />
                              </div>
                            )}
                            {rejected && canWork && (
                              <button onClick={handleResubmit} className={`${KEY_INK} h-8 px-3 mt-1`}>Resubmit for approval</button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 2 — Shared with customer */}
                    {(() => {
                      const sent = !!detail.SentToCustomerAt;
                      const seniorApproved = detail.SeniorApprovalStatus === "Approved";
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={2} done={sent} active={seniorApproved} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[0.8125rem] font-semibold">Shared with customer</span>
                              <SheetMark text={sent ? "Sent" : "Not sent"} tone={sent ? "done" : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">The customer can view this deed in their portal and approve it or request a recheck.</p>
                            {sent && <p className="text-xs flex items-center gap-1 tabular-nums"><Send size={11} /> Sent {fmtIstIso(detail.SentToCustomerAt)}</p>}
                            {seniorApproved && canWork && detail.CustomerApprovalStatus !== "Approved" && (
                              <button onClick={handleSendToCustomer} disabled={sendingToCustomer} className={`${KEY_INK} h-8 px-3 mt-0.5`}>
                                {sendingToCustomer ? "Sending…" : sent ? "Resend to customer" : "Send to customer portal"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 3 — Customer review */}
                    {(() => {
                      const status = detail.CustomerApprovalStatus;
                      const done = status === "Approved";
                      const recheck = status === "RecheckRequested";
                      const sent = !!detail.SentToCustomerAt;
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={3} done={done} active={sent} stopped={recheck} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[0.8125rem] font-semibold">Customer review</span>
                              <SheetMark text={recheck ? "Recheck requested" : status || "Pending"} tone={recheck ? "stopped" : done ? "done" : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">The customer's response from the portal: approve, or request changes.</p>
                            {done && detail.CustomerApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.CustomerApprovedAt)}</p>}
                            {recheck && detail.CustomerRecheckRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Recheck reason:</strong> {detail.CustomerRecheckRemarks}</p>
                            )}
                            {sent && !done && canWork && (
                              <div className="flex gap-2 flex-wrap mt-2">
                                <button onClick={() => setProxyApproveDialog(true)} className={`${KEY_LINE} h-8 px-3`}><UserCircle2 size={11} /> Record approval (offline)</button>
                                <button onClick={() => setProxyRecheckDialog(true)} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}><UserCircle2 size={11} /> Record recheck (offline)</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 4 — Director review */}
                    {(() => {
                      const status = detail.DirectorApprovalStatus;
                      const done = status === "Approved";
                      const rejected = status === "Rejected";
                      return (
                        <div className="px-4 py-4 flex items-start gap-3">
                          <StepBox n={4} done={done} active={detail.CustomerApprovalStatus === "Approved"} stopped={rejected} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[0.8125rem] font-semibold">Director review</span>
                              <SheetMark text={status || "Pending"} tone={status ? deedTone(status) : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">Final internal sign-off by the director before execution.</p>
                            {done && detail.DirectorApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.DirectorApprovedAt)}</p>}
                            {rejected && detail.DirectorApprovalRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Rejection reason:</strong> {detail.DirectorApprovalRemarks}</p>
                            )}
                            {!bookingCancelled && status === "Pending" && (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <ApprovalActions status={status} recordId={detail.Id} endpoint={API} actionPathSuffix="director"
                                  module="crm-sales-deed-director" onSuccess={invalidate} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </Panel>

                  {/* Deed execution: the end of the senior → customer → director chain (and, server-side, every
                      mandatory document verified). The registry only covers the Sub-Registrar visit after it. */}
                  {(() => {
                    const executed = !!detail.ExecutedBy;
                    const readyToExecute = detail.SeniorApprovalStatus === "Approved" && detail.CustomerApprovalStatus === "Approved" && detail.DirectorApprovalStatus === "Approved";
                    const notReadyReason = !readyToExecute
                      ? `Needs senior, customer and director approval first — now senior: ${detail.SeniorApprovalStatus || "not requested"}, customer: ${detail.CustomerApprovalStatus || "not sent"}, director: ${detail.DirectorApprovalStatus || "not requested"}.`
                      : null;
                    return (
                      <Panel title="Deed execution" icon={<FileText size={13} />}
                        right={<SheetMark text={executed ? "Executed" : "Not executed"} tone={executed ? "done" : "waiting"} />}>
                        <div className="px-4 py-3">
                          {!progressLocked && !execEditing && (
                            !executed && notReadyReason ? <p className="text-[0.6875rem] text-muted-foreground">{notReadyReason}</p>
                            : !executed ? (canWork ? <button onClick={startExec} className={`${KEY_INK} h-8 px-3`}>Record execution</button> : <p className="text-xs text-muted-foreground">Not executed yet.</p>)
                            : (
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Executed by <span className="font-medium text-foreground">{detail.ExecutedBy}</span></p>
                                {canWork && <button onClick={startExec} className={`${KEY_LINE} h-7 px-2`}><Pencil size={10} /> Edit</button>}
                              </div>
                            )
                          )}
                          {execEditing && canWork && (
                            <div className="space-y-3">
                              <p className="text-[0.6875rem] text-muted-foreground">Status follows what's recorded: executed by → Executed; registration no. → Registered. Every mandatory document must be verified (the server checks).</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="sm:col-span-2 space-y-1">
                                  <label className={`block ${LBL}`}>Executed by *</label>
                                  <input className={INP} value={execForm.ExecutedBy} onChange={(e) => setExecForm((f) => ({ ...f, ExecutedBy: e.target.value }))} placeholder="Authorised signatory name" />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Registration no.</label>
                                  <input className={`${INP} tabular-nums`} value={execForm.RegistrationNo} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Registration date</label>
                                  <DateInput className={INP} value={execForm.RegistrationDate} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationDate: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Book no.</label>
                                  <input className={INP} value={execForm.BookNo} onChange={(e) => setExecForm((f) => ({ ...f, BookNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Part no.</label>
                                  <input className={INP} value={execForm.PartNo} onChange={(e) => setExecForm((f) => ({ ...f, PartNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Possession date</label>
                                  <DateInput className={INP} value={execForm.PossessionDate} onChange={(e) => setExecForm((f) => ({ ...f, PossessionDate: e.target.value }))} />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setExecEditing(false)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                                <button onClick={handleSaveExecution} disabled={execSaving} className={`${KEY_INK} h-8 px-3`}>{execSaving ? "Saving…" : "Save"}</button>
                              </div>
                            </div>
                          )}
                          {progressLocked && (
                            executed ? (
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                <p>By <span className="text-foreground font-medium">{detail.ExecutedBy}</span></p>
                                {detail.RegistrationNo && <p className="tabular-nums">Reg no. <span className="text-foreground">{detail.RegistrationNo}</span> · {fmtDate(detail.RegistrationDate)}</p>}
                                {detail.BookNo && <p className="tabular-nums">Book / part: {detail.BookNo} / {detail.PartNo}</p>}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">Not executed.</p>
                          )}
                        </div>
                      </Panel>
                    );
                  })()}
                </div>
              )}

              {activeTab === "Query Payment" && (
                <QueryPaymentTab key={detail.Id} detail={detail} canCreate={qpCanCreate && !bookingCancelled} canEdit={qpCanEdit && !bookingCancelled}
                  canConfirm={qpCanEdit && !bookingCancelled && legalOrInbox} onChanged={invalidate} />
              )}

              {activeTab === "Registry" && (
                <RegistryTab key={detail.Id} detail={detail} qpConfirmed={detailContext?.queryPaymentStatus === "Confirmed"}
                  canCreate={regCanCreate && !bookingCancelled} canEdit={regCanEdit && !bookingCancelled}
                  canCompleteOrCancel={regCanEdit && !bookingCancelled && legalOrInbox} canEditDeed={canWork}
                  onSaveIndex2={handleSaveIndex2} savingIndex2={stepSaving} onChanged={invalidate} />
              )}

              {activeTab === "Documents" && (() => {
                const canDocs = canWork && !progressLocked;
                return (
                  <DocumentCentre documents={deedDetail?.documents || []} hasFile={(d) => !!d.HasFile} fileUrl={deedFileUrl} onChanged={invalidateDetail}
                    requiredTitle="Required for senior approval"
                    review={docReview} attach={docAttach} history={docHistory}
                    upload={{ types: [{ value: "ExecutedDeed", label: "Executed deed copy" }, { value: "Other", label: "Other" }], run: docUpload }}
                    canAttach={{ ok: canDocs && canActAsLegal, reason: !canDocs ? (progressLocked ? "The deed is closed: papers can't change." : "Changing papers needs the edit right.") : legalLockReason }}
                    canReview={{ ok: canDocs, reason: progressLocked ? "The deed is closed: papers can't change." : "Reviewing papers needs the edit right." }}
                    emptyRequired={(
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-muted-foreground">No mandatory paper asked for yet. Senior approval waits until one is requested and verified.</p>
                        {canDocs && (
                          <button type="button" onClick={() => handleRequestDoc("DeedDraft", "Sale Deed Draft (Physical Legal Document)")} disabled={requestingDoc} className={GRID_BTN_BRAND}>
                            {requestingDoc ? "Requesting…" : "Request deed draft"}
                          </button>
                        )}
                      </div>
                    )} />
                );
              })()}

              {activeTab === "History" && (
                <div className="space-y-4">
                  <Panel title="Approval history" icon={<History size={13} />}>
                    {deedDetail?.approvalLog?.length ? deedDetail.approvalLog.map((log: any) => (
                      <div key={log.Id} className="px-4 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span className={`font-medium ${/Reject|Recheck/.test(log.Action) ? "text-destructive" : ""}`}>{LOG_ACTION_LABEL[log.Action] || log.Action}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(log.CreatedAt)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                        {log.Remarks && <div className="text-xs px-2 py-1.5 mt-1.5" style={{ border: RULE_SOFT }}>{log.Remarks}</div>}
                      </div>
                    )) : <p className="px-4 py-6 text-center text-xs text-muted-foreground">No approval actions recorded yet.</p>}
                  </Panel>
                  {registryHistory.length > 0 && (
                    <Panel title="Registry (Sub-Registrar office)">
                      {registryHistory.map((log: any) => (
                        <div key={log.Id} className="px-4 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                          <div className="flex items-baseline justify-between gap-2 flex-wrap">
                            <span className="font-medium">{log.Action}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(log.CreatedAt)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                          {log.Remarks && <div className="text-xs px-2 py-1.5 mt-1.5" style={{ border: RULE_SOFT }}>{log.Remarks}</div>}
                        </div>
                      ))}
                    </Panel>
                  )}
                </div>
              )}
                </div>
              </section>

              <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
                <GridRelated icon={History} title="Activity" count={(deedDetail?.approvalLog?.length ?? 0) + registryHistory.length}>
                  {(() => {
                    const ev = [
                      ...((deedDetail?.approvalLog || []) as any[]).map((l) => ({ at: l.CreatedAt, title: LOG_ACTION_LABEL[l.Action] || l.Action, by: l.ActorName, note: l.Remarks, bad: /Reject|Recheck/.test(l.Action) })),
                      ...(registryHistory as any[]).map((l) => ({ at: l.CreatedAt, title: `Registry: ${l.Action}`, by: l.ActorName, note: l.Remarks, bad: false })),
                      ...(detail.CreatedAt ? [{ at: detail.CreatedAt, title: "Deed made", by: null, note: null, bad: false }] : []),
                    ].sort((p, q) => new Date(q.at).getTime() - new Date(p.at).getTime());
                    if (!ev.length) return <p className="px-4 py-4 text-xs text-muted-foreground">Nothing recorded yet.</p>;
                    return (
                      <ol className="px-4 py-4 relative ml-1.5 border-l border-border space-y-3">
                        {ev.slice(0, 10).map((e, k) => (
                          <li key={k} className="relative pl-4">
                            <span className={cn("absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-card", e.bad ? "bg-rose-600" : "bg-primary")} />
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={cn("text-xs font-semibold", e.bad && "text-destructive")}>{e.title}</span>
                              <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0">{fmtDate(e.at)}</span>
                            </div>
                            {(e.by || e.note) && <p className="text-[0.6875rem] text-muted-foreground mt-0.5 line-clamp-2">{[e.by && `by ${e.by}`, e.note].filter(Boolean).join(" · ")}</p>}
                          </li>
                        ))}
                        {ev.length > 10 && <li className="pl-4"><button type="button" onClick={() => setActiveTab("History")} className="text-xs text-primary hover:underline">See all {ev.length} in History</button></li>}
                      </ol>
                    );
                  })()}
                </GridRelated>
                <GridRelated icon={ArrowRight} title="Related">
                  <ul className="py-1">
                    {[
                      ["Booking", `/crm/bookings?view=${detail.BookingId}`, detail.BookingNo],
                      ["Agreement", `/crm/agreements?bookingId=${detail.BookingId}`, "The registered agreement"],
                      ["Payments", `/crm/payments?bookingId=${detail.BookingId}`, "Milestones and receipts"],
                      ["Handover", `/crm/possession?bookingId=${detail.BookingId}`, "Keys and possession"],
                      ["Mutation", `/crm/mutation?bookingId=${detail.BookingId}`, "After registration"],
                      ["Legal milestones", `/crm/legal-milestones?bookingId=${detail.BookingId}`, "The booking's legal path"],
                    ].map(([label, to, note]) => (
                      <li key={label as string}>
                        <button type="button" onClick={() => navigate(to as string)} className="w-full px-4 py-2 flex items-center justify-between gap-2 text-left hover:bg-muted/50">
                          <span className="text-xs font-semibold text-primary">{label}</span>
                          <span className="text-[0.6875rem] text-muted-foreground truncate">{note}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </GridRelated>
              </aside>
              </div>
            </div>
          )
        )}
      </CrmAppPage>


        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent className="max-w-lg p-5 gap-4">
            <DialogHeader>
              <DialogTitle className="font-heading">New sale deed</DialogTitle>
              <DialogDescription className="text-xs">Needs the agreement registered and the loan cleared.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Booking *</label>
                <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value, DeedValue: "" }))} className={INP}>
                  <option value="">Select booking</option>
                  {(eligible as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} · ${b.ApplicantName} · ${b.UnitNo}`}</option>
                  ))}
                </SearchableNativeSelect>
                {!(eligible as any[]).length && <p className="text-xs text-muted-foreground">No eligible bookings — the agreement must be registered first.</p>}
              </div>

              {form.BookingId && (
                <div className="px-4 py-3 space-y-1.5" style={{ border: RULE_SOFT }}>
                  {contextLoading ? <div className="text-xs text-muted-foreground">Checking eligibility…</div>
                  : !context ? <div className="text-xs text-muted-foreground">Couldn't load booking details.</div>
                  : (
                    <>
                      <p className="text-sm font-semibold"><ApplicantNames name={context.booking?.ApplicantName} bookingId={context.booking?.Id} applicationId={context.booking?.ApplicationId} /></p>
                      <p className="text-xs text-muted-foreground tabular-nums">{context.booking?.BookingNo} · {context.booking?.UnitNo} · {fmtRupees(context.booking?.GrandTotal)}</p>
                      <div className={`flex items-center gap-1.5 text-xs pt-1 ${agreementRegistered ? "" : "text-destructive"}`}>
                        {agreementRegistered ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        Agreement {context.agreement ? `${context.agreement.AgreementNo} — ${context.agreement.Status}` : "not created yet"}
                      </div>
                      {context.requiresHandoverBeforeDeed && (
                        <div className={`flex items-center gap-1.5 text-xs ${handoverCleared ? "" : "text-destructive"}`}>
                          {handoverCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Handover (under-construction project) — {context.handoverStatus || "not started"}
                          {!handoverCleared && (
                            <button onClick={() => navigate(`/crm/possession?bookingId=${form.BookingId}`)} className="flex items-center gap-1 underline underline-offset-2 ml-1">
                              Go to handover <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                      {isLoanFinanced && (
                        <div className={`flex items-center gap-1.5 text-xs ${loanCleared ? "" : "text-destructive"}`}>
                          {loanCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Loan processing — {loanCleared ? "cleared" : context.loanBlockReason}
                          {!loanCleared && (
                            <button onClick={() => navigate(`/crm/loan-details?bookingId=${form.BookingId}`)} className="flex items-center gap-1 underline underline-offset-2 ml-1">
                              Go to loan tracking <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["Deed value", "DeedValue", "number"],
                  ["Stamp duty", "StampDuty", "number"],
                  ["Registration fee", "RegistrationFee", "number"],
                  ["AFS stamp duty credit", "StampDutyCredit", "number"],
                  ["Deed date", "DeedDate", "date"],
                  ["Registration deadline (RERA)", "RegistrationDeadline", "date"],
                ] as [string, keyof typeof EMPTY_FORM, string][]).map(([lbl, key, type]) => (
                  <div key={key} className="space-y-1">
                    <label className={`block ${LBL}`}>{lbl}</label>
                    {type === "date"
                      ? <DateInput className={INP} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                      : <input type="number" className={`${INP} tabular-nums`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />}
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Sub-Registrar office</label>
                <input className={INP} value={form.SubRegistrarOffice} onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
              </div>
              {context?.agreement?.AfsStampDuty != null && (
                <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  AFS stamp duty {fmtRupees(context.agreement.AfsStampDuty)} pre-filled as credit — check it against the Sub-Registrar receipt before saving.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCreate} disabled={saving || !canCreate} className={`${KEY_INK} h-9 px-4`}>{saving ? "Creating…" : "Create"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval — Sales Deed"
          description="You are recording that the customer has reviewed and approved the sales deed without using the portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={(m, r) => handleProxy("proxy-customer-approve", m, r)}
        />
      )}
      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request — Sales Deed"
          description="You are recording that the customer flagged an issue or requested changes to the sales deed without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={(m, r) => handleProxy("proxy-customer-recheck", m, r)}
        />
      )}
    </>
  );
};

export default CrmSalesDeed;
