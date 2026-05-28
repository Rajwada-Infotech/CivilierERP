import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Percent,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  TrendingUp,
} from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbTds {
  TDSId: number;
  Nature: string | null;
  Name: string | null;
  Percentage: number | null;
  Status: boolean;
  CreatedAt?: string | null;
  UpdatedAt?: string | null;
}

// Urgency semantics for TDS rates (no date-based urgency — compliance readiness):
//   "inactive"  → Status = false — deactivated rate, may need review
//   "high"      → Percentage >= 10 — high-rate entries needing attention
//   "standard"  → Percentage >= 2 && < 10
//   "low"       → Percentage < 2 — minimal-impact rates
type Urgency = "inactive" | "high" | "standard" | "low";

interface TdsWithUrgency extends DbTds {
  urgency: Urgency;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyTdsUrgency(tds: DbTds): Urgency {
  if (!tds.Status) return "inactive";
  const pct = tds.Percentage ?? 0;
  if (pct >= 10) return "high";
  if (pct >= 2) return "standard";
  return "low";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtPct(p: number | null | undefined): string {
  if (p == null) return "—";
  return `${p.toFixed(2)}%`;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchTdsRates(): Promise<TdsWithUrgency[]> {
  const res = await fetchWithAuth("/api/tds-master");
  const list: DbTds[] = await res.json();

  return list
    .map((tds) => ({
      ...tds,
      urgency: classifyTdsUrgency(tds),
    }))
    .sort((a, b) => {
      const order: Record<Urgency, number> = {
        inactive: 0,
        high: 1,
        standard: 2,
        low: 3,
      };
      return order[a.urgency] - order[b.urgency];
    });
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
  inactive: {
    label: "Inactive",
    pill: "bg-red-500/15 text-red-600 border border-red-400/30",
    cardBorder: "border-red-400/40",
    badge: "bg-red-500 text-white",
    dot: "bg-red-500",
    icon: ShieldOff,
  },
  high: {
    label: "High Rate",
    pill: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
    cardBorder: "border-amber-400/40",
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
    icon: ShieldAlert,
  },
  standard: {
    label: "Standard",
    pill: "bg-violet-500/15 text-violet-600 border border-violet-400/30",
    cardBorder: "border-violet-400/30",
    badge: "bg-violet-500 text-white",
    dot: "bg-violet-400",
    icon: ShieldCheck,
  },
  low: {
    label: "Low Rate",
    pill: "bg-muted text-muted-foreground border border-border",
    cardBorder: "border-border",
    badge: "bg-muted-foreground text-white",
    dot: "bg-muted-foreground/50",
    icon: Clock,
  },
};

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KPIStrip({
  rates,
  activeFilter,
  onFilter,
}: {
  rates: TdsWithUrgency[];
  activeFilter: Urgency | "all";
  onFilter: (f: Urgency | "all") => void;
}) {
  const counts = useMemo(
    () => ({
      all: rates.length,
      inactive: rates.filter((r) => r.urgency === "inactive").length,
      high: rates.filter((r) => r.urgency === "high").length,
      standard: rates.filter((r) => r.urgency === "standard").length,
      low: rates.filter((r) => r.urgency === "low").length,
    }),
    [rates],
  );

  const activeRates = rates.filter((r) => r.Status);
  const avgPct =
    activeRates.length > 0
      ? activeRates.reduce((s, r) => s + (r.Percentage ?? 0), 0) /
        activeRates.length
      : 0;

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
      label: "All Rates",
      value: counts.all,
      sub: `Avg ${avgPct.toFixed(1)}% (active)`,
      icon: FileText,
      accent: "text-violet-600",
      bg: "bg-violet-500/10",
      ring: "ring-2 ring-violet-400/60 bg-violet-500/10",
    },
    {
      key: "inactive",
      label: "Inactive",
      value: counts.inactive,
      sub: "Needs review",
      icon: ShieldOff,
      accent: "text-red-600",
      bg: "bg-red-500/10",
      ring: "ring-2 ring-red-400/60 bg-red-500/10",
    },
    {
      key: "high",
      label: "High Rate",
      value: counts.high,
      sub: "≥10% — needs attention",
      icon: ShieldAlert,
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
      ring: "ring-2 ring-amber-400/60 bg-amber-500/10",
    },
    {
      key: "standard",
      label: "Standard",
      value: counts.standard,
      sub: "2–10% range",
      icon: ShieldCheck,
      accent: "text-violet-600",
      bg: "bg-violet-500/10",
      ring: "ring-2 ring-violet-400/60 bg-violet-500/10",
    },
    {
      key: "low",
      label: "Low Rate",
      value: counts.low,
      sub: "<2% — minimal impact",
      icon: BarChart2,
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

function BreakdownBar({ rates }: { rates: TdsWithUrgency[] }) {
  const total = rates.length || 1;
  const counts = {
    inactive: rates.filter((r) => r.urgency === "inactive").length,
    high: rates.filter((r) => r.urgency === "high").length,
    standard: rates.filter((r) => r.urgency === "standard").length,
    low: rates.filter((r) => r.urgency === "low").length,
  };

  const segments: { key: Urgency; color: string; label: string }[] = [
    { key: "inactive", color: "bg-red-500", label: "Inactive" },
    { key: "high", color: "bg-amber-500", label: "High" },
    { key: "standard", color: "bg-violet-500", label: "Standard" },
    { key: "low", color: "bg-muted-foreground/30", label: "Low" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-violet-600" />
        <span className="text-xs font-semibold text-foreground">
          Rate Breakdown
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {total} total
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

// ─── TDS Card ─────────────────────────────────────────────────────────────────

function TDSCard({
  rate,
  onNavigate,
}: {
  rate: TdsWithUrgency;
  onNavigate: () => void;
}) {
  const cfg = URGENCY_CFG[rate.urgency];
  const ref = rate.UpdatedAt || rate.CreatedAt;

  return (
    <div
      onClick={onNavigate}
      className={`group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${cfg.cardBorder}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-violet-500/10 shrink-0">
            <Percent size={13} className="text-violet-600" />
          </div>
          <span className="font-mono text-[11px] font-bold text-primary truncate">
            TDS-{rate.TDSId}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${cfg.pill}`}
          >
            {cfg.label}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {/* Name */}
      <p className="text-[12px] font-semibold text-foreground leading-snug truncate mb-0.5">
        {rate.Name || "—"}
      </p>

      {/* Nature */}
      {rate.Nature && (
        <div className="flex items-center gap-1 mb-3">
          <FileText size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground truncate">
            {rate.Nature}
          </p>
        </div>
      )}

      {/* Percentage — large, prominent */}
      <div className="flex items-center justify-center mb-3 bg-muted/50 rounded-lg px-3 py-3">
        <span
          className={`font-mono text-3xl font-black leading-none ${
            rate.urgency === "inactive"
              ? "text-muted-foreground/40"
              : rate.urgency === "high"
                ? "text-amber-600"
                : rate.urgency === "standard"
                  ? "text-violet-600"
                  : "text-muted-foreground"
          }`}
        >
          {fmtPct(rate.Percentage)}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar size={10} />
          <span>{fmtDate(ref)}</span>
        </div>
        <span
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            rate.Status
              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20"
              : "bg-red-500/10 text-red-600 border border-red-400/20"
          }`}
        >
          {rate.Status ? "Active" : "Inactive"}
        </span>
      </div>
    </div>
  );
}

// ─── Urgency Lane ─────────────────────────────────────────────────────────────

function UrgencyLane({
  urgency,
  rates,
  onNavigate,
}: {
  urgency: Urgency;
  rates: TdsWithUrgency[];
  onNavigate: () => void;
}) {
  const cfg = URGENCY_CFG[urgency];
  const LaneIcon = cfg.icon;
  if (!rates.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
        <span className="text-xs font-semibold text-foreground">
          {cfg.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          {rates.length} rate{rates.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-border/50" />
        <LaneIcon size={12} className="text-muted-foreground" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {rates.map((rate) => (
          <TDSCard key={rate.TDSId} rate={rate} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Urgency | "all" }) {
  const msgs: Record<Urgency | "all", { title: string; sub: string }> = {
    all: {
      title: "No TDS rates found",
      sub: "Add TDS rates in the TDS Master to track them here.",
    },
    inactive: { title: "No inactive rates", sub: "All rates are active." },
    high: {
      title: "No high rates",
      sub: "No TDS rates at 10% or above.",
    },
    standard: {
      title: "No standard rates",
      sub: "No TDS rates in the 2–10% range.",
    },
    low: {
      title: "No low rates",
      sub: "No TDS rates below 2%.",
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

export default function TDSReminders() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<Urgency | "all">("all");

  const {
    data: allRates = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["tds-reminders"],
    queryFn: fetchTdsRates,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? allRates
        : allRates.filter((r) => r.urgency === activeFilter),
    [allRates, activeFilter],
  );

  const lanes: Urgency[] = ["inactive", "high", "standard", "low"];

  function goToMaster() {
    navigate("/masters/tds");
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          {
            label: "TDS Reminders",
            path: "/followup/follow-ups/tds-reminders",
          },
        ]}
      />
      <div className="relative space-y-6 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 shrink-0">
              <Percent size={20} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                TDS Reminders
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Compliance readiness tracker — monitor active rates and
                deductions
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <button
              onClick={goToMaster}
              className="flex items-center gap-1.5 text-xs font-medium bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 border border-violet-400/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowUpRight size={13} />
              Open TDS Master
            </button>
          </div>
        </div>

        {/* ── KPI strip + breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <KPIStrip
            rates={allRates}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
          <BreakdownBar rates={allRates} />
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
                className="h-44 rounded-xl border border-border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={activeFilter} />
        ) : (
          <div className="space-y-8">
            {lanes.map((u) => {
              const data = filtered.filter((r) => r.urgency === u);
              if (!data.length) return null;
              return (
                <UrgencyLane
                  key={u}
                  urgency={u}
                  rates={data}
                  onNavigate={goToMaster}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}