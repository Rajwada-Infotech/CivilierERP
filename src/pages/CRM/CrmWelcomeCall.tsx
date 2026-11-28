// CRM Welcome Calls: post-booking onboarding & verification work queues.
// Built in the CrmBooking / CrmApplication CrmGrid language to scale cleanly across high call volumes and large teams:
//   • Pending Calls  — approved bookings waiting to be welcomed (never called, follow-ups due/overdue, scheduled callbacks)
//   • Checklist Due  — welcomed bookings whose onboarding verification checklist isn't yet submitted & locked
//   • Recheck        — bookings with open checklist mismatch flags needing resolution
//   • Verified       — welcomed, verified & locked onboarding packs (with PDF ready & Agreement link)
//   • Call History   — paginated audit trail of every call attempt across callers, outcomes, and date ranges
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronRight, ClipboardCheck, Copy, Download, ExternalLink, FileCheck,
  MoreHorizontal, Pencil, Phone, RefreshCw, ShieldAlert, UserCheck,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SearchableSelect, type SearchableOption } from "@/components/SearchableSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CrmGrid, GridColumnChooser, GridDateFilter, GridSavedViews, GridSearch, GridStatusPill, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs,
  GRID_ANY_DATE, GRID_BTN, GRID_CARD, GRID_INPUT, GRID_KEY, GRID_KEY_BRAND, GRID_KEY_DANGER, GRID_MENU_GLASS, GRID_PAGE_SIZES,
  type GridCol, type GridDateRange, type GridSavedView,
} from "@/components/crm/CrmDataTable";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { useSticky, type CrmSort } from "@/hooks/useCrmListState";
import { useUrlParam } from "@/hooks/useUrlParam";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { Initials, asName, personName } from "./payments/parts";
import {
  OUTCOME_LABEL, OUTCOMES, VC_ITEM_SHORT_LABEL, WELCOME_VIEWS,
  TONE_EMERALD_TEXT, TONE_AMBER_TEXT, TONE_ROSE_PILL,
  fetchBoard, fetchBoardCounts, fetchBookingById, fetchCallsList, fetchHistoryCounts, fetchUsers, fmt, outcomeTone,
  type BoardRow, type BoardTab, type WelcomeView,
} from "./welcomeCalls/config";
import { WelcomeCallPdfDialog } from "./welcomeCalls/PreviewDialogs";
import { IntakeDialog } from "./welcomeCalls/IntakeDialog";

const VIEWS_STORAGE_KEY = "crm-welcome-calls-views-v2";
const EMPTY_CPB: CrmCompanyProjectBlockValue = { companyId: "", projectId: "", blockId: "" };

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayKey = (v: unknown) => (v ? String(v).slice(0, 10) : "");
const fmtDate = (v: unknown) => {
  if (!v) return "—";
  const dateOnly = String(v).slice(0, 10);
  const d = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateOnly : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace("T", " ");
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const fmtDuration = (secs: unknown) => {
  const n = Number(secs);
  if (!n || n <= 0) return "—";
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const daysOpen = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
};
const financingLabel = (ft: string | null | undefined) =>
  ft === "SelfFunded" ? "Self-funded" : ft === "LoanFinanced" ? "Home loan" : "Not set";

function defaultSortFor(view: WelcomeView): CrmSort {
  if (view === "queue") return { key: "Urgency", dir: "asc" };
  if (view === "checklist") return { key: "LastCallDate", dir: "desc" };
  if (view === "recheck") return { key: "OldestFlaggedAt", dir: "asc" };
  if (view === "verified") return { key: "SubmittedAt", dir: "desc" };
  return { key: "CallDate", dir: "desc" };
}

function copyMobile(mobile: string | null | undefined) {
  if (!mobile) return;
  navigator.clipboard?.writeText(mobile);
  toast.success("Mobile number copied");
}

function OutcomePill({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">—</span>;
  return <GridToneMark text={OUTCOME_LABEL[outcome] || outcome} tone={outcomeTone(outcome)} />;
}

// ── Focus tile definitions (CrmApplication pattern — concise operational slices) ──
type FocusTile = { key: string; label: string; hint: string; tone: string };

const QUEUE_FOCUS_TILES: FocusTile[] = [
  { key: "neverCalled", label: "Never called", hint: "Approved, 0 call attempts", tone: "bg-slate-400" },
  { key: "overdue", label: "Overdue follow-up", hint: "Scheduled date passed", tone: "bg-red-500" },
  { key: "dueToday", label: "Due today", hint: "Callback scheduled today", tone: "bg-amber-500" },
  { key: "unreachable3", label: "3+ missed calls", hint: "Consecutive non-reached", tone: "bg-rose-600" },
  { key: "scheduled", label: "Scheduled later", hint: "Future callback date set", tone: "bg-sky-500" },
];

const CHECKLIST_FOCUS_TILES: FocusTile[] = [
  { key: "incomplete", label: "Items remaining", hint: "Verification not all ticked", tone: "bg-amber-500" },
  { key: "readyToSubmit", label: "Ready to submit", hint: "All ticked, zero open flags", tone: "bg-emerald-500" },
  { key: "hasRecheck", label: "Has open recheck", hint: "Flag blocks final submit", tone: "bg-red-500" },
  { key: "missingFinancing", label: "Financing not set", hint: "Self-funded or home loan", tone: "bg-primary" },
  { key: "planDisputed", label: "Plan disputed", hint: "Customer objected to plan", tone: "bg-rose-600" },
];

const HISTORY_FOCUS_TILES: FocusTile[] = [
  { key: "welcomed", label: "Welcomed", hint: "Successful welcome calls", tone: "bg-emerald-500" },
  { key: "callback", label: "Callback asked", hint: "Follow-up requested", tone: "bg-amber-500" },
  { key: "notReached", label: "Not reached", hint: "Not reachable / Busy / VM / Off", tone: "bg-slate-400" },
  { key: "planDisputed", label: "Plan disputed", hint: "Payment plan objected", tone: "bg-red-500" },
  { key: "submitted", label: "Checklist locked", hint: "Verification PDF signed off", tone: "bg-primary" },
];

// ── Tab metadata ──────────────────────────────────────────────────────────────
const VIEW_TABS: { key: WelcomeView; label: string }[] = [
  { key: "queue", label: "Pending Calls" },
  { key: "checklist", label: "Checklist Due" },
  { key: "recheck", label: "Recheck" },
  { key: "verified", label: "Verified" },
  { key: "history", label: "Call History" },
];

// ── Reusable row building blocks ──────────────────────────────────────────────
function CustomerColCell({ name, bookingId, applicationId, mobile }: {
  name: string; bookingId: number; applicationId?: number | null; mobile?: string | null;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0 md:w-[11rem] 2xl:w-[13rem] whitespace-normal">
      <Initials name={name} />
      <div className="min-w-0">
        <div className="font-semibold text-foreground line-clamp-2 break-words capitalize">
          <ApplicantNames name={asName(name)} bookingId={bookingId} applicationId={applicationId} />
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{mobile || "No mobile on file"}</div>
      </div>
    </div>
  );
}

function BookingColCell({ bookingNo, date }: { bookingNo: string; date?: string | null }) {
  return (
    <div>
      <div className="text-xs font-semibold tabular-nums text-foreground">{bookingNo}</div>
      <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDate(date)}</div>
    </div>
  );
}

function PropertyColCell({ projectName, unitNo, blockName }: {
  projectName?: string | null; unitNo?: string | null; blockName?: string | null;
}) {
  const sub = [unitNo, blockName].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 md:max-w-[9.5rem] 2xl:max-w-[11.5rem]" title={[projectName, sub].filter(Boolean).join(" / ")}>
      <div className="truncate font-medium text-foreground">{projectName || "—"}</div>
      <div className="text-xs text-muted-foreground truncate">{sub || "—"}</div>
    </div>
  );
}

