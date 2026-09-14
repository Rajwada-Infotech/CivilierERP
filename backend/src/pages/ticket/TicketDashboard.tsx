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
import {
  GlassShell,
  GlassCard,
  GlassSection,
  GlassCardSkeleton,
} from "@/components/dashboard/GlassShell";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Flame,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldAlert,
  Tag,
  User,
} from "lucide-react";

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

const ACCENT = "#ec4899"; // pink — matches Ticket's ModuleStrip color
const SECONDARY = "#8b5cf6"; // violet bloom

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

function SectionHeader({
  icon: Icon,
  title,
  sub,
  action,
  onAction,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2.5">
        <Icon size={16} className="text-muted-foreground" />
        <span className="text-sm font-heading font-semibold text-foreground">
          {title}
        </span>
        {sub && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {sub}
          </span>
        )}
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-xs text-primary hover:underline font-heading"
        >
          {action} →
        </button>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <ClipboardList size={28} className="mb-2 opacity-30" />
      <span className="text-xs">{label}</span>
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
    cls: "bg-red-500/10 text-red-600 border-red-400/20",
    bar: "bg-red-500",
  },
  High: {
    label: "High",
    cls: "bg-orange-500/10 text-orange-600 border-orange-400/20",
    bar: "bg-orange-500",
  },
  Medium: {
    label: "Medium",
    cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",
    bar: "bg-amber-500",
  },
  Low: {
    label: "Low",
    cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",
    bar: "bg-blue-500",
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
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Resolved"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
      : status === "InProgress"
        ? "bg-blue-500/10 text-blue-600 border-blue-400/20"
        : "bg-amber-500/10 text-amber-600 border-amber-400/20";
  const label = status === "InProgress" ? "Resolving" : status;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
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
  const ADMIN_ROLES = ["super_admin", "admin", "dba"];
  const isAdmin = ADMIN_ROLES.includes(currentUser?.role ?? "");
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
      <GlassShell
        title="Ticket Overview"
        subtitle="Track, manage and resolve support tickets across all projects"
        icon={MessageSquare}
        accentColor={ACCENT}
        secondaryColor={SECONDARY}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/ticket/create")}
              className="flex items-center gap-2 h-9 px-4 text-sm rounded-lg gradient-accent text-white shadow-sm font-heading font-semibold"
            >
              <Plus size={15} />
              New Ticket
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 active:scale-90 disabled:opacity-50"
              style={{ borderColor: `${ACCENT}4d`, color: ACCENT }}
            >
              <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
              Refresh
            </button>
          </div>
        }
      >
        {/* ── Error banner ────────────────────────────────────────────────── */}
        {isError && !tickets.length && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load ticket data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}.
            Please refresh.
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <GlassSection title="Overview" icon={MessageSquare} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <GlassCardSkeleton key={i} />)
              : [
                  {
                    label: "Total Tickets",
                    value: stats.total,
                    sub: `${stats.resolvedPct}% resolved`,
                    icon: MessageSquare,
                    accentColor: SECONDARY,
                    onClick: () => navigate("/ticket/my-tickets"),
                  },
                  {
                    label: "Pending",
                    value: stats.pending + stats.inProgress,
                    sub: `${stats.urgent} urgent · ${stats.high} high priority`,
                    icon: Clock,
                    accentColor: "#f59e0b",
                    trend: (stats.pending + stats.inProgress > 0 ? "down" : "neutral") as "down" | "neutral" | "up",
                    onClick: () => navigate("/ticket/pending"),
                  },
                  {
                    label: "Resolved",
                    value: stats.resolved,
                    sub: `${stats.resolvedPct}% of all tickets`,
                    icon: CheckCircle2,
                    accentColor: "#10b981",
                    trend: "up" as const,
                    onClick: () => navigate("/ticket/resolved"),
                  },
                  {
                    label: "Urgent / High",
                    value: stats.urgent + stats.high,
                    sub: `${stats.urgent} urgent · ${stats.high} high`,
                    icon: Flame,
                    accentColor: "#ef4444",
                    trend: (stats.urgent + stats.high > 0 ? "down" : "neutral") as "down" | "neutral" | "up",
                    onClick: () => navigate("/ticket/pending"),
                  },
                ].map((s) => <GlassCard key={s.label} {...s} />)}
          </div>
        </GlassSection>

        {/* ── Priority breakdown + Resolution rate ────────────────────────── */}
        {!isLoading && (
          <GlassSection title="At a Glance" icon={BarChart3} accentColor={ACCENT}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <GlassCard
                label="Resolution Rate"
                value={`${stats.resolvedPct}%`}
                icon={CheckCircle2}
                accentColor="#10b981"
              />
              <GlassCard
                label="Open Tickets"
                value={stats.pending + stats.inProgress}
                icon={Clock}
                accentColor="#f59e0b"
              />
              <GlassCard
                label="Critical (Urgent + High)"
                value={stats.urgent + stats.high}
                icon={ShieldAlert}
                accentColor="#ef4444"
              />
            </div>
          </GlassSection>
        )}

        {/* ── Pending + Resolved tables ───────────────────────────────────── */}
        <GlassSection title="Recent Activity" icon={Clock} accentColor={ACCENT}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pending tickets */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <SectionHeader
                icon={Clock}
                title="Pending Tickets"
                sub="Awaiting resolution"
                action="View all"
                onAction={() => navigate("/ticket/pending")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !stats.recentPending.length ? (
              <EmptyState label="No pending tickets — all clear!" />
            ) : (
              <div className="divide-y divide-border">
                {stats.recentPending.map((t) => (
                  <div
                    key={t.id}
                    className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {t.subject}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <User
                          size={10}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="text-[11px] text-muted-foreground truncate">
                          {t.customer_name || "—"}
                        </span>
                        {t.created_at && (
                          <span className="text-[11px] text-muted-foreground hidden sm:inline">
                            · {fmtDate(t.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge priority={t.priority} />
                      <button
                        onClick={() => resolveMutation.mutate(t.id)}
                        disabled={resolveMutation.isPending}
                        title="Mark as resolved"
                        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resolved tickets */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <SectionHeader
                icon={CheckCircle2}
                title="Recently Resolved"
                sub="Last 6 closures"
                action="View all"
                onAction={() => navigate("/ticket/resolved")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !stats.recentResolved.length ? (
              <EmptyState label="No resolved tickets yet" />
            ) : (
              <div className="divide-y divide-border">
                {stats.recentResolved.map((t) => (
                  <div
                    key={t.id}
                    className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {t.subject}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <User
                          size={10}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="text-[11px] text-muted-foreground truncate">
                          {t.customer_name || "—"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </GlassSection>

        {/* ── Priority breakdown + Quick actions ─────────────────────────── */}
        <GlassSection title="Breakdown & Actions" icon={Tag} accentColor={ACCENT}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Priority breakdown */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={Tag}
              title="Pending by Priority"
              sub="open tickets only"
            />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : stats.pending + stats.inProgress === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No pending tickets
              </p>
            ) : (
              <div className="space-y-2">
                {(["Urgent", "High", "Medium", "Low"] as const).map((p) => {
                  const count = stats.priorityCounts[p] ?? 0;
                  const pct =
                    stats.pending + stats.inProgress > 0
                      ? Math.round(
                          (count / (stats.pending + stats.inProgress)) * 100,
                        )
                      : 0;
                  const cfg = priorityConfig[p];
                  return (
                    <div key={p} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-medium">{p}</span>
                        <span className="text-muted-foreground">
                          {count} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cfg.bar} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1">
                  {stats.pending + stats.inProgress} total open · {stats.total}{" "}
                  total
                </p>
              </div>
            )}
          </div>

          {/* Status overview */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader icon={BarChart3} title="Status Overview" />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  {
                    label: "Pending",
                    count: stats.pending,
                    color: "bg-amber-500",
                  },
                  {
                    label: "Resolving",
                    count: stats.inProgress,
                    color: "bg-blue-500",
                  },
                  {
                    label: "Resolved",
                    count: stats.resolved,
                    color: "bg-emerald-500",
                  },
                  {
                    label: "Closed",
                    count: stats.closed,
                    color: "bg-muted-foreground",
                  },
                ].map(({ label, count, color }) => {
                  const pct =
                    stats.total > 0
                      ? Math.round((count / stats.total) * 100)
                      : 0;
                  return (
                    <div key={label} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-medium">
                          {label}
                        </span>
                        <span className="text-muted-foreground">
                          {count} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${color} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1">
                  {stats.resolvedPct}% resolution rate · {stats.total} total
                </p>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader icon={BarChart3} title="Quick Actions" />
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Create Ticket",
                  icon: Plus,
                  path: "/ticket/create",
                  color: "text-violet-600",
                  bg: "bg-violet-500/10",
                },
                {
                  label: "My Tickets",
                  icon: FileText,
                  path: "/ticket/my-tickets",
                  color: "text-blue-600",
                  bg: "bg-blue-500/10",
                },
                {
                  label: "Pending",
                  icon: Clock,
                  path: "/ticket/pending",
                  color: "text-amber-600",
                  bg: "bg-amber-500/10",
                },
                {
                  label: "Resolved",
                  icon: CheckCircle2,
                  path: "/ticket/resolved",
                  color: "text-emerald-600",
                  bg: "bg-emerald-500/10",
                },
              ].map(({ label, icon: Icon, path, color, bg }) => (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className="flex flex-col items-center gap-2.5 py-4 px-2 rounded-2xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
                >
                  <div
                    className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}
                  >
                    <Icon size={15} className={color} />
                  </div>
                  <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}