import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme, isLightTheme, bwChartColor } from "@/contexts/ThemeContext";
import { CrmShell, CrmSection, CrmGlassCard } from "@/components/crm/CrmShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardList, BookOpen, IndianRupee, Wrench, XCircle, Key,
  LayoutDashboard, TrendingUp, BarChart3, AlertTriangle, CheckCircle2,
  Phone, FileText, Scale, RefreshCw, ChevronRight, Building2,
  Calendar, Clock, ArrowUpRight, BadgeAlert, PieChart as PieIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  PieChart, Pie,
} from "recharts";

const API = "/api/crm/dashboard";

// --- Helpers ------------------------------------------------------------------
const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtCr = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)} L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return fmtINR(n);
};

const pct = (paid: number, due: number) =>
  due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;

const sumCount = (rows: any[] = []) => rows.reduce((s, r) => s + (r.Count || 0), 0);

const PROJECT_COLORS = ["#f59e0b","#d97706","#b45309","#eab308","#fbbf24","#fb923c","#f97316","#ea580c"];
const STATUS_PIE_COLORS: Record<string, string> = {
  Approved:  "#22c55e",
  Pending:   "#f59e0b",
  Cancelled: "#ef4444",
  Rejected:  "#dc2626",
  Draft:     "#94a3b8",
  Confirmed: "#3b82f6",
  Completed: "#10b981",
  Scheduled: "#6366f1",
  Resolved:  "#06b6d4",
  Closed:    "#64748b",
  Open:      "#f97316",
};

// --- Glass panel wrapper for charts ------------------------------------------
const GlassPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);
  return (
    <div
      className="rounded-xl overflow-hidden bw-color-keep"
      style={{
        background: isDark ? "rgba(15,12,3,0.45)" : "rgba(255,255,255,0.72)",
        border: "1px solid rgba(245,158,11,0.18)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0,0,0,0.25)"
          : "0 4px 20px rgba(245,158,11,0.06)",
      }}
    >
      {/* Top amber shimmer line */}
      <div
        className="h-px w-full"
        style={{ background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.4), transparent)" }}
      />
      <div className="p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-3">{title}</p>
        {children}
      </div>
    </div>
  );
};

// --- Horizontal bar row -------------------------------------------------------
const HBar: React.FC<{ label: string; value: number; total: number; color?: string }> = ({
  label, value, total, color = "#f59e0b",
}) => (
  <div className="mb-2.5">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
    <div className="w-full bg-muted/50 rounded-full h-1.5">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ width: total ? `${(value / total) * 100}%` : "0%", background: color }}
      />
    </div>
  </div>
);

// --- Alert Card ---------------------------------------------------------------
interface AlertCardProps {
  count: number;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  severity: "critical" | "warning" | "info" | "ok";
  route: string;
}

const SEVERITY_STYLES = {
  critical: {
    border: "border-red-300 dark:border-red-800",
    bg: "bg-red-50 dark:bg-red-950/30",
    iconBg: "bg-red-100 dark:bg-red-900/40",
    iconColor: "text-red-600 dark:text-red-400",
    countColor: "text-red-700 dark:text-red-300",
    labelColor: "text-red-700 dark:text-red-400",
    pulse: true,
  },
  warning: {
    border: "border-amber-300 dark:border-amber-700",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    countColor: "text-amber-700 dark:text-amber-300",
    labelColor: "text-amber-700 dark:text-amber-400",
    pulse: false,
  },
  info: {
    border: "border-blue-200 dark:border-blue-800",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    iconBg: "bg-blue-100 dark:bg-blue-900/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    countColor: "text-blue-700 dark:text-blue-300",
    labelColor: "text-blue-700 dark:text-blue-400",
    pulse: false,
  },
  ok: {
    border: "border-green-200 dark:border-green-800",
    bg: "bg-green-50/60 dark:bg-green-950/20",
    iconBg: "bg-green-100 dark:bg-green-900/30",
    iconColor: "text-green-600 dark:text-green-400",
    countColor: "text-green-700 dark:text-green-300",
    labelColor: "text-green-600 dark:text-green-500",
    pulse: false,
  },
};

