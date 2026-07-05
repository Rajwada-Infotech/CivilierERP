import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTask } from "@/contexts/TaskContext";
import {
  GlassShell,
  GlassCard,
  GlassSection,
} from "@/components/dashboard/GlassShell";
import {
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  Phone,
  ListTodo,
  Users,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Home,
  Banknote,
  HandshakeIcon,
  HardHat,
  CalendarCheck,
  PhoneCall,
  Scale,
} from "lucide-react";

const ACCENT = "#0d9488"; // teal — matches Follow-Up's ModuleStrip color
const SECONDARY = "#8b5cf6"; // violet bloom

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Task status badge colors ──────────────────────────────────────────────────

const taskStatusColors: Record<string, string> = {
  open: "bg-slate-500/10 text-slate-600 border-slate-400/20",
  in_progress: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  closed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  reviewed: "bg-purple-500/10 text-purple-600 border-purple-400/20",
};

function StatusBadge({
  status,
  map,
}: {
  status: string;
  map: Record<string, string>;
}) {
  const cls =
    map[status?.toLowerCase?.()] ??
    "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      {status || "—"}
    </span>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  sub,
  action,
  onAction,
  iconColor = "text-indigo-600",
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
  iconColor?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <Icon size={16} className={iconColor} />
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            {title}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          {action} <ArrowUpRight size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <CheckCircle2 size={28} className="opacity-30" />
      <p className="text-xs">{label}</p>
    </div>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

function TableSkeleton({
  rows = 4,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="p-4 space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({
  data,
  barColor = "bg-indigo-500",
}: {
  data: { status: string; count: number }[];
  barColor?: string;
}) {
  if (!data?.length)
    return <p className="text-xs text-muted-foreground py-2">No data yet</p>;
  const total = data.reduce((s, r) => s + Number(r.count), 0);
  return (
    <div className="space-y-2 mt-3">
      {data.map((row) => {
        const pct =
          total > 0 ? Math.round((Number(row.count) / total) * 100) : 0;
        return (
          <div key={row.status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span className="capitalize">
                {row.status.replace(/_/g, " ") || "—"}
              </span>
              <span className="font-medium text-foreground">{row.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Pipeline Funnel ──────────────────────────────────────────────────────────

function PipelineFunnel({
  stages,
  isLoading,
}: {
  stages: {
    label: string;
    count: number;
    icon: React.ElementType;
    barColor: string;
    iconColor: string;
  }[];
  isLoading: boolean;
}) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="space-y-2.5">
      {isLoading
        ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 bg-muted rounded-lg animate-pulse" />
          ))
        : stages.map((stage) => {
            const Icon = stage.icon;
            const pct = Math.max(Math.round((stage.count / max) * 100), 4);
            return (
              <div key={stage.label} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-28 shrink-0">
                  <Icon size={12} className={stage.iconColor} />
                  <span className="text-[10px] text-muted-foreground truncate">
                    {stage.label}
                  </span>
                </div>
                <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden">
                  <div
                    className={`h-full rounded-md ${stage.barColor} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-foreground w-6 text-right shrink-0">
                  {stage.count}
                </span>
              </div>
            );
          })}
    </div>
  );
}

// ─── Log type icon ────────────────────────────────────────────────────────────

function logIcon(type: string) {
  switch (type) {
    case "email":
      return Mail;
    case "call":
      return Phone;
    case "payment":
      return CheckCircle2;
    default:
      return FileText;
  }
}

// ── Legal Pending Panel ────────────────────────────────────────────────────────

function LegalPendingPanel({ items }: { items: any[] }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold">Legal Pending</h3>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 8).map((item) => (
          <div
            key={item.Id}
            className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 cursor-pointer transition-colors"
            onClick={() => navigate("/followup/legal/milestones")}
          >
            <div>
              <p className="text-sm font-medium text-foreground">{item.ApplicantName}</p>
              <p className="text-xs text-muted-foreground">
                Step {item.CurrentStep}/8 · {item.MilestoneNo}
              </p>
            </div>
            <div className="text-right">
              {item.CurrentStepDue ? (
                <p
                  className={`text-xs font-medium ${
                    new Date(item.CurrentStepDue) < new Date()
                      ? "text-red-500"
                      : "text-muted-foreground"
                  }`}
                >
                  {new Date(item.CurrentStepDue) < new Date()
                    ? "Overdue"
                    : `Due ${item.CurrentStepDue}`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No due date</p>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No pending legal milestones
          </div>
        )}
      </div>
    </div>
  );
}

// ── Milestone Tracker Panel ────────────────────────────────────────────────────

function MilestoneTrackerPanel({ stats }: { stats: any }) {
  const total = stats?.Total || 0;
  const completed = stats?.Completed || 0;
  const inProgress = stats?.InProgress || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-violet-500" />
        <h3 className="text-sm font-semibold">Milestone Tracker</h3>
      </div>
      <div className="flex items-end gap-3 mb-3">
        <span className="text-3xl font-bold font-heading">{pct}%</span>
        <span className="text-sm text-muted-foreground mb-1">completion rate</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 mb-4">
        <div
          className="h-2 rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: total, color: "text-foreground" },
          { label: "Completed", value: completed, color: "text-emerald-600" },
          { label: "In Progress", value: inProgress, color: "text-blue-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Possession Pipeline Panel ──────────────────────────────────────────────────

function PossessionPipelinePanel({ items }: { items: any[] }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Possession Pipeline</h3>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 8).map((item) => (
          <div
            key={item.Id}
            className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 cursor-pointer"
            onClick={() => navigate("/followup/closure/possession-notice")}
          >
            <div>
              <p className="text-sm font-medium">{item.ApplicantName}</p>
              <p className="text-xs text-muted-foreground">
                {item.UnitNo || "—"} · {item.NoticeType}
              </p>
            </div>
            <div className="text-right">
              <p
                className={`text-xs font-semibold ${
                  item.DaysRemaining < 0
                    ? "text-red-500"
                    : item.DaysRemaining <= 7
                      ? "text-amber-500"
                      : "text-emerald-600"
                }`}
              >
                {item.DaysRemaining < 0
                  ? `${Math.abs(item.DaysRemaining)}d overdue`
                  : item.DaysRemaining === 0
                    ? "Today"
                    : `${item.DaysRemaining}d remaining`}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {item.ScheduledPossDate}
              </p>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No active possession notices
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function FollowupDashboard() {
  const navigate = useNavigate();
  const { tasks, getOverdueTasks, getDueSoonTasks } = useTask();

  // Task stats from TaskContext
  const followupTasks = tasks.filter((t) => t.module === "followup");
  const overdueTasks = getOverdueTasks();
  const dueSoonTasks = getDueSoonTasks();
  const completedTasks = followupTasks.filter(
    (t) => t.status === "closed" || t.status === "reviewed",
  );
  const pendingTasks = followupTasks.filter((t) =>
    ["open", "in_progress"].includes(t.status),
  );

  // ── Followup module queries ─────────────────────────────────────────────────

  const { data: applicationsRes, isLoading: applicationsLoading } = useQuery({
    queryKey: ["dashboard-applications"],
    queryFn: () =>
      fetchWithAuth("/api/followup-applications?pageSize=500").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: bookingsRes, isLoading: bookingsLoading } = useQuery({
    queryKey: ["dashboard-bookings"],
    queryFn: () =>
      fetchWithAuth("/api/followup-bookings?pageSize=500").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: unitSelectionsRes, isLoading: unitSelectionsLoading } =
    useQuery({
      queryKey: ["dashboard-unit-selections"],
      queryFn: () =>
        fetchWithAuth("/api/followup-unit-selections?pageSize=500").then((r) =>
          r.json().catch(() => ({})),
        ),
      staleTime: 2 * 60 * 1000,
    });

  const { data: agreementsRes, isLoading: agreementsLoading } = useQuery({
    queryKey: ["dashboard-agreements"],
    queryFn: () =>
      fetchWithAuth("/api/followup-agreements?pageSize=500").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: nocRes, isLoading: nocLoading } = useQuery({
    queryKey: ["dashboard-noc"],
    queryFn: () =>
      fetchWithAuth("/api/followup-noc?pageSize=500").then((r) => r.json().catch(() => ({}))),
    staleTime: 2 * 60 * 1000,
  });

  const { data: salesDeedRes, isLoading: salesDeedLoading } = useQuery({
    queryKey: ["dashboard-sales-deed"],
    queryFn: () =>
      fetchWithAuth("/api/followup-sales-deed?pageSize=500").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: handoverRes, isLoading: handoverLoading } = useQuery({
    queryKey: ["dashboard-handover"],
    queryFn: () =>
      fetchWithAuth("/api/followup-handover?pageSize=500").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: constructionRes } = useQuery({
    queryKey: ["dashboard-construction"],
    queryFn: () =>
      fetchWithAuth("/api/followup-construction-updates?pageSize=500").then(
        (r) => r.json().catch(() => ({})),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const {
    data: logData,
    isLoading: logLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["followup-dashboard-log"],
    queryFn: () => fetchWithAuth("/api/followup-log").then((r) => r.json().catch(() => ({}))),
    staleTime: 2 * 60 * 1000,
  });

  const { data: dashboardSummary } = useQuery({
    queryKey: ["followup-dashboard-summary"],
    queryFn: () =>
      fetchWithAuth("/api/followup-dashboard/summary").then((r) => r.json().catch(() => ({}))),
    staleTime: 2 * 60 * 1000,
  });

  // ── Normalise arrays ────────────────────────────────────────────────────────

  const applications: any[] = useMemo(
    () =>
      Array.isArray(applicationsRes)
        ? applicationsRes
        : (applicationsRes?.data ?? []),
    [applicationsRes],
  );
  const bookings: any[] = useMemo(
    () =>
      Array.isArray(bookingsRes) ? bookingsRes : (bookingsRes?.data ?? []),
    [bookingsRes],
  );
  const unitSelections: any[] = useMemo(
    () =>
      Array.isArray(unitSelectionsRes)
        ? unitSelectionsRes
        : (unitSelectionsRes?.data ?? []),
    [unitSelectionsRes],
  );
  const agreements: any[] = useMemo(
    () =>
      Array.isArray(agreementsRes)
        ? agreementsRes
        : (agreementsRes?.data ?? []),
    [agreementsRes],
  );
  const nocs: any[] = useMemo(
    () => (Array.isArray(nocRes) ? nocRes : (nocRes?.data ?? [])),
    [nocRes],
  );
  const salesDeeds: any[] = useMemo(
    () =>
      Array.isArray(salesDeedRes) ? salesDeedRes : (salesDeedRes?.data ?? []),
    [salesDeedRes],
  );
  const handovers: any[] = useMemo(
    () =>
      Array.isArray(handoverRes) ? handoverRes : (handoverRes?.data ?? []),
    [handoverRes],
  );
  const constructions: any[] = useMemo(
    () =>
      Array.isArray(constructionRes)
        ? constructionRes
        : (constructionRes?.data ?? []),
    [constructionRes],
  );
  const logs: any[] = useMemo(
    () => (Array.isArray(logData) ? logData : (logData?.data ?? [])),
    [logData],
  );

  // ── Derived KPIs ────────────────────────────────────────────────────────────

  const activeAgreements = agreements.filter(
    (a) => a.Status === "Signed",
  ).length;
  const pendingNOCs = nocs.filter((n) => n.Status === "Pending").length;
  const scheduledHandovers = handovers.filter(
    (h) => h.Status === "Scheduled",
  ).length;
  const confirmedBookings = bookings.filter(
    (b) => b.Status === "Confirmed",
  ).length;

  // ── Pipeline stages ─────────────────────────────────────────────────────────

  const pipelineLoading =
    applicationsLoading ||
    bookingsLoading ||
    unitSelectionsLoading ||
    agreementsLoading ||
    nocLoading ||
    salesDeedLoading ||
    handoverLoading;

  const pipelineStages = [
    {
      label: "Applications",
      count: applications.length,
      icon: Users,
      iconColor: "text-indigo-600",
      barColor: "bg-indigo-500/70",
    },
    {
      label: "Bookings",
      count: bookings.length,
      icon: CalendarCheck,
      iconColor: "text-sky-600",
      barColor: "bg-sky-500/70",
    },
    {
      label: "Unit Selections",
      count: unitSelections.length,
      icon: Home,
      iconColor: "text-teal-600",
      barColor: "bg-teal-500/70",
    },
    {
      label: "Agreements",
      count: agreements.length,
      icon: HandshakeIcon,
      iconColor: "text-violet-600",
      barColor: "bg-violet-500/70",
    },
    {
      label: "NOC",
      count: nocs.length,
      icon: ClipboardCheck,
      iconColor: "text-amber-600",
      barColor: "bg-amber-500/70",
    },
    {
      label: "Sales Deed",
      count: salesDeeds.length,
      icon: FileText,
      iconColor: "text-emerald-600",
      barColor: "bg-emerald-500/70",
    },
    {
      label: "Handover",
      count: handovers.length,
      icon: Home,
      iconColor: "text-cyan-600",
      barColor: "bg-cyan-500/70",
    },
  ];

  // ── Status breakdowns ───────────────────────────────────────────────────────

  const agreementStatusBreakdown = [
    "Draft",
    "Issued",
    "Signed",
    "Cancelled",
  ].map((s) => ({
    status: s,
    count: agreements.filter((a) => a.Status === s).length,
  }));

  const bookingStatusBreakdown = ["Draft", "Confirmed", "Cancelled"].map(
    (s) => ({
      status: s,
      count: bookings.filter((b) => b.Status === s).length,
    }),
  );

  const nocStatusBreakdown = ["Pending", "Approved", "Issued", "Rejected"].map(
    (s) => ({
      status: s,
      count: nocs.filter((n) => n.Status === s).length,
    }),
  );

  const taskStatusBreakdown = ["open", "in_progress", "closed", "reviewed"].map(
    (s) => ({
      status: s,
      count: followupTasks.filter((t) => t.status === s).length,
    }),
  );

  const applicationStatusBreakdown = [
    "New",
    "Qualified",
    "Shortlisted",
    "Document Pending",
    "Rejected",
  ].map((s) => ({
    status: s,
    count: applications.filter((a) => a.Status === s).length,
  }));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up"]} />
      <GlassShell
        title="Follow-Up Overview"
        subtitle="Sales pipeline, agreements, closures and construction across all projects"
        icon={HandshakeIcon}
        accentColor={ACCENT}
        secondaryColor={SECONDARY}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ borderColor: `${ACCENT}4d`, color: ACCENT }}
          >
            <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
            Refresh
          </button>
        }
      >
        {/* ── KPI Row — Sales Pipeline ── */}
        <GlassSection title="Sales Pipeline" icon={Users} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <GlassCard
              label="Applications"
              value={fmtNum(applications.length)}
              sub={`${applications.filter((a) => a.Status === "New" || a.Status === "Qualified").length} active`}
              icon={Users}
              accentColor={ACCENT}
              onClick={() => navigate("/followup/sales/applications")}
            />
            <GlassCard
              label="Confirmed Bookings"
              value={fmtNum(confirmedBookings)}
              sub={`${bookings.length} total bookings`}
              icon={CalendarCheck}
              accentColor="#0ea5e9"
              trend={confirmedBookings > 0 ? "up" : "neutral"}
              onClick={() => navigate("/followup/sales/bookings")}
            />
            <GlassCard
              label="Unit Selections"
              value={fmtNum(unitSelections.length)}
              sub={`${unitSelections.filter((u) => u.Status === "Reserved").length} reserved`}
              icon={Home}
              accentColor="#14b8a6"
              onClick={() => navigate("/followup/sales/unit-selection")}
            />
            <GlassCard
              label="Active Agreements"
              value={fmtNum(activeAgreements)}
              sub={`${agreements.length} total`}
              icon={HandshakeIcon}
              accentColor={SECONDARY}
              trend={activeAgreements > 0 ? "up" : "neutral"}
              onClick={() => navigate("/followup/agreement/agreements")}
            />
            <GlassCard
              label="Pending NOCs"
              value={fmtNum(pendingNOCs)}
              sub={`${nocs.length} total NOCs`}
              icon={ClipboardCheck}
              accentColor="#f59e0b"
              trend={pendingNOCs > 0 ? "down" : "neutral"}
              onClick={() => navigate("/followup/closure/noc")}
            />
            <GlassCard
              label="Upcoming Handovers"
              value={fmtNum(scheduledHandovers)}
              sub={`${handovers.length} total`}
              icon={Banknote}
              accentColor="#06b6d4"
              trend={scheduledHandovers > 0 ? "up" : "neutral"}
              onClick={() => navigate("/followup/closure/handover")}
            />
          </div>
        </GlassSection>

        {/* ── KPI Row 2 — Tasks ── */}
        <GlassSection title="Tasks" icon={ListTodo} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GlassCard
              label="Overdue Tasks"
              value={fmtNum(overdueTasks.length)}
              sub={`${fmtNum(pendingTasks.length)} still pending`}
              icon={AlertCircle}
              accentColor="#ef4444"
              trend={overdueTasks.length > 0 ? "down" : "neutral"}
              onClick={() => navigate("/followup/follow-ups/tasks")}
            />
            <GlassCard
              label="Due Soon"
              value={fmtNum(dueSoonTasks.length)}
              sub="Tasks due within 3 days"
              icon={Clock}
              accentColor="#f59e0b"
              trend={dueSoonTasks.length > 0 ? "down" : "neutral"}
              onClick={() => navigate("/followup/follow-ups/tasks")}
            />
            <GlassCard
              label="Completed Tasks"
              value={fmtNum(completedTasks.length)}
              sub={`${fmtNum(followupTasks.length)} total`}
              icon={CheckCircle2}
              accentColor="#10b981"
              trend="up"
              onClick={() => navigate("/followup/follow-ups/tasks")}
            />
            <GlassCard
              label="Construction Updates"
              value={fmtNum(constructions.length)}
              sub="Site progress entries"
              icon={HardHat}
              accentColor="#f97316"
              onClick={() => navigate("/followup/construction/updates")}
            />
          </div>
        </GlassSection>

        {/* ── New panels row: Milestone Tracker + Legal Pending + Possession Pipeline ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <MilestoneTrackerPanel stats={dashboardSummary?.milestoneTracker} />
          <LegalPendingPanel items={dashboardSummary?.legalPending ?? []} />
          <PossessionPipelinePanel items={dashboardSummary?.possessionPipeline ?? []} />
        </div>

        {/* ── Pipeline Funnel + Status Breakdowns ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sales pipeline funnel */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={BarChart3}
                title="Sales Pipeline"
                sub="Application → Handover"
                iconColor="text-indigo-600"
              />
            </div>
            <div className="p-4">
              <PipelineFunnel
                stages={pipelineStages}
                isLoading={pipelineLoading}
              />
            </div>
          </div>

          {/* Application status */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={Users}
              title="Application Status"
              sub="By current status"
              action="View all"
              onAction={() => navigate("/followup/sales/applications")}
              iconColor="text-indigo-600"
            />
            {applicationsLoading ? (
              <div className="space-y-2 mt-3 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBar
                data={applicationStatusBreakdown}
                barColor="bg-indigo-500"
              />
            )}
          </div>

          {/* Booking status */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={CalendarCheck}
              title="Booking Status"
              sub="By current status"
              action="View all"
              onAction={() => navigate("/followup/sales/bookings")}
              iconColor="text-sky-600"
            />
            {bookingsLoading ? (
              <div className="space-y-2 mt-3 animate-pulse">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBar data={bookingStatusBreakdown} barColor="bg-sky-500" />
            )}
          </div>
        </div>

        {/* ── Agreement + NOC Status ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={HandshakeIcon}
              title="Agreement Status"
              sub="By current status"
              action="View all"
              onAction={() => navigate("/followup/agreement/agreements")}
              iconColor="text-violet-600"
            />
            {agreementsLoading ? (
              <div className="space-y-2 mt-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBar
                data={agreementStatusBreakdown}
                barColor="bg-violet-500"
              />
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={ClipboardCheck}
              title="NOC Status"
              sub="By current status"
              action="View all"
              onAction={() => navigate("/followup/closure/noc")}
              iconColor="text-amber-600"
            />
            {nocLoading ? (
              <div className="space-y-2 mt-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBar data={nocStatusBreakdown} barColor="bg-amber-500" />
            )}
          </div>
        </div>

        {/* ── Recent Applications + Recent Bookings ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Applications */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Users}
                title="Recent Applications"
                sub="Latest entries"
                action="View all"
                onAction={() => navigate("/followup/sales/applications")}
                iconColor="text-indigo-600"
              />
            </div>
            {applicationsLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : applications.length === 0 ? (
              <EmptyState label="No applications yet" />
            ) : (
              <div className="divide-y divide-border">
                {applications.slice(0, 6).map((a: any) => (
                  <div
                    key={a.Id ?? a.ApplicantNo}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                      <Users size={12} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {a.ApplicantName || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {a.ProjectName || a.CompanyName || "—"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {a.ApplicantNo || `#${a.Id}`}
                      </span>
                      {a.Status && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-400/20">
                          {a.Status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Bookings */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={CalendarCheck}
                title="Recent Bookings"
                sub="Latest entries"
                action="View all"
                onAction={() => navigate("/followup/sales/bookings")}
                iconColor="text-sky-600"
              />
            </div>
            {bookingsLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : bookings.length === 0 ? (
              <EmptyState label="No bookings yet" />
            ) : (
              <div className="divide-y divide-border">
                {bookings.slice(0, 6).map((b: any) => (
                  <div
                    key={b.Id ?? b.BookingNo}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-md bg-sky-500/10 flex items-center justify-center shrink-0">
                      <CalendarCheck size={12} className="text-sky-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {b.ApplicantName || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {b.ProjectName || "—"}
                        {b.UnitNo ? ` · ${b.UnitNo}` : ""}
                        {b.BookingAmount
                          ? ` · ₹${Number(b.BookingAmount).toLocaleString("en-IN")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {b.BookingNo || `#${b.Id}`}
                      </span>
                      {b.Status && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                            b.Status === "Confirmed"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
                              : b.Status === "Cancelled"
                                ? "bg-red-500/10 text-red-600 border-red-400/20"
                                : "bg-sky-500/10 text-sky-600 border-sky-400/20"
                          }`}
                        >
                          {b.Status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Activity Log + Task Section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity Log */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={FileText}
                title="Recent Activity Log"
                sub="Last communication entries"
                action="View all"
                onAction={() => navigate("/followup/follow-ups/log")}
                iconColor="text-purple-600"
              />
            </div>
            {logLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : logs.length === 0 ? (
              <EmptyState label="No log entries yet" />
            ) : (
              <div className="divide-y divide-border">
                {logs.slice(0, 6).map((entry: any) => {
                  const TypeIcon = logIcon(entry.type);
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <TypeIcon size={13} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {entry.customer || "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {entry.notes || "No notes"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground">
                          {fmtDate(entry.date)}
                        </p>
                        <span className="text-[10px] font-medium capitalize text-foreground">
                          {entry.type}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Task breakdown + urgent tasks */}
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader
                icon={ListTodo}
                title="Task Status"
                sub="Follow-up tasks only"
                action="View all"
                onAction={() => navigate("/followup/follow-ups/tasks")}
                iconColor="text-indigo-600"
              />
              <StatusBar data={taskStatusBreakdown} barColor="bg-indigo-500" />
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden flex-1">
              <div className="p-4 border-b border-border">
                <SectionHeader
                  icon={Clock}
                  title="Overdue & Due Soon"
                  sub="Tasks needing attention"
                  action="View all"
                  onAction={() => navigate("/followup/follow-ups/tasks")}
                  iconColor="text-amber-600"
                />
              </div>
              {overdueTasks.length === 0 && dueSoonTasks.length === 0 ? (
                <EmptyState label="No urgent tasks right now" />
              ) : (
                <div className="divide-y divide-border">
                  {[...overdueTasks, ...dueSoonTasks]
                    .slice(0, 5)
                    .map((task) => {
                      const isOverdue = overdueTasks.some(
                        (t) => t.id === task.id,
                      );
                      return (
                        <div
                          key={task.id}
                          onClick={() => navigate("/followup/follow-ups/tasks")}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer"
                        >
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${isOverdue ? "bg-red-500" : "bg-amber-500"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {task.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {task.dueDate
                                ? fmtDate(task.dueDate)
                                : "No due date"}
                            </p>
                          </div>
                          <StatusBadge
                            status={task.status}
                            map={taskStatusColors}
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Quick Actions ── */}
        <GlassSection title="Quick Actions" icon={BarChart3} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              {
                label: "Applications",
                icon: Users,
                path: "/followup/sales/applications",
                color: "text-indigo-600",
                bg: "bg-indigo-500/10",
              },
              {
                label: "Bookings",
                icon: CalendarCheck,
                path: "/followup/sales/bookings",
                color: "text-sky-600",
                bg: "bg-sky-500/10",
              },
              {
                label: "Unit Selection",
                icon: Home,
                path: "/followup/sales/unit-selection",
                color: "text-teal-600",
                bg: "bg-teal-500/10",
              },
              {
                label: "Welcome Calls",
                icon: PhoneCall,
                path: "/followup/sales/welcome-calls",
                color: "text-pink-600",
                bg: "bg-pink-500/10",
              },
              {
                label: "Agreements",
                icon: HandshakeIcon,
                path: "/followup/agreement/agreements",
                color: "text-violet-600",
                bg: "bg-violet-500/10",
              },
              {
                label: "NOC",
                icon: ClipboardCheck,
                path: "/followup/closure/noc",
                color: "text-amber-600",
                bg: "bg-amber-500/10",
              },
              {
                label: "Sales Deed",
                icon: Banknote,
                path: "/followup/closure/sales-deed",
                color: "text-emerald-600",
                bg: "bg-emerald-500/10",
              },
              {
                label: "Handover",
                icon: Home,
                path: "/followup/closure/handover",
                color: "text-cyan-600",
                bg: "bg-cyan-500/10",
              },
              {
                label: "Construction",
                icon: HardHat,
                path: "/followup/construction/updates",
                color: "text-orange-600",
                bg: "bg-orange-500/10",
              },
              {
                label: "Follow-Up Log",
                icon: BookOpen,
                path: "/followup/follow-ups/log",
                color: "text-purple-600",
                bg: "bg-purple-500/10",
              },
              {
                label: "Tasks",
                icon: ListTodo,
                path: "/followup/follow-ups/tasks",
                color: "text-rose-600",
                bg: "bg-rose-500/10",
              },
            ].map(({ label, icon: Icon, path, color, bg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
              >
                <div
                  className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}
                >
                  <Icon size={16} className={color} />
                </div>
                <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}