// The work order register.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, Building2, User, Layers, AlertCircle, Eye, Search, RefreshCw, ChevronLeft, List, ClipboardList, TrendingUp, Boxes, BadgeCheck, Clock, Printer } from "lucide-react";
import { getWorkOrders } from "@/api/workOrderApi";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { printList } from "@/lib/printList";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { usePageRights } from "@/hooks/usePageRights";
import { WorkOrderListItem, fmt, ensureArray, getStatusConfig } from "./config";

const dateOf = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

// What Export and Print put out: the register's own columns, as plain values.
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "WO No", accessor: "DocumentNumber" },
  { header: "Date", accessor: (r) => dateOf(r.DocumentDate as string) },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Contractor", accessor: (r) => (r.ContractorName || r.SupplierName || "") as string },
  { header: "BOQ", accessor: "BoqDocNo" },
  { header: "Activities", accessor: (r) => Number(r.ActivityCount ?? 0) },
  { header: "Total Amount", accessor: (r) => Number(r.TotalAmount ?? 0) },
  { header: "Status", accessor: (r) => (r.Status || "Draft") as string },
];

// ─── VIEW: Work Orders List ───────────────────────────────────────────────────

export const WorkOrdersList: React.FC<{
  onViewDetail: (id: number) => void;
}> = ({ onViewDetail }) => {
  // Server-paged: the route filters by status and search and sends one page of LIMIT rows plus the
  // summary figures, so the list no longer depends on how many work orders exist.
  const [workOrders, setWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0, count: 0 });
  const LIMIT = 10;

  // Typing still filters as you type; the request waits for a short pause.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getWorkOrders({ page, limit: LIMIT, search: debouncedSearch, status: statusFilter });
      if (id !== reqId.current) return; // a newer request superseded this one
      setWorkOrders(ensureArray<WorkOrderListItem>(res));
      setFilteredTotal(Number(res?.total ?? 0));
      const st = res?.stats;
      if (st) setStats({ total: st.totalAmount, approved: st.approved, pending: st.pending, count: st.count });
    } catch {
      if (id === reqId.current) setError("Failed to load work orders.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const paginated = workOrders;

  // Export and Print cover every work order the search and status match, all pages (the server sends at most 100 at
  // a time), not just the page in view.
  const rights = usePageRights("work-order");
  const fetchAllWorkOrders = () =>
    fetchAllPages<Record<string, unknown>>((p, limit) => getWorkOrders({ page: p, limit, search: debouncedSearch, status: statusFilter }));
  const filterNote = [statusFilter !== "all" ? `Status: ${statusFilter}` : "", debouncedSearch ? `Search: ${debouncedSearch}` : ""].filter(Boolean).join(" · ");
  const [printing, setPrinting] = useState(false);
  const handlePrintList = async () => {
    setPrinting(true);
    try {
      printList({ title: "Work Orders", subtitle: filterNote || undefined, columns: EXPORT_COLUMNS, rows: await fetchAllWorkOrders(), numeric: ["Activities", "Total Amount"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the work orders to print.");
    } finally {
      setPrinting(false);
    }
  };
  const filteredPages = Math.ceil(filteredTotal / LIMIT);

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: approvalTrails, isLoading: approvalTrailsLoading } = useApprovalTrailsBulk(
    "WorkOrderHeader",
    paginated.map((wo) => wo.Id),
  );

  return (
    <div className="space-y-5">
      {/* Figures: server totals over every work order the filters match */}
      <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
        <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
          {[
            { label: "Work orders", value: String(stats.count), note: "matching the filters" },
            { label: "Value", value: fmt(stats.total), note: "rejected ones left out" },
            { label: "Approved", value: String(stats.approved), note: "in force" },
            { label: "Awaiting approval", value: String(stats.pending), note: "sent for approval" },
          ].map((x) => (
            <div key={x.label}>
              <p className="label">{x.label}</p>
              <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
              <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search orders…"
            className="w-full text-sm border border-foreground/30 pl-8 pr-3 py-2 bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="text-sm border border-foreground/30 pl-3 pr-8 py-2 bg-card text-foreground focus:outline-none transition wo-select-arrow"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 border border-foreground/30 text-sm text-muted-foreground hover:bg-primary/5 transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        <ExportMenu
          data={workOrders as unknown as Record<string, unknown>[]}
          fetchData={fetchAllWorkOrders}
          columns={EXPORT_COLUMNS}
          title="Work Orders"
          filename="work-orders"
          subtitle={filterNote || undefined}
          disabled={loading || filteredTotal === 0 || !rights.canExport}
        />
        {rights.canPrint && (
          <button
            onClick={handlePrintList}
            disabled={loading || printing || filteredTotal === 0}
            className="flex items-center gap-1.5 px-3 py-2 border border-foreground/30 text-sm text-muted-foreground hover:bg-primary/5 transition-colors disabled:opacity-40"
            title="Print the list"
          >
            <Printer size={13} />
            <span className="hidden sm:inline">{printing ? "Preparing…" : "Print"}</span>
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border border-destructive dark:border-destructive bg-destructive/10 dark:bg-destructive/10 px-4 py-3">
          <AlertCircle size={14} className="text-destructive shrink-0" />
          <p className="text-sm text-destructive dark:text-destructive">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="border border-foreground/30 bg-card overflow-hidden">
        {/* Desktop table header */}
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3 px-4 py-3 bg-card border-b border-foreground/30">
          {[
            "Document No.",
            "Company",
            "Project / Contractor",
            "BOQ",
            "Date",
            "Activities",
            "Amount",
            "Status",
            "Actions",
          ].map((h) => (
            <div
              key={h}
              className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {h}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-foreground/10">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => (
                    <div key={j} className="h-4 bg-card" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 bg-card flex items-center justify-center mb-4">
              <ClipboardList size={24} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {search || statusFilter !== "all"
                ? "No work orders match your filters"
                : "No work orders yet"}
            </p>
            {(search || statusFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setPage(1);
                }}
                className="mt-2 text-xs text-primary underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-foreground/10">
            {paginated.map((wo) => {
              const statusCfg = getStatusConfig(wo.Status);
              const dateStr = wo.DocumentDate
                ? new Date(wo.DocumentDate).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";

              return (
                <div key={wo.Id}>
                  {/* Mobile card */}
                  <div className="sm:hidden px-4 py-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-heading font-semibold text-primary">
                        {wo.DocumentNumber}
                      </span>
                      <ApprovalStatusChain
                        table="WorkOrderHeader"
                        recordId={wo.Id}
                        fallback={<StatusBadge status={wo.Status || "Draft"} />}
                        preloaded={approvalTrails.get(String(wo.Id)) ?? null}
                        preloadedLoading={approvalTrailsLoading}
                      />
                    </div>
                    <div className="text-xs space-y-1">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Building2 size={10} />
                        <span className="text-foreground font-medium">
                          {wo.CompanyName || "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Layers size={10} />
                        <span>{wo.ProjectName || "—"}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <User size={10} />
                        <span>{wo.ContractorName || "—"}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-foreground/30">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{dateStr}</span>
                        <span className="flex items-center gap-1">
                          <Boxes size={10} />
                          {wo.ActivityCount || 0} acts
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {fmt(wo.TotalAmount || 0)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button data-row-view
                            onClick={() => onViewDetail(wo.Id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                          >
                            <Eye size={11} />
                            View
                          </button>
                          <ApprovalActions
                            status={wo.Status || "Draft"}
                            recordId={wo.Id}
                            endpoint="/api/work-orders"
                            submitOnly
                            onSuccess={() => load()}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Desktop row */}
                  <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3 items-center px-4 py-3.5 hover:bg-primary/5 transition-colors group">
                    <div>
                      <p className="text-sm font-heading font-semibold text-primary">
                        {wo.DocumentNumber}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground mt-0.5 font-heading">
                        {(wo as any).DocNo || ""}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground">
                        #{wo.Id}
                      </p>
                    </div>
                    <div>
                      <p
                        className="text-sm font-medium text-foreground truncate"
                        title={wo.CompanyName}
                      >
                        {wo.CompanyName || "—"}
                      </p>
                    </div>
                    <div>
                      <p
                        className="text-sm text-foreground truncate"
                        title={wo.ProjectName}
                      >
                        {wo.ProjectName || "—"}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground truncate">
                        {wo.ContractorName || "—"}
                      </p>
                    </div>
                    <div>
                      {wo.BoqDocNo ? (
                        <span
                          className="text-[0.625rem] font-heading text-primary/80 bg-primary/5 border border-primary/15 px-1.5 py-0.5 truncate block"
                          title={wo.BoqDocNo}
                        >
                          {wo.BoqDocNo}
                        </span>
                      ) : (
                        <span className="text-[0.625rem] text-muted-foreground">
                          —
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {dateStr}
                    </div>
                    <div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Boxes size={11} />
                        {wo.ActivityCount || 0}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-foreground">
                      {fmt(wo.TotalAmount || 0)}
                    </div>
                    <div>
                      <span
                        className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold border w-fit ${statusCfg.cls}`}
                      >
                        {statusCfg.icon}
                        {wo.Status || "Draft"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button data-row-view
                        onClick={() => onViewDetail(wo.Id)}
                        title="View details"
                        className="w-8 h-8 flex items-center justify-center border border-foreground/30 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
                      >
                        <Eye size={14} />
                      </button>
                      <ApprovalActions
                        status={wo.Status || "Draft"}
                        recordId={wo.Id}
                        endpoint="/api/work-orders"
                        submitOnly
                        onSuccess={() => load()}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {filteredPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/30 bg-card">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * LIMIT + 1}–
              {Math.min(page * LIMIT, filteredTotal)} of {filteredTotal}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center border border-foreground/30 text-muted-foreground hover:bg-primary/5 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={13} />
              </button>
              {Array.from({ length: Math.min(5, filteredPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 flex items-center justify-center text-xs font-medium transition-colors ${
                      page === pageNum
                        ? "bg-foreground text-card border border-foreground"
                        : "border border-foreground/30 text-muted-foreground hover:bg-primary/5"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(filteredPages, p + 1))}
                disabled={page === filteredPages}
                className="w-7 h-7 flex items-center justify-center border border-foreground/30 text-muted-foreground hover:bg-primary/5 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
