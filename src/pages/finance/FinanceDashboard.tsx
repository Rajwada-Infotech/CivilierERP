import React from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  CreditCard,
  Landmark,
  BookOpen,
  Receipt,
  BadgeDollarSign,
  CheckCircle2,
  Clock,
  TrendingUp,
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
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  FinanceShell,
  FinanceGlassCard,
  GlassSection,
} from "@/components/finance/FinanceShell";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FinanceDashboardData {
  paymentsMade: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
  };
  receivedPayments: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
    approvedCount: number;
    draftCount: number;
  };
  cheques: {
    totalCount: number;
    activeCount: number;
    inactiveCount: number;
  };
  cards: {
    totalCount: number;
    activeCount: number;
    inactiveCount: number;
  };
  banks: {
    totalCount: number;
    activeCount: number;
  };
  recentPaymentsMade: RecentPaymentMade[];
  recentPaymentsReceived: RecentPaymentReceived[];
  timeline: { date: string; made: number; received: number }[];
}

interface RecentPaymentMade {
  PPaymentID: number;
  PPaymentName: string;
  PMode: string;
  PAmount: number;
  PDate: string;
  PBankName: string;
  PDocType: string;
  PProject: string;
  PCreatedAt: string;
}

interface RecentPaymentReceived {
  RPPaymentID: number;
  RPReceivedFrom: string;
  RPMode: string;
  RPAmount: number;
  RPDocDate: string;
  RPBankName: string;
  RPStatus: string;
  RPCreatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

interface DonutPoint {
  name: string;
  value: number;
  color: string;
}

const DonutCard: React.FC<{
  title: string;
  icon: React.ElementType;
  accentColor: string;
  data: DonutPoint[];
  isDark: boolean;
  glassStyle: React.CSSProperties;
  formatValue?: (n: number) => string;
}> = ({ title, icon: Icon, accentColor, data, isDark, glassStyle, formatValue = fmt }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{
          borderColor: isDark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.12)",
        }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: `${accentColor}26` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span
          className="text-xs font-heading font-semibold"
          style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
        >
          {title}
        </span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">
            No data yet
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">
                          {d.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatValue(d.value as number)}
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: d.color }}
                  />
                  <span className="text-xs text-foreground whitespace-nowrap">
                    {d.name}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto sm:ml-3">
                    {formatValue(d.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface TrendSeries {
  key: string;
  name: string;
  color: string;
}

const TrendCard: React.FC<{
  title: string;
  icon: React.ElementType;
  accentColor: string;
  data: { date: string; [key: string]: number | string }[];
  series: TrendSeries[];
  isDark: boolean;
  glassStyle: React.CSSProperties;
}> = ({ title, icon: Icon, accentColor, data, series, isDark, glassStyle }) => {
  const hasData = data.some((d) => series.some((s) => Number(d[s.key]) > 0));
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{
          borderColor: isDark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.12)",
        }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: `${accentColor}26` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span
          className="text-xs font-heading font-semibold"
          style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
        >
          {title}
        </span>
      </div>
      <div className="p-4">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-10 text-sm">
            No activity in the last 14 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                formatter={(value: number, name: string) => [fmt(value), name]}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${accentColor}30`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
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

// ─── Safe defaults (prevent crashes if API returns old / partial shape) ────────
const EMPTY_DATA: FinanceDashboardData = {
  paymentsMade: {
    totalCount: 0,
    todayCount: 0,
    totalAmount: 0,
    todayAmount: 0,
  },
  receivedPayments: {
    totalCount: 0,
    todayCount: 0,
    totalAmount: 0,
    todayAmount: 0,
    approvedCount: 0,
    draftCount: 0,
  },
  cheques: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  cards: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  banks: { totalCount: 0, activeCount: 0 },
  recentPaymentsMade: [],
  recentPaymentsReceived: [],
  timeline: [],
};

/** Normalise whatever shape the backend returns into the new shape. */
function normalise(raw: any): FinanceDashboardData {
  if (!raw || typeof raw !== "object") return EMPTY_DATA;

  // Support old backend shape (payments / purchaseOrders / grns …)
  const paymentsMade = raw.paymentsMade ?? {
    totalCount: raw.payments?.totalCount ?? 0,
    todayCount: raw.payments?.todayCount ?? 0,
    totalAmount: raw.payments?.totalAmount ?? 0,
    todayAmount: raw.payments?.todayAmount ?? 0,
  };

  return {
    paymentsMade,
    receivedPayments: raw.receivedPayments ?? EMPTY_DATA.receivedPayments,
    cheques: raw.cheques ?? EMPTY_DATA.cheques,
    cards: raw.cards ?? EMPTY_DATA.cards,
    banks: raw.banks ?? EMPTY_DATA.banks,
    recentPaymentsMade: raw.recentPaymentsMade ?? raw.recentPayments ?? [],
    recentPaymentsReceived: raw.recentPaymentsReceived ?? [],
    timeline: raw.timeline ?? [],
  };
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const FinanceDashboard = () => {
  usePageRights("finance-dashboard");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const {
    data: rawData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<FinanceDashboardData>({
    queryKey: ["financeDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/finance-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json().catch(() => ({}));
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });

  const data = rawData ? normalise(rawData) : undefined;

  const tableGlass = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark
      ? "1px solid rgba(99,102,241,0.15)"
      : "1px solid rgba(99,102,241,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(99,102,241,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance"]} />
      <DashboardBackground />
      <FinanceShell
        title="Finance Overview"
        subtitle="Payments, cheques, cards and bank accounts at a glance"
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ color: "#818cf8" }}
          >
            <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
            Refresh
          </button>
        }
      >
        {isError && (
          <div className="px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
            Failed to load dashboard data. Please refresh the page.
          </div>
        )}

        {/* ── Primary stat cards ────────────────────────────────────────────── */}
        <GlassSection
          title="Cumulative Transfers"
          icon={Receipt}
          accentColor="#6366f1"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <StatCardSkeleton key={i} />
                ))
              : [
                  {
                    label: "Total Payments Made",
                    value: fmt(data?.paymentsMade.totalAmount ?? 0),
                    sub: `${data?.paymentsMade.totalCount ?? 0} transfers · all-time`,
                    icon: Receipt,
                    accentColor: "#f43f5e",
                    onClick: () => navigate("/payments"),
                    trend: "up" as const,
                  },
                  {
                    label: "Total Received",
                    value: fmt(data?.receivedPayments.totalAmount ?? 0),
                    sub: `${data?.receivedPayments.totalCount ?? 0} receipts · all-time`,
                    icon: BadgeDollarSign,
                    accentColor: "#10b981",
                    onClick: () => navigate("/received-payments"),
                    trend: "up" as const,
                  },
                  {
                    label: "Cheque Lots",
                    value: data?.cheques.totalCount.toString() ?? "0",
                    sub: `${data?.cheques.activeCount ?? 0} active · ${data?.cheques.inactiveCount ?? 0} inactive`,
                    icon: BookOpen,
                    accentColor: "#f59e0b",
                    onClick: () => navigate("/masters/cheque"),
                    trend: "neutral" as const,
                  },
                  {
                    label: "Active Cards",
                    value: data?.cards.activeCount.toString() ?? "0",
                    sub: `${data?.cards.inactiveCount ?? 0} inactive · ${data?.cards.totalCount ?? 0} total`,
                    icon: CreditCard,
                    accentColor: "#8b5cf6",
                    onClick: () => navigate("/masters/card"),
                    trend: "neutral" as const,
                  },
                ].map((s) => <FinanceGlassCard key={s.label} {...s} />)}
          </div>
        </GlassSection>

        {/* ── Banks / Totals row ────────────────────────────────────────────── */}
        <GlassSection title="Totals" icon={Landmark} accentColor="#6366f1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            ) : (
              <>
                <FinanceGlassCard
                  label="Bank Accounts"
                  value={(data?.banks.activeCount ?? 0).toString()}
                  sub={`${data?.banks.totalCount ?? 0} total bank heads`}
                  icon={Landmark}
                  accentColor="#3b82f6"
                  onClick={() => navigate("/masters/banks")}
                />
                <FinanceGlassCard
                  label="Total Payments Made"
                  value={fmt(data?.paymentsMade.totalAmount ?? 0)}
                  sub={`${data?.paymentsMade.totalCount ?? 0} entries all-time`}
                  icon={Receipt}
                  accentColor="#f43f5e"
                  trend="neutral"
                />
                <FinanceGlassCard
                  label="Total Received"
                  value={fmt(data?.receivedPayments.totalAmount ?? 0)}
                  sub={`${data?.receivedPayments.approvedCount ?? 0} approved · ${data?.receivedPayments.draftCount ?? 0} draft`}
                  icon={BadgeDollarSign}
                  accentColor="#10b981"
                  trend="neutral"
                />
              </>
            )}
          </div>
        </GlassSection>

        {/* ── Breakdown charts ──────────────────────────────────────────────── */}
        <GlassSection title="Breakdown" icon={BadgeDollarSign} accentColor="#6366f1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutCard
              title="Payments Made vs Received"
              icon={BadgeDollarSign}
              accentColor="#6366f1"
              isDark={isDark}
              glassStyle={tableGlass}
              data={[
                { name: "Made", value: data?.paymentsMade.totalAmount ?? 0, color: "#f43f5e" },
                { name: "Received", value: data?.receivedPayments.totalAmount ?? 0, color: "#10b981" },
              ]}
            />
            <DonutCard
              title="Cheques & Cards Status"
              icon={CreditCard}
              accentColor="#8b5cf6"
              isDark={isDark}
              glassStyle={tableGlass}
              formatValue={(n) => `${n}`}
              data={[
                { name: "Cheques Active", value: data?.cheques.activeCount ?? 0, color: "#f59e0b" },
                { name: "Cheques Inactive", value: data?.cheques.inactiveCount ?? 0, color: "#f59e0b66" },
                { name: "Cards Active", value: data?.cards.activeCount ?? 0, color: "#8b5cf6" },
                { name: "Cards Inactive", value: data?.cards.inactiveCount ?? 0, color: "#8b5cf666" },
              ]}
            />
          </div>
          <div className="mt-4">
            <TrendCard
              title="Payments — Last 14 Days"
              icon={TrendingUp}
              accentColor="#6366f1"
              isDark={isDark}
              glassStyle={tableGlass}
              data={data?.timeline ?? []}
              series={[
                { key: "made", name: "Made", color: "#f43f5e" },
                { key: "received", name: "Received", color: "#10b981" },
              ]}
            />
          </div>
        </GlassSection>

        {/* ── Recent tables ─────────────────────────────────────────────────── */}
        <GlassSection
          title="Recent Activity"
          icon={Receipt}
          accentColor="#6366f1"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent Payments Made */}
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{
                  borderColor: isDark
                    ? "rgba(99,102,241,0.15)"
                    : "rgba(99,102,241,0.12)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(244,63,94,0.15)" }}
                  >
                    <Receipt size={11} style={{ color: "#f43f5e" }} />
                  </div>
                  <span
                    className="text-xs font-heading font-semibold"
                    style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
                  >
                    Recent Payments Made
                  </span>
                </div>
                <button
                  onClick={() => navigate("/payments")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#f43f5e" }}
                >
                  View all →
                </button>
              </div>
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : (data?.recentPaymentsMade.length ?? 0) === 0 ? (
                <div className="text-center text-muted-foreground py-10 text-sm">
                  No payments recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="border-b"
                        style={{
                          borderColor: isDark
                            ? "rgba(99,102,241,0.10)"
                            : "rgba(99,102,241,0.08)",
                        }}
                      >
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Mode</TableHead>
                        <TableHead className="text-xs text-right">
                          Amount
                        </TableHead>
                        <TableHead className="text-xs">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.recentPaymentsMade ?? []).map((p) => (
                        <TableRow
                          key={p.PPaymentID}
                          className="border-b border-indigo-500/5 hover:bg-indigo-500/5 transition-colors"
                        >
                          <TableCell className="text-xs font-medium truncate max-w-[120px]">
                            {p.PPaymentName || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-[10px] border-rose-500/30 text-rose-500"
                            >
                              {p.PMode || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-xs text-right font-semibold"
                            style={{ color: "#f43f5e" }}
                          >
                            {p.PAmount != null ? fmt(p.PAmount) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDate(p.PDate)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Recent Received Payments */}
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{
                  borderColor: isDark
                    ? "rgba(99,102,241,0.15)"
                    : "rgba(99,102,241,0.12)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(16,185,129,0.15)" }}
                  >
                    <BadgeDollarSign size={11} style={{ color: "#10b981" }} />
                  </div>
                  <span
                    className="text-xs font-heading font-semibold"
                    style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
                  >
                    Recent Received Payments
                  </span>
                </div>
                <button
                  onClick={() => navigate("/received-payments")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#10b981" }}
                >
                  View all →
                </button>
              </div>
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : (data?.recentPaymentsReceived.length ?? 0) === 0 ? (
                <div className="text-center text-muted-foreground py-10 text-sm">
                  No received payments recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="border-b"
                        style={{
                          borderColor: isDark
                            ? "rgba(99,102,241,0.10)"
                            : "rgba(99,102,241,0.08)",
                        }}
                      >
                        <TableHead className="text-xs">From</TableHead>
                        <TableHead className="text-xs">Mode</TableHead>
                        <TableHead className="text-xs text-right">
                          Amount
                        </TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.recentPaymentsReceived ?? []).map((r) => (
                        <TableRow
                          key={r.RPPaymentID}
                          className="border-b border-indigo-500/5 hover:bg-indigo-500/5 transition-colors"
                        >
                          <TableCell className="text-xs font-medium truncate max-w-[120px]">
                            {r.RPReceivedFrom || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-[10px] border-emerald-500/30 text-emerald-500"
                            >
                              {r.RPMode || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-xs text-right font-semibold"
                            style={{ color: "#10b981" }}
                          >
                            {r.RPAmount != null ? fmt(r.RPAmount) : "—"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                r.RPStatus === "Approved"
                                  ? "bg-emerald-500/15 text-emerald-500"
                                  : r.RPStatus === "Draft" || !r.RPStatus
                                    ? "bg-amber-500/15 text-amber-500"
                                    : "bg-blue-500/15 text-blue-500"
                              }`}
                            >
                              {r.RPStatus || "Draft"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </GlassSection>

        {/* ── Cheque Summary ───────────────────────────────────────────── */}
        <GlassSection
          title="Cheque Summary"
          icon={BookOpen}
          accentColor="#f59e0b"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            ) : (
              <>
                <FinanceGlassCard
                  label="Total Cheque Lots"
                  value={(data?.cheques.totalCount ?? 0).toString()}
                  sub="All cheque lots registered"
                  icon={BookOpen}
                  accentColor="#6366f1"
                  onClick={() => navigate("/masters/cheque")}
                />
                <FinanceGlassCard
                  label="Active Lots"
                  value={(data?.cheques.activeCount ?? 0).toString()}
                  sub={`${data?.cheques.totalCount ?? 0} total registered`}
                  icon={Clock}
                  accentColor="#f59e0b"
                  trend={
                    (data?.cheques.activeCount ?? 0) > 0 ? "up" : "neutral"
                  }
                  onClick={() => navigate("/masters/cheque")}
                />
                <FinanceGlassCard
                  label="Inactive Lots"
                  value={(data?.cheques.inactiveCount ?? 0).toString()}
                  sub="Deactivated cheque lots"
                  icon={CheckCircle2}
                  accentColor="#10b981"
                  onClick={() => navigate("/masters/cheque")}
                />
              </>
            )}
          </div>
        </GlassSection>

        {/* ── Quick Actions ─────────────────────────────────────────────────── */}
        <GlassSection
          title="Quick Actions"
          icon={CreditCard}
          accentColor="#8b5cf6"
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                label: "New Payment",
                icon: Receipt,
                path: "/payments",
                color: "#f43f5e",
              },
              {
                label: "New Received",
                icon: BadgeDollarSign,
                path: "/received-payments",
                color: "#10b981",
              },
              {
                label: "Cheques",
                icon: BookOpen,
                path: "/masters/cheque",
                color: "#f59e0b",
              },
              {
                label: "Cards",
                icon: CreditCard,
                path: "/masters/card",
                color: "#8b5cf6",
              },
              {
                label: "Banks",
                icon: Landmark,
                path: "/masters/banks",
                color: "#3b82f6",
              },
            ].map(({ label, icon: Icon, path, color }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="group flex flex-col items-center gap-3 py-5 rounded-xl transition-all duration-200 active:scale-95"
                style={{
                  background: isDark ? `${color}0A` : `${color}08`,
                  border: `1px solid ${color}25`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    `${color}18`;
                  (e.currentTarget as HTMLElement).style.borderColor =
                    `${color}40`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = isDark
                    ? `${color}0A`
                    : `${color}08`;
                  (e.currentTarget as HTMLElement).style.borderColor =
                    `${color}25`;
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{
                    background: `${color}20`,
                    border: `1px solid ${color}35`,
                  }}
                >
                  <Icon size={18} style={{ color }} />
                </div>
                <span
                  className="text-xs font-medium text-center leading-tight"
                  style={{ color: isDark ? "#cbd5e1" : "#475569" }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </GlassSection>
      </FinanceShell>
    </>
  );
};

export default FinanceDashboard;
