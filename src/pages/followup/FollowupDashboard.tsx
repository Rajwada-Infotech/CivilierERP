import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { useTask } from "@/contexts/TaskContext";
import {
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Activity,
  FileText,
  Mail,
  Phone,
  ListTodo,
  BellRing,
  Users,
  BarChart3,
  Calendar,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Status badge ─────────────────────────────────────────────────────────────
const taskStatusColors: Record<string, string> = {
  open: "bg-slate-500/10 text-slate-600 border-slate-400/20",
  in_progress: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  closed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  reviewed: "bg-purple-500/10 text-purple-600 border-purple-400/20",
};

const reminderStatusColors: Record<string, string> = {
  overdue: "bg-red-500/10 text-red-500 border-red-400/20",
  scheduled: "bg-indigo-500/10 text-indigo-600 border-indigo-400/20",
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
};

function StatusBadge({
  status,
  map,
}: {
  status: string;
  map: Record<string, string>;
}) {
  const cls = map[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      {status || "—"}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-indigo-600",
  iconBg = "bg-indigo-500/10",
  trend,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-border bg-card p-5 flex flex-col gap-3 transition-all duration-200 ${
        onClick
          ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
          : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
        {trend && (
          <span
            className={`text-[10px] font-medium flex items-center gap-0.5 ${
              trend === "up"
                ? "text-emerald-600"
                : trend === "down"
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {trend === "up" ? (
              <ArrowUpRight size={12} />
            ) : trend === "down" ? (
              <ArrowDownRight size={12} />
            ) : null}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-heading font-bold text-foreground leading-none">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
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
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-indigo-600" />
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            {title}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          {action} <ArrowUpRight size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <AlertCircle size={28} className="opacity-30" />
      <p className="text-xs">{label}</p>
    </div>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────
function TableSkeleton({
  rows = 4,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="p-4 space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────
function StatusBreakdown({
  data,
  label,
  barColor = "bg-indigo-500",
}: {
  data: { status: string; count: number }[];
  label: string;
  barColor?: string;
}) {
  if (!data?.length)
    return <p className="text-xs text-muted-foreground py-2">No {label} yet</p>;
  const total = data.reduce((s, r) => s + Number(r.count), 0);
  return (
    <div className="space-y-2 mt-3">
      {data.map((row) => {
        const pct =
          total > 0 ? Math.round((Number(row.count) / total) * 100) : 0;
        return (
          <div key={row.status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span className="capitalize">
                {row.status.replace("_", " ") || "—"}
              </span>
              <span className="font-medium text-foreground">{row.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Log type icon ────────────────────────────────────────────────────────────
function logIcon(type: string) {
  switch (type) {
    case "email":
      return Mail;
    case "call":
      return Phone;
    case "payment":
      return CheckCircle2;
    default:
      return FileText;
  }
}

// ─── Dashboard Component ──────────────────────────────────────────────────────
export default function FollowupDashboard() {
  const navigate = useNavigate();
  const { tasks, getOverdueTasks, getDueSoonTasks } = useTask();

  // Live task stats from TaskContext
  const followupTasks = tasks.filter((t) => t.module === "followup");
  const overdueTasks = getOverdueTasks();
  const dueSoonTasks = getDueSoonTasks();
  const completedTasks = followupTasks.filter(
    (t) => t.status === "closed" || t.status === "reviewed",
  );
  const pendingTasks = followupTasks.filter((t) =>
    ["open", "in_progress"].includes(t.status),
  );

  // Fetch reminders from API
  const {
    data: remindersData,
    isLoading: remindersLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["followup-dashboard-reminders"],
    queryFn: () =>
      fetchWithAuth("/api/tenant-reminders")
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : d.data || [])),
    staleTime: 2 * 60 * 1000,
  });

  // Fetch follow-up log
  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ["followup-dashboard-log"],
    queryFn: () => fetchWithAuth("/api/followup-log").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const reminders = remindersData ?? [];
  const logs = logData ?? [];

  const overdueReminders = reminders.filter(
    (r: any) => r.status === "overdue",
  ).length;
  const scheduledReminders = reminders.filter(
    (r: any) => r.status === "scheduled",
  ).length;
  const sentReminders = reminders.filter(
    (r: any) => r.status === "sent",
  ).length;

  // Task status breakdown
  const taskStatusBreakdown = ["open", "in_progress", "closed", "reviewed"].map(
    (s) => ({
      status: s,
      count: followupTasks.filter((t) => t.status === s).length,
    }),
  );

  // Reminder status breakdown
  const reminderStatusBreakdown = ["overdue", "scheduled", "sent"].map((s) => ({
    status: s,
    count: reminders.filter((r: any) => r.status === s).length,
  }));

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Breadcrumbs items={[{ label: "Follow-Up", path: "/followup" }]} />
            <div className="flex items-center gap-3 mt-1">
              <div className="p-2 rounded-lg bg-indigo-500/10">
                <Activity size={20} className="text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  Follow-Up Dashboard
                </h1>
                <p className="text-xs text-muted-foreground">
                  Tasks, reminders, and communication activity across projects
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Overdue Tasks"
            value={fmtNum(overdueTasks.length)}
            sub={`${fmtNum(followupTasks.length)} total tasks`}
            icon={AlertCircle}
            iconColor="text-red-600"
            iconBg="bg-red-500/10"
            trend={overdueTasks.length > 0 ? "down" : "neutral"}
            onClick={() => navigate("/followup/follow-ups/tasks")}
          />
          <StatCard
            label="Due Soon"
            value={fmtNum(dueSoonTasks.length)}
            sub="Within next 3 days"
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-500/10"
            trend={dueSoonTasks.length > 0 ? "down" : "neutral"}
            onClick={() => navigate("/followup/follow-ups/tasks")}
          />
          <StatCard
            label="Completed Tasks"
            value={fmtNum(completedTasks.length)}
            sub={`${fmtNum(pendingTasks.length)} still pending`}
            icon={CheckCircle2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
            trend="up"
            onClick={() => navigate("/followup/follow-ups/tasks")}
          />
          <StatCard
            label="Active Reminders"
            value={fmtNum(reminders.length)}
            sub={`${overdueReminders} overdue · ${scheduledReminders} scheduled`}
            icon={Bell}
            iconColor="text-indigo-600"
            iconBg="bg-indigo-500/10"
            trend={overdueReminders > 0 ? "down" : "neutral"}
            onClick={() => navigate("/followup/follow-ups/reminders")}
          />
        </div>

        {/* Secondary metric strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Open Tasks",
              value: fmtNum(
                followupTasks.filter((t) => t.status === "open").length,
              ),
              icon: ListTodo,
              color: "text-slate-600",
            },
            {
              label: "In Progress",
              value: fmtNum(
                followupTasks.filter((t) => t.status === "in_progress").length,
              ),
              icon: Activity,
              color: "text-blue-600",
            },
            {
              label: "Reminders Sent",
              value: fmtNum(sentReminders),
              icon: BellRing,
              color: "text-emerald-600",
            },
            {
              label: "Log Entries",
              value: fmtNum(logs.length),
              icon: FileText,
              color: "text-purple-600",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3"
            >
              <s.icon size={18} className={s.color} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-sm font-heading font-bold text-foreground">
                  {s.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Tasks + Recent Reminders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Tasks */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={ListTodo}
                title="Recent Follow-up Tasks"
                sub="Latest open & in-progress"
                action="View all"
                onAction={() => navigate("/followup/follow-ups/tasks")}
              />
            </div>
            {followupTasks.length === 0 ? (
              <EmptyState label="No follow-up tasks yet" />
            ) : (
              <div className="divide-y divide-border">
                {followupTasks.slice(0, 6).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        task.status === "closed" || task.status === "reviewed"
                          ? "bg-emerald-500"
                          : task.status === "in_progress"
                            ? "bg-blue-500"
                            : "bg-slate-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-1">
                        {task.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                        {task.description || "No description"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-[10px] text-muted-foreground">
                        {task.dueDate ? fmtDate(task.dueDate) : "—"}
                      </p>
                      <StatusBadge
                        status={task.status}
                        map={taskStatusColors}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Reminders */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Bell}
                title="Active Reminders"
                sub="From TenantReminders"
                action="View all"
                onAction={() => navigate("/followup/follow-ups/reminders")}
              />
            </div>
            {remindersLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : reminders.length === 0 ? (
              <EmptyState label="No reminders yet" />
            ) : (
              <div className="divide-y divide-border">
                {reminders.slice(0, 6).map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-1">
                        {r.tenantName || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {r.module ? `Module: ${r.module}` : "General reminder"}
                        {r.amountDue != null
                          ? ` · Rs ${Number(r.amountDue).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-[10px] text-muted-foreground">
                        {fmtDate(r.dueDate)}
                      </p>
                      <StatusBadge
                        status={r.status}
                        map={reminderStatusColors}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Log + Status Breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Follow-up Log */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={FileText}
                title="Recent Activity Log"
                sub="Last communication entries"
                action="View all"
                onAction={() => navigate("/followup/follow-ups/log")}
              />
            </div>
            {logLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : logs.length === 0 ? (
              <EmptyState label="No log entries yet" />
            ) : (
              <div className="divide-y divide-border">
                {logs.slice(0, 6).map((entry: any) => {
                  const TypeIcon = logIcon(entry.type);
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <TypeIcon size={13} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-1">
                          {entry.customer || "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                          {entry.notes || "No notes"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground">
                          {fmtDate(entry.date)}
                        </p>
                        <span className="text-[10px] font-medium capitalize text-foreground">
                          {entry.type}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Breakdowns Column */}
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader
                icon={ListTodo}
                title="Task Status Breakdown"
                onAction={() => navigate("/followup/follow-ups/tasks")}
              />
              <StatusBreakdown
                data={taskStatusBreakdown}
                label="tasks"
                barColor="bg-indigo-500"
              />
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader
                icon={Bell}
                title="Reminder Status"
                onAction={() => navigate("/followup/follow-ups/reminders")}
              />
              {remindersLoading ? (
                <div className="space-y-2 animate-pulse">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-5 bg-muted rounded" />
                  ))}
                </div>
              ) : (
                <StatusBreakdown
                  data={reminderStatusBreakdown}
                  label="reminders"
                  barColor="bg-amber-500"
                />
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={BarChart3} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {[
              {
                label: "Tasks",
                icon: ListTodo,
                path: "/followup/follow-ups/tasks",
                color: "text-indigo-600",
                bg: "bg-indigo-500/10",
              },
              {
                label: "Follow-Up Log",
                icon: FileText,
                path: "/followup/follow-ups/log",
                color: "text-purple-600",
                bg: "bg-purple-500/10",
              },
              {
                label: "Reminders",
                icon: BellRing,
                path: "/followup/follow-ups/reminders",
                color: "text-amber-600",
                bg: "bg-amber-500/10",
              },
              {
                label: "All Tasks",
                icon: Calendar,
                path: "/tasks",
                color: "text-emerald-600",
                bg: "bg-emerald-500/10",
              },
            ].map(({ label, icon: Icon, path, color, bg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
              >
                <div
                  className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}
                >
                  <Icon size={16} className={color} />
                </div>
                <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}