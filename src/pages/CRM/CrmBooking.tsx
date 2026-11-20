// CRM Bookings: every booking with what it is waiting on next. Bookings mostly create themselves when an Application
// is approved; New Booking is the manual fallback. The booking itself opens in CrmBookingDetail (?view=<id>).
// The page is laid out like Payment Milestones: the dark band with the figures, then the grid (status tabs, search,
// company / project / block, saved views, columns, export).
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { round2, sumMoney } from "@/lib/crmPriceQuote";
import { CrmStatus, isBookingClosed } from "@/constants/crmStatuses";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, Download, FileSignature, IndianRupee, Landmark, Lock, MoreHorizontal, Phone, Plus, RefreshCw, Repeat, Trash2,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SentBackNote, useSentBack, useSentBackStates, SENT_BACK_STATE } from "@/components/crm/CrmListToolbar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApprovalActions } from "@/components/ApprovalActions";
import { VillaOffersPanel } from "@/components/crm/VillaOffersPanel";
import {
  CrmGrid, GridColumnChooser, GridSavedViews, GridSearch, GridStatusPill, GridTabs, GridToneMark, exportGrid, useGridPrefs,
  GRID_BTN, GRID_CARD, GRID_KEY, GRID_KEY_BRAND, GRID_PAGE_SIZES, type GridCol,
} from "@/components/crm/CrmDataTable";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames, coApplicantsOf, useCoApplicantNames } from "@/components/crm/ApplicantNames";
import { getStatusLabel } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { useCrmListState } from "@/hooks/useCrmListState";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { CrmBookingDetail } from "./CrmBookingDetail";
import {
  API, STATUSES, fetchBookings, fetchBookingsList, getNextStep,
  workflowStageLabel, type BookingList, type BookingListFilters,
} from "./bookings/config";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, Initials, MoneyBand, asName } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { NewBookingDialog } from "./bookings/NewBookingDialog";
import { ChangeUnitDialog } from "./bookings/ChangeUnitDialog";

const COLS_KEY = "crm-bookings-cols";
const VIEWS_KEY = "crm-bookings-views";
// The list's views: every status, plus the shared "sent back" / "resubmitted" states (CrmListToolbar).
const TAB_KEYS = ["All", ...STATUSES, "SentBack", "Resubmitted"] as const;
const tabLabel = (k: string) => (k === "All" ? "All bookings" : k === "SentBack" || k === "Resubmitted" ? SENT_BACK_STATE[k].label : getStatusLabel(k));

// What a booking is worth and how much of it is in: cleared to milestones, held on account, still outstanding.
function bookingMoney(b: any) {
  const storedGrand = Number(b.GrandTotal ?? 0);
  const grand = storedGrand > 0 ? storedGrand : sumMoney([b.TotalValue, b.UnitGstAmount, b.ParkingTotal, b.ExtraChargesTotal]);
  const cleared = Number(b.TotalCleared ?? 0);
  // ApprovedOnAccount (CrmOnAccountPayment) alone is "held, not yet applied": adding CrmMoneyReceipt double-counted it.
  const onAcc = Number(b.ApprovedOnAccount ?? 0);
  return { grand, cleared, onAcc, outstanding: Math.max(0, round2(grand - cleared - onAcc)) };
}

// Where a pending booking sits in its approval chain.
const stageNote = (b: any) => (b.Status !== CrmStatus.PENDING ? null
  : b.WorkflowStage && b.WorkflowStage !== "Review" ? `Waiting: ${workflowStageLabel[b.WorkflowStage] || "approval"}`
  : b.ReadyForApprovalAt ? "Ready for Marketing Head approval"
  : "In Data Review");

