import { useCanApprove } from "@/hooks/useCanApprove";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowLeft, Ban, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ListChecks, Plus, Receipt, RefreshCw, Send, Wallet,
} from "lucide-react";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import {
  CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridDialog, GridGuidance, GridMiniTable, GridSavedViews, GridSearch,
  GridSegment, GridStatusPill, GridTabs, GridToneMark, exportGrid, resolveGridDateRange, useGridPrefs,
  GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky } from "@/hooks/useCrmListState";
import { Initials, TONE_AMBER_TEXT, TONE_EMERALD_TEXT, TONE_ROSE_TEXT, WaiverSection, asName, moneyWords } from "./payments/parts";
import { fmtShort, pct, pendingWaiverIds } from "./payments/config";
import {
  BILLING_MARK, CreditedNote, InvoiceBar, InvoiceMark, billingStateOf, downloadFinalStatement, downloadInvoicePdf, fetchBookingBilling, fetchInvoice, fetchInvoiceExport, fetchInvoiceRows,
  fetchLedger, fetchLedgerExport, fetchLedgerSummary, fmtDate, fmtMoney, generateFinalInvoice, generateMilestoneInvoices, invalidateInvoiceRelatedQueries, raiseDemand, typeLabel, type InvoiceRow, type LedgerRow,
} from "./invoices/config";
import { InvoicePreviewDialog, VoidInvoiceDialog } from "./invoices/InvoiceDialogs";
import { GenerateInvoiceDialog } from "./invoices/GenerateInvoiceDialog";

const { KEY_INK, KEY_LINE } = GRID_SHEET_KEYS;
const SMALL = "h-7 px-2.5";
const PREFS_BOOKINGS = "crm-invoices-booking-cols-v4";
const PREFS_INVOICES = "crm-invoices-invoice-cols-v2";
const VIEWS_KEY = "crm-invoices-views";
const dash = <span className="text-muted-foreground">—</span>;
const money = (n: number) => (Number(n) > 0 ? <span className="tabular-nums" title={fmtMoney(n)}>{fmtShort(n)}</span> : dash);

type DeskMode = "bookings" | "register";
type DeskTab = "everything" | "ready" | "final" | "uninvoiced" | "none" | "partial" | "full" | "closed" | "invoices" | "void";
type RecordTab = "schedule" | "invoices" | "credits";

const BOOKING_TABS: { key: DeskTab; label: string }[] = [
  { key: "everything", label: "All bookings" }, { key: "ready", label: "Due for invoicing" }, { key: "final", label: "Final invoice due" }, { key: "uninvoiced", label: "Advance received" },
  { key: "none", label: "Not invoiced" }, { key: "partial", label: "Partially invoiced" }, { key: "full", label: "Fully invoiced" }, { key: "closed", label: "Closed" },
];
const INVOICE_TABS: { key: DeskTab; label: string }[] = [{ key: "invoices", label: "Issued invoices" }, { key: "void", label: "Void invoices" }];
const isInvoiceTab = (t: DeskTab) => INVOICE_TABS.some((x) => x.key === t);

function ledgerCols(canCreate: boolean, onGenerate: (r: LedgerRow) => void, onFinal: (r: LedgerRow) => void, onStatement: (r: LedgerRow) => void): GridCol<LedgerRow>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (r) => r.ApplicantName, cell: (r) => (
      <span className="flex items-center gap-3 py-1.5 min-w-0">
        <Initials name={r.ApplicantName} />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo} · {r.UnitNo}{r.ProjectName ? ` · ${r.ProjectName}` : ""}{r.Closed ? <span className="text-destructive"> · {r.BookingStatus}</span> : null}</span>
        </span>
      </span>
    ) },
    { id: "tracker", label: "Billing progress", sortKey: "Invoiced", csv: (r) => r.PlanInvoiced, cell: (r) => (
      <span className="block min-w-[12rem] py-1.5" title={`Payment plan ${fmtMoney(r.PlanDue)} · Invoiced ${fmtMoney(r.PlanInvoiced)} · Due for invoicing ${fmtMoney(r.ReadyAmount)}`}>
        <InvoiceBar due={Number(r.PlanDue)} invoiced={Number(r.PlanInvoiced)} ready={Number(r.ReadyAmount)} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground"><span className="font-medium text-foreground">{fmtShort(r.PlanInvoiced)}</span> of {fmtShort(r.PlanDue)}</span>
          <span className="text-muted-foreground" title={r.HasFinal ? "Covered by the final invoice" : r.NonInvoice ? "This customer receives a single final invoice upon completion" : "Milestones invoiced"}>
            {r.NonInvoice && !r.HasFinal ? "Final invoice only" : `${r.MilestoneInvoiced} of ${r.MilestoneTotal} milestone${r.MilestoneTotal === 1 ? "" : "s"}`} · <span className="font-medium text-foreground">{pct(r.PlanInvoiced, r.PlanDue)}%</span>
          </span>
        </span>
      </span>
    ) },
    { id: "milestones", label: "Milestones", hiddenByDefault: true, csv: (r) => `${r.MilestoneInvoiced} of ${r.MilestoneTotal}`, cell: (r) => (r.MilestoneTotal
      ? <span className="tabular-nums">{r.MilestoneInvoiced} of {r.MilestoneTotal}{r.HasFinal ? <span className="block text-xs text-muted-foreground">Final invoice</span> : null}</span> : dash) },
    { id: "ready", label: "Due for invoicing", align: "right", sortKey: "ReadyAmount", csv: (r) => r.ReadyAmount, cell: (r) => (r.ReadyAmount > 0 ? (
      <span className="inline-flex flex-col items-end leading-tight" title={fmtMoney(r.ReadyAmount)}>
        <span className={cn("tabular-nums font-semibold", TONE_AMBER_TEXT)}>{fmtShort(r.ReadyAmount)}</span>
        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.FinalDue ? "Final invoice" : `${r.ReadyCount} milestone${r.ReadyCount === 1 ? "" : "s"}`}</span>
      </span>
    ) : dash) },
    { id: "received", label: "Advance received", align: "right", sortKey: "ReceivedNotInvoiced", csv: (r) => r.ReceivedNotInvoiced, cell: (r) => (r.ReceivedNotInvoiced > 0
      ? <span className={cn("tabular-nums font-semibold", TONE_ROSE_TEXT)} title={fmtMoney(r.ReceivedNotInvoiced)}>{fmtShort(r.ReceivedNotInvoiced)}</span> : dash) },
    { id: "credited", label: "Credit notes", align: "right", hiddenByDefault: true, sortKey: "Credited", csv: (r) => r.Credited, cell: (r) => money(r.Credited) },
    { id: "net", label: "Net invoiced", align: "right", sortKey: "NetInvoiced", csv: (r) => r.NetInvoiced, cell: (r) => (r.Invoiced > 0
      ? <span className="inline-flex flex-col items-end leading-tight" title={fmtMoney(r.NetInvoiced)}>
          <span className="tabular-nums font-medium">{fmtShort(r.NetInvoiced)}</span>
          <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.LiveCount} invoice{r.LiveCount === 1 ? "" : "s"}{r.VoidCount ? ` · ${r.VoidCount} void` : ""}</span>
        </span> : dash) },
    { id: "owner", label: "Owner", sortKey: "AssignedToName", csv: (r) => r.AssignedToName, cell: (r) => (r.AssignedToName
      ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Initials name={r.AssignedToName} small /><span className="truncate">{r.AssignedToName}</span></span> : dash) },
    // What can be generated on this booking: a Non-Invoice customer gets only the final invoice, once it falls due.
    { id: "act", label: "Actions", cell: (r: LedgerRow) => (r.StatementDue
      ? <button type="button" onClick={(e) => { e.stopPropagation(); onStatement(r); }} className={cn(KEY_LINE, SMALL)}><Download size={12} /> Final statement</button>
      : !canCreate || r.Closed || r.HasFinal ? null
      : r.FinalDue ? <button type="button" onClick={(e) => { e.stopPropagation(); onFinal(r); }} className={cn(KEY_INK, SMALL)}>Final invoice</button>
      : r.NonInvoice ? null
      : <button type="button" onClick={(e) => { e.stopPropagation(); onGenerate(r); }} className={cn(KEY_LINE, SMALL)}><Plus size={12} /> Invoice</button>) },
    // Under Columns, for whoever needs them; the export writes them all.
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", cell: (r) => <span className="tabular-nums">{r.BookingNo}</span>, csv: (r) => r.BookingNo },
    { id: "unit", label: "Unit", hiddenByDefault: true, cell: (r) => r.UnitNo, csv: (r) => r.UnitNo },
    { id: "project", label: "Project", hiddenByDefault: true, cell: (r) => r.ProjectName || "—", csv: (r) => r.ProjectName },
    { id: "plan", label: "Payment plan", align: "right", hiddenByDefault: true, sortKey: "PlanDue", cell: (r) => money(r.PlanDue), csv: (r) => r.PlanDue },
    { id: "notInvoiced", label: "Not invoiced", align: "right", hiddenByDefault: true, sortKey: "NotInvoiced", cell: (r) => money(r.NotInvoiced), csv: (r) => r.NotInvoiced },
    { id: "other", label: "Additional charges", align: "right", hiddenByDefault: true, cell: (r) => money(r.OtherInvoiced), csv: (r) => r.OtherInvoiced },
    { id: "last", label: "Last invoice", hiddenByDefault: true, sortKey: "LastInvoiceDate", cell: (r) => (r.LastInvoiceDate ? <span className="tabular-nums">{fmtDate(r.LastInvoiceDate)}</span> : dash), csv: (r) => r.LastInvoiceDate },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, cell: (r) => <span className="tabular-nums">{r.Mobile || "—"}</span>, csv: (r) => r.Mobile },
  ];
}

