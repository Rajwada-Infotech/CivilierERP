import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  ShieldCheck,
  Users,
  UserCheck,
  BarChart3,
  RefreshCw,
  Crown,
} from "lucide-react";
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

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

const AVATAR_PALETTE = [
  "bg-blue-500/15 text-blue-600",
  "bg-violet-500/15 text-violet-600",
  "bg-emerald-500/15 text-emerald-600",
  "bg-amber-500/15 text-amber-600",
  "bg-rose-500/15 text-rose-600",
  "bg-cyan-500/15 text-cyan-600",
];
const avatarColor = (seed: number) =>
  AVATAR_PALETTE[seed % AVATAR_PALETTE.length];

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
  const rights = usePageRights("admin-dashboard");
  const [justClicked, setJustClicked] = React.useState(false);
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
      return res.json().catch(() => ({}));
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
        return res.json().catch(() => ({}));
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

  const activeRatio =
    stats.totalUsers > 0
      ? Math.round((stats.activeUsers / stats.totalUsers) * 100)
      : 0;

  const minorStats = [
    {
      title: "Active Users",
      value: stats.activeUsers,
      sub: "currently enabled",
      icon: UserCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
      ring: "ring-emerald-500/20",
    },
    {
      title: "Inactive Users",
      value: stats.inactiveUsers,
      sub: "discontinued accounts",
      icon: ShieldCheck,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
      ring: "ring-amber-500/20",
    },
    {
      title: "Activity Logs",
      value: stats.recentActions,
      sub: "all time entries",
      icon: BarChart3,
      color: "text-violet-600",
      bg: "bg-violet-500/10",
      ring: "ring-violet-500/20",
    },
  ];

  const refreshAction = (
    <div className="flex items-center gap-2">
      {dataUpdatedAt > 0 && (
        <span className="text-xs text-muted-foreground hidden sm:block">
          Updated: {new Date(dataUpdatedAt).toLocaleTimeString("en-IN")}
        </span>
      )}
      <button
        onClick={() => {
          setJustClicked(true);
          setTimeout(() => setJustClicked(false), 600);
          refetch();
        }}
        disabled={isFetching}
        className={`group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/50 text-blue-700 transition-all duration-200 active:scale-90 disabled:opacity-70 ${
          justClicked ? "ring-2 ring-blue-500/30" : ""
        }`}
      >
        <RefreshCw
          size={13}
          className={`transition-transform ${
            isFetching || justClicked
              ? "animate-spin duration-500"
              : "duration-500 group-hover:rotate-180"
          }`}
        />
        Refresh
      </button>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Admin", "Dashboard"]} />
      <AdminShell
        title="Control Center"
        subtitle="Live overview of users, access & system activity"
        icon={Crown}
        action={refreshAction}
      >
        {dashError && (
          <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            Failed to load dashboard data — please try refreshing.
          </div>
        )}

        {/* ── Stat row: one spotlight card + three compact cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Spotlight: Total Users with active-ratio progress ring */}
          <div className="lg:col-span-1 relative overflow-hidden rounded-xl border border-blue-500/25 bg-gradient-to-br from-blue-600 to-indigo-600 text-white p-3.5 flex flex-col justify-between min-h-[100px]">
            <div
              className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)",
              }}
            />
            <div className="relative z-10 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Total Users
              </span>
              <div className="p-1 rounded-md bg-white/15">
                <Users size={13} />
              </div>
            </div>
            <div className="relative z-10">
              {loading ? (
                <div className="h-7 w-16 rounded-md bg-white/20 animate-pulse" />
              ) : (
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {stats.totalUsers.toLocaleString()}
                </div>
              )}
              <p className="text-[11px] text-white/70 mt-0.5">
                registered accounts
              </p>
            </div>
            <div className="relative z-10 mt-1.5">
              <div className="flex items-center justify-between text-[10px] text-white/70 mb-1">
                <span>Active ratio</span>
                <span className="font-semibold text-white">{activeRatio}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white/80 transition-all duration-700"
                  style={{ width: `${activeRatio}%` }}
                />
              </div>
            </div>
          </div>

          {minorStats.map((stat) => (
            <div
              key={stat.title}
              className={`rounded-xl border border-border bg-card p-3.5 flex flex-col justify-between min-h-[100px] hover:shadow-lg hover:-translate-y-0.5 transition-all ring-1 ring-transparent hover:${stat.ring}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {stat.title}
                </span>
                <div className={`p-1 rounded-md ${stat.bg}`}>
                  <stat.icon size={13} className={stat.color} />
                </div>
              </div>
              {loading ? (
                <div className="h-7 w-14 rounded-md bg-muted animate-pulse" />
              ) : (
                <div className="text-2xl font-bold tabular-nums text-foreground leading-none">
                  {stat.value.toLocaleString()}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Recent Users + Recent Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3.5 py-2 border-b border-border/60 flex items-center gap-2">
              <Users size={13} className="text-blue-600" />
              <h2 className="text-sm font-semibold">Recent Users</h2>
            </div>
            <div>
              {loading ? (
                <ul className="space-y-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li
                      key={i}
                      className="h-10 rounded-md bg-muted animate-pulse"
                    />
                  ))}
                </ul>
              ) : recentUsers.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No users found.
                </p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {recentUsers.map((user, i) => (
                    <li
                      key={user.id}
                      className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted/40 transition-colors"
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${avatarColor(i)}`}
                      >
                        {getInitials(user.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-xs truncate">
                          {user.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {user.email}
                        </p>
                      </div>
                      <span
                        className={`flex items-center gap-1.5 text-[10px] font-semibold shrink-0 ${
                          !user.discontinue
                            ? "text-emerald-600"
                            : "text-rose-600"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            !user.discontinue
                              ? "bg-emerald-500"
                              : "bg-rose-500"
                          }`}
                        />
                        {!user.discontinue ? "Active" : "Inactive"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3.5 py-2 border-b border-border/60 flex items-center gap-2">
              <BarChart3 size={13} className="text-violet-600" />
              <h2 className="text-sm font-semibold">Recent Activity</h2>
            </div>
            <div>
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
                <div className="relative px-3.5 py-2">
                  {/* Vertical timeline rail */}
                  <div className="absolute left-[22px] top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-1.5">
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
                          className="relative flex items-start gap-2.5 pl-0"
                        >
                          <div className="relative z-10 w-6 h-6 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                            <Icon className="h-3 w-3 text-violet-600" />
                          </div>
                          <div className="min-w-0 flex-1 rounded-lg bg-muted/30 px-2.5 py-1.5 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-foreground text-xs truncate">
                                {pageName}
                              </p>
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 whitespace-nowrap shrink-0 ${getRelativeTimeColor(activity.timestamp)}`}
                              >
                                {getRelativeTime(activity.timestamp)}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {subDetail}
                            </p>
                            <p className="text-[10px] text-muted-foreground/70">
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </AdminShell>
    </>
  );
}
