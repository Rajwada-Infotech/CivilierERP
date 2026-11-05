import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Upload, Send, Clock, UserCircle2, Pencil, Lock, Check, ArrowRight, ShieldAlert, Building2, ScrollText, X, FolderClock, CheckCircle2, AlertCircle, Info, CalendarDays, BarChart3, RefreshCw, ArrowLeft, Download, Copy, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { promptNextStep } from "@/lib/workflowNav";
import { FinancialStatusBar, fmtRupees } from "@/components/crm/FinancialStatusBar";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridFields, GridGuidance, GridHighlights, GridMetric, GridPath, GridProgress,
  GridRelated, GridSegment,
  GridSavedViews, GridSearch, GridStatusPill, GridTabs, exportGrid, gridListMeta, gridVisibleCols, resolveGridDateRange, useGridPrefs,
  GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_KEY_BRAND, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange, type GridGuidanceTone,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { cn } from "@/lib/utils";
import CrmAfsQueryPayment from "@/pages/CRM/CrmAfsQueryPayment";
import CrmAfsRegistry from "@/pages/CRM/CrmAfsRegistry";
import { AutoInput, DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { API, DOC_TYPES, agrStatusColor, isBookingCancelled, unverifiedMandatoryDocs, followupProgress, AGR_TABS, AgrTab, TAB_SLUGS, SLUG_FOR_TAB, agreementStepStates, agreementCurrentStep, rowFollowupProgress, AGREEMENT_STEP_NAMES, AGREEMENT_ALERTS, agreementAlerts, agreementCurrentIndex, agreementDaysAtStep, type AgreementAlertTone } from "./agreement/config";
import { docStatusColor, AgreementTimeline } from "./agreement/Timeline";
import { EMPTY_AGR_FORM, fetchUsers, EMPTY_DOC_FORM, EMPTY_DOC_REQUEST_FORM, mimeIcon, fmtBytes } from "./agreement/forms";
import { DocumentCentre, FilePicker, auditToHistory } from "./salesDeed/parts";
import { fetchAgreementsList, fetchAllAgreements, fetchAgreementDetail, fetchAgreementIdByBooking, fetchDateHistory, fetchRevisions, fetchBookings, fetchWelcomeCallsForBooking } from "./agreement/api";

// This page is drawn with the CRM record kit (components/crm/CrmDataTable.tsx); the keys, labels and rules its tabs and
// dialogs use map onto it.
const { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } = GRID_SHEET_KEYS;

const ALL = "All";
const AGR_STATUSES = [CrmStatus.DRAFT, CrmStatus.EXECUTED, CrmStatus.REGISTERED, CrmStatus.CANCELLED];
const AGR_DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const AGR_PREFS_KEY = "crm-agreements-grid";
const AGR_VIEWS_KEY = "crm-agreements-saved-views";
const AGR_INSIGHTS_KEY = "crm-agreements-insights";
const day = (v: any) => (v ? String(v).slice(0, 10) : "—");

const AGR_COLS: GridCol<any>[] = [
  { id: "no", label: "Agreement", sortKey: "AgreementNo", locked: true, cell: (a) => <span className="font-semibold text-primary hover:underline tabular-nums">{a.AgreementNo}{a.VersionNo > 1 ? <span className="text-muted-foreground font-normal"> v{a.VersionNo}</span> : null}</span>, csv: (a) => a.AgreementNo },
  {
    id: "customer", label: "Customer", sortKey: "ApplicantName",
    cell: (a) => <span className="truncate block max-w-[16rem]" onClick={(e) => e.stopPropagation()}><ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} /></span>,
    csv: (a) => a.ApplicantName,
  },
  { id: "booking", label: "Booking", sortKey: "BookingNo", cell: (a) => <span className="tabular-nums">{a.BookingNo}</span>, csv: (a) => a.BookingNo },
  {
    id: "unit", label: "Project · unit", sortKey: "ProjectName",
    cell: (a) => <span className="truncate block max-w-[14rem]">{[a.ProjectName, a.UnitNo].filter(Boolean).join(" · ") || "—"}</span>,
    csv: (a) => [a.ProjectName, a.UnitNo].filter(Boolean).join(" · "),
  },
  {
    id: "stage", label: "Stage",
    cell: (a) => isBookingCancelled(a)
      ? <span className="text-destructive font-semibold">Booking {a.BookingStatus || "inactive"}: locked</span>
      : <span>{agreementCurrentStep(a, rowFollowupProgress(a))}</span>,
    csv: (a) => (isBookingCancelled(a) ? `Booking ${a.BookingStatus || "inactive"}` : agreementCurrentStep(a, rowFollowupProgress(a))),
  },
  {
    id: "legal", label: "Legal executive", sortKey: "LegalExecutiveName",
    cell: (a) => a.LegalExecutiveName || <span className="text-amber-700 dark:text-amber-300 font-medium">Not assigned</span>,
    csv: (a) => a.LegalExecutiveName,
  },
  {
    id: "papers", label: "Papers",
    cell: (a) => { const f = rowFollowupProgress(a); return <GridProgress done={f.uploaded} total={f.required} title={`${f.uploaded} of ${f.required} mandatory papers uploaded`} />; },
    csv: (a) => `${rowFollowupProgress(a).uploaded}/${rowFollowupProgress(a).required}`,
  },
  { id: "signing", label: "Signing date", sortKey: "AgreementDate", cell: (a) => <span className="tabular-nums">{day(a.AgreementDate)}</span>, csv: (a) => day(a.AgreementDate) },
  { id: "value", label: "Value", sortKey: "GrandTotal", align: "right", cell: (a) => <span className="tabular-nums">{a.GrandTotal ? fmtRupees(a.GrandTotal) : "—"}</span>, csv: (a) => a.GrandTotal },
  { id: "status", label: "Status", sortKey: "Status", cell: (a) => <GridStatusPill status={a.Status} />, csv: (a) => a.Status },
  {
    id: "alerts", label: "Needs action",
    cell: (a) => { const al = agreementAlerts(a); return al.length ? <span className="inline-flex gap-1">{al.slice(0, 2).map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}{al.length > 2 && <span className="text-[0.6875rem] text-muted-foreground">+{al.length - 2}</span>}</span> : <span className="text-muted-foreground">—</span>; },
    csv: (a) => agreementAlerts(a).map((x) => x.label).join("; "),
  },
  {
    id: "days", label: "Days at step", align: "right",
    cell: (a) => <span className="tabular-nums">{agreementDaysAtStep(a, rowFollowupProgress(a)) ?? "—"}</span>,
    csv: (a) => agreementDaysAtStep(a, rowFollowupProgress(a)),
  },
  { id: "senior", label: "Senior approval", hiddenByDefault: true, cell: (a) => a.SeniorApprovalStatus || "—", csv: (a) => a.SeniorApprovalStatus },
  { id: "customerOk", label: "Customer approval", hiddenByDefault: true, cell: (a) => a.CustomerApprovalStatus || "—", csv: (a) => a.CustomerApprovalStatus },
  { id: "sent", label: "Sent to customer", hiddenByDefault: true, cell: (a) => <span className="tabular-nums">{day(a.SentToCustomerAt)}</span>, csv: (a) => day(a.SentToCustomerAt) },
  { id: "regNo", label: "Registration no.", hiddenByDefault: true, cell: (a) => <span className="tabular-nums">{a.AfsRegistrationNo || "—"}</span>, csv: (a) => a.AfsRegistrationNo },
  { id: "updated", label: "Updated", sortKey: "UpdatedAt", hiddenByDefault: true, cell: (a) => <span className="tabular-nums">{day(a.UpdatedAt)}</span>, csv: (a) => day(a.UpdatedAt) },
];

