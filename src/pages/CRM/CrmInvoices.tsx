import { useCanApprove } from "@/hooks/useCanApprove";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { ArrowLeft, Ban, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ListChecks, Plus, Receipt, RefreshCw, Send, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import {
  CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridMiniTable, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_CARD, GRID_BTN, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, Initials, MoneyBand, WaiverNotes, WaiverSection, asName, moneyWords } from "./payments/parts";
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

type DeskTab = "everything" | "ready" | "final" | "uninvoiced" | "none" | "partial" | "full" | "closed" | "invoices" | "void";
const BOOKING_TABS: { key: DeskTab; label: string }[] = [
  { key: "everything", label: "All bookings" }, { key: "ready", label: "Due for invoicing" }, { key: "final", label: "Final invoice due" }, { key: "uninvoiced", label: "Advance received" },
  { key: "none", label: "Not invoiced" }, { key: "partial", label: "Partly invoiced" }, { key: "full", label: "Fully invoiced" }, { key: "closed", label: "Closed" },
];
const INVOICE_TABS: { key: DeskTab; label: string }[] = [{ key: "invoices", label: "All invoices" }, { key: "void", label: "Void invoices" }];
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
    { id: "tracker", label: "Invoiced", sortKey: "Invoiced", csv: (r) => r.PlanInvoiced, cell: (r) => (
      <span className="block min-w-[12rem] py-1.5" title={`Payment plan ${fmtMoney(r.PlanDue)} · Invoiced ${fmtMoney(r.PlanInvoiced)} · Due for invoicing ${fmtMoney(r.ReadyAmount)}`}>
        <InvoiceBar due={Number(r.PlanDue)} invoiced={Number(r.PlanInvoiced)} ready={Number(r.ReadyAmount)} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground"><span className="font-medium text-foreground">{fmtShort(r.PlanInvoiced)}</span> of {fmtShort(r.PlanDue)}</span>
          <span className="text-muted-foreground" title={r.HasFinal ? "Covered by the final invoice" : r.NonInvoice ? "This customer gets one final invoice once everything is paid" : "Milestones invoiced"}>
            {r.NonInvoice && !r.HasFinal ? "Final invoice" : `${r.MilestoneInvoiced} of ${r.MilestoneTotal} milestone${r.MilestoneTotal === 1 ? "" : "s"}`} · <span className="font-medium text-foreground">{pct(r.PlanInvoiced, r.PlanDue)}%</span>
          </span>
        </span>
      </span>
    ) },
    { id: "milestones", label: "Milestones", hiddenByDefault: true, csv: (r) => `${r.MilestoneInvoiced} of ${r.MilestoneTotal}`, cell: (r) => (r.MilestoneTotal
      ? <span className="tabular-nums">{r.MilestoneInvoiced} of {r.MilestoneTotal}{r.HasFinal ? <span className="block text-xs text-muted-foreground">Final invoice</span> : null}</span> : dash) },
    { id: "ready", label: "Due for invoicing", align: "right", sortKey: "ReadyAmount", csv: (r) => r.ReadyAmount, cell: (r) => (r.ReadyAmount > 0 ? (
      <span className="inline-flex flex-col items-end leading-tight" title={fmtMoney(r.ReadyAmount)}>
        <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-300">{fmtShort(r.ReadyAmount)}</span>
        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.FinalDue ? "Final invoice" : `${r.ReadyCount} milestone${r.ReadyCount === 1 ? "" : "s"}`}</span>
      </span>
    ) : dash) },
    { id: "received", label: "Advance received", align: "right", sortKey: "ReceivedNotInvoiced", csv: (r) => r.ReceivedNotInvoiced, cell: (r) => (r.ReceivedNotInvoiced > 0
      ? <span className="tabular-nums font-semibold text-destructive" title={fmtMoney(r.ReceivedNotInvoiced)}>{fmtShort(r.ReceivedNotInvoiced)}</span> : dash) },
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
    { id: "other", label: "Outside the plan", align: "right", hiddenByDefault: true, cell: (r) => money(r.OtherInvoiced), csv: (r) => r.OtherInvoiced },
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
  const setTab = (t: DeskTab) => { setTabRaw(t); setSelected(new Map()); list.setPage(1); };
  const setType = (t: string) => { setTypeRaw(t); list.setPage(1); };
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };

  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed

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
  const openBooking = (id: number) => setSearchParams((sp) => { sp.set("open", String(id)); return sp; });
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
  const { data: summaryData, refetch: refetchSummary } = useQuery({
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
    title: "Generate the final invoice?", total: Number(r.PlanDue),
    text: `One final invoice for ${r.ApplicantName}, booking ${r.BookingNo}. It takes the next invoice number and shows in the customer's portal.`,
    run: async () => { const d = await generateFinalInvoice(r.BookingId); toast.success(d.message || "Final invoice generated"); afterGenerating(r.BookingId); },
  });
  const askMilestones = (bookingId: number, milestones: { Id: number; AmountDue: number; MilestoneName: string }[]) => setConfirm({
    title: `Generate ${milestones.length} invoice${milestones.length === 1 ? "" : "s"}?`, total: milestones.reduce((n, m) => n + Number(m.AmountDue), 0),
    text: `${milestones.map((m) => m.MilestoneName).join(", ")}. Each takes the next invoice number and shows in the customer's portal.`,
    run: async () => { const d = await generateMilestoneInvoices(milestones.map((m) => ({ bookingId, milestoneId: m.Id }))); report(d.succeeded.length, d.skipped); afterGenerating(bookingId); },
  });
  const pickedRows = [...selected.values()].filter((r) => r.ReadyAmount > 0);
  const askBulk = () => {
    const finals = pickedRows.filter((r) => r.FinalDue);
    const items = pickedRows.filter((r) => !r.FinalDue).flatMap((r) => (r.ReadyMilestoneIds || []).map((milestoneId) => ({ bookingId: r.BookingId, milestoneId })));
    setConfirm({
      title: `Generate ${items.length + finals.length} invoice${items.length + finals.length === 1 ? "" : "s"}?`, total: pickedRows.reduce((n, r) => n + Number(r.ReadyAmount), 0),
      text: `On ${pickedRows.length} booking${pickedRows.length === 1 ? "" : "s"}${finals.length ? `, ${finals.length} of them a final invoice` : ""}. Each takes the next invoice number and shows in the customer's portal.`,
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
    try { await raiseDemand(m.Id); toast.success(`Demand raised on ${m.MilestoneName}`); invalidateInvoiceRelatedQueries(qc); }
    catch (e: any) { toast.error(translateError(e.message)); }
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
  const refreshOnBand = (onClick: () => void, busy: boolean) => (
    <button type="button" onClick={onClick} disabled={busy} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /></button>
  );
  const awaitingDemand = figures ? Math.max(0, Math.round((figures.notInvoiced - figures.ready) * 100) / 100) : 0;

  const desk = (
    <div hidden={!!openId} className="space-y-4">
      <MoneyBand eyebrow="CRM · Finance" title="Invoices" sub="Invoices against each booking's payment plan, across live bookings."
        actions={<>
          <SentBackPanel chip />
          {rights.canCreate && <button type="button" onClick={() => setGenBookingId(null)} className={BAND_KEY_MAIN}><Plus size={13} /> Generate invoice</button>}
          {refreshOnBand(refreshDesk, onInvoices ? invoicesFetching : bookingsFetching)}
        </>}
        lead={fmtShort(figures?.planInvoiced)} leadNote={figures ? `invoiced of ${fmtShort(figures.planDue)} · ${pct(figures.planInvoiced, figures.planDue)}%` : ""}
        bar={<InvoiceBar onDark due={figures?.planDue || 0} invoiced={figures?.planInvoiced || 0} ready={figures?.ready || 0} title={figures ? `Payment plan ${fmtMoney(figures.planDue)} · Invoiced ${fmtMoney(figures.planInvoiced)}` : undefined} />}
        figures={[
          { label: "Due for invoicing", dot: BAND_DOT.finance, value: fmtShort(figures?.ready), note: `${figures?.readyCount ?? 0} milestone${figures?.readyCount === 1 ? "" : "s"} · ${figures?.counts.final ?? 0} final invoice${figures?.counts.final === 1 ? "" : "s"}`, exact: fmtMoney(figures?.ready) },
          { label: "Not yet due", dot: BAND_DOT.notDue, value: fmtShort(awaitingDemand), note: "Awaiting demand or full payment", exact: fmtMoney(awaitingDemand) },
          { label: "Advance received", dot: BAND_DOT.overdue, value: fmtShort(figures?.receivedNotInvoiced), note: `${figures?.counts.uninvoiced ?? 0} booking${figures?.counts.uninvoiced === 1 ? "" : "s"}`, exact: fmtMoney(figures?.receivedNotInvoiced), alert: (figures?.receivedNotInvoiced || 0) > 0 },
          { label: "Credit notes", value: fmtShort(figures?.credited), note: `Net invoiced ${fmtShort(figures?.netInvoiced)}`, exact: fmtMoney(figures?.credited) },
        ]}
        footer={figures && (figures.otherInvoiced > 0 || figures.invoices.voidCount > 0)
          ? [figures.otherInvoiced > 0 ? `${fmtMoney(figures.otherInvoiced)} invoiced outside the payment plan, such as transfer fees.` : null, figures.invoices.voidCount > 0 ? `${figures.invoices.voidCount} void invoice${figures.invoices.voidCount === 1 ? "" : "s"} kept on record.` : null].filter(Boolean).join(" ")
          : undefined} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<DeskTab> label="Invoices" active={tab} onChange={setTab} tabs={[
          ...BOOKING_TABS.map((t) => ({ ...t, count: figures ? figures.counts[t.key] : null })),
          { ...INVOICE_TABS[0], count: figures ? figures.invoices.liveCount : null },
          { ...INVOICE_TABS[1], count: figures ? figures.invoices.voidCount : null },
        ]} />
        {!onInvoices && selected.size > 0 ? (
          <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
            {rights.canCreate && <button type="button" onClick={askBulk} disabled={!pickedRows.length} className={GRID_BTN} title={pickedRows.length ? undefined : "None of the ticked bookings has anything due for invoicing"}><Plus size={13} /> Generate invoices ({pickedRows.length})</button>}
            <button type="button" onClick={() => exportGrid([...selected.values()], bookingCols, `invoicing-selected-${selected.size}`)} className={GRID_BTN}><Download size={13} /> Export ticked</button>
          </GridBulkBar>
        ) : (
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking or invoice no." />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Invoice type" className={cn(GRID_INPUT, "!w-40")}>
            <option value="">All invoice types</option>
            {(figures?.types || []).map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          <GridDateFilter label="Invoice date" value={dates} onChange={setDates} />
          {hasFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey={VIEWS_KEY}
              current={{ status: "All", search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize, extra: { tab, type, dates } }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply(v);
                const x = (v.extra ?? {}) as { tab?: DeskTab; type?: string; dates?: GridDateRange };
                setTabRaw(x.tab && [...BOOKING_TABS, ...INVOICE_TABS].some((t) => t.key === x.tab) ? x.tab : "everything");
                setTypeRaw(x.type || "");
                setDatesRaw(x.dates?.preset ? x.dates : GRID_ANY_DATE);
              }} />
            {onInvoices
              ? <GridColumnChooser cols={allInvoiceCols} prefs={invoicePrefs} onChange={setInvoicePrefs} />
              : <GridColumnChooser cols={bookingCols} prefs={bookingPrefs} onChange={setBookingPrefs} />}
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        )}
        {onInvoices ? (
          <CrmGrid cols={allInvoiceCols} prefs={invoicePrefs} onPrefs={setInvoicePrefs} rows={invoiceList?.rows ?? []} rowKey={(i) => i.Id} noRowNumbers
            loading={invoicesLoading} fetching={invoicesFetching} error={invoicesError ? translateError((invoicesError as Error).message) : null} onRetry={() => refetchInvoices()}
            sort={invoiceSort} onSort={(k) => { setInvoiceSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" })); list.setPage(1); }}
            onRowClick={openInvoice} empty={tab === "void" ? "No void invoices." : "No invoice matches these filters."}
            page={list.page} pageSize={pageSize} total={invoiceList?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
        ) : (
          <CrmGrid cols={bookingCols} prefs={bookingPrefs} onPrefs={setBookingPrefs} rows={bookingRows} rowKey={(r) => r.BookingId} noRowNumbers
            loading={bookingsLoading} fetching={bookingsFetching} error={bookingsError ? translateError((bookingsError as Error).message) : null} onRetry={() => refetchBookings()}
            sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openBooking(r.BookingId)} activeKey={openId ? Number(openId) : null}
            selected={selected} onSelect={setSelected}
            empty={hasFilters ? "No booking matches these filters." : "No bookings here."}
            page={list.page} pageSize={pageSize} total={ledger?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
        )}
      </div>
    </div>
  );

  const b = billing?.booking;
  const queueAt = bookingRows.findIndex((r) => String(r.BookingId) === openId);
  const milestoneName = (id?: number | null) => billing?.milestones.find((m: any) => m.Id === id)?.MilestoneName;
  const finalInvoice = billing?.invoices.find((i) => i.InvoiceType === "Final" && i.Status !== "Void");
  const readyMilestones = billing ? billing.milestones.filter((m: any) => billingStateOf(m, billing.invoices, !!billing.booking.NonInvoice) === "ready") : [];
  const nextSentence = !b ? null
    : b.Closed ? `This booking is ${String(b.BookingStatus).toLowerCase()}. Its invoices stay on record.`
    : finalInvoice ? `Final invoice ${finalInvoice.InvoiceNo} covers the whole payment plan.`
    : b.FinalDue ? `This customer takes one final invoice, and everything is paid: the final invoice for ${fmtMoney(b.PlanDue)} can be generated now.`
    : b.NonInvoice ? "This customer takes one final invoice for the whole price, once everything is paid. No milestone invoices."
    : b.StatementDue ? "Every milestone is invoiced and paid. The customer can have a Final Statement totalling these invoices: it is not a tax invoice and books nothing."
    : b.ReadyAmount > 0 ? `${b.ReadyCount} milestone${b.ReadyCount === 1 ? "" : "s"} worth ${fmtMoney(b.ReadyAmount)} due for invoicing: the demand is raised.`
    : b.NotInvoiced > 0 ? `${fmtMoney(b.NotInvoiced)} is not invoiced yet. Raise the demand on a milestone to invoice it.`
    : "The whole payment plan is invoiced.";

  const record = billingLoading ? (
    <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading the booking…</div>
  ) : billingError ? (
    <div className="py-16 text-center text-destructive text-sm">{translateError((billingError as Error).message)}</div>
  ) : !billing || !b ? null : (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Invoicing · ${b.BookingNo}`}
        title={<ApplicantNames name={b.ApplicantName} bookingId={b.BookingId} applicationId={b.ApplicationId} />}
        sub={<span className="tabular-nums">{b.UnitNo}{b.ProjectName ? ` · ${b.ProjectName}` : ""}{b.Mobile ? ` · ${b.Mobile}` : ""}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/25 text-[0.6875rem] font-medium text-slate-200">{b.BookingStatus}</span>}
        actions={<>
          <button type="button" onClick={closeBooking} className={BAND_KEY}><ArrowLeft size={13} /> All bookings</button>
          {queueAt >= 0 && (
            <span className="inline-flex items-center gap-1">
              <button type="button" onClick={() => openBooking(bookingRows[queueAt - 1].BookingId)} disabled={queueAt === 0} className={cn(BAND_KEY, "w-9 !px-0")} title="Previous booking" aria-label="Previous booking"><ChevronLeft size={14} /></button>
              <span className="text-xs text-slate-400 tabular-nums px-1">{queueAt + 1} of {bookingRows.length}</span>
              <button type="button" onClick={() => openBooking(bookingRows[queueAt + 1].BookingId)} disabled={queueAt === bookingRows.length - 1} className={cn(BAND_KEY, "w-9 !px-0")} title="Next booking" aria-label="Next booking"><ChevronRight size={14} /></button>
            </span>
          )}
          {b.StatementDue ? <button type="button" onClick={() => downloadStatement(b)} className={BAND_KEY_MAIN}><Download size={13} /> Final statement</button> : null}
          <Link to={`/crm/payments?bookingId=${b.BookingId}`} className={BAND_KEY}><Wallet size={13} /> Payment plan</Link>
          <Link to={`/crm/bookings?view=${b.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open booking</Link>
          {rights.canCreate && b.FinalDue ? <button type="button" onClick={() => askFinal(b)} className={BAND_KEY_MAIN}><Plus size={13} /> Generate final invoice</button> : null}
          {rights.canCreate && !b.Closed && !b.HasFinal && !b.NonInvoice && <button type="button" onClick={() => setGenBookingId(b.BookingId)} className={BAND_KEY_MAIN}><Plus size={13} /> Generate invoice</button>}
          {refreshOnBand(() => refetchBilling(), billingFetching)}
        </>}
        lead={fmtShort(b.PlanInvoiced)} leadNote={`invoiced of ${fmtShort(b.PlanDue)} · ${pct(b.PlanInvoiced, b.PlanDue)}%`}
        bar={<InvoiceBar onDark due={Number(b.PlanDue)} invoiced={Number(b.PlanInvoiced)} ready={Number(b.ReadyAmount)} />}
        figures={[
          { label: "Due for invoicing", dot: BAND_DOT.finance, value: fmtShort(b.ReadyAmount), note: b.FinalDue ? "Final invoice" : `${b.ReadyCount} milestone${b.ReadyCount === 1 ? "" : "s"}`, exact: fmtMoney(b.ReadyAmount) },
          { label: "Milestones invoiced", value: `${b.MilestoneInvoiced} of ${b.MilestoneTotal}`, note: b.HasFinal ? "By the final invoice" : b.NonInvoice ? "Final invoice customer" : "Waived ones left out" },
          { label: "Advance received", dot: BAND_DOT.overdue, value: fmtShort(b.ReceivedNotInvoiced), note: b.ExcessOnAccount > 0 ? `Not invoiced. ${fmtShort(b.ExcessOnAccount)} excess` : `Not invoiced, of ${fmtShort(b.Approved)} approved`, exact: fmtMoney(b.ReceivedNotInvoiced), alert: b.ReceivedNotInvoiced > 0 },
          { label: "Credit notes", value: fmtShort(b.Credited), note: `Net invoiced ${fmtShort(b.NetInvoiced)}`, exact: fmtMoney(b.Credited) },
        ]}
        footer={<>{nextSentence}<WaiverNotes agreed={Number(b.GrandTotal) || 0} waived={Number(b.Waived) || 0} net={Number(b.PlanDue) || 0} excess={Number(b.ExcessOnAccount) || 0} bookingId={b.BookingId} /></>} />

      <GridRelated icon={Receipt} title="Invoices" count={billing.invoices.length}>
        <GridMiniTable rows={billing.invoices} rowKey={(i) => i.Id} empty="No invoices generated yet for this booking." cols={[
          { header: "Invoice", cell: (i) => <button type="button" onClick={() => openInvoice(i)} className={cn("tabular-nums font-semibold text-primary hover:underline", i.Status === "Void" && "line-through text-muted-foreground")}>{i.InvoiceNo}</button> },
          { header: "Date", cell: (i) => <span className="tabular-nums">{fmtDate(i.InvoiceDate)}</span> },
          { header: "Type", cell: (i) => typeLabel(i.InvoiceType) },
          { header: "For", cell: (i) => <span className="text-muted-foreground">{milestoneName(i.MilestoneId) || (i.InvoiceType === "Final" ? "The whole payment plan" : i.Description || "—")}</span> },
          { header: "Taxable value", align: "right", cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.TaxableValue)}</span> },
          { header: "GST", align: "right", cell: (i) => <span className={cn("tabular-nums", i.Status === "Void" && "text-muted-foreground")}>{fmtMoney(i.GstAmount)}</span> },
          { header: "Amount", align: "right", cell: (i) => <span className={cn("tabular-nums font-semibold", i.Status === "Void" && "line-through font-normal text-muted-foreground")}>{fmtMoney(i.Amount)}</span> },
          { header: "Received", align: "right", cell: (i) => (i.Received == null ? dash : <span className="tabular-nums">{fmtMoney(i.Received)}</span>) },
          { header: "Balance", align: "right", cell: (i) => (i.Balance == null ? dash : Number(i.Balance) > 0 ? <span className="tabular-nums font-semibold">{fmtMoney(i.Balance)}</span> : <span className="text-xs text-emerald-700 dark:text-emerald-300">Nil</span>) },
          { header: "Credit note", cell: (i) => (Number(i.CreditedAmount) > 0 ? <CreditedNote inv={i} /> : dash) },
          { header: "Status", cell: (i) => <span title={i.VoidReason || undefined}><InvoiceMark inv={i} />{i.Status === "Void" && i.VoidReason ? <span className="block mt-0.5 text-[0.6875rem] text-muted-foreground">{i.VoidReason}</span> : null}</span> },
          { header: "Actions", cell: rowActions },
        ]} />
      </GridRelated>

      <GridRelated icon={ListChecks} title="Billing by milestone" count={billing.milestones.length}
        action={rights.canCreate && !b.Closed && !b.NonInvoice && !b.HasFinal && readyMilestones.length > 1
          ? <button type="button" onClick={() => askMilestones(b.BookingId, readyMilestones)} className={cn(KEY_INK, SMALL)}><Plus size={12} /> Invoice all due ({readyMilestones.length})</button> : undefined}>
        <GridMiniTable rows={billing.milestones} rowKey={(m: any) => m.Id} empty="No payment plan on this booking." cols={[
          { header: "Milestone", cell: (m: any) => <span className="font-medium"><span className="text-muted-foreground tabular-nums mr-1.5">{m.MilestoneNo}</span>{m.MilestoneName}</span> },
          { header: "Amount", align: "right", cell: (m: any) => <span className="tabular-nums font-medium">{fmtMoney(m.AmountDue)}</span> },
          { header: "Demand", cell: (m: any) => (m.DemandStatus === "Pending" ? <span className="text-muted-foreground">Not raised</span> : <span className="text-xs tabular-nums">{m.DemandNo || m.DemandStatus}{m.DemandRaisedOn ? <span className="text-muted-foreground"> · {fmtDate(m.DemandRaisedOn)}</span> : null}</span>) },
          { header: "Invoice", cell: (m: any) => {
            const inv = billing.invoices.find((i) => i.MilestoneId === m.Id && i.Status !== "Void") || (m.Status !== "Waived" ? finalInvoice : undefined);
            return inv ? <button type="button" onClick={() => openInvoice(inv)} className="tabular-nums text-primary hover:underline">{inv.InvoiceNo}</button> : dash;
          } },
          { header: "Received against it", cell: (m: any) => <span className="text-xs">{moneyWords(m)}</span> },
          { header: "Billing status", cell: (m: any) => { const mark = pendingWaiverIds(billing.waivers).has(m.Id) ? BILLING_MARK.waiverPending : BILLING_MARK[billingStateOf(m, billing.invoices, !!b.NonInvoice, !!b.FinalDue)]; return <GridToneMark text={mark.label} tone={mark.tone} />; } },
          { header: "Actions", cell: (m: any) => {
            if (b.Closed) return null;
            const state = billingStateOf(m, billing.invoices, !!b.NonInvoice);
            if (state === "ready" && rights.canCreate) return <button type="button" onClick={() => askMilestones(b.BookingId, [m])} className={cn(KEY_INK, SMALL)}><Plus size={12} /> Invoice</button>;
            const canDemand = m.DemandStatus === "Pending" && m.Status !== "Paid" && m.Status !== "Waived" && Number(m.AmountDue) > Number(m.AmountPaid || 0);
            if (canDemand && paymentRights.canEdit) return <button type="button" onClick={() => askDemand(m)} className={cn(KEY_LINE, SMALL)}><Send size={12} /> Raise demand</button>;
            return null;
          } },
        ]} />
      </GridRelated>

      <WaiverSection waivers={billing.waivers || []} canEdit={paymentRights.canEdit} onChanged={() => invalidateInvoiceRelatedQueries(qc, b.BookingId)} />

      {billing.creditNotes.length > 0 && (
        <GridRelated icon={FileText} title="Credit notes" count={billing.creditNotes.length}>
          <GridMiniTable rows={billing.creditNotes} rowKey={(n: any) => n.Id} empty="No credit notes." cols={[
            { header: "Credit note", cell: (n: any) => <Link to={`/crm/credit-notes?id=${n.Id}`} className="tabular-nums font-medium text-primary hover:underline">{n.DocNo || "Awaiting approval"}</Link> },
            { header: "Date", cell: (n: any) => <span className="tabular-nums">{fmtDate(n.DocDate)}</span> },
            { header: "Against invoice", cell: (n: any) => <span className="tabular-nums">{n.InvoiceNo}</span> },
            { header: "Taxable value", align: "right", cell: (n: any) => <span className="tabular-nums">{fmtMoney(n.TaxableValue)}</span> },
            { header: "GST", align: "right", cell: (n: any) => <span className="tabular-nums">{fmtMoney(n.GstAmount)}</span> },
            { header: "Amount", align: "right", cell: (n: any) => <span className="tabular-nums font-semibold">{fmtMoney(n.TotalAmount)}</span> },
            { header: "Status", cell: (n: any) => <span className={cn("text-xs", n.Status === "Cancelled" && "line-through text-muted-foreground")}>{n.Status}</span> },
          ]} />
        </GridRelated>
      )}
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Invoices"]} />
      {/* The list stays mounted while a booking is open, so its tab, search, filters, sort and page survive the round trip. */}
      {desk}
      {openId && record}
      {preview && <InvoicePreviewDialog invoice={preview} canVoid={canVoid} onVoid={(inv) => { closeInvoice(); setVoidTarget(inv); }} onClose={closeInvoice} />}
      {confirm && <Dialog open onOpenChange={(o) => { if (!o && !running) setConfirm(null); }}>
        <DialogContent className="max-w-md p-5 gap-4">
          <DialogHeader>
            <DialogTitle>{confirm.title}</DialogTitle>
            <DialogDescription className="text-xs">{confirm.text}</DialogDescription>
          </DialogHeader>
          <div className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Invoice amount</span>
            <span className="text-lg font-semibold tabular-nums">{fmtMoney(confirm.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">An invoice can't be deleted after this, only voided with a reason.</p>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={running} className={cn(KEY_LINE, "h-9 px-4")}>Cancel</button>
            <button type="button" onClick={runConfirmed} disabled={running} className={cn(KEY_INK, "h-9 px-4")}>{running ? "Generating…" : "Generate"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
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
