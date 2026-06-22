import React from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
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
    pendingCount: number;
    draftCount: number;
    clearedCount: number;
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

// ─── Mini info pill ───────────────────────────────────────────────────────────
const Pill = ({
  icon: Icon,
  label,
  value,
  color = "text-muted-foreground",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color?: string;
}) => (
  <div className="flex items-center gap-1.5">
    <Icon size={13} className={color} />
    <span className="text-xs text-muted-foreground">{label}:</span>
    <span className={`text-xs font-medium ${color}`}>{value}</span>
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
  cheques: { totalCount: 0, pendingCount: 0, draftCount: 0, clearedCount: 0 },
  cards: { totalCount: 0, activeCount: 0, inactiveCount: 0 },
  banks: { totalCount: 0, activeCount: 0 },
  recentPaymentsMade: [],
  recentPaymentsReceived: [],
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
  };
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const FinanceDashboard = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const {
    data: rawData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<FinanceDashboardData>({
    queryKey: ["financeDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/finance-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });

  const data = rawData ? normalise(rawData) : undefined;

  // ── Stat card definitions ──────────────────────────────────────────────────
  const primaryStats = data
    ? [
        {
          label: "Payments Made Today",
          value: data.paymentsMade.todayCount.toString(),
          sub: `${fmt(data.paymentsMade.todayAmount)} paid today · ${data.paymentsMade.totalCount} total`,
          icon: Receipt,
          trend: "up" as const,
          accent: "border-l-rose-500",
          iconBg: "bg-rose-500/10",
          iconColor: "text-rose-600",
          onClick: () => navigate("/payments"),
        },
        {
          label: "Received Payments Today",
          value: data.receivedPayments.todayCount.toString(),
          sub: `${fmt(data.receivedPayments.todayAmount)} received today · ${data.receivedPayments.totalCount} total`,
          icon: BadgeDollarSign,
          trend: "up" as const,
          accent: "border-l-emerald-500",
          iconBg: "bg-emerald-500/10",
          iconColor: "text-emerald-600",
          onClick: () => navigate("/received-payments"),
        },
        {
          label: "Pending Cheques",
          value: data.cheques.pendingCount.toString(),
          sub: `${data.cheques.clearedCount} cleared · ${data.cheques.totalCount} total`,
          icon: BookOpen,
          trend:
            data.cheques.pendingCount > 0
              ? ("down" as const)
              : ("neutral" as const),
          accent: "border-l-amber-500",
          iconBg: "bg-amber-500/10",
          iconColor: "text-amber-600",
          onClick: () => navigate("/masters/cheque"),
        },
        {
          label: "Active Cards",
          value: data.cards.activeCount.toString(),
          sub: `${data.cards.inactiveCount} inactive · ${data.cards.totalCount} total`,
          icon: CreditCard,
          trend: "neutral" as const,
          accent: "border-l-violet-500",
          iconBg: "bg-violet-500/10",
          iconColor: "text-violet-600",
          onClick: () => navigate("/masters/card"),
        },
      ]
    : [];

  const tableGlass = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(99,102,241,0.15)" : "1px solid rgba(99,102,241,0.18)",
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
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
            style={{ color: "#818cf8" }}
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
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
      <GlassSection title="Today's Activity" icon={Receipt} accentColor="#6366f1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            : [
                {
                  label: "Payments Made Today",
                  value: data?.paymentsMade.todayCount.toString() ?? "0",
                  sub: `${fmt(data?.paymentsMade.todayAmount ?? 0)} paid today · ${data?.paymentsMade.totalCount ?? 0} total`,
                  icon: Receipt,
                  accentColor: "#f43f5e",
                  onClick: () => navigate("/payments"),
                  trend: "up" as const,
                },
                {
                  label: "Received Today",
                  value: data?.receivedPayments.todayCount.toString() ?? "0",
                  sub: `${fmt(data?.receivedPayments.todayAmount ?? 0)} received · ${data?.receivedPayments.totalCount ?? 0} total`,
                  icon: BadgeDollarSign,
                  accentColor: "#10b981",
                  onClick: () => navigate("/received-payments"),
                  trend: "up" as const,
                },
                {
                  label: "Pending Cheques",
                  value: data?.cheques.pendingCount.toString() ?? "0",
                  sub: `${data?.cheques.clearedCount ?? 0} cleared · ${data?.cheques.totalCount ?? 0} total`,
                  icon: BookOpen,
                  accentColor: "#f59e0b",
                  onClick: () => navigate("/masters/cheque"),
                  trend: (data?.cheques.pendingCount ?? 0) > 0 ? "down" as const : "neutral" as const,
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
            Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
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

      {/* ── Recent tables ─────────────────────────────────────────────────── */}
      <GlassSection title="Recent Activity" icon={Receipt} accentColor="#6366f1">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Payments Made */}
          <div className="rounded-xl overflow-hidden" style={tableGlass}>
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: isDark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.12)" }}
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(244,63,94,0.15)" }}>
                  <Receipt size={11} style={{ color: "#f43f5e" }} />
                </div>
                <span className="text-xs font-heading font-semibold" style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}>
                  Recent Payments Made
                </span>
              </div>
              <button onClick={() => navigate("/payments")} className="text-[10px] font-medium hover:opacity-70 transition-opacity" style={{ color: "#f43f5e" }}>
                View all →
              </button>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : (data?.recentPaymentsMade.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground py-10 text-sm">No payments recorded yet</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b" style={{ borderColor: isDark ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.08)" }}>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Mode</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPaymentsMade ?? []).map((p) => (
                      <TableRow key={p.PPaymentID} className="border-b border-indigo-500/5 hover:bg-indigo-500/5 transition-colors">
                        <TableCell className="text-xs font-medium truncate max-w-[120px]">{p.PPaymentName || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] border-rose-500/30 text-rose-500">{p.PMode || "—"}</Badge></TableCell>
                        <TableCell className="text-xs text-right font-semibold" style={{ color: "#f43f5e" }}>{p.PAmount != null ? fmt(p.PAmount) : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(p.PDate)}</TableCell>
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
              style={{ borderColor: isDark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.12)" }}
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
                  <BadgeDollarSign size={11} style={{ color: "#10b981" }} />
                </div>
                <span className="text-xs font-heading font-semibold" style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}>
                  Recent Received Payments
                </span>
              </div>
              <button onClick={() => navigate("/received-payments")} className="text-[10px] font-medium hover:opacity-70 transition-opacity" style={{ color: "#10b981" }}>
                View all →
              </button>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : (data?.recentPaymentsReceived.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground py-10 text-sm">No received payments recorded yet</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b" style={{ borderColor: isDark ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.08)" }}>
                      <TableHead className="text-xs">From</TableHead>
                      <TableHead className="text-xs">Mode</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPaymentsReceived ?? []).map((r) => (
                      <TableRow key={r.RPPaymentID} className="border-b border-indigo-500/5 hover:bg-indigo-500/5 transition-colors">
                        <TableCell className="text-xs font-medium truncate max-w-[120px]">{r.RPReceivedFrom || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-500">{r.RPMode || "—"}</Badge></TableCell>
                        <TableCell className="text-xs text-right font-semibold" style={{ color: "#10b981" }}>{r.RPAmount != null ? fmt(r.RPAmount) : "—"}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            r.RPStatus === "Approved" ? "bg-emerald-500/15 text-emerald-500" :
                            r.RPStatus === "Draft" || !r.RPStatus ? "bg-amber-500/15 text-amber-500" :
                            "bg-blue-500/15 text-blue-500"
                          }`}>{r.RPStatus || "Draft"}</span>
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

      {/* ── Cheque summary + Quick Actions ───────────────────────────────── */}
      <GlassSection title="Cheque Summary" icon={BookOpen} accentColor="#f59e0b">
        {!isLoading && data && (
          <div className="rounded-xl p-4 flex flex-wrap gap-4" style={tableGlass}>
            {[
              { icon: BookOpen, label: "Total", value: data.cheques.totalCount, color: "#6366f1" },
              { icon: Clock, label: "Pending", value: data.cheques.pendingCount, color: data.cheques.pendingCount > 0 ? "#f59e0b" : "#64748b" },
              { icon: Clock, label: "Draft", value: data.cheques.draftCount, color: "#3b82f6" },
              { icon: CheckCircle2, label: "Cleared", value: data.cheques.clearedCount, color: "#10b981" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-2 rounded-lg" style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}20` }}>
                  <Icon size={13} style={{ color }} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wide">{label}</p>
                  <p className="text-base font-bold font-heading" style={{ color }}>{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassSection>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <GlassSection title="Quick Actions" icon={CreditCard} accentColor="#8b5cf6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "New Payment", icon: Receipt, path: "/payments", color: "#f43f5e" },
            { label: "New Received", icon: BadgeDollarSign, path: "/received-payments", color: "#10b981" },
            { label: "Cheques", icon: BookOpen, path: "/masters/cheque", color: "#f59e0b" },
            { label: "Cards", icon: CreditCard, path: "/masters/card", color: "#8b5cf6" },
            { label: "Banks", icon: Landmark, path: "/masters/banks", color: "#3b82f6" },
          ].map(({ label, icon: Icon, path, color }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="group flex flex-col items-center gap-3 py-5 rounded-xl transition-all duration-200 active:scale-95"
              style={{
                background: isDark ? `${color}0A` : `${color}08`,
                border: `1px solid ${color}25`,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}18`; (e.currentTarget as HTMLElement).style.borderColor = `${color}40`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isDark ? `${color}0A` : `${color}08`; (e.currentTarget as HTMLElement).style.borderColor = `${color}25`; }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110" style={{ background: `${color}20`, border: `1px solid ${color}35` }}>
                <Icon size={18} style={{ color }} />
              </div>
              <span className="text-xs font-medium text-center leading-tight" style={{ color: isDark ? "#cbd5e1" : "#475569" }}>{label}</span>
            </button>
          ))}
        </div>
      </GlassSection>

      </FinanceShell>
    </>
  );
};

export default FinanceDashboard;