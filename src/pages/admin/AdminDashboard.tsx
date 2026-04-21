import React, { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  recentActions: number;
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

// Pick an icon based on the activity event/action
const getActivityIcon = (event: string, actionType: string) => {
  if (event === "login" || event === "logout") return UserCheck;
  if (actionType === "settings_change") return Lock;
  if (actionType === "delete") return Shield;
  return BarChart3;
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    inactiveUsers: 0,
    recentActions: 0,
  });
  const [recentUsers, setRecentUsers] = useState<AdminUser[]>([]);
  const [recentActivities, setRecentActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, activityRes] = await Promise.all([
        fetchWithAuth("/api/admin-dashboard"),
        fetchWithAuth("/api/user-activity?limit=6&page=1"),
      ]);

      if (!dashRes.ok) throw new Error("Failed to fetch dashboard");
      if (!activityRes.ok) throw new Error("Failed to fetch activity log");

      const dash: {
        stats: { totalUsers: number; totalRoles: number; activeUsers: number };
        recentUsers: AdminUser[];
      } = await dashRes.json();

      const activityData: { data: ActivityRow[]; total: number } =
        await activityRes.json();

      setStats({
        totalUsers: dash.stats.totalUsers,
        activeUsers: dash.stats.activeUsers,
        inactiveUsers: dash.stats.totalUsers - dash.stats.activeUsers,
        recentActions: activityData.total,
      });

      setRecentUsers(dash.recentUsers);
      setRecentActivities(activityData.data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

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
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-6">
        <Breadcrumbs items={["Admin", "Dashboard"]} />

        {/* ── Page header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Admin Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live data from your database
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!loading && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Last refreshed: {lastRefreshed.toLocaleTimeString("en-IN")}
              </span>
            )}
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm hover:bg-accent transition disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error} — showing last known data.
          </div>
        )}

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-xl p-3 sm:p-4 md:p-6">
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

        {/* ── Bottom grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Recent Users */}
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
                          className={`ml-2 px-1.5 sm:px-2.5 py-0.5 text-xs font-semibold border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap ${
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

          {/* Recent Activity */}
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
                      const description =
                        activity.details ||
                        `${activity.event} — ${activity.resource || activity.actionType || "system"}`;

                      return (
                        <div
                          key={activity.id || i}
                          className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 bg-gradient-to-r from-muted/30 to-accent/30 rounded-lg text-xs sm:text-sm hover:shadow-md hover:ring-1 hover:ring-primary/20 transition-all group"
                        >
                          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-semibold text-foreground line-clamp-1 leading-tight">
                              {description}
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
                            className={`text-xs whitespace-nowrap ml-1 sm:ml-2 ${getRelativeTimeColor(
                              activity.timestamp,
                            )}`}
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