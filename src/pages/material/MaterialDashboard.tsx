import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Package, 
  Layers, 
  Truck, 
  FileText, 
  Calendar, 
  TrendingUp,
  Activity,
  Users,
} from 'lucide-react';
import { getItemGroups } from '@/api/itemGroupApi';
import { getItems } from '@/api/itemMasterApi';
import { getGRNs, getSuppliers, getPurchaseOrders, getItems as getGRNItems } from '@/api/grnApi';
import { getPurchaseOrders as getPOFromPOApi } from '@/api/purchaseOrdersApi';
// Native date utils

// Types (simplified)
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
}

const MaterialDashboard = () => {
  // Queries
  const { data: itemGroups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ['item-groups'],
    queryFn: getItemGroups,
  });

  const { data: itemMasters = [], isLoading: loadingItems } = useQuery({
    queryKey: ['item-master'],
    queryFn: getItems,
  });

  const { data: grns = [], isLoading: loadingGRNs } = useQuery({
    queryKey: ['grns'],
    queryFn: getGRNs,
  });

  const { data: pos = [], isLoading: loadingPOs } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: getPurchaseOrders as any, // from grnApi for now
  });

  // Metrics
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
  const grnsThisMonth = grns.filter((grn: GRN) => new Date(grn.GRNDate) >= thisMonth).length;
  const pendingPOs = pos.length; // Assume all pending or filter if status field

  const recentGRNs = grns.slice(0, 5).reverse();
  const recentPOs = pos.slice(0, 5).reverse();

  const StatsCard = ({ title, value, icon: Icon, trend }: { title: string; value: number; icon: React.ElementType; trend?: string }) => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Icon className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {trend && <p className="text-xs text-emerald-600">{trend}</p>}
          </div>
        </div>
      </CardHeader>
    </Card>
  );

  const QuickLink = ({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) => (
    <Button asChild variant="outline" className="flex-1 h-20 group">
      <Link to={to} className="flex flex-col items-center gap-2">
        <div className="p-3 bg-muted rounded-xl group-hover:bg-accent transition-colors">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{label}</span>
      </Link>
    </Button>
  );

  if (loadingGroups || loadingItems || loadingGRNs || loadingPOs) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array(7).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1 md:p-6">
      <Breadcrumbs items={["Dashboard", "Material"]} />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Item Groups" value={totalGroups} icon={Layers} />
        <StatsCard title="Items" value={totalItems} icon={Package} />
        <StatsCard title="Total GRNs" value={totalGRNs} icon={Truck} />
        <StatsCard title="Pending POs" value={pendingPOs} icon={FileText} />
        <StatsCard title="GRNs Today" value={grnsToday} icon={Calendar} />
        <StatsCard title="GRNs This Month" value={grnsThisMonth} icon={TrendingUp} />
        <StatsCard title="POs" value={totalPOs} icon={Activity} />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent GRNs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Recent GRNs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>PO</TableHead>
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
                    <TableCell>{new Date(grn.GRNDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</TableCell>
                    <TableCell>
                      <Badge>{grn.Status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {recentGRNs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No recent GRNs
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent POs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Purchase Orders
            </CardTitle>
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
                {recentPOs.map((po) => (
                  <TableRow key={String(po.PurchaseOrderID)}>
                    <TableCell className="font-medium">{po.PurchaseOrderNo}</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell><Badge>Pending</Badge></TableCell>
                  </TableRow>
                ))}
                {recentPOs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      No recent POs
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 p-0">
          <QuickLink to="/material/grn" label="New GRN" icon={Truck} />
          <QuickLink to="/material/purchase-order" label="Purchase Orders" icon={FileText} />
          <QuickLink to="/material/expense-booking" label="Expense Booking" icon={TrendingUp} />
          <QuickLink to="/material/work-order" label="Work Orders" icon={Activity} />
          <QuickLink to="/masters/item-groups" label="Item Groups" icon={Layers} />
          <QuickLink to="/masters/items" label="Items" icon={Package} />
          <QuickLink to="/masters/unit-measurement" label="UOM Master" icon={Users} />
          <QuickLink to="/material/t-c-master" label="T&amp;C" icon={FileText} />
        </CardContent>
      </Card>
    </div>
  );
};

export default MaterialDashboard;

