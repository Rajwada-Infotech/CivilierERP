import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Package,
  RefreshCw,
  ShoppingCart,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  ExpectedDeliveryDate: string;
  SupplierName: string;
  CompanyName?: string;
  ProjectName?: string;
  TotalAmount?: number;
  Status: string;
  PaymentTerms?: string;
  POType?: string;
  CreatedBy?: string;
}

type Urgency = "overdue" | "today" | "soon" | "upcoming";

interface POWithUrgency extends PurchaseOrder {
  urgency: Urgency;
  daysRelative: number; // negative = overdue
}

// ─── Helpers from useReminders (same logic as the bell) ──────────────────────
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
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Fetch (same endpoint the bell uses) ─────────────────────────────────────
async function fetchPOs(): Promise<POWithUrgency[]> {
  const res = await fetchWithAuth("/api/purchase-orders?page=1&limit=200");
  if (!res.ok) throw new Error("Failed to load purchase orders");
  const raw = await res.json();
  const list: PurchaseOrder[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.data)
      ? raw.data
      : [];

  return list
    .map((po) => {
      const dateKey = po.ExpectedDeliveryDate || po.PODate;
      return {
        ...po,
        urgency: dateKey ? classifyUrgency(dateKey) : "upcoming",
        daysRelative: dateKey ? getDaysRelative(dateKey) : 999,
      };
    })
    .sort((a, b) => a.daysRelative - b.daysRelative);
}

// ─── Urgency config ───────────────────────────────────────────────────────────
const URGENCY_CONFIG: Record<
  Urgency,
  {
    label: string;
    pill: string;
    cardBorder: string;
    cardGlow: string;
    badge: string;
    dot: string;
    icon: React.ElementType;
  }
