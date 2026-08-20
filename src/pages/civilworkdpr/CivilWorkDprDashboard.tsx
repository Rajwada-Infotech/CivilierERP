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
import { ASSIGNMENT_STATUS_META } from "@/api/dependencyActivityAssignmentApi";
import {
  Pickaxe,
  ClipboardList,
  HardHat,
  Users2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  ListChecks,
  Hammer,
  FileText,
  GitBranch,
  TrendingUp,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

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
  labour: {
    skilledToday: number;
    unskilledToday: number;
    totalToday: number;
    crewsToday: number;
  };
  assignedWork: {
    totalCount: number;
    todayCount: number;
    pendingCount: number;
    inProgressCount: number;
    completedCount: number;
    holdCount: number;
    cancelledCount: number;
    approvedCount: number;
    reworkCount: number;
  };
  recentAssignments: {
    Id: number;
    ActivityName: string | null;
    EngineerNames: string | null;
    ChainAlias: string | null;
    ProjectName: string | null;
    Status: keyof typeof ASSIGNMENT_STATUS_META;
    UpdatedAt: string;
  }[];
  assignmentTimeline: { date: string; assigned: number; completed: number }[];
  asOf: string;
}

const EMPTY_DATA: DashboardData = {
  activities: { totalCount: 0, activeCount: 0 },
  allocations: { totalCount: 0, projectCount: 0, workerCount: 0, todayCount: 0, newCount: 0 },
  labour: { skilledToday: 0, unskilledToday: 0, totalToday: 0, crewsToday: 0 },
  assignedWork: {
    totalCount: 0,
    todayCount: 0,
    pendingCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    holdCount: 0,
    cancelledCount: 0,
    approvedCount: 0,
    reworkCount: 0,
  },
  recentAssignments: [],
  assignmentTimeline: [],
  asOf: "",
};

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

