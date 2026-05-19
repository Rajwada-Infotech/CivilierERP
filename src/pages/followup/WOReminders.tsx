import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  HardHat,
  RefreshCw,
  Timer,
  TrendingUp,
  Zap,
  Building2,
  Wrench,
  IndianRupee,
  Activity,
} from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WorkOrder {
  Id: number;
  DocumentNumber: string;
  DocumentDate: string;
  TotalAmount: number;
  Status: string;
  CreatedAt: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string;
  SupplierName: string;
  ActivityCount: number;
  Remarks?: string;
  BoqDocNo?: string | null;
  DueDate?: string | null;
}

type Urgency = "overdue" | "today" | "soon" | "upcoming";

interface WOWithUrgency extends WorkOrder {
  urgency: Urgency;
  daysRelative: number;
}

// ─── Helpers — exact same logic as useReminders / ReminderBell ────────────────
function classifyUrgency(dueDateStr: string): Urgency {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "soon";
  return "upcoming";
}

function getDaysRelative(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - today.getTime()) / 86_400_000);
}

function formatRelative(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtCurrency(n: number | undefined | null): string {
  if (n == null || n === 0) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Fetch — same endpoint & field resolution as the bell ────────────────────
// Bell uses: obj.ExpectedDeliveryDate || obj.PODate || obj.GRNDate || obj.ChequeDate || obj.DueDate
// For WOs that resolves to obj.DueDate (only field that exists on WO)
// We also fall back to DocumentDate if DueDate is absent.
async function fetchWOs(): Promise<WOWithUrgency[]> {
  const res = await fetchWithAuth("/api/work-orders");
  if (!res.ok) throw new Error("Failed to load work orders");
  const raw = await res.json();
  const list: WorkOrder[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.recordset)
        ? raw.recordset
        : [];

  return list
    .map((wo) => {
      // Mirror exact bell field-resolution order for WO
      const dateKey = wo.DueDate || wo.DocumentDate || wo.CreatedAt;
      return {
        ...wo,
        urgency: dateKey ? classifyUrgency(dateKey) : "upcoming",
        daysRelative: dateKey ? getDaysRelative(dateKey) : 999,
      };
    })
    .sort((a, b) => a.daysRelative - b.daysRelative);
}

// ─── Urgency config ───────────────────────────────────────────────────────────
const URGENCY_CFG: Record<
  Urgency,
  {
    label: string;
    pill: string;
    cardBorder: string;
    badge: string;
    dot: string;
    icon: React.ElementType;
  }
> = {
  overdue: {
    label: "Overdue",
    pill: "bg-red-500/15 text-red-600 border border-red-400/30",
    cardBorder: "border-red-400/40",
    badge: "bg-red-500 text-white",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  today: {
    label: "Due Today",
    pill: "bg-orange-500/15 text-orange-600 border border-orange-400/30",
    cardBorder: "border-orange-400/40",
    badge: "bg-orange-500 text-white",
    dot: "bg-orange-500",
    icon: Zap,
  },
  soon: {
    label: "Due Soon",
    pill: "bg-sky-500/15 text-sky-600 border border-sky-400/30",
    cardBorder: "border-sky-400/30",
    badge: "bg-sky-500 text-white",
    dot: "bg-sky-400",
    icon: Timer,
  },
  upcoming: {
    label: "Upcoming",
    pill: "bg-muted text-muted-foreground border border-border",
    cardBorder: "border-border",
    badge: "bg-muted-foreground text-white",
    dot: "bg-muted-foreground/50",
    icon: Clock,
  },
};

const WO_STATUS_PILL: Record<string, string> = {
  Confirmed: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Approved: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Completed: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Submitted: "bg-blue-500/10 text-blue-600 border border-blue-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border border-amber-400/20",
  Draft: "bg-muted text-muted-foreground border border-border",
  Rejected: "bg-red-500/10 text-red-500 border border-red-400/20",
  Cancelled: "bg-red-500/10 text-red-500 border border-red-400/20",
};

// ─── KPI Strip ────────────────────────────────────────────────────────────────
function KPIStrip({
  wos,
  activeFilter,
  onFilter,
}: {
  wos: WOWithUrgency[];
  activeFilter: Urgency | "all";
  onFilter: (f: Urgency | "all") => void;
}) {
  const counts = useMemo(
    () => ({
      all: wos.length,
      overdue: wos.filter((w) => w.urgency === "overdue").length,
      today: wos.filter((w) => w.urgency === "today").length,
      soon: wos.filter((w) => w.urgency === "soon").length,
      upcoming: wos.filter((w) => w.urgency === "upcoming").length,
    }),
    [wos],
  );

  const totalValue = wos.reduce((s, w) => s + (w.TotalAmount ?? 0), 0);

  const tiles: {
    key: Urgency | "all";
    label: string;
    value: number;
    sub: string;
    icon: React.ElementType;
    accent: string;
    bg: string;
    ring: string;
  }[] = [
    {
      key: "all",
      label: "All WOs",
      value: counts.all,
      sub: fmtCurrency(totalValue),
      icon: HardHat,
      accent: "text-orange-600",
      bg: "bg-orange-500/10",
      ring: "ring-2 ring-orange-400/60 bg-orange-500/10",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: counts.overdue,
      sub: "Past due date",
      icon: AlertTriangle,
      accent: "text-red-600",
      bg: "bg-red-500/10",
      ring: "ring-2 ring-red-400/60 bg-red-500/10",
    },
    {
      key: "today",
      label: "Due Today",
      value: counts.today,
      sub: "Needs action now",
      icon: Zap,
      accent: "text-orange-600",
      bg: "bg-orange-500/10",
      ring: "ring-2 ring-orange-400/60 bg-orange-500/10",
    },
    {
      key: "soon",
      label: "Due Soon",
      value: counts.soon,
      sub: "Within 7 days",
      icon: Timer,
      accent: "text-sky-600",
      bg: "bg-sky-500/10",
      ring: "ring-2 ring-sky-400/60 bg-sky-500/10",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      value: counts.upcoming,
      sub: "More than 7 days",
      icon: Calendar,
      accent: "text-muted-foreground",
      bg: "bg-muted",
      ring: "ring-2 ring-border bg-muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {tiles.map((t) => {
        const Icon = t.icon;
        const isActive = activeFilter === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onFilter(t.key)}
            className={`rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
              isActive ? t.ring : "hover:border-primary/20"
            }`}
          >
            <div className={`p-2 rounded-lg ${t.bg} w-fit mb-3`}>
              <Icon size={16} className={t.accent} />
            </div>
            <p className="text-2xl font-bold font-heading text-foreground leading-none">
              {t.value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{t.label}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {t.sub}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Breakdown bar ────────────────────────────────────────────────────────────
function BreakdownBar({ wos }: { wos: WOWithUrgency[] }) {
  const total = wos.length || 1;
  const counts = {
    overdue: wos.filter((w) => w.urgency === "overdue").length,
    today: wos.filter((w) => w.urgency === "today").length,
    soon: wos.filter((w) => w.urgency === "soon").length,
    upcoming: wos.filter((w) => w.urgency === "upcoming").length,
  };

  const segments: { key: Urgency; color: string; label: string }[] = [
    { key: "overdue", color: "bg-red-500", label: "Overdue" },
    { key: "today", color: "bg-orange-500", label: "Today" },
    { key: "soon", color: "bg-sky-500", label: "Soon" },
    { key: "upcoming", color: "bg-muted-foreground/30", label: "Upcoming" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-orange-600" />
        <span className="text-xs font-semibold text-foreground">
          Urgency Breakdown
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {total} total WOs
        </span>
      </div>

      <div className="h-3 rounded-full overflow-hidden flex gap-0.5 mb-4">
        {segments.map(
          (s) =>
            counts[s.key] > 0 && (
              <div
                key={s.key}
                className={`${s.color} h-full rounded-full transition-all`}
                style={{ width: `${(counts[s.key] / total) * 100}%` }}
              />
            ),
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {segments.map((s) => {
          const pct = Math.round((counts[s.key] / total) * 100);
          return (
            <div key={s.key} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-[10px] text-muted-foreground">
                  {s.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-foreground">
                  {counts[s.key]}
                </span>
                <span className="text-[9px] text-muted-foreground/60">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WO Card ──────────────────────────────────────────────────────────────────
function WOCard({
  wo,
  onNavigate,
}: {
  wo: WOWithUrgency;
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CFG[wo.urgency];
  const statusPill =
    WO_STATUS_PILL[wo.Status] ??
    "bg-muted text-muted-foreground border border-border";
  const dateKey = wo.DueDate || wo.DocumentDate;

  return (
    <div
      onClick={() => onNavigate(wo.Id)}
      className={`group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${cfg.cardBorder}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-orange-500/10 shrink-0">
            <Wrench size={13} className="text-orange-600" />
          </div>
          <span className="font-mono text-[11px] font-bold text-primary truncate">
            {wo.DocumentNumber || `WO-${wo.Id}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${cfg.pill}`}
          >
            {formatRelative(wo.daysRelative)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(wo.Id);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {/* Contractor / Company */}
      <p className="text-[12px] font-semibold text-foreground leading-snug truncate mb-0.5">
        {wo.ContractorName || wo.SupplierName || "—"}
      </p>

      {(wo.ProjectName || wo.CompanyName) && (
        <div className="flex items-center gap-1 mb-3">
          <Building2 size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground truncate">
            {wo.ProjectName || wo.CompanyName}
          </p>
        </div>
      )}

      {/* Amount */}
      {wo.TotalAmount > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <IndianRupee size={12} className="text-emerald-600 shrink-0" />
          <span className="text-base font-bold text-emerald-600 font-heading">
            {fmtCurrency(wo.TotalAmount)}
          </span>
        </div>
      )}

      {/* Activity count badge */}
      {wo.ActivityCount > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <Activity size={9} className="text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            {wo.ActivityCount} activit{wo.ActivityCount !== 1 ? "ies" : "y"}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar size={10} />
          <span>{fmtDate(dateKey)}</span>
        </div>
        <span
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${statusPill}`}
        >
          {wo.Status || "Draft"}
        </span>
      </div>
    </div>
  );
}

// ─── Urgency Lane ─────────────────────────────────────────────────────────────
function UrgencyLane({
  urgency,
  wos,
  onNavigate,
}: {
  urgency: Urgency;
  wos: WOWithUrgency[];
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CFG[urgency];
  const LaneIcon = cfg.icon;
  if (!wos.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
        <span className="text-xs font-semibold text-foreground">
          {cfg.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          {wos.length} WO{wos.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-border/50" />
        <LaneIcon size={12} className="text-muted-foreground" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {wos.map((wo) => (
          <WOCard key={wo.Id} wo={wo} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ filter }: { filter: Urgency | "all" }) {
  const msgs: Record<Urgency | "all", { title: string; sub: string }> = {
    all: {
      title: "No work orders found",
      sub: "Work orders will appear here once created.",
    },
    overdue: { title: "No overdue WOs", sub: "Everything is on track." },
    today: { title: "Nothing due today", sub: "You're clear for today." },
    soon: {
      title: "Nothing due in the next 7 days",
      sub: "Plenty of time ahead.",
    },
    upcoming: {
      title: "No upcoming WOs",
      sub: "Create a work order to track it here.",
    },
  };
  const m = msgs[filter];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-2xl bg-muted mb-4">
        <CheckCircle2 size={28} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground">{m.title}</p>
      <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function WOReminders() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<Urgency | "all">("all");

  const {
    data: allWOs = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["wo-reminders-bell-source"],
    queryFn: fetchWOs,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? allWOs
        : allWOs.filter((w) => w.urgency === activeFilter),
    [allWOs, activeFilter],
  );

  const lanes: Urgency[] = ["overdue", "today", "soon", "upcoming"];

  function goToWO(id: number) {
    navigate(`/engineering/work-order?highlight=${id}`);
  }

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Breadcrumbs
              items={[
                { label: "Follow-Up", path: "/followup" },
                {
                  label: "WO Reminders",
                  path: "/followup/follow-ups/wo-reminders",
                },
              ]}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className="p-2.5 rounded-xl bg-orange-500/10">
                <HardHat size={20} className="text-orange-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  WO Reminders
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live work order follow-up tracker — same source as the
                  reminder bell
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <button
              onClick={() => navigate("/engineering/work-order")}
              className="flex items-center gap-1.5 text-xs font-medium bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 border border-orange-400/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowUpRight size={13} />
              Open WO Module
            </button>
          </div>
        </div>

        {/* ── KPI strip + breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <KPIStrip
            wos={allWOs}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
          <BreakdownBar wos={allWOs} />
        </div>

        {/* ── Active filter label ── */}
        {activeFilter !== "all" && (
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-3 py-1 rounded-full ${URGENCY_CFG[activeFilter].pill}`}
            >
              Showing: {URGENCY_CFG[activeFilter].label}
            </span>
            <button
              onClick={() => setActiveFilter("all")}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* ── Lanes ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-xl border border-border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={activeFilter} />
        ) : (
          <div className="space-y-8">
            {lanes.map((u) => {
              const data = filtered.filter((w) => w.urgency === u);
              if (!data.length) return null;
              return (
                <UrgencyLane
                  key={u}
                  urgency={u}
                  wos={data}
                  onNavigate={goToWO}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
