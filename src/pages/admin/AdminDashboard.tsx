import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  ShieldCheck,
  Users,
  UserCheck,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Lock } from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface AdminUser {
  id: number;
  name: string;
  email: string;
  created_datetime: string;
  discontinue: number;
}

interface ActivityRow {
  id: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: string;
  actionType: string;
  resource: string;
  details: string;
  timestamp: string;
}

interface DashboardPayload {
  stats: { totalUsers: number; totalRoles: number; activeUsers: number };
  recentUsers: AdminUser[];
}

interface ActivityPayload {
  data: ActivityRow[];
  total: number;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getRelativeTime = (timestamp: string) => {
  const diffMinutes = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000 / 60,
  );
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const getRelativeTimeColor = (timestamp: string) => {
  const diffMinutes = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000 / 60,
  );
  if (diffMinutes < 60) return "text-emerald-500";
  if (diffMinutes < 240) return "text-amber-500";
  return "text-muted-foreground";
};

const getActivityIcon = (event: string, actionType: string) => {
  if (event === "login" || event === "logout") return UserCheck;
  if (actionType === "settings_change") return Lock;
  if (actionType === "delete") return Shield;
  return BarChart3;
};

const PAGE_NAME_MAP: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  payments: "Payment",
  "received-payments": "Received Payment",
  transactions: "Transactions",
  brs: "BRS",
  reports: "Reports",
  "finance-dashboard": "Finance Dashboard",
  "material/purchase-order": "Purchase Order",
  "material/grn": "GRN",
  "material/material-request": "Material Request",
  "material/issues": "Material Issues",
  "material/stock": "Stock",
  "material/stock-transfer": "Stock Transfer",
  "material/expense-booking": "Expense Booking",
  "material/amendments": "Amendments",
  "material-dashboard": "Material Dashboard",
  "engineering/work-order": "Work Order",
  "engineering/boq": "BOQ",
  "engineering/work-done": "Work Done",
  "masters/contractors": "Contractors",
  "masters/suppliers": "Suppliers",
  "masters/customers": "Customers",
  "masters/banks": "Bank Master",
  "masters/expenses": "Expense Master",
  "masters/items": "Item Master",
  "masters/item-groups": "Item Groups",
  "masters/hsn": "HSN Master",
  "masters/account-group": "Account Group",
  "masters/billing-terms": "Billing Terms",
  "masters/general-ledger": "General Ledger",
  "masters/financial-year": "Financial Year",
  "masters/role-master": "Role Master",
  "masters/type-of-doc": "Type of Doc",
  "admin/rights/menu": "Menu Rights",
  "admin/rights/widgets": "Widgets Rights",
  "admin/rights/fin-year": "Fin Year Rights",
  "admin/approval/setup": "Approval Setup",
  "admin/masters/company": "Company Master",
  "admin/masters/project": "Project Master",
  "admin/masters/enterprise": "Enterprise",
  "admin/masters/menu-types": "Menu Types",
  "admin/masters/page-definitions": "Page Definitions",
  "followup/applicants": "Applicants",
  "followup/bookings": "Bookings",
  "followup/agreements": "Agreements",
  "followup/noc": "NOC",
  "followup/sales-deed": "Sales Deed",
  "followup/handover": "Handover",
  "followup/log": "Followup Log",
  tasks: "Tasks",
  "ticket/my-tickets": "My Tickets",
  "ticket/all-tickets": "All Tickets",
  "ticket/pending": "Pending Tickets",
  widgets: "Widgets",
  "approval-inbox": "Approval Inbox",
};

