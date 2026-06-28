import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Pickaxe,
  ClipboardList,
  HardHat,
  Users2,
  RefreshCw,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  GitBranch,
  BarChart3,
  Sparkles,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardData {
  activities: { totalCount: number; activeCount: number };
  allocations: {
    totalCount: number;
    projectCount: number;
    workerCount: number;
    todayCount: number;
    newCount: number;
  };
  progress: {
    totalCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    rejectedCount: number;
    todayCount: number;
  };
  labour: {
    skilledToday: number;
    unskilledToday: number;
    totalToday: number;
    crewsToday: number;
  };
  recentProgress: {
    Id: number;
    ActivityName: string | null;
    ContractorName: string | null;
    ProjectName: string | null;
    PercentageProgress: number;
    CurrentStatus: string | null;
    ReviewStatus: "Pending" | "Approved" | "Rejected";
    CreatedAt: string;
  }[];
  statusBreakdown: { Status: string; Count: number }[];
  asOf: string;
}

const EMPTY_DATA: DashboardData = {
  activities: { totalCount: 0, activeCount: 0 },
  allocations: { totalCount: 0, projectCount: 0, workerCount: 0, todayCount: 0, newCount: 0 },
  progress: { totalCount: 0, pendingReviewCount: 0, approvedCount: 0, rejectedCount: 0, todayCount: 0 },
  labour: { skilledToday: 0, unskilledToday: 0, totalToday: 0, crewsToday: 0 },
  recentProgress: [],
  statusBreakdown: [],
  asOf: "",
};

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const reviewColors: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Rejected: "bg-red-500/10 text-red-600 border-red-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
};

const statusColors: Record<string, string> = {
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  "Not Started": "bg-muted text-muted-foreground border-border",
  "On Hold": "bg-amber-500/10 text-amber-600 border-amber-400/20",
};

function Badge({ label, map }: { label: string; map: Record<string, string> }) {
  const cls = map[label] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {label}
    </span>
  );
}

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
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-heading font-bold text-foreground leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

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
          <p className="text-sm font-heading font-semibold text-foreground truncate">{title}</p>
          {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
        </div>
      </div>
      {action && onAction && (
        <button onClick={onAction} className="text-[10px] text-primary hover:underline flex items-center gap-0.5 shrink-0">
          {action} <ArrowUpRight size={10} />
        </button>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <AlertCircle size={28} className="opacity-30" />
      <p className="text-xs text-center px-4">{label}</p>
    </div>
  );
}

function StatusBreakdown({ data }: { data: { Status: string; Count: number }[] }) {
  if (!data?.length) return <p className="text-xs text-muted-foreground py-2">No progress entries yet</p>;
  const total = data.reduce((s, r) => s + r.Count, 0);
  return (
    <div className="space-y-2 mt-3">
      {data.map((row) => {
        const pct = total > 0 ? Math.round((row.Count / total) * 100) : 0;
        return (
          <div key={row.Status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{row.Status}</span>
              <span className="font-medium text-foreground">{row.Count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ─── Dashboard component ──────────────────────────────────────────────────────
export default function CivilWorkDprDashboard() {
  const navigate = useNavigate();

  const {
    data: rawData,
    isFetching,
    refetch,
  } = useQuery<DashboardData>({
    queryKey: ["civilWorkDprDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json();
    },
    // "Realtime": poll every 10s so review queue / progress counts stay
    // fresh without the user manually refreshing.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const data = rawData ?? EMPTY_DATA;

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
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Active Activities"
            value={fmtNum(data.activities.activeCount)}
            sub={`${data.activities.totalCount} total`}
            icon={ClipboardList}
            iconColor="text-cyan-600"
            iconBg="bg-cyan-500/10"
            borderL="border-l-cyan-500"
            onClick={() => navigate("/masters/activity")}
          />
          <StatCard
            label="Workers Assigned"
            value={fmtNum(data.allocations.workerCount)}
            sub={`${data.allocations.totalCount} allocations · ${data.allocations.projectCount} projects`}
            icon={HardHat}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/10"
            borderL="border-l-blue-500"
            onClick={() => navigate("/civilworkdpr/contractor-register")}
          />
          <StatCard
            label="Pending Review"
            value={fmtNum(data.progress.pendingReviewCount)}
            sub="Awaiting engineer sign-off"
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-500/10"
            borderL="border-l-amber-500"
            onClick={() => navigate("/civilworkdpr/dependency")}
          />
          <StatCard
            label="Labour on Site Today"
            value={fmtNum(data.labour.totalToday)}
            sub={`${data.labour.skilledToday} skilled · ${data.labour.unskilledToday} unskilled`}
            icon={Users2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
            borderL="border-l-emerald-500"
            onClick={() => navigate("/civilworkdpr/contractor-register")}
          />
        </div>

        {/* Secondary metric strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "New Allocations Today", value: fmtNum(data.allocations.todayCount), icon: Sparkles, color: "text-cyan-600", borderL: "border-l-cyan-500" },
            { label: "Unacknowledged", value: fmtNum(data.allocations.newCount), icon: AlertCircle, color: "text-amber-600", borderL: "border-l-amber-500" },
            { label: "Progress Logged Today", value: fmtNum(data.progress.todayCount), icon: GitBranch, color: "text-blue-600", borderL: "border-l-blue-500" },
            { label: "Approved Entries", value: fmtNum(data.progress.approvedCount), icon: CheckCircle2, color: "text-emerald-600", borderL: "border-l-emerald-500" },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border border-border bg-card px-3 sm:px-4 py-3 flex items-center gap-2.5 sm:gap-3 border-l-2 ${s.borderL}`}
            >
              <s.icon size={18} className={`${s.color} shrink-0`} />
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{s.label}</p>
                <p className="text-sm font-heading font-bold text-foreground">{s.value}</p>
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
                title="Recent Progress"
                sub="Last 8 logged updates"
                action="View all"
                onAction={() => navigate("/civilworkdpr/dependency")}
              />
            </div>
            {!data.recentProgress.length ? (
              <EmptyState label="No progress logged yet" />
            ) : (
              <div className="divide-y divide-border">
                {data.recentProgress.map((p) => (
                  <div key={p.Id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate max-w-[160px] sm:max-w-[220px]">
                        {p.ActivityName || "—"} · {p.ContractorName || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {p.ProjectName || "—"} · {p.PercentageProgress}% · {timeAgo(p.CreatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge label={p.CurrentStatus || "Not Started"} map={statusColors} />
                      <Badge label={p.ReviewStatus} map={reviewColors} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader icon={BarChart3} title="Progress Status Breakdown" />
            <StatusBreakdown data={data.statusBreakdown} />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <SectionHeader icon={Pickaxe} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            {[
              { label: "Activity Master", icon: ClipboardList, path: "/masters/activity", color: "text-orange-600", bg: "bg-orange-500/10" },
              { label: "Dependency", icon: GitBranch, path: "/civilworkdpr/dependency", color: "text-cyan-600", bg: "bg-cyan-500/10" },
              { label: "Contractor Register", icon: HardHat, path: "/civilworkdpr/contractor-register", color: "text-blue-600", bg: "bg-blue-500/10" },
            ].map(({ label, icon: Icon, path, color, bg }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
              >
                <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
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
