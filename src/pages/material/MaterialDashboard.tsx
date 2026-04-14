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
  Package,
  Truck,
  FileText,
  Layers,
  HardHat,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
} from "lucide-react";

// ─── API ──────────────────────────────────────────────────────────────────────

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

interface DashboardData {
  items: { count: number; groupCount: number };
  grns: { total: number; thisMonth: number; today: number };
  purchaseOrders: { total: number; open: number; openValue: number };
  workOrders: { total: number };
  recentGRNs: any[];
  recentPOs: any[];
}

const fetchDashboard = async (): Promise<DashboardData> => {
  const res = await fetch("/api/material-dashboard", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch material dashboard");
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
      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
        <Icon size={15} className="text-emerald-600" />
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

const StatSkeleton = () => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-8 rounded-lg" />
    </CardHeader>
    <CardContent>
      <Skeleton className="h-7 w-20 mb-2" />
      <Skeleton className="h-3 w-32" />
    </CardContent>
  </Card>
);

// ─── Component ────────────────────────────────────────────────────────────────

const MaterialDashboard = () => {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["materialDashboard"],
    queryFn: fetchDashboard,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const stats = data
    ? [
        {
          label: "Total Items",
          value: data.items.count.toLocaleString(),
          sub: `${data.items.groupCount} item groups`,
          icon: Package,
          trend: "neutral" as const,
          onClick: () => navigate("/masters/items"),
        },
        {
          label: "GRNs This Month",
          value: data.grns.thisMonth.toLocaleString(),
          sub: `${data.grns.today} today · ${data.grns.total} total`,
          icon: Truck,
          trend: "up" as const,
          onClick: () => navigate("/material/grn"),
        },
        {
          label: "Open Purchase Orders",
          value: data.purchaseOrders.open.toLocaleString(),
          sub: `${fmt(data.purchaseOrders.openValue)} outstanding`,
          icon: ShoppingCart,
          trend:
            data.purchaseOrders.open > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => navigate("/material/purchase-order"),
        },
        {
          label: "Work Orders",
          value: data.workOrders.total.toLocaleString(),
          sub: `${data.purchaseOrders.total} total POs`,
          icon: HardHat,
          trend: "neutral" as const,
          onClick: () => navigate("/material/work-order"),
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-6">
        Material Overview
      </h1>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
          Failed to load dashboard data. Please refresh.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent GRNs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-heading font-semibold flex items-center gap-2">
                <Truck size={15} /> Recent GRNs
              </CardTitle>
              <CardDescription>Last 5 goods receipt notes</CardDescription>
            </div>
            <button
              onClick={() => navigate("/material/grn")}
              className="text-xs text-emerald-600 hover:underline font-heading"
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
            ) : (data?.recentGRNs.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10">
                No GRNs recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">GRN No</TableHead>
                      <TableHead className="text-xs">Supplier</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.recentGRNs ?? []).map((grn: any) => (
                      <TableRow key={grn.GRNID} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-medium">
                          {grn.GRNNo}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {grn.SupplierName || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fmtDate(grn.GRNDate)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 ${
                              grn.Status === "Fully Received"
                                ? "border-emerald-500/40 text-emerald-600"
                                : "border-amber-500/40 text-amber-600"
                            }`}
                          >
                            {grn.Status || "Draft"}
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

        {/* Recent POs */}
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
              className="text-xs text-emerald-600 hover:underline font-heading"
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
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[100px]">
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

      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm font-heading font-semibold">
            Quick Actions
          </CardTitle>
          <CardDescription>Jump to common workflows</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
          {[
            { label: "New GRN", icon: Truck, path: "/material/grn" },
            {
              label: "New Purchase Order",
              icon: ShoppingCart,
              path: "/material/purchase-order",
            },
            {
              label: "New Work Order",
              icon: HardHat,
              path: "/material/work-order",
            },
            { label: "Manage Items", icon: Package, path: "/masters/items" },
          ].map(({ label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-emerald-500/20 transition-all duration-150 active:scale-95 group"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/15 transition-colors">
                <Icon size={16} className="text-emerald-600" />
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

export default MaterialDashboard;
