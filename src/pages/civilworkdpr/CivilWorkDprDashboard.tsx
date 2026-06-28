import React from "react";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Pickaxe,
  ClipboardList,
  Hammer,
  Users,
  RefreshCw,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Wrench,
  BarChart3,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

// ─── Status badge ─────────────────────────────────────────────────────────────
const statusColors: Record<string, string> = {
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Draft: "bg-muted text-muted-foreground border-border",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    statusColors[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      {status || "Draft"}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-cyan-600",
  iconBg = "bg-cyan-500/10",
  borderL = "border-l-cyan-500",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  borderL?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col gap-3 transition-all duration-200 border-l-2 ${borderL} ${
        onClick
          ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
          : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-heading font-bold text-foreground leading-none">
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
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-cyan-600 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-heading font-semibold text-foreground truncate">
            {title}
          </p>
          {sub && (
            <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
          )}
        </div>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5 shrink-0"
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
      <p className="text-xs text-center px-4">{label}</p>
    </div>
  );
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────
function StatusBreakdown({
  data,
  label,
}: {
  data: { status: string; count: number }[];
  label: string;
}) {
  if (!data?.length)
    return <p className="text-xs text-muted-foreground py-2">No {label} yet</p>;
  const total = data.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-2 mt-3">
      {data.map((row) => {
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
        return (
          <div key={row.status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{row.status || "Draft"}</span>
              <span className="font-medium text-foreground">{row.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Mock placeholder data (no backend endpoint wired up yet) ────────────────
const MOCK_TASKS = [
  { id: "IW-0001", title: "Site fencing repair", status: "In Progress" },
  { id: "IW-0002", title: "Internal audit walk-through", status: "Pending" },
  { id: "IW-0003", title: "Tool inventory recount", status: "Completed" },
  { id: "IW-0004", title: "Storeroom reorganization", status: "Draft" },
];

const MOCK_STATUS_BREAKDOWN = [
  { status: "Completed", count: 6 },
  { status: "In Progress", count: 3 },
  { status: "Pending", count: 4 },
  { status: "Draft", count: 2 },
];

// ─── Dashboard component ──────────────────────────────────────────────────────
export default function CivilWorkDprDashboard() {
  const rights = usePageRights("civilworkdpr-dashboard");
  const navigate = useNavigate();
  const [isFetching, setIsFetching] = React.useState(false);

  const handleRefresh = () => {
    setIsFetching(true);
    setTimeout(() => setIsFetching(false), 600);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR"]} />
      <div className="relative p-4 sm:p-6 space-y-6 sm:space-y-8">
        <DashboardBackground />

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 bg-cyan-500/10 border border-cyan-500/20">
              <Pickaxe size={18} className="text-cyan-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground truncate">
                Civil Work DPR
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Internal operations workspace
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Placeholder notice */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle size={14} className="shrink-0 text-cyan-500" />
          <span>
            This is a placeholder dashboard with sample data — it'll connect to
            real data once Civil Work DPR pages are built out.
          </span>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Open Tasks"
            value={fmtNum(7)}
            sub="3 in progress"
            icon={ClipboardList}
            iconColor="text-cyan-600"
            iconBg="bg-cyan-500/10"
            borderL="border-l-cyan-500"
          />
          <StatCard
            label="Completed"
            value={fmtNum(6)}
            sub="This month"
            icon={CheckCircle2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
            borderL="border-l-emerald-500"
          />
          <StatCard
            label="Team Members"
            value={fmtNum(5)}
            sub="Assigned to module"
            icon={Users}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/10"
            borderL="border-l-blue-500"
          />
          <StatCard
            label="Pending Review"
            value={fmtNum(4)}
            sub="Awaiting sign-off"
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-500/10"
            borderL="border-l-amber-500"
          />
        </div>

        {/* Secondary metric strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Tools Logged",
              value: fmtNum(18),
              icon: Wrench,
              color: "text-cyan-600",
              borderL: "border-l-cyan-500",
            },
            {
              label: "Active Sites",
              value: fmtNum(2),
              icon: Hammer,
              color: "text-orange-600",
              borderL: "border-l-orange-500",
            },
            {
              label: "Drafts",
              value: fmtNum(2),
              icon: ClipboardList,
              color: "text-muted-foreground",
              borderL: "border-l-muted",
            },
            {
              label: "Overdue",
              value: fmtNum(0),
              icon: AlertCircle,
              color: "text-red-500",
              borderL: "border-l-red-500",
            },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border border-border bg-card px-3 sm:px-4 py-3 flex items-center gap-2.5 sm:gap-3 border-l-2 ${s.borderL}`}
            >
              <s.icon size={18} className={`${s.color} shrink-0`} />
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  {s.label}
                </p>
                <p className="text-sm font-heading font-bold text-foreground">
                  {s.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Recent activity + status breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={ClipboardList}
                title="Recent Activity"
                sub="Last 4 entries"
                action="View all"
                onAction={() => navigate("/civilworkdpr")}
              />
            </div>
            {!MOCK_TASKS.length ? (
              <EmptyState label="No activity yet" />
            ) : (
              <div className="divide-y divide-border">
                {MOCK_TASKS.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-primary">
                        {t.id}
                      </p>
                      <p className="text-xs text-foreground truncate max-w-[160px] sm:max-w-[220px]">
                        {t.title}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader icon={BarChart3} title="Task Status Breakdown" />
            <StatusBreakdown data={MOCK_STATUS_BREAKDOWN} label="tasks" />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <SectionHeader icon={Pickaxe} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            {[
              {
                label: "Dashboard",
                icon: Pickaxe,
                path: "/civilworkdpr",
                color: "text-cyan-600",
                bg: "bg-cyan-500/10",
              },
              {
                label: "Tasks",
                icon: ClipboardList,
                path: "/civilworkdpr",
                color: "text-blue-600",
                bg: "bg-blue-500/10",
              },
              {
                label: "Tools",
                icon: Wrench,
                path: "/civilworkdpr",
                color: "text-orange-600",
                bg: "bg-orange-500/10",
              },
            ].map(({ label, icon: Icon, path, color, bg }) => (
              <button
                key={label}
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
