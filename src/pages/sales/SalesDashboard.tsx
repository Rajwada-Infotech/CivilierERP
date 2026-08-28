import React, { useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  ShoppingCart,
  Receipt,
  CreditCard,
  CheckCircle2,
  Clock,
  TrendingUp,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { usePageRights } from "@/hooks/usePageRights";
import {
  SalesShell,
  SalesGlassCard,
  SalesSection,
} from "@/components/sales/SalesShell";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SalesDashboardData {
  saleOrders: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    draftCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
  saleInvoices: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    totalReceived: number;
    paidCount: number;
    pendingCount: number;
  };
  recentSaleOrders: RecentSaleOrder[];
  recentSaleInvoices: RecentSaleInvoice[];
}

interface RecentSaleOrder {
  SaleOrderID: number;
  DocNo: string;
  OrderDate: string;
  TotalAmount: number;
  Status: string;
  ToCompanyName: string;
}

interface RecentSaleInvoice {
  SaleInvoiceID: number;
  SaleInvoiceNo: string;
  InvoiceDate: string;
  Amount: number;
  AmountReceived: number;
  PaymentStatus: string;
  CustomerName: string;
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

const EMPTY_DATA: SalesDashboardData = {
  saleOrders: {
    totalCount: 0,
    todayCount: 0,
    totalAmount: 0,
    draftCount: 0,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
  },
  saleInvoices: {
    totalCount: 0,
    todayCount: 0,
    totalAmount: 0,
    totalReceived: 0,
    paidCount: 0,
    pendingCount: 0,
  },
  recentSaleOrders: [],
  recentSaleInvoices: [],
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const SalesDashboard = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  usePageRights("sales-dashboard");

  const isDark = theme !== "light";

  const {
    data: rawData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<SalesDashboardData>({
    queryKey: ["salesDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/sales-dashboard`);
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return res.json().catch(() => ({}));
    },
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const data = rawData ?? EMPTY_DATA;

  const tableGlass = useMemo(
    () => ({
      background: isDark ? "rgba(17,11,26,0.5)" : "rgba(255,255,255,0.72)",
      border: isDark
        ? "1px solid rgba(168,85,247,0.15)"
        : "1px solid rgba(168,85,247,0.18)",
      backdropFilter: "blur(16px) saturate(150%)",
      WebkitBackdropFilter: "blur(16px) saturate(150%)",
      boxShadow: isDark
        ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
        : "0 4px 24px rgba(168,85,247,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
    }),
    [isDark],
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales"]} />
      <DashboardBackground />
      <SalesShell
        title="Sales Overview"
        subtitle="Sale orders, invoices and collections at a glance"
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-violet-500/30 hover:bg-violet-500/10 transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ color: "#c084fc" }}
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
        <SalesSection
          title="Today's Activity"
          icon={ShoppingCart}
          accentColor="#a855f7"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            ) : (
              <>
                <SalesGlassCard
                  label="Sale Orders Today"
                  value={data.saleOrders.todayCount.toString()}
                  sub={`${data.saleOrders.totalCount} total orders`}
                  icon={ShoppingCart}
                  accentColor="#a855f7"
                  onClick={() => navigate("/sales/sale-order")}
                  trend="up"
                />
                <SalesGlassCard
                  label="Invoices Today"
                  value={data.saleInvoices.todayCount.toString()}
                  sub={`${data.saleInvoices.totalCount} total invoices`}
                  icon={Receipt}
                  accentColor="#d946ef"
                  onClick={() => navigate("/sales/sale-invoice")}
                  trend="up"
                />
                <SalesGlassCard
                  label="Total Order Value"
                  value={fmt(data.saleOrders.totalAmount)}
                  sub={`${data.saleOrders.approvedCount} approved · ${data.saleOrders.pendingCount} pending`}
                  icon={TrendingUp}
                  accentColor="#8b5cf6"
                  onClick={() => navigate("/sales/sale-order")}
                />
                <SalesGlassCard
                  label="Amount Received"
                  value={fmt(data.saleInvoices.totalReceived)}
                  sub={`of ${fmt(data.saleInvoices.totalAmount)} invoiced`}
                  icon={CreditCard}
                  accentColor="#10b981"
                  onClick={() => navigate("/sales/payment")}
                />
              </>
            )}
          </div>
        </SalesSection>

        {/* ── Pipeline summary ─────────────────────────────────────────────── */}
        <SalesSection
          title="Pipeline Summary"
          icon={Clock}
          accentColor="#a855f7"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            ) : (
              <>
                <SalesGlassCard
                  label="Draft Orders"
                  value={data.saleOrders.draftCount.toString()}
                  sub="Not yet submitted"
                  icon={Clock}
                  accentColor="#3b82f6"
                  onClick={() => navigate("/sales/sale-order")}
                />
                <SalesGlassCard
                  label="Pending Approval"
                  value={data.saleOrders.pendingCount.toString()}
                  sub="Awaiting approval"
                  icon={Clock}
                  accentColor="#f59e0b"
                  onClick={() => navigate("/sales/sale-order")}
                />
                <SalesGlassCard
                  label="Invoices Paid"
                  value={data.saleInvoices.paidCount.toString()}
                  sub="Fully settled"
                  icon={CheckCircle2}
                  accentColor="#10b981"
                  onClick={() => navigate("/sales/sale-invoice")}
                />
                <SalesGlassCard
                  label="Invoices Pending"
                  value={data.saleInvoices.pendingCount.toString()}
                  sub="Payment outstanding"
                  icon={Clock}
                  accentColor="#ef4444"
                  onClick={() => navigate("/sales/sale-invoice")}
                />
              </>
            )}
          </div>
        </SalesSection>

        {/* ── Recent tables ─────────────────────────────────────────────────── */}
        <SalesSection title="Recent Activity" icon={Receipt} accentColor="#a855f7">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent Sale Orders */}
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{
                  borderColor: isDark
                    ? "rgba(168,85,247,0.15)"
                    : "rgba(168,85,247,0.12)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(168,85,247,0.15)" }}
                  >
                    <ShoppingCart size={11} style={{ color: "#a855f7" }} />
                  </div>
                  <span
                    className="text-xs font-heading font-semibold"
                    style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
                  >
                    Recent Sale Orders
                  </span>
                </div>
                <button
                  onClick={() => navigate("/sales/sale-order")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#a855f7" }}
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
              ) : data.recentSaleOrders.length === 0 ? (
                <div className="text-center text-muted-foreground py-10 text-sm">
                  No sale orders recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="border-b"
                        style={{
                          borderColor: isDark
                            ? "rgba(168,85,247,0.10)"
                            : "rgba(168,85,247,0.08)",
                        }}
                      >
                        <TableHead className="text-xs">Doc No</TableHead>
                        <TableHead className="text-xs">To</TableHead>
                        <TableHead className="text-xs text-right">
                          Amount
                        </TableHead>
                        <TableHead className="text-xs">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentSaleOrders.map((o) => (
                        <TableRow
                          key={o.SaleOrderID}
                          className="border-b border-violet-500/5 hover:bg-violet-500/5 transition-colors"
                        >
                          <TableCell className="text-xs font-mono font-medium">
                            {o.DocNo || "—"}
                          </TableCell>
                          <TableCell className="text-xs truncate max-w-[120px]">
                            {o.ToCompanyName || "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right font-semibold"
                            style={{ color: "#a855f7" }}
                          >
                            {o.TotalAmount != null ? fmt(o.TotalAmount) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDate(o.OrderDate)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Recent Sale Invoices */}
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{
                  borderColor: isDark
                    ? "rgba(168,85,247,0.15)"
                    : "rgba(168,85,247,0.12)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(217,70,239,0.15)" }}
                  >
                    <Receipt size={11} style={{ color: "#d946ef" }} />
                  </div>
                  <span
                    className="text-xs font-heading font-semibold"
                    style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}
                  >
                    Recent Sale Invoices
                  </span>
                </div>
                <button
                  onClick={() => navigate("/sales/sale-invoice")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#d946ef" }}
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
              ) : data.recentSaleInvoices.length === 0 ? (
                <div className="text-center text-muted-foreground py-10 text-sm">
                  No sale invoices recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="border-b"
                        style={{
                          borderColor: isDark
                            ? "rgba(168,85,247,0.10)"
                            : "rgba(168,85,247,0.08)",
                        }}
                      >
                        <TableHead className="text-xs">Customer</TableHead>
                        <TableHead className="text-xs text-right">
                          Amount
                        </TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentSaleInvoices.map((inv) => (
                        <TableRow
                          key={inv.SaleInvoiceID}
                          className="border-b border-violet-500/5 hover:bg-violet-500/5 transition-colors"
                        >
                          <TableCell className="text-xs font-medium truncate max-w-[120px]">
                            {inv.CustomerName || "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right font-semibold"
                            style={{ color: "#d946ef" }}
                          >
                            {inv.Amount != null ? fmt(inv.Amount) : "—"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                inv.PaymentStatus === "Paid"
                                  ? "bg-emerald-500/15 text-emerald-500"
                                  : "bg-amber-500/15 text-amber-500"
                              }`}
                            >
                              {inv.PaymentStatus || "Pending Payment"}
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
        </SalesSection>

        {/* ── Quick Actions ─────────────────────────────────────────────────── */}
        <SalesSection title="Quick Actions" icon={CreditCard} accentColor="#a855f7">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              {
                label: "New Sale Order",
                icon: ShoppingCart,
                path: "/sales/sale-order",
                color: "#a855f7",
              },
              {
                label: "New Sale Invoice",
                icon: Receipt,
                path: "/sales/sale-invoice",
                color: "#d946ef",
              },
              {
                label: "Payments",
                icon: CreditCard,
                path: "/sales/payment",
                color: "#10b981",
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
        </SalesSection>
      </SalesShell>
    </>
  );
};

export default SalesDashboard;
