import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Hash,
  Landmark,
  RefreshCw,
  Timer,
  TrendingDown,
  TrendingUp,
  Building2,
  Zap,
} from "lucide-react";

import { getCheques, type DbCheque } from "@/api/chequeMasterApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";

// ─── Types ────────────────────────────────────────────────────────────────────

// Urgency semantics for cheque lots:
//   "overdue"  → inactive lot (Status = false) — flagged, needs review
//   "today"    → active, created or updated today
//   "soon"     → active, lot has ≤10 cheques remaining (running low)
//   "upcoming" → active, healthy lot
type Urgency = "overdue" | "today" | "soon" | "upcoming";

interface LotWithUrgency extends DbCheque {
  urgency: Urgency;
  totalRange: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyLotUrgency(lot: DbCheque): Urgency {
  if (!lot.Status) return "overdue";
  const range =
    lot.ChequeEndNumber != null && lot.ChequeStartNumber != null
      ? lot.ChequeEndNumber - lot.ChequeStartNumber + 1
      : (lot.TotalCheques ?? 0);
  const ref = (lot as any).UpdatedAt || (lot as any).CreatedAt;
  if (ref) {
    const refDate = new Date(ref);
    const today = new Date();
    if (
      refDate.getFullYear() === today.getFullYear() &&
      refDate.getMonth() === today.getMonth() &&
      refDate.getDate() === today.getDate()
    ) {
      return "today";
    }
  }
  if (range <= 10) return "soon";
  return "upcoming";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchCheques(): Promise<LotWithUrgency[]> {
  const list = await getCheques();

  return list
    .map((lot) => ({
      ...lot,
      urgency: classifyLotUrgency(lot),
      totalRange:
        lot.ChequeEndNumber != null && lot.ChequeStartNumber != null
          ? lot.ChequeEndNumber - lot.ChequeStartNumber + 1
          : (lot.TotalCheques ?? 0),
    }))
    .sort((a, b) => {
      const order: Record<Urgency, number> = {
        overdue: 0,
        today: 1,
        soon: 2,
        upcoming: 3,
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
  overdue: {
    label: "Inactive",
    pill: "bg-red-500/15 text-red-600 border border-red-400/30",
    cardBorder: "border-red-400/40",
    badge: "bg-red-500 text-white",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  today: {
    label: "Updated Today",
    pill: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
    cardBorder: "border-amber-400/40",
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
    icon: Zap,
  },
  soon: {
    label: "Low Cheques",
    pill: "bg-sky-500/15 text-sky-600 border border-sky-400/30",
    cardBorder: "border-sky-400/30",
    badge: "bg-sky-500 text-white",
    dot: "bg-sky-400",
    icon: Timer,
  },
  upcoming: {
    label: "Active",
    pill: "bg-muted text-muted-foreground border border-border",
    cardBorder: "border-border",
    badge: "bg-muted-foreground text-white",
    dot: "bg-muted-foreground/50",
    icon: Clock,
  },
};

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KPIStrip({
  lots,
  activeFilter,
  onFilter,
}: {
  lots: LotWithUrgency[];
  activeFilter: Urgency | "all";
  onFilter: (f: Urgency | "all") => void;
}) {
  const counts = useMemo(
    () => ({
      all: lots.length,
      overdue: lots.filter((l) => l.urgency === "overdue").length,
      today: lots.filter((l) => l.urgency === "today").length,
      soon: lots.filter((l) => l.urgency === "soon").length,
      upcoming: lots.filter((l) => l.urgency === "upcoming").length,
    }),
    [lots],
  );

  const totalCheques = lots
    .filter((l) => l.Status)
    .reduce((s, l) => s + l.totalRange, 0);

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
      label: "All Lots",
      value: counts.all,
      sub: `${totalCheques.toLocaleString()} active cheques`,
      icon: BookOpen,
      accent: "text-cyan-600",
      bg: "bg-cyan-500/10",
      ring: "ring-2 ring-cyan-400/60 bg-cyan-500/10",
    },
    {
      key: "overdue",
      label: "Inactive",
      value: counts.overdue,
      sub: "Needs review",
      icon: AlertTriangle,
      accent: "text-red-600",
      bg: "bg-red-500/10",
      ring: "ring-2 ring-red-400/60 bg-red-500/10",
    },
    {
      key: "today",
      label: "Updated Today",
      value: counts.today,
      sub: "Recently modified",
      icon: Zap,
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
      ring: "ring-2 ring-amber-400/60 bg-amber-500/10",
    },
    {
      key: "soon",
      label: "Low Cheques",
      value: counts.soon,
      sub: "≤10 cheques left",
      icon: TrendingDown,
      accent: "text-sky-600",
      bg: "bg-sky-500/10",
      ring: "ring-2 ring-sky-400/60 bg-sky-500/10",
    },
    {
      key: "upcoming",
      label: "Active",
      value: counts.upcoming,
      sub: "Healthy lots",
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

function BreakdownBar({ lots }: { lots: LotWithUrgency[] }) {
  const total = lots.length || 1;
  const counts = {
    overdue: lots.filter((l) => l.urgency === "overdue").length,
    today: lots.filter((l) => l.urgency === "today").length,
    soon: lots.filter((l) => l.urgency === "soon").length,
    upcoming: lots.filter((l) => l.urgency === "upcoming").length,
  };

  const segments: { key: Urgency; color: string; label: string }[] = [
    { key: "overdue", color: "bg-red-500", label: "Inactive" },
    { key: "today", color: "bg-amber-500", label: "Today" },
    { key: "soon", color: "bg-sky-500", label: "Low" },
    { key: "upcoming", color: "bg-muted-foreground/30", label: "Active" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-cyan-600" />
        <span className="text-xs font-semibold text-foreground">
          Lot Breakdown
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {total} total lots
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

// ─── CHQ Card ─────────────────────────────────────────────────────────────────

function CHQCard({
  lot,
  onNavigate,
}: {
  lot: LotWithUrgency;
  onNavigate: () => void;
}) {
  const cfg = URGENCY_CFG[lot.urgency];
  const ref = (lot as any).UpdatedAt || (lot as any).CreatedAt;

  return (
    <div
      onClick={onNavigate}
      className={`group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${cfg.cardBorder}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-cyan-500/10 shrink-0">
            <BookOpen size={13} className="text-cyan-600" />
          </div>
          <span className="font-mono text-[11px] font-bold text-primary truncate">
            {lot.ChequeLotNumber || `LOT-${lot.CId}`}
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

      {/* Bank */}
      <p className="text-[12px] font-semibold text-foreground leading-snug truncate mb-0.5">
        {lot.BankName || "—"}
        {lot.BankBranch ? ` · ${lot.BankBranch}` : ""}
      </p>

      {/* Company */}
      {lot.CompanyName && (
        <div className="flex items-center gap-1 mb-3">
          <Building2 size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground truncate">
            {lot.CompanyName}
          </p>
        </div>
      )}

      {/* Cheque range */}
      <div className="flex items-center gap-1.5 mb-3 bg-muted/50 rounded-lg px-3 py-2">
        <Hash size={11} className="text-muted-foreground shrink-0" />
        <span className="font-mono text-[11px] text-foreground font-medium">
          {(lot.ChequeStartNumber ?? 0).toLocaleString()} →{" "}
          {(lot.ChequeEndNumber ?? 0).toLocaleString()}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground font-semibold">
          {lot.totalRange} cheques
        </span>
      </div>

      {/* Account */}
      {lot.AccountNumber && (
        <div className="flex items-center gap-1 mb-3">
          <Landmark size={9} className="text-muted-foreground shrink-0" />
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {lot.AccountNumber}
            {lot.IFSCCode ? ` · ${lot.IFSCCode}` : ""}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar size={10} />
          <span>{fmtDate(ref)}</span>
        </div>
        <span
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            lot.Status
              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20"
              : "bg-red-500/10 text-red-600 border border-red-400/20"
          }`}
        >
          {lot.Status ? "Active" : "Inactive"}
        </span>
      </div>
    </div>
  );
}

// ─── Urgency Lane ─────────────────────────────────────────────────────────────

function UrgencyLane({
  urgency,
  lots,
  onNavigate,
}: {
  urgency: Urgency;
  lots: LotWithUrgency[];
  onNavigate: () => void;
}) {
  const cfg = URGENCY_CFG[urgency];
  const LaneIcon = cfg.icon;
  if (!lots.length) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
        <span className="text-xs font-semibold text-foreground">
          {cfg.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          {lots.length} lot{lots.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-border/50" />
        <LaneIcon size={12} className="text-muted-foreground" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {lots.map((lot) => (
          <CHQCard key={lot.CId} lot={lot} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Urgency | "all" }) {
  const msgs: Record<Urgency | "all", { title: string; sub: string }> = {
    all: {
      title: "No cheque lots found",
      sub: "Add cheque lots in the Cheque Master to track them here.",
    },
    overdue: { title: "No inactive lots", sub: "All lots are active." },
    today: { title: "Nothing updated today", sub: "No activity today." },
    soon: {
      title: "No lots running low",
      sub: "All active lots have healthy cheque counts.",
    },
    upcoming: {
      title: "No active lots",
      sub: "Create a cheque lot to track it here.",
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

export default function CHQReminders() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<Urgency | "all">("all");

  const {
    data: allLots = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["chq-reminders"],
    queryFn: fetchCheques,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? allLots
        : allLots.filter((l) => l.urgency === activeFilter),
    [allLots, activeFilter],
  );

  const lanes: Urgency[] = ["overdue", "today", "soon", "upcoming"];

  function goToMaster() {
    navigate("/masters/cheque");
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          {
            label: "CHQ Reminders",
            path: "/followup/follow-ups/chq-reminders",
          },
        ]}
      />
      <FollowupShell
        title="Cheque Reminders"
        icon={BookOpen}
        action={
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
              className="flex items-center gap-1.5 text-xs font-medium bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 border border-cyan-400/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowUpRight size={13} />
              Open Cheque Master
            </button>
          </div>
        }
      >

        {/* ── KPI strip + breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <KPIStrip
            lots={allLots}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
          <BreakdownBar lots={allLots} />
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
              const data = filtered.filter((l) => l.urgency === u);
              if (!data.length) return null;
              return (
                <UrgencyLane
                  key={u}
                  urgency={u}
                  lots={data}
                  onNavigate={goToMaster}
                />
              );
            })}
          </div>
        )}
      </FollowupShell>
    </>
  );
}