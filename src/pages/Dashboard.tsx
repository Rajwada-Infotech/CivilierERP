import React from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Badge 
} from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  Users,
  FileText,
  Package,
  Clock,
  DollarSign,
  Truck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const Dashboard = () => {
  // Mock data for overview - replace with real API calls later
  const stats = [
    { label: 'Transactions Today', value: '24', change: '+12%', icon: TrendingUp, trend: 'up' },
    { label: 'Pending Approvals', value: '3', change: '-2', icon: Clock, trend: 'down' },
    { label: 'Open POs', value: '5', change: '+1', icon: Truck, trend: 'up' },
    { label: 'Outstanding Payments', value: '₹45,200', change: '+8%', icon: DollarSign, trend: 'up' },
  ];

  const recentActivity = [
    { id: 'PO#1001', description: 'Purchase Order approved', user: 'Rahul K.', time: '2h ago', status: 'success' },
    { id: 'INV-456', description: 'Payment received from ABC Corp', user: 'Admin', time: '4h ago', status: 'success' },
    { id: 'WO-789', description: 'Work Order #789 pending approval', user: 'Manager', time: '6h ago', status: 'pending' },
    { id: 'GRN-321', description: 'GRN created for Item Group A', user: 'Rahul K.', time: '8h ago', status: 'success' },
  ];

  const mastersOverview = [
    { label: 'Items', count: 245, href: '/masters/items' },
    { label: 'Suppliers', count: 67, href: '/masters/suppliers' },
    { label: 'Customers', count: 42, href: '/masters/customers' },
    { label: 'POs', count: 156, href: '/material/purchase-order' },
  ];

  return (
    <>
      <Breadcrumbs items={['Dashboard']} />
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.change} from yesterday
              </p>
              <span className={`text-xs ${stat.trend === 'up' ? 'text-green-500' : 'text-destructive'}`}>
                {stat.trend === 'up' ? '↑' : '↓'}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Recent Activity
            </CardTitle>
            <CardDescription>Last 8 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((activity, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">#{activity.id}</TableCell>
                    <TableCell>{activity.description}</TableCell>
                    <TableCell>
                      <div className="font-medium">{activity.user}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={activity.status === 'success' ? 'default' : 'secondary'}>
                        {activity.status === 'success' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                        {activity.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Masters Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Masters Overview</CardTitle>
            <CardDescription>Key master data counts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {mastersOverview.map((master, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{master.label}</p>
                  <p className="text-xs text-muted-foreground">Total records</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{master.count.toLocaleString()}</div>
                  <Button variant="ghost" size="sm" className="h-6 mt-1">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Jump to common workflows</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          <Button variant="outline" className="h-20 flex flex-col gap-2">
            <FileText className="h-6 w-6" />
            New Journal
          </Button>
          <Button variant="outline" className="h-20 flex flex-col gap-2">
            <Package className="h-6 w-6" />
            New PO
          </Button>
          <Button variant="outline" className="h-20 flex flex-col gap-2">
            <Users className="h-6 w-6" />
            New Supplier
          </Button>
          <Button variant="outline" className="h-20 flex flex-col gap-2">
            <DollarSign className="h-6 w-6" />
            Record Payment
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default Dashboard;

