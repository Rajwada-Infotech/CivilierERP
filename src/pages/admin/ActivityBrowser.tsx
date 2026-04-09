import React, { useMemo, useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import {
  type SessionEvent,
  ActivityLogFilters,
  type ActivityActionType,
} from "@/api/userActivityApi";
import {
  Activity,
  Calendar,
  Clock,
  Fingerprint,
  LogIn,
  LogOut,
  Monitor,
  Search,
  ShieldAlert,
  Timer,
  TrendingUp,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const ActivityChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-md">
        <p className="mb-2 text-xs font-bold text-foreground">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry: any) => (
            <div
              key={entry.name}
              className="flex items-center justify-between gap-4 text-[11px]"
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground">{entry.name}</span>
              </div>
              <span className="font-mono font-bold text-foreground">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  admin: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  user: "bg-slate-500/10 text-slate-600 border-slate-500/20",
};

const ACTION_COLORS: Record<string, string> = {
  read: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  create: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  update: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  delete: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  write: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  export: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  settings_change: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

function formatDateTime(iso?: string) {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "Active";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function roleLabel(role: string) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "User";
}

function getActionLabel(event: SessionEvent) {
  if (event.event === "login") return "login";
  if (event.event === "logout") return "logout";
  return event.actionType || "action";
}

const PRESETS = [
  { label: "Today", period: "today" as const },
  { label: "Yesterday", period: "yesterday" as const },
  { label: "This Week", period: "this-week" as const },
  { label: "This Month", period: "this-month" as const },
  { label: "Last Month", period: "last-month" as const },
  { label: "This Year", period: "this-year" as const },
] satisfies Array<{ label: string; period: ActivityLogFilters["period"] }>;

const YEARS = [2025, 2024, 2023];
const MONTHS = [
  { label: "January", value: 0 },
  { label: "February", value: 1 },
  { label: "March", value: 2 },
  { label: "April", value: 3 },
  { label: "May", value: 4 },
  { label: "June", value: 5 },
  { label: "July", value: 6 },
  { label: "August", value: 7 },
  { label: "September", value: 8 },
  { label: "October", value: 9 },
  { label: "November", value: 10 },
  { label: "December", value: 11 },
];

const ActivityBrowser: React.FC = () => {
  const {
    groupedSessions,
    rawSessions,
    isLoading,
    dateFilters,
    setDateFilters,
    clearDateFilters,
    // Added from dev branch (pagination support)
    activity,
    setPage,
    setFilters,
  } = useActivityBrowser();

  const [activeTab, setActiveTab] = useState<"sessions" | "actions">(
    "sessions",
  );
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<
    "all" | "super_admin" | "admin" | "user"
  >("all");
  const [quickFilter, setQuickFilter] = useState<ActivityActionType | null>(
    null,
  );

  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: dateFilters.dateFrom ? new Date(dateFilters.dateFrom) : undefined,
    to: dateFilters.dateTo ? new Date(dateFilters.dateTo) : undefined,
  });

  // Original date sync
  useEffect(() => {
    setDateRange({
      from: dateFilters.dateFrom
        ? new Date(dateFilters.dateFrom + "T00:00:00")
        : undefined,
      to: dateFilters.dateTo
        ? new Date(dateFilters.dateTo + "T00:00:00")
        : undefined,
    });
  }, [dateFilters]);

  // New: Sync search + role filter with backend API (pagination ready)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({
        search: search.trim() || undefined,
        role: filterRole === "all" ? undefined : filterRole,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, filterRole, setFilters]);

  const handlePresetClick = (period: ActivityLogFilters["period"]) => {
    setDateFilters({ period });
  };

  const handleDateRangeChange = (range: {
    from: Date | undefined;
    to: Date | undefined;
  }) => {
    setDateRange(range);
    if (range.from && range.to) {
      setDateFilters({
        dateFrom: format(range.from, "yyyy-MM-dd"),
        dateTo: format(range.to, "yyyy-MM-dd"),
      });
    } else if (range.from) {
      setDateFilters({ dateFrom: format(range.from, "yyyy-MM-dd") });
    } else {
      clearDateFilters();
    }
  };

  const handleYearChange = (yearStr: string) => {
    if (!yearStr) return;
    const year = parseInt(yearStr);
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31);
    setDateFilters({
      dateFrom: format(from, "yyyy-MM-dd"),
      dateTo: format(to, "yyyy-MM-dd"),
    });
  };

  const handleMonthChange = (monthStr: string) => {
    if (!monthStr) return;
    const month = parseInt(monthStr);
    const year = dateRange.from?.getFullYear() || new Date().getFullYear();
    const from = new Date(year, month, 1);
    const to = new Date(year, month, new Date(year, month + 1, 0).getDate());
    setDateFilters({
      dateFrom: format(from, "yyyy-MM-dd"),
      dateTo: format(to, "yyyy-MM-dd"),
    });
  };

  const handleQuickFilter = (type: ActivityActionType) => {
    setQuickFilter((prev) => (prev === type ? null : type));
  };

  // All your original computed values (kept 100%)
  const chartData = useMemo(() => {
    if (!rawSessions.length && !dateRange.from) return [];
    const dataMap: Record<
      string,
      { date: string; actions: number; logins: number; fullDate: string }
    > = {};
    let start: Date;
    let end: Date;
    if (dateRange.from) {
      start = new Date(dateRange.from);
      end = dateRange.to ? new Date(dateRange.to) : new Date();
    } else {
      const timestamps = rawSessions.map((s) =>
        new Date(s.timestamp).getTime(),
      );
      start = new Date(Math.min(...timestamps));
      end = new Date(Math.max(...timestamps));
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const curr = new Date(start);
    let safety = 0;
    while (curr <= end && safety < 90) {
      const key = format(curr, "yyyy-MM-dd");
      dataMap[key] = {
        date: format(curr, "dd MMM"),
        fullDate: key,
        actions: 0,
        logins: 0,
      };
      curr.setDate(curr.getDate() + 1);
      safety++;
    }
    rawSessions.forEach((event) => {
      const dayKey = format(new Date(event.timestamp), "yyyy-MM-dd");
      if (dataMap[dayKey]) {
        if (event.event === "action") dataMap[dayKey].actions++;
        if (event.event === "login") dataMap[dayKey].logins++;
      }
    });
    return Object.values(dataMap).sort((a, b) =>
      a.fullDate.localeCompare(b.fullDate),
    );
  }, [rawSessions, dateRange]);

  const analytics = useMemo(() => {
    const userCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};
    rawSessions.forEach((event) => {
      if (event.event === "action") {
        userCounts[event.userName] = (userCounts[event.userName] || 0) + 1;
        const res = event.resource || "Unknown";
        resourceCounts[res] = (resourceCounts[res] || 0) + 1;
      }
    });
    return {
      topUsers: Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
      topResources: Object.entries(resourceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    };
  }, [rawSessions]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupedSessions.filter((session) => {
      const roleMatch = filterRole === "all" || session.userRole === filterRole;
      const actionTypeMatch =
        !quickFilter ||
        session.actions.some((a) => a.actionType === quickFilter);
      const searchMatch =
        !q ||
        session.userName.toLowerCase().includes(q) ||
        session.userEmail.toLowerCase().includes(q) ||
        session.deviceFingerprint.toLowerCase().includes(q) ||
        session.deviceInfo.toLowerCase().includes(q) ||
        session.actions.some(
          (action) =>
            action.resource?.toLowerCase().includes(q) ||
            action.requestUrl?.toLowerCase().includes(q) ||
            action.details?.toLowerCase().includes(q) ||
            action.actionType?.toLowerCase().includes(q),
        );
      return roleMatch && searchMatch && actionTypeMatch;
    });
  }, [groupedSessions, search, filterRole, quickFilter]);

  const filteredActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawSessions.filter((event) => {
      if (event.event !== "action") return false;
      const roleMatch = filterRole === "all" || event.userRole === filterRole;
      const actionTypeMatch = !quickFilter || event.actionType === quickFilter;
      const searchMatch =
        !q ||
        event.userName.toLowerCase().includes(q) ||
        event.userEmail.toLowerCase().includes(q) ||
        event.resource?.toLowerCase().includes(q) ||
        event.requestUrl?.toLowerCase().includes(q) ||
        event.details?.toLowerCase().includes(q) ||
        event.actionType?.toLowerCase().includes(q);
      return roleMatch && searchMatch && actionTypeMatch;
    });
  }, [rawSessions, search, filterRole, quickFilter]);

  const currentPeriodLabel = dateFilters.period
    ? PRESETS.find((p) => p.period === dateFilters.period)?.label
    : dateFilters.dateFrom || dateFilters.dateTo
      ? "Custom Range"
      : "Last Month";

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Admin", path: "/admin" },
          { label: "Audit", path: "/admin/activity-browser" },
          { label: "Session Dashboard" },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Activity Browser
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Login, logout, device fingerprint and everything changed during each
            session.
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          {groupedSessions.length} sessions ·{" "}
          {rawSessions.filter((e) => e.event === "action").length} actions |{" "}
          {currentPeriodLabel}
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            className={`border-b-2 px-1 pb-2 text-sm font-heading ${
              activeTab === "sessions"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
            onClick={() => setActiveTab("sessions")}
          >
            Sessions
          </button>
          <button
            className={`border-b-2 px-1 pb-2 text-sm font-heading ${
              activeTab === "actions"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
            onClick={() => setActiveTab("actions")}
          >
            Actions
          </button>
        </nav>
      </div>

      {/* Date Filters - Your original code unchanged */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={dateFilters.period || ""}
            onValueChange={(v) =>
              handlePresetClick(v as ActivityLogFilters["period"])
            }
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Quick Select" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map(({ label, period }) => (
                <SelectItem key={period} value={period} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={handleYearChange}>
            <SelectTrigger className="h-8 w-[80px] text-xs">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={y.toString()} className="text-xs">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={handleMonthChange}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem
                  key={m.value}
                  value={m.value.toString()}
                  className="text-xs"
                >
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 px-3"
            onClick={clearDateFilters}
          >
            Clear
          </Button>

          <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
            {(["create", "update", "delete"] as ActivityActionType[]).map(
              (act) => (
                <Button
                  key={act}
                  variant={quickFilter === act ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[10px] uppercase tracking-wider"
                  onClick={() => handleQuickFilter(act)}
                >
                  {act}
                </Button>
              ),
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-[280px]">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-[280px] justify-start text-left font-normal text-xs h-10",
                  !dateRange.from && !dateRange.to && "text-muted-foreground",
                )}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {dateRange.from ? (
                  dateRange.to ? (
                    <>
                      {dateRange.from.toLocaleDateString("en-IN", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      -{" "}
                      {dateRange.to.toLocaleDateString("en-IN", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </>
                  ) : (
                    <>{format(dateRange.from, "PPP")} - Present</>
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                initialFocus
                mode="range"
                defaultMonth={dateRange.from}
                selected={dateRange}
                onSelect={(range) =>
                  handleDateRangeChange({ from: range?.from, to: range?.to })
                }
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, fingerprint, resource, URL..."
              className="w-full py-2 pl-10 pr-4 text-sm"
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="all">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>
      </div>

      {/* Analytics Cards - unchanged */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-border/40 bg-card/20 backdrop-blur-sm">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <TrendingUp size={14} className="text-primary" /> Top Power
                Users
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {analytics.topUsers.length > 0 ? (
                  analytics.topUsers.map(([user, count]) => (
                    <div
                      key={user}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-sm"
                    >
                      <span className="font-medium">{user}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {count} actions
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground py-2 italic text-center">
                    No action data
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/20 backdrop-blur-sm">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <ShieldAlert size={14} className="text-amber-500" /> Hot Modules
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {analytics.topResources.length > 0 ? (
                  analytics.topResources.map(([res, count]) => (
                    <div
                      key={res}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-sm"
                    >
                      <span className="font-medium capitalize">{res}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-500/20 text-amber-600"
                      >
                        {count} hits
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground py-2 italic text-center">
                    No resource data
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Activity Chart - unchanged */}
      {!isLoading && chartData.length > 0 && (
        <Card className="border-border/50 bg-card/10 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity size={14} className="text-primary" />
              Activity Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                    content={<ActivityChartTooltip />}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    wrapperStyle={{
                      paddingBottom: 20,
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                  <Bar
                    dataKey="actions"
                    name="Actions"
                    fill="hsl(var(--primary))"
                    radius={[2, 2, 0, 0]}
                    barSize={24}
                  />
                  <Bar
                    dataKey="logins"
                    name="Logins"
                    fill="#10b981"
                    radius={[2, 2, 0, 0]}
                    barSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-14">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : activeTab === "sessions" ? (
        filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-24 text-muted-foreground">
            <Activity size={48} className="opacity-20" />
            <p className="text-lg font-heading font-semibold">
              No session data found
            </p>
            <p className="text-sm">
              Try adjusting the date range or other filters above.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session) => {
              const loginMeta = formatDateTime(session.loginTime);
              const logoutMeta = formatDateTime(session.logoutTime);
              const alerts = [];
              const uniqueIps = new Set(
                session.actions.map((a) => a.ipAddress).filter(Boolean),
              );
              uniqueIps.add(session.loginEvent.ipAddress);
              if (session.logoutEvent)
                uniqueIps.add(session.logoutEvent.ipAddress);

              if (uniqueIps.size > 1) {
                alerts.push({
                  icon: ShieldAlert,
                  label: "Multiple IPs",
                  color: "text-amber-500",
                });
              }

              return (
                <div
                  key={session.sessionId}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  {/* ── Session header row ── */}
                  <div className="grid gap-4 border-b border-border bg-muted/30 p-5 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
                    {/* User */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <User size={16} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {session.userName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {session.userEmail}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-heading uppercase tracking-wider ${ROLE_COLORS[session.userRole] ?? "bg-slate-500/10 text-slate-600 border-slate-500/20"}`}
                        >
                          {roleLabel(session.userRole)}
                        </span>
                        {alerts.map((a) => (
                          <span
                            key={a.label}
                            className={`ml-1 inline-flex items-center gap-1 text-[10px] font-medium ${a.color}`}
                          >
                            <a.icon size={10} />
                            {a.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* IP + Device */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <Monitor
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate text-muted-foreground">
                          {session.loginEvent.ipAddress || "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Fingerprint
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {session.deviceFingerprint !== "Unknown"
                            ? session.deviceFingerprint.slice(0, 16) + "…"
                            : "Unknown"}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {session.deviceInfo}
                      </div>
                    </div>

                    {/* Login / Logout times */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <LogIn
                          size={12}
                          className="shrink-0 text-emerald-500"
                        />
                        <span className="text-muted-foreground">
                          {loginMeta.date}{" "}
                          <span className="font-medium text-foreground">
                            {loginMeta.time}
                          </span>
                        </span>
                      </div>
                      {session.logoutTime ? (
                        <div className="flex items-center gap-2 text-xs">
                          <LogOut
                            size={12}
                            className="shrink-0 text-rose-400"
                          />
                          <span className="text-muted-foreground">
                            {logoutMeta.date}{" "}
                            <span className="font-medium text-foreground">
                              {logoutMeta.time}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-emerald-500">
                          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                          Active session
                        </div>
                      )}
                    </div>

                    {/* Duration + action count */}
                    <div className="flex flex-col items-end justify-between gap-2 text-right">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Timer size={12} />
                        {session.durationMs
                          ? formatDuration(session.durationMs)
                          : "—"}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {session.actions.length} action
                        {session.actions.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>

                  {/* ── Action list (collapsible rows) ── */}
                  {session.actions.length > 0 && (
                    <div className="divide-y divide-border/50">
                      {session.actions.slice(0, 5).map((action) => {
                        const { date, time } = formatDateTime(action.timestamp);
                        return (
                          <div
                            key={action.id}
                            className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs text-muted-foreground hover:bg-muted/20"
                          >
                            <span
                              className={`rounded-full border px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${ACTION_COLORS[action.actionType || "read"]}`}
                            >
                              {action.actionType || "action"}
                            </span>
                            <span className="font-medium capitalize text-foreground">
                              {action.resource || "—"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {date} {time}
                            </span>
                            {action.requestMethod && (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                                {action.requestMethod}
                              </span>
                            )}
                            {action.requestUrl && (
                              <span className="max-w-[260px] truncate font-mono text-[10px]">
                                {action.requestUrl}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {session.actions.length > 5 && (
                        <div className="px-5 py-2 text-[11px] italic text-muted-foreground">
                          +{session.actions.length - 5} more action
                          {session.actions.length - 5 !== 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : rawSessions.filter((e) => e.event === "action").length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-24 text-muted-foreground">
          <Activity size={48} className="opacity-20" />
          <p className="text-lg font-heading font-semibold">No actions found</p>
          <p className="text-sm">
            Try adjusting the date range or other filters above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Session</th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.map((action) => (
                <tr key={action.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <div className="font-medium">{action.userName}</div>
                    <div className="text-xs text-muted-foreground">
                      {action.userEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-heading ${ACTION_COLORS[action.actionType || "read"]}`}
                    >
                      {getActionLabel(action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {action.resource || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar size={12} />
                      {formatDateTime(action.timestamp).date}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {formatDateTime(action.timestamp).time}
                    </div>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-xs text-muted-foreground">
                    <div className="truncate">{action.requestUrl || "—"}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {action.sessionId || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Pagination Controls (added) */}
      {!isLoading && activity.pages > 1 && (
        <div className="flex justify-center pt-8">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage(activity.page - 1)}
                  className={
                    activity.page === 1 ? "pointer-events-none opacity-50" : ""
                  }
                />
              </PaginationItem>
              {Array.from(
                { length: Math.min(5, activity.pages) },
                (_, i) => activity.page - 2 + i,
              )
                .filter((p) => p >= 1 && p <= activity.pages)
                .map((p) => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === activity.page}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(activity.page + 1)}
                  className={
                    activity.page === activity.pages
                      ? "pointer-events-none opacity-50"
                      : ""
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Original Summary Stats - unchanged */}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-6 text-xs md:grid-cols-4">
          <div className="text-center">
            <div className="text-lg font-heading text-foreground">
              {groupedSessions.length}
            </div>
            <div className="text-muted-foreground">Total Sessions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-heading text-foreground">
              {rawSessions.filter((e) => e.event === "action").length}
            </div>
            <div className="text-muted-foreground">Tracked Actions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-heading text-primary">
              {groupedSessions.filter((s) => !!s.logoutTime).length}
            </div>
            <div className="text-muted-foreground">Completed Sessions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-heading text-emerald-600 dark:text-emerald-400">
              {groupedSessions.filter((s) => !s.logoutTime).length}
            </div>
            <div className="text-muted-foreground">Active Sessions</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityBrowser;
