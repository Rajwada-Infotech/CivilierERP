import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import React, { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { TicketShell } from "@/components/ticket/TicketShell";
import { SheetSection, SheetStats } from "@/components/sheet/sheetParts";
import { AlertCircle, CheckCircle2, MessageSquare, Plus, RefreshCw } from "lucide-react";

import { isPrivilegedRole } from "@/contexts/auth.utils";
// ─── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  issue_details: string;
  customer_name: string;
  customer_phone: string;
  company_id: number | null;
  project_id: number | null;
  attachment_path: string | null;
  status: "Pending" | "InProgress" | "Resolved" | "Closed";
  created_at?: string;
}

const ACCENT = "hsl(var(--foreground))";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Sub-components ───────────────────────────────────────────────────────────

// A column's heading: its name on the sheet's rule, with a link to the full list.
function ColumnHead({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-2" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h3 className="label" style={{ color: "var(--ink)", margin: 0 }}>{title}</h3>
        {sub && <span className="hidden sm:inline truncate" style={{ fontSize: 11.5, color: "var(--graphite)" }}>{sub}</span>}
      </div>
      {action && onAction && (
        <button onClick={onAction} className="label link shrink-0">
          {action}
        </button>
      )}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="py-3" style={{ fontSize: 13, color: "var(--graphite)", borderBottom: "1px solid var(--rule-soft)" }}>{label}</p>;
}

// One measured line: name, count and share, and a square bar under them.
function Measure({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="py-2.5" style={{ borderBottom: "1px solid var(--rule-soft)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: 12, color: "var(--graphite)" }}>
          <span className="font-heading" style={{ fontWeight: 600, color: "var(--ink)" }}>{count}</span> · {pct}%
        </span>
      </div>
      <div className="mt-2 h-1 bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TableSkeleton({
  rows = 4,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-6 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

const priorityConfig: Record<
  string,
  { label: string; cls: string; bar: string }
> = {
  Urgent: {
    label: "Urgent",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
    bar: "bg-destructive",
  },
  High: {
    label: "High",
    cls: "bg-foreground/10 text-foreground border-foreground/20",
    bar: "bg-foreground",
  },
  Medium: {
    label: "Medium",
    cls: "bg-muted text-muted-foreground border-border",
    bar: "bg-muted-foreground",
  },
  Low: {
    label: "Low",
    cls: "bg-primary/10 text-primary border-primary/20",
    bar: "bg-primary",
  },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? {
    label: priority,
    cls: "bg-muted text-muted-foreground border-border",
    bar: "bg-muted",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-medium border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Resolved"
      ? "bg-foreground/10 text-foreground border-foreground/20"
      : status === "InProgress"
        ? "bg-primary/10 text-primary border-primary/20"
        : "bg-muted text-muted-foreground border-border";
  const label = status === "InProgress" ? "Resolving" : status;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-medium border ${cls}`}
    >
      {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TicketDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const rights = usePageRights("tickets");
  const isAdmin = isPrivilegedRole(currentUser?.role);
  const canSeeAllTickets = isAdmin || currentUser?.role === "engineer";

  const {
    data: tickets = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Ticket[]>({
    queryKey: ["ticket-dashboard", isAdmin ? "all" : "my"],
    queryFn: async () => {
      const endpoint = canSeeAllTickets ? "/api/tickets?limit=100" : "/api/tickets/mine";
      const res = await fetchWithAuth(endpoint);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const payload = await res.json().catch(() => ({}));
      return unwrapTicketList<Ticket>(payload).data;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 1,
  });

  useTicketSync(refetch);

  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${id}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: "Resolved from dashboard" }),
      });
      if (!res.ok) throw new Error("Failed to resolve ticket");
    },
    onSuccess: () => {
      toast.success("Ticket resolved");
      invalidateTicketQueries(queryClient);
    },
    onError: () => toast.error("Failed to resolve ticket"),
  });

  // ── Derived stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = tickets.length;
    const pending = tickets.filter((t) => t.status === "Pending").length;
    const inProgress = tickets.filter((t) => t.status === "InProgress").length;
    const resolved = tickets.filter((t) => t.status === "Resolved").length;
    const closed = tickets.filter((t) => t.status === "Closed").length;
    const openStatuses = ["Pending", "InProgress"];
    const urgent = tickets.filter(
      (t) => t.priority === "Urgent" && openStatuses.includes(t.status),
    ).length;
    const high = tickets.filter(
      (t) => t.priority === "High" && openStatuses.includes(t.status),
    ).length;
    const resolvedPct = total > 0 ? Math.round((resolved / total) * 100) : 0;

    const priorityCounts: Record<string, number> = {
      Urgent: 0,
      High: 0,
      Medium: 0,
      Low: 0,
    };
    tickets
      .filter((t) => openStatuses.includes(t.status))
      .forEach((t) => {
        if (t.priority in priorityCounts) priorityCounts[t.priority]++;
      });

    const recentPending = tickets
      .filter((t) => ["Pending", "InProgress"].includes(t.status))
      .slice(0, 6);
    const recentResolved = tickets
      .filter((t) => t.status === "Resolved")
      .slice(0, 6);

    return {
      total,
      pending,
      inProgress,
      resolved,
      closed,
      urgent,
      high,
      resolvedPct,
      priorityCounts,
      recentPending,
      recentResolved,
    };
  }, [tickets]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Tickets"]} />
      <TicketShell
        title="Ticket Overview"
        subtitle="Track, manage and resolve support tickets across all projects"
        icon={MessageSquare}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/ticket/create")}
              className={`${KEY_INK} h-9 px-4`}
            >
              <Plus size={15} />
              New Ticket
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className={`group ${KEY_LINE} h-9 px-4`}
            >
              <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
              Refresh
            </button>
          </div>
        }
      >
        {/* ── Error banner ────────────────────────────────────────────────── */}
        {isError && !tickets.length && (
          <div className="px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load ticket data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}.
            Please refresh.
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <SheetSection tag="A" title="Overview">
          <SheetStats
            loading={isLoading}
            items={[
              { label: "Total Tickets", value: stats.total, note: `${stats.resolvedPct}% resolved`, onClick: () => navigate("/ticket/my-tickets") },
              { label: "Pending", value: stats.pending + stats.inProgress, note: `${stats.urgent} urgent · ${stats.high} high priority`, onClick: () => navigate("/ticket/pending") },
              { label: "Resolved", value: stats.resolved, note: `${stats.resolvedPct}% of all tickets`, onClick: () => navigate("/ticket/resolved") },
              { label: "Urgent / High", value: stats.urgent + stats.high, red: stats.urgent + stats.high > 0, note: `${stats.urgent} urgent · ${stats.high} high`, onClick: () => navigate("/ticket/pending") },
            ]}
          />
        </SheetSection>

        {/* ── Priority breakdown + Resolution rate ────────────────────────── */}
        {!isLoading && (
          <SheetSection tag="B" title="At a Glance">
            <SheetStats
              items={[
                { label: "Resolution Rate", value: `${stats.resolvedPct}%` },
                { label: "Open Tickets", value: stats.pending + stats.inProgress },
                { label: "Critical (Urgent + High)", value: stats.urgent + stats.high, red: stats.urgent + stats.high > 0 },
              ]}
            />
          </SheetSection>
        )}

        {/* ── Pending + Resolved tables ───────────────────────────────────── */}
        <SheetSection tag="C" title="Recent Activity">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
            <div className="min-w-0">
              <ColumnHead title="Pending Tickets" sub="Awaiting resolution" action="View all" onAction={() => navigate("/ticket/pending")} />
              {isLoading ? (
                <TableSkeleton rows={4} cols={4} />
              ) : !stats.recentPending.length ? (
                <EmptyRow label="No pending tickets." />
              ) : (
                stats.recentPending.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 hover:bg-primary/10 transition-colors group" style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{t.subject}</p>
                      <p className="truncate mt-0.5" style={{ fontSize: 11.5, color: "var(--graphite)" }}>
                        {t.customer_name || "—"}
                        {t.created_at ? ` · ${fmtDate(t.created_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge priority={t.priority} />
                      <button
                        onClick={() => resolveMutation.mutate(t.id)}
                        disabled={resolveMutation.isPending}
                        title="Mark as resolved"
                        className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="min-w-0">
              <ColumnHead title="Recently Resolved" sub="Last 6 closures" action="View all" onAction={() => navigate("/ticket/resolved")} />
              {isLoading ? (
                <TableSkeleton rows={4} cols={4} />
              ) : !stats.recentResolved.length ? (
                <EmptyRow label="No resolved tickets yet." />
              ) : (
                stats.recentResolved.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 hover:bg-primary/10 transition-colors" style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{t.subject}</p>
                      <p className="truncate mt-0.5" style={{ fontSize: 11.5, color: "var(--graphite)" }}>
                        {t.customer_name || "—"}
                        {t.created_at ? ` · ${fmtDate(t.created_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </SheetSection>

        <SheetSection tag="D" title="Breakdown">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
            <div className="min-w-0">
              <ColumnHead title="Pending by Priority" sub="Open tickets only" />
              {isLoading ? (
                <TableSkeleton rows={4} cols={1} />
              ) : (
                <>
                  {(["Urgent", "High", "Medium", "Low"] as const).map((p) => {
                    const count = stats.priorityCounts[p] ?? 0;
                    const open = stats.pending + stats.inProgress;
                    return <Measure key={p} label={p} count={count} pct={open > 0 ? Math.round((count / open) * 100) : 0} color={priorityConfig[p].bar} />;
                  })}
                  <p className="pt-2.5" style={{ fontSize: 11.5, color: "var(--graphite)" }}>
                    {stats.pending + stats.inProgress} total open · {stats.total} total
                  </p>
                </>
              )}
            </div>

            <div className="min-w-0">
              <ColumnHead title="Status Overview" />
              {isLoading ? (
                <TableSkeleton rows={4} cols={1} />
              ) : (
                <>
                  {[
                    { label: "Pending", count: stats.pending, color: "bg-muted-foreground" },
                    { label: "Resolving", count: stats.inProgress, color: "bg-primary" },
                    { label: "Resolved", count: stats.resolved, color: "bg-foreground" },
                    { label: "Closed", count: stats.closed, color: "bg-muted-foreground" },
                  ].map(({ label, count, color }) => (
                    <Measure key={label} label={label} count={count} pct={stats.total > 0 ? Math.round((count / stats.total) * 100) : 0} color={color} />
                  ))}
                  <p className="pt-2.5" style={{ fontSize: 11.5, color: "var(--graphite)" }}>
                    {stats.resolvedPct}% resolution rate · {stats.total} total
                  </p>
                </>
              )}
            </div>
          </div>
        </SheetSection>

        <SheetSection tag="E" title="Go to">
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {[
              { label: "Create Ticket", path: "/ticket/create" },
              { label: "My Tickets", path: "/ticket/my-tickets" },
              { label: "Pending", path: "/ticket/pending" },
              { label: "Resolved", path: "/ticket/resolved" },
            ].map((q) => (
              <button key={q.path} type="button" onClick={() => navigate(q.path)} style={{ padding: "9px 16px" }}>{q.label}</button>
            ))}
          </div>
        </SheetSection>
      </TicketShell>
    </>
  );
}