function invoiceCols(actions: (inv: InvoiceRow) => React.ReactNode): GridCol<InvoiceRow>[] {
  return [
    { id: "no", label: "Invoice", locked: true, sortKey: "InvoiceNo", csv: (i) => i.InvoiceNo, cell: (i) => <span className={cn("tabular-nums font-semibold text-foreground", i.Status === "Void" && "line-through text-muted-foreground")}>{i.InvoiceNo}</span> },
    { id: "date", label: "Date", sortKey: "InvoiceDate", csv: (i) => i.InvoiceDate, cell: (i) => <span className="tabular-nums">{fmtDate(i.InvoiceDate)}</span> },
    { id: "customer", label: "Customer", sortKey: "ApplicantName", csv: (i) => i.ApplicantName, cell: (i) => <span className="capitalize">{asName(i.ApplicantName)}</span> },
    { id: "booking", label: "Booking", sortKey: "BookingNo", csv: (i) => i.BookingNo, cell: (i) => <span className="tabular-nums text-muted-foreground">{i.BookingNo}</span> },
    { id: "unit", label: "Unit", hiddenByDefault: true, sortKey: "ProjectName", csv: (i) => i.UnitNo, cell: (i) => <span title={i.ProjectName || undefined}>{i.UnitNo}</span> },
    { id: "type", label: "Type", sortKey: "InvoiceType", csv: (i) => i.InvoiceType, cell: (i) => typeLabel(i.InvoiceType) },
    { id: "taxable", label: "Taxable value", align: "right", csv: (i) => i.TaxableValue, cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.TaxableValue)}</span> },
    { id: "gst", label: "GST", align: "right", csv: (i) => i.GstAmount, cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.GstAmount)}</span> },
    { id: "amount", label: "Amount", align: "right", sortKey: "Amount", csv: (i) => i.Amount, cell: (i) => <span className={cn("tabular-nums font-semibold", i.Status === "Void" && "line-through font-normal text-muted-foreground")}>{fmtMoney(i.Amount)}</span> },
    { id: "credit", label: "Credit note", csv: (i) => i.CreditedAmount, cell: (i) => (Number(i.CreditedAmount) > 0 ? <CreditedNote inv={i} /> : dash) },
    { id: "status", label: "Status", sortKey: "Status", csv: (i) => i.Status, cell: (i) => <span title={i.VoidReason || undefined}><InvoiceMark inv={i} /></span> },
    { id: "by", label: "Generated by", hiddenByDefault: true, sortKey: "CreatedByName", csv: (i) => i.CreatedByName, cell: (i) => <span className="text-muted-foreground">{i.CreatedByName || "—"}</span> },
    { id: "act", label: "Actions", locked: true, cell: actions },
    { id: "project", label: "Project", hiddenByDefault: true, csv: (i) => i.ProjectName, cell: (i) => i.ProjectName || "—" },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (i) => i.Mobile, cell: (i) => <span className="tabular-nums">{i.Mobile || "—"}</span> },
    { id: "reason", label: "Void reason", hiddenByDefault: true, csv: (i) => i.VoidReason, cell: (i) => i.VoidReason || "—" },
  ];
}

