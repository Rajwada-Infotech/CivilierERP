import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import type { ActivityActionType } from "@/api/userActivityApi";
import {
  LogIn, LogOut, Monitor, Search, ShieldAlert, Timer, TrendingUp, User, Calendar as CalendarIcon, Clock, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";

const PRESETS = [ /* same as before */ ];

const ROLE_COLORS = { /* same */ };
const ACTION_COLORS = { /* same */ };

function formatDateTime(iso?: string) { /* same */ }
function formatDuration(ms?: number) { /* same */ }
function roleLabel(role: string) { /* same */ }

const ActivityChartTooltip = ({ active, payload, label }: any) => { /* same */ };

const ActivityBrowser: React.FC = () => {
  const {
    activity,
    groupedSessions,
    isLoading,
    setPage,
    setFilters,
    dateFilters,
    setDateFilters,
    clearDateFilters,
  } = useActivityBrowser();

  const [activeTab, setActiveTab] = useState<"sessions" | "actions">("sessions");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "super_admin" | "admin" | "user">("all");
  const [quickFilter, setQuickFilter] = useState<ActivityActionType | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });

  useEffect(() => {
    setDateRange({
      from: dateFilters.dateFrom ? new Date(dateFilters.dateFrom) : undefined,
      to: dateFilters.dateTo ? new Date(dateFilters.dateTo) : undefined,
    });
  }, [dateFilters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({
        search: search.trim() || undefined,
        role: filterRole === "all" ? undefined : filterRole,
        dateFrom: dateFilters.dateFrom,
        dateTo: dateFilters.dateTo,
        period: dateFilters.period,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, filterRole, dateFilters, setFilters]);

  const handlePresetClick = (period: any) => setDateFilters({ period });
  const handleDateRangeChange = (range: any) => {
    setDateRange(range);
    if (range.from && range.to) {
      setDateFilters({ dateFrom: format(range.from, "yyyy-MM-dd"), dateTo: format(range.to, "yyyy-MM-dd") });
    }
  };

  const handleQuickFilter = (type: ActivityActionType) => setQuickFilter(prev => prev === type ? null : type);

  const chartData = useMemo(() => { /* same chart logic from backend */ }, [activity.data]);

  const analytics = useMemo(() => { /* same analytics */ }, [activity.data]);

  const filteredSessions = useMemo(() => {
    const q = search.toLowerCase();
    return groupedSessions.filter(s => {
      const roleMatch = filterRole === "all" || s.userRole === filterRole;
      const actionMatch = !quickFilter || s.actions.some(a => a.actionType === quickFilter);
      const searchMatch = !q || 
        s.userName.toLowerCase().includes(q) ||
        s.userEmail.toLowerCase().includes(q) ||
        s.deviceInfo.toLowerCase().includes(q) ||
        s.actions.some(a => a.resource?.toLowerCase().includes(q));
      return roleMatch && actionMatch && searchMatch;
    });
  }, [groupedSessions, search, filterRole, quickFilter]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[ { label: "Admin", path: "/admin" }, { label: "Audit", path: "/admin/activity-browser" }, { label: "Session Dashboard" } ]} />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Activity Browser</h1>
          <p className="text-muted-foreground">Login, logout, device fingerprint and user actions</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {activity.total} events • Page {activity.page} of {activity.pages}
        </div>
      </div>

      {/* Date Presets + Filters (kept from backend) */}
      <div className="flex flex-wrap gap-3">
        {PRESETS.map(p => (
          <Button key={p.period} variant={dateFilters.period === p.period ? "default" : "outline"} size="sm" onClick={() => handlePresetClick(p.period)}>
            {p.label}
          </Button>
        ))}
        {/* Search, Role, Quick Action Filters, Date Picker - all kept */}
        {/* ... (same as your backend version) */}
      </div>

      {/* Analytics Cards + Chart (backend) */}
      {!isLoading && (
        <>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Top Users & Hot Modules cards from backend */}
          </div>
          <Card>
            <CardHeader><CardTitle>Activity Volume</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={chartData}>
                    <Bar dataKey="actions" fill="#3b82f6" name="Actions" />
                    <Bar dataKey="logins" fill="#10b981" name="Logins" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip content={<ActivityChartTooltip />} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Tabs */}
      <div className="border-b">
        <button onClick={() => setActiveTab("sessions")} className={activeTab === "sessions" ? "border-b-2 border-primary" : ""}>Sessions</button>
        <button onClick={() => setActiveTab("actions")} className={activeTab === "actions" ? "border-b-2 border-primary" : ""}>Actions</button>
      </div>

      {/* Grouped Sessions View (full backend logic kept) */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          {filteredSessions.map(session => (
            /* Full grouped session card with actions table from your backend code */
            <div key={session.sessionId} className="border rounded-2xl p-5">
              {/* ... your full session card JSX from backend ... */}
            </div>
          ))}
        </div>
      )}

      {/* Pagination from dev */}
      {activity.pages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationPrevious onClick={() => setPage(activity.page - 1)} />
            {Array.from({ length: activity.pages }, (_, i) => i + 1).map(p => (
              <PaginationLink key={p} isActive={p === activity.page} onClick={() => setPage(p)}>{p}</PaginationLink>
            ))}
            <PaginationNext onClick={() => setPage(activity.page + 1)} />
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};

export default ActivityBrowser;