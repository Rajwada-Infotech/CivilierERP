import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  PackageCheck,
  RefreshCw,
  Timer,
  TrendingUp,
  Zap,
  Building2,
  FileText,
  IndianRupee,
} from "lucide-react";

import { getGRNs } from "@/api/grnApi";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GRNRecord {
  GRNID: number;
  GRNNo: string;
  DocNo: string | null;
  GRNDate: string;
  CreatedDate: string;
  Status: string;
  TotalAmount: number | null;
  SupplierName: string | null;
  PONumber: string | null;
  POType: string | null;
  SourceWODocNo: string | null;
  Remarks: string | null;
}

type Urgency = "overdue" | "today" | "soon" | "upcoming";

interface GRNWithUrgency extends GRNRecord {
  urgency: Urgency;
  daysRelative: number;
}

// ─── Helpers — same logic as the reminder bell ────────────────────────────────

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

// ─── Fetch — mirrors bell field resolution for GRN (uses GRNDate) ─────────────

async function fetchGRNs(): Promise<GRNWithUrgency[]> {
  const response = await getGRNs({ page: 1, limit: 500 });
  const list: GRNRecord[] = response.data ?? [];

  return list
    .map((grn) => {
      const dateKey = grn.GRNDate || grn.CreatedDate;
      return {
        ...grn,
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
    pill: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
    cardBorder: "border-amber-400/40",
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
    icon: Zap,
  },
  soon: {
    label: "Due Soon",
    pill: "bg-emerald-500/15 text-emerald-600 border border-emerald-400/30",
    cardBorder: "border-emerald-400/30",
    badge: "bg-emerald-500 text-white",
    dot: "bg-emerald-400",
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

const GRN_STATUS_PILL: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Completed: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Received: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border border-amber-400/20",
  Draft: "bg-muted text-muted-foreground border border-border",
  Rejected: "bg-red-500/10 text-red-500 border border-red-400/20",
  Cancelled: "bg-red-500/10 text-red-500 border border-red-400/20",
};

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KPIStrip({
  grns,
  activeFilter,
  onFilter,
}: {
  grns: GRNWithUrgency[];
  activeFilter: Urgency | "all";
  onFilter: (f: Urgency | "all") => void;
}) {
  const counts = useMemo(
    () => ({
      all: grns.length,
      overdue: grns.filter((g) => g.urgency === "overdue").length,
      today: grns.filter((g) => g.urgency === "today").length,
      soon: grns.filter((g) => g.urgency === "soon").length,
      upcoming: grns.filter((g) => g.urgency === "upcoming").length,
    }),
    [grns],
  );

  const totalValue = grns.reduce((s, g) => s + (g.TotalAmount ?? 0), 0);

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
      label: "All GRNs",
      value: counts.all,
      sub: fmtCurrency(totalValue),
      icon: PackageCheck,
      accent: "text-emerald-600",
      bg: "bg-emerald-500/10",
      ring: "ring-2 ring-emerald-400/60 bg-emerald-500/10",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: counts.overdue,
      sub: "Past GRN date",
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
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
      ring: "ring-2 ring-amber-400/60 bg-amber-500/10",
    },
    {
      key: "soon",
      label: "Due Soon",
      value: counts.soon,
      sub: "Within 7 days",
      icon: Timer,
      accent: "text-emerald-600",
      bg: "bg-emerald-500/10",
      ring: "ring-2 ring-emerald-400/60 bg-emerald-500/10",
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

// ─── Breakdown Bar ────────────────────────────────────────────────────────────

function BreakdownBar({ grns }: { grns: GRNWithUrgency[] }) {
  const total = grns.length || 1;
  const counts = {
    overdue: grns.filter((g) => g.urgency === "overdue").length,
    today: grns.filter((g) => g.urgency === "today").length,
    soon: grns.filter((g) => g.urgency === "soon").length,
    upcoming: grns.filter((g) => g.urgency === "upcoming").length,
  };

  const segments: { key: Urgency; color: string; label: string }[] = [
    { key: "overdue", color: "bg-red-500", label: "Overdue" },
    { key: "today", color: "bg-amber-500", label: "Today" },
    { key: "soon", color: "bg-emerald-500", label: "Soon" },
    { key: "upcoming", color: "bg-muted-foreground/30", label: "Upcoming" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-emerald-600" />
        <span className="text-xs font-semibold text-foreground">
          Urgency Breakdown
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {total} total GRNs
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

// ─── GRN Card ─────────────────────────────────────────────────────────────────

function GRNCard({
  grn,
  onNavigate,
}: {
  grn: GRNWithUrgency;
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CFG[grn.urgency];
  const statusPill =
    GRN_STATUS_PILL[grn.Status] ??
    "bg-muted text-muted-foreground border border-border";

  return (
    <div
      onClick={() => onNavigate(grn.GRNID)}
      className={`group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${cfg.cardBorder}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-emerald-500/10 shrink-0">
            <PackageCheck size={13} className="text-emerald-600" />
          </div>
          <span className="font-mono text-[11px] font-bold text-primary truncate">
            {grn.DocNo || grn.GRNNo || `GRN-${grn.GRNID}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${cfg.pill}`}
          >
            {formatRelative(grn.daysRelative)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(grn.GRNID);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {/* Supplier */}
      <p className="text-[12px] font-semibold text-foreground leading-snug truncate mb-0.5">
        {grn.SupplierName || "—"}
      </p>

      {/* PO reference */}
      {(grn.PONumber || grn.SourceWODocNo) && (
        <div className="flex items-center gap-1 mb-3">
          <FileText size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground truncate">
            {grn.SourceWODocNo
              ? `WO: ${grn.SourceWODocNo}`
              : `PO: ${grn.PONumber}`}
          </p>
        </div>
      )}

      {/* Amount */}
      {grn.TotalAmount != null && grn.TotalAmount > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <IndianRupee size={12} className="text-emerald-600 shrink-0" />
          <span className="text-base font-bold text-emerald-600 font-heading">
            {fmtCurrency(grn.TotalAmount)}
          </span>
        </div>
      )}

      {/* Remarks */}
      {grn.Remarks && (
        <div className="flex items-center gap-1 mb-3">
          <Building2 size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground truncate">
            {grn.Remarks}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar size={10} />
          <span>{fmtDate(grn.GRNDate)}</span>
        </div>
        <span
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${statusPill}`}
        >
          {grn.Status || "Draft"}
        </span>
      </div>
    </div>
  );
}

// ─── Urgency Lane ─────────────────────────────────────────────────────────────

function UrgencyLane({
  urgency,
  grns,
  onNavigate,
}: {
  urgency: Urgency;
  grns: GRNWithUrgency[];
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CFG[urgency];
  const LaneIcon = cfg.icon;
  if (!grns.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
        <span className="text-xs font-semibold text-foreground">
          {cfg.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          {grns.length} GRN{grns.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-border/50" />
        <LaneIcon size={12} className="text-muted-foreground" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {grns.map((grn) => (
          <GRNCard key={grn.GRNID} grn={grn} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Urgency | "all" }) {
  const msgs: Record<Urgency | "all", { title: string; sub: string }> = {
    all: {
      title: "No GRNs found",
      sub: "Goods receipt notes will appear here once created.",
    },
    overdue: { title: "No overdue GRNs", sub: "Everything is on track." },
    today: { title: "Nothing due today", sub: "You're clear for today." },
    soon: {
      title: "Nothing due in the next 7 days",
      sub: "Plenty of time ahead.",
    },
    upcoming: {
      title: "No upcoming GRNs",
      sub: "Create a GRN to track it here.",
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

export default function GRNReminders() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<Urgency | "all">("all");

  const {
    data: allGRNs = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["grn-reminders"],
    queryFn: fetchGRNs,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? allGRNs
        : allGRNs.filter((g) => g.urgency === activeFilter),
    [allGRNs, activeFilter],
  );

  const lanes: Urgency[] = ["overdue", "today", "soon", "upcoming"];

  function goToGRN(id: number) {
    navigate(`/material/grn?highlight=${id}`);
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
                  label: "GRN Reminders",
                  path: "/followup/follow-ups/grn-reminders",
                },
              ]}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className="p-2.5 rounded-xl bg-emerald-500/10">
                <PackageCheck size={20} className="text-emerald-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  GRN Reminders
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live goods receipt follow-up tracker — same source as the
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
              onClick={() => navigate("/material/grn")}
              className="flex items-center gap-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border border-emerald-400/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowUpRight size={13} />
              Open GRN Module
            </button>
          </div>
        </div>

        {/* ── KPI strip + breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <KPIStrip
            grns={allGRNs}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
          <BreakdownBar grns={allGRNs} />
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
              const data = filtered.filter((g) => g.urgency === u);
              if (!data.length) return null;
              return (
                <UrgencyLane
                  key={u}
                  urgency={u}
                  grns={data}
                  onNavigate={goToGRN}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
