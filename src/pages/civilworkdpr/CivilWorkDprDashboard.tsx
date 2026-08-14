import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  GlassShell,
  GlassCard,
  GlassSection,
} from "@/components/dashboard/GlassShell";
import {
  Pickaxe,
  ClipboardList,
  HardHat,
  Users2,
  RefreshCw,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  BarChart3,
  Sparkles,
} from "lucide-react";

const ACCENT = "#0891b2"; // cyan — matches Civil Work DPR's ModuleStrip color
const SECONDARY = "#10b981"; // emerald bloom

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
        <Icon size={16} style={{ color: ACCENT }} className="shrink-0" />
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
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
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
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const {
    data: rawData,
    isFetching,
    refetch,
  } = useQuery<DashboardData>({
    queryKey: ["civilWorkDprDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json().catch(() => ({}));
    },
    // "Realtime": poll every 10s so review queue / progress counts stay
    // fresh without the user manually refreshing.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const data = rawData ?? EMPTY_DATA;

  const tableGlass = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? `1px solid ${ACCENT}26` : `1px solid ${ACCENT}2e`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : `0 4px 24px ${ACCENT}0f, inset 0 1px 0 rgba(255,255,255,0.9)`,
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR"]} />
      <GlassShell
        title="Civil Work DPR"
        subtitle="Activities, contractor allocations, and daily progress at a glance"
        icon={Pickaxe}
        accentColor={ACCENT}
        secondaryColor={SECONDARY}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ borderColor: `${ACCENT}4d`, color: ACCENT }}
          >
            <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
            Refresh
          </button>
        }
      >
        {/* KPI Cards */}
        <GlassSection title="Overview" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <GlassCard
              label="Active Activities"
              value={fmtNum(data.activities.activeCount)}
              sub={`${data.activities.totalCount} total`}
              icon={ClipboardList}
              accentColor={ACCENT}
              onClick={() => navigate("/masters/activity")}
            />
            <GlassCard
              label="Workers Assigned"
              value={fmtNum(data.allocations.workerCount)}
              sub={`${data.allocations.totalCount} allocations · ${data.allocations.projectCount} projects`}
              icon={HardHat}
              accentColor="#3b82f6"
              onClick={() => navigate("/civilworkdpr/contractor-register")}
            />
            <GlassCard
              label="Labour on Site Today"
              value={fmtNum(data.labour.totalToday)}
              sub={`${data.labour.skilledToday} skilled · ${data.labour.unskilledToday} unskilled`}
              icon={Users2}
              accentColor={SECONDARY}
              onClick={() => navigate("/civilworkdpr/contractor-register")}
            />
          </div>
        </GlassSection>

        {/* Secondary metric strip */}
        <GlassSection title="Today" icon={Sparkles} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GlassCard
              label="New Allocations Today"
              value={fmtNum(data.allocations.todayCount)}
              icon={Sparkles}
              accentColor={ACCENT}
            />
            <GlassCard
              label="Unacknowledged"
              value={fmtNum(data.allocations.newCount)}
              icon={AlertCircle}
              accentColor="#f59e0b"
            />
            <GlassCard
              label="Progress Logged Today"
              value={fmtNum(data.progress.todayCount)}
              icon={GitBranch}
              accentColor="#3b82f6"
            />
            <GlassCard
              label="Approved Entries"
              value={fmtNum(data.progress.approvedCount)}
              icon={CheckCircle2}
              accentColor="#10b981"
            />
          </div>
        </GlassSection>

        {/* Recent activity + status breakdown */}
        <GlassSection title="Recent Activity" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: `${ACCENT}26` }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: `${ACCENT}26` }}
                  >
                    <ClipboardList size={11} style={{ color: ACCENT }} />
                  </div>
                  <span className="text-xs font-heading font-semibold text-foreground">
                    Recent Progress
                  </span>
                </div>
                <button
                  onClick={() => navigate("/civilworkdpr/contractor-register")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: ACCENT }}
                >
                  View all →
                </button>
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

            <div className="rounded-xl overflow-hidden p-5" style={tableGlass}>
              <SectionHeader icon={BarChart3} title="Progress Status Breakdown" />
              <StatusBreakdown data={data.statusBreakdown} />
            </div>
          </div>
        </GlassSection>

        {/* Quick Actions */}
        <GlassSection title="Quick Actions" icon={Pickaxe} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Activity Master", icon: ClipboardList, path: "/masters/activity", color: "#f97316" },
              { label: "Dependency", icon: GitBranch, path: "/civilworkdpr/dependency", color: ACCENT },
              { label: "Contractor Register", icon: HardHat, path: "/civilworkdpr/contractor-register", color: "#3b82f6" },
            ].map(({ label, icon: Icon, path, color }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="group flex flex-col items-center gap-3 py-5 rounded-xl transition-all duration-200 active:scale-95"
                style={{ background: `${color}0A`, border: `1px solid ${color}25` }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = `${color}18`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${color}40`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = `${color}0A`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${color}25`;
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ background: `${color}20`, border: `1px solid ${color}35` }}
                >
                  <Icon size={18} style={{ color }} />
                </div>
                <span className="text-xs font-medium text-center leading-tight text-muted-foreground">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}