function ChecklistProgressCell({ r }: { r: BoardRow }) {
  const total = Math.max(1, Number(r.ChecklistTotal) || 12);
  const checked = Math.min(total, Number(r.CheckedCount) || 0);
  const pct = Math.round((checked / total) * 100);
  const barTone = r.OpenRecheckCount > 0
    ? "bg-rose-500"
    : r.IsLocked || checked >= total
    ? "bg-emerald-500"
    : "bg-amber-400";
  return (
    <div className="space-y-1 min-w-[7.5rem] max-w-[9.5rem]">
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        <span className="font-medium text-foreground">{checked} / {total}</span>
        <span className="text-[0.6875rem] text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden bg-muted" role="progressbar" aria-valuenow={checked} aria-valuemin={0} aria-valuemax={total}>
        <div className={cn("h-full", barTone)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[0.6875rem] truncate">
        {r.OpenRecheckCount > 0 ? (
          <span className="text-destructive font-medium">{r.OpenRecheckCount} flag{r.OpenRecheckCount === 1 ? "" : "s"} open</span>
        ) : r.IsLocked ? (
          <span className={TONE_EMERALD_TEXT}>Submitted &amp; locked</span>
        ) : checked >= total ? (
          <span className={cn(TONE_EMERALD_TEXT, "font-medium")}>Ready to submit</span>
        ) : (
          <span className="text-muted-foreground">{total - checked} item{total - checked === 1 ? "" : "s"} left</span>
        )}
      </div>
    </div>
  );
}

// ── Booking Column Builder (shared data model, tailored per tab) ──────────────
function buildBoardCols(
  tab: BoardTab,
  todayStr: string,
  opts: {
    canCreate: boolean;
    canEdit: boolean;
    canViewBookings: boolean;
    canViewAgreements: boolean;
    onOpen: (r: BoardRow) => void;
    onPdf: (r: BoardRow) => void;
    onNavigate: (path: string) => void;
  },
): GridCol<BoardRow>[] {
  const rowMenu = (r: BoardRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`More actions for ${r.BookingNo}`}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          title="More actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className={cn("w-56", GRID_MENU_GLASS)}>
        <DropdownMenuItem onClick={() => opts.onOpen(r)} className="gap-2">
          <Phone size={14} /> Open welcome call &amp; checklist
        </DropdownMenuItem>
        {r.IsLocked && (
          <DropdownMenuItem onClick={() => opts.onPdf(r)} className="gap-2">
            <FileCheck size={14} /> View checklist PDF
          </DropdownMenuItem>
        )}
        {r.Mobile && (
          <DropdownMenuItem onClick={() => copyMobile(r.Mobile)} className="gap-2">
            <Copy size={14} /> Copy mobile number
          </DropdownMenuItem>
        )}
        {(opts.canViewBookings || (opts.canViewAgreements && r.AgreementId)) && <DropdownMenuSeparator />}
        {opts.canViewBookings && (
          <DropdownMenuItem onClick={() => opts.onNavigate(`/crm/bookings?view=${r.BookingId}`)} className="gap-2">
            <ExternalLink size={14} /> Open booking ({r.BookingNo})
          </DropdownMenuItem>
        )}
        {opts.canViewAgreements && r.AgreementId && (
          <DropdownMenuItem onClick={() => opts.onNavigate(`/crm/agreements?id=${r.AgreementId}`)} className="gap-2">
            <ExternalLink size={14} /> Open agreement ({r.AgreementNo})
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const customer: GridCol<BoardRow> = {
    id: "customer", label: "Customer", sortKey: "ApplicantName", locked: true,
    csv: (r) => personName(r.ApplicantName),
    cell: (r) => <CustomerColCell name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} mobile={r.Mobile} />,
  };
  const booking: GridCol<BoardRow> = {
    id: "booking", label: "Booking", sortKey: "BookingNo",
    csv: (r) => r.BookingNo,
    cell: (r) => <BookingColCell bookingNo={r.BookingNo} date={r.BookingDate} />,
  };
  const property: GridCol<BoardRow> = {
    id: "property", label: "Property", sortKey: "ProjectName",
    csv: (r) => [r.ProjectName, r.UnitNo, r.BlockName].filter(Boolean).join(" / "),
    cell: (r) => <PropertyColCell projectName={r.ProjectName} unitNo={r.UnitNo} blockName={r.BlockName} />,
  };
  const lastCall: GridCol<BoardRow> = {
    id: "lastCall", label: "Last call", sortKey: "LastCallDate",
    hiddenByDefault: tab === "recheck" || tab === "verified",
    csv: (r) => (r.LastOutcome ? `${OUTCOME_LABEL[r.LastOutcome] || r.LastOutcome}${r.LastCallDate ? ` (${fmtDate(r.LastCallDate)})` : ""}` : "Never called"),
    cell: (r) => {
      if (!r.LastOutcome) {
        return (
          <div className="space-y-0.5">
            <GridToneMark text="Never called" tone="draft" />
            <div className="text-[0.6875rem] text-muted-foreground">0 attempts</div>
          </div>
        );
      }
      return (
        <div className="space-y-0.5">
          <OutcomePill outcome={r.LastOutcome} />
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">
            {r.AttemptCount} attempt{r.AttemptCount === 1 ? "" : "s"}
            {r.LastCallDate ? ` · ${fmtDate(r.LastCallDate)}` : ""}
          </div>
          {r.ConsecutiveNonReached >= 3 && (
            <div className="text-[0.6875rem] font-semibold text-destructive">
              {r.ConsecutiveNonReached}× unreachable
            </div>
          )}
        </div>
      );
    },
  };
  const followUp: GridCol<BoardRow> = {
    id: "followUp", label: "Follow-up due", sortKey: "NextCallDate",
    hiddenByDefault: tab !== "queue",
    csv: (r) => dayKey(r.NextCallDate),
    cell: (r) => {
      const d = dayKey(r.NextCallDate);
      if (!d) return <span className="text-xs text-muted-foreground">—</span>;
      const isOverdue = d < todayStr;
      const isToday = d === todayStr;
      return (
        <div>
          <div className={cn(
            "text-xs tabular-nums font-medium",
            isOverdue ? "text-destructive font-semibold" : isToday ? cn(TONE_AMBER_TEXT, "font-semibold") : "text-foreground",
          )}>
            {fmtDate(d)}
          </div>
          <div className={cn(
            "text-[0.6875rem]",
            isOverdue ? "text-destructive" : isToday ? TONE_AMBER_TEXT : "text-muted-foreground",
          )}>
            {isOverdue ? "Overdue" : isToday ? "Due today" : "Scheduled"}
          </div>
        </div>
      );
    },
  };
  const checklistCol: GridCol<BoardRow> = {
    id: "checklist", label: "Checklist", sortKey: "CheckedCount",
    hiddenByDefault: tab !== "checklist",
    csv: (r) => `${r.CheckedCount}/${r.ChecklistTotal}${r.OpenRecheckCount ? ` (${r.OpenRecheckCount} flagged)` : ""}`,
    cell: (r) => <ChecklistProgressCell r={r} />,
  };
  const onboardingCol: GridCol<BoardRow> = {
    id: "financing", label: "Financing & plan", sortKey: "FinancingType",
    hiddenByDefault: tab !== "checklist" && tab !== "verified",
    csv: (r) => [financingLabel(r.FinancingType), r.BankPrefNames, r.PaymentPlanConfirmed === false ? "Plan disputed" : r.PaymentPlanConfirmed === true ? "Plan confirmed" : ""].filter(Boolean).join(" · "),
    cell: (r) => (
      <div className="space-y-0.5 max-w-[12rem] whitespace-normal">
        <div className={cn("text-xs font-medium", r.FinancingType ? "text-foreground" : "text-muted-foreground")}>
          {financingLabel(r.FinancingType)}
          {r.BankPrefNames && <span className="font-normal text-muted-foreground"> · {r.BankPrefNames}</span>}
        </div>
        <div className="text-[0.6875rem]">
          {r.PaymentPlanConfirmed === false ? (
            <span className="text-destructive font-medium" title={r.PaymentPlanDisputeReason || undefined}>Plan disputed</span>
          ) : r.PaymentPlanConfirmed === true ? (
            <span className="text-muted-foreground">Plan confirmed</span>
          ) : (
            <span className="text-muted-foreground">Plan not recorded</span>
          )}
          {r.DocsTotal != null && r.DocsTotal > 0 && (
            <span className="text-muted-foreground"> · Docs {r.DocsVerified || 0}/{r.DocsTotal}</span>
          )}
        </div>
      </div>
    ),
  };
  const flaggedCol: GridCol<BoardRow> = {
    id: "flagged", label: "Open flags", sortKey: "OpenRecheckCount",
    hiddenByDefault: tab !== "recheck",
    csv: (r) => `${r.OpenRecheckCount} open${r.FlaggedReason ? ` — ${r.FlaggedReason}` : ""}`,
    cell: (r) => (
      <div className="space-y-1 max-w-[16rem] whitespace-normal">
        <GridToneMark text={`${r.OpenRecheckCount} open flag${r.OpenRecheckCount === 1 ? "" : "s"}`} tone="stopped" />
        {(r.FlaggedItemKey || r.FlaggedReason) && (
          <div className="text-xs text-muted-foreground line-clamp-1" title={r.FlaggedReason || undefined}>
            <span className="font-medium text-foreground">{(r.FlaggedItemKey && VC_ITEM_SHORT_LABEL[r.FlaggedItemKey]) || r.FlaggedItemKey}</span>
            {r.FlaggedReason ? ` — ${r.FlaggedReason}` : ""}
          </div>
        )}
      </div>
    ),
  };
  const flaggedSinceCol: GridCol<BoardRow> = {
    id: "flaggedSince", label: "Flagged since", sortKey: "OldestFlaggedAt",
    hiddenByDefault: tab !== "recheck",
    csv: (r) => dayKey(r.OldestFlaggedAt),
    cell: (r) => {
      const age = daysOpen(r.OldestFlaggedAt);
      return (
        <div>
          <div className="text-xs tabular-nums text-foreground">{fmtDate(r.OldestFlaggedAt)}</div>
          {age != null && (
            <div className={cn("text-[0.6875rem] tabular-nums", age >= 3 ? "text-destructive font-semibold" : "text-muted-foreground")}>
              {age === 0 ? "Today" : `${age}d open`}
            </div>
          )}
        </div>
      );
    },
  };
  const verifiedCol: GridCol<BoardRow> = {
    id: "verified", label: "Verified", sortKey: "SubmittedAt",
    hiddenByDefault: tab !== "verified",
    csv: (r) => dayKey(r.SubmittedAt),
    cell: (r) => (
      <div className="space-y-0.5">
        <GridToneMark text="Verified" tone="done" />
        <div className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {fmtDate(r.SubmittedAt)}{r.SubmittedByName ? ` · ${r.SubmittedByName}` : ""}
        </div>
      </div>
    ),
  };
  const agreementCol: GridCol<BoardRow> = {
    id: "agreement", label: "Agreement",
    hiddenByDefault: tab !== "verified",
    csv: (r) => (r.AgreementNo ? `${r.AgreementNo} (${r.AgreementStatus || ""})` : ""),
    cell: (r) => r.AgreementNo ? (
      <div className="space-y-0.5">
        <div className="text-xs font-semibold tabular-nums">{r.AgreementNo}</div>
        {r.AgreementStatus && <GridStatusPill status={r.AgreementStatus} />}
      </div>
    ) : <span className="text-xs text-muted-foreground">Not created</span>,
  };
  const ownerCol: GridCol<BoardRow> = {
    id: "owner", label: "Owner", sortKey: "AssignedToName",
    hiddenByDefault: tab === "verified",
    csv: (r) => r.AssignedToName || "Unassigned",
    cell: (r) => (
      <div className="space-y-0.5 min-w-0">
        {r.AssignedToName ? (
          <div className="inline-flex items-center gap-1.5 text-xs text-foreground">
            <Initials name={r.AssignedToName} small />
            <span className="truncate max-w-[8rem]">{r.AssignedToName}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
        {tab === "recheck" && r.RequestedByName && (
          <div className="text-[0.6875rem] text-muted-foreground truncate">Flagged by {r.RequestedByName}</div>
        )}
        {tab === "checklist" && r.LastCalledByName && (
          <div className="text-[0.6875rem] text-muted-foreground truncate">Call: {r.LastCalledByName}</div>
        )}
      </div>
    ),
  };

  // Export & Column-Chooser deep fields
  const extraHidden: GridCol<BoardRow>[] = [
    { id: "lastCaller", label: "Last caller", sortKey: "LastCalledByName", hiddenByDefault: true, csv: (r) => r.LastCalledByName || "", cell: (r) => <span className="text-xs">{r.LastCalledByName || "—"}</span> },
    { id: "attempts", label: "Attempts", align: "right", sortKey: "AttemptCount", hiddenByDefault: true, csv: (r) => r.AttemptCount ?? 0, cell: (r) => <span className="tabular-nums text-xs">{r.AttemptCount ?? 0}</span> },
    { id: "value", label: "Booking value", align: "right", sortKey: "GrandTotal", hiddenByDefault: true, csv: (r) => r.GrandTotal ?? r.TotalValue ?? "", cell: (r) => <span className="tabular-nums text-xs">{fmt(r.GrandTotal ?? r.TotalValue)}</span> },
    { id: "preferredAgr", label: "Discussed agr. date", hiddenByDefault: true, csv: (r) => dayKey(r.PreferredAgreementDate), cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.PreferredAgreementDate)}</span> },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (r) => r.Mobile || "", cell: (r) => <span className="tabular-nums text-xs">{r.Mobile || "—"}</span> },
    { id: "email", label: "Email", hiddenByDefault: true, csv: (r) => r.Email || "", cell: (r) => <span className="text-xs">{r.Email || "—"}</span> },
  ];

  const actions: GridCol<BoardRow> = {
    id: "next", label: "Action", locked: true,
    cell: (r) => (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {tab === "queue" && (
          <button type="button" onClick={() => opts.onOpen(r)} className={cn(GRID_KEY_BRAND, "h-7 px-2.5")}>
            <Phone size={11} /> {opts.canCreate ? "Call now" : "Open"}
          </button>
        )}
        {tab === "checklist" && (
          <button type="button" onClick={() => opts.onOpen(r)} className={cn(GRID_KEY_BRAND, "h-7 px-2.5")}>
            <ClipboardCheck size={11} /> {opts.canEdit ? "Verify" : "Open"}
          </button>
        )}
        {tab === "recheck" && (
          <button type="button" onClick={() => opts.onOpen(r)} className={cn(GRID_KEY_DANGER, "h-7 px-2.5")}>
            <ShieldAlert size={11} /> {opts.canEdit ? "Resolve" : "Open"}
          </button>
        )}
        {tab === "verified" && (
          <button type="button" onClick={() => opts.onPdf(r)} className={cn(GRID_KEY, "h-7 px-2.5")}>
            <FileCheck size={11} /> PDF
          </button>
        )}
        {rowMenu(r)}
      </div>
    ),
  };

  return [
    customer, booking, property,
    ...(tab === "queue" ? [lastCall, followUp, ownerCol, checklistCol, onboardingCol]
      : tab === "checklist" ? [checklistCol, onboardingCol, ownerCol, lastCall]
      : tab === "recheck" ? [flaggedCol, flaggedSinceCol, ownerCol, checklistCol, lastCall]
      : [onboardingCol, verifiedCol, agreementCol, ownerCol, lastCall]),
    ...extraHidden,
    actions,
  ];
}

// ── History Column Builder ────────────────────────────────────────────────────
function buildHistoryCols(opts: {
  canEdit: boolean;
  canViewBookings: boolean;
  onEdit: (c: any) => void;
  onPdf: (c: any) => void;
  onNavigate: (path: string) => void;
}): GridCol<any>[] {
  return [
    {
      id: "customer", label: "Customer", sortKey: "ApplicantName", locked: true,
      csv: (c) => personName(c.ApplicantName),
      cell: (c) => <CustomerColCell name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} mobile={c.Mobile} />,
    },
    {
      id: "booking", label: "Booking & property", sortKey: "BookingNo",
      csv: (c) => [c.BookingNo, c.ProjectName, c.UnitNo].filter(Boolean).join(" / "),
      cell: (c) => (
        <div className="min-w-0 md:max-w-[10.5rem]">
          <div className="text-xs font-semibold tabular-nums text-foreground">{c.BookingNo}</div>
          <div className="text-xs text-muted-foreground truncate">{[c.ProjectName, c.UnitNo].filter(Boolean).join(" · ") || "—"}</div>
        </div>
      ),
    },
    {
      id: "callDate", label: "Called on", sortKey: "CallDate",
      csv: (c) => fmtDateTime(c.CallDate || c.CreatedAt),
      cell: (c) => (
        <div>
          <div className="text-xs tabular-nums font-medium text-foreground">{fmtDateTime(c.CallDate || c.CreatedAt)}</div>
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDuration(c.DurationSeconds)}</div>
        </div>
      ),
    },
    {
      id: "outcome", label: "Outcome", sortKey: "Outcome",
      csv: (c) => OUTCOME_LABEL[c.Outcome] || c.Outcome || "",
      cell: (c) => (
        <div className="space-y-0.5">
          <OutcomePill outcome={c.Outcome} />
          {c.PaymentPlanConfirmed === false ? (
            <div className="text-[0.6875rem] font-medium text-destructive" title={c.PaymentPlanDisputeReason || undefined}>Plan disputed</div>
          ) : c.PaymentPlanConfirmed === true ? (
            <div className="text-[0.6875rem] text-muted-foreground">Plan confirmed</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "caller", label: "Called by", sortKey: "CalledByName",
      csv: (c) => c.CalledByName || "",
      cell: (c) => c.CalledByName ? (
        <div className="inline-flex items-center gap-1.5 text-xs text-foreground">
          <Initials name={c.CalledByName} small />
          <span className="truncate max-w-[8rem]">{c.CalledByName}</span>
        </div>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: "followUp", label: "Follow-up", sortKey: "NextCallDate",
      csv: (c) => dayKey(c.NextCallDate),
      cell: (c) => c.NextCallDate
        ? <span className="text-xs tabular-nums text-foreground">{fmtDate(c.NextCallDate)}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: "notes", label: "Notes",
      csv: (c) => c.Notes || "",
      cell: (c) => {
        let customCount = 0;
        try { customCount = c.CustomFields ? JSON.parse(c.CustomFields).length : 0; } catch { /* ignore */ }
        if (!c.Notes && !customCount) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="max-w-[14rem] whitespace-normal">
            {c.Notes && <div className="text-xs text-foreground line-clamp-1" title={c.Notes}>{c.Notes}</div>}
            {customCount > 0 && <div className="text-[0.6875rem] text-muted-foreground">+{customCount} custom field{customCount === 1 ? "" : "s"}</div>}
          </div>
        );
      },
    },
    { id: "duration", label: "Duration (s)", align: "right", sortKey: "DurationSeconds", hiddenByDefault: true, csv: (c) => c.DurationSeconds ?? "", cell: (c) => <span className="tabular-nums text-xs">{c.DurationSeconds ? `${c.DurationSeconds}s` : "—"}</span> },
    { id: "owner", label: "Booking owner", hiddenByDefault: true, csv: (c) => c.AssignedToName || "", cell: (c) => <span className="text-xs">{c.AssignedToName || "—"}</span> },
    { id: "agreementDate", label: "Discussed agr. date", hiddenByDefault: true, csv: (c) => dayKey(c.PreferredAgreementDate), cell: (c) => <span className="tabular-nums text-xs">{fmtDate(c.PreferredAgreementDate)}</span> },
    { id: "disputeReason", label: "Plan dispute reason", hiddenByDefault: true, csv: (c) => c.PaymentPlanDisputeReason || "", cell: (c) => <span className="text-xs">{c.PaymentPlanDisputeReason || "—"}</span> },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (c) => c.Mobile || "", cell: (c) => <span className="tabular-nums text-xs">{c.Mobile || "—"}</span> },
    {
      id: "next", label: "Action", locked: true,
      cell: (c) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {!!c.HasSubmittedChecklist && (
            <button type="button" onClick={() => opts.onPdf(c)} className={cn(GRID_KEY, "h-7 px-2")} title="View verified checklist PDF">
              <FileCheck size={11} /> PDF
            </button>
          )}
          <button type="button" onClick={() => opts.onEdit(c)} className={cn(GRID_KEY, "h-7 px-2.5")}>
            {opts.canEdit ? <><Pencil size={11} /> Edit</> : <>View <ChevronRight size={11} /></>}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More actions" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn("w-52", GRID_MENU_GLASS)}>
              <DropdownMenuItem onClick={() => opts.onEdit(c)} className="gap-2"><Pencil size={14} /> Open call log &amp; dossier</DropdownMenuItem>
              {c.Mobile && <DropdownMenuItem onClick={() => copyMobile(c.Mobile)} className="gap-2"><Copy size={14} /> Copy mobile</DropdownMenuItem>}
              {opts.canViewBookings && (
                <DropdownMenuItem onClick={() => opts.onNavigate(`/crm/bookings?view=${c.BookingId}`)} className="gap-2">
                  <ExternalLink size={14} /> Open booking
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}

// ── Mobile Cards (CrmBooking / CrmApplication standard) ───────────────────────
function BoardMobileCard({ r, tab, todayStr, onOpen, onPdf }: {
  r: BoardRow; tab: BoardTab; todayStr: string; onOpen: () => void; onPdf: () => void;
}) {
  const d = dayKey(r.NextCallDate);
  const overdue = !!d && d < todayStr;
  const dueToday = d === todayStr;
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="font-heading text-sm font-semibold text-primary hover:underline text-left">
            {r.BookingNo}
          </button>
          <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{fmtDate(r.BookingDate)}</p>
        </div>
        {tab === "recheck" ? (
          <GridToneMark text={`${r.OpenRecheckCount} flag${r.OpenRecheckCount === 1 ? "" : "s"}`} tone="stopped" />
        ) : tab === "verified" ? (
          <GridToneMark text="Verified" tone="done" />
        ) : r.LastOutcome ? (
          <OutcomePill outcome={r.LastOutcome} />
        ) : (
          <GridToneMark text="Never called" tone="draft" />
        )}
      </div>

      <div className="flex items-start gap-2.5">
        <Initials name={r.ApplicantName} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground break-words capitalize">
            <ApplicantNames name={asName(r.ApplicantName)} bookingId={r.BookingId} applicationId={r.ApplicationId} />
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{r.Mobile || "No mobile on file"}</p>
        </div>
      </div>

      <div className="text-xs space-y-0.5">
        <div className="font-medium text-foreground">{[r.ProjectName, r.UnitNo].filter(Boolean).join(" · ") || "—"}</div>
        {r.AssignedToName && <div className="text-muted-foreground">Owner: {r.AssignedToName}</div>}
        {tab === "recheck" && r.FlaggedReason && (
          <div className="text-destructive">{(r.FlaggedItemKey && VC_ITEM_SHORT_LABEL[r.FlaggedItemKey]) || r.FlaggedItemKey}: {r.FlaggedReason}</div>
        )}
      </div>

      <div className="pt-2.5 border-t border-border/70 flex items-center justify-between gap-3">
        <div className="text-xs tabular-nums">
          {tab === "checklist" || tab === "verified" ? (
            <span className="text-muted-foreground">Checklist {r.CheckedCount}/{r.ChecklistTotal} · {financingLabel(r.FinancingType)}</span>
          ) : d ? (
            <span className={cn(overdue ? "text-destructive font-semibold" : dueToday ? cn(TONE_AMBER_TEXT, "font-semibold") : "text-muted-foreground")}>
              Follow-up {fmtDate(d)}{overdue ? " · overdue" : dueToday ? " · today" : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">{r.AttemptCount} attempt{r.AttemptCount === 1 ? "" : "s"}</span>
          )}
        </div>
        {tab === "verified" ? (
          <button type="button" onClick={onPdf} className={cn(GRID_KEY, "h-7 px-3 shrink-0")}><FileCheck size={11} /> PDF</button>
        ) : (
          <button type="button" onClick={onOpen} className={cn(tab === "recheck" ? GRID_KEY_DANGER : GRID_KEY_BRAND, "h-7 px-3 shrink-0")}>
            {tab === "recheck" ? "Resolve" : tab === "checklist" ? "Verify" : "Call now"}
          </button>
        )}
      </div>
    </article>
  );
}

function HistoryMobileCard({ c, onEdit, onPdf }: { c: any; onEdit: () => void; onPdf: () => void }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground capitalize">
            <ApplicantNames name={asName(c.ApplicantName)} bookingId={c.BookingId} applicationId={c.ApplicationId} />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{c.BookingNo} · {[c.ProjectName, c.UnitNo].filter(Boolean).join(" · ")}</div>
        </div>
        <OutcomePill outcome={c.Outcome} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>{fmtDateTime(c.CallDate || c.CreatedAt)}</span>
        {c.DurationSeconds > 0 && <span>{fmtDuration(c.DurationSeconds)}</span>}
        {c.CalledByName && <span>by {c.CalledByName}</span>}
      </div>
      {c.Notes && <p className="text-xs text-muted-foreground line-clamp-2">{c.Notes}</p>}
      <div className="pt-2 border-t border-border/70 flex items-center justify-end gap-2">
        {!!c.HasSubmittedChecklist && (
          <button type="button" onClick={onPdf} className={cn(GRID_KEY, "h-7 px-2.5")}><FileCheck size={11} /> PDF</button>
        )}
        <button type="button" onClick={onEdit} className={cn(GRID_KEY, "h-7 px-2.5")}>Open</button>
      </div>
    </article>
  );
}

// ── Per-tab Grid Panel (isolates useGridPrefs storage key per tab cleanly) ────
function WelcomeBoardGridPanel({
  tab, rows, total, page, pageSize, sort, loading, fetching, error, activeBookingId, empty, todayStr,
  cols, onPrefsChange, prefs, onSort, onPage, onPageSize, onRetry, onRowClick, onPdf,
}: {
  tab: BoardTab;
  rows: BoardRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: CrmSort;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  activeBookingId: number | null;
  empty: string;
  todayStr: string;
  cols: GridCol<BoardRow>[];
  prefs: ReturnType<typeof useGridPrefs<BoardRow>>[0];
  onPrefsChange: ReturnType<typeof useGridPrefs<BoardRow>>[1];
  onSort: (k: string) => void;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  onRetry: () => void;
  onRowClick: (r: BoardRow) => void;
  onPdf: (r: BoardRow) => void;
}) {
  return (
    <CrmGrid
      cols={cols}
      prefs={prefs}
      onPrefs={onPrefsChange}
      rows={rows}
      rowKey={(r) => r.BookingId}
      noRowNumbers
      loading={loading}
      fetching={fetching}
      error={error}
      onRetry={onRetry}
      sort={sort}
      onSort={onSort}
      onRowClick={onRowClick}
      activeKey={activeBookingId}
      mobileCardRenderer={(r) => (
        <BoardMobileCard r={r} tab={tab} todayStr={todayStr} onOpen={() => onRowClick(r)} onPdf={() => onPdf(r)} />
      )}
      empty={empty}
      page={page}
      pageSize={pageSize}
      total={total}
      onPage={onPage}
      onPageSize={onPageSize}
    />
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const CrmWelcomeCall: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const { currentUser, canDoAction } = useAuth();
  const rights = usePageRights("crm-welcome-calls");
  const canViewBookings = canDoAction("crm-bookings", "view");
  const canViewAgreements = canDoAction("crm-agreements", "view");

  // ── View & paging state ──────────────────────────────────────────────────
  const [view, setViewRaw] = useUrlParam<WelcomeView>("view", "queue", WELCOME_VIEWS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [sort, setSort] = useState<CrmSort>(() => defaultSortFor(view));

  // ── Filters ──────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

  const [cpb, setCpbRaw] = useState<CrmCompanyProjectBlockValue>(EMPTY_CPB);
  const [assignedTo, setAssignedToRaw] = useState("");
  const [calledBy, setCalledByRaw] = useState("");
  const [outcomeFilter, setOutcomeFilterRaw] = useState("All");
  const [focus, setFocusRaw] = useState("");
  const [callDates, setCallDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const [exporting, setExporting] = useState(false);

  const setCpb = (v: CrmCompanyProjectBlockValue) => { setCpbRaw(v); setPage(1); };
  const setAssignedTo = (v: string) => { setAssignedToRaw(v); setPage(1); };
  const setCalledBy = (v: string) => { setCalledByRaw(v); setPage(1); };
  const setOutcomeFilter = (v: string) => { setOutcomeFilterRaw(v); setPage(1); };
  const setFocus = (v: string) => { setFocusRaw(v); setPage(1); };
  const setCallDates = (v: GridDateRange) => { setCallDatesRaw(v); setPage(1); };

  const changeView = (next: WelcomeView) => {
    if (next === view) return;
    setViewRaw(next);
    setFocusRaw("");
    setOutcomeFilterRaw("All");
    setSort(defaultSortFor(next));
    setPage(1);
  };

  // Sync default sort when URL loads a non-default tab directly
  useEffect(() => {
    setSort(defaultSortFor(view));
    setFocusRaw("");
    setPage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSort = (key: string) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  };

  // ── Team directory (for Owner / Caller filters across large orgs) ────────
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const myUserId = currentUser?.id ? String(currentUser.id) : "";

  const ownerOptions: SearchableOption[] = useMemo(() => [
    { value: "", label: "All owners" },
    ...(myUserId ? [{ value: myUserId, label: `My bookings (${currentUser?.name || "Me"})` }] : []),
    { value: "unassigned", label: "Unassigned bookings" },
    ...users.filter((u) => u.value !== myUserId),
  ], [users, myUserId, currentUser?.name]);

  const callerOptions: SearchableOption[] = useMemo(() => [
    { value: "", label: "All callers" },
    ...(myUserId ? [{ value: myUserId, label: `My calls (${currentUser?.name || "Me"})` }] : []),
    ...users.filter((u) => u.value !== myUserId),
  ], [users, myUserId, currentUser?.name]);

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  const [activeCall, setActiveCall] = useState<any | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ id: number; no: string } | null>(null);

  const openBooking = (row: any, call: any | null = null) => {
    setActiveBooking(row);
    setActiveCall(call);
    if (row?.BookingId != null) {
      setSp((prev) => { prev.set("bookingId", String(row.BookingId)); return prev; }, { replace: true });
    }
  };

  const closeDialogs = () => {
    setActiveBooking(null);
    setActiveCall(null);
    if (bkgFilter) {
      setSp((prev) => { prev.delete("bookingId"); return prev; }, { replace: true });
    }
    // Keep table & badge counts synced even if checklist/recheck/financing changed without logging a call
    qc.invalidateQueries({ queryKey: ["crm-welcome-queue"] });
    qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
  };

  // ── Queries ──────────────────────────────────────────────────────────────
  const isBoard = view !== "history";
  const boardTab: BoardTab = isBoard ? (view as BoardTab) : "queue";
  const resolvedDates = useMemo(() => resolveGridDateRange(callDates), [callDates]);

  const boardQ = useQuery({
    queryKey: ["crm-welcome-queue", "board", boardTab, cpb, search, assignedTo, outcomeFilter, focus, sort, page, pageSize],
    queryFn: () => fetchBoard({
      tab: boardTab,
      page,
      pageSize,
      search,
      cpb,
      assignedTo: assignedTo || undefined,
      outcome: view === "queue" && outcomeFilter !== "All" ? outcomeFilter : undefined,
      focus: focus || undefined,
      sortKey: sort.key,
      sortDir: sort.dir,
    }),
    enabled: isBoard,
    staleTime: 30_000,
  });

  const countsQ = useQuery({
    queryKey: ["crm-welcome-queue", "counts", cpb, search, assignedTo],
    queryFn: () => fetchBoardCounts({ cpb, search, assignedTo: assignedTo || undefined }),
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ["crm-welcome-calls-history", "list", cpb, search, assignedTo, calledBy, outcomeFilter, focus, resolvedDates, sort, page, pageSize],
    queryFn: () => fetchCallsList(cpb, search, page, {
      pageSize,
      sortKey: sort.key,
      sortDir: sort.dir,
      outcome: outcomeFilter !== "All" ? outcomeFilter : undefined,
      calledBy: calledBy || undefined,
      assignedTo: assignedTo || undefined,
      focus: focus || undefined,
      dateFrom: resolvedDates.from || undefined,
      dateTo: resolvedDates.to || undefined,
    }),
    enabled: view === "history",
    staleTime: 30_000,
  });

  const historyCountsQ = useQuery({
    queryKey: ["crm-welcome-calls-history", "counts", cpb, search, assignedTo, calledBy, outcomeFilter, resolvedDates],
    queryFn: () => fetchHistoryCounts({
      cpb,
      search,
      assignedTo: assignedTo || undefined,
      calledBy: calledBy || undefined,
      outcome: outcomeFilter !== "All" ? outcomeFilter : undefined,
      dateFrom: resolvedDates.from || undefined,
      dateTo: resolvedDates.to || undefined,
    }),
    enabled: view === "history",
    staleTime: 30_000,
  });

  const boardResult = useSticky(boardQ.data);
  const countsResult = useSticky(countsQ.data);
  const historyResult = useSticky(historyQ.data);
  const historyCountsResult = useSticky(historyCountsQ.data);

  const boardRows = useMemo(() => boardResult?.rows ?? [], [boardResult?.rows]);
  const historyRows = useMemo(() => historyResult?.rows ?? [], [historyResult?.rows]);
  const activeRows = isBoard ? boardRows : historyRows;
  const total = isBoard ? (boardResult?.total ?? 0) : (historyResult?.total ?? 0);

  // ── Deep link: ?bookingId=X opens IntakeDialog cleanly ───────────────────
  useEffect(() => {
    if (!bkgFilter || deepLinkOpened) return;
    setDeepLinkOpened(true);
    const id = parseInt(bkgFilter, 10);
    if (!Number.isInteger(id) || id <= 0) {
      setSp((prev) => { prev.delete("bookingId"); return prev; }, { replace: true });
      return;
    }
    const localHit = boardRows.find((r) => r.BookingId === id) || historyRows.find((c: any) => c.BookingId === id);
    if (localHit) { setActiveBooking(localHit); return; }
    fetchBookingById(id).then((b) => {
      if (b) setActiveBooking(b);
      else {
        toast.error("That booking could not be opened (not found, or not in your projects).");
        setSp((prev) => { prev.delete("bookingId"); return prev; }, { replace: true });
      }
    });
  }, [bkgFilter, deepLinkOpened, boardRows, historyRows, setSp]);

  // ── Columns + per-tab GridPrefs ──────────────────────────────────────────
  const todayStr = localDay();
  const commonBoardColOpts = useMemo(() => ({
    canCreate: rights.canCreate,
    canEdit: rights.canEdit,
    canViewBookings,
    canViewAgreements,
    onOpen: (r: BoardRow) => openBooking(r),
    onPdf: (r: BoardRow) => setViewingPdf({ id: r.BookingId, no: r.BookingNo }),
    onNavigate: (path: string) => navigate(path),
  }), [rights.canCreate, rights.canEdit, canViewBookings, canViewAgreements, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueCols = useMemo(() => buildBoardCols("queue", todayStr, commonBoardColOpts), [todayStr, commonBoardColOpts]);
  const checklistCols = useMemo(() => buildBoardCols("checklist", todayStr, commonBoardColOpts), [todayStr, commonBoardColOpts]);
  const recheckCols = useMemo(() => buildBoardCols("recheck", todayStr, commonBoardColOpts), [todayStr, commonBoardColOpts]);
  const verifiedCols = useMemo(() => buildBoardCols("verified", todayStr, commonBoardColOpts), [todayStr, commonBoardColOpts]);
  const historyCols = useMemo(() => buildHistoryCols({
    canEdit: rights.canEdit,
    canViewBookings,
    onEdit: (c) => openBooking(c, c),
    onPdf: (c) => setViewingPdf({ id: c.BookingId, no: c.BookingNo }),
    onNavigate: (path) => navigate(path),
  }), [rights.canEdit, canViewBookings, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [queuePrefs, setQueuePrefs] = useGridPrefs("crm-welcome-queue-cols-v1", queueCols);
  const [checklistPrefs, setChecklistPrefs] = useGridPrefs("crm-welcome-checklist-cols-v1", checklistCols);
  const [recheckPrefs, setRecheckPrefs] = useGridPrefs("crm-welcome-recheck-cols-v1", recheckCols);
  const [verifiedPrefs, setVerifiedPrefs] = useGridPrefs("crm-welcome-verified-cols-v1", verifiedCols);
  const [historyPrefs, setHistoryPrefs] = useGridPrefs("crm-welcome-history-cols-v1", historyCols);

  const activeBoardCols = boardTab === "queue" ? queueCols : boardTab === "checklist" ? checklistCols : boardTab === "recheck" ? recheckCols : verifiedCols;
  const activeBoardPrefs = boardTab === "queue" ? queuePrefs : boardTab === "checklist" ? checklistPrefs : boardTab === "recheck" ? recheckPrefs : verifiedPrefs;
  const setActiveBoardPrefs = boardTab === "queue" ? setQueuePrefs : boardTab === "checklist" ? setChecklistPrefs : boardTab === "recheck" ? setRecheckPrefs : setVerifiedPrefs;

  // ── Filter helpers ───────────────────────────────────────────────────────
  const hasFilters = !!(
    search || cpb.companyId || cpb.projectId || cpb.blockId || assignedTo || focus
    || (view === "queue" && outcomeFilter !== "All")
    || (view === "history" && (calledBy || outcomeFilter !== "All" || callDates.preset !== "any"))
  );

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setCpbRaw(EMPTY_CPB);
    setAssignedToRaw("");
    setCalledByRaw("");
    setOutcomeFilterRaw("All");
    setFocusRaw("");
    setCallDatesRaw(GRID_ANY_DATE);
    setPage(1);
  };

  const refreshAll = () => {
    countsQ.refetch();
    if (isBoard) boardQ.refetch();
    else {
      historyQ.refetch();
      historyCountsQ.refetch();
    }
  };

  // ── Server-paginated CSV Export of ALL matching rows ─────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const exported: any[] = [];
      for (let p = 1; ; p++) {
        const res = isBoard
          ? await fetchBoard({
              tab: boardTab,
              page: p,
              pageSize: 200,
              search,
              cpb,
              assignedTo: assignedTo || undefined,
              outcome: view === "queue" && outcomeFilter !== "All" ? outcomeFilter : undefined,
              focus: focus || undefined,
              sortKey: sort.key,
              sortDir: sort.dir,
            })
          : await fetchCallsList(cpb, search, p, {
              pageSize: 200,
              sortKey: sort.key,
              sortDir: sort.dir,
              outcome: outcomeFilter !== "All" ? outcomeFilter : undefined,
              calledBy: calledBy || undefined,
              assignedTo: assignedTo || undefined,
              focus: focus || undefined,
              dateFrom: resolvedDates.from || undefined,
              dateTo: resolvedDates.to || undefined,
            });
        exported.push(...res.rows);
        if (exported.length >= res.total || !res.rows.length) break;
      }
      exportGrid(exported, (isBoard ? activeBoardCols : historyCols) as GridCol<any>[], `welcome-calls-${view}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setExporting(false);
    }
  };

  // ── Focus strip selection for the active tab ─────────────────────────────
  const focusStrip = useMemo((): { tiles: FocusTile[]; counts: Record<string, number> | undefined } | null => {
    if (view === "queue") return { tiles: QUEUE_FOCUS_TILES, counts: countsResult?.focus.queue };
    if (view === "checklist") return { tiles: CHECKLIST_FOCUS_TILES, counts: countsResult?.focus.checklist };
    if (view === "history") return { tiles: HISTORY_FOCUS_TILES, counts: historyCountsResult as unknown as Record<string, number> | undefined };
    return null;
  }, [view, countsResult, historyCountsResult]);

  const activeLoading = isBoard ? boardQ.isLoading : historyQ.isLoading;
  const activeFetching = (isBoard ? boardQ.isFetching : historyQ.isFetching) || countsQ.isFetching;
  const activeError = isBoard ? boardQ.error : historyQ.error;
  const isError = isBoard ? boardQ.isError : historyQ.isError;

  const emptyMessage = useMemo(() => {
    if (hasFilters) return "No records match the current filters. Clear filters or adjust your search.";
    if (view === "queue") return "The call queue is clear — every approved booking has been welcomed.";
    if (view === "checklist") return "No welcomed bookings are waiting on verification submission.";
    if (view === "recheck") return "No open checklist recheck flags.";
    if (view === "verified") return "No verified & locked welcome call dossiers yet.";
    return "No welcome calls have been logged yet.";
  }, [hasFilters, view]);

  const savedViewCurrent: Omit<GridSavedView, "name"> = {
    status: view,
    search: searchInput.trim(),
    cpb,
    sort,
    pageSize,
    extra: { focus, assignedTo, calledBy, outcomeFilter, callDates },
  };

  const applySavedView = (v: GridSavedView) => {
    const targetView = WELCOME_VIEWS.includes(v.status as WelcomeView) ? (v.status as WelcomeView) : "queue";
    setViewRaw(targetView);
    setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
    setSearchInput(v.search || "");
    setSearch(v.search || "");
    setCpbRaw(v.cpb || EMPTY_CPB);
    setSort(v.sort || defaultSortFor(targetView));
    const ex = (v.extra || {}) as Record<string, any>;
    setFocusRaw(typeof ex.focus === "string" ? ex.focus : "");
    setAssignedToRaw(typeof ex.assignedTo === "string" ? ex.assignedTo : "");
    setCalledByRaw(typeof ex.calledBy === "string" ? ex.calledBy : "");
    setOutcomeFilterRaw(typeof ex.outcomeFilter === "string" ? ex.outcomeFilter : "All");
    setCallDatesRaw(ex.callDates?.preset ? ex.callDates : GRID_ANY_DATE);
    setPage(1);
  };

  const myQueueOn = view === "history" ? (!!myUserId && calledBy === myUserId) : (!!myUserId && assignedTo === myUserId);

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Welcome Calls"]} />

      {/* ── Page header (Booking / Application pattern) ── */}
      <section className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CivilierERP · CRM</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">Welcome Calls</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Welcome approved buyers, track follow-ups, complete onboarding verification checklists, and audit call history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            disabled={activeFetching}
            className={cn(GRID_BTN, "w-9 !px-0")}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={13} className={activeFetching ? "animate-spin" : ""} />
          </button>
          <span aria-live="polite" aria-atomic="true" className="ml-1 text-xs text-muted-foreground tabular-nums">
            {activeLoading && !activeRows.length
              ? "Loading…"
              : activeFetching
              ? "Updating results…"
              : `${total.toLocaleString("en-IN")} ${hasFilters ? (total === 1 ? "match" : "matches") : "in this view"}`}
          </span>
        </div>
      </section>

      {/* ── Main grid card ── */}
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        {/* Workflow lifecycle tabs */}
        <GridTabs<WelcomeView>
          label="Welcome call queues"
          panelId="welcome-calls-panel"
          active={view}
          onChange={changeView}
          tabs={VIEW_TABS.map((t) => ({
            key: t.key,
            label: t.label,
            count: countsResult ? countsResult.tabs[t.key] ?? 0 : null,
          }))}
        />

        <div id="welcome-calls-panel" role="tabpanel" aria-labelledby={`welcome-calls-panel-tab-${view}`} tabIndex={0}>
          {/* Purpose-specific workflow focus tiles (CrmApplication pattern) */}
          {focusStrip && (
            <div
              role="group"
              aria-label="Workflow breakdown"
              className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 px-3 py-3 border-b border-border bg-muted/30"
            >
              {focusStrip.tiles.map((t) => {
                const on = focus === t.key;
                const count = focusStrip.counts?.[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFocus(on ? "" : t.key)}
                    className={cn(
                      "text-left rounded-lg border px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      on
                        ? "border-primary bg-primary/[0.07] shadow-sm"
                        : "border-border bg-card hover:border-foreground/25",
                      count === 0 && !on && "opacity-60",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", t.tone)} />
                        {t.label}
                      </span>
                      <span className="text-lg font-semibold tabular-nums leading-none">
                        {count != null ? count.toLocaleString("en-IN") : "–"}
                      </span>
                    </span>
                    <span className="block mt-1 text-[0.6875rem] text-muted-foreground truncate">
                      {on ? "Showing these · tap to show all" : t.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Enterprise Toolbar */}
          <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
            <GridSearch
              value={searchInput}
              onChange={setSearchInput}
              placeholder={view === "history" ? "Search customer, mobile, booking, caller, notes…" : "Search customer, mobile, booking, unit…"}
            />

            {myUserId && (
              <button
                type="button"
                aria-pressed={myQueueOn}
                onClick={() => {
                  if (view === "history") setCalledBy(myQueueOn ? "" : myUserId);
                  else setAssignedTo(myQueueOn ? "" : myUserId);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors",
                  myQueueOn
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <UserCheck size={13} />
                {view === "history" ? "My calls" : "My bookings"}
              </button>
            )}

            {/* Searchable Owner / Caller filter (built for large multi-user teams) */}
            <div className="w-full sm:w-44">
              <SearchableSelect
                options={ownerOptions}
                value={assignedTo}
                onChange={setAssignedTo}
                placeholder="All owners"
                searchPlaceholder="Filter booking owner…"
                className="h-9 !py-0 px-2.5 !rounded-md text-xs !bg-card"
              />
            </div>

            {view === "history" && (
              <div className="w-full sm:w-44">
                <SearchableSelect
                  options={callerOptions}
                  value={calledBy}
                  onChange={setCalledBy}
                  placeholder="All callers"
                  searchPlaceholder="Filter caller…"
                  className="h-9 !py-0 px-2.5 !rounded-md text-xs !bg-card"
                />
              </div>
            )}

            {(view === "queue" || view === "history") && (
              <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
                <SelectTrigger className="w-auto min-w-[140px] h-9 rounded-md text-xs bg-card" aria-label="Call outcome">
                  <SelectValue placeholder="All outcomes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All outcomes</SelectItem>
                  {view === "queue" && <SelectItem value="__never__">Never called</SelectItem>}
                  {OUTCOMES.filter((o) => view === "history" || o !== "Welcomed").map((o) => (
                    <SelectItem key={o} value={o}>{OUTCOME_LABEL[o] || o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {view === "recheck" && (
              <div className="flex items-center gap-1.5">
                {([
                  { key: "aging", label: "Open 3+ days", count: countsResult?.focus.recheck.aging },
                  { key: "multi", label: "2+ open flags", count: countsResult?.focus.recheck.multi },
                ] as const).map((chip) => {
                  const on = focus === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFocus(on ? "" : chip.key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors",
                        on
                          ? TONE_ROSE_PILL
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {chip.label}
                      {chip.count != null && <span className="tabular-nums font-semibold">{chip.count.toLocaleString("en-IN")}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />

            {view === "history" && (
              <GridDateFilter label="Called" value={callDates} onChange={setCallDates} />
            )}

            {hasFilters && (
              <button type="button" onClick={clearFilters} className={GRID_BTN}>
                Clear filters
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <GridSavedViews storageKey={VIEWS_STORAGE_KEY} current={savedViewCurrent} onApply={applySavedView} />
              {isBoard ? (
                <GridColumnChooser cols={activeBoardCols} prefs={activeBoardPrefs} onChange={setActiveBoardPrefs} />
              ) : (
                <GridColumnChooser cols={historyCols} prefs={historyPrefs} onChange={setHistoryPrefs} />
              )}
              {rights.canExport && (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || !total}
                  className={GRID_BTN}
                  title="Export to Excel (CSV)"
                >
                  <Download size={13} />
                  <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Enterprise Paginated Grid (per-tab prefs key preserved via key) */}
          {isBoard ? (
            <WelcomeBoardGridPanel
              key={boardTab}
              tab={boardTab}
              rows={boardRows}
              total={total}
              page={page}
              pageSize={pageSize}
              sort={sort}
              loading={activeLoading}
              fetching={activeFetching}
              error={isError ? translateError((activeError as Error)?.message || "Could not load records.") : null}
              activeBookingId={activeBooking?.BookingId ?? null}
              empty={emptyMessage}
              todayStr={todayStr}
              cols={activeBoardCols}
              prefs={activeBoardPrefs}
              onPrefsChange={setActiveBoardPrefs}
              onSort={toggleSort}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
              onRetry={() => boardQ.refetch()}
              onRowClick={(r) => openBooking(r)}
              onPdf={(r) => setViewingPdf({ id: r.BookingId, no: r.BookingNo })}
            />
          ) : (
            <CrmGrid
              cols={historyCols}
              prefs={historyPrefs}
              onPrefs={setHistoryPrefs}
              rows={historyRows}
              rowKey={(c) => c.Id}
              noRowNumbers
              loading={historyQ.isLoading}
              fetching={historyQ.isFetching}
              error={historyQ.isError ? translateError((historyQ.error as Error)?.message || "Could not load call history.") : null}
              onRetry={() => historyQ.refetch()}
              sort={sort}
              onSort={toggleSort}
              onRowClick={(c) => openBooking(c, c)}
              activeKey={activeCall?.Id ?? null}
              mobileCardRenderer={(c) => (
                <HistoryMobileCard
                  c={c}
                  onEdit={() => openBooking(c, c)}
                  onPdf={() => setViewingPdf({ id: c.BookingId, no: c.BookingNo })}
                />
              )}
              empty={emptyMessage}
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          )}
        </div>
      </div>

      {/* ── Intake / Call / Verification Dialog ── */}
      {activeBooking && (
        <IntakeDialog
          key={activeCall ? `call-${activeCall.Id}` : `booking-${activeBooking.BookingId}`}
          booking={activeBooking}
          editingCall={activeCall}
          onCancelEdit={() => setActiveCall(null)}
          onClose={closeDialogs}
        />
      )}
      {viewingPdf && (
        <WelcomeCallPdfDialog
          bookingId={viewingPdf.id}
          bookingNo={viewingPdf.no}
          onClose={() => setViewingPdf(null)}
        />
      )}
    </div>
  );
};

export default CrmWelcomeCall;