const getPageName = (resource?: string): string => {
  if (!resource) return "System";
  const clean = resource.replace(/^\//, "").split("?")[0];
  if (PAGE_NAME_MAP[clean]) return PAGE_NAME_MAP[clean];
  const match = Object.keys(PAGE_NAME_MAP)
    .sort((a, b) => b.length - a.length)
    .find((k) => clean.startsWith(k));
  if (match) return PAGE_NAME_MAP[match];
  const segments = clean.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? clean;
  return last.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const {
    data: dashData,
    isLoading: dashLoading,
    isError: dashError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery<DashboardPayload>({
    queryKey: ["adminDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: activityData, isLoading: activityLoading } =
    useQuery<ActivityPayload>({
      queryKey: ["adminActivity"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/user-activity?limit=6&page=1");
        if (!res.ok) throw new Error("Failed to fetch activity log");
        return res.json();
      },
      staleTime: 60_000,
      refetchInterval: 90_000,
      refetchOnWindowFocus: true,
    });

  const loading = dashLoading || activityLoading;

  const stats = dashData
    ? {
        totalUsers: dashData.stats.totalUsers,
        activeUsers: dashData.stats.activeUsers,
        inactiveUsers: dashData.stats.totalUsers - dashData.stats.activeUsers,
        recentActions: activityData?.total ?? 0,
      }
    : { totalUsers: 0, activeUsers: 0, inactiveUsers: 0, recentActions: 0 };

  const recentUsers = dashData?.recentUsers ?? [];
  const recentActivities = activityData?.data ?? [];

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers,
      sub: "registered accounts",
      icon: Users,
      color: "text-blue-500",
    },
    {
      title: "Active Users",
      value: stats.activeUsers,
      sub: "currently enabled",
      icon: UserCheck,
      color: "text-green-500",
    },
    {
      title: "Inactive Users",
      value: stats.inactiveUsers,
      sub: "discontinued accounts",
      icon: ShieldCheck,
      color: "text-orange-500",
    },
    {
      title: "Total Activity Logs",
      value: stats.recentActions,
      sub: "all time entries",
      icon: BarChart3,
      color: "text-purple-500",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Admin", "Dashboard"]} />
      <div className="relative p-6 space-y-8">
        <DashboardBackground />

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Admin Dashboard
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live data from your database
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Updated: {new Date(dataUpdatedAt).toLocaleTimeString("en-IN")}
              </span>
            )}
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
        </div>

        {dashError && (
          <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            Failed to load dashboard data — please try refreshing.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat) => (
            <Card
              className="hover:shadow-xl transition-all border-primary/20"
              key={stat.title}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs sm:text-sm font-medium line-clamp-2">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent className="pt-1">
                {loading ? (
                  <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
                ) : (
                  <div className="text-xl sm:text-2xl md:text-3xl font-bold">
                    {stat.value.toLocaleString()}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base">
                Recent Users
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-48 sm:h-56 md:h-64 lg:h-72 pr-4">
                {loading ? (
                  <ul className="space-y-2 p-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <li
                        key={i}
                        className="h-8 rounded-md bg-muted animate-pulse"
                      />
                    ))}
                  </ul>
                ) : recentUsers.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No users found.
                  </p>
                ) : (
                  <ul className="space-y-2 p-4 divide-y divide-border/50">
                    {recentUsers.map((user) => (
                      <li
                        key={user.id}
                        className="flex items-center justify-between py-2 px-1 text-xs sm:text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {user.email}
                          </p>
                        </div>
                        <Badge
                          className={`ml-2 px-1.5 sm:px-2.5 py-0.5 text-xs font-semibold border-2 transition-colors whitespace-nowrap ${
                            !user.discontinue
                              ? "border-green-500 bg-transparent text-green-700 hover:bg-green-500/10"
                              : "border-red-500 bg-transparent text-red-700 hover:bg-red-500/10"
                          }`}
                        >
                          {!user.discontinue ? "Active" : "Inactive"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="md:col-span-1 lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base">
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-64 sm:h-72 md:h-[18rem] lg:h-[20rem] xl:h-[22rem] pr-4">
                {loading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-14 rounded-lg bg-muted animate-pulse"
                      />
                    ))}
                  </div>
                ) : recentActivities.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No activity found.
                  </p>
                ) : (
                  <div className="space-y-2 p-3 sm:p-4">
                    {recentActivities.map((activity, i) => {
                      const Icon = getActivityIcon(
                        activity.event,
                        activity.actionType,
                      );
                      const pageName = getPageName(activity.resource);
                      const subDetail =
                        activity.details ||
                        (activity.actionType
                          ? activity.actionType.replace(/_/g, " ")
                          : activity.event);
                      return (
                        <div
                          key={activity.id || i}
                          className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 bg-gradient-to-r from-muted/30 to-accent/30 rounded-lg text-xs sm:text-sm hover:shadow-md hover:ring-1 hover:ring-primary/20 transition-all"
                        >
                          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-semibold text-foreground line-clamp-1 leading-tight">
                              {pageName}
                            </p>
                            <p className="text-xs text-muted-foreground leading-tight line-clamp-1">
                              {subDetail}
                            </p>
                            <p className="text-xs text-muted-foreground leading-tight">
                              by {activity.userName || activity.userEmail} •{" "}
                              {new Date(activity.timestamp).toLocaleString(
                                "en-IN",
                                {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-xs whitespace-nowrap ml-1 sm:ml-2 ${getRelativeTimeColor(activity.timestamp)}`}
                          >
                            {getRelativeTime(activity.timestamp)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
