import React from "react";
import { useQuery } from "@tanstack/react-query";
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
  Package,
  Truck,
  FileText,
  Layers,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import { getItemGroups } from "@/api/itemGroupApi";
import { getItems } from "@/api/itemMasterApi";
import { getGRNs } from "@/api/grnApi";
import { getPurchaseOrders } from "@/api/purchaseOrdersApi";

interface GRN {
  GRNID: string;
  GRNNo: string;
  GRNDate: string;
  SupplierName: string;
  Status: string;
  PONumber: string;
}

interface PO {
  PurchaseOrderID: string;
  PurchaseOrderNo: string;
  SupplierName?: string;
  Status?: string;
}

const MaterialDashboard = () => {
  // Queries
  const { data: itemGroups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
  });

  const { data: itemMasters = [], isLoading: loadingItems } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });

  const { data: grns = [], isLoading: loadingGRNs } = useQuery({
    queryKey: ["grns"],
    queryFn: getGRNs,
  });

  const { data: pos = [], isLoading: loadingPOs } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: getPurchaseOrders,
  });

  const totalGroups = itemGroups.length;
  const totalItems = itemMasters.length;
  const totalGRNs = grns.length;
  const totalPOs = pos.length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const grnsToday = grns.filter((grn: GRN) => {
    const d = new Date(grn.GRNDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }).length;

  const grnsThisMonth = grns.filter(
    (grn: GRN) => new Date(grn.GRNDate) >= thisMonth,
  ).length;

  const recentGRNs = grns.slice(0, 5).reverse();
  const recentPOs = pos.slice(0, 5).reverse();

  const isLoading = loadingGroups || loadingItems || loadingGRNs || loadingPOs;

  const stats = [
    {
      label: "Total Items",
      value: totalItems.toLocaleString(),
      icon: Package,
      change: "+12",
      trend: "up",
    },
    {
      label: "Item Groups",
      value: totalGroups.toLocaleString(),
      icon: Layers,
      change: "+3",
      trend: "up",
    },
    {
      label: "Total GRNs",
      value: totalGRNs.toLocaleString(),
      icon: Truck,
      change: "+8",
      trend: "up",
    },
    {
      label: "Pending POs",
      value: totalPOs.toLocaleString(),
      icon: FileText,
      change: "-2",
      trend: "down",
    },
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array(4)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material"]} />

      {/* Stats Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.label}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {stat.change} from last month
                <span
                  className={`text-xs ${stat.trend === "up" ? "text-green-500" : "text-destructive"}`}
                >
                  {stat.trend === "up" ? "↑" : "↓"}
                </span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent GRNs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Recent GRNs
            </CardTitle>
            <CardDescription>Last 5 Goods Received Notes</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>PO No</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentGRNs.map((grn: GRN) => (
                  <TableRow key={grn.GRNID}>
                    <TableCell className="font-medium">{grn.GRNNo}</TableCell>
                    <TableCell>{grn.PONumber}</TableCell>
                    <TableCell>{grn.SupplierName}</TableCell>
                    <TableCell>
                      {new Date(grn.GRNDate).toLocaleDateString("en-GB", {
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {grn.Status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {recentGRNs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No recent GRNs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Purchase Orders */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Purchase Orders
            </CardTitle>
            <CardDescription>Last 5 POs</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO No</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPOs.map((po: PO) => (
                  <TableRow key={po.PurchaseOrderID}>
                    <TableCell className="font-medium">
                      {po.PurchaseOrderNo}
                    </TableCell>
                    <TableCell>{po.SupplierName || "N/A"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        {po.Status || "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {recentPOs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No recent Purchase Orders
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default MaterialDashboard;