const CrmBooking: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  // The server creates a booking under the create right; it was offered under edit, so a user with one but not the
  // other either saw a button that was refused or never saw it.
  const canCreate = canDoAction("crm-bookings", "create");
  const canEdit = canDoAction("crm-bookings", "edit");
  const canRequestCancellation = canDoAction("crm-cancellations", "create");
  // Delete follows the page's Delete right (role rights, each user's own rights overriding), as the server does.
  const canDeleteBookings = canDoAction("crm-bookings", "delete");
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const appFilter = sp.get("applicationId") || "";
  const viewFilter = sp.get("view") || "";

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const [newOpen, setNewOpen] = useState(false);
  const [viewingBookingId, setViewingBookingId] = useState<number | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);
  const [unitChangeBooking, setUnitChangeBooking] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);

  // The URL carries the open booking (?view=<id>), so a refresh or a shared link reopens it.
  const openBooking = (id: number) => {
    setViewingBookingId(id);
    setSp((prev) => {
      prev.set("view", String(id));
      return prev;
    }, { replace: true });
  };

  const { query } = list;
  const listFilters: BookingListFilters = {
    search: query.search, status: query.status, companyId: query.companyId, projectId: query.projectId, blockId: query.blockId,
    sortKey: query.sortKey, sortDir: query.sortDir,
  };

  // ?applicationId= fetches "the booking(s) for this one application", not a page of the list.
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery<BookingList>({
    queryKey: ["crm-bookings", appFilter, listFilters, query.page, pageSize],
    queryFn: async () => {
      if (appFilter) { const rows = await fetchBookings(appFilter); return { rows, total: rows.length, statusCounts: {}, frozen: 0 }; }
      return fetchBookingsList(listFilters, query.page, pageSize);
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const bookings = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};

  // Deep links: ?view=<id> opens that booking — each time the URL names one, so a link on this page (the villa
  // offers' plot booking) opens it even after another booking was opened and closed; closing drops ?view=.
  // ?applicationId=X opens the booking made from that application, once (the one-shot guard).
  const [handledView, setHandledView] = useState("");
  useEffect(() => {
    if (viewFilter && viewFilter !== handledView) {
      const viewId = parseInt(viewFilter, 10);
      // 0 is a real booking Id (the identity was reseeded to 0 once, see migration 441).
      if (Number.isInteger(viewId) && viewId >= 0) setViewingBookingId(viewId);
      else navigate("/crm/bookings", { replace: true });
      setHandledView(viewFilter);
      return;
    }
    if (!viewFilter && handledView) setHandledView("");
    if (!appFilter || deepLinkOpened || isLoading) return;
    const row = (bookings as any[]).find((b: any) => String(b.ApplicationId) === appFilter);
    if (row) setViewingBookingId(row.Id);
    // No booking yet for that application: offer to make one, filled in from it.
    else if (canCreate) setNewOpen(true);
    setDeepLinkOpened(true);
  }, [appFilter, viewFilter, handledView, bookings, deepLinkOpened, isLoading, canCreate, navigate]);

  const canDeleteBooking = (b: any) =>
    canDeleteBookings
    // Until fully approved (the server has the final word, incl. money checks).
    && b.Status !== CrmStatus.APPROVED
    && b.WorkflowStage !== "Confirmed"
    && !b.AgreementId
    && Number(b.TotalCleared || 0) <= 0
    && Number(b.MRReceivedTotal || 0) <= 0
    && Number(b.ApprovedOnAccount || 0) <= 0;

  const handleDeleteBooking = async (b: any) => {
    if (!(await ask.confirm(`Delete booking ${b.BookingNo}? Allowed until the booking is fully approved; the application returns to the pre-booking list.`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetchWithAuth(`${API}/${b.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the booking.");
      toast.success(data.message || "Booking deleted");
      ["crm-bookings", "crm-apps", "unit-master", "unit-matrix"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (viewingBookingId === b.Id) setViewingBookingId(null);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // Each booking sent back / resubmitted — for the row's Correct / Recheck button.
  const sentBackByBooking = useSentBackStates("BookingId");
  // Co-applicants by booking, so joint buyers read "Abir Manna & Satyaki Chakrabarti" like the main applicant.
  const { data: coNames } = useCoApplicantNames();
  const sentBackRows: any[] | undefined = useSentBack().data?.rows;

  const COLS: GridCol<any>[] = [
    { id: "booking", label: "Booking", sortKey: "BookingNo", locked: true,
      csv: (b) => b.BookingNo,
      cell: (b) => (
        <div>
          <div className="text-xs font-semibold tabular-nums text-foreground">{b.BookingNo}</div>
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{b.BookingDate ? String(b.BookingDate).slice(0, 10) : "—"}</div>
        </div>
      ) },
    { id: "date", label: "Booking date", sortKey: "BookingDate", hiddenByDefault: true,
      csv: (b) => (b.BookingDate ? String(b.BookingDate).slice(0, 10) : ""),
      cell: (b) => <span className="text-xs tabular-nums">{b.BookingDate ? String(b.BookingDate).slice(0, 10) : "—"}</span> },
    { id: "customer", label: "Customer", sortKey: "Customer",
      csv: (b) => b.ApplicantName,
      cell: (b) => (
        <div className="flex items-center gap-2.5 min-w-0 md:w-[10.5rem] 2xl:w-[12.5rem] whitespace-normal">
          <Initials name={b.ApplicantName} />
          <div className="min-w-0">
            {/* Joint buyers wrap onto a second line instead of widening the table. */}
            <div className="font-semibold text-foreground line-clamp-2 break-words">
              <ApplicantNames className="capitalize" name={asName(b.ApplicantName)}
                coApplicants={coApplicantsOf(coNames, { bookingId: b.Id, applicationId: b.ApplicationId }, b.ApplicantName).map(asName)} />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">{b.Mobile}</div>
          </div>
        </div>
      ) },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (b) => b.Mobile,
      cell: (b) => <span className="text-xs tabular-nums">{b.Mobile || "—"}</span> },
    { id: "property", label: "Property",
      csv: (b) => [b.ProjectName, b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / "),
      cell: (b) => (
        <div className="min-w-0 md:max-w-[8.5rem] 2xl:max-w-[10rem]" title={[b.ProjectName, b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / ")}>
          <div className="truncate">{b.ProjectName || "—"}</div>
          <div className="text-xs text-muted-foreground truncate">
            {[[b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / "), b.AreaSqFt ? `${b.AreaSqFt} sq ft` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      ) },
    { id: "value", label: "Value / received", sortKey: "Value",
      csv: (b) => bookingMoney(b).grand,
      cell: (b) => {
        const { grand, cleared, onAcc, outstanding } = bookingMoney(b);
        const clearedPct = grand > 0 ? Math.min(100, Math.round((cleared / grand) * 100)) : 0;
        const onAccPct = grand > 0 ? Math.min(100 - clearedPct, Math.round((onAcc / grand) * 100)) : 0;
        return (
          <div className="space-y-1 md:min-w-[8.5rem] 2xl:min-w-[10rem]">
            <div className="font-semibold tabular-nums">{fmtShort(grand)}</div>
            {grand > 0 && (
              <>
                <div className="h-1.5 w-full flex rounded-full overflow-hidden bg-muted" title={`Cleared ${fmtShort(cleared)} · on account ${fmtShort(onAcc)} · outstanding ${fmtShort(outstanding)}`}>
                  <div className="h-full bg-emerald-500" style={{ width: `${clearedPct}%` }} />
                  <div className="h-full bg-amber-400" style={{ width: `${onAccPct}%` }} />
                </div>
                {/* One short figure each, so the column stays narrow. */}
                <div className="flex flex-wrap gap-x-2 text-[0.625rem] text-muted-foreground tabular-nums">
                  <span>{fmtShort(cleared)} cleared</span>
                  {onAcc > 0 && <span>{fmtShort(onAcc)} on account</span>}
                  {outstanding > 0 && <span className="text-foreground">{fmtShort(outstanding)} due</span>}
                </div>
              </>
            )}
            {Number(b.BookingAmount) > 0 && (
              <div className="text-[0.625rem] text-muted-foreground tabular-nums">Booking amount {fmtShort(b.BookingAmount)}</div>
            )}
          </div>
        );
      } },
    { id: "cleared", label: "Cleared", align: "right", hiddenByDefault: true, csv: (b) => bookingMoney(b).cleared,
      cell: (b) => <span className="tabular-nums">{fmtShort(bookingMoney(b).cleared)}</span> },
    { id: "onAccount", label: "On account", align: "right", hiddenByDefault: true, csv: (b) => bookingMoney(b).onAcc,
      cell: (b) => <span className="tabular-nums">{fmtShort(bookingMoney(b).onAcc)}</span> },
    { id: "outstanding", label: "Outstanding", align: "right", hiddenByDefault: true, csv: (b) => bookingMoney(b).outstanding,
      cell: (b) => <span className="tabular-nums">{fmtShort(bookingMoney(b).outstanding)}</span> },
    { id: "status", label: "Status", sortKey: "Status",
      csv: (b) => [getStatusLabel(b.Status), stageNote(b)].filter(Boolean).join(" · "),
      cell: (b) => (
        <div className="space-y-1">
          <GridStatusPill status={b.Status} />
          {stageNote(b) && <div className="md:w-[8rem] 2xl:w-[9rem] whitespace-normal text-[0.6875rem] text-muted-foreground leading-snug">{stageNote(b)}</div>}
          {b.IsFrozen && <div className="flex items-center gap-1 text-[0.625rem] font-medium text-destructive"><Lock size={10} /> Frozen</div>}
          {/* Sent back for correction / resubmitted for a recheck. */}
          <SentBackNote bookingId={b.Id} />
        </div>
      ) },
    { id: "next", label: "Next", locked: true,
      cell: (b) => {
        const step = getNextStep(b);
        // "Jump to" follows the same order as the next step: Welcome Call first, then Payments (the booking amount)
        // and Agreement. It required Bank Details for the Agreement, which is not a gate, so Agreement was hidden
        // while the next step pointed at it.
        const approved = b.Status === CrmStatus.APPROVED;
        const welcomed = approved && !!b.HasWelcomeCall;
        return (
          <div className="flex items-center gap-1.5 flex-wrap justify-end" onClick={(e) => e.stopPropagation()}>
            {/* submitOnly: Approve/Reject happen in the Approval Inbox only. */}
            <ApprovalActions status={b.Status} recordId={b.Id} endpoint={API} submitOnly onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-bookings"] })} />
            {/* The stage itself is shown in Status; only Data Review has a button here. */}
            {/* Sent back: correct it; resubmitted: recheck it — in place of the plain checklist button. */}
            {sentBackByBooking.get(b.Id) === "Reapprove" ? (
              <button onClick={() => openBooking(b.Id)} className={cn(GRID_KEY, "h-7 px-2")} title="Yours to approve again, or send back — on the booking">
                Re-approve <ChevronRight size={11} />
              </button>
            ) : sentBackByBooking.get(b.Id) ? (
              <button onClick={() => openBooking(b.Id)} className={cn(sentBackByBooking.get(b.Id) === "SentBack" ? GRID_KEY_BRAND : GRID_KEY, "h-7 px-2")}>
                {sentBackByBooking.get(b.Id) === "SentBack" ? "Correct" : "Recheck"} <ChevronRight size={11} />
              </button>
            ) : b.Status === CrmStatus.PENDING && (!b.WorkflowStage || b.WorkflowStage === "Review") && !b.ReadyForApprovalAt && (
              <button onClick={() => openBooking(b.Id)} className={cn(GRID_KEY, "h-7 px-2")}>Review checklist <ChevronRight size={11} /></button>
            )}
            {step ? (
              <button onClick={() => navigate(step.path)} className={cn(GRID_KEY_BRAND, "h-7 px-2")}>{step.label} <ChevronRight size={11} /></button>
            ) : approved ? (
              <GridToneMark text="All steps done" tone="done" />
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => openBooking(b.Id)}>Open booking</DropdownMenuItem>
                {approved && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[0.6875rem] font-medium text-muted-foreground">Jump to</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => navigate(`/crm/welcome-calls?bookingId=${b.Id}`)} className="gap-2"><Phone size={14} /> Welcome call</DropdownMenuItem>
                  </>
                )}
                {welcomed && (
                  <>
                    <DropdownMenuItem onClick={() => navigate(`/crm/payments?bookingId=${b.Id}`)} className="gap-2"><IndianRupee size={14} /> Payments</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/crm/agreements?bookingId=${b.Id}`)} className="gap-2"><FileSignature size={14} /> Agreement</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/crm/customer-bank-details?bookingId=${b.Id}`)} className="gap-2"><Landmark size={14} /> Bank details</DropdownMenuItem>
                  </>
                )}
                {!isBookingClosed(b.Status) && b.DeedStatus !== "Registered" && (canRequestCancellation || canEdit) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate(`/crm/cancellations?bookingId=${b.Id}`)} className="gap-2 text-destructive focus:text-destructive">
                      <AlertTriangle size={14} /> Request cancellation
                    </DropdownMenuItem>
                    {canEdit && !b.IsPlotSale && Number(b.ActiveUnitCount || 0) <= 1 && (
                      <DropdownMenuItem onClick={() => setUnitChangeBooking(b)} className="gap-2 text-destructive focus:text-destructive">
                        <Repeat size={14} /> Change unit
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {canDeleteBooking(b) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDeleteBooking(b)} className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 size={14} /> Delete booking
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
  ];
  const [prefs, setPrefs] = useGridPrefs(COLS_KEY, COLS);

  usePageRights("crm-bookings");

  const n = (s: string) => counts[s] || 0;
  const all = Object.values(counts).reduce((s, v) => s + v, 0);
  // Sent back / resubmitted bookings, by the server's own rule (booking approval or data review rows in that state).
  const sentBackCount = (state: string) => (sentBackRows ? new Set(sentBackRows
    .filter((r: any) => (r.Kind === "booking" || r.Kind === "review") && r.State === state && r.BookingId != null)
    .map((r: any) => r.BookingId)).size : null);
  const tabs = TAB_KEYS.map((k) => ({
    key: k as string, label: tabLabel(k),
    // The open tab shows what the server matched; the others their own figure.
    count: !listResult ? null : k === list.status ? total : k === "All" ? all : k === "SentBack" || k === "Resubmitted" ? sentBackCount(k) : n(k),
  }));
  // The bar: each status's share of the bookings under these filters, in the figures' colours.
  const shares = [
    { label: getStatusLabel("Pending"), n: n("Pending"), cls: BAND_DOT.finance },
    { label: getStatusLabel("Approved"), n: n("Approved"), cls: BAND_DOT.collected },
    { label: getStatusLabel("Transferred"), n: n("Transferred"), cls: "bg-white/40" },
    { label: getStatusLabel("UnitChanged"), n: n("UnitChanged"), cls: BAND_DOT.notDue },
    { label: `${getStatusLabel("Cancelled")} / ${getStatusLabel("Rejected")}`, n: n("Cancelled") + n("Rejected"), cls: BAND_DOT.overdue },
  ].filter((s) => s.n > 0);

  // Every row under the current filters and sort, a page of 200 at a time (the list's largest page).
  const handleExport = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const r = await fetchBookingsList(listFilters, p, 200);
        rows.push(...r.rows);
        if (rows.length >= r.total || !r.rows.length) break;
      }
      exportGrid(rows, COLS.filter((c) => c.locked || !prefs.hidden.includes(c.id)), "bookings");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Bookings"]} />
      {ask.node}
      {!appFilter && (
        <MoneyBand eyebrow="CRM · Buyers & Bookings" title="Bookings"
          sub="Approved applications become bookings, then move through Review, Marketing Head and Director approval, and on to the agreement and payments."
          actions={
            <>
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {canCreate && <button type="button" onClick={() => setNewOpen(true)} className={BAND_KEY_MAIN}><Plus size={13} /> New booking</button>}
            </>
          }
          lead={isLoading ? "…" : all.toLocaleString("en-IN")} leadNote="Bookings · under these filters"
          bar={
            <span className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-white/15" role="img"
              aria-label={shares.map((s) => `${s.label} ${s.n}`).join(", ") || "No bookings"}>
              {shares.map((s) => (
                <span key={s.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", s.cls)}
                  style={{ width: `${(s.n / Math.max(1, all)) * 100}%` }} title={`${s.label}: ${s.n}`} />
              ))}
            </span>
          }
          figures={[
            { label: "Waiting approval", dot: BAND_DOT.finance, value: String(n("Pending")), note: "Review, Marketing Head or Director" },
            { label: "Approved", dot: BAND_DOT.collected, value: String(n("Approved")), note: `${n("Transferred")} transferred by resale` },
            { label: getStatusLabel("UnitChanged"), dot: BAND_DOT.notDue, value: String(n("UnitChanged")), note: "" },
            { label: "Cancelled / rejected", dot: BAND_DOT.overdue, value: String(n("Cancelled") + n("Rejected")),
              note: listResult?.frozen ? `${listResult.frozen} frozen` : "None frozen" },
          ]} />
      )}

      <VillaOffersPanel />

      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        {appFilter ? (
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs border-b border-border">
            <span className="text-muted-foreground">Showing the booking made from one application.</span>
            <button onClick={() => navigate("/crm/bookings", { replace: true })} className={GRID_BTN}>All bookings</button>
          </div>
        ) : (
          <>
            <GridTabs label="Status" tabs={tabs} active={list.status} onChange={list.setStatus} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Search name, booking no, unit…" />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
              <div className="ml-auto flex items-center gap-2">
                <GridSavedViews storageKey={VIEWS_KEY}
                  current={{ status: list.status, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
                  onApply={(v) => {
                    setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                    list.apply(v);
                  }} />
                <GridColumnChooser cols={COLS} prefs={prefs} onChange={setPrefs} />
                <button type="button" onClick={handleExport} disabled={exporting || !total} className={GRID_BTN} title="Export to Excel">
                  <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
                </button>
              </div>
            </div>
          </>
        )}
        <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={bookings} rowKey={(b: any) => b.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(b: any) => openBooking(b.Id)} activeKey={viewingBookingId}
          empty={appFilter ? "No booking has been made from this application yet." : list.hasFilters ? "No bookings match these filters." : "No bookings yet. They are made when an application is approved, or with New booking."}
          page={list.page} pageSize={pageSize} total={total} onPage={list.setPage} onPageSize={(s) => { setPageSize(s); list.setPage(1); }} />
      </div>

      {newOpen && canCreate && (
        <NewBookingDialog
          applicationId={appFilter}
          onClose={() => { setNewOpen(false); if (appFilter) navigate("/crm/bookings", { replace: true }); }}
        />
      )}

      {/* Every close path of the booking card funnels through onClose; it also drops ?view= / ?applicationId= so the
          list isn't left filtered to one application. deepLinkOpened stays set: appFilter clears with the URL. */}
      {viewingBookingId != null && (
        <CrmBookingDetail
          bookingId={viewingBookingId}
          onClose={() => {
            setViewingBookingId(null);
            navigate("/crm/bookings", { replace: true });
          }}
        />
      )}

      {unitChangeBooking && <ChangeUnitDialog booking={unitChangeBooking} onClose={() => setUnitChangeBooking(null)} />}
    </div>
  );
};

export default CrmBooking;
