import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InsideWorkShell } from "@/components/insidework/InsideWorkShell";
import {
  FileClock,
  Search,
  RefreshCw,
  SlidersHorizontal,
  Copy,
  Monitor,
  Smartphone,
  Globe,
  MapPin,
  ChevronDown,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActivityStatCard {
  label: string;
  primary: string | number;
  secondary?: string | number;
  trend?: string;
  trendDir?: "up" | "down" | "neutral";
  copyable?: boolean;
  tags?: string[];
}

export interface SessionFlowEntry {
  page: string;
  segments: {
    start: number;
    duration: number;
    label: string;
    color?: string;
  }[];
}

export interface ScoresJourneyPoint {
  label: string;
  mobileApp?: number;
  mobileBrowser?: number;
  desktop?: number;
  confirmedFraud?: number;
  paymentMade?: number;
}

export interface InsideWorkActivityProps {
  // Top filter bar
  sessionId?: string;
  isInSession?: boolean;
  deviceLabel?: string;
  ipAddress?: string;
  location?: string;
  coordinates?: string;

  // Stat cards — up to 5
  statCards?: ActivityStatCard[];

  // Session flow chart
  sessionFlowData?: SessionFlowEntry[];
  sessionFlowMaxX?: number;

  // Scores journey chart
  scoresJourneyData?: ScoresJourneyPoint[];

  // Controls
  onRefresh?: () => void;
  onFilter?: () => void;
  lastRange?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CYAN = "#0891b2";
const CYAN_BRIGHT = "#22d3ee";

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SessionBadge({ active }: { active?: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      in session
    </span>
  );
}

function StatCard({ card }: { card: ActivityStatCard }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyToClipboard(String(card.primary));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="relative rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-1 min-w-0 overflow-hidden"
      style={{ borderTop: `2px solid ${CYAN}40` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground truncate">
          {card.label}
        </p>
        {card.copyable && (
          <button
            onClick={handleCopy}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy"
          >
            <Copy size={11} />
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-lg font-bold font-heading text-foreground leading-none truncate">
          {card.primary}
        </span>
        {card.secondary !== undefined && (
          <>
            <span className="text-muted-foreground text-sm">•</span>
            <span className="text-sm font-heading font-semibold text-muted-foreground">
              {card.secondary}
            </span>
          </>
        )}
      </div>

      {card.trend && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
          {card.trendDir === "up" && <span style={{ color: CYAN }}>↑</span>}
          {card.trendDir === "down" && <span className="text-red-400">↓</span>}
          {card.trend}
        </p>
      )}

      {card.tags && card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-border bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {copied && (
        <span className="absolute inset-x-0 bottom-0 text-center text-[9px] text-emerald-400 bg-card py-0.5">
          Copied
        </span>
      )}
    </div>
  );
}

// Session flow — horizontal stacked bars using recharts BarChart horizontal
function SessionFlowChart({
  data,
  maxX,
}: {
  data: SessionFlowEntry[];
  maxX?: number;
}) {
  // Flatten into recharts-friendly format: each row = one page, segments as separate keys
  // We'll use a simple custom approach with absolute positioning over a plain grid
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        No session flow data yet
      </div>
    );
  }

  const domainMax = maxX ?? 16;

  const COLORS = [
    "#0891b2",
    "#0e7490",
    "#22d3ee",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#10b981",
  ];

  // Build recharts dataset: one entry per page, with named segment keys
  // We'll render as a stacked horizontal bar chart
  // Each SessionFlowEntry has arbitrary segments, so we treat them by index
  const maxSegments = Math.max(...data.map((d) => d.segments.length));
  const segKeys = Array.from({ length: maxSegments }, (_, i) => `seg_${i}`);

  const chartData = data.map((entry) => {
    const row: Record<string, unknown> = { page: entry.page };
    // Gap before first segment
    if (entry.segments.length > 0) {
      row["gap"] = entry.segments[0].start;
    } else {
      row["gap"] = 0;
    }
    entry.segments.forEach((seg, i) => {
      row[`seg_${i}`] = seg.duration;
      row[`seg_${i}_label`] = seg.label;
    });
    return row;
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-background p-2.5 shadow-lg text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload
          .filter((p: any) => p.name !== "gap" && p.value > 0)
          .map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: p.fill }}
              />
              <span className="text-muted-foreground">{p.value}s</span>
            </div>
          ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={data.length * 36 + 40}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
        barCategoryGap="25%"
      >
        <CartesianGrid
          horizontal={false}
          stroke="rgba(255,255,255,0.05)"
          strokeDasharray="3 3"
        />
        <XAxis
          type="number"
          domain={[0, domainMax]}
          tickFormatter={(v) => `${v}s`}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="page"
          width={180}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
        />
        {/* Transparent gap bar to offset */}
        <Bar dataKey="gap" stackId="a" fill="transparent" />
        {segKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="a"
            fill={COLORS[i % COLORS.length]}
            radius={i === maxSegments - 1 ? [0, 3, 3, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScoresJourneyChart({ data }: { data: ScoresJourneyPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        No scores journey data yet
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-background p-2.5 shadow-lg text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2 mt-0.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-mono text-foreground">{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const SERIES: {
    key: keyof ScoresJourneyPoint;
    color: string;
    label: string;
  }[] = [
    { key: "mobileApp", color: "#60a5fa", label: "Mobile App" },
    { key: "mobileBrowser", color: "#a78bfa", label: "Mobile Browser" },
    { key: "desktop", color: "#34d399", label: "Desktop" },
    { key: "confirmedFraud", color: "#f87171", label: "Confirmed Fraud" },
    { key: "paymentMade", color: "#fbbf24", label: "Payment Made" },
  ];

  // Filter to only series that have at least one value in data
  const activeSeries = SERIES.filter((s) =>
    data.some((d) => d[s.key] !== undefined && d[s.key] !== null),
  );

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3">
        {activeSeries.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
        >
          <CartesianGrid
            stroke="rgba(255,255,255,0.05)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          <Tooltip content={<CustomTooltip />} />
          {activeSeries.map((s) => (
            <Line
              key={String(s.key)}
              type="monotone"
              dataKey={s.key as string}
              stroke={s.color}
              strokeWidth={1.5}
              dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={s.label}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const InsideWorkActivity: React.FC<InsideWorkActivityProps> = ({
  sessionId,
  isInSession,
  deviceLabel,
  ipAddress,
  location,
  coordinates,
  statCards = [],
  sessionFlowData = [],
  sessionFlowMaxX,
  scoresJourneyData = [],
  onRefresh,
  onFilter,
  lastRange = "Last 24h",
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [rangeLabel] = useState(lastRange);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Inside Work", "Activity"]} />
      <InsideWorkShell
        title="Activity"
        subtitle="Session analytics and change trail for this module"
        icon={FileClock}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={onFilter}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            >
              <SlidersHorizontal size={12} />
              <span className="hidden sm:inline">Filters</span>
            </button>
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">{rangeLabel}</span>
              <ChevronDown size={11} />
            </button>
          </div>
        }
      >
        {/* ── Session Identity Bar ── */}
        {(sessionId || deviceLabel || ipAddress || location) && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {sessionId && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-foreground font-medium truncate max-w-[220px]">
                  {sessionId}
                </span>
                <SessionBadge active={isInSession} />
                <button
                  onClick={() => copyToClipboard(sessionId)}
                  className="hover:text-foreground transition-colors"
                >
                  <Copy size={11} />
                </button>
              </div>
            )}
            {deviceLabel && (
              <div className="flex items-center gap-1.5">
                <Monitor size={12} />
                {deviceLabel}
              </div>
            )}
            {ipAddress && (
              <div className="flex items-center gap-1.5">
                <Globe size={12} />
                {ipAddress}
                <button
                  onClick={() => copyToClipboard(ipAddress)}
                  className="hover:text-foreground transition-colors"
                >
                  <Copy size={10} />
                </button>
              </div>
            )}
            {location && (
              <div className="flex items-center gap-1.5">
                <MapPin size={12} />
                {location}
                {coordinates && (
                  <span className="text-muted-foreground/60">
                    {coordinates}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Stat Cards Row ── */}
        {statCards.length > 0 && (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${Math.min(statCards.length, 5)}, minmax(0, 1fr))`,
            }}
          >
            {statCards.map((card, i) => (
              <StatCard key={i} card={card} />
            ))}
          </div>
        )}

        {/* ── Search bar ── */}
        <div className="relative">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            placeholder="Quick search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm font-body bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* ── Session Flow ── */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-heading font-semibold text-foreground">
                Session Flow
              </p>
            </div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              Average quality
              <RefreshCw size={11} />
            </button>
          </div>
          <SessionFlowChart data={sessionFlowData} maxX={sessionFlowMaxX} />
        </div>

        {/* ── Scores Journey ── */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-heading font-semibold text-foreground mb-4">
            Scores Journey
          </p>
          <ScoresJourneyChart data={scoresJourneyData} />
        </div>
      </InsideWorkShell>
    </>
  );
};

export default InsideWorkActivity;