> = {
  overdue: {
    label: "Overdue",
    pill: "bg-red-500/15 text-red-600 border border-red-400/30",
    cardBorder: "border-red-400/40",
    cardGlow: "shadow-red-500/5",
    badge: "bg-red-500 text-white",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  today: {
    label: "Due Today",
    pill: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
    cardBorder: "border-amber-400/40",
    cardGlow: "shadow-amber-500/5",
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
    icon: Zap,
  },
  soon: {
    label: "Due Soon",
    pill: "bg-blue-500/15 text-blue-600 border border-blue-400/30",
    cardBorder: "border-blue-400/30",
    cardGlow: "",
    badge: "bg-blue-500 text-white",
    dot: "bg-blue-500",
    icon: Timer,
  },
  upcoming: {
    label: "Upcoming",
    pill: "bg-muted text-muted-foreground border border-border",
    cardBorder: "border-border",
    cardGlow: "",
    badge: "bg-muted-foreground text-white",
    dot: "bg-muted-foreground",
    icon: Clock,
  },
};

const PO_STATUS_PILL: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Closed: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  "Fully Received":
    "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border border-amber-400/20",
  Open: "bg-blue-500/10 text-blue-600 border border-blue-400/20",
  Draft: "bg-muted text-muted-foreground border border-border",
  Rejected: "bg-red-500/10 text-red-500 border border-red-400/20",
  Cancelled: "bg-red-500/10 text-red-500 border border-red-400/20",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPIStrip({
  pos,
  activeFilter,
  onFilter,
}: {
  pos: POWithUrgency[];
  activeFilter: Urgency | "all";
  onFilter: (f: Urgency | "all") => void;
}) {
  const counts = useMemo(() => {
    return {
      all: pos.length,
      overdue: pos.filter((p) => p.urgency === "overdue").length,
      today: pos.filter((p) => p.urgency === "today").length,
      soon: pos.filter((p) => p.urgency === "soon").length,
      upcoming: pos.filter((p) => p.urgency === "upcoming").length,
    };
  }, [pos]);

  const totalValue = pos.reduce((s, p) => s + (p.TotalAmount ?? 0), 0);

  const tiles = [
    {
      key: "all" as const,
      label: "All POs",
      value: counts.all,
      sub: fmtCurrency(totalValue),
      icon: ShoppingCart,
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
      active: "ring-2 ring-amber-400/60 bg-amber-500/10",
    },
    {
      key: "overdue" as const,
      label: "Overdue",
      value: counts.overdue,
      sub: "Past delivery date",
      icon: AlertTriangle,
      accent: "text-red-600",
      bg: "bg-red-500/10",
      active: "ring-2 ring-red-400/60 bg-red-500/10",
    },
    {
      key: "today" as const,
      label: "Due Today",
      value: counts.today,
      sub: "Needs action now",
      icon: Zap,
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
      active: "ring-2 ring-amber-400/60 bg-amber-500/10",
    },
    {
      key: "soon" as const,
      label: "Due Soon",
      value: counts.soon,
      sub: "Within 7 days",
      icon: Timer,
      accent: "text-blue-600",
      bg: "bg-blue-500/10",
      active: "ring-2 ring-blue-400/60 bg-blue-500/10",
    },
    {
      key: "upcoming" as const,
      label: "Upcoming",
      value: counts.upcoming,
      sub: "More than 7 days",
      icon: Calendar,
      accent: "text-muted-foreground",
      bg: "bg-muted",
      active: "ring-2 ring-border bg-muted",
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
            className={`rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${isActive ? t.active : "hover:border-primary/20"}`}
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

function UrgencyLane({
  urgency,
  pos,
  onNavigate,
}: {
  urgency: Urgency;
  pos: POWithUrgency[];
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CONFIG[urgency];
  const LaneIcon = cfg.icon;

  if (!pos.length) return null;

  return (
    <div>
      {/* Lane header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
        <span className="text-xs font-semibold text-foreground">
          {cfg.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          {pos.length} PO{pos.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-border/50" />
        <LaneIcon size={12} className="text-muted-foreground" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {pos.map((po) => (
          <POCard key={po.PurchaseOrderID} po={po} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function POCard({
  po,
  onNavigate,
}: {
  po: POWithUrgency;
  onNavigate: (id: number) => void;
}) {
  const cfg = URGENCY_CONFIG[po.urgency];
  const statusPill =
    PO_STATUS_PILL[po.Status] ??
    "bg-muted text-muted-foreground border border-border";
  const relLabel = formatRelative(po.daysRelative);
  const dateKey = po.ExpectedDeliveryDate || po.PODate;

  return (
    <div
      className={`group rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${cfg.cardBorder} ${cfg.cardGlow}`}
      onClick={() => onNavigate(po.PurchaseOrderID)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-amber-500/10 shrink-0">
            <Package size={13} className="text-amber-600" />
          </div>
          <span className="font-mono text-[11px] font-bold text-primary truncate">
            {po.PurchaseOrderNo || `PO-${po.PurchaseOrderID}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${cfg.pill}`}
          >
            {relLabel}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(po.PurchaseOrderID);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {/* Supplier */}
      <p className="text-[12px] font-semibold text-foreground leading-snug truncate mb-1">
        {po.SupplierName || "—"}
      </p>
      {po.ProjectName && (
        <p className="text-[10px] text-muted-foreground truncate mb-3">
          {po.ProjectName}
        </p>
      )}

      {/* Amount */}
      {po.TotalAmount != null && (
        <p className="text-base font-bold text-emerald-600 mb-3 font-heading">
          {fmtCurrency(po.TotalAmount)}
        </p>
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
          {po.Status}
        </span>
      </div>
    </div>
  );
}

function TimelineBar({ pos }: { pos: POWithUrgency[] }) {
  const counts = {
    overdue: pos.filter((p) => p.urgency === "overdue").length,
    today: pos.filter((p) => p.urgency === "today").length,
    soon: pos.filter((p) => p.urgency === "soon").length,
    upcoming: pos.filter((p) => p.urgency === "upcoming").length,
  };
  const total = pos.length || 1;

  const segments: { key: Urgency; color: string; label: string }[] = [
    { key: "overdue", color: "bg-red-500", label: "Overdue" },
    { key: "today", color: "bg-amber-500", label: "Today" },
    { key: "soon", color: "bg-blue-500", label: "Soon" },
    { key: "upcoming", color: "bg-muted-foreground/40", label: "Upcoming" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-amber-600" />
        <span className="text-xs font-semibold text-foreground">
          Urgency Breakdown
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {total} total POs
        </span>
      </div>

      {/* Stacked bar */}
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

      {/* Legend */}
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

function EmptyState({ filter }: { filter: Urgency | "all" }) {
  const msgs: Record<Urgency | "all", { title: string; sub: string }> = {
    all: {
      title: "No purchase orders found",
      sub: "Your POs will appear here once created.",
    },
    overdue: { title: "No overdue POs", sub: "Everything is on track." },
    today: { title: "Nothing due today", sub: "You're clear for today." },
    soon: {
      title: "Nothing due in the next 7 days",
      sub: "Plenty of time ahead.",
    },
    upcoming: {
      title: "No upcoming POs",
      sub: "Create a PO to track it here.",
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
export default function POReminders() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<Urgency | "all">("all");

  const {
    data: allPOs = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["po-reminders-bell-source"],
    queryFn: fetchPOs,
    staleTime: 2 * 60 * 1000,
  });

  const filtered = useMemo(
    () =>
      activeFilter === "all"
        ? allPOs
        : allPOs.filter((p) => p.urgency === activeFilter),
    [allPOs, activeFilter],
  );

  // Group into urgency lanes (respect current filter)
  const lanes: Urgency[] = ["overdue", "today", "soon", "upcoming"];
  const laneData = (u: Urgency) => filtered.filter((p) => p.urgency === u);

  function goToPO(id: number) {
    navigate(`/material/purchase-order?highlight=${id}`);
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          {
            label: "PO Reminders",
            path: "/followup/follow-ups/po-reminders",
          },
        ]}
      />
      <div className="relative space-y-6 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 shrink-0">
              <ShoppingCart size={20} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                PO Reminders
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Live purchase order follow-up tracker — same source as the
                reminder bell
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
              onClick={() => navigate("/material/purchase-order")}
              className="flex items-center gap-1.5 text-xs font-medium bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border border-amber-400/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowUpRight size={13} />
              Open PO Module
            </button>
          </div>
        </div>

        {/* ── KPI strip + timeline ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <KPIStrip
            pos={allPOs}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
          <TimelineBar pos={allPOs} />
        </div>

        {/* ── Filter label ── */}
        {activeFilter !== "all" && (
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-3 py-1 rounded-full ${URGENCY_CONFIG[activeFilter].pill}`}
            >
              Showing: {URGENCY_CONFIG[activeFilter].label}
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
                className="h-36 rounded-xl border border-border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={activeFilter} />
        ) : (
          <div className="space-y-8">
            {lanes.map((u) => {
              const data = laneData(u);
              if (!data.length) return null;
              return (
                <UrgencyLane
                  key={u}
                  urgency={u}
                  pos={data}
                  onNavigate={goToPO}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}