// ── Insights, board and activity ──────────────────────────────────────────────
const ALERT_INK: Record<AgreementAlertTone, string> = {
  stopped: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  moving: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
};
const AlertPill: React.FC<{ tone: AgreementAlertTone; label: string }> = ({ tone, label }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full border text-[0.6875rem] font-medium whitespace-nowrap", ALERT_INK[tone])}>{label}</span>
);
const daysText = (d: number | null) => (d == null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`);
const isThisMonth = (v: any, today: Date) => {
  if (!v) return false;
  const d = new Date(String(v).slice(0, 10));
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
};

/** One horizontal bar with its label and count; the widest bar is the largest count. */
const Bar: React.FC<{ label: React.ReactNode; value: number; max: number; tone?: string; onClick?: () => void; note?: string }> = ({ label, value, max, tone = "bg-primary", onClick, note }) => (
  <button type="button" onClick={onClick} disabled={!onClick} title={note}
    className="w-full grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 py-1 text-left text-xs enabled:hover:bg-muted/50 rounded">
    <span className="truncate text-muted-foreground">{label}</span>
    <span className="h-2 rounded-full bg-muted overflow-hidden">
      <span className={cn("block h-full rounded-full", tone)} style={{ width: `${max ? Math.max(value ? 4 : 0, Math.round((value / max) * 100)) : 0}%` }} />
    </span>
    <span className="tabular-nums text-right font-semibold">{value.toLocaleString("en-IN")}</span>
  </button>
);

/** The pipeline at a glance: where every agreement sits, what needs action, who carries the work, and this month. */
const AgreementInsights: React.FC<{ rows: any[]; loading: boolean; onOpen: (id: number) => void; onBoard: () => void }> = ({ rows, loading, onOpen, onBoard }) => {
  const today = new Date();
  const live = rows.filter((a) => a.Status !== CrmStatus.CANCELLED);
  const at = live.map((a) => ({ a, i: agreementCurrentIndex(a, rowFollowupProgress(a)), days: agreementDaysAtStep(a, rowFollowupProgress(a), today) }));
  const byStep = AGREEMENT_STEP_NAMES.map((name, i) => ({ name, n: at.filter((x) => x.i === i).length, i }));
  const complete = live.filter((a) => a.Status === CrmStatus.REGISTERED).length;
  const stepMax = Math.max(1, complete, ...byStep.map((s) => s.n));
  const alerts = AGREEMENT_ALERTS.map((al) => ({ ...al, items: live.filter((a) => al.test(a, today)) })).filter((al) => al.items.length);
  const open = at.filter((x) => x.i >= 0);
  const load = new Map<string, { n: number; oldest: number }>();
  for (const x of open) {
    const k = x.a.LegalExecutiveName || "Not assigned";
    const cur = load.get(k) ?? { n: 0, oldest: 0 };
    load.set(k, { n: cur.n + 1, oldest: Math.max(cur.oldest, x.days ?? 0) });
  }
  const loadRows = [...load.entries()].sort((p, q) => q[1].n - p[1].n);
  const loadMax = Math.max(1, ...loadRows.map(([, v]) => v.n));
  const avgDays = open.length ? Math.round(open.reduce((n, x) => n + (x.days ?? 0), 0) / open.length) : null;
  const longest = [...open].sort((p, q) => (q.days ?? 0) - (p.days ?? 0)).slice(0, 5);

  if (loading && !rows.length) {
    return <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((k) => <div key={k} className={cn(GRID_CARD, "h-56 animate-pulse bg-muted/40")} />)}</div>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <section className={cn(GRID_CARD, "p-4")}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5"><BarChart3 size={14} className="text-primary" /> Pipeline by step</h3>
          <button type="button" className="text-xs text-primary hover:underline" onClick={onBoard}>Open board</button>
        </div>
        {byStep.slice(1).map((s) => <Bar key={s.name} label={s.name} value={s.n} max={stepMax} onClick={onBoard} note={`${s.n} on ${s.name}`} />)}
        <Bar label="Complete" value={complete} max={stepMax} tone="bg-emerald-600" />
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><AlertCircle size={14} className="text-destructive" /> Needs action</h3>
        {alerts.length === 0 ? <p className="text-xs text-muted-foreground py-6 text-center">Nothing needs action right now.</p> : (
          <ul className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {alerts.map((al) => (
              <li key={al.key}>
                <div className="flex items-center justify-between gap-2"><AlertPill tone={al.tone} label={al.label} /><span className="text-xs font-semibold tabular-nums">{al.items.length}</span></div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {al.items.slice(0, 4).map((a: any) => (
                    <button key={a.Id} type="button" onClick={() => onOpen(a.Id)} className="text-[0.6875rem] text-primary hover:underline tabular-nums">{a.AgreementNo}</button>
                  ))}
                  {al.items.length > 4 && <span className="text-[0.6875rem] text-muted-foreground">+{al.items.length - 4} more</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><UserCircle2 size={14} className="text-primary" /> Legal executive workload</h3>
        {loadRows.length === 0 ? <p className="text-xs text-muted-foreground py-6 text-center">No open agreements.</p> : (
          <div className="max-h-52 overflow-y-auto pr-1">
            {loadRows.map(([name, v]) => (
              <Bar key={name} label={name} value={v.n} max={loadMax} tone={name === "Not assigned" ? "bg-amber-500" : "bg-primary"}
                note={`${v.n} open · oldest ${daysText(v.oldest)} at its step`} />
            ))}
          </div>
        )}
      </section>

      <section className={cn(GRID_CARD, "p-4")}>
        <h3 className="text-[0.8125rem] font-bold flex items-center gap-1.5 mb-2"><CalendarDays size={14} className="text-primary" /> This month</h3>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            ["New", rows.filter((a) => isThisMonth(a.CreatedAt, today)).length],
            ["Signing dates", rows.filter((a) => isThisMonth(a.AgreementDate, today)).length],
            ["Registered", rows.filter((a) => isThisMonth(a.AfsRegistrationDate, today)).length],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-md bg-muted/50 px-2 py-2 text-center">
              <div className="text-lg font-bold tabular-nums">{(v as number).toLocaleString("en-IN")}</div>
              <div className="text-[0.6875rem] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mb-1">Longest at their step{avgDays != null ? ` · average ${daysText(avgDays)}` : ""}</div>
        <ul className="space-y-1">
          {longest.map((x) => (
            <li key={x.a.Id}>
              <button type="button" onClick={() => onOpen(x.a.Id)} className="w-full flex items-center justify-between gap-2 text-xs hover:bg-muted/50 rounded px-1 py-0.5 text-left">
                <span className="truncate"><span className="text-primary tabular-nums">{x.a.AgreementNo}</span> <span className="text-muted-foreground">· {AGREEMENT_STEP_NAMES[x.i]}</span></span>
                <span className="tabular-nums font-semibold shrink-0">{daysText(x.days)}</span>
              </button>
            </li>
          ))}
          {!longest.length && <li className="text-xs text-muted-foreground">No open agreements.</li>}
        </ul>
      </section>
    </div>
  );
};

/** One column per step, every open agreement as a card on the step it is on, longest waiting first. */
const AgreementBoard: React.FC<{ rows: any[]; loading: boolean; onOpen: (id: number) => void; activeId: number | null }> = ({ rows, loading, onOpen, activeId }) => {
  const today = new Date();
  const [showAll, setShowAll] = useState<Record<number, boolean>>({});
  const CARD_LIMIT = 30;
  const cols = AGREEMENT_STEP_NAMES.map((name, i) => ({
    name, i,
    cards: rows
      .map((a) => ({ a, i: agreementCurrentIndex(a, rowFollowupProgress(a)), days: agreementDaysAtStep(a, rowFollowupProgress(a), today), alerts: agreementAlerts(a, today) }))
      .filter((x) => x.i === i)
      .sort((p, q) => (q.days ?? 0) - (p.days ?? 0)),
  })).slice(1);
  if (loading && !rows.length) return <div className="h-80 rounded-lg bg-muted/40 animate-pulse" />;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {cols.map((col) => {
          const shown = showAll[col.i] ? col.cards : col.cards.slice(0, CARD_LIMIT);
          return (
            <section key={col.name} className="w-64 shrink-0 rounded-lg bg-muted/40 border border-border flex flex-col max-h-[calc(100vh-20rem)]">
              <header className="px-3 h-10 flex items-center justify-between gap-2 border-b border-border">
                <h3 className="text-xs font-bold truncate">{col.name}</h3>
                <span className="text-[0.6875rem] tabular-nums px-1.5 rounded-full bg-card border border-border">{col.cards.length}</span>
              </header>
              <div className="p-2 space-y-2 overflow-y-auto">
                {shown.length === 0 && <p className="text-[0.6875rem] text-muted-foreground text-center py-4">None here</p>}
                {shown.map(({ a, days, alerts }) => (
                  <button key={a.Id} type="button" onClick={() => onOpen(a.Id)}
                    className={cn(GRID_CARD, "w-full text-left p-2.5 hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", activeId === a.Id && "border-primary")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-primary tabular-nums truncate">{a.AgreementNo}</span>
                      <span className={cn("text-[0.6875rem] tabular-nums shrink-0", alerts.some((x) => x.tone === "stopped") ? "text-destructive font-semibold" : "text-muted-foreground")}>{daysText(days)}</span>
                    </div>
                    <div className="text-[0.8125rem] font-medium truncate mt-0.5">{a.ApplicantName}</div>
                    <div className="text-[0.6875rem] text-muted-foreground truncate">{[a.ProjectName, a.UnitNo].filter(Boolean).join(" · ") || a.BookingNo}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[0.6875rem] truncate">{a.LegalExecutiveName || <span className="text-amber-700 dark:text-amber-300">No legal executive</span>}</span>
                      {Number(a.MandatoryDocCount) > 0 && <GridProgress done={Number(a.MandatoryUploadedCount) || 0} total={Number(a.MandatoryDocCount)} />}
                    </div>
                    {alerts.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{alerts.map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}</div>}
                  </button>
                ))}
                {col.cards.length > CARD_LIMIT && (
                  <button type="button" className="w-full text-xs text-primary hover:underline py-1" onClick={() => setShowAll((m) => ({ ...m, [col.i]: !m[col.i] }))}>
                    {showAll[col.i] ? "Show fewer" : `Show all ${col.cards.length}`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

/** Everything recorded on the agreement, newest first: from its own dates, the date proposals, the revisions and the papers. */
const AgreementActivity: React.FC<{ agreement: any; documents: any[]; dateHistory: any[]; revisions: any[] }> = ({ agreement: a, documents, dateHistory, revisions }) => {
  const [all, setAll] = useState(false);
  if (!a) return null;
  const ev: { at: string; title: string; detail?: string; tone?: AgreementAlertTone | "done" }[] = [];
  if (a.CreatedAt) ev.push({ at: a.CreatedAt, title: "Agreement made", detail: a.CreatedByName ? `by ${a.CreatedByName}` : undefined });
  if (a.SeniorApprovedAt) ev.push({ at: a.SeniorApprovedAt, title: `Senior approval: ${a.SeniorApprovalStatus}`, detail: a.SeniorApprovalRemarks || undefined, tone: a.SeniorApprovalStatus === CrmStatus.APPROVED ? "done" : "stopped" });
  if (a.SentToCustomerAt) ev.push({ at: a.SentToCustomerAt, title: "Sent to the customer portal" });
  if (a.CustomerApprovedAt) ev.push({ at: a.CustomerApprovedAt, title: "Customer approved", tone: "done" });
  if (a.CustomerApprovalStatus === "RecheckRequested") ev.push({ at: a.UpdatedAt, title: `Customer asked for a recheck${a.RecheckCount > 1 ? ` (${a.RecheckCount} times)` : ""}`, detail: a.LastRecheckRemarks || undefined, tone: "stopped" });
  for (const h of dateHistory) ev.push({ at: h.CreatedAt, title: `${h.ProposedBy === "Customer" ? "Customer" : "We"} proposed ${String(h.ProposedDate).slice(0, 10)}`, detail: [h.Reason, h.CreatedByName && `by ${h.CreatedByName}`].filter(Boolean).join(" · ") || undefined });
  for (const r of revisions) ev.push({ at: r.CreatedAt, title: `Version ${r.VersionNo} superseded`, detail: [r.Reason, r.CreatedByName && `by ${r.CreatedByName}`].filter(Boolean).join(" · ") || undefined });
  for (const d of documents) if (d.UploadedAt) ev.push({ at: d.UploadedAt, title: `${d.Label || d.DocumentType} uploaded`, detail: d.Status ? `now ${d.Status}` : undefined, tone: d.Status === "Verified" ? "done" : d.Status === "Rejected" ? "stopped" : undefined });
  if (a.AfsRegistrationDate) ev.push({ at: a.AfsRegistrationDate, title: "Registered at the Sub-Registrar", detail: a.AfsRegistrationNo ? `Doc no. ${a.AfsRegistrationNo}` : undefined, tone: "done" });
  ev.sort((p, q) => new Date(q.at).getTime() - new Date(p.at).getTime());
  const LIMIT = 8;
  const shown = all ? ev : ev.slice(0, LIMIT);
  const dot = (t?: string) => t === "done" ? "bg-emerald-600" : t === "stopped" ? "bg-rose-600" : t === "waiting" ? "bg-amber-500" : "bg-primary";
  if (!ev.length) return <p className="px-4 py-4 text-xs text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <div className="px-4 py-4">
      <ol className="relative ml-1.5 border-l border-border space-y-3">
        {shown.map((e, k) => (
          <li key={k} className="relative pl-4">
            <span className={cn("absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-card", dot(e.tone))} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold">{e.title}</span>
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0">{String(e.at).slice(0, 10)}</span>
            </div>
            {e.detail && <p className="text-[0.6875rem] text-muted-foreground mt-0.5 line-clamp-2">{e.detail}</p>}
          </li>
        ))}
      </ol>
      {ev.length > LIMIT && <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-xs text-primary hover:underline">{all ? "Show fewer" : `Show all ${ev.length}`}</button>}
    </div>
  );
};

/** Uploads a requested paper for the customer when they sent it another way (phone, email, in person): the file,
 *  then how it came and a note, through the agreement's proxy-attach (the same as before). */
const ProxyUpload: React.FC<{ agreementId: number; doc: any; onDone: () => void }> = ({ agreementId, doc, onDone }) => {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (method: ProxyMethod, remarks: string) => {
    if (!file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("ProxyMethod", method); fd.append("ProxyRemarks", remarks);
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/proxy-attach`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Upload failed");
      toast.success("Paper submitted on the customer's behalf");
      setFile(null);
      onDone();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <>
      <FilePicker onFiles={(files) => setFile(files[0])} label="For customer" className={cn(GRID_BTN, "h-7 px-2.5")} />
      {file && (
        <ProxyActionDialog title="Upload on the customer's behalf"
          description={`${file.name}: record how the customer sent this paper.`}
          confirmLabel="Submit paper" saving={saving} onClose={() => setFile(null)} onConfirm={submit} />
      )}
    </>
  );
};

const CrmAgreement: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const rawIdFilter = sp.get("id") ? parseInt(sp.get("id")!, 10) : null;
  const idFilter = rawIdFilter !== null && rawIdFilter > 0 ? rawIdFilter : null;
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: AGR_DEFAULT_SORT, defaultStatus: ALL });
  // The signing-date filter, this page's own beyond the common list ones.
  const [signed, setSignedRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const setSigned = (v: GridDateRange) => { setSignedRaw(v); s.setPage(1); };
  const listFiltered = s.hasFilters || signed.preset !== "any";
  const clearFilters = () => { s.reset(); setSignedRaw(GRID_ANY_DATE); };
  const [selectedRows, setSelectedRows] = useState<Map<string | number, any>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(idFilter);
  const view: "list" | "board" = sp.get("view") === "board" ? "board" : "list";
  const setView = (v: "list" | "board") => setSp((p) => { if (v === "board") p.set("view", "board"); else p.delete("view"); return p; }, { replace: true });
  const [showInsights, setShowInsightsRaw] = useState<boolean>(() => { try { return localStorage.getItem(AGR_INSIGHTS_KEY) !== "0"; } catch { return true; } });
  const setShowInsights = (on: boolean) => { setShowInsightsRaw(on); try { localStorage.setItem(AGR_INSIGHTS_KEY, on ? "1" : "0"); } catch { /* not kept: fine */ } };

  const selectAgreement = (id: number) => {
    setSelectedId(id);
    setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });
  };
  const backToList = () => {
    setSelectedId(null);
    setSp((p) => { p.delete("id"); p.delete("tab"); p.delete("bookingId"); return p; }, { replace: true });
  };

  const [agrDialog, setAgrDialog] = useState(false);
  const [docDialog, setDocDialog] = useState(false);
  const [docRequestDialog, setDocRequestDialog] = useState(false);
  const [sendDialog, setSendDialog] = useState(false);
  const [proposeDateDialog, setProposeDateDialog] = useState(false);
  const [sendDate, setSendDate] = useState("");
  const [regDialog, setRegDialog] = useState(false);
  const [regForm, setRegForm] = useState({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
  const [regFeesLocked, setRegFeesLocked] = useState(false);
  const [regSaving, setRegSaving] = useState(false);
  const [agrForm, setAgrForm] = useState({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
  const [docForm, setDocForm] = useState({ ...EMPTY_DOC_FORM });
  const [docRequestForm, setDocRequestForm] = useState({ ...EMPTY_DOC_REQUEST_FORM });
  const [showUrlField, setShowUrlField] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ LegalName: "", LegalAddress: "", PanNo: "", AadhaarNo: "", RevisionReason: "", LegalExecutiveId: "" });
  const [editLocked, setEditLocked] = useState(true);
  const editInputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${editLocked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;
  const [saving, setSaving] = useState(false);

  const urlTab = TAB_SLUGS[(sp.get("tab") || "").toLowerCase()];
  const [agrTab, setAgrTabRaw] = useState<AgrTab>(urlTab || "Timeline");
  const setAgrTab = (t: AgrTab) => {
    setAgrTabRaw(t);
    setSp((p) => { p.set("tab", SLUG_FOR_TAB[t]); return p; }, { replace: true });
  };
  useEffect(() => {
    setAgrTabRaw(TAB_SLUGS[(sp.get("tab") || "").toLowerCase()] || "Timeline");
    setEditingLegalExec(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const listQs = useMemo(() => {
    const p = listParams(s.query, ALL);
    const { from, to } = resolveGridDateRange(signed);
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    return p;
  }, [s.query, signed]);
  const { data: listData, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-agreements", listQs.toString()],
    queryFn: () => fetchAgreementsList(listQs),
    staleTime: 30_000,
  });
  const listResult = useSticky(listData);
  const agreements = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const statusCounts = listResult?.statusCounts ?? {};
  const [gridPrefs, setGridPrefs] = useGridPrefs(AGR_PREFS_KEY, AGR_COLS);
  // Every agreement under the same filters (any status, no paging), for the insights and the board.
  const allQs = useMemo(() => {
    const p = new URLSearchParams(listQs);
    ["page", "pageSize", "status", "sortKey", "sortDir"].forEach((k) => p.delete(k));
    return p;
  }, [listQs]);
  const { data: allRows = [], isFetching: allLoading } = useQuery({
    queryKey: ["crm-agreements", "all", allQs.toString()],
    queryFn: () => fetchAllAgreements(allQs),
    staleTime: 60_000,
    enabled: selectedId == null && (showInsights || view === "board"),
  });
  const boardRows = s.status === ALL ? allRows : allRows.filter((a: any) => a.Status === s.status);

  const { data: detail } = useQuery({
    queryKey: ["crm-agreement-detail", selectedId],
    queryFn: () => fetchAgreementDetail(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  // Own keys: this list (eligible bookings) and the legal executives used to share "crm-bookings" and "sa-users" with
  // Bookings' and Welcome Calls' lists, so a visit there could fill the legal-executive pick with salespeople.
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-agreement-eligible-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: dateHistory = [] } = useQuery({
    queryKey: ["crm-agreement-date-history", selectedId],
    queryFn: () => fetchDateHistory(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  const { data: revisions = [] } = useQuery({
    queryKey: ["crm-agreement-revisions", selectedId],
    queryFn: () => fetchRevisions(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  const { data: welcomeCallsForBkg = [] } = useQuery({
    queryKey: ["crm-welcome-calls-for-bkg", (detail as any)?.BookingId],
    queryFn: () => fetchWelcomeCallsForBooking((detail as any).BookingId),
    enabled: selectedId != null && (detail as any)?.BookingId != null,
    staleTime: 60_000,
  });
  const preferredAgrDate = (() => {
    const hit = (welcomeCallsForBkg as any[]).find((c: any) => c.PreferredAgreementDate);
    return hit ? String(hit.PreferredAgreementDate).slice(0, 10) : "";
  })();

  // Nothing opens by itself: the user picks an agreement, or arrives via an
  // ?id= / ?bookingId= link. (It used to open the first row on load.)

  // ?bookingId= deep-link resolver — same as before.
  const handledBkgFilterRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bkgFilter || idFilter) return;
    if (handledBkgFilterRef.current === bkgFilter) return;
    handledBkgFilterRef.current = bkgFilter;
    let cancelled = false;
    (async () => {
      const agId = await fetchAgreementIdByBooking(bkgFilter);
      if (cancelled) return;
      if (agId) {
        setSelectedId(agId);
      } else {
        setAgrForm((f) => ({ ...f, BookingId: bkgFilter }));
        setAgrDialog(true);
      }
    })();
    return () => { cancelled = true; };
  }, [bkgFilter, idFilter]);

  // Auto-fill from booking in the New Agreement dialog.
  useEffect(() => {
    if (!agrForm.BookingId || !agrDialog) return;
    const bkg = (bookings as any[]).find((b) => String(b.Id) === String(agrForm.BookingId));
    if (!bkg) return;
    setAgrForm((f) => ({
      ...f,
      LegalName:    f.LegalName    || bkg.LegalName    || "",
      PanNo:        f.PanNo        || bkg.PanNo        || "",
      AadhaarNo:    f.AadhaarNo    || bkg.AadhaarNo    || "",
      LegalAddress: f.LegalAddress || bkg.LegalAddress || "",
    }));
  }, [agrForm.BookingId, agrDialog]);

  const handleSaveAgreement = async () => {
    if (!agrForm.BookingId) { toast.error("Booking is required"); return; }
    if (agrForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(agrForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (agrForm.AadhaarNo && !/^\d{12}$/.test(agrForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...agrForm,
          BookingId: parseInt(agrForm.BookingId),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create agreement");
      toast.success(`Agreement ${data.AgreementNo} created`);
      setAgrDialog(false);
      if (data.id != null) selectAgreement(data.id);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      ["crm-agreements", "crm-agreement-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAddDocument = async () => {
    if (selectedId == null) return;
    if (!docForm.DocumentUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add document");
      toast.success("Document added");
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestDocument = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docRequestForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request document");
      toast.success("Document requested — the customer will see it in their portal");
      setDocRequestDialog(false);
      setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDocFiles = async (files: FileList | null) => {
    if (selectedId == null || !files?.length) return;
    setUploadingDocs(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docForm.DocumentType);
      if (docForm.IssuedBy) formData.append("IssuedBy", docForm.IssuedBy);
      if (docForm.Remarks) formData.append("Remarks", docForm.Remarks);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploadingDocs(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  const handleDocStatusChange = async (docId: number, status: string) => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update document");
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleSendToCustomer = async (proposedDate: string) => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/send-to-customer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate: proposedDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement sent to customer portal");
      setSendDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleProposeDate = async (proposedDate: string) => {
    if (selectedId == null || !proposedDate) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proposed date sent to customer");
      setProposeDateDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptDate = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/date/accept`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Date accepted — sent for super admin approval");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAgreementAction = async (action: "mark-executed" | "mark-registered" | "cancel") => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${action}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Agreement marked ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      if (action === "mark-executed") {
        promptNextStep(navigate, "Agreement executed — Legal Milestones and NOC can now begin.", "/crm/legal-milestones", "Go to Legal Milestones");
      } else if (action === "mark-registered") {
        promptNextStep(navigate, "Agreement registered — you may now request NOC and begin the possession process.", "/crm/noc", "Go to NOC");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleMarkRegistered = async () => {
    if (selectedId == null) return;
    if (!regForm.AfsRegistrationNo.trim()) { toast.error("AFS Registration No. is required"); return; }
    if (!regForm.AfsRegistrationDate) { toast.error("AFS Registration Date is required"); return; }
    setRegSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/mark-registered`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AfsRegistrationNo: regForm.AfsRegistrationNo.trim(),
          AfsRegistrationDate: regForm.AfsRegistrationDate,
          AfsStampDuty: regForm.AfsStampDuty !== "" ? regForm.AfsStampDuty : undefined,
          AfsRegistrationFee: regForm.AfsRegistrationFee !== "" ? regForm.AfsRegistrationFee : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement marked Registered");
      setRegDialog(false);
      setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      promptNextStep(navigate, "Agreement registered — you may now request Bank / Organisation NOC.", "/crm/noc", "Go to NOC");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setRegSaving(false);
    }
  };

  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxyDateDialog, setProxyDateDialog] = useState(false);
  const [proxyProposeDateDialog, setProxyProposeDateDialog] = useState(false);
  const [proxyProposedDate, setProxyProposedDate] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  const handleProxyCustomerApprove = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer approval recorded on their behalf");
      setProxyApproveDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyDateAccept = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-date-accept`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer date acceptance recorded on their behalf");
      setProxyDateDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyCustomerRecheck = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-recheck`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer recheck request recorded on their behalf");
      setProxyRecheckDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyProposeDate = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null || !proxyProposedDate) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks, ProposedDate: proxyProposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer's proposed date recorded on their behalf");
      setProxyProposeDateDialog(false);
      setProxyProposedDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const [togglingPortal, setTogglingPortal] = useState(false);
  const handleTogglePortalAccess = async (deactivate: boolean) => {
    if (selectedId == null) return;
    setTogglingPortal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/portal/${deactivate ? "deactivate" : "reactivate"}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(deactivate ? "Portal access deactivated" : "Portal access reactivated");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setTogglingPortal(false);
    }
  };

  const openEdit = () => {
    if (!detail?.agreement) return;
    setEditForm({
      LegalName: detail.agreement.LegalName || detail.agreement.ApplicantName || "",
      LegalAddress: detail.agreement.LegalAddress || "",
      PanNo: detail.agreement.PanNo || detail.agreement.CustomerPanNo || "",
      AadhaarNo: detail.agreement.AadhaarNo || detail.agreement.CustomerAadhaarNo || "",
      RevisionReason: "",
      LegalExecutiveId: detail.agreement.LegalExecutiveId != null ? String(detail.agreement.LegalExecutiveId) : "",
    });
    setEditLocked(true);
    setEditDialog(true);
  };

  const [assigningLegal, setAssigningLegal] = useState(false);
  const [editingLegalExec, setEditingLegalExec] = useState(false);
  const handleAssignLegal = async (legalExecutiveId: string) => {
    if (selectedId == null) return;
    setAssigningLegal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/assign-legal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ LegalExecutiveId: legalExecutiveId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(legalExecutiveId ? "Legal executive assigned" : "Legal executive unassigned");
      setEditingLegalExec(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAssigningLegal(false);
    }
  };

  const handleSaveEdit = async () => {
    if (selectedId == null) return;
    if (editForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (editForm.AadhaarNo && !/^\d{12}$/.test(editForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.versionBumped ? "Details updated — prior version preserved in history" : "Details updated");
      setEditDialog(false);
      setEditLocked(true);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-revisions", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const rights = usePageRights("crm-agreements");
  const afsPayRights = usePageRights("crm-afs-query-payment");
  const afsRegRights = usePageRights("crm-afs-registry");
  const tabAllowed = (t: AgrTab): boolean =>
    t === "AFS Payment" ? afsPayRights.canView :
    t === "AFS Registry" ? afsRegRights.canView : true;

  const canWork = rights.canEdit;
  return (
    <>
      <Breadcrumbs items={selectedId != null ? ["Dashboard", "CRM", "Agreements", "Record"] : ["Dashboard", "CRM", "Agreements"]} />
      {ask.node}
      <CrmAppPage icon={ScrollText} section="CRM · Legal & Possession" title="Agreements"
        subtitle={selectedId != null ? undefined : "The agreement for sale: legal paperwork, senior and customer approval, the signing date, execution, then AFS payment and registry."}
        actions={<>
          {selectedId != null && <button type="button" onClick={backToList} className={GRID_BTN}><ArrowLeft size={13} /> All agreements</button>}
          {/* The server creates under the create right. */}
          {rights.canCreate && <button type="button" onClick={() => setAgrDialog(true)} className={GRID_BTN_BRAND}><Plus size={13} /> New agreement</button>}
        </>}>

        {selectedId == null && showInsights && (
          <AgreementInsights rows={allRows} loading={allLoading} onOpen={selectAgreement} onBoard={() => setView("board")} />
        )}

        {/* The list stays mounted while a record is open, so its tab, search, filters, sort and page survive the round trip. */}
        <div hidden={selectedId != null} className={cn(GRID_CARD, "overflow-hidden")}>
          <div className="px-4 pt-3 pb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold leading-tight">{s.status === ALL ? "All agreements" : s.status}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {view === "board" ? `${boardRows.filter((a: any) => agreementCurrentIndex(a, rowFollowupProgress(a)) >= 0).length.toLocaleString("en-IN")} open on the board · longest waiting first` : gridListMeta(total, AGR_COLS, s.sort, listFiltered)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowInsights(!showInsights)} aria-pressed={showInsights}
                className={cn(GRID_BTN, showInsights && "bg-primary/10 border-primary/30")}><BarChart3 size={13} /> Insights</button>
              <GridSegment label="View" value={view} onChange={setView} options={[
                { key: "list", label: "List", icon: ScrollText },
                { key: "board", label: "Board", icon: FolderClock },
              ]} />
            </div>
          </div>
          <GridTabs label="Status" active={s.status} onChange={s.setStatus}
            tabs={[ALL, ...AGR_STATUSES].map((k) => ({ key: k, label: k, count: listResult ? (k === ALL ? Object.values(statusCounts).reduce((n, x) => n + x, 0) : statusCounts[k] ?? 0) : null }))} />
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
            <GridMetric label="Agreements" value={total.toLocaleString("en-IN")} />
            <GridMetric label="In progress" value={(statusCounts[CrmStatus.DRAFT] ?? 0).toLocaleString("en-IN")} />
            <GridMetric label="Executed, to register" value={(statusCounts[CrmStatus.EXECUTED] ?? 0).toLocaleString("en-IN")} strong />
            <GridMetric label="Registered" value={(statusCounts[CrmStatus.REGISTERED] ?? 0).toLocaleString("en-IN")} />
          </div>

          {selectedRows.size > 0 && (
            <GridBulkBar count={selectedRows.size} onClear={() => setSelectedRows(new Map())}>
              <button type="button" className={GRID_BTN} onClick={() => exportGrid([...selectedRows.values()], gridVisibleCols(AGR_COLS, gridPrefs), `agreements-selected-${selectedRows.size}`)}>
                <Download size={13} /> Export selected
              </button>
              <button type="button" className={GRID_BTN} onClick={async () => {
                try { await navigator.clipboard.writeText([...selectedRows.values()].map((a) => a.AgreementNo).join("\n")); toast.success(`Copied ${selectedRows.size} agreement number${selectedRows.size === 1 ? "" : "s"}`); }
                catch { toast.error("Could not copy. Your browser blocked the clipboard."); }
              }}><Copy size={13} /> Copy numbers</button>
            </GridBulkBar>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, agreement or booking" />
            <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
            <GridDateFilter label="Signing date" value={signed} onChange={setSigned} />
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
              <GridSavedViews storageKey={AGR_VIEWS_KEY}
                current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize, extra: { signed } }}
                onApply={(v) => {
                  setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                  s.apply(v);
                  const x = (v.extra ?? {}) as { signed?: GridDateRange };
                  setSignedRaw(x.signed?.preset ? x.signed : GRID_ANY_DATE);
                }} />
              <GridColumnChooser cols={AGR_COLS} prefs={gridPrefs} onChange={setGridPrefs} />
              <button type="button" className={GRID_BTN} disabled={exporting || total === 0} title="Export to Excel" onClick={async () => {
                setExporting(true); setExportError(null);
                try { exportGrid(await fetchAllAgreements(listQs), gridVisibleCols(AGR_COLS, gridPrefs), `agreements-${s.status.toLowerCase()}`); }
                catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
              }}>
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
          </div>

          {view === "board" ? (
            <div className="p-3"><AgreementBoard rows={boardRows} loading={allLoading} onOpen={selectAgreement} activeId={selectedId} /></div>
          ) : (
          <CrmGrid cols={AGR_COLS} prefs={gridPrefs} onPrefs={setGridPrefs} rows={agreements} rowKey={(a: any) => a.Id}
            loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
            sort={s.sort} onSort={s.toggleSort} onRowClick={(a: any) => selectAgreement(a.Id)} activeKey={selectedId}
            selected={selectedRows} onSelect={setSelectedRows}
            empty={listFiltered ? "No agreement matches these filters." : "No agreements yet. One is made when a booking has everything it needs."}
            page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          )}
        </div>

        {selectedId != null && (
          !detail ? (
            <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>
          ) : (
            <div className="space-y-4">
              <GridHighlights icon={ScrollText}
                object={`Agreement · ${detail.agreement?.AgreementNo ?? ""}${detail.agreement?.VersionNo > 1 ? ` · version ${detail.agreement.VersionNo}` : ""}`}
                title={<ApplicantNames name={detail.agreement?.ApplicantName} bookingId={detail.agreement?.BookingId} applicationId={detail.agreement?.ApplicationId} />}
                status={<span className="inline-flex flex-wrap items-center gap-2">
                  <GridStatusPill status={detail.agreement?.Status} />
                  {agreementAlerts(detail.agreement).map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}
                  {detail.agreement && isBookingCancelled(detail.agreement) && (
                    <span title={`Booking ${detail.agreement.BookingStatus || "inactive"}: Edit, Send and Mark actions are locked. Cancel the agreement instead.`}>
                      <GridStatusPill status="Rejected" label={`Booking ${detail.agreement.BookingStatus || "inactive"}`} />
                    </span>
                  )}
                </span>}
                sub={[detail.agreement?.BookingNo, [detail.agreement?.ProjectName, detail.agreement?.UnitNo].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
                actions={<>
                  {rights.canEdit && detail.agreement?.Status === CrmStatus.DRAFT && (
                    <button type="button" onClick={openEdit} disabled={isBookingCancelled(detail.agreement)}
                      title={isBookingCancelled(detail.agreement) ? "The booking is cancelled: it can't be edited" : undefined} className={GRID_BTN}>
                      <Pencil size={13} /> Edit details
                    </button>
                  )}
                  {canWork && detail.agreement?.Status === CrmStatus.DRAFT && (() => {
                    const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                    const approvalsReady = detail.agreement?.SeniorApprovalStatus === CrmStatus.APPROVED
                      && detail.agreement?.CustomerApprovalStatus === CrmStatus.APPROVED
                      && detail.agreement?.AgreementDate;
                    const blocked = isBookingCancelled(detail.agreement) ? "The booking is cancelled: it can't be marked executed"
                      : !approvalsReady ? "Needs senior approval, customer approval and an agreed date"
                      : detail.agreement?.LegalExecutiveId == null ? "Assign a legal executive first (Legal & Approval tab)"
                      : pendingDocs.length ? `Mandatory documents not verified yet: ${pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ")}`
                      : null;
                    return (
                      <button type="button" onClick={() => handleAgreementAction("mark-executed")} disabled={!!blocked} title={blocked ?? undefined}
                        className={blocked ? GRID_BTN : GRID_BTN_BRAND}>
                        <Check size={13} /> Mark executed
                      </button>
                    );
                  })()}
                  {canWork && detail.agreement?.Status === CrmStatus.EXECUTED && (() => {
                    const blocked = isBookingCancelled(detail.agreement) ? "The booking is cancelled: it can't be marked registered"
                      : detail.agreement?.AfsRegistryStatus !== "Completed" ? "Mark the AFS Registry (the sub-registrar visit) completed first"
                      : null;
                    return (
                      <button type="button" disabled={!!blocked} title={blocked ?? undefined} className={blocked ? GRID_BTN : GRID_BTN_BRAND}
                        onClick={() => {
                          const ag = detail.agreement;
                          const hasConfirmed = ag?.AfsQpConfirmedAmount != null;
                          let prefillStamp = "";
                          let prefillFee   = "";
                          if (hasConfirmed) {
                            if (ag.AfsQpStampDuty != null && ag.AfsQpRegistrationFee != null) {
                              prefillStamp = String(ag.AfsQpStampDuty);
                              prefillFee   = String(ag.AfsQpRegistrationFee);
                            } else {
                              prefillStamp = String(ag.AfsQpConfirmedAmount);
                            }
                          } else if (ag?.AfsQpStampDuty != null || ag?.AfsQpRegistrationFee != null) {
                            prefillStamp = ag.AfsQpStampDuty   != null ? String(ag.AfsQpStampDuty)        : "";
                            prefillFee   = ag.AfsQpRegistrationFee != null ? String(ag.AfsQpRegistrationFee) : "";
                          } else {
                            prefillStamp = ag?.AfsStampDuty      != null ? String(ag.AfsStampDuty)      : "";
                            prefillFee   = ag?.AfsRegistrationFee != null ? String(ag.AfsRegistrationFee) : "";
                          }
                          setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: prefillStamp, AfsRegistrationFee: prefillFee });
                          setRegFeesLocked(prefillStamp !== "" || prefillFee !== "");
                          setRegDialog(true);
                        }}>
                        <CheckCircle2 size={13} /> Mark registered
                      </button>
                    );
                  })()}
                  {canWork && (detail.agreement?.Status === CrmStatus.DRAFT || detail.agreement?.Status === CrmStatus.EXECUTED) && (
                    <button type="button" onClick={async () => { if (await ask.confirm(`Cancel agreement ${detail.agreement?.AgreementNo}?`, { okLabel: "Cancel agreement", cancelLabel: "Keep it", danger: true })) handleAgreementAction("cancel"); }}
                      className={cn(GRID_BTN, "text-destructive hover:bg-destructive/5")}>
                      <X size={13} /> Cancel agreement
                    </button>
                  )}
                  <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/bookings?view=${detail.agreement?.BookingId}`)}><Building2 size={13} /> Open booking</button>
                </>}
                fields={[
                  { label: "Signing date", value: detail.agreement?.AgreementDate ? String(detail.agreement.AgreementDate).slice(0, 10) : "Not set" },
                  { label: "At this step", value: daysText(agreementDaysAtStep(detail.agreement, detail.documents)) },
                  { label: "Legal executive", value: detail.agreement?.LegalExecutiveName || "Not assigned" },
                  { label: "Senior approval", value: detail.agreement?.SeniorApprovalStatus || "—" },
                  { label: "Customer approval", value: detail.agreement?.CustomerApprovalStatus || "—" },
                  { label: "Papers uploaded", value: (() => { const f = followupProgress(detail.documents); return <GridProgress done={f.uploaded} total={f.required} title={`${f.uploaded} of ${f.required} mandatory papers uploaded`} />; })() },
                  { label: detail.agreement?.IsPlotSale ? "Total value (land)" : "Total value (incl. GST)", value: detail.agreement?.GrandTotal ? fmtRupees(detail.agreement.GrandTotal) : "—" },
                ]} />

              {detail.agreement?.Status !== CrmStatus.CANCELLED && (
                <GridPath steps={agreementStepStates(detail.agreement, detail.documents).map((st) => ({
                  label: st.label,
                  state: isBookingCancelled(detail.agreement) && st.state === "current" ? "failed" as const : st.state === "upcoming" ? "todo" as const : st.state,
                  onClick: tabAllowed(st.tab) ? () => setAgrTab(st.tab) : undefined,
                  active: agrTab === st.tab && st.state === "current",
                }))} />
              )}

              {detail.agreement?.Status !== CrmStatus.CANCELLED && (() => {
                const a = detail.agreement;
                const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                let tone: GridGuidanceTone = "moving";
                let text = "";
                let subtext = "";
                let cta: { label: string; onClick: () => void } | null = null;
                if (isBookingCancelled(a)) {
                  tone = "stopped";
                  text = `The booking is ${a?.BookingStatus || "inactive"}: this agreement is locked.`;
                  subtext = "Cancel the agreement to close it out.";
                } else if (a?.Status === CrmStatus.REGISTERED) {
                  tone = "done";
                  text = "Complete: registered at the Sub-Registrar.";
                } else if (a?.Status === CrmStatus.EXECUTED) {
                  tone = "moving";
                  text = "Executed.";
                  subtext = "Complete the AFS Registry, then record the Sub-Registrar registration no. to mark it registered.";
                } else if (a?.LegalExecutiveId == null) {
                  tone = "waiting";
                  text = "No legal executive assigned.";
                  subtext = "Assign the person who prepares the paperwork, on the Legal & Approval tab. It is needed before execution.";
                } else if (a?.SeniorApprovalStatus !== CrmStatus.APPROVED) {
                  tone = "waiting";
                  text = "Waiting for senior approval.";
                  subtext = "Submit it from the Legal & Approval tab; an approver then approves it from the Approval Inbox.";
                } else if (!a?.SentToCustomerAt) {
                  tone = "moving";
                  text = "Senior-approved: ready to share with the customer.";
                  cta = { label: "Send to customer portal", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                } else if (a?.CustomerApprovalStatus === "RecheckRequested") {
                  tone = "stopped";
                  text = "The customer asked for a recheck.";
                  subtext = a?.LastRecheckRemarks ? `"${a.LastRecheckRemarks}"` : "Fix the point raised and send it again.";
                  cta = { label: "Resend after recheck", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                } else if (a?.CustomerApprovalStatus !== CrmStatus.APPROVED) {
                  tone = "waiting";
                  text = "Sent to the customer: waiting for them to review and approve.";
                  subtext = a?.SentToCustomerAt ? `Sent ${String(a.SentToCustomerAt).slice(0, 10)}` : "";
                } else if (!a?.AgreementDate) {
                  if (a?.DateApprovalStatus === CrmStatus.PENDING) {
                    tone = "waiting";
                    text = "Both sides agreed a date: waiting for the super admin to confirm it.";
                  } else if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) {
                    tone = "waiting";
                    text = `We proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"}: waiting for the customer's answer.`;
                  } else if (a?.ProposedDateStatus === "PendingCompanyReview") {
                    tone = "moving";
                    text = `The customer proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"}: accept it or propose another.`;
                    cta = { label: "Accept date", onClick: handleAcceptDate };
                  } else {
                    tone = "moving";
                    text = "The customer approved: now propose the signing date.";
                    cta = { label: "Propose signing date", onClick: () => { setSendDate(preferredAgrDate); setProposeDateDialog(true); } };
                  }
                } else if (pendingDocs.length) {
                  tone = "waiting";
                  text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still to verify.`;
                  subtext = pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ");
                } else {
                  tone = "moving";
                  text = "Every check has passed: ready to mark this agreement executed.";
                  cta = { label: "Mark executed", onClick: () => handleAgreementAction("mark-executed") };
                }
                // The action is offered only with the edit right (the server refuses otherwise).
                return (
                  <GridGuidance tone={tone} title={text} text={subtext}
                    action={cta && canWork ? <button type="button" onClick={cta.onClick} className={GRID_BTN_BRAND}>{cta.label}</button> : undefined} />
                );
              })()}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] items-start">
              <section className={cn(GRID_CARD, "overflow-hidden min-w-0")}>
                <GridTabs label="Agreement record" active={agrTab} onChange={setAgrTab}
                  tabs={AGR_TABS.filter(tabAllowed).map((t) => ({
                    key: t, label: t,
                    count: t === "Documents" ? (detail.documents?.length ?? 0) : undefined,
                  }))} />
                <div className="p-4 space-y-4">
              {agrTab === "Overview" && (
              <div className="border border-border overflow-hidden space-y-0">
                <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                  <div className="px-4 py-3">
                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Booking</p>
                    <p className="text-sm font-semibold">{detail.agreement?.BookingNo}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">{detail.agreement?.UnitNo}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Project</p>
                    <p className="text-sm font-semibold truncate">{detail.agreement?.ProjectName || "—"}</p>
                  </div>
                  <div className={`px-4 py-3 ${detail.agreement?.AgreementDate ? "bg-emerald-500/5" : ""}`}>
                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Agreement Date</p>
                    {detail.agreement?.AgreementDate ? (
                      <p className="text-sm font-bold text-foreground">{String(detail.agreement.AgreementDate).slice(0, 10)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60 italic">Not set</p>
                    )}
                  </div>
                </div>

                <div className="px-4 py-3 space-y-2 border-b border-border">
                  <p className="text-xs text-muted-foreground font-medium">Legal Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {[
                    ["Legal Name",       detail.agreement?.LegalName || detail.agreement?.ApplicantName || "—"],
                    ["PAN (Permanent Account Number)",              detail.agreement?.PanNo || detail.agreement?.CustomerPanNo || "—"],
                    ["Aadhaar",          detail.agreement?.AadhaarNo || detail.agreement?.CustomerAadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span className="text-xs font-medium text-muted-foreground block">{k}</span>
                      <span className="font-medium text-sm">{v}</span>
                    </div>
                  ))}
                  {detail.agreement?.LegalAddress && (
                    <div className="col-span-2">
                      <span className="text-xs font-medium text-muted-foreground block">Legal Address</span>
                      <span className="text-sm text-muted-foreground">{detail.agreement.LegalAddress}</span>
                    </div>
                  )}
                  <div className="col-span-2 pt-1 border-t border-border/60">
                    <span className={`block ${LBL}`}>{detail.agreement?.IsPlotSale ? "Total value (land, no GST)" : "Total value (incl. GST)"}</span>
                    <span className="block font-heading text-xl font-bold tabular-nums text-foreground mt-1">
                      {detail.agreement?.GrandTotal ? fmtRupees(detail.agreement.GrandTotal) : "—"}
                    </span>
                    {detail.agreement?.GrandTotal > 0 && (
                      <span className="text-[0.6875rem] text-muted-foreground block mt-0.5 tabular-nums">
                        {detail.agreement?.IsPlotSale ? "Land" : "Unit"} {fmtRupees(detail.agreement.TotalValue)}
                        {detail.agreement?.UnitGstAmount > 0 && ` + GST ${fmtRupees(detail.agreement.UnitGstAmount)}`}
                        {detail.agreement?.ParkingTotal > 0 && ` + Parking ${fmtRupees(detail.agreement.ParkingTotal)}`}
                        {detail.agreement?.ExtraChargesTotal > 0 && ` + Extra ${fmtRupees(detail.agreement.ExtraChargesTotal)}`}
                      </span>
                    )}
                  </div>
                </div>
                </div>

                {detail?.financialSummary && (() => {
                  const ag = detail.agreement;
                  const storedGrand = Number(ag?.GrandTotal ?? 0);
                  const grandTotal = storedGrand > 0 ? storedGrand : (Number(ag?.TotalValue || 0) + Number(ag?.UnitGstAmount || 0) + Number(ag?.ParkingTotal || 0) + Number(ag?.ExtraChargesTotal || 0));
                  return (
                  <div className="px-4 py-3 border-b border-border">
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={Number(detail.financialSummary.cleared || 0)}
                    pendingReceipts={Number(detail.financialSummary.mrOnAccount || 0)}
                    approvedOnAccount={Number(detail.financialSummary.approvedOnAccount || 0)}
                    compact
                  />
                  </div>
                  );
                })()}

                {detail.agreement?.Status === CrmStatus.REGISTERED && (
                  <div className="px-4 py-3 bg-emerald-500/5 border-b border-emerald-500/30 space-y-2">
                    <p className="text-[0.6875rem] font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> AFS Registration (Sub-Registrar)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block">Doc No.</span>
                        <span className="font-semibold font-heading tabular-nums">{detail.agreement.AfsRegistrationNo || "—"}</span>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block">Registration Date</span>
                        <span className="font-semibold">{detail.agreement.AfsRegistrationDate ? String(detail.agreement.AfsRegistrationDate).slice(0, 10) : "—"}</span>
                      </div>
                      {detail.agreement.AfsStampDuty != null && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground block">Stamp Duty Paid</span>
                          <span className="font-semibold font-heading tabular-nums">{Number(detail.agreement.AfsStampDuty).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      {detail.agreement.AfsRegistrationFee != null && (
                        <div>
                          <span className="text-xs font-medium text-muted-foreground block">Registration Fee</span>
                          <span className="font-semibold font-heading tabular-nums">{Number(detail.agreement.AfsRegistrationFee).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {revisions.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Version History (prior to v{detail.agreement?.VersionNo})</p>
                    <div className="space-y-1.5 text-xs">
                      {(revisions as any[]).map((r) => (
                        <div key={r.Id} className="border border-border p-2.5 bg-muted/20">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="px-1.5 py-0.5 border border-border bg-card text-foreground text-[0.625rem] font-medium">v{r.VersionNo}</span>
                            <span>{r.Reason}</span>
                            <span className="text-[0.625rem]">({fmtIstIso(r.CreatedAt)}{r.CreatedByName ? ` · ${r.CreatedByName}` : ""})</span>
                          </div>
                          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                            {r.LegalName && <div><span className="text-muted-foreground">Legal Name: </span>{r.LegalName}</div>}
                            {r.AgreementDate && <div><span className="text-muted-foreground">Agreement Date: </span>{String(r.AgreementDate).slice(0,10)}</div>}
                            {r.PanNo && <div><span className="text-muted-foreground">PAN: </span>{r.PanNo}</div>}
                            {r.AadhaarNo && <div><span className="text-muted-foreground">Aadhaar: </span>{r.AadhaarNo}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              )}

              {agrTab === "Legal & Approval" && (() => {
                const a = detail.agreement;
                const cancelled = isBookingCancelled(a);
                const legalAssigned = a?.LegalExecutiveId != null;
                const seniorStatus = a?.SeniorApprovalStatus;
                const seniorApproved = seniorStatus === CrmStatus.APPROVED;
                const seniorPending  = seniorStatus === CrmStatus.PENDING;
                const seniorRejected = seniorStatus === CrmStatus.REJECTED;
                const sent        = !!a?.SentToCustomerAt;
                const custStatus  = a?.CustomerApprovalStatus;
                const custApproved = custStatus === CrmStatus.APPROVED;
                const custRecheck  = custStatus === "RecheckRequested";
                const dated   = !!a?.AgreementDate;
                const executed = [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(a?.Status);
                const stepsComplete = [seniorApproved, sent, custApproved, dated, executed].filter(Boolean).length;

                const circleCls = (s: "done"|"active"|"warn"|"upcoming") =>
                  s === "done"     ? "bg-emerald-600 text-white ring-2 ring-emerald-500/30" :
                  s === "active"   ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                  s === "warn"     ? "bg-destructive text-white ring-2 ring-red-200 dark:ring-red-900" :
                  "bg-muted text-muted-foreground";

                return (
                  <div className="space-y-4">
                    <div className="border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                          <UserCircle2 size={15} className="text-foreground" /> Legal Executive
                        </h3>
                        {legalAssigned
                          ? <GridStatusPill status="Approved" label="Assigned" />
                          : <GridStatusPill status="Pending" label="Unassigned" />
                        }
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <p className="text-xs text-muted-foreground">The person responsible for preparing this agreement's paperwork. Required before execution (server-enforced).</p>
                        {a?.LegalExecutiveId != null && !editingLegalExec && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 flex-1 bg-muted/40 border border-border px-3 py-1.5">
                              <UserCircle2 size={14} className="text-foreground shrink-0" />
                              <span className="text-sm font-medium">{a.LegalExecutiveName}</span>
                              <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                            </div>
                            <button
                              onClick={() => setEditingLegalExec(true)}
                              className="text-xs px-2.5 py-1.5 border border-border text-muted-foreground hover:bg-muted shrink-0">
                              Change
                            </button>
                          </div>
                        ) : ["Registered", "Cancelled"].includes(a?.Status) || cancelled ? (
                          <div className="font-medium text-sm">{a?.LegalExecutiveName || <span className="text-foreground">Unassigned</span>}</div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <SearchableNativeSelect
                              value={a?.LegalExecutiveId != null ? String(a.LegalExecutiveId) : ""}
                              disabled={assigningLegal}
                              onChange={(e) => handleAssignLegal(e.target.value)}
                              className={`flex-1 text-sm border px-2 py-1.5 bg-background disabled:opacity-40 ${
                                a?.LegalExecutiveId != null ? "border-border" : "border-border text-foreground"}`}>
                              <option value="">— Unassigned —</option>
                              {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                            </SearchableNativeSelect>
                            {editingLegalExec && (
                              <button
                                onClick={() => setEditingLegalExec(false)}
                                className="text-xs px-2.5 py-1.5 border border-border text-muted-foreground hover:bg-muted shrink-0">
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                        {a?.LegalExecutiveId == null && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled && (
                          <p className="text-xs text-foreground bg-card border border-border px-2 py-1.5">
                            Assign someone now so they receive an immediate notification and can start preparing the paperwork.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                          <ShieldAlert size={15} className="text-foreground" /> Approval Timeline
                        </h3>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[0,1,2,3,4].map((i) => (
                              <div key={i} className={`w-2 h-2 rounded-full ${i < stepsComplete ? "bg-emerald-600" : "bg-muted"}`} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{stepsComplete}/5</span>
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${seniorApproved ? "bg-emerald-500/5" : seniorRejected ? "bg-destructive/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(seniorApproved ? "done" : seniorRejected ? "warn" : seniorPending ? "active" : "upcoming")}`}>
                          {seniorApproved ? <Check size={14} /> : seniorRejected ? <AlertCircle size={13} /> : 1}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Senior Review</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              seniorApproved ? "text-foreground bg-card border-border"
                              : seniorRejected ? "text-destructive bg-destructive/5 border-destructive/40"
                              : "text-foreground bg-card border-border"
                            }`}>{seniorStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            An admin or super-admin approves this agreement before it's shared with the customer. Once submitted, review happens from the <strong>Admin Approval Inbox</strong>.
                          </p>
                          {seniorApproved && a?.SeniorApprovedAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved {String(a.SeniorApprovedAt).slice(0,10)}
                              {a?.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {a.SeniorApprovalRemarks}</span>}
                            </p>
                          )}
                          {seniorRejected && a?.SeniorApprovalRemarks && (
                            <div className="text-xs text-destructive bg-destructive/5 border border-destructive/40 px-2 py-1.5">
                              <strong>Rejection reason:</strong> {a.SeniorApprovalRemarks}
                            </div>
                          )}
                          {!cancelled && !seniorApproved && (
                            <div className="flex items-center gap-2 flex-wrap pt-0.5">
                              <ApprovalActions
                                status={a?.SeniorApprovalStatus}
                                recordId={a?.Id}
                                endpoint={API}
                                submitOnly
                                onSuccess={() => {
                                  qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                                  qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                                }}
                              />
                              {seniorPending && <span className="text-xs text-muted-foreground">Awaiting review in Admin Inbox</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${sent ? "bg-emerald-500/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(sent ? "done" : seniorApproved ? "active" : "upcoming")}`}>
                          {sent ? <Check size={14} /> : 2}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Shared with Customer</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              sent ? "text-foreground bg-card border-border" : "text-muted-foreground bg-muted/30 border-border"
                            }`}>{sent ? "Sent" : "Not sent"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            The customer can view this agreement in their portal and approve it or request a recheck.
                          </p>
                          {sent && a?.SentToCustomerAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <Send size={11} /> Sent {fmtIstIso(a.SentToCustomerAt)}
                            </p>
                          )}
                          {seniorApproved && !sent && !cancelled && (
                            <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                              className={`${KEY_INK} h-8 px-3`}>
                              Send to Customer Portal
                            </button>
                          )}
                          {custRecheck && seniorApproved && !cancelled && (
                            <div className="space-y-1.5 pt-0.5">
                              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/40 px-2 py-1.5">
                                <strong>Recheck requested ({a.RecheckCount}x):</strong> {a.LastRecheckRemarks || "No remark provided"}
                              </div>
                              <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                                className={`${KEY_INK} h-8 px-3`}>
                                Resend After Recheck
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${custApproved ? "bg-emerald-500/5" : custRecheck ? "bg-destructive/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(custApproved ? "done" : custRecheck ? "warn" : sent ? "active" : "upcoming")}`}>
                          {custApproved ? <Check size={14} /> : custRecheck ? <AlertCircle size={13} /> : 3}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Customer Approval</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              custApproved ? "text-foreground bg-card border-border"
                              : custRecheck ? "text-destructive bg-destructive/5 border-destructive/40"
                              : "text-foreground bg-card border-border"
                            }`}>{custStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Customer reviews the agreement from their portal and approves it or flags issues.
                          </p>
                          {custApproved && a?.CustomerApprovedAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved by customer {String(a.CustomerApprovedAt).slice(0,10)}
                            </p>
                          )}
                          {a?.RecheckCount > 0 && !custApproved && (
                            <p className="text-xs text-destructive">Recheck count: {a.RecheckCount} · Last remark: {a.LastRecheckRemarks || "—"}</p>
                          )}
                          {sent && !custApproved && !custRecheck && !cancelled && (
                            <div className="pt-1 border-t border-border/60 mt-1">
                              <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1">
                                <UserCircle2 size={11} /> Customer not on portal?
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setProxyApproveDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-card border border-border text-foreground font-semibold hover:bg-primary/10 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Approval on Their Behalf
                                </button>
                                <button
                                  onClick={() => setProxyRecheckDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-destructive/5 border border-destructive/40 text-destructive font-semibold hover:bg-destructive/10 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Recheck Request on Their Behalf
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${dated ? "bg-emerald-500/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(dated ? "done" : a?.DateApprovalStatus === CrmStatus.PENDING ? "warn" : custApproved ? "active" : "upcoming")}`}>
                          {dated ? <Check size={14} /> : <CalendarDays size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Agreement Date</span>
                            {dated ? (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-foreground bg-card border-border">
                                Confirmed: {String(a.AgreementDate).slice(0,10)}
                              </span>
                            ) : a?.ProposedDate ? (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-foreground bg-card border-border">
                                Proposed: {String(a.ProposedDate).slice(0,10)}
                              </span>
                            ) : (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-muted-foreground bg-muted/30 border-border">Not set</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Both sides negotiate a mutually acceptable signing date through the portal. A super-admin confirms the final agreed date.
                          </p>
                          {!dated && custApproved && !cancelled && (() => {
                            if (a?.DateApprovalStatus === CrmStatus.PENDING) return (
                              <p className="text-xs text-foreground bg-card border border-border px-2 py-1.5 flex items-center gap-1.5">
                                <Clock size={11} /> Date matched — awaiting super admin sign-off
                              </p>
                            );
                            if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) return (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={11} /> Awaiting customer's response on proposed date {String(a.ProposedDate).slice(0,10)}</p>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer not on portal?</p>
                                  <button
                                    onClick={() => setProxyDateDialog(true)}
                                    className="text-xs px-3 py-1.5 bg-card border border-border text-foreground font-semibold hover:bg-primary/10 flex items-center gap-1.5"
                                  >
                                    <UserCircle2 size={12} /> Accept Date on Their Behalf
                                  </button>
                                </div>
                              </div>
                            );
                            if (a?.ProposedDateStatus === "PendingCompanyReview") return (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <button onClick={handleAcceptDate} disabled={saving}
                                  className={`${GRID_KEY_BRAND} h-8 px-3`}>
                                  Accept {String(a.ProposedDate).slice(0,10)}
                                </button>
                                <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setProposeDateDialog(true); }}
                                  className="text-xs px-3 py-1.5 border border-border font-medium hover:bg-muted">
                                  Propose Different Date
                                </button>
                              </div>
                            );
                            return (
                              <div className="space-y-2">
                                <button onClick={() => { setSendDate(preferredAgrDate); setProposeDateDialog(true); }}
                                  className={`${KEY_INK} h-8 px-3`}>
                                  Propose Agreement Date
                                </button>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer communicated a date off-portal?</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <DateInput value={proxyProposedDate} onChange={(e) => setProxyProposedDate(e.target.value)}
                                      className="text-xs border border-border px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                                    <button onClick={() => proxyProposedDate && setProxyProposeDateDialog(true)}
                                      disabled={!proxyProposedDate}
                                      className="text-xs px-3 py-1.5 bg-card border border-border text-foreground font-semibold hover:bg-primary/10 disabled:opacity-40 flex items-center gap-1.5">
                                      <UserCircle2 size={12} /> Record Customer's Proposed Date
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {dateHistory.length > 0 && (
                            <div className="mt-1 space-y-1 border-t border-border/60 pt-2">
                              <p className="text-[0.6875rem] text-muted-foreground font-medium flex items-center gap-1"><FolderClock size={11} /> Negotiation history</p>
                              {(dateHistory as any[]).map((h) => (
                                <div key={h.Id} className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                                  <span className={`px-1.5 py-0.5 border font-medium ${h.ProposedBy === "Company" ? "text-foreground bg-card border-border" : "text-foreground bg-card border-border"}`}>
                                    {h.ProposedBy}
                                  </span>
                                  proposed {String(h.ProposedDate).slice(0,10)}
                                  <span className="text-[0.625rem]">· {String(h.CreatedAt).slice(0,10)}{h.CreatedByName ? ` by ${h.CreatedByName}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 flex items-start gap-3 ${executed ? "bg-emerald-500/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(a?.Status === CrmStatus.REGISTERED ? "done" : a?.Status === CrmStatus.EXECUTED ? "active" : dated ? "active" : "upcoming")}`}>
                          {a?.Status === CrmStatus.REGISTERED ? <Check size={14} /> : <BarChart3 size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Execution &amp; Registration</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              a?.Status === CrmStatus.REGISTERED ? "text-foreground bg-card border-border"
                              : a?.Status === CrmStatus.EXECUTED ? "text-foreground bg-card border-border"
                              : "text-muted-foreground bg-muted/30 border-border"
                            }`}>
                              {a?.Status === CrmStatus.REGISTERED ? "Registered" : a?.Status === CrmStatus.EXECUTED ? "Executed" : "Pending"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            All mandatory documents verified → signed &amp; executed → registered at the Sub-Registrar's office with a Doc No.
                          </p>
                          {a?.Status === CrmStatus.EXECUTED && (
                            <p className="text-xs text-foreground">Agreement executed. Record the Sub-Registrar Doc No. to mark it Registered.</p>
                          )}
                          {a?.Status === CrmStatus.REGISTERED && a?.AfsRegistrationNo && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Reg. No. {a.AfsRegistrationNo} · {a?.AfsRegistrationDate ? String(a.AfsRegistrationDate).slice(0,10) : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {agrTab === "Documents" && (() => {
                const agId = detail.agreement?.Id ?? selectedId!;
                const locked = isBookingCancelled(detail.agreement);
                const call = async (url: string, init: RequestInit) => {
                  const res = await fetchWithAuth(url, init);
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
                  return d;
                };
                const refresh = () => qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                return (
                  <DocumentCentre documents={detail.documents || []} onChanged={refresh}
                    hasFile={(d) => !!d.FilePath || !!d.HasFile}
                    fileUrl={(d) => `${API}/documents/file/${d.Id}`}
                    review={(d, verify, remarks) => call(`${API}/${agId}/documents/${d.Id}`, {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(verify ? { Status: "Verified" } : { Status: CrmStatus.REJECTED, Remarks: remarks }),
                    })}
                    attach={(d, f) => { const fd = new FormData(); fd.append("file", f); return call(`${API}/${agId}/documents/${d.Id}/attach`, { method: "POST", body: fd }); }}
                    upload={{
                      withLabel: false,
                      types: DOC_TYPES.map((t) => ({ value: t, label: t.replace(/([a-z])([A-Z])/g, "$1 $2") })),
                      run: (files, type) => { const fd = new FormData(); fd.append("DocumentType", type); files.forEach((f) => fd.append("files", f)); return call(`${API}/${agId}/documents/upload`, { method: "POST", body: fd }); },
                    }}
                    history={async (d) => { const r = await fetchWithAuth(`${API}/documents/${d.Id}/audit`); return r.ok ? auditToHistory(await r.json()) : []; }}
                    canAttach={{ ok: canWork && !locked, reason: locked ? "The booking is cancelled: papers are locked." : "Changing papers needs the edit right." }}
                    canReview={{ ok: canWork && !locked, reason: locked ? "The booking is cancelled: papers are locked." : "Reviewing papers needs the edit right." }}
                    nextStep={(d) => {
                      const awaiting = d.Status === "Requested" && !d.FilePath && !d.DocumentUrl;
                      if (awaiting && d.UploadedByType === "Customer") return `Waiting for the customer to upload it${d.RequestedAt ? ` (asked ${String(d.RequestedAt).slice(0, 10)})` : ""}.`;
                      if (awaiting) return "Waiting for the legal executive to attach it.";
                      return undefined;
                    }}
                    extraTag={(d) => d.UploadedByType === "Customer" ? <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border text-[0.6875rem] text-muted-foreground"><UserCircle2 size={10} /> Customer</span> : null}
                    rowActions={(d) => canWork && !locked && d.UploadedByType === "Customer" && d.Status === "Requested" && !d.FilePath
                      ? <ProxyUpload agreementId={agId} doc={d} onDone={refresh} /> : null}
                    headerActions={canWork && !locked ? <>
                      <button type="button" onClick={() => setDocRequestDialog(true)} className={GRID_BTN}><Send size={13} /> Request from customer</button>
                      <button type="button" onClick={() => setDocDialog(true)} className={GRID_BTN}><Upload size={13} /> Add with details</button>
                    </> : undefined}
                    emptyRequired={<p className="text-xs text-muted-foreground">No mandatory paper asked for yet. Request one from the customer, or add it with its details.</p>} />
                );
              })()}

              {agrTab === "Timeline" && (
                <AgreementTimeline
                  agreement={detail.agreement}
                  bookingId={detail.agreement.BookingId}
                  onJump={(t) => setAgrTab(t)}
                  canViewAfsPay={afsPayRights.canView}
                  canViewAfsReg={afsRegRights.canView}
                />
              )}

              {agrTab === "AFS Payment" && (
                afsPayRights.canView ? (
                  <CrmAfsQueryPayment
                    embeddedBookingId={detail.agreement.BookingId}
                    agreementStatus={detail.agreement.Status}
                    onChanged={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment-booking", detail.agreement.BookingId] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", detail.agreement.BookingId] });
                    }}
                  />
                ) : (
                  <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    You don't have access to the AFS Query Payment stage.
                  </div>
                )
              )}

              {agrTab === "AFS Registry" && (
                afsRegRights.canView ? (
                  <CrmAfsRegistry
                    embeddedBookingId={detail.agreement.BookingId}
                    onChanged={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", detail.agreement.BookingId] });
                    }}
                  />
                ) : (
                  <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    You don't have access to the AFS Registry stage.
                  </div>
                )
              )}
                </div>
              </section>

              <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
                <GridRelated icon={Clock} title="Activity">
                  <AgreementActivity agreement={detail.agreement} documents={detail.documents || []} dateHistory={dateHistory as any[]} revisions={revisions as any[]} />
                </GridRelated>
                <GridRelated icon={ArrowRight} title="Related">
                  <ul className="py-1">
                    {[
                      ["Booking", `/crm/bookings?view=${detail.agreement?.BookingId}`, detail.agreement?.BookingNo],
                      ["Payments", `/crm/payments?bookingId=${detail.agreement?.BookingId}`, "Milestones and receipts"],
                      ["NOC", `/crm/noc?bookingId=${detail.agreement?.BookingId}`, "After registration"],
                      ["Sale deed", `/crm/sales-deed?bookingId=${detail.agreement?.BookingId}`, "After the agreement"],
                      ["Legal milestones", `/crm/legal-milestones?bookingId=${detail.agreement?.BookingId}`, "The booking's legal path"],
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
                <GridRelated icon={ShieldAlert} title="Approval history">
                  <div className="px-4 py-4 text-xs">
                    <ApprovalTrailTimeline table="CrmAgreement" recordId={detail.agreement?.Id} refreshKey={detail.agreement?.UpdatedAt}
                      empty={<span className="text-muted-foreground">No approval steps recorded yet.</span>} />
                  </div>
                </GridRelated>
              </aside>
              </div>
            </div>
          )
        )}
      </CrmAppPage>

      {/* New Agreement Dialog */}
      <Dialog open={agrDialog} onOpenChange={(o) => { if (!o) setAgrDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">New Agreement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Booking *</label>
              <SearchableNativeSelect value={agrForm.BookingId} onChange={(e) => setAgrForm((f) => ({
                  ...f,
                  BookingId: e.target.value,
                  LegalName: "", PanNo: "", AadhaarNo: "", LegalAddress: "",
                }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </SearchableNativeSelect>
              {bookings.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No bookings are eligible yet — a booking needs to be Approved, have its welcome call marked
                  Welcomed, and have customer bank/PAN/Aadhaar details on file before an agreement can be created.
                </p>
              )}
              {bkgFilter && !(bookings as any[]).some((b) => String(b.Id) === String(bkgFilter)) && (
                <p className="text-xs text-foreground mt-1">
                  This dialog was opened for a specific booking, but that booking isn't eligible for an agreement yet
                  — pick from the list above, or complete its remaining prerequisites first.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
              <SearchableNativeSelect value={agrForm.LegalExecutiveId} onChange={(e) => setAgrForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                <option value="">— Unassigned —</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </SearchableNativeSelect>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "LegalName",    label: "Legal Name",      type: "text" },
                { key: "PanNo",        label: "PAN (Permanent Account Number)",          type: "text" },
                { key: "AadhaarNo",    label: "Aadhaar No",      type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
                  <AutoInput type={type} value={agrForm[key as keyof typeof agrForm]}
                    onChange={(e) => setAgrForm((f) => ({ ...f, [key]: key === "PanNo" ? e.target.value.toUpperCase() : e.target.value }))}
                    className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Legal Address</label>
              <textarea value={agrForm.LegalAddress} onChange={(e) => setAgrForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
              <textarea value={agrForm.Notes} onChange={(e) => setAgrForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAgrDialog(false)}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSaveAgreement} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Creating..." : "Create Agreement"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to Customer Portal Dialog */}
      <Dialog open={sendDialog} onOpenChange={(o) => { if (!o) { setSendDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Send to Customer Portal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The customer will be able to review this agreement and its documents from their portal, and either approve it or request a recheck.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Proposed Agreement Date (optional)</label>
              <DateInput value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">If the customer proposes the same date, it's confirmed automatically as the Agreement Date.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setSendDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleSendToCustomer(sendDate)} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Sending..." : "Send"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval"
          description="You are recording that the customer has reviewed and approved the agreement without logging into their portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={handleProxyCustomerApprove}
        />
      )}

      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request"
          description="You are recording that the customer has flagged an issue or requested changes to the agreement without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={handleProxyCustomerRecheck}
        />
      )}

      {proxyProposeDateDialog && (
        <ProxyActionDialog
          title="Record Customer's Proposed Date"
          description={`You are recording that the customer proposed ${proxyProposedDate} as the agreement signing date without using the portal.`}
          confirmLabel="Record Proposed Date"
          saving={proxySaving}
          onClose={() => setProxyProposeDateDialog(false)}
          onConfirm={handleProxyProposeDate}
        />
      )}

      {proxyDateDialog && (
        <ProxyActionDialog
          title="Accept Date on Customer's Behalf"
          description="You are recording that the customer has agreed to the proposed signing date without using their portal."
          confirmLabel="Confirm Date Acceptance"
          saving={proxySaving}
          onClose={() => setProxyDateDialog(false)}
          onConfirm={handleProxyDateAccept}
        />
      )}

      <Dialog open={proposeDateDialog} onOpenChange={(o) => { if (!o) { setProposeDateDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Propose Agreement Date</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This date goes to the customer for their review. They can accept it as-is, or propose a different one back to you.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Proposed Agreement Date</label>
              <DateInput value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
              {preferredAgrDate && sendDate === preferredAgrDate && (
                <p className="text-[0.6875rem] text-foreground mt-1 flex items-center gap-1">
                  <span>ⓘ</span> Pre-filled from welcome call discussion
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setProposeDateDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleProposeDate(sendDate)} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Saving..." : "Propose Date"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={regDialog} onOpenChange={(o) => { if (!o) { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Mark Agreement Registered</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-xs text-muted-foreground">
              Enter the details from the Sub-Registrar's office. The AFS registration is a separate legal event from the Sale Deed — it happens now, early in the process.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration No. <span className="text-destructive">*</span></label>
              <input
                type="text"
                placeholder="e.g. SRO/MH/2024/001234"
                value={regForm.AfsRegistrationNo}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationNo: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background"
              />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">Doc No. issued by Sub-Registrar at the time of AFS registration.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration Date <span className="text-destructive">*</span></label>
              <DateInput
                value={regForm.AfsRegistrationDate}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationDate: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background"
              />
            </div>
            <div className={`border ${regFeesLocked ? "border-border bg-muted/40" : "border-border"} p-3 space-y-2`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">Government Fees</p>
                  {regFeesLocked && (
                    <p className="text-[0.6875rem] text-foreground mt-0.5">Pre-filled from confirmed AFS Query Payment — verify against Sub-Registrar receipt</p>
                  )}
                </div>
                {regFeesLocked ? (
                  <button type="button" onClick={() => setRegFeesLocked(false)}
                    className="shrink-0 text-[0.6875rem] px-2 py-1 border border-border text-muted-foreground hover:bg-muted font-medium">
                    Edit amounts
                  </button>
                ) : (regForm.AfsStampDuty !== "" || regForm.AfsRegistrationFee !== "") ? (
                  <button type="button" onClick={() => setRegFeesLocked(true)}
                    className="shrink-0 text-[0.6875rem] px-2 py-1 border border-border text-foreground hover:bg-primary/10 font-medium">
                    Lock amounts
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[0.6875rem] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsStampDuty}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsStampDuty: e.target.value }))}
                    className={`w-full text-sm border px-2 py-1.5 font-heading tabular-nums ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
                <div>
                  <label className="text-[0.6875rem] text-muted-foreground block mb-1">Registration Fee (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsRegistrationFee}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationFee: e.target.value }))}
                    className={`w-full text-sm border px-2 py-1.5 font-heading tabular-nums ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground">Stamp duty paid at AFS registration is creditable against Sale Deed stamp duty — the Sale Deed fee calculation will use this figure.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleMarkRegistered} disabled={regSaving || !regForm.AfsRegistrationNo.trim() || !regForm.AfsRegistrationDate}
              className={`${KEY_INK} h-8 px-3`}>
              {regSaving ? "Saving..." : "Confirm Registration"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={docDialog} onOpenChange={(o) => { if (!o) { setDocDialog(false); setShowUrlField(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Document Type *</label>
              <select value={docForm.DocumentType} onChange={(e) => setDocForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Issued By</label>
              <input type="text" value={docForm.IssuedBy} onChange={(e) => setDocForm((f) => ({ ...f, IssuedBy: e.target.value }))}
                placeholder="e.g. Legal team, Bank, Registrar office"
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Remarks (optional)</label>
              <textarea value={docForm.Remarks} onChange={(e) => setDocForm((f) => ({ ...f, Remarks: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>

            <input type="file" multiple ref={docFileInputRef}
              onChange={(e) => handleUploadDocFiles(e.target.files)}
              className="hidden" />
            <button onClick={() => docFileInputRef.current?.click()} disabled={uploadingDocs}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40">
              <Upload size={14} /> {uploadingDocs ? "Uploading..." : "Upload File(s)"}
            </button>
            <p className="text-[0.6875rem] text-muted-foreground text-center">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>

            {showUrlField ? (
              <div className="flex items-center gap-2 pt-1">
                <input placeholder="https://..." value={docForm.DocumentUrl} onChange={(e) => setDocForm((f) => ({ ...f, DocumentUrl: e.target.value }))}
                  className="flex-1 text-sm border border-border px-2 py-1.5 bg-background" />
                <button onClick={handleAddDocument} disabled={saving}
                  className="text-xs px-3 py-1.5 border border-border hover:bg-muted shrink-0 disabled:opacity-40">
                  {saving ? "Adding..." : "Add Link"}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowUrlField(true)} className="text-xs text-primary hover:underline">
                ...or paste an external document URL instead
              </button>
            )}
          </div>
          <div className="flex justify-end pt-3 border-t border-border">
            <button onClick={() => { setDocDialog(false); setShowUrlField(false); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={docRequestDialog} onOpenChange={(o) => { if (!o) setDocRequestDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Request Document from Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Document Type *</label>
              <select value={docRequestForm.DocumentType} onChange={(e) => setDocRequestForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Label shown to customer (optional)</label>
              <input type="text" value={docRequestForm.Label} onChange={(e) => setDocRequestForm((f) => ({ ...f, Label: e.target.value }))}
                placeholder="e.g. Latest bank statement"
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={docRequestForm.IsMandatory}
                onChange={(e) => setDocRequestForm((f) => ({ ...f, IsMandatory: e.target.checked }))} />
              Required before the customer can approve the agreement
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDocRequestDialog(false)}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRequestDocument} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Requesting..." : "Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog} onOpenChange={(o) => { if (!o) { setEditDialog(false); setEditLocked(true); } }}>
        <DialogContent className="max-w-lg">
          {(() => {
            const alIssued = false;
            const alIssuedOn = null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
                    <span className="flex items-center gap-1.5">
                      {alIssued && <Lock size={14} className="text-foreground shrink-0" />}
                      {alIssued ? "Amend Agreement Details" : "Edit Agreement Details"}
                    </span>
                    {editLocked && (
                      <button onClick={() => setEditLocked(false)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border hover:bg-muted transition-colors shrink-0 ${
                          alIssued ? "border-border text-foreground bg-card hover:bg-primary/10" : "border-border"
                        }`}>
                        <Pencil size={12} /> {alIssued ? "Unlock for Amendment" : "Edit"}
                      </button>
                    )}
                  </DialogTitle>
                </DialogHeader>
                {editLocked ? (
                  alIssued ? (
                    <div className="flex items-start gap-2 text-xs text-foreground bg-card border border-border px-3 py-2 -mt-1">
                      <Lock size={12} className="shrink-0 mt-0.5" />
                      <span>
                        Allotment Letter issued{alIssuedOn ? ` on ${String(alIssuedOn).slice(0, 10)}` : ""} — legal details are formally committed.
                        Any change is a recorded amendment and requires a stated reason.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border px-3 py-1.5 -mt-1">
                      <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
                    </div>
                  )
                ) : alIssued ? (
                  <div className="flex items-start gap-2 text-xs text-foreground bg-card border border-border px-3 py-2 -mt-1">
                    <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>Amendment mode</strong> — the Allotment Letter has been issued. Any changes to legal details
                      (name, PAN, Aadhaar, address) will be version-stamped and require a reason.
                      This is recorded in the audit trail.
                    </span>
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
                    <SearchableNativeSelect value={editForm.LegalExecutiveId} disabled={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                      className={editInputCls}>
                      <option value="">— Unassigned —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </SearchableNativeSelect>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Legal Name</label>
                      <input type="text" value={editForm.LegalName} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalName: e.target.value }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">PAN (Permanent Account Number)</label>
                      <input type="text" value={editForm.PanNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, PanNo: e.target.value.toUpperCase() }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Aadhaar No.</label>
                      <input type="text" value={editForm.AadhaarNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, AadhaarNo: e.target.value }))}
                        className={editInputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Legal Address</label>
                    <textarea value={editForm.LegalAddress} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                      rows={2} className={`${editInputCls} resize-none`} />
                  </div>
                  {!editLocked && (
                    <div>
                      <label className={`text-xs block mb-1 ${alIssued ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {alIssued ? <>Amendment Reason <span className="text-destructive">*</span></> : "Reason for this revision"}
                      </label>
                      <input type="text" value={editForm.RevisionReason} onChange={(e) => setEditForm((f) => ({ ...f, RevisionReason: e.target.value }))}
                        placeholder={alIssued ? "Required — e.g. Customer requested name correction (affidavit attached)" : "e.g. Customer requested recheck — corrected spelling"}
                        className={`w-full text-sm border px-2 py-1.5 bg-background ${alIssued ? "border-primary/40 focus:border-primary" : "border-border"}`} />
                      {alIssued && <p className="text-[0.6875rem] text-foreground mt-1">Required when legal details change after Allotment Letter is issued. Saved permanently in version history.</p>}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  {editLocked ? (
                    <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
                  ) : (
                    <>
                      <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className={GRID_BTN}>Cancel</button>
                      <button onClick={handleSaveEdit} disabled={saving} className={GRID_BTN_BRAND}>
                        {saving ? "Saving..." : alIssued ? "Save Amendment" : "Save"}
                      </button>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmAgreement;
