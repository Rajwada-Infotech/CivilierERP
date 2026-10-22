// The work order register.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, Building2, User, Layers, AlertCircle, Eye, Search, RefreshCw, ChevronLeft, List, ClipboardList, TrendingUp, Boxes, BadgeCheck, Clock } from "lucide-react";
import { getWorkOrders } from "@/api/workOrderApi";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { WorkOrderListItem, fmt, ensureArray, getStatusConfig } from "./config";

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
  const filteredPages = Math.ceil(filteredTotal / LIMIT);

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: approvalTrails, isLoading: approvalTrailsLoading } = useApprovalTrailsBulk(
    "WorkOrderHeader",
    paginated.map((wo) => wo.Id),
  );

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total Orders",
            value: String(stats.count),
            icon: <ClipboardList size={14} />,
            color: "text-primary",
          },
          {
            label: "Total Value",
            value: fmt(stats.total),
            icon: <TrendingUp size={14} />,
            color: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Approved",
            value: String(stats.approved),
            icon: <BadgeCheck size={14} />,
            color: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Pending",
            value: String(stats.pending),
            icon: <Clock size={14} />,
            color: "text-amber-600 dark:text-amber-400",
          },
        ].map(({ label, value, icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1 ${color}`}
            >
              {icon}
              {label}
            </div>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
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
            className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-lg border border-border pl-3 pr-8 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition wo-select-arrow"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Desktop table header */}
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3 px-4 py-3 bg-muted/30 border-b border-border">
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
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => (
                    <div key={j} className="h-4 bg-muted rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
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
          <div className="divide-y divide-border">
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
                      <span className="text-sm font-mono font-semibold text-primary">
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
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
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
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
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
                  <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_90px_100px_90px_100px_80px_120px] gap-3 items-center px-4 py-3.5 hover:bg-muted/20 transition-colors group">
                    <div>
                      <p className="text-sm font-mono font-semibold text-primary">
                        {wo.DocumentNumber}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground mt-0.5 font-mono">
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
                          className="text-[0.625rem] font-mono text-primary/80 bg-primary/5 border border-primary/15 px-1.5 py-0.5 rounded truncate block"
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
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border w-fit ${statusCfg.cls}`}
                      >
                        {statusCfg.icon}
                        {wo.Status || "Draft"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button data-row-view
                        onClick={() => onViewDetail(wo.Id)}
                        title="View details"
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * LIMIT + 1}–
              {Math.min(page * LIMIT, filteredTotal)} of {filteredTotal}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={13} />
              </button>
              {Array.from({ length: Math.min(5, filteredPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 flex items-center justify-center rounded-md text-xs font-medium transition-colors ${
                      page === pageNum
                        ? "btn-module text-white"
                        : "border border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(filteredPages, p + 1))}
                disabled={page === filteredPages}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
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
