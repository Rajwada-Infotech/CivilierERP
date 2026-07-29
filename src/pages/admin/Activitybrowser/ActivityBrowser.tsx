import React, { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import type { ActivityActionType } from "@/api/userActivityApi";
import type { SessionEvent } from "@/api/userActivityApi";
import type { GroupedSession } from "@/contexts/ActivityBrowserContext";
import {
  PRESETS,
  YEARS,
  MONTHS,
} from "./constants";
import { format } from "date-fns";
import { parseDeviceInfo } from "@/utils/deviceFingerprint";
import {
  Search,
  Shield,
  Monitor,
  Fingerprint,
  LogIn,
  LogOut,
  Timer,
  ChevronDown,
  RefreshCw,
  Trash2,
  Activity,
  AlertTriangle,
  Globe,
  Filter,
  X,
  Database,
  Zap,
  Circle,
} from "lucide-react";

// ─── Utilities ─────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return { date: "—", time: "—", relative: "" };
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  let relative = "";
  if (diffMin < 1) relative = "just now";
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffH < 24) relative = `${diffH}h ago`;
  else if (diffD < 7) relative = `${diffD}d ago`;
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
    relative,
  };
}

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function parseUA(ua: string = "") {
  const profile = parseDeviceInfo(ua);
  return {
    os: profile.os,
    browser: profile.browser,
    isMobile: profile.isMobile,
  };
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || "")
    .join("");
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    user: "User",
    dba: "DBA",
  };
  return map[role] || role;
}

// ─── Sub-components ────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: string }> = ({ role }) => {
  const colorMap: Record<string, string> = {
    super_admin:
      "bg-violet-500/10 text-violet-600 border-violet-500/30 dark:text-violet-400",
    admin: "bg-sky-500/10 text-sky-600 border-sky-500/30 dark:text-sky-400",
    dba: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
    user: "bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400",
  };
  const cls = colorMap[role] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${cls}`}
    >
      {roleLabel(role)}
    </span>
  );
};

const EventBadge: React.FC<{ event: string; actionType?: string }> = ({
  event,
  actionType,
}) => {
  const key = event === "action" ? actionType || "action" : event;
  const colorMap: Record<string, string> = {
    login:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
    logout:
      "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
    read: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
    create:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
    update:
      "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
    delete:
      "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
    export:
      "bg-cyan-500/10 text-cyan-600 border-cyan-500/20 dark:text-cyan-400",
    settings_change:
      "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400",
  };
  const cls = colorMap[key] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {key === "settings_change" ? "settings" : key}
    </span>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}> = ({ label, value, sub, icon, accent = "text-primary" }) => (
  <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1.5 text-3xl font-bold tabular-nums ${accent}`}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="rounded-xl bg-muted p-2.5 text-muted-foreground">
        {icon}
      </div>
    </div>
  </div>
);


// ─── Session Card ─────────────────────────────────────────────────────────

