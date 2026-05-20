import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { useTask } from "@/contexts/TaskContext";
import { getGRNs } from "@/api/grnApi";
import {
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Activity,
  FileText,
  Mail,
  Phone,
  ListTodo,
  Users,
  BarChart3,
  ShoppingCart,
  Wrench,
  BookOpen,
  Percent,
  ClipboardCheck,
  Home,
  Banknote,
  HandshakeIcon,
} from "lucide-react";

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

function dateDiff(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - today.getTime()) / 86_400_000);
}

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

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-indigo-600",
  iconBg = "bg-indigo-500/10",
  trend,
  onClick,
  urgent,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
  urgent?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border bg-card p-5 flex flex-col gap-3 transition-all duration-200 ${
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""
      } ${urgent ? "border-red-400/40" : "border-border hover:border-primary/20"}`}
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
        {trend && (
          <span
            className={`text-[10px] font-medium flex items-center gap-0.5 ${
              trend === "up"
                ? "text-emerald-600"
                : trend === "down"
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {trend === "up" ? (
              <ArrowUpRight size={12} />
            ) : trend === "down" ? (
              <ArrowDownRight size={12} />
            ) : null}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-heading font-bold text-foreground leading-none">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
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
        ? Array.from({ length: 5 }).map((_, i) => (
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

  // ── Sales pipeline queries ──────────────────────────────────────────────────

  const { data: applicantsRes, isLoading: applicantsLoading } = useQuery({
    queryKey: ["dashboard-applicants"],
    queryFn: () =>
      fetchWithAuth("/api/followup-applicants?limit=500").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const { data: agreementsRes, isLoading: agreementsLoading } = useQuery({
    queryKey: ["dashboard-agreements"],
    queryFn: () =>
      fetchWithAuth("/api/followup-agreements?limit=500").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const { data: nocRes, isLoading: nocLoading } = useQuery({
    queryKey: ["dashboard-noc"],
    queryFn: () =>
      fetchWithAuth("/api/followup-noc?limit=500").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const { data: salesDeedRes, isLoading: salesDeedLoading } = useQuery({
    queryKey: ["dashboard-sales-deed"],
    queryFn: () =>
      fetchWithAuth("/api/followup-sales-deed?limit=500").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const { data: handoverRes, isLoading: handoverLoading } = useQuery({
    queryKey: ["dashboard-handover"],
    queryFn: () =>
      fetchWithAuth("/api/followup-handover?limit=500").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // ── Reminder module queries ─────────────────────────────────────────────────

  const { data: posRes } = useQuery({
    queryKey: ["dashboard-pos"],
    queryFn: () =>
      fetchWithAuth("/api/purchase-orders?page=1&limit=200").then((r) =>
        r.json(),
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: wosRes } = useQuery({
    queryKey: ["dashboard-wos"],
    queryFn: () => fetchWithAuth("/api/work-orders").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const { data: grnsRes } = useQuery({
    queryKey: ["dashboard-grns"],
    queryFn: () => getGRNs({ page: 1, limit: 500 }),
    staleTime: 2 * 60 * 1000,
  });

  const {
    data: logData,
    isLoading: logLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["followup-dashboard-log"],
    queryFn: () => fetchWithAuth("/api/followup-log").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // ── Normalise arrays ────────────────────────────────────────────────────────

  const applicants: any[] = useMemo(
    () =>
      Array.isArray(applicantsRes)
        ? applicantsRes
        : (applicantsRes?.data ?? []),
    [applicantsRes],
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
  const pos: any[] = useMemo(
    () => (Array.isArray(posRes) ? posRes : (posRes?.data ?? [])),
    [posRes],
  );
  const wos: any[] = useMemo(
    () => (Array.isArray(wosRes) ? wosRes : (wosRes?.data ?? [])),
    [wosRes],
  );
  const grns: any[] = useMemo(() => grnsRes?.data ?? [], [grnsRes]);
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

  const overduePos = pos.filter((p) => {
    const d = dateDiff(p.ExpectedDeliveryDate || p.PODate);
    return d !== null && d < 0;
  }).length;
  const overdueWos = wos.filter((w) => {
    const d = dateDiff(w.DueDate || w.DocumentDate);
    return d !== null && d < 0;
  }).length;
  const overdueGrns = grns.filter((g) => {
    const d = dateDiff(g.GRNDate || g.CreatedDate);
    return d !== null && d < 0;
  }).length;
  const totalOverdueReminders = overduePos + overdueWos + overdueGrns;

  // ── Pipeline stages ─────────────────────────────────────────────────────────

  const pipelineLoading =
    applicantsLoading ||
    agreementsLoading ||
    nocLoading ||
    salesDeedLoading ||
    handoverLoading;

  const pipelineStages = [
    {
      label: "Applicants",
      count: applicants.length,
      icon: Users,
      iconColor: "text-indigo-600",
      barColor: "bg-indigo-500/70",
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

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <Breadcrumbs items={[{ label: "Follow-Up", path: "/followup" }]} />
            <div className="flex items-center gap-3 mt-1">
              <div className="p-2 rounded-lg bg-indigo-500/10">
                <Activity size={20} className="text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  Follow-Up Dashboard
                </h1>
                <p className="text-xs text-muted-foreground">
                  Sales pipeline, reminders and activity across all projects
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* ── KPI Row 1 — Sales Pipeline ── */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Sales Pipeline
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KPICard
              label="Total Applicants"
              value={fmtNum(applicants.length)}
              sub={`${applicants.filter((a) => a.Status === "Active" || a.Status === "New").length} active`}
              icon={Users}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-500/10"
              onClick={() => navigate("/followup/sales/applicants")}
            />
            <KPICard
              label="Active Agreements"
              value={fmtNum(activeAgreements)}
              sub={`${agreements.length} total`}
              icon={HandshakeIcon}
              iconColor="text-violet-600"
              iconBg="bg-violet-500/10"
              trend={activeAgreements > 0 ? "up" : "neutral"}
              onClick={() => navigate("/followup/agreement/agreements")}
            />
            <KPICard
              label="Pending NOCs"
              value={fmtNum(pendingNOCs)}
              sub={`${nocs.length} total NOCs`}
              icon={ClipboardCheck}
              iconColor="text-amber-600"
              iconBg="bg-amber-500/10"
              trend={pendingNOCs > 0 ? "down" : "neutral"}
              urgent={pendingNOCs > 0}
              onClick={() => navigate("/followup/closure/noc")}
            />
            <KPICard
              label="Sales Deeds"
              value={fmtNum(salesDeeds.length)}
              sub={`${salesDeeds.filter((s) => s.Status === "Registered").length} registered`}
              icon={Banknote}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-500/10"
              onClick={() => navigate("/followup/closure/sales-deed")}
            />
            <KPICard
              label="Upcoming Handovers"
              value={fmtNum(scheduledHandovers)}
              sub={`${handovers.length} total handovers`}
              icon={Home}
              iconColor="text-cyan-600"
              iconBg="bg-cyan-500/10"
              trend={scheduledHandovers > 0 ? "up" : "neutral"}
              onClick={() => navigate("/followup/closure/handover")}
            />
          </div>
        </div>

        {/* ── KPI Row 2 — Reminders & Tasks ── */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Reminders & Tasks
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard
              label="Overdue Tasks"
              value={fmtNum(overdueTasks.length)}
              sub={`${fmtNum(pendingTasks.length)} still pending`}
              icon={AlertCircle}
              iconColor="text-red-600"
              iconBg="bg-red-500/10"
              trend={overdueTasks.length > 0 ? "down" : "neutral"}
              urgent={overdueTasks.length > 0}
              onClick={() => navigate("/followup/follow-ups/tasks")}
            />
            <KPICard
              label="PO Overdue"
              value={fmtNum(overduePos)}
              sub={`${pos.length} total POs`}
              icon={ShoppingCart}
              iconColor="text-orange-600"
              iconBg="bg-orange-500/10"
              trend={overduePos > 0 ? "down" : "neutral"}
              urgent={overduePos > 0}
              onClick={() => navigate("/followup/follow-ups/po-reminders")}
            />
            <KPICard
              label="WO Overdue"
              value={fmtNum(overdueWos)}
              sub={`${wos.length} total WOs`}
              icon={Wrench}
              iconColor="text-amber-600"
              iconBg="bg-amber-500/10"
              trend={overdueWos > 0 ? "down" : "neutral"}
              urgent={overdueWos > 0}
              onClick={() => navigate("/followup/follow-ups/wo-reminders")}
            />
            <KPICard
              label="GRN Overdue"
              value={fmtNum(overdueGrns)}
              sub={`${grns.length} total GRNs`}
              icon={ClipboardCheck}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-500/10"
              trend={overdueGrns > 0 ? "down" : "neutral"}
              urgent={overdueGrns > 0}
              onClick={() => navigate("/followup/follow-ups/grn-reminders")}
            />
            <KPICard
              label="Completed Tasks"
              value={fmtNum(completedTasks.length)}
              sub={`${fmtNum(followupTasks.length)} total`}
              icon={CheckCircle2}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-500/10"
              trend="up"
              onClick={() => navigate("/followup/follow-ups/tasks")}
            />
            <KPICard
              label="Total Overdue"
              value={fmtNum(totalOverdueReminders)}
              sub="PO + WO + GRN"
              icon={Bell}
              iconColor="text-red-600"
              iconBg="bg-red-500/10"
              trend={totalOverdueReminders > 0 ? "down" : "neutral"}
              urgent={totalOverdueReminders > 0}
            />
          </div>
        </div>

        {/* ── Pipeline Funnel + Status Breakdowns ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sales pipeline funnel */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={BarChart3}
                title="Sales Pipeline"
                sub="Applicant → Handover"
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

          {/* Agreement status */}
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

          {/* NOC status */}
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

        {/* ── Recent Applicants + Recent Agreements ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Applicants */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Users}
                title="Recent Applicants"
                sub="Latest entries"
                action="View all"
                onAction={() => navigate("/followup/sales/applicants")}
                iconColor="text-indigo-600"
              />
            </div>
            {applicantsLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : applicants.length === 0 ? (
              <EmptyState label="No applicants yet" />
            ) : (
              <div className="divide-y divide-border">
                {applicants.slice(0, 6).map((a: any) => (
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

          {/* Recent Agreements */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={HandshakeIcon}
                title="Recent Agreements"
                sub="Latest entries"
                action="View all"
                onAction={() => navigate("/followup/agreement/agreements")}
                iconColor="text-violet-600"
              />
            </div>
            {agreementsLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : agreements.length === 0 ? (
              <EmptyState label="No agreements yet" />
            ) : (
              <div className="divide-y divide-border">
                {agreements.slice(0, 6).map((ag: any) => (
                  <div
                    key={ag.Id ?? ag.AgreementNo}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                      <HandshakeIcon size={12} className="text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {ag.ApplicantName || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {ag.ProjectName || ag.UnitNo || "—"}
                        {ag.AgreementValue
                          ? ` · ₹${Number(ag.AgreementValue).toLocaleString("en-IN")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {ag.AgreementNo || `#${ag.Id}`}
                      </span>
                      {ag.Status && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                            ag.Status === "Signed"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
                              : ag.Status === "Cancelled"
                                ? "bg-red-500/10 text-red-600 border-red-400/20"
                                : "bg-violet-500/10 text-violet-600 border-violet-400/20"
                          }`}
                        >
                          {ag.Status}
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
        <div className="rounded-xl border border-border bg-card p-5">
          <SectionHeader
            icon={BarChart3}
            title="Quick Actions"
            iconColor="text-indigo-600"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-3">
            {[
              {
                label: "PO Reminders",
                icon: ShoppingCart,
                path: "/followup/follow-ups/po-reminders",
                color: "text-orange-600",
                bg: "bg-orange-500/10",
              },
              {
                label: "WO Reminders",
                icon: Wrench,
                path: "/followup/follow-ups/wo-reminders",
                color: "text-amber-600",
                bg: "bg-amber-500/10",
              },
              {
                label: "CHQ Reminders",
                icon: BookOpen,
                path: "/followup/follow-ups/chq-reminders",
                color: "text-cyan-600",
                bg: "bg-cyan-500/10",
              },
              {
                label: "GRN Reminders",
                icon: ClipboardCheck,
                path: "/followup/follow-ups/grn-reminders",
                color: "text-emerald-600",
                bg: "bg-emerald-500/10",
              },
              {
                label: "TDS Reminders",
                icon: Percent,
                path: "/followup/follow-ups/tds-reminders",
                color: "text-violet-600",
                bg: "bg-violet-500/10",
              },
              {
                label: "Applicants",
                icon: Users,
                path: "/followup/sales/applicants",
                color: "text-indigo-600",
                bg: "bg-indigo-500/10",
              },
              {
                label: "Agreements",
                icon: HandshakeIcon,
                path: "/followup/agreement/agreements",
                color: "text-violet-600",
                bg: "bg-violet-500/10",
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
        </div>
      </div>
    </>
  );
}
