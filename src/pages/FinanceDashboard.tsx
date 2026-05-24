import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  TrendingUp,
  RefreshCw,
  CreditCard,
  Landmark,
  BookOpen,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  BadgeDollarSign,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

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

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}) => (
  <Card
    className={`relative overflow-hidden transition-all duration-200 ${
      onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""
    }`}
    onClick={onClick}
  >
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-xs font-heading uppercase tracking-widest text-muted-foreground">
        {label}
      </CardTitle>
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon size={15} className="text-primary" />
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold font-heading text-foreground">
        {value}
      </div>
      <div className="flex items-center gap-1 mt-1">
        {trend === "up" && (
          <ArrowUpRight size={13} className="text-emerald-500" />
        )}
        {trend === "down" && (
          <ArrowDownRight size={13} className="text-destructive" />
        )}
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </CardContent>
  </Card>
);

const StatCardSkeleton = () => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-8 rounded-lg" />
    </CardHeader>
    <CardContent>
      <Skeleton className="h-7 w-24 mb-2" />
      <Skeleton className="h-3 w-32" />
    </CardContent>
  </Card>
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
          onClick: () => navigate("/payments"),
        },
        {
          label: "Received Payments Today",
          value: data.receivedPayments.todayCount.toString(),
          sub: `${fmt(data.receivedPayments.todayAmount)} received today · ${data.receivedPayments.totalCount} total`,
          icon: BadgeDollarSign,
          trend: "up" as const,
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
          onClick: () => navigate("/masters/cheque"),
        },
        {
          label: "Active Cards",
          value: data.cards.activeCount.toString(),
          sub: `${data.cards.inactiveCount} inactive · ${data.cards.totalCount} total`,
          icon: CreditCard,
          trend: "neutral" as const,
          onClick: () => navigate("/masters/card"),
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance"]} />
      <div className="relative p-6 space-y-8">
        <DashboardBackground />

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Finance Overview
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Payments, cheques, cards and bank accounts at a glance
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={isFetching ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

      {isError && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
          Failed to load dashboard data. Please refresh the page.
        </div>
      )}

      {/* ── Primary stat cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))
          : primaryStats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* ── Banks row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Bank Accounts"
              value={(data?.banks.activeCount ?? 0).toString()}
              sub={`${data?.banks.totalCount ?? 0} total bank heads`}
              icon={Landmark}
              onClick={() => navigate("/masters/banks")}
            />
            <StatCard
              label="Total Payments Made"
              value={fmt(data?.paymentsMade.totalAmount ?? 0)}
              sub={`${data?.paymentsMade.totalCount ?? 0} entries all-time`}
              icon={Receipt}
              trend="neutral"
            />
            <StatCard
              label="Total Payments Received"
              value={fmt(data?.receivedPayments.totalAmount ?? 0)}
              sub={`${data?.receivedPayments.approvedCount ?? 0} approved · ${data?.receivedPayments.draftCount ?? 0} draft`}
              icon={BadgeDollarSign}
              trend="neutral"
            />
          </>
        )}
      </div>

      {/* ── Recent tables ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Payments Made */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-heading flex items-center gap-2">
                <Receipt size={16} /> Recent Payments Made
              </CardTitle>
              <CardDescription>Last 8 entries</CardDescription>
            </div>
            <button
              onClick={() => navigate("/payments")}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
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
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPaymentsMade ?? []).map((p) => (
                      <TableRow key={p.PPaymentID}>
                        <TableCell className="font-medium truncate max-w-[140px]">
                          {p.PPaymentName || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{p.PMode || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-rose-600">
                          {p.PAmount != null ? fmt(p.PAmount) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtDate(p.PDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Received Payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-heading flex items-center gap-2">
                <BadgeDollarSign size={16} /> Recent Received Payments
              </CardTitle>
              <CardDescription>Last 8 entries</CardDescription>
            </div>
            <button
              onClick={() => navigate("/received-payments")}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
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
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPaymentsReceived ?? []).map((r) => (
                      <TableRow key={r.RPPaymentID}>
                        <TableCell className="font-medium truncate max-w-[140px]">
                          {r.RPReceivedFrom || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.RPMode || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          {r.RPAmount != null ? fmt(r.RPAmount) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              r.RPStatus === "Approved"
                                ? "border-emerald-500 text-emerald-600"
                                : r.RPStatus === "Draft" || !r.RPStatus
                                  ? "border-amber-500 text-amber-600"
                                  : "border-blue-500 text-blue-600"
                            }
                          >
                            {r.RPStatus || "Draft"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Cheque breakdown card ─────────────────────────────────────────── */}
      {!isLoading && data && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-heading flex items-center gap-2">
              <BookOpen size={16} /> Cheque Summary
            </CardTitle>
            <CardDescription>
              Breakdown of all cheques in the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6">
              <Pill
                icon={BookOpen}
                label="Total"
                value={data.cheques.totalCount}
              />
              <Pill
                icon={Clock}
                label="Pending"
                value={data.cheques.pendingCount}
                color={
                  data.cheques.pendingCount > 0
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }
              />
              <Pill
                icon={Clock}
                label="Draft"
                value={data.cheques.draftCount}
                color="text-blue-500"
              />
              <Pill
                icon={CheckCircle2}
                label="Cleared"
                value={data.cheques.clearedCount}
                color="text-emerald-500"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common finance workflows</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "New Payment", icon: Receipt, path: "/payments" },
            {
              label: "New Received Payment",
              icon: BadgeDollarSign,
              path: "/received-payments",
            },
            {
              label: "Manage Cheques",
              icon: BookOpen,
              path: "/masters/cheque",
            },
            { label: "Manage Cards", icon: CreditCard, path: "/masters/card" },
            { label: "Manage Banks", icon: Landmark, path: "/masters/banks" },
          ].map(({ label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center gap-3 py-6 rounded-xl border border-border hover:bg-muted hover:border-primary/30 transition-all active:scale-95"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon size={20} className="text-primary" />
              </div>
              <span className="text-sm font-medium text-center leading-tight">
                {label}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
    </>
  );
};

export default FinanceDashboard;