const SessionCard: React.FC<{ session: GroupedSession }> = ({ session }) => {
  const [expanded, setExpanded] = useState(false);
  const loginMeta = fmtDate(session.loginTime);
  const logoutMeta = fmtDate(session.logoutTime);
  const isActive = !session.logoutTime;

  const allIps = new Set(
    [
      session.loginEvent?.ipAddress,
      session.logoutEvent?.ipAddress,
      ...session.actions.map((a) => a.ipAddress),
    ].filter(Boolean),
  );
  const multipleIps = allIps.size > 1;

  const { os, browser } = parseUA(session.deviceInfo);
  const ini = initials(session.userName);

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-card transition-all duration-200 ${multipleIps ? "border-amber-500/40" : "border-border"}`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left"
      >
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto]">
          {/* User */}
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {ini}
              {isActive && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {session.userName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {session.userEmail}
              </p>
              <div className="mt-1">
                <RoleBadge role={session.userRole} />
              </div>
            </div>
          </div>

          {/* Device / IP */}
          <div className="hidden space-y-1 md:block">
            <div className="flex items-center gap-1.5 text-xs">
              <Globe size={11} className="text-muted-foreground" />
              <span className="font-mono text-[11px] font-medium text-foreground/80">
                {session.ipAddress || "—"}
              </span>
              {multipleIps && (
                <AlertTriangle size={11} className="text-amber-500" />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Monitor size={11} />
              <span>
                {browser} · {os}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Fingerprint size={11} />
              <span className="font-mono text-[10px]">
                {session.deviceFingerprint !== "Unknown"
                  ? session.deviceFingerprint.slice(0, 14) + "…"
                  : "—"}
              </span>
            </div>
          </div>

          {/* Times */}
          <div className="hidden space-y-1.5 md:block">
            <div className="flex items-center gap-1.5 text-xs">
              <LogIn size={11} className="text-emerald-500" />
              <span className="text-muted-foreground">
                {loginMeta.date}{" "}
                <span className="font-medium text-foreground">
                  {loginMeta.time}
                </span>
              </span>
            </div>
            {session.logoutTime ? (
              <div className="flex items-center gap-1.5 text-xs">
                <LogOut size={11} className="text-rose-400" />
                <span className="text-muted-foreground">
                  {logoutMeta.date}{" "}
                  <span className="font-medium text-foreground">
                    {logoutMeta.time}
                  </span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                <Circle size={8} className="animate-pulse fill-current" />
                <span className="font-medium">Active now</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer size={11} />
              {fmtDuration(session.durationMs)}
            </div>
          </div>

          {/* Actions count */}
          <div className="hidden flex-col items-end justify-center gap-2 md:flex">
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Activity size={11} />
              {session.actions.length} actions
            </div>
            {multipleIps && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle size={10} /> Multi-IP
              </span>
            )}
          </div>

          {/* Expand toggle */}
          <div className="flex items-center justify-end">
            <div
              className={`rounded-full p-1 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <ChevronDown size={16} />
            </div>
          </div>
        </div>
      </button>

      {/* Expanded: action list */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-5 pb-4 pt-3">
          {session.actions.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground italic">
              No actions recorded in this session
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Actions in this session
              </p>
              {session.actions.map((action, i) => {
                const t = fmtDate(action.timestamp);
                return (
                  <div
                    key={action.id ?? i}
                    className="flex items-start gap-3 rounded-xl bg-card px-3 py-2.5 text-xs"
                  >
                    <EventBadge
                      event={action.event}
                      actionType={action.actionType}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">
                        {action.resource || "—"}
                      </p>
                      {action.requestUrl && (
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {action.requestMethod} {action.requestUrl}
                        </p>
                      )}
                      {action.details && (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {action.details}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-foreground">{t.time}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.relative}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Action Row (flat log view) ────────────────────────────────────────────

const ActionRow: React.FC<{ event: SessionEvent; index: number }> = ({
  event,
  index,
}) => {
  const t = fmtDate(event.timestamp);
  const { os, browser } = parseUA(event.deviceInfo);
  return (
    <div
      className={`grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0 items-center border-b border-border px-4 py-3 text-xs hover:bg-muted/40 transition-colors ${index % 2 === 0 ? "" : "bg-muted/10"}`}
    >
      <EventBadge event={event.event} actionType={event.actionType} />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-foreground text-[11px]">
            {event.userName}
          </span>
          <span className="text-muted-foreground truncate">
            {event.resource || event.requestUrl || "—"}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
          <span className="font-mono">{event.ipAddress || "—"}</span>
          <span>
            {browser} · {os}
          </span>
          {event.details && (
            <span className="truncate max-w-[200px]">{event.details}</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] text-foreground">{t.time}</p>
        <p className="text-[10px] text-muted-foreground">{t.relative}</p>
      </div>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────

const ActivityBrowser: React.FC = () => {
  const {
    groupedSessions,
    rawSessions,
    isLoading,
    dateFilters,
    setDateFilters,
    clearDateFilters,
    activity,
    setPage,
    setFilters,
    refresh,
    clearHistory,
  } = useActivityBrowser();

  const [activeTab, setActiveTab] = useState<"sessions" | "log">("sessions");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<
    "all" | "super_admin" | "admin" | "user"
  >("all");
  const [quickFilter, setQuickFilter] = useState<ActivityActionType | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters({
        search: search.trim() || undefined,
        role: filterRole === "all" ? undefined : filterRole,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [search, filterRole, setFilters]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await clearHistory();
    } catch {
      // error already logged in provider
    } finally {
      setClearing(false);
      setConfirmClearOpen(false);
    }
  };

  // Stats
  const stats = useMemo(() => {
    const actions = rawSessions.filter((e) => e.event === "action");
    const logins = rawSessions.filter((e) => e.event === "login");
    const active = groupedSessions.filter((s) => !s.logoutTime);
    const uniqueIps = new Set(
      rawSessions.map((e) => e.ipAddress).filter(Boolean),
    );
    const multiIpSessions = groupedSessions.filter((s) => {
      const ips = new Set(
        [
          s.loginEvent?.ipAddress,
          s.logoutEvent?.ipAddress,
          ...s.actions.map((a) => a.ipAddress),
        ].filter(Boolean),
      );
      return ips.size > 1;
    });
    return {
      actions: actions.length,
      logins: logins.length,
      activeSessions: active.length,
      uniqueIps: uniqueIps.size,
      alerts: multiIpSessions.length,
    };
  }, [rawSessions, groupedSessions]);

  // Filtered data
  const q = search.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    return groupedSessions.filter((s) => {
      if (filterRole !== "all" && s.userRole !== filterRole) return false;
      if (quickFilter && !s.actions.some((a) => a.actionType === quickFilter))
        return false;
      if (
        q &&
        !s.userName.toLowerCase().includes(q) &&
        !s.userEmail.toLowerCase().includes(q) &&
        !s.ipAddress?.toLowerCase().includes(q) &&
        !s.deviceInfo?.toLowerCase().includes(q) &&
        !s.deviceFingerprint?.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [groupedSessions, filterRole, quickFilter, q]);

  const filteredLog = useMemo(() => {
    return rawSessions.filter((e) => {
      if (filterRole !== "all" && e.userRole !== filterRole) return false;
      if (quickFilter && e.actionType !== quickFilter) return false;
      if (
        q &&
        !e.userName.toLowerCase().includes(q) &&
        !e.userEmail?.toLowerCase().includes(q) &&
        !e.ipAddress?.toLowerCase().includes(q) &&
        !e.resource?.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rawSessions, filterRole, quickFilter, q]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Admin", path: "/admin" },
          { label: "Audit", path: "/admin/activity-browser" },
          { label: "Activity Browser" },
        ]}
      />

      <AdminShell
        title="Activity Browser"
        subtitle="Real-time audit of user sessions, IP addresses, devices and all tracked actions"
        icon={Activity}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw
                size={13}
                className={`transition-transform duration-500 ${refreshing ? "animate-spin" : "group-hover:rotate-180"}`}
              />
              Refresh
            </button>
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-card px-3 py-2 text-xs font-medium text-destructive/70 transition-colors hover:border-destructive hover:text-destructive"
            >
              <Trash2 size={13} />
              Clear History
            </button>
            <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              {activity.total} records
            </div>
          </div>
        }
      >

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total Sessions"
          value={groupedSessions.length}
          icon={<Shield size={18} />}
        />
        <StatCard
          label="Active Now"
          value={stats.activeSessions}
          icon={
            <Circle size={18} className="fill-emerald-500 text-emerald-500" />
          }
          accent="text-emerald-500"
        />
        <StatCard
          label="Actions Logged"
          value={stats.actions}
          icon={<Zap size={18} />}
        />
        <StatCard
          label="Unique IPs"
          value={stats.uniqueIps}
          icon={<Globe size={18} />}
        />
        <StatCard
          label="IP Anomalies"
          value={stats.alerts}
          icon={<AlertTriangle size={18} />}
          accent={stats.alerts > 0 ? "text-amber-500" : "text-foreground"}
          sub={stats.alerts > 0 ? "multi-IP sessions" : "all clear"}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Period presets */}
          <div className="relative">
          <select
            value={dateFilters.period || ""}
            onChange={(e) => setDateFilters({ period: e.target.value as any })}
            className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-xs outline-none focus:border-primary appearance-none"
          >
            <option value="" disabled>
              Period
            </option>
            {PRESETS.map((p) => (
              <option key={p.period} value={p.period}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>

          <div className="relative">
          <select
            onChange={(e) => {
              const y = parseInt(e.target.value);
              setDateFilters({ dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` });
            }}
            className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-xs outline-none focus:border-primary appearance-none"
            defaultValue=""
          >
            <option value="" disabled>
              Year
            </option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>

          <div className="relative">
          <select
            onChange={(e) => {
              const m = parseInt(e.target.value);
              const y = new Date().getFullYear();
              const from = new Date(y, m, 1);
              const to = new Date(y, m + 1, 0);
              setDateFilters({
                dateFrom: format(from, "yyyy-MM-dd"),
                dateTo: format(to, "yyyy-MM-dd"),
              });
            }}
            className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-xs outline-none focus:border-primary appearance-none"
            defaultValue=""
          >
            <option value="" disabled>
              Month
            </option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>

          <button
            onClick={clearDateFilters}
            className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X size={11} /> Clear
          </button>

          <div className="mx-2 h-5 w-px bg-border" />

          {/* Action quick-filters */}
          <button
              key="create"
              onClick={() => setQuickFilter((prev) => (prev === "create" ? null : "create"))}
              className={`h-7 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${quickFilter === "create" ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"}`}
            >create</button>
          <button
              key="update"
              onClick={() => setQuickFilter((prev) => (prev === "update" ? null : "update"))}
              className={`h-7 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${quickFilter === "update" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"}`}
            >update</button>
          <button
              key="delete"
              onClick={() => setQuickFilter((prev) => (prev === "delete" ? null : "delete"))}
              className={`h-7 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${quickFilter === "delete" ? "border-rose-500 bg-rose-500 text-white" : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"}`}
            >delete</button>
          <button
              key="read"
              onClick={() => setQuickFilter((prev) => (prev === "read" ? null : "read"))}
              className={`h-7 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${quickFilter === "read" ? "border-sky-500 bg-sky-500 text-white" : "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20"}`}
            >read</button>
          <button
              key="export"
              onClick={() => setQuickFilter((prev) => (prev === "export" ? null : "export"))}
              className={`h-7 rounded-lg border px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${quickFilter === "export" ? "border-cyan-500 bg-cyan-500 text-white" : "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20"}`}
            >export</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, IP, device, resource…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary placeholder:text-muted-foreground"
            />
          </div>

          {/* Role filter */}
          <div className="relative">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
            className="h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm outline-none focus:border-primary appearance-none"
          >
            <option value="all">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter size={12} />
            {activeTab === "sessions"
              ? `${filteredSessions.length} sessions`
              : `${filteredLog.length} events`}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6">
          {(["sessions", "log"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 pb-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "sessions"
                ? `Sessions (${filteredSessions.length})`
                : `Audit Log (${filteredLog.length})`}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
          <span className="text-sm">Loading activity data…</span>
        </div>
      ) : activeTab === "sessions" ? (
        filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border py-20 text-muted-foreground">
            <Activity size={40} className="opacity-20" />
            <p className="text-base font-semibold">
              No sessions match your filters
            </p>
            <p className="text-sm">
              Try adjusting the date range or search query
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        )
      ) : filteredLog.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border py-20 text-muted-foreground">
          <Database size={40} className="opacity-20" />
          <p className="text-base font-semibold">No events found</p>
          <p className="text-sm">Try broadening your date range or filters</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 border-b border-border bg-muted/50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <span>Event</span>
            <span>User · Resource</span>
            <span className="text-right">Time</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filteredLog.map((event, i) => (
              <ActionRow key={event.id ?? i} event={event} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && activity.pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setPage(Math.max(1, activity.page - 1))}
            disabled={activity.page === 1}
            className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-muted"
          >
            Previous
          </button>
          {Array.from(
            { length: Math.min(5, activity.pages) },
            (_, i) => activity.page - 2 + i,
          )
            .filter((p) => p >= 1 && p <= activity.pages)
            .map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  p === activity.page
                    ? "border-transparent bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow-sm"
                    : "border-border hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
          <button
            onClick={() => setPage(Math.min(activity.pages, activity.page + 1))}
            disabled={activity.page === activity.pages}
            className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-muted"
          >
            Next
          </button>
          <span className="ml-2 text-xs text-muted-foreground">
            Page {activity.page} of {activity.pages} · {activity.total} total
          </span>
        </div>
      )}

      {/* Footer summary */}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4 text-center">
          <div>
            <p className="text-xl font-bold text-foreground">
              {groupedSessions.length}
            </p>
            <p className="text-xs text-muted-foreground">Total Sessions</p>
          </div>
          <div>
            <p className="text-xl font-bold text-foreground">{stats.actions}</p>
            <p className="text-xs text-muted-foreground">Tracked Actions</p>
          </div>
          <div>
            <p className="text-xl font-bold text-primary">
              {groupedSessions.filter((s) => !!s.logoutTime).length}
            </p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div>
            <p className="text-xl font-bold text-emerald-500">
              {stats.activeSessions}
            </p>
            <p className="text-xs text-muted-foreground">Active Sessions</p>
          </div>
        </div>
      )}
      {/* Clear History confirm */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <Trash2 size={18} className="text-destructive" />
              </div>
              <div>
                <p className="font-heading font-semibold text-foreground">
                  Clear all history?
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This permanently deletes all activity logs from the database.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                disabled={clearing}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={clearing}
                className="flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {clearing && (
                  <div className="h-3 w-3 animate-spin rounded-full border border-destructive-foreground border-t-transparent" />
                )}
                {clearing ? "Clearing…" : "Clear History"}
              </button>
            </div>
          </div>
        </div>
      )}
      </AdminShell>
    </>
  );
};
export default ActivityBrowser;