const AlertCard: React.FC<AlertCardProps> = ({ count, label, sublabel, icon: Icon, severity, route }) => {
  const navigate = useNavigate();
  const s = SEVERITY_STYLES[severity];
  const isOk = severity === "ok";

  return (
    <button
      onClick={() => navigate(route)}
      className={`relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:shadow-md hover:-translate-y-0.5 group ${s.bg} ${s.border}`}
    >
      {s.pulse && count > 0 && (
        <span className="absolute top-2 right-2 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${s.iconBg}`}>
        {isOk && count === 0
          ? <CheckCircle2 size={18} className={s.iconColor} />
          : <Icon size={18} className={s.iconColor} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-2xl font-bold font-heading leading-none ${s.countColor}`}>{count}</div>
        <div className={`text-xs font-medium mt-0.5 leading-tight ${s.labelColor}`}>{label}</div>
        {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>}
      </div>
      <ChevronRight size={14} className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
    </button>
  );
};

// --- This Week Strip ----------------------------------------------------------
const ThisWeekStrip: React.FC<{ data: any[] }> = ({ data }) => {
  const navigate = useNavigate();
  if (!data?.length) return null;

  return (
    <div className="grid grid-cols-7 gap-2">
      {data.map((day: any) => {
        const hasEvents = day.Handovers > 0 || day.Registries > 0 || day.MilestonesDue > 0;
        return (
          <div
            key={day.DayDate}
            className={`rounded-xl border p-2.5 text-center transition-all ${
              hasEvents
                ? "border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/20"
                : "border-border bg-card/60"
            }`}
          >
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {String(day.DayLabel).split(" ")[0]}
            </div>
            <div className="text-lg font-bold font-heading mt-0.5 leading-none">
              {String(day.DayLabel).split(" ")[1]}
            </div>
            <div className="text-[9px] text-muted-foreground">
              {String(day.DayLabel).split(" ")[2]}
            </div>
            <div className="mt-2 space-y-1">
              {day.Handovers > 0 && (
                <button onClick={() => navigate("/crm/handover")}
                  className="w-full flex items-center gap-1 text-[10px] text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded px-1 py-0.5 hover:opacity-80">
                  <Key size={9} /> {day.Handovers}
                </button>
              )}
              {day.Registries > 0 && (
                <button onClick={() => navigate("/crm/registry")}
                  className="w-full flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded px-1 py-0.5 hover:opacity-80">
                  <FileText size={9} /> {day.Registries}
                </button>
              )}
              {day.MilestonesDue > 0 && (
                <button onClick={() => navigate("/crm/payments")}
                  className="w-full flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-1 py-0.5 hover:opacity-80">
                  <IndianRupee size={9} /> {day.MilestonesDue}
                </button>
              )}
              {!hasEvents && <div className="text-[10px] text-muted-foreground/40 pt-1">·</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// --- Collection Per Project bar -----------------------------------------------
const CollectionBar: React.FC<{ row: any }> = ({ row }) => {
  const p = pct(row.TotalPaid, row.TotalDue);
  const color = p >= 80 ? "#22c55e" : p >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground truncate max-w-[140px]">{row.ProjectName || "Unknown"}</span>
        <span className="text-muted-foreground shrink-0 ml-2">{fmtCr(row.TotalPaid)} / {fmtCr(row.TotalDue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
        </div>
        <span className="text-xs font-semibold w-9 text-right" style={{ color }}>{p}%</span>
        {row.OverdueCount > 0 && (
          <span className="text-[10px] text-red-500 whitespace-nowrap">{row.OverdueCount} overdue</span>
        )}
      </div>
    </div>
  );
};

// --- Pie chart tooltip --------------------------------------------------------
const PieTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <span className="font-semibold">{payload[0].name}:</span>{" "}
      <span>{payload[0].value}</span>
    </div>
  );
};

// --- Skeletons ----------------------------------------------------------------
const AlertSkeleton = () => (
  <div className="rounded-xl border border-border/40 p-3 flex items-center gap-3">
    <Skeleton className="w-9 h-9 rounded-lg" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-6 w-10" />
      <Skeleton className="h-3 w-28" />
    </div>
  </div>
);

const GlassCardSkeleton = () => (
  <div className="rounded-xl border border-amber-200/30 p-4 space-y-3"
    style={{ background: "rgba(245,158,11,0.04)" }}>
    <div className="flex items-center gap-2">
      <Skeleton className="w-6 h-6 rounded-md" />
      <Skeleton className="h-3 w-20" />
    </div>
    <Skeleton className="h-8 w-16" />
    {[1, 2, 3].map(i => <Skeleton key={i} className="h-3 w-full" />)}
  </div>
);

// --- Main Component -----------------------------------------------------------
const CrmDashboard: React.FC = () => {
  usePageRights("crm-dashboard");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("crm_dash_project") || "");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["crm-dashboard", projectId],
    queryFn: async () => {
      const url = projectId ? `${API}?projectId=${projectId}` : API;
      const r = await fetchWithAuth(url);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => { setLastUpdated(new Date()); }, [data]);

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  }, [qc]);

  const handleProjectChange = (pid: string) => {
    const val = pid === "__all__" ? "" : pid;
    setProjectId(val);
    if (val) localStorage.setItem("crm_dash_project", val);
    else localStorage.removeItem("crm_dash_project");
  };

  const alerts   = data?.alerts    ?? {};
  const metrics  = data?.metrics   ?? {};
  const payments = data?.payments  ?? {};
  const projects: any[] = data?.projects ?? [];

  const appsData: any[] = data?.applications   ?? [];
  const bkgsData: any[] = data?.bookings        ?? [];
  const tickData: any[] = data?.serviceTickets  ?? [];
  const cancData: any[] = data?.cancellations   ?? [];
  const hndData:  any[] = data?.handovers       ?? [];

  const appsTotal = sumCount(appsData);
  const bkgsTotal = sumCount(bkgsData);
  const tickTotal = sumCount(tickData);
  const cancTotal = sumCount(cancData);
  const hndTotal  = sumCount(hndData);
  const collPct   = pct(payments.TotalPaid ?? 0, payments.TotalDue ?? 0);

  const axisColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "rgba(245,158,11,0.10)" : "rgba(245,158,11,0.15)";

  const bookingPie = bkgsData.map((b: any, i: number) => ({
    name: b.Status,
    value: b.Count,
    color: STATUS_PIE_COLORS[b.Status] ?? PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  const appPie = appsData.map((a: any, i: number) => ({
    name: a.Status,
    value: a.Count,
    color: STATUS_PIE_COLORS[a.Status] ?? PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  const minutesAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
  const updatedLabel = minutesAgo === 0 ? "Just now" : `${minutesAgo}m ago`;

  const alertCards = [
    { count: alerts.overduePayments ?? 0,      label: "Overdue Payments",       sublabel: "Demand milestones past due date",        icon: IndianRupee,  severity: (alerts.overduePayments      > 0 ? "critical" : "ok") as any, route: "/crm/payments" },
    { count: alerts.welcomeCallPending ?? 0,   label: "Welcome Calls Pending",  sublabel: "Approved bookings, no call done",         icon: Phone,        severity: (alerts.welcomeCallPending   > 0 ? "warning"  : "ok") as any, route: "/crm/welcome-calls" },
    { count: alerts.agreementsPending ?? 0,    label: "Agreements Need Action", sublabel: "No agreement or draft > 5 days",          icon: Scale,        severity: (alerts.agreementsPending    > 0 ? "warning"  : "ok") as any, route: "/crm/agreements" },
    { count: alerts.disputedNotices ?? 0,      label: "Notices Disputed",       sublabel: "Possession notice disputed by customer",  icon: BadgeAlert,   severity: (alerts.disputedNotices      > 0 ? "critical" : "ok") as any, route: "/crm/possession-notice" },
    { count: alerts.deedsAwaitingCustomer ?? 0,label: "Deeds Awaiting Customer",sublabel: "Customer hasn't approved on portal",      icon: FileText,     severity: (alerts.deedsAwaitingCustomer> 0 ? "warning"  : "ok") as any, route: "/crm/sales-deed" },
    { count: alerts.deedsAwaitingDirector ?? 0,label: "Deeds Awaiting Director",sublabel: "Pending director approval",               icon: FileText,     severity: (alerts.deedsAwaitingDirector> 0 ? "info"     : "ok") as any, route: "/crm/sales-deed" },
    { count: alerts.nocsNotIssued ?? 0,        label: "NOCs Not Issued",        sublabel: "Approved but not physically issued",      icon: ClipboardList,severity: (alerts.nocsNotIssued        > 0 ? "warning"  : "ok") as any, route: "/crm/noc" },
    { count: alerts.cancellationsPending ?? 0, label: "Cancellations Pending",  sublabel: "Awaiting management approval",            icon: XCircle,      severity: (alerts.cancellationsPending > 0 ? "warning"  : "ok") as any, route: "/crm/cancellations" },
    { count: alerts.urgentTickets ?? 0,        label: "Urgent/High Tickets",    sublabel: "After-sales, unresolved high priority",   icon: Wrench,       severity: (alerts.urgentTickets        > 0 ? "critical" : "ok") as any, route: "/crm/service-tickets" },
    { count: alerts.handoversThisWeek ?? 0,    label: "Handovers This Week",    sublabel: "Scheduled in next 7 days",                icon: Key,          severity: "info" as any,                                                  route: "/crm/handover" },
  ];

  // Accent colours for pipeline glass cards
  const pipelineCards = [
    {
      icon: ClipboardList, label: "Applications", accent: "#f59e0b",
      route: "/crm/applications", total: appsTotal,
      bars: appsData.map((a: any) => ({ label: a.Status, value: a.Count, color: STATUS_PIE_COLORS[a.Status] ?? "#f59e0b" })),
      footer: appsTotal > 0 ? `${appsTotal} total` : null,
    },
    {
      icon: BookOpen, label: "Bookings", accent: "#22c55e",
      route: "/crm/bookings", total: bkgsTotal,
      bars: bkgsData.map((b: any) => ({
        label: b.Status, value: b.Count,
        color: b.Status === CrmStatus.APPROVED ? "#22c55e" : b.Status === CrmStatus.CANCELLED ? "#ef4444" : "#f59e0b",
      })),
      footer: bkgsTotal > 0
        ? `${bkgsTotal} total · ${fmtCr(bkgsData.reduce((s: number, b: any) => s + (b.TotalValue || 0), 0))} value`
        : null,
    },
    {
      icon: Wrench, label: "Service Tickets", accent: "#f97316",
      route: "/crm/service-tickets", total: tickTotal,
      bars: tickData.map((t: any) => ({ label: t.Status, value: t.Count, color: "#f97316" })),
      footer: tickTotal > 0 ? `${tickTotal} total` : null,
    },
    {
      icon: XCircle, label: "Cancellations", accent: "#ef4444",
      route: "/crm/cancellations", total: cancTotal,
      bars: cancData.map((c: any) => ({ label: c.Status, value: c.Count, color: "#ef4444" })),
      footer: cancTotal > 0 ? `${cancTotal} total` : null,
    },
    {
      icon: Key, label: "Handovers", accent: "#6366f1",
      route: "/crm/handover", total: hndTotal,
      bars: hndData.map((h: any) => ({
        label: h.Status, value: h.Count,
        color: h.Status === "Completed" ? "#22c55e" : h.Status === "Scheduled" ? "#6366f1" : "#f59e0b",
      })),
      footer: hndTotal > 0 ? `${hndTotal} total` : null,
    },
  ];

  // Key numbers for CrmGlassCard row
  const keyNumbers = [
    {
      label: "Sold This Month",
      value: metrics.unitsSoldThisMonth ?? 0,
      sub: `${fmtCr(metrics.revenueThisMonth ?? 0)} in value`,
      icon: BookOpen,
      accent: "#22c55e",
      route: "/crm/bookings",
    },
    {
      label: "Total Collection",
      value: `${collPct}%`,
      sub: `${fmtCr(payments.TotalPaid ?? 0)} of ${fmtCr(payments.TotalDue ?? 0)}`,
      icon: IndianRupee,
      accent: "#f59e0b",
      route: "/crm/payments",
    },
    {
      label: "Due Next 30 Days",
      value: fmtCr(metrics.forwardDue30Days ?? 0),
      sub: `Across ${metrics.forwardDueCount ?? 0} milestones`,
      icon: ArrowUpRight,
      accent: "#f97316",
      route: "/crm/payments",
    },
    {
      label: "Open Service Tickets",
      value: sumCount(tickData.filter((t: any) => !["Resolved", "Closed"].includes(t.Status))),
      sub: `${tickTotal} total tickets`,
      icon: Wrench,
      accent: "#b45309",
      route: "/crm/service-tickets",
    },
  ];

  return (
    <CrmShell
      title="CRM Dashboard"
      subtitle="Pipeline, closures, analytics and after-sales — all in one view"
      icon={LayoutDashboard}
    >
      <Breadcrumbs items={["Dashboard", "CRM"]} />

      {/* -- Top bar: project selector + refresh -------------------------------- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-muted-foreground shrink-0" />
          <Select value={projectId || "__all__"} onValueChange={handleProjectChange}>
            <SelectTrigger className="text-sm min-w-[200px] h-8 focus:ring-amber-500/40 focus:ring-1">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Projects</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={p.Id} value={String(p.Id)}>{p.Name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>Updated {updatedLabel}</span>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border hover:bg-muted/60 transition-colors ${isFetching ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* -- SECTION 1: Attention Required ------------------------------------- */}
      <CrmSection title="Attention Required" icon={AlertTriangle} accentColor="#ef4444">
        <p className="text-xs text-muted-foreground -mt-1 mb-2">
          Items that need human action today — click any card to go directly to that module
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {isLoading
            ? Array.from({ length: 10 }).map((_, i) => <AlertSkeleton key={i} />)
            : alertCards.map((c) => <AlertCard key={c.label} {...c} />)}
        </div>
        {!isLoading && alertCards.filter(c => c.severity !== "ok" && c.count > 0).length === 0 && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
            <CheckCircle2 size={16} /> All clear — no items need immediate attention
          </div>
        )}
      </CrmSection>

      {/* -- SECTION 2: Key Numbers -------------------------------------------- */}
      <CrmSection title="Key Numbers" icon={BarChart3} accentColor="#f59e0b">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <GlassCardSkeleton key={i} />)
            : keyNumbers.map((s) => (
                <CrmGlassCard
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  sub={s.sub}
                  icon={s.icon}
                  accentColor={s.accent}
                  onClick={() => navigate(s.route)}
                />
              ))}
        </div>
      </CrmSection>

      {/* -- SECTION 3: Pipeline Overview (glass cards) ------------------------ */}
      <CrmSection title="Pipeline Overview" icon={ClipboardList} accentColor="#f59e0b">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <GlassCardSkeleton key={i} />)
            : pipelineCards.map((card) => (
                <CrmGlassCard
                  key={card.label}
                  label={card.label}
                  value={card.total}
                  icon={card.icon}
                  accentColor={card.accent}
                  onClick={() => navigate(card.route)}
                  sub={card.footer ?? undefined}
                >
                  {card.bars.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      {card.bars.map((b) => (
                        <HBar key={b.label} label={b.label} value={b.value} total={card.total} color={b.color} />
                      ))}
                    </div>
                  )}
                  {card.bars.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-2">None yet</p>
                  )}
                </CrmGlassCard>
              ))}
        </div>

        {/* Payment Collection card — separate since it has a different internal layout */}
        {!isLoading && (
          <div className="mt-3">
            <CrmGlassCard
              label="Payment Collection"
              value={`${collPct}%`}
              icon={IndianRupee}
              accentColor={collPct >= 80 ? "#22c55e" : collPct >= 50 ? "#f59e0b" : "#ef4444"}
              onClick={() => navigate("/crm/payments")}
              sub={`${fmtCr(payments.TotalPaid ?? 0)} collected of ${fmtCr(payments.TotalDue ?? 0)} total demand`}
            >
              <div className="mt-2 pt-2 border-t border-border/30">
                <div className="w-full bg-muted/50 rounded-full h-2 mb-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${collPct}%`,
                      background: collPct >= 80 ? "#22c55e" : collPct >= 50 ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
                {(payments.OverdueCount ?? 0) > 0 && (
                  <p className="text-xs text-red-500 font-medium">{payments.OverdueCount} milestone(s) overdue</p>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div>
                    <div className="text-muted-foreground">Due 30 days</div>
                    <div className="font-semibold">{fmtCr(metrics.forwardDue30Days ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Milestones</div>
                    <div className="font-semibold">{metrics.forwardDueCount ?? 0}</div>
                  </div>
                </div>
              </div>
            </CrmGlassCard>
          </div>
        )}
      </CrmSection>

      {/* -- SECTION 4: Conversion Funnel -------------------------------------- */}
      <CrmSection title="Conversion Funnel" icon={TrendingUp} accentColor="#f59e0b">
        <p className="text-xs text-muted-foreground -mt-1 mb-4">
          Pipeline conversion from Applications through to Possession
        </p>
        {isLoading
          ? <Skeleton className="h-28 w-full rounded-xl" />
          : (() => {
              const f = data?.funnel ?? { Applications: 0, Bookings: 0, Agreements: 0, Possessions: 0 };
              const stages: { label: string; key: keyof typeof f; color: string; route: string }[] = [
                { label: "Applications", key: "Applications", color: "#f59e0b", route: "/crm/applications" },
                { label: "Bookings",     key: "Bookings",     color: "#22c55e", route: "/crm/bookings" },
                { label: "Agreements",   key: "Agreements",   color: "#3b82f6", route: "/crm/agreements" },
                { label: "Possessions",  key: "Possessions",  color: "#8b5cf6", route: "/crm/handover" },
              ];
              const top = Math.max(1, f.Applications);
              return (
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{
                    background: isDark ? "rgba(15,12,3,0.45)" : "rgba(255,255,255,0.72)",
                    border: "1px solid rgba(245,158,11,0.18)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                  }}
                >
                  {stages.map((s, i) => {
                    const count = f[s.key] as number;
                    const prev  = i === 0 ? null : f[stages[i - 1].key] as number;
                    const p     = Math.round((count / top) * 100);
                    const conv  = prev != null && prev > 0 ? Math.round((count / prev) * 100) : null;
                    return (
                      <button
                        key={s.label}
                        onClick={() => navigate(s.route)}
                        className="w-full text-left group"
                      >
                        <div className="flex items-center justify-between mb-1 text-xs">
                          <span className="font-medium text-foreground">{s.label}</span>
                          <div className="flex items-center gap-2">
                            {conv !== null && (
                              <span className="text-muted-foreground">{conv}% of prev</span>
                            )}
                            <span className="font-bold tabular-nums" style={{ color: s.color }}>
                              {count.toLocaleString()}
                            </span>
                            <ChevronRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <div className="w-full h-5 rounded-lg bg-muted/50 overflow-hidden">
                          <div
                            className="h-full rounded-lg transition-all duration-500"
                            style={{ width: `${Math.max(p, count > 0 ? 2 : 0)}%`, background: s.color, opacity: 0.85 }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()
        }
      </CrmSection>

      {/* -- SECTION 5: Status Distribution – Pie Charts ----------------------- */}
      <CrmSection title="Status Distribution" icon={PieIcon} accentColor="#f59e0b">
        <p className="text-xs text-muted-foreground -mt-1 mb-3">
          Booking and application status breakdown as of now
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GlassPanel title="Bookings by Status">
            {isLoading ? <Skeleton className="h-[200px] w-full" />
              : bkgsTotal === 0
                ? <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No bookings yet</div>
                : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={180}>
                      <PieChart>
                        <Pie data={bookingPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={2}>
                          {bookingPie.map((entry, i) => <Cell key={i} fill={bwChartColor(theme, i, entry.color)} />)}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2 min-w-0">
                      {bookingPie.map((entry, i) => (
                        <div key={entry.name} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: bwChartColor(theme, i, entry.color) }} />
                          <span className="text-muted-foreground truncate flex-1">{entry.name}</span>
                          <span className="font-semibold tabular-nums">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
          </GlassPanel>

          <GlassPanel title="Applications by Status">
            {isLoading ? <Skeleton className="h-[200px] w-full" />
              : appsTotal === 0
                ? <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No applications yet</div>
                : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={180}>
                      <PieChart>
                        <Pie data={appPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={2}>
                          {appPie.map((entry, i) => <Cell key={i} fill={bwChartColor(theme, i, entry.color)} />)}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2 min-w-0">
                      {appPie.map((entry, i) => (
                        <div key={entry.name} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: bwChartColor(theme, i, entry.color) }} />
                          <span className="text-muted-foreground truncate flex-1">{entry.name}</span>
                          <span className="font-semibold tabular-nums">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
          </GlassPanel>
        </div>
      </CrmSection>

      {/* -- SECTION 6: Monthly Trend – line + histogram ----------------------- */}
      <CrmSection title="Monthly Trend" icon={TrendingUp} accentColor="#f59e0b">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <GlassPanel title="Applications & Bookings">
            {isLoading ? <Skeleton className="h-[180px] w-full" />
              : !data?.monthlyTrend?.length
                ? <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No data yet</div>
                : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={data.monthlyTrend} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="MonthLabel" tick={{ fontSize: 10, fill: axisColor }} axisLine={{ stroke: gridColor }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: isDark ? "#1c1408" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="Applications" stroke={theme === "bw" ? "#FFA500" : "#f59e0b"} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="Bookings" stroke={theme === "bw" ? "#008000" : "#22c55e"} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
          </GlassPanel>

          <GlassPanel title="Collections by Month (₹)">
            {isLoading ? <Skeleton className="h-[180px] w-full" />
              : !data?.monthlyTrend?.length
                ? <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No data yet</div>
                : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.monthlyTrend} margin={{ top: 4, right: 12, left: -6, bottom: 0 }}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="MonthLabel" tick={{ fontSize: 10, fill: axisColor }} axisLine={{ stroke: gridColor }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip formatter={(v: number) => fmtINR(v)}
                        contentStyle={{ background: isDark ? "#1c1408" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="Collected" name="Collected (₹)" radius={[4, 4, 0, 0]}>
                        {(data?.monthlyTrend ?? []).map((_: any, i: number) => (
                          <Cell key={i} fill={bwChartColor(theme, i, PROJECT_COLORS[i % PROJECT_COLORS.length])} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
          </GlassPanel>
        </div>
      </CrmSection>

      {/* -- SECTION 7: Collection by Project ---------------------------------- */}
      {(metrics.collectionPerProject?.length ?? 0) > 0 && (
        <CrmSection title="Collection by Project" icon={Building2} accentColor="#f59e0b">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">
            Payment collected vs total demand — per project
          </p>
          <GlassPanel title="">
            <div className="space-y-4">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                : (metrics.collectionPerProject ?? []).map((row: any) => (
                    <CollectionBar key={row.ProjectName} row={row} />
                  ))}
            </div>
          </GlassPanel>
        </CrmSection>
      )}

      {/* -- SECTION 8: This Week's Schedule ----------------------------------- */}
      <CrmSection title="This Week's Schedule" icon={Calendar} accentColor="#f59e0b">
        <p className="text-xs text-muted-foreground -mt-1 mb-2">
          Handovers (green) · Registry appointments (blue) · Payment milestones due (amber)
        </p>
        {isLoading
          ? <Skeleton className="h-28 w-full rounded-xl" />
          : <ThisWeekStrip data={data?.thisWeek ?? []} />}
      </CrmSection>
    </CrmShell>
  );
};

export default CrmDashboard;