const CrmInvoices: React.FC = () => {
  const rights = usePageRights("crm-invoices");
  const qc = useQueryClient();
  // Who may void is set in Approval Setup (CRM Invoice Void); the server checks the same.
  const canVoid = useCanApprove("crm-invoice-void");
  const [searchParams, setSearchParams] = useSearchParams();

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: { key: "", dir: "desc" } });
  const [tab, setTabRaw] = useState<DeskTab>("everything");
  const [type, setTypeRaw] = useState("");
  const [dates, setDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const [invoiceSort, setInvoiceSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "CreatedAt", dir: "desc" });
  const [exporting, setExporting] = useState(false);
  const paymentRights = usePageRights("crm-payments");
  const [selected, setSelected] = useState<Map<string | number, LedgerRow>>(new Map());
  // Numbered invoices can't be taken back, only voided: each generation is confirmed first, with what it will do.
  const [confirm, setConfirm] = useState<{ title: string; text: string; total: number; run: () => Promise<void> } | null>(null);
  const [running, setRunning] = useState(false);
  const setTab = (t: DeskTab) => {
    if (isInvoiceTab(t)) lastInvoiceTabRef.current = t;
    else lastBookingTabRef.current = t;
    setTabRaw(t);
    setSelected(new Map());
    list.setPage(1);
  };
  const lastBookingTabRef = useRef<DeskTab>("everything");
  const lastInvoiceTabRef = useRef<DeskTab>("invoices");
  const switchDeskMode = (m: DeskMode) => {
    const next = m === "register" ? lastInvoiceTabRef.current : lastBookingTabRef.current;
    setTab(next);
  };
  const setType = (t: string) => { setTypeRaw(t); list.setPage(1); };
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };

  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed
  const [recordTab, setRecordTab] = useState<RecordTab>("schedule");
  const [raisingId, setRaisingId] = useState<number | null>(null);

  // The Booking page links here with ?bookingId=X to open the Generate dialog on that booking.
  useEffect(() => {
    const bid = searchParams.get("bookingId");
    if (bid) {
      const parsed = parseInt(bid, 10);
      const next = new URLSearchParams(searchParams);
      next.delete("bookingId");
      setSearchParams(next, { replace: true });
      if (parsed > 0 && rights.canCreate) setGenBookingId(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?invoiceId= stays in the URL while its preview is open, so it can be shared, and is looked up directly.
  const deepId = searchParams.get("invoiceId");
  const { data: deepInvoice, isError: deepError, error: deepErr } = useQuery({
    queryKey: ["crm-invoice", deepId],
    queryFn: () => fetchInvoice(deepId as string),
    enabled: !!deepId && preview?.Id !== Number(deepId),
    retry: false,
  });
  useEffect(() => { if (deepInvoice && preview?.Id !== deepInvoice.Id) setPreview(deepInvoice); }, [deepInvoice]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!deepError) return;
    toast.error((deepErr as Error)?.message || "Invoice not found");
    setSearchParams((sp) => { sp.delete("invoiceId"); return sp; }, { replace: true });
  }, [deepError]); // eslint-disable-line react-hooks/exhaustive-deps
  const openInvoice = (inv: InvoiceRow) => {
    setPreview(inv);
    setSearchParams((sp) => { sp.set("invoiceId", String(inv.Id)); return sp; }, { replace: true });
  };
  const closeInvoice = () => {
    setPreview(null);
    setSearchParams((sp) => { sp.delete("invoiceId"); return sp; }, { replace: true });
  };

  // The open booking lives in the address (?open=), so a refresh or a shared link lands on it.
  const openId = searchParams.get("open");
  const openBooking = (id: number) => {
    setRecordTab("schedule");
    setSearchParams((sp) => { sp.set("open", String(id)); return sp; });
  };
  const closeBooking = () => setSearchParams((sp) => { sp.delete("open"); return sp; });

  const range = resolveGridDateRange(dates);
  const scope = useMemo(() => {
    const p = new URLSearchParams();
    if (list.query.search) p.set("search", list.query.search);
    if (list.query.companyId) p.set("companyId", list.query.companyId);
    if (list.query.projectId) p.set("projectId", list.query.projectId);
    if (list.query.blockId) p.set("blockId", list.query.blockId);
    if (type) p.set("type", type);
    if (range.from) p.set("dateFrom", range.from);
    if (range.to) p.set("dateTo", range.to);
    return p;
  }, [list.query.search, list.query.companyId, list.query.projectId, list.query.blockId, type, range.from, range.to]);
  const onInvoices = isInvoiceTab(tab);
  const params = useMemo(() => {
    const p = new URLSearchParams(scope);
    p.set("page", String(list.page));
    p.set("pageSize", String(pageSize));
    if (onInvoices) {
      p.set("status", tab === "void" ? "void" : "live");
      p.set("sortKey", invoiceSort.key); p.set("sortDir", invoiceSort.dir);
    } else {
      p.set("focus", tab);
      if (list.sort.key) { p.set("sortKey", list.sort.key); p.set("sortDir", list.sort.dir); }
    }
    return p;
  }, [scope, list.page, pageSize, onInvoices, tab, invoiceSort, list.sort]);

  const { data: bookingData, isLoading: bookingsLoading, isFetching: bookingsFetching, error: bookingsError, refetch: refetchBookings } = useQuery({
    queryKey: ["crm-invoices", "ledger", params.toString()], queryFn: () => fetchLedger(params), enabled: !onInvoices && !openId, staleTime: 30_000,
  });
  const { data: invoiceData, isLoading: invoicesLoading, isFetching: invoicesFetching, error: invoicesError, refetch: refetchInvoices } = useQuery({
    queryKey: ["crm-invoices", "rows", params.toString()], queryFn: () => fetchInvoiceRows(params), enabled: onInvoices && !openId, staleTime: 30_000,
  });
  const { data: summaryData, isError: summaryError, isFetching: summaryFetching, refetch: refetchSummary } = useQuery({
    queryKey: ["crm-invoices", "summary", scope.toString()], queryFn: () => fetchLedgerSummary(scope), enabled: !openId, staleTime: 60_000,
  });
  const ledger = useSticky(bookingData);
  const invoiceList = useSticky(invoiceData);
  const figures = useSticky(summaryData);
  const bookingRows = ledger?.rows ?? [];

  const { data: billing, isLoading: billingLoading, isFetching: billingFetching, error: billingError, refetch: refetchBilling } = useQuery({
    queryKey: ["crm-invoices", "booking", openId], queryFn: () => fetchBookingBilling(openId as string), enabled: !!openId, staleTime: 15_000,
  });

  const afterGenerating = (bookingId?: number) => { setSelected(new Map()); invalidateInvoiceRelatedQueries(qc, bookingId); };
  const report = (done: number, skipped: { reason: string }[]) => {
    if (done) toast.success(`${done} invoice${done === 1 ? "" : "s"} generated`);
    if (skipped.length) toast.error(`${skipped.length} not generated: ${skipped.map((x) => x.reason).join("; ")}`);
  };
  const askFinal = (r: Pick<LedgerRow, "BookingId" | "BookingNo" | "ApplicantName" | "PlanDue">) => setConfirm({
    title: "Generate final invoice?", total: Number(r.PlanDue),
    text: `Issues the final tax invoice for ${r.ApplicantName} (${r.BookingNo}). It will receive the next sequence number and appear in the customer portal.`,
    run: async () => { const d = await generateFinalInvoice(r.BookingId); toast.success(d.message || "Final invoice generated"); afterGenerating(r.BookingId); },
  });
  const askMilestones = (bookingId: number, milestones: { Id: number; AmountDue: number; MilestoneName: string }[]) => setConfirm({
    title: `Generate ${milestones.length} invoice${milestones.length === 1 ? "" : "s"}?`, total: milestones.reduce((n, m) => n + Number(m.AmountDue), 0),
    text: `Milestones selected: ${milestones.map((m) => m.MilestoneName).join(", ")}. Each receives the next sequence number and appears in the customer portal.`,
    run: async () => { const d = await generateMilestoneInvoices(milestones.map((m) => ({ bookingId, milestoneId: m.Id }))); report(d.succeeded.length, d.skipped); afterGenerating(bookingId); },
  });
  const pickedRows = [...selected.values()].filter((r) => r.ReadyAmount > 0);
  const askBulk = () => {
    const finals = pickedRows.filter((r) => r.FinalDue);
    const items = pickedRows.filter((r) => !r.FinalDue).flatMap((r) => (r.ReadyMilestoneIds || []).map((milestoneId) => ({ bookingId: r.BookingId, milestoneId })));
    setConfirm({
      title: `Generate ${items.length + finals.length} invoice${items.length + finals.length === 1 ? "" : "s"}?`, total: pickedRows.reduce((n, r) => n + Number(r.ReadyAmount), 0),
      text: `Across ${pickedRows.length} booking${pickedRows.length === 1 ? "" : "s"}${finals.length ? ` (including ${finals.length} final invoice${finals.length === 1 ? "" : "s"})` : ""}. Each receives the next sequence number and appears in the customer portal.`,
      run: async () => {
        const skipped: { reason: string }[] = [];
        let done = 0;
        if (items.length) { const d = await generateMilestoneInvoices(items); done += d.succeeded.length; skipped.push(...d.skipped); }
        for (const r of finals) {
          try { await generateFinalInvoice(r.BookingId); done++; } catch (e: any) { skipped.push({ reason: `${r.BookingNo}: ${e.message}` }); }
        }
        report(done, skipped);
        afterGenerating();
      },
    });
  };
  const runConfirmed = async () => {
    if (!confirm) return;
    setRunning(true);
    try { await confirm.run(); setConfirm(null); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRunning(false); }
  };
  const askDemand = async (m: any) => {
    setRaisingId(m.Id);
    try { await raiseDemand(m.Id); toast.success(`Demand raised on ${m.MilestoneName}`); invalidateInvoiceRelatedQueries(qc, openId ? Number(openId) : m.BookingId); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRaisingId((cur) => (cur === m.Id ? null : cur)); }
  };
  const downloadStatement = (r: Pick<LedgerRow, "BookingId" | "BookingNo">) => downloadFinalStatement(r).catch((e) => toast.error(translateError(e.message)));
  const downloadPdf = (inv: InvoiceRow) => downloadInvoicePdf(inv).catch((e) => toast.error(translateError(e.message)));
  const rowActions = (inv: InvoiceRow) => (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={(e) => { e.stopPropagation(); openInvoice(inv); }} className={cn(KEY_LINE, SMALL)}><FileText size={12} /> View</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); downloadPdf(inv); }} className={cn(KEY_LINE, SMALL)} title="Download the PDF" aria-label={`Download ${inv.InvoiceNo}`}><Download size={12} /></button>
      {inv.Status !== "Void" && canVoid && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setVoidTarget(inv); }} className={cn(KEY_LINE, SMALL, "!text-destructive")}><Ban size={12} /> Void</button>
      )}
    </span>
  );
  const bookingCols = useMemo(() => ledgerCols(rights.canCreate, (r) => setGenBookingId(r.BookingId), askFinal, downloadStatement), [rights.canCreate]); // eslint-disable-line react-hooks/exhaustive-deps
  const allInvoiceCols = useMemo(() => invoiceCols(rowActions), [canVoid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bookingPrefs, setBookingPrefs] = useGridPrefs(PREFS_BOOKINGS, bookingCols);
  const [invoicePrefs, setInvoicePrefs] = useGridPrefs(PREFS_INVOICES, allInvoiceCols);

  const refreshDesk = () => { (onInvoices ? refetchInvoices : refetchBookings)(); refetchSummary(); };
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params);
      p.delete("page"); p.delete("pageSize");
      if (onInvoices) exportGrid(await fetchInvoiceExport(p), allInvoiceCols, `invoices-${tab}`);
      else exportGrid(await fetchLedgerExport(p), bookingCols, `invoicing-${tab}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const hasFilters = list.hasFilters || !!type || dates.preset !== GRID_ANY_DATE.preset;
  const clearFilters = () => { list.reset(); setTypeRaw(""); setDatesRaw(GRID_ANY_DATE); };
  const awaitingDemand = figures ? Math.max(0, Math.round((figures.notInvoiced - figures.ready) * 100) / 100) : 0;
  const invoicedPct = figures ? pct(figures.planInvoiced, figures.planDue) : 0;
  const bookingTabs = BOOKING_TABS.map((t) => ({ ...t, count: figures ? (figures.counts as Record<string, number>)[t.key] ?? 0 : null }));
  const registerTabs = [
    { ...INVOICE_TABS[0], count: figures ? figures.invoices.liveCount : null },
    { ...INVOICE_TABS[1], count: figures ? figures.invoices.voidCount : null },
  ];

  const desk = (
    <div hidden={!!openId} className="space-y-4">
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4 border-b border-border">
          <div className="flex items-start gap-3.5 min-w-0 flex-1 basis-72">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.6875rem] uppercase tracking-wider font-semibold text-muted-foreground">CRM · Finance</p>
                {figures && (
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold border border-emerald-500/30 bg-emerald-500/10 tabular-nums", TONE_EMERALD_TEXT)}>
                    {invoicedPct}% of plan invoiced
                  </span>
                )}
                {figures && figures.ready > 0 && (
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold border border-amber-500/30 bg-amber-500/10 tabular-nums", TONE_AMBER_TEXT)}>
                    {fmtShort(figures.ready)} ready to invoice
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Invoices</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage milestone and final invoices against payment plans, demand readiness, and advances received.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SentBackPanel chip />
            <Link to="/crm/demands" className={GRID_BTN}><Send size={13} /> Demands Desk</Link>
            {rights.canCreate && (
              <button type="button" onClick={() => setGenBookingId(null)} className={GRID_BTN_BRAND}>
                <Plus size={13} /> Generate invoice
              </button>
            )}
            <button type="button" onClick={refreshDesk} disabled={onInvoices ? invoicesFetching : (bookingsFetching || summaryFetching)} className={GRID_BTN} title="Refresh totals and list" aria-label="Refresh">
              <RefreshCw size={13} className={(onInvoices ? invoicesFetching : (bookingsFetching || summaryFetching)) ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border bg-muted/15">
          <button type="button" onClick={() => setTab("everything")}
            title={figures ? `Payment plan invoiced: ${fmtMoney(figures.planInvoiced)} of ${fmtMoney(figures.planDue)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", (tab === "everything" || tab === "partial" || tab === "full") && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Total invoiced</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures ? TONE_EMERALD_TEXT : "text-muted-foreground")}>
              {figures ? fmtShort(figures.planInvoiced) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures ? `of ${fmtShort(figures.planDue)} scheduled (${invoicedPct}%)` : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab(figures && figures.ready === 0 && figures.counts.final > 0 ? "final" : "ready")}
            title={figures ? `Due for invoicing: ${fmtMoney(figures.ready)} · Awaiting demand: ${fmtMoney(awaitingDemand)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", (tab === "ready" || tab === "final") && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Due for invoicing</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures && figures.ready > 0 ? TONE_AMBER_TEXT : "text-foreground")}>
              {figures ? fmtShort(figures.ready) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures
                ? figures.readyCount > 0 || figures.counts.final > 0
                  ? `${figures.readyCount} milestone${figures.readyCount === 1 ? "" : "s"}${figures.counts.final > 0 ? `, ${figures.counts.final} final invoice${figures.counts.final === 1 ? "" : "s"}` : ""} · ${fmtShort(awaitingDemand)} awaiting demand`
                  : `None due · ${fmtShort(awaitingDemand)} awaiting demand`
                : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab("uninvoiced")}
            title={figures ? `Approved receipts not yet covered by an invoice: ${fmtMoney(figures.receivedNotInvoiced)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", tab === "uninvoiced" && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Advance received</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures && figures.receivedNotInvoiced > 0 ? TONE_ROSE_TEXT : "text-foreground")}>
              {figures ? fmtShort(figures.receivedNotInvoiced) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures
                ? figures.counts.uninvoiced > 0
                  ? `Not yet invoiced across ${figures.counts.uninvoiced} booking${figures.counts.uninvoiced === 1 ? "" : "s"}`
                  : "No uninvoiced advances"
                : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab("invoices")}
            title={figures ? `Net invoiced ${fmtMoney(figures.netInvoiced)} · Credit notes ${fmtMoney(figures.credited)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", onInvoices && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Net invoiced</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {figures ? fmtShort(figures.netInvoiced) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures
                ? `${fmtShort(figures.credited)} in credit notes · ${figures.invoices.liveCount} issued${figures.invoices.voidCount > 0 ? ` · ${figures.invoices.voidCount} void` : ""}`
                : "Totals unavailable"}
            </p>
          </button>
        </div>

        <div className="px-5 py-3 space-y-2.5">
          {figures ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 [[data-theme]_&]:bg-emerald-500" /> Invoiced ({fmtShort(figures.planInvoiced)})</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400 [[data-theme]_&]:bg-amber-500" /> Due for invoicing ({fmtShort(figures.ready)})</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted [[data-theme]_&]:bg-slate-300" /> Awaiting demand ({fmtShort(awaitingDemand)})</span>
                </div>
                <span className="tabular-nums font-medium text-foreground">
                  {fmtShort(figures.planDue)} payment plan <span className="text-muted-foreground font-normal">· {fmtShort(figures.notInvoiced)} remaining to invoice</span>
                </span>
              </div>
              <InvoiceBar size="md" due={figures.planDue} invoiced={figures.planInvoiced} ready={figures.ready}
                title={`Payment plan ${fmtMoney(figures.planDue)} · Invoiced ${fmtMoney(figures.planInvoiced)} · Ready ${fmtMoney(figures.ready)}`} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{summaryFetching ? "Loading invoicing breakdown…" : "Invoicing breakdown unavailable"}</p>
          )}
        </div>

        {figures && (figures.otherInvoiced > 0 || figures.invoices.voidCount > 0) && (
          <div className="px-5 py-2.5 border-t border-border bg-muted/10 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {[
                figures.otherInvoiced > 0 ? `${fmtMoney(figures.otherInvoiced)} invoiced outside the payment plan (transfer fees, maintenance, or other charges).` : null,
                figures.invoices.voidCount > 0 ? `${figures.invoices.voidCount} void invoice${figures.invoices.voidCount === 1 ? "" : "s"} retained in the audit register.` : null,
              ].filter(Boolean).join(" ")}
            </span>
            {figures.invoices.voidCount > 0 && tab !== "void" && (
              <button type="button" onClick={() => setTab("void")} className="text-primary font-medium hover:underline shrink-0">
                View void invoices
              </button>
            )}
          </div>
        )}
      </div>

      {summaryError && (
        <GridGuidance
          tone="waiting"
          title={figures ? "Could not refresh invoice totals — showing last loaded figures." : "Invoice totals are unavailable."}
          text="Use Refresh to retry loading live summary figures."
        />
      )}

      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20">
          <GridSegment<DeskMode>
            label="Workspace mode"
            value={onInvoices ? "register" : "bookings"}
            onChange={switchDeskMode}
            options={[
              { key: "bookings", label: "By booking", icon: ListChecks, count: figures ? figures.counts.everything : null },
              { key: "register", label: "Invoice register", icon: Receipt, count: figures ? figures.invoices.liveCount + figures.invoices.voidCount : null },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey={VIEWS_KEY}
              current={{ status: "All", search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize, extra: { tab, type, dates } }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply(v);
                const x = (v.extra ?? {}) as { tab?: DeskTab; type?: string; dates?: GridDateRange };
                setTab(x.tab && [...BOOKING_TABS, ...INVOICE_TABS].some((t) => t.key === x.tab) ? x.tab : "everything");
                setTypeRaw(x.type || "");
                setDatesRaw(x.dates?.preset ? x.dates : GRID_ANY_DATE);
              }} />
            {onInvoices
              ? <GridColumnChooser cols={allInvoiceCols} prefs={invoicePrefs} onChange={setInvoicePrefs} />
              : <GridColumnChooser cols={bookingCols} prefs={bookingPrefs} onChange={setBookingPrefs} />}
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel">
              <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
            </button>
          </div>
        </div>

        <GridTabs<DeskTab>
          label={onInvoices ? "Invoice register views" : "Booking billing queues"}
          active={tab}
          onChange={setTab}
          panelId="crm-invoices-desk-panel"
          tabs={onInvoices ? registerTabs : bookingTabs}
        />

        <div id="crm-invoices-desk-panel" role="tabpanel" aria-labelledby={`crm-invoices-desk-panel-tab-${tab}`} tabIndex={0}>
          {!onInvoices && selected.size > 0 ? (
            <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
              {rights.canCreate && <button type="button" onClick={askBulk} disabled={!pickedRows.length} className={GRID_BTN} title={pickedRows.length ? undefined : "None of the selected bookings have milestones due for invoicing"}><Plus size={13} /> Generate invoices ({pickedRows.length})</button>}
              <button type="button" onClick={() => exportGrid([...selected.values()], bookingCols, `invoicing-selected-${selected.size}`)} className={GRID_BTN}><Download size={13} /> Export selected</button>
            </GridBulkBar>
          ) : (
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-border bg-muted/10">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking, or invoice no." />
              <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Invoice type" className={cn(GRID_INPUT, "!w-40")}>
                <option value="">All invoice types</option>
                {(figures?.types || []).map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Invoice date" value={dates} onChange={setDates} />
              {hasFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
            </div>
          )}

          {onInvoices ? (
            <CrmGrid cols={allInvoiceCols} prefs={invoicePrefs} onPrefs={setInvoicePrefs} rows={invoiceList?.rows ?? []} rowKey={(i) => i.Id} noRowNumbers
              loading={invoicesLoading} fetching={invoicesFetching} error={invoicesError ? translateError((invoicesError as Error).message) : null} onRetry={() => refetchInvoices()}
              sort={invoiceSort} onSort={(k) => { setInvoiceSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" })); list.setPage(1); }}
              onRowClick={openInvoice} empty={tab === "void" ? "No void invoices." : "No invoices match these filters."}
              page={list.page} pageSize={pageSize} total={invoiceList?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          ) : (
            <CrmGrid cols={bookingCols} prefs={bookingPrefs} onPrefs={setBookingPrefs} rows={bookingRows} rowKey={(r) => r.BookingId} noRowNumbers
              loading={bookingsLoading} fetching={bookingsFetching} error={bookingsError ? translateError((bookingsError as Error).message) : null} onRetry={() => refetchBookings()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openBooking(r.BookingId)} activeKey={openId ? Number(openId) : null}
              selected={selected} onSelect={setSelected}
              empty={hasFilters ? "No bookings match these filters." : "No bookings in this view."}
              page={list.page} pageSize={pageSize} total={ledger?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          )}
        </div>
      </div>
    </div>
  );

  const b = billing?.booking;
  const queueAt = bookingRows.findIndex((r) => String(r.BookingId) === openId);
  const milestoneName = (id?: number | null) => billing?.milestones.find((m: any) => m.Id === id)?.MilestoneName;
  const finalInvoice = billing?.invoices.find((i) => i.InvoiceType === "Final" && i.Status !== "Void");
  const readyMilestones = billing ? billing.milestones.filter((m: any) => billingStateOf(m, billing.invoices, !!billing.booking.NonInvoice) === "ready") : [];
  const waiverRows = billing?.waivers || [];
  const pendingWaiverSet = useMemo(() => pendingWaiverIds(waiverRows), [waiverRows]);
  const creditAndWaiverCount = (billing?.creditNotes.length || 0) + waiverRows.length;
  const nextSentence = !b ? null
    : b.Closed ? `This booking is ${String(b.BookingStatus).toLowerCase()}. Existing invoices remain on record.`
    : finalInvoice ? `Final invoice ${finalInvoice.InvoiceNo} covers the entire payment plan.`
    : b.FinalDue ? `All milestones are settled. The final invoice for ${fmtMoney(b.PlanDue)} is ready to generate.`
    : b.NonInvoice ? "This customer receives a single final invoice once all milestones are paid. Individual milestone invoices are disabled."
    : b.StatementDue ? "Every milestone is invoiced and paid. You can download a consolidated Final Statement summarizing these invoices (summary only, not a GST tax invoice)."
    : b.ReadyAmount > 0 ? `${b.ReadyCount} demanded milestone${b.ReadyCount === 1 ? "" : "s"} amounting to ${fmtMoney(b.ReadyAmount)} ${b.ReadyCount === 1 ? "is" : "are"} ready to invoice.`
    : b.NotInvoiced > 0 ? `${fmtMoney(b.NotInvoiced)} remaining to be invoiced. Raise a milestone demand first to enable invoicing.`
    : "All milestones on the payment plan have been invoiced.";
  const bookingNotYetDue = b ? Math.max(0, Math.round(((Number(b.PlanDue) || 0) - (Number(b.PlanInvoiced) || 0) - (Number(b.ReadyAmount) || 0)) * 100) / 100) : 0;
  const bookingInvoicedPct = b ? pct(Number(b.PlanInvoiced) || 0, Number(b.PlanDue) || 0) : 0;

  const exportRecordTab = () => {
    if (!b || !billing) return;
    if (recordTab === "schedule") {
      exportGrid(billing.milestones, [
        { id: "no", label: "No.", csv: (m: any) => m.MilestoneNo, cell: () => null },
        { id: "name", label: "Milestone", csv: (m: any) => m.MilestoneName, cell: () => null },
        { id: "due", label: "Amount Due", csv: (m: any) => m.AmountDue, cell: () => null },
        { id: "demand", label: "Demand", csv: (m: any) => m.DemandNo || m.DemandStatus, cell: () => null },
        { id: "inv", label: "Invoice No", csv: (m: any) => (billing.invoices.find((i) => i.MilestoneId === m.Id && i.Status !== "Void") || (m.Status !== "Waived" ? finalInvoice : undefined))?.InvoiceNo || "", cell: () => null },
        { id: "paid", label: "Received", csv: (m: any) => m.AmountPaid || 0, cell: () => null },
        { id: "state", label: "Billing status", csv: (m: any) => (pendingWaiverSet.has(m.Id) ? BILLING_MARK.waiverPending.label : BILLING_MARK[billingStateOf(m, billing.invoices, !!b.NonInvoice, !!b.FinalDue)].label), cell: () => null },
      ], `${b.BookingNo}-billing-schedule`);
      return;
    }
    if (recordTab === "invoices") {
      exportGrid(billing.invoices, [
        { id: "no", label: "Invoice", csv: (i) => i.InvoiceNo, cell: () => null },
        { id: "date", label: "Date", csv: (i) => i.InvoiceDate, cell: () => null },
        { id: "type", label: "Type", csv: (i) => typeLabel(i.InvoiceType), cell: () => null },
        { id: "taxable", label: "Taxable value", csv: (i) => i.TaxableValue, cell: () => null },
        { id: "gst", label: "GST", csv: (i) => i.GstAmount, cell: () => null },
        { id: "amt", label: "Amount", csv: (i) => i.Amount, cell: () => null },
        { id: "rec", label: "Received", csv: (i) => i.Received ?? "", cell: () => null },
        { id: "bal", label: "Balance", csv: (i) => i.Balance ?? "", cell: () => null },
        { id: "status", label: "Status", csv: (i) => i.Status, cell: () => null },
      ], `${b.BookingNo}-invoices`);
      return;
    }
    exportGrid(billing.creditNotes, [
      { id: "no", label: "Credit note", csv: (n: any) => n.DocNo || "Awaiting approval", cell: () => null },
      { id: "date", label: "Date", csv: (n: any) => n.DocDate, cell: () => null },
      { id: "inv", label: "Against invoice", csv: (n: any) => n.InvoiceNo, cell: () => null },
      { id: "taxable", label: "Taxable value", csv: (n: any) => n.TaxableValue, cell: () => null },
      { id: "gst", label: "GST", csv: (n: any) => n.GstAmount, cell: () => null },
      { id: "amt", label: "Amount", csv: (n: any) => n.TotalAmount, cell: () => null },
      { id: "status", label: "Status", csv: (n: any) => n.Status, cell: () => null },
    ], `${b.BookingNo}-credit-notes`);
  };

  const record = billingLoading ? (
    <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading the booking…</div>
  ) : billingError ? (
    <div role="alert" className={cn(GRID_CARD, "rounded-xl px-6 py-12 text-center space-y-3")}>
      <p className="text-sm font-medium text-destructive">
        Could not load booking billing{billingError instanceof Error ? `: ${translateError(billingError.message)}` : ""}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={closeBooking} className={GRID_BTN}><ArrowLeft size={13} /> All bookings</button>
        <button type="button" onClick={() => refetchBilling()} disabled={billingFetching} className={GRID_BTN_BRAND}>
          <RefreshCw size={13} className={billingFetching ? "animate-spin" : ""} /> {billingFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  ) : !billing || !b ? (
    <div className={cn(GRID_CARD, "rounded-xl px-6 py-12 text-center space-y-3")}>
      <p className="text-sm text-muted-foreground">This booking was not found.</p>
      <div className="flex justify-center">
        <button type="button" onClick={closeBooking} className={GRID_BTN}><ArrowLeft size={13} /> All bookings</button>
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={closeBooking} className={GRID_BTN}><ArrowLeft size={13} /> All bookings</button>
          {queueAt >= 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1 py-0.5">
              <button type="button" onClick={() => openBooking(bookingRows[queueAt - 1].BookingId)} disabled={queueAt === 0} className={cn(GRID_BTN, "!h-7 w-7 !px-0 border-0")} title="Previous booking" aria-label="Previous booking"><ChevronLeft size={14} /></button>
              <span className="text-xs text-muted-foreground tabular-nums px-1.5">{queueAt + 1} / {bookingRows.length}</span>
              <button type="button" onClick={() => openBooking(bookingRows[queueAt + 1].BookingId)} disabled={queueAt === bookingRows.length - 1} className={cn(GRID_BTN, "!h-7 w-7 !px-0 border-0")} title="Next booking" aria-label="Next booking"><ChevronRight size={14} /></button>
            </span>
          )}
          <Link to={`/crm/payments?bookingId=${b.BookingId}`} className={GRID_BTN}><Wallet size={13} /> Payment plan</Link>
          <Link to={`/crm/bookings?view=${b.BookingId}`} className={GRID_BTN}><ExternalLink size={13} /> Booking {b.BookingNo}</Link>
        </div>
        <button type="button" onClick={() => refetchBilling()} disabled={billingFetching} className={GRID_BTN} title="Refresh booking billing" aria-label="Refresh">
          <RefreshCw size={13} className={billingFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <section className={cn(GRID_CARD, "rounded-xl overflow-hidden")} aria-label="Booking billing summary">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4 border-b border-border">
          <div className="flex items-start gap-3 min-w-0 flex-1 basis-80">
            <Initials name={b.ApplicantName} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono font-medium text-foreground">{b.BookingNo}</span>
                <span>·</span>
                <span>Billing &amp; invoices</span>
                {b.BookingStatus && <GridStatusPill status={b.BookingStatus} />}
                {b.NonInvoice ? <GridToneMark text="Final invoice only" tone="waiting" /> : null}
              </div>
              <h1 className="mt-1 text-xl font-bold tracking-tight capitalize text-foreground truncate">
                <ApplicantNames name={b.ApplicantName} bookingId={b.BookingId} applicationId={b.ApplicationId} />
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                {[b.UnitNo, b.ProjectName, b.Mobile].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {b.StatementDue ? (
              <button type="button" onClick={() => downloadStatement(b)} className={GRID_BTN_BRAND}>
                <Download size={13} /> Final statement
              </button>
            ) : null}
            {rights.canCreate && b.FinalDue ? (
              <button type="button" onClick={() => askFinal(b)} className={GRID_BTN_BRAND}>
                <Plus size={13} /> Generate final invoice
              </button>
            ) : null}
            {rights.canCreate && !b.Closed && !b.HasFinal && !b.NonInvoice && readyMilestones.length > 1 && (
              <button type="button" onClick={() => askMilestones(b.BookingId, readyMilestones)} className={GRID_BTN}>
                <Plus size={13} /> Invoice all due ({readyMilestones.length})
              </button>
            )}
            {rights.canCreate && !b.Closed && !b.HasFinal && !b.NonInvoice && (
              <button type="button" onClick={() => setGenBookingId(b.BookingId)} className={GRID_BTN_BRAND}>
                <Plus size={13} /> Generate invoice
              </button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border bg-muted/15">
          <div className="px-5 py-3 min-w-0" title={fmtMoney(b.ReadyAmount)}>
            <dt className="text-xs text-muted-foreground font-medium">Due for invoicing</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", Number(b.ReadyAmount) > 0 ? TONE_AMBER_TEXT : "text-foreground")}>{fmtShort(b.ReadyAmount)}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {b.FinalDue ? "Final invoice ready" : b.ReadyCount > 0 ? `${b.ReadyCount} demanded milestone${b.ReadyCount === 1 ? "" : "s"}` : "Awaiting demand"}
            </dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={`Plan invoiced ${fmtMoney(b.PlanInvoiced)} of ${fmtMoney(b.PlanDue)}`}>
            <dt className="text-xs text-muted-foreground font-medium">Milestones invoiced</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", TONE_EMERALD_TEXT)}>{b.MilestoneInvoiced} of {b.MilestoneTotal}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {b.HasFinal ? "Covered by final invoice" : b.NonInvoice ? "Billed at completion" : `${fmtShort(b.PlanInvoiced)} of ${fmtShort(b.PlanDue)} (${bookingInvoicedPct}%)`}
            </dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={fmtMoney(b.ReceivedNotInvoiced)}>
            <dt className="text-xs text-muted-foreground font-medium">Advance received</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", Number(b.ReceivedNotInvoiced) > 0 ? TONE_ROSE_TEXT : "text-foreground")}>{fmtShort(b.ReceivedNotInvoiced)}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {b.ExcessOnAccount > 0
                ? `Not yet invoiced (${fmtShort(b.ExcessOnAccount)} excess held)`
                : Number(b.ReceivedNotInvoiced) > 0
                  ? `Not yet invoiced (${fmtShort(b.Approved)} approved)`
                  : `${fmtShort(b.Approved)} approved receipts covered`}
            </dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={`Net invoiced ${fmtMoney(b.NetInvoiced)} · Credited ${fmtMoney(b.Credited)}`}>
            <dt className="text-xs text-muted-foreground font-medium">Net invoiced</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{fmtShort(b.NetInvoiced)}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {fmtShort(b.Credited)} in credit notes · {b.LiveCount} issued{b.VoidCount ? ` · ${b.VoidCount} void` : ""}
            </dd>
          </div>
        </dl>

        <div className="px-5 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 [[data-theme]_&]:bg-emerald-500" /> Invoiced ({fmtShort(b.PlanInvoiced)})</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400 [[data-theme]_&]:bg-amber-500" /> Due for invoicing ({fmtShort(b.ReadyAmount)})</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted [[data-theme]_&]:bg-slate-300" /> Awaiting demand ({fmtShort(bookingNotYetDue)})</span>
            </div>
            <span className="tabular-nums font-medium text-foreground">
              {fmtShort(b.PlanDue)} payment plan <span className="text-muted-foreground font-normal">· {bookingInvoicedPct}% invoiced</span>
            </span>
          </div>
          <InvoiceBar size="md" due={Number(b.PlanDue)} invoiced={Number(b.PlanInvoiced)} ready={Number(b.ReadyAmount)}
            title={`Payment plan ${fmtMoney(b.PlanDue)} · Invoiced ${fmtMoney(b.PlanInvoiced)} · Ready ${fmtMoney(b.ReadyAmount)}`} />
        </div>

        {(nextSentence || Number(b.Waived) > 0 || Number(b.ExcessOnAccount) > 0) && (
          <div className="border-t border-border bg-muted/15 px-5 py-3 space-y-1.5 text-xs">
            {nextSentence && <p className="text-foreground font-medium">{nextSentence}</p>}
            {Number(b.Waived) > 0 && (
              <p className="text-muted-foreground tabular-nums">
                Agreed price {fmtMoney(b.GrandTotal)}, less {fmtMoney(b.Waived)} waived: {fmtMoney(b.PlanDue)} net billable.{" "}
                {waiverRows.length > 0 && (
                  <button type="button" onClick={() => setRecordTab("credits")} className="text-primary font-semibold hover:underline">
                    View waivers
                  </button>
                )}
              </p>
            )}
            {Number(b.ExcessOnAccount) > 0 && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle size={13} className={cn("shrink-0", TONE_AMBER_TEXT)} />
                <span>
                  <span className={cn("font-semibold tabular-nums", TONE_AMBER_TEXT)}>{fmtMoney(b.ExcessOnAccount)}</span> on account exceeds remaining billable dues.{" "}
                  <Link to={`/crm/refunds?newForBooking=${b.BookingId}`} className="text-primary font-semibold underline underline-offset-2">
                    Refund or adjust it
                  </Link>
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<RecordTab>
          label="Booking billing ledger"
          active={recordTab}
          onChange={setRecordTab}
          panelId="crm-invoice-record-panel"
          tabs={[
            { key: "schedule", label: "Billing schedule", count: billing.milestones.length },
            { key: "invoices", label: "Issued invoices", count: billing.invoices.length },
            { key: "credits", label: "Credit notes & waivers", count: creditAndWaiverCount },
          ]}
          end={
            <div className="flex items-center gap-2">
              {recordTab === "schedule" && rights.canCreate && !b.Closed && !b.NonInvoice && !b.HasFinal && readyMilestones.length > 1 && (
                <button type="button" onClick={() => askMilestones(b.BookingId, readyMilestones)} className={cn(GRID_BTN_BRAND, "!h-8 px-2.5 text-xs")}>
                  <Plus size={12} /> Invoice all due ({readyMilestones.length})
                </button>
              )}
              <button type="button" onClick={exportRecordTab} className={cn(GRID_BTN, "!h-8 px-2.5 text-xs")} title="Export current tab as CSV">
                <Download size={12} /> Export CSV
              </button>
            </div>
          }
        />

        <div id="crm-invoice-record-panel" role="tabpanel" aria-labelledby={`crm-invoice-record-panel-tab-${recordTab}`} tabIndex={0} className="p-4">
          {recordTab === "schedule" && (
            <GridMiniTable rows={billing.milestones} rowKey={(m: any) => m.Id} empty="No payment plan on this booking." cols={[
              { header: "Milestone", cell: (m: any) => <span className="font-medium text-foreground"><span className="text-muted-foreground tabular-nums mr-1.5">{m.MilestoneNo}</span>{m.MilestoneName}</span> },
              { header: "Amount", align: "right", cell: (m: any) => <span className="tabular-nums font-medium">{fmtMoney(m.AmountDue)}</span> },
              { header: "Demand", cell: (m: any) => (m.DemandStatus === "Pending" ? <span className="text-muted-foreground">Not raised</span> : <span className="text-xs tabular-nums">{m.DemandNo || m.DemandStatus}{m.DemandRaisedOn ? <span className="text-muted-foreground"> · {fmtDate(m.DemandRaisedOn)}</span> : null}</span>) },
              { header: "Invoice", cell: (m: any) => {
                const inv = billing.invoices.find((i) => i.MilestoneId === m.Id && i.Status !== "Void") || (m.Status !== "Waived" ? finalInvoice : undefined);
                return inv ? <button type="button" onClick={() => openInvoice(inv)} className="tabular-nums font-medium text-primary hover:underline">{inv.InvoiceNo}</button> : dash;
              } },
              { header: "Payments received", cell: (m: any) => <span className="text-xs">{moneyWords(m)}</span> },
              { header: "Billing status", cell: (m: any) => {
                const mark = pendingWaiverSet.has(m.Id)
                  ? BILLING_MARK.waiverPending
                  : BILLING_MARK[billingStateOf(m, billing.invoices, !!b.NonInvoice, !!b.FinalDue)];
                return <GridToneMark text={mark.label} tone={mark.tone} />;
              } },
              { header: "Actions", cell: (m: any) => {
                if (b.Closed) return null;
                const state = billingStateOf(m, billing.invoices, !!b.NonInvoice);
                if (state === "ready" && rights.canCreate) {
                  return <button type="button" onClick={() => askMilestones(b.BookingId, [m])} className={cn(KEY_INK, SMALL)}><Plus size={12} /> Invoice</button>;
                }
                const canDemand = m.DemandStatus === "Pending" && m.Status !== "Paid" && m.Status !== "Waived" && Number(m.AmountDue) > Number(m.AmountPaid || 0);
                if (canDemand && paymentRights.canEdit) {
                  const busy = raisingId === m.Id;
                  return (
                    <button type="button" onClick={() => askDemand(m)} disabled={busy} className={cn(KEY_LINE, SMALL)}>
                      {busy ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />} {busy ? "Raising…" : "Raise demand"}
                    </button>
                  );
                }
                return null;
              } },
            ]} />
          )}

          {recordTab === "invoices" && (
            <GridMiniTable rows={billing.invoices} rowKey={(i) => i.Id} empty="No invoices generated yet for this booking." cols={[
              { header: "Invoice", cell: (i) => <button type="button" onClick={() => openInvoice(i)} className={cn("tabular-nums font-semibold text-primary hover:underline", i.Status === "Void" && "line-through text-muted-foreground")}>{i.InvoiceNo}</button> },
              { header: "Date", cell: (i) => <span className="tabular-nums">{fmtDate(i.InvoiceDate)}</span> },
              { header: "Type", cell: (i) => typeLabel(i.InvoiceType) },
              { header: "For", cell: (i) => <span className="text-muted-foreground">{milestoneName(i.MilestoneId) || (i.InvoiceType === "Final" ? "Full payment plan" : i.Description || "—")}</span> },
              { header: "Taxable value", align: "right", cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.TaxableValue)}</span> },
              { header: "GST", align: "right", cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.GstAmount)}</span> },
              { header: "Amount", align: "right", cell: (i) => <span className={cn("tabular-nums font-semibold", i.Status === "Void" && "line-through font-normal text-muted-foreground")}>{fmtMoney(i.Amount)}</span> },
              { header: "Received", align: "right", cell: (i) => (i.Received == null ? dash : <span className="tabular-nums">{fmtMoney(i.Received)}</span>) },
              { header: "Balance", align: "right", cell: (i) => (i.Balance == null ? dash : Number(i.Balance) > 0 ? <span className="tabular-nums font-semibold">{fmtMoney(i.Balance)}</span> : <span className={cn("text-xs font-medium", TONE_EMERALD_TEXT)}>Nil</span>) },
              { header: "Credit note", cell: (i) => (Number(i.CreditedAmount) > 0 ? <CreditedNote inv={i} /> : dash) },
              { header: "Status", cell: (i) => <span title={i.VoidReason || undefined}><InvoiceMark inv={i} />{i.Status === "Void" && i.VoidReason ? <span className="block mt-0.5 text-[0.6875rem] text-muted-foreground">{i.VoidReason}</span> : null}</span> },
              { header: "Actions", cell: rowActions },
            ]} />
          )}

          {recordTab === "credits" && (
            <div className="space-y-4">
              {billing.creditNotes.length > 0 ? (
                <GridMiniTable rows={billing.creditNotes} rowKey={(n: any) => n.Id} empty="No credit notes." cols={[
                  { header: "Credit note", cell: (n: any) => <Link to={`/crm/credit-notes?id=${n.Id}`} className="tabular-nums font-medium text-primary hover:underline">{n.DocNo || "Awaiting approval"}</Link> },
                  { header: "Date", cell: (n: any) => <span className="tabular-nums">{fmtDate(n.DocDate)}</span> },
                  { header: "Against invoice", cell: (n: any) => <span className="tabular-nums">{n.InvoiceNo}</span> },
                  { header: "Taxable value", align: "right", cell: (n: any) => <span className="tabular-nums">{fmtMoney(n.TaxableValue)}</span> },
                  { header: "GST", align: "right", cell: (n: any) => <span className="tabular-nums">{fmtMoney(n.GstAmount)}</span> },
                  { header: "Amount", align: "right", cell: (n: any) => <span className="tabular-nums font-semibold">{fmtMoney(n.TotalAmount)}</span> },
                  { header: "Status", cell: (n: any) => <span className={cn("text-xs", n.Status === "Cancelled" && "line-through text-muted-foreground")}>{n.Status}</span> },
                ]} />
              ) : (
                <p className="text-xs text-muted-foreground px-1">
                  {waiverRows.length > 0
                    ? "No GST credit notes have been issued for invoices on this booking."
                    : "No credit notes or milestone waivers have been recorded for this booking."}
                </p>
              )}
              <WaiverSection waivers={waiverRows} canEdit={paymentRights.canEdit} onChanged={() => invalidateInvoiceRelatedQueries(qc, b.BookingId)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Invoices"]} />
      {/* The list stays mounted while a booking is open, so its tab, search, filters, sort and page survive the round trip. */}
      {desk}
      {openId && record}
      {preview && <InvoicePreviewDialog invoice={preview} canVoid={canVoid} onVoid={(inv) => { closeInvoice(); setVoidTarget(inv); }} onClose={closeInvoice} />}
      {confirm && (
        <GridDialog
          open
          onClose={() => { if (!running) setConfirm(null); }}
          icon={Receipt}
          width="max-w-md"
          title={confirm.title}
          description={confirm.text}
          footer={
            <>
              <button type="button" onClick={() => setConfirm(null)} disabled={running} className={GRID_BTN}>Cancel</button>
              <button type="button" onClick={runConfirmed} disabled={running} className={GRID_BTN_BRAND}>{running ? "Generating…" : "Generate"}</button>
            </>
          }
        >
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
            <span className="text-xs text-muted-foreground font-medium">Invoice amount</span>
            <span className="text-lg font-bold tabular-nums text-foreground">{fmtMoney(confirm.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">An invoice cannot be deleted once generated — it can only be voided with a reason.</p>
        </GridDialog>
      )}
      {voidTarget && (
        <VoidInvoiceDialog invoice={voidTarget} onClose={() => setVoidTarget(null)}
          onVoided={() => { const bid = voidTarget.BookingId; setVoidTarget(null); invalidateInvoiceRelatedQueries(qc, bid); }} />
      )}
      {genBookingId !== undefined && (
        <GenerateInvoiceDialog initialBookingId={genBookingId} onClose={() => setGenBookingId(undefined)}
          onGenerated={(bid) => { setGenBookingId(undefined); invalidateInvoiceRelatedQueries(qc, bid); }} />
      )}
    </>
  );
};

export default CrmInvoices;
