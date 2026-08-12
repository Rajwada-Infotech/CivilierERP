import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  CrmShell,
  CrmGlassCard,
  CrmSection,
} from "@/components/crm/CrmShell";
import {
  ClipboardList,
  BookOpen,
  IndianRupee,
  Wrench,
  XCircle,
  Scale,
  FileText,
  Key,
  LayoutDashboard,
  TrendingUp,
  BarChart3,
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

const API = "/api/crm/dashboard";

// ─── Types ────────────────────────────────────────────────────────────────────
interface StatusCount {
  Status: string;
  Count: number;
  TotalValue?: number;
  TotalRefund?: number;
}

interface NocCount {
  NocType: string;
  Status: string;
  Count: number;
}

interface MonthTrend {
  MonthLabel: string;
  Applications: number;
  Bookings: number;
  Collected: number;
}

interface CrmDashboardData {
  applications: StatusCount[];
  bookings: StatusCount[];
  payments: { TotalDue: number; TotalPaid: number; OverdueCount: number } | null;
  serviceTickets: StatusCount[];
  cancellations: StatusCount[];
  legalMilestones: { OverallStatus: string; Count: number }[];
  noc: NocCount[];
  salesDeeds: StatusCount[];
  handovers: StatusCount[];
  monthlyTrend: MonthTrend[];
}

async function fetchDashboard(): Promise<CrmDashboardData | null> {
  try {
    const r = await fetchWithAuth(API);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const sumCount = (rows: StatusCount[] | undefined) =>
  (rows ?? []).reduce((s, r) => s + (r.Count || 0), 0);

const countFor = (rows: StatusCount[] | undefined, status: string) =>
  (rows ?? []).find((r) => r.Status === status)?.Count ?? 0;

// Rounding straight to a whole number hid any real progress under 1% (e.g.
// ₹20,000 of ₹1.24Cr is a genuine 0.16% — Math.round() showed a flat,
// misleading "0%" instead). Keep one decimal place below 10%, where a
// whole-number rounding would otherwise swallow the only signal there is.
const fmtPct = (paid: number, due: number) => {
  if (!due) return "0%";
  const pct = (paid / due) * 100;
  if (pct <= 0) return "0%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
};

// ─── Warm-toned palette for chart series (project colors, not the reference
// screenshot's orange/red) — spread across distinct hues rather than
// adjacent amber shades so neighbouring slices are actually tellable apart.
const PIE_COLORS = ["#f59e0b", "#dc2626", "#eab308", "#c2410c", "#a16207", "#fb923c", "#78350f", "#fbbf24"];

// ─── Shared glass card shell for chart containers ────────────────────────────
const ChartCard: React.FC<{
  title: string;
  icon: React.ElementType;
  isDark: boolean;
  glassStyle: React.CSSProperties;
  children: React.ReactNode;
  /** Tighter header/body padding — for small status-list tiles, not the
   * full-size analytics charts which need room for their ResponsiveContainer. */
  dense?: boolean;
}> = ({ title, icon: Icon, isDark, glassStyle, children, dense }) => (
  <div className="rounded-lg overflow-hidden" style={glassStyle}>
    <div
      className={`flex items-center gap-1.5 border-b ${dense ? "px-2.5 py-1.5" : "px-3.5 py-2.5"}`}
      style={{ borderColor: isDark ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.12)" }}
    >
      <div
        className="w-4 h-4 rounded flex items-center justify-center shrink-0"
        style={{ background: "rgba(245,158,11,0.15)" }}
      >
        <Icon size={10} style={{ color: "#f59e0b" }} />
      </div>
      <span
        className="text-[11px] font-heading font-semibold truncate"
        style={{ color: isDark ? "#e2e8f0" : "#78350f" }}
      >
        {title}
      </span>
    </div>
    <div className={dense ? "p-2.5" : "p-3.5"}>{children}</div>
  </div>
);

// ─── Donut/pie chart card — status breakdown for one CRM entity ─────────────
const DonutCard: React.FC<{
  title: string;
  icon: React.ElementType;
  data: { name: string; value: number }[];
  isDark: boolean;
  glassStyle: React.CSSProperties;
}> = ({ title, icon, data, isDark, glassStyle }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title={title} icon={icon} isDark={isDark} glassStyle={glassStyle}>
      {total === 0 ? (
        <div className="text-center text-muted-foreground py-6 text-xs">
          No data yet
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5">
          {/* Chart with a center total overlay — the count on its own is
              meaningless without a denominator to read the slices against. */}
          <div className="relative w-full flex justify-center">
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    const pct = total > 0 ? Math.round(((d.value as number) / total) * 100) : 0;
                    return (
                      <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-lg">
                        <p className="text-[11px] font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">{d.value} · {pct}%</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className="text-xl font-bold font-heading"
                style={{ color: isDark ? "#fef3c7" : "#78350f" }}
              >
                {total}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Total
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 w-full">
            {data.map((d, i) => {
              const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-[11px] text-foreground truncate">{d.name}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                    {d.value} <span className="opacity-60">· {pct}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ChartCard>
  );
};

const StatCardSkeleton = () => (
  <div className="rounded-xl overflow-hidden border border-border/40 bg-card/40 backdrop-blur-sm p-4">
    <div className="flex items-start justify-between mb-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-7 rounded-lg" />
    </div>
    <Skeleton className="h-7 w-20 mb-2" />
    <Skeleton className="h-3 w-32" />
  </div>
);

// ─── Compact status-list card — for the lower-volume closure categories ─────
const StatusListCard: React.FC<{
  title: string;
  icon: React.ElementType;
  isDark: boolean;
  glassStyle: React.CSSProperties;
  rows: { label: string; value: React.ReactNode }[];
  emptyLabel: string;
}> = ({ title, icon, isDark, glassStyle, rows, emptyLabel }) => (
  <ChartCard title={title} icon={icon} isDark={isDark} glassStyle={glassStyle} dense>
    {rows.length === 0 ? (
      <p className="text-[11px] text-muted-foreground">{emptyLabel}</p>
    ) : (
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground truncate mr-2">{r.label}</span>
            <span className="font-semibold text-foreground shrink-0">{r.value}</span>
          </div>
        ))}
      </div>
    )}
  </ChartCard>
);

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const CrmDashboard: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const { data, isLoading } = useQuery({
    queryKey: ["crm-dashboard"],
    queryFn: fetchDashboard,
    staleTime: 60_000,
  });

  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(245,158,11,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };

  const appsTotal = sumCount(data?.applications);
  const bookingsTotal = sumCount(data?.bookings);
  const ticketsOpen = sumCount(data?.serviceTickets) - countFor(data?.serviceTickets, "Resolved") - countFor(data?.serviceTickets, "Closed");
  const collectionPctLabel = fmtPct(data?.payments?.TotalPaid ?? 0, data?.payments?.TotalDue ?? 0);
  const collectionPctRaw = data?.payments?.TotalDue
    ? (data.payments.TotalPaid / data.payments.TotalDue) * 100
    : 0;

  const axisColor = isDark ? "#94a3b8" : "#78350f";
  const gridColor = isDark ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.15)";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM"]} />
      <DashboardBackground />
      <CrmShell
        title="CRM Dashboard"
        subtitle="Real-time pipeline, closure, and after-sales health"
        icon={LayoutDashboard}
      >
        {/* ── Primary stat cards ────────────────────────────────────────── */}
        <CrmSection title="Pipeline Overview" icon={ClipboardList} accentColor="#f59e0b">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
              : [
                  {
                    label: "Applications",
                    value: appsTotal.toString(),
                    sub: `${countFor(data?.applications, "Pending")} pending`,
                    icon: ClipboardList,
                    accentColor: "#f59e0b",
                    trend: "neutral" as const,
                  },
                  {
                    label: "Bookings",
                    value: bookingsTotal.toString(),
                    sub: `${countFor(data?.bookings, "Approved")} approved`,
                    icon: BookOpen,
                    accentColor: "#d97706",
                    trend: "neutral" as const,
                  },
                  {
                    label: "Collection",
                    value: collectionPctLabel,
                    sub: `${fmtINR(data?.payments?.TotalPaid ?? 0)} of ${fmtINR(data?.payments?.TotalDue ?? 0)}`,
                    icon: IndianRupee,
                    accentColor: "#eab308",
                    trend: collectionPctRaw > 0 ? ("up" as const) : ("neutral" as const),
                  },
                  {
                    label: "Open Tickets",
                    value: Math.max(0, ticketsOpen).toString(),
                    sub: `${sumCount(data?.serviceTickets)} total`,
                    icon: Wrench,
                    accentColor: "#b45309",
                    trend: "neutral" as const,
                  },
                ].map((s) => <CrmGlassCard key={s.label} {...s} />)}
          </div>
          {(data?.payments?.OverdueCount ?? 0) > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
              {data?.payments?.OverdueCount} payment milestone(s) overdue
            </p>
          )}
        </CrmSection>

        {/* ── Monthly trend: line chart + histogram ───────────────────────── */}
        <CrmSection title="Monthly Trend" icon={TrendingUp} accentColor="#f59e0b">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="Applications & Bookings" icon={TrendingUp} isDark={isDark} glassStyle={glassStyle}>
              {isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : !data?.monthlyTrend?.length ? (
                <div className="text-center text-muted-foreground py-6 text-xs">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={data.monthlyTrend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="MonthLabel" tick={{ fontSize: 10, fill: axisColor }} axisLine={{ stroke: gridColor }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: isDark ? "#1c1408" : "#fff",
                        border: `1px solid ${gridColor}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Applications" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Bookings" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Collections by Month" icon={BarChart3} isDark={isDark} glassStyle={glassStyle}>
              {isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : !data?.monthlyTrend?.length ? (
                <div className="text-center text-muted-foreground py-6 text-xs">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.monthlyTrend} margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="MonthLabel" tick={{ fontSize: 10, fill: axisColor }} axisLine={{ stroke: gridColor }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: axisColor }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                    />
                    <Tooltip
                      formatter={(v: number) => fmtINR(v)}
                      contentStyle={{
                        background: isDark ? "#1c1408" : "#fff",
                        border: `1px solid ${gridColor}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="Collected" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </CrmSection>

        {/* ── Pipeline breakdown (donut) + Closure & Compliance (5 tiles),
              side by side — the tiles arranged 3-then-2 across two rows. ── */}
        <CrmSection title="Pipeline Breakdown & Compliance" icon={PieChartIcon} accentColor="#f59e0b">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 items-start">
            <DonutCard
              title="Applications, Bookings & Tickets by Status"
              icon={PieChartIcon}
              isDark={isDark}
              glassStyle={glassStyle}
              data={[
                ...(data?.applications ?? []).map((a) => ({ name: `Applications · ${a.Status}`, value: a.Count })),
                ...(data?.bookings ?? []).map((b) => ({ name: `Bookings · ${b.Status}`, value: b.Count })),
                ...(data?.serviceTickets ?? []).map((t) => ({ name: `Tickets · ${t.Status}`, value: t.Count })),
              ].filter((d) => d.value > 0)}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <StatusListCard
              title="Cancellations"
              icon={XCircle}
              isDark={isDark}
              glassStyle={glassStyle}
              emptyLabel="None"
              rows={(data?.cancellations ?? []).map((c) => ({
                label: c.Status,
                value: `${c.Count} · ${fmtINR(c.TotalRefund ?? 0)}`,
              }))}
            />
            <StatusListCard
              title="Legal Milestones"
              icon={Scale}
              isDark={isDark}
              glassStyle={glassStyle}
              emptyLabel="None started"
              rows={(data?.legalMilestones ?? []).map((m) => ({
                label: m.OverallStatus,
                value: m.Count,
              }))}
            />
            <StatusListCard
              title="NOC (Org & Bank)"
              icon={FileText}
              isDark={isDark}
              glassStyle={glassStyle}
              emptyLabel="None"
              rows={(data?.noc ?? []).map((n) => ({
                label: `${n.NocType} · ${n.Status}`,
                value: n.Count,
              }))}
            />
            <StatusListCard
              title="Sale Deeds"
              icon={FileText}
              isDark={isDark}
              glassStyle={glassStyle}
              emptyLabel="None"
              rows={(data?.salesDeeds ?? []).map((d) => ({
                label: d.Status,
                value: d.Count,
              }))}
            />
            <StatusListCard
              title="Handovers"
              icon={Key}
              isDark={isDark}
              glassStyle={glassStyle}
              emptyLabel="None scheduled"
              rows={(data?.handovers ?? []).map((h) => ({
                label: h.Status,
                value: h.Count,
              }))}
            />
            </div>
          </div>
        </CrmSection>
      </CrmShell>
    </>
  );
};

export default CrmDashboard;
