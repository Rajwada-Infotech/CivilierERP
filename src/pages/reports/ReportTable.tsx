import { chainLinksForRow } from "@/lib/civilWorkDprLinks";
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useInSheet } from "@/components/sheet/useInSheet";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { WorkerAttendanceLogGroups } from "@/pages/civilworkdpr/WorkerAttendance";
import type { AttendanceReportRow } from "@/api/workerAttendanceApi";
import { VendorLedgerReportBody } from "@/pages/finance/VendorLedgerReport";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/ui/MultiSelectDropdown";
import { todayIstDate } from "@/lib/attendanceFormat";
import { getEngineers } from "@/api/dependencyActivityAssignmentApi";
import { getDprTags } from "@/api/dprTagMasterApi";
import { ChevronDown, RefreshCw, X, Users, Receipt, ChevronLeft, AlertCircle, Loader2, FileText, Warehouse, Search } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { LedgerReportGroups } from "@/pages/reports/LedgerReportGroups";
import { CWD_INLINE_PROJECT_REPORTS, fmt } from "@/pages/reports/format";
import type { CompanyOption, FilterState, ReportDef } from "@/pages/reports/types";

// ── Report data table ─────────────────────────────────────────────────────────

export const ReportTable: React.FC<{
  report: ReportDef;
  filters: FilterState;
  companies: CompanyOption[];
  projects: { id: number; name: string }[];
  onClose: () => void;
  /** When set, clicking a row calls this instead of opening the row-detail dialog (the Civil Work DPR Query page). */
  onRowOpen?: (row: Record<string, unknown>) => void;
  /** Start the inline Date field empty (the Query page shows the section bar's range instead of today only). */
  startWithoutDate?: boolean;
}> = ({ report, filters, companies, projects, onClose, onRowOpen, startWithoutDate }) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The Query page opens an activity in Reporting and comes back: keep its project / user / date / page choices
  // for that round trip (this tab only).
  const savedCtx = useMemo(() => {
    if (!onRowOpen) return null;
    try {
      return JSON.parse(sessionStorage.getItem(`query-ctx:${report.id}`) || "null") as
        { projectIds?: string[]; userIds?: string[]; userDate?: string; page?: number } | null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [page, setPage] = useState(savedCtx?.page ?? 1);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  // Civil Work DPR rows carry the activity / chain they are about: offer to open it in the pages that work on it.
  const reportNavigate = useNavigate();
  const { canAccessPage: canOpenPage } = useAuth();
  const chainLinks = selectedRow ? chainLinksForRow(selectedRow, (pk) => canOpenPage(pk as never)) : [];
  const PAGE_SIZE = 20;

  // ── Godown switcher (stock-summary only) ─────────────────────────────────
  const isStockSummary = report.id === "stock-summary";
  const [godownId, setGodownId] = useState<string>("");
  const [godowns, setGodowns] = useState<
    { GodownID: number; GodownName: string; IsMain: number }[]
  >([]);
  useEffect(() => {
    if (!isStockSummary) return;
    fetchWithAuth("/api/godowns")
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        const list = Array.isArray(j) ? j : (j.data ?? []);
        setGodowns(list);
        // Default to the main godown
        const main = list.find((g: { IsMain: number }) => g.IsMain);
        if (main) setGodownId(String(main.GodownID));
      })
      .catch(() => {});
  }, [isStockSummary]);

  // ── Worker Attendance renders as the same grouped/collapsible log the
  //     Worker Attendance page itself uses, instead of a flat table. ─────────
  const isWorkerAttendance = report.id === "worker-attendance";

  // ── Ledger Report renders one row per GL head (click to expand its own
  //     postings) instead of a flat, repeated-head-per-row table. ───────────
  const isLedgerReport = report.id === "ledger-report";

  // ── Vendor Ledger Report is search-driven (any party/GL head) with its
  //     own internal fetching (search, per-party passbook, all-transactions
  //     default view) — it doesn't fit the generic apiPath+filters+flat-rows
  //     shape at all, so it renders VendorLedgerReportBody directly and
  //     load() below skips fetching report.apiPath entirely for this id. ──
  const isVendorLedger = report.id === "vendor-ledger-report";

  // ── Payment Reason switcher (payment-reason-report only) ─────────────────
  const isPaymentReasonReport = report.id === "payment-reason-report";
  const [reasonFilter, setReasonFilter] = useState<string>("");
  const [reasonOptions, setReasonOptions] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!isPaymentReasonReport) return;
    fetchWithAuth("/api/payment-reason-master/options")
      .then((r) => r.json().catch(() => []))
      .then((list) => setReasonOptions(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [isPaymentReasonReport]);

  // ── Expense Head switcher (expense-register only) — nested (grouped by
  //     parent Account Group) multi-select, so more than one head can be
  //     picked at once instead of one at a time. ───────────────────────────
  const isExpenseRegister = report.id === "expense-register";
  // Civil Work DPR reports carry their own multi-select Project picker (supersedes the section bar's single one).
  const hasInlineProject = CWD_INLINE_PROJECT_REPORTS.has(report.id);
  // User-Wise Daily Work: a User multi-select next to the Project one.
  // The Tag-Wise report is the same logbook plus a Tag multi-select, so it shares the User + inline Date fields.
  const isTagWise = report.id === "cwd-tag-wise";
  const isUserWise = report.id === "cwd-user-daily-work" || isTagWise;
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<MultiSelectOption[]>([]);
  useEffect(() => {
    if (!isTagWise) return;
    getDprTags()
      .then((list) => setTagOptions(list.map((t) => ({ id: String(t.id), label: t.tagName }))))
      .catch(() => {});
  }, [isTagWise]);
  const [userIds, setUserIds] = useState<string[]>(savedCtx?.userIds ?? []);
  // Auto Name search (User-Wise / Tag-Wise): words of "flat, room and activity" in any order, sent after a pause.
  const [autoSearch, setAutoSearch] = useState("");
  const [autoSearchTerm, setAutoSearchTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAutoSearchTerm(autoSearch.trim().length >= 2 ? autoSearch.trim() : ""), 400);
    return () => clearTimeout(t);
  }, [autoSearch]);
  // Its own Date field, right in the report's toolbar (starts on today): one day's records only.
  const [userDate, setUserDate] = useState<string>(() => savedCtx?.userDate ?? (startWithoutDate ? "" : todayIstDate()));
  const [userOptions, setUserOptions] = useState<MultiSelectOption[]>([]);
  useEffect(() => {
    if (!isUserWise) return;
    getEngineers()
      .then((list) => setUserOptions(list.map((u) => ({ id: u.id, label: u.name }))))
      .catch(() => {});
  }, [isUserWise]);
  const isGrnRegister = report.id === "grn-register";
  const [expenseHeadIds, setExpenseHeadIds] = useState<string[]>([]);
  const [expenseHeadOptions, setExpenseHeadOptions] = useState<MultiSelectOption[]>([]);
  // Expense Register also gets Company / Project multi-selects (checkbox
  // dropdowns) — ReportTable remounts per report (key=report.id) so these
  // reset on their own when you switch reports.
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>(savedCtx?.projectIds ?? []);
  // Expense Register also gets its own inline Date Range filter — the
  // shared Day/Range toggle above (SectionFilters) already wires "from"/
  // "to" through buildParams() below, but it lives in the parent, a full
  // scroll away from this table and easy to miss while looking at the
  // register itself. This local pair renders right in the register's own
  // toolbar next to Company/Project/Expense Head, and supersedes the
  // shared filter the same way those already do.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  useEffect(() => {
    if (!onRowOpen) return;
    try {
      sessionStorage.setItem(`query-ctx:${report.id}`, JSON.stringify({ projectIds, userIds, userDate, page }));
    } catch { /* storage unavailable — just don't remember */ }
  }, [onRowOpen, report.id, projectIds, userIds, userDate, page]);
  useEffect(() => {
    if (!isExpenseRegister) return;
    fetchWithAuth("/api/general-ledger/options")
      .then((r) => r.json().catch(() => []))
      .then((list: { id: number; label: string; code: string | null; groupName: string | null }[]) =>
        setExpenseHeadOptions(
          (Array.isArray(list) ? list : []).map((l) => ({
            id: l.id,
            label: l.label,
            hint: l.code || undefined,
            group: l.groupName || null,
          })),
        ),
      )
      .catch(() => {});
  }, [isExpenseRegister]);

  // Always show the richer column set for the Expense Register — every row
  // carries its own GL Name + Direct/Indirect Expense Type now (resolved
  // per row server-side, see expenseBooking.js's ERowGLName/
  // ERowExpenseType), not just a single filtered head's, so this no longer
  // needs to gate on whether a head is picked.
  const effectiveColumns = useMemo<ExportColumn[]>(() => {
    if (!isExpenseRegister) return report.columns;
    return [
      ...report.columns,
      { header: "GL Name", accessor: (r) => (r.ERowGLName ?? "—") as string },
      { header: "Expense Type", accessor: (r) => (r.ERowExpenseType ?? "—") as string },
      { header: "Vendor Name", accessor: (r) => (r.ESupplierName ?? "—") as string },
      {
        header: "Invoice Amt",
        accessor: (r) => fmt(Number(r.ENetAmount ?? r.EGrnTotalAmount ?? r.EAmount) || 0),
      },
      {
        header: "Invoice Date",
        accessor: (r) => {
          const d = r.EVendorInvoiceDate ?? r.EDocDate;
          return d ? String(d).slice(0, 10) : "—";
        },
      },
    ];
  }, [isExpenseRegister, report.columns]);

  const buildParams = (): Record<string, string> => {
    const fc = report.filterConfig ?? {};
    const f: Record<string, string> = {};

    // ── Company ───────────────────────────────────────────────────────────────
    // Default param name is "companyId". If filterConfig.companyParam is null, skip.
    const compParam = "companyParam" in fc ? fc.companyParam : "companyId";
    if (compParam && filters.companyId) f[compParam] = filters.companyId;

    // ── Project ───────────────────────────────────────────────────────────────
    // Default is null (skip) — most report routes have no project scoping;
    // only opt-in reports (filterConfig.projectParam set) actually read it.
    // A few routes filter by the project's NAME via a LIKE match rather than
    // its id (projectValueType: "name") — resolve that from the picked id.
    const projParam = "projectParam" in fc ? fc.projectParam : null;
    if (projParam && filters.projectId) {
      if (fc.projectValueType === "name") {
        const p = projects.find((x) => String(x.id) === filters.projectId);
        if (p) f[projParam] = p.name;
      } else {
        f[projParam] = filters.projectId;
      }
    }

    // ── Financial year / Date ─────────────────────────────────────────────────
    // fin-year takes priority over calendar dates (same as the UI logic).
    const fyParam = "finYearParam" in fc ? fc.finYearParam : null;
    // Default single-date param: "dateFrom"  Default range params: "dateFrom"/"dateTo"
    const sdParam = "singleDateParam" in fc ? fc.singleDateParam : "dateFrom";
    const dfParam = "dateFromParam" in fc ? fc.dateFromParam : "dateFrom";
    const dtParam = "dateToParam" in fc ? fc.dateToParam : "dateTo";

    if (filters.finYearId) {
      if (fyParam) f[fyParam] = filters.finYearId;
    } else if (filters.dateMode === "single" && filters.singleDate) {
      if (sdParam) f[sdParam] = filters.singleDate;
    } else if (
      filters.dateMode === "range" &&
      filters.rangeFrom &&
      filters.rangeTo
    ) {
      if (dfParam) f[dfParam] = filters.rangeFrom;
      if (dtParam) f[dtParam] = filters.rangeTo;
    }

    // Stock summary: pass selected godownId to inventory-master
    if (isStockSummary && godownId) f["godownId"] = godownId;

    // Expense Register: pass every selected Expense Head, comma-separated —
    // the backend's expenseHeadId param accepts either one id or a list.
    if (isExpenseRegister && expenseHeadIds.length) f["expenseHeadId"] = expenseHeadIds.join(",");

    // Expense Register: multi-select Company / Project — comma-separated ids.
    // These supersede the section bar's single Company / Project filters.
    if (isExpenseRegister && companyIds.length) f["companyId"] = companyIds.join(",");
    if (isExpenseRegister && projectIds.length) {
      f["projectId"] = projectIds.join(",");
      delete f["projectName"];
    }

    // Civil Work DPR reports: every picked project, comma-separated.
    if (hasInlineProject && projectIds.length) f[fc.projectParam ?? "projectId"] = projectIds.join(",");
    if (isUserWise && userIds.length) f["userId"] = userIds.join(",");
    if (isTagWise && tagIds.length) f["tagId"] = tagIds.join(",");
    if (isUserWise && autoSearchTerm) f["search"] = autoSearchTerm;
    // The inline Date supersedes the section bar's Day / Range, the way the Expense Register's does.
    if (isUserWise && userDate) {
      delete f["dateFrom"];
      delete f["dateTo"];
      f["date"] = userDate;
    }

    // Expense Register: inline Date Range — supersedes the shared section
    // bar's Day/Range date filter the same way Company/Project above do.
    if (isExpenseRegister && dateFrom) f["from"] = dateFrom;
    if (isExpenseRegister && dateTo) f["to"] = dateTo;

    // Payment Reason Report: scope to a single reason when selected
    if (isPaymentReasonReport && reasonFilter) f["reason"] = reasonFilter;

    return f;
  };

  // Pages through with `page`/`limit` until a page comes back short of a
  // full page, a `total`/`totalPages` field in the response says there's no
  // more, or a safety cap of 100 pages is hit (whichever first), then
  // concatenates everything. Needed even for the on-screen table (not just
  // export) — several of these routes (e.g. expense-booking) hard-cap
  // `limit` server-side to 100 regardless of what's asked for, so a single
  // request silently truncated the list to that server cap instead of
  // "500 rows" the old single-fetch `load()` assumed it was getting.
  const fetchAllRows = useCallback(async (): Promise<Record<string, unknown>[]> => {
    const dataKey = report.filterConfig?.dataKey ?? "data";
    const baseParams = { ...report.defaultParams, ...buildParams() };
    const pageSize = 500;
    const all: Record<string, unknown>[] = [];
    let prevFirstRowKey: string | null = null;
    for (let page = 1; page <= 100; page++) {
      const params = new URLSearchParams({ ...baseParams, limit: String(pageSize), page: String(page) });
      const res = await fetchWithAuth(`${report.apiPath}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Some routes return a plain array; others wrap in { data: [...] }.
      // stock-summary uses { byItem: [...] }. Honour filterConfig.dataKey.
      const batch: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : (json[dataKey] ?? json.data ?? json.records ?? []);
      // A route that silently ignores `page` (always returns the same
      // window) would otherwise loop up to 100x re-adding the same rows —
      // bail the moment a "next" page's first row is identical to the
      // previous page's, rather than trusting the loop to terminate any
      // other way.
      const firstRowKey = batch.length ? JSON.stringify(batch[0]) : null;
      if (page > 1 && firstRowKey !== null && firstRowKey === prevFirstRowKey) break;
      prevFirstRowKey = firstRowKey;

      all.push(...batch);
      const totalPages = typeof json?.totalPages === "number" ? json.totalPages : null;
      const total = typeof json?.total === "number" ? json.total : null;
      const doneByPageCount = totalPages != null && page >= totalPages;
      const doneByTotal = total != null && all.length >= total;
      // A plain-array response (no pagination metadata at all) never
      // supports `page` — one request is all there is, so stop after it
      // regardless of how many rows came back.
      const noPaginationMetadata = Array.isArray(json);
      // "Short page" only means "last page" when there's no total/totalPages
      // to trust instead — a route that hard-caps `limit` server-side below
      // what was asked for (e.g. expense-booking clamping 500 down to 100)
      // returns a batch shorter than pageSize on page 1 even though
      // totalPages says there are 3 more pages still to fetch. Relying on
      // batch.length < pageSize unconditionally stopped the loop right
      // there, silently truncating the on-screen table to that server cap.
      const hasPaginationMetadata = totalPages != null || total != null;
      const doneByShortPage = !hasPaginationMetadata && batch.length < pageSize;
      if (batch.length === 0 || doneByShortPage || doneByPageCount || doneByTotal || noPaginationMetadata) break;
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, filters.companyId, filters.projectId, filters.finYearId, filters.singleDate, filters.rangeFrom, filters.rangeTo, godownId, reasonFilter, expenseHeadIds, companyIds, projectIds, userIds, tagIds, autoSearchTerm, userDate, dateFrom, dateTo, projects]);

  // ── Server-paged reports: fetch just the page on screen ──────────────────
  // Fetching every page up front (fetchAllRows) meant hundreds of sequential
  // requests before a single row showed on a lakh-row report. Here: page 1
  // (with the total) on filter change, other pages on demand, cached, and the
  // next page prefetched so "Next" is instant.
  const serverPaged = !!report.serverPaged;
  const [serverTotal, setServerTotal] = useState(0);
  const pageCache = useRef(new Map<number, Record<string, unknown>[]>());
  // The same table is shown on the Reports page and, for one report, on a drawing-sheet page (Civil Work DPR > Query).
  // On the sheet it drops its colour accents and takes the sheet's ink rules; on Reports it is unchanged.
  const tableRootRef = useRef<HTMLDivElement>(null);
  const onSheet = useInSheet(tableRootRef);
  const fetchServerPage = useCallback(async (pg: number, withTotal: boolean) => {
    const cached = pageCache.current.get(pg);
    if (cached && !withTotal) return { rows: cached, total: null as number | null };
    const params = new URLSearchParams({
      ...report.defaultParams, ...buildParams(),
      page: String(pg), limit: String(PAGE_SIZE), withTotal: withTotal ? "1" : "0",
    });
    const res = await fetchWithAuth(`${report.apiPath}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const batch: Record<string, unknown>[] = Array.isArray(json) ? json : (json.data ?? []);
    pageCache.current.set(pg, batch);
    return { rows: batch, total: typeof json?.total === "number" ? json.total : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAllRows]); // fetchAllRows' deps are exactly the filter set

  const load = useCallback(async () => {
    if (serverPaged) {
      pageCache.current.clear();
      setLoading(true);
      setError(null);
      try {
        const { rows: first, total } = await fetchServerPage(1, true);
        setRows(first);
        setServerTotal(total ?? first.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
      return;
    }
    // VendorLedgerReportBody fetches everything it needs itself — nothing
    // for this generic apiPath flow to do.
    if (isVendorLedger) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAllRows());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [isVendorLedger, fetchAllRows, serverPaged, fetchServerPage]);

  useEffect(() => {
    load();
    setPage(1);
  }, [load]);

  // Export reuses the exact same full-pagination fetch as the on-screen
  // table now uses — no separate "get everything" path needed anymore.
  const fetchAllForExport = useCallback(async (): Promise<Record<string, unknown>[]> => {
    if (isVendorLedger) return rows; // has its own export path, not reached here
    return fetchAllRows();
  }, [isVendorLedger, rows, fetchAllRows]);

  // Page change on a server-paged report: show that page (cached or fetched), then warm the next one.
  const [pageLoading, setPageLoading] = useState(false);
  useEffect(() => {
    if (!serverPaged || loading) return;
    let cancelled = false;
    const show = async () => {
      if (page !== 1 || !pageCache.current.has(1)) {
        if (!pageCache.current.has(page)) setPageLoading(true);
        try {
          const { rows: r } = await fetchServerPage(page, false);
          if (!cancelled) setRows(r);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
        } finally {
          if (!cancelled) setPageLoading(false);
        }
      } else {
        setRows(pageCache.current.get(1)!);
      }
      const next = page + 1;
      if (next <= Math.ceil(serverTotal / PAGE_SIZE) && !pageCache.current.has(next)) {
        fetchServerPage(next, false).catch(() => {});
      }
    };
    show();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, serverPaged, loading]);

  const recordCount = serverPaged ? serverTotal : rows.length;
  const totalPages = Math.ceil(recordCount / PAGE_SIZE);
  const pageRows = serverPaged ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cell = (row: Record<string, unknown>, col: ExportColumn): string => {
    if (typeof col.accessor === "function") return col.accessor(row) as string;
    const v = row[col.accessor as string];
    return v == null ? "—" : String(v);
  };

  return (
    <>
    <div
      ref={tableRootRef}
      className={onSheet ? "bg-card overflow-hidden" : "rounded-xl border border-border bg-card overflow-hidden"}
      style={onSheet ? { border: "1px solid hsl(var(--foreground))" } : { borderTopWidth: 2, borderTopColor: report.color }}
    >
      {/* Header */}
      <div
        className={onSheet ? "flex items-center justify-between flex-wrap gap-y-2 px-4 py-3" : "flex items-center justify-between flex-wrap gap-y-2 px-4 py-3 border-b border-border bg-muted/10"}
        style={onSheet ? { borderBottom: "1px solid hsl(var(--foreground))" } : undefined}
      >
        <div className="flex items-center gap-2.5 flex-wrap gap-y-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={13} /> Back
          </button>
          <span className="text-border">|</span>
          {!onSheet && (
          <div
            className="p-1.5 rounded-md"
            style={{ background: `${report.color}18` }}
          >
            <report.icon size={13} style={{ color: report.color }} />
          </div>
          )}
          <span className={onSheet ? "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground" : "text-sm font-heading font-semibold text-foreground"}>
            {report.label}
          </span>
          {!loading && !error && !isVendorLedger && (
            <span className={onSheet ? "font-heading text-[0.6875rem] tabular-nums text-muted-foreground" : "text-[0.625rem] bg-muted text-muted-foreground px-2 py-0.5 rounded-full"}>
              {recordCount.toLocaleString("en-IN")} records
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap gap-y-2">
          {!isVendorLedger && (
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </button>
          )}

          {/* Godown switcher — stock-summary only */}
          {isStockSummary && godowns.length > 0 && (
            <div className="relative flex items-center">
              <Warehouse
                size={11}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={godownId}
                onChange={(e) => setGodownId(e.target.value)}
                className="appearance-none pl-7 pr-6 py-1.5 h-[30px] rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              >
                {godowns.map((g) => (
                  <option key={g.GodownID} value={String(g.GodownID)}>
                    {g.GodownName}
                    {g.IsMain ? " ★" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          )}

          {/* Reason switcher — payment-reason-report only */}
          {isPaymentReasonReport && reasonOptions.length > 0 && (
            <div className="relative flex items-center">
              <Receipt
                size={11}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value)}
                className="appearance-none pl-7 pr-6 py-1.5 h-[30px] rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              >
                <option value="">All Reasons</option>
                {reasonOptions.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          )}

          {/* Expense Head switcher — expense-register only. Nested (grouped
              by parent Account Group) multi-select — pick any number of
              heads at once instead of one at a time. */}
          {isExpenseRegister && companies.length > 0 && (
            <div className="w-44">
              <MultiSelectDropdown
                options={companies.map((c) => ({ id: c.id, label: c.name }))}
                value={companyIds}
                onChange={setCompanyIds}
                placeholder="All Companies"
                searchPlaceholder="Search companies…"
                itemNoun="company"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {isExpenseRegister && projects.length > 0 && (
            <div className="w-44">
              <MultiSelectDropdown
                options={projects.map((pr) => ({ id: pr.id, label: pr.name }))}
                value={projectIds}
                onChange={setProjectIds}
                placeholder="All Projects"
                searchPlaceholder="Search projects…"
                itemNoun="project"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {hasInlineProject && projects.length > 0 && (
            <div className="w-52">
              <MultiSelectDropdown
                options={projects.map((pr) => ({ id: pr.id, label: pr.name }))}
                value={projectIds}
                onChange={setProjectIds}
                placeholder="All Projects"
                searchPlaceholder="Search projects…"
                itemNoun="project"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {isUserWise && (
            <div className="flex items-center gap-1.5">
              <DateInput
                value={userDate}
                onChange={(e) => setUserDate(e.target.value)}
                title="Date — only this day's work is shown"
                className="h-[30px] px-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              {userDate && (
                <button
                  type="button"
                  onClick={() => setUserDate("")}
                  title="Clear the date (then the section bar's Day / Range applies, or today if none)"
                  className="h-[30px] flex items-center px-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}

          {isUserWise && (
            <div className="relative w-64">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={autoSearch}
                onChange={(e) => setAutoSearch(e.target.value)}
                placeholder="Search Auto Name — flat, room or activity…"
                className="w-full h-[30px] pl-7 pr-7 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              {autoSearch && (
                <button type="button" onClick={() => setAutoSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <X size={11} />
                </button>
              )}
            </div>
          )}

          {isTagWise && tagOptions.length > 0 && (
            <div className="w-52">
              <MultiSelectDropdown
                options={tagOptions}
                value={tagIds}
                onChange={setTagIds}
                placeholder="All Tags"
                searchPlaceholder="Search tags…"
                itemNoun="tag"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {isUserWise && userOptions.length > 0 && (
            <div className="w-52">
              <MultiSelectDropdown
                options={userOptions}
                value={userIds}
                onChange={setUserIds}
                placeholder="All Users"
                searchPlaceholder="Search users…"
                itemNoun="user"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {isExpenseRegister && expenseHeadOptions.length > 0 && (
            <div className="w-56">
              <MultiSelectDropdown
                options={expenseHeadOptions}
                value={expenseHeadIds}
                onChange={setExpenseHeadIds}
                placeholder="All Expense Heads"
                searchPlaceholder="Search expense heads…"
                itemNoun="expense head"
                className="h-[30px] py-1"
              />
            </div>
          )}

          {isExpenseRegister && (
            <div className="flex items-center gap-1.5">
              <DateInput
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo || undefined}
                title="From date"
                className="h-[30px] px-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              <span className="text-[0.625rem] text-muted-foreground">→</span>
              <DateInput
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                title="To date"
                className="h-[30px] px-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  title="Clear date range"
                  className="h-[30px] flex items-center px-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}

          {!isVendorLedger && (
          <ExportMenu
            data={rows as unknown as Record<string, unknown>[]}
            fetchData={fetchAllForExport}
            columns={effectiveColumns}
            title={report.label}
            filename={report.id}
            disabled={loading || rows.length === 0}
          />
          )}
        </div>
      </div>

      {isVendorLedger ? (
        <div className="p-4">
          <VendorLedgerReportBody />
        </div>
      ) : (
        <>
      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading {report.label}…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <AlertCircle size={16} className="text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={load}
            className="text-xs underline hover:text-foreground"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <FileText size={16} />
          <p className="text-sm">No records found</p>
        </div>
      )}

      {/* GRN Register summary — recomputed from the currently-filtered rows */}
      {isGrnRegister && !loading && !error && rows.length > 0 && (
        (() => {
          const sum = (k: string) =>
            rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
          const cards: [string, string][] = [
            ["Total GRNs", String(rows.length)],
            ["Taxable Amount", fmt(sum("TaxableAmount"))],
            ["CGST", fmt(sum("CGSTAmount"))],
            ["SGST", fmt(sum("SGSTAmount"))],
            ["IGST", fmt(sum("IGSTAmount"))],
            ["Cess", fmt(sum("CessAmount"))],
            ["Total Tax", fmt(sum("TotalTaxAmount"))],
            ["Grand Total", fmt(sum("GrandTotal"))],
          ];
          return (
            <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border bg-muted/10">
              {cards.map(([label, value]) => (
                <div
                  key={label}
                  className="flex-1 min-w-[120px] rounded-lg border border-border bg-card px-3 py-2"
                >
                  <p className="text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider">
                    {label}
                  </p>
                  <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          );
        })()
      )}

      {/* Table (or, for Worker Attendance, the same grouped/collapsible log
          the Worker Attendance page itself uses) */}
      {!loading && !error && rows.length > 0 && (
        isWorkerAttendance ? (
          <WorkerAttendanceLogGroups rows={rows as unknown as AttendanceReportRow[]} />
        ) : isLedgerReport ? (
          <LedgerReportGroups
            rows={rows as unknown as Record<string, unknown>[]}
            onRowClick={setSelectedRow}
          />
        ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider w-8">
                    #
                  </th>
                  {effectiveColumns.map((col) => (
                    <th
                      key={col.header}
                      className="px-4 py-2.5 text-left text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {pageRows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => (onRowOpen ? onRowOpen(row) : setSelectedRow(row))}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {(page - 1) * PAGE_SIZE + i + 1}
                    </td>
                    {effectiveColumns.map((col) => (
                      <td
                        key={col.header}
                        className="px-4 py-2.5 text-xs text-foreground whitespace-nowrap max-w-[200px] truncate"
                      >
                        {cell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, recordCount)} of {recordCount.toLocaleString("en-IN")}
                {pageLoading && <Loader2 size={11} className="inline ml-2 animate-spin" />}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Prev
                </button>
                <span className="px-2">
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
        )
      )}
        </>
      )}
    </div>

    {/* ── Row detail card ── */}
    <Dialog open={!!selectedRow} onOpenChange={(o) => { if (!o) setSelectedRow(null); }}>
      <DialogContent className={onSheet ? "sheet-frame max-w-lg" : "max-w-lg"} style={onSheet ? { margin: 0 } : undefined}>
        <DialogHeader>
          <DialogTitle className={onSheet ? "font-heading text-lg font-bold tracking-tight pb-3 border-b border-foreground" : "flex items-center gap-2.5"}>
            {!onSheet && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${report.color}18` }}>
              <report.icon size={14} style={{ color: report.color }} />
            </div>
            )}
            {report.label}
          </DialogTitle>
        </DialogHeader>
        {chainLinks.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Open this activity in</p>
            <div className="flex flex-wrap gap-2">
              {chainLinks.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => {
                    setSelectedRow(null);
                    reportNavigate(l.to);
                  }}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedRow && (
          <div className="divide-y divide-border">
            {effectiveColumns.map((col) => {
              const val = cell(selectedRow, col);
              if (!val || val === "—") return null;
              return (
                <div key={col.header} className="flex items-start justify-between gap-6 py-2.5">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 w-28 pt-0.5">
                    {col.header}
                  </span>
                  <span className="text-sm text-foreground text-right break-all">
                    {val}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};