function StatusBadge({ status }: { status: keyof typeof ASSIGNMENT_STATUS_META }) {
  const meta = ASSIGNMENT_STATUS_META[status] ?? ASSIGNMENT_STATUS_META.PENDING;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-heading font-bold uppercase tracking-wide ${meta.className}`}>
      {meta.label}
    </span>
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

// Status order carries no workflow meaning (any status can move to any
// other — see migration 334) — this is display order only, roughly
// "least" to "most" resolved, so the bars read left-to-right sensibly.
const ASSIGNED_WORK_STATUS_ORDER: (keyof typeof ASSIGNMENT_STATUS_META)[] = [
  "PENDING",
  "IN_PROGRESS",
  "HOLD",
  "REWORK",
  "CANCELLED",
  "APPROVED",
  "COMPLETED",
];

// Hex fills for the pie chart — same semantic mapping as ASSIGNMENT_STATUS_META's
// Tailwind classes (recharts needs real color values, not class names).
const STATUS_HEX: Record<string, string> = {
  PENDING: "#64748b",
  IN_PROGRESS: "#3b82f6",
  HOLD: "#f59e0b",
  REWORK: "#d946ef",
  CANCELLED: "#ef4444",
  APPROVED: "#14b8a6",
  COMPLETED: "#10b981",
};

// ─── Donut / trend chart cards — same shape MaterialDashboard/FinanceDashboard
// use, kept local since each dashboard's data shape differs. ─────────────────
interface DonutPoint { name: string; value: number; color: string; }

function DonutCard({
  title, icon: Icon, accentColor, data, glassStyle, emptyLabel = "No data yet",
}: {
  title: string; icon: React.ElementType; accentColor: string; data: DonutPoint[];
  glassStyle: React.CSSProperties; emptyLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl overflow-hidden flex-1 flex flex-col" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: `${accentColor}26` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${accentColor}26` }}>
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4 flex-1 flex flex-col justify-center min-h-[220px]">
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">{emptyLabel}</div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={45} outerRadius={75} paddingAngle={2} strokeWidth={0}
                  isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                >
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{fmtNum(d.value as number)}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-foreground whitespace-nowrap">{d.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto sm:ml-3">{fmtNum(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TrendSeries { key: string; name: string; color: string; }

function TrendCard({
  title, icon: Icon, accentColor, data, series, isDark, glassStyle,
}: {
  title: string; icon: React.ElementType; accentColor: string;
  data: { date: string; [key: string]: number | string }[]; series: TrendSeries[];
  isDark: boolean; glassStyle: React.CSSProperties;
}) {
  const hasData = data.some((d) => series.some((s) => Number(d[s.key]) > 0));
  return (
    <div className="rounded-xl overflow-hidden flex-1 flex flex-col" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: `${accentColor}26` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${accentColor}26` }}>
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4 flex-1 flex flex-col justify-center min-h-[240px]">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No activity in the last 14 days</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false} width={28}
                allowDecimals={false}
              />
              <Tooltip
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                formatter={(value: number, name: string) => [fmtNum(value), name]}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${accentColor}30`, borderRadius: 8, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              {series.map((s) => (
                <Line
                  key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                  isAnimationActive animationDuration={1100} animationEasing="ease-in-out"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
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
  const assignedWorkCounts: Record<string, number> = {
    PENDING: data.assignedWork.pendingCount,
    IN_PROGRESS: data.assignedWork.inProgressCount,
    HOLD: data.assignedWork.holdCount,
    REWORK: data.assignedWork.reworkCount,
    CANCELLED: data.assignedWork.cancelledCount,
    APPROVED: data.assignedWork.approvedCount,
    COMPLETED: data.assignedWork.completedCount,
  };

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
        subtitle="Activities, contractor allocations, and Work Allocation assignments at a glance"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            />
            <GlassCard
              label="Labour on Site Today"
              value={fmtNum(data.labour.totalToday)}
              sub={`${data.labour.skilledToday} skilled · ${data.labour.unskilledToday} unskilled`}
              icon={Users2}
              accentColor={SECONDARY}
              onClick={() => navigate("/civilworkdpr/worker-attendance")}
            />
            <GlassCard
              label="Assigned Work"
              value={fmtNum(data.assignedWork.totalCount)}
              sub={`${data.assignedWork.pendingCount} pending · ${data.assignedWork.completedCount} completed`}
              icon={ListChecks}
              accentColor="#8b5cf6"
              onClick={() => navigate("/civilworkdpr/activity-reporting")}
            />
          </div>
        </GlassSection>

        {/* Secondary metric strip */}
        <GlassSection title="Today" icon={Sparkles} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
              label="Activities Assigned Today"
              value={fmtNum(data.assignedWork.todayCount)}
              icon={ListChecks}
              accentColor="#8b5cf6"
            />
          </div>
        </GlassSection>

        {/* Recent activity + status breakdown */}
        <GlassSection title="Work Allocation" icon={Hammer} accentColor={ACCENT}>
          {/* Equal-height columns: the grid stretches both cells to the
              tallest one, and each column is itself a flex column so its
              content actually fills that height (a scrollable list on the
              left, two flex-1 charts on the right) instead of leaving a
              dead gap under shorter content. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl overflow-hidden flex flex-col" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b shrink-0"
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
                    Recent Assignments
                  </span>
                </div>
                <button
                  onClick={() => navigate("/civilworkdpr/activity-reporting")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: ACCENT }}
                >
                  View all →
                </button>
              </div>
              {!data.recentAssignments.length ? (
                <EmptyState label="No activities assigned yet — click an activity in Work Allocation's Link Dependency chain to assign one" />
              ) : (
                <div className="divide-y divide-border flex-1 overflow-y-auto flex flex-col justify-between">
                  {data.recentAssignments.map((a) => (
                    <div key={a.Id} className="flex items-center justify-between gap-3 px-4 py-4">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate max-w-[160px] sm:max-w-[220px]">
                          {a.ActivityName || "—"} · {a.ChainAlias || "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {a.ProjectName || "—"} · {a.EngineerNames || "Unassigned"} · {timeAgo(a.UpdatedAt)}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <StatusBadge status={a.Status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <DonutCard
                title="Assignment Status Breakdown"
                icon={PieChartIcon}
                accentColor="#8b5cf6"
                glassStyle={tableGlass}
                emptyLabel="No activities assigned yet"
                data={ASSIGNED_WORK_STATUS_ORDER.map((status) => ({
                  name: ASSIGNMENT_STATUS_META[status].label,
                  value: assignedWorkCounts[status],
                  color: STATUS_HEX[status],
                })).filter((d) => d.value > 0)}
              />
              <TrendCard
                title="Assignment Activity — Last 14 Days"
                icon={TrendingUp}
                accentColor={ACCENT}
                isDark={isDark}
                glassStyle={tableGlass}
                data={data.assignmentTimeline}
                series={[
                  { key: "assigned", name: "Assigned", color: "#8b5cf6" },
                  { key: "completed", name: "Completed", color: "#10b981" },
                ]}
              />
            </div>
          </div>
        </GlassSection>

        {/* Quick Actions */}
        <GlassSection title="Quick Actions" icon={Pickaxe} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Work Allocation", icon: Hammer, path: "/civilworkdpr/work-allocation", color: "#8b5cf6" },
              { label: "Reporting", icon: FileText, path: "/civilworkdpr/activity-reporting", color: "#10b981" },
              { label: "Activity Master", icon: ClipboardList, path: "/masters/activity", color: "#f97316" },
              { label: "Dependency", icon: GitBranch, path: "/civilworkdpr/dependency", color: ACCENT },
              { label: "Attendance", icon: Users2, path: "/civilworkdpr/worker-attendance", color: "#eab308" },
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
