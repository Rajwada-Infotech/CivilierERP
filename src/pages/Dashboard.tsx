import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  Users,
  FileText,
  Package,
  CreditCard,
  Landmark,
  Truck,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  BookOpen,
  Receipt,
} from "lucide-react";

// ─── API ──────────────────────────────────────────────────────────────────────

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

interface DashboardData {
  payments: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
  };
  purchaseOrders: {
    totalCount: number;
    openCount: number;
    totalValue: number;
    openValue: number;
  };
  grns: { totalCount: number; thisMonthCount: number };
  cheques: { totalCount: number; pendingCount: number };
  parties: {
    supplierCount: number;
    customerCount: number;
    activeGLCount: number;
  };
  recentPayments: any[];
  recentPOs: any[];
}

const fetchDashboard = async (): Promise<DashboardData> => {
  const res = await fetch("/api/finance-dashboard", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard data");
  return res.json();
};

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
    className={`relative overflow-hidden transition-all duration-200 ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""}`}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["financeDashboard"],
    queryFn: fetchDashboard,
    staleTime: 60_000, // 1 min
    refetchOnWindowFocus: false,
  });

  const stats = data
    ? [
        {
          label: "Payments Today",
          value: data.payments.todayCount.toString(),
          sub: `${fmt(data.payments.todayAmount)} collected today`,
          icon: Receipt,
          trend: "up" as const,
          onClick: () => navigate("/payments"),
        },
        {
          label: "Open Purchase Orders",
          value: data.purchaseOrders.openCount.toString(),
          sub: `${fmt(data.purchaseOrders.openValue)} outstanding`,
          icon: ShoppingCart,
          trend:
            data.purchaseOrders.openCount > 0
              ? ("up" as const)
              : ("neutral" as const),
          onClick: () => navigate("/material/purchase-order"),
        },
        {
          label: "GRNs This Month",
          value: data.grns.thisMonthCount.toString(),
          sub: `${data.grns.totalCount} total receipts`,
          icon: Package,
          trend: "neutral" as const,
          onClick: () => navigate("/material/grn"),
        },
        {
          label: "Pending Cheques",
          value: data.cheques.pendingCount.toString(),
          sub: `${data.cheques.totalCount} total cheques`,
          icon: BookOpen,
          trend:
            data.cheques.pendingCount > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => navigate("/masters/cheque"),
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-6">
        Finance Overview
      </h1>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
          Failed to load dashboard data. Please refresh.
        </div>
      )}

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))
          : stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* ── Party + GL counts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Suppliers"
              value={(data?.parties.supplierCount ?? 0).toString()}
              sub="Active suppliers"
              icon={Truck}
              onClick={() => navigate("/masters/suppliers")}
            />
            <StatCard
              label="Customers"
              value={(data?.parties.customerCount ?? 0).toString()}
              sub="Active customers"
              icon={Users}
              onClick={() => navigate("/masters/customers")}
            />
            <StatCard
              label="GL Heads"
              value={(data?.parties.activeGLCount ?? 0).toString()}
              sub="Active ledger heads"
              icon={Landmark}
              onClick={() => navigate("/masters/general-ledger")}
            />
          </>
        )}
      </div>

      {/* ── Tables ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
                <CreditCard size={15} /> Recent Payments
              </CardTitle>
              <CardDescription>Last 8 payment entries</CardDescription>
            </div>
            <button
              onClick={() => navigate("/payments")}
              className="text-xs text-primary hover:underline font-heading"
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
            ) : (data?.recentPayments.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10">
                No payments recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Mode</TableHead>
                      <TableHead className="text-xs text-right">
                        Amount
                      </TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPayments ?? []).map((p: any) => (
                      <TableRow
                        key={p.PPaymentID}
                        className="hover:bg-muted/30"
                      >
                        <TableCell className="text-xs font-medium truncate max-w-[120px]">
                          {p.PPaymentName || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {p.PMode || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-emerald-600">
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
          </CardContent>
        </Card>

        {/* Recent Purchase Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
                <FileText size={15} /> Recent Purchase Orders
              </CardTitle>
              <CardDescription>Last 5 purchase orders</CardDescription>
            </div>
            <button
              onClick={() => navigate("/material/purchase-order")}
              className="text-xs text-primary hover:underline font-heading"
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
            ) : (data?.recentPOs.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10">
                No purchase orders yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">PO No</TableHead>
                      <TableHead className="text-xs">Supplier</TableHead>
                      <TableHead className="text-xs text-right">
                        Value
                      </TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentPOs ?? []).map((po: any) => (
                      <TableRow
                        key={po.PurchaseOrderID}
                        className="hover:bg-muted/30"
                      >
                        <TableCell className="text-xs font-medium">
                          {po.PurchaseOrderNo || `#${po.PurchaseOrderID}`}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {po.SupplierName || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          {po.TotalAmount != null ? fmt(po.TotalAmount) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 ${
                              po.Status === "Closed"
                                ? "border-emerald-500/40 text-emerald-600"
                                : po.Status === "Approved"
                                  ? "border-blue-500/40 text-blue-600"
                                  : "border-amber-500/40 text-amber-600"
                            }`}
                          >
                            {po.Status || "Draft"}
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

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm font-heading font-semibold">
            Quick Actions
          </CardTitle>
          <CardDescription>Jump to common workflows</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
          {[
            { label: "New Payment", icon: Receipt, path: "/payments" },
            {
              label: "New Purchase Order",
              icon: ShoppingCart,
              path: "/material/purchase-order",
            },
            { label: "New GRN", icon: Package, path: "/material/grn" },
            {
              label: "Manage Suppliers",
              icon: Truck,
              path: "/masters/suppliers",
            },
          ].map(({ label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                <Icon size={16} className="text-primary" />
              </div>
              <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight">
                {label}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

export default Dashboard;
