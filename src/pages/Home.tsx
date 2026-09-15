import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  HardHat,
  Building2,
  Layers,
  ClipboardList,
  Hammer,
  ArrowRight,
  ShieldCheck,
  BarChart3,
  RefreshCw,
  AlertCircle,
  IndianRupee,
  Package,
  FileCheck,
  Users,
  Database,
  Ticket,
  TriangleAlert,
  CheckCircle2,
  TrendingUp,
  Warehouse,
  FileText,
  CreditCard,
  Wrench,
  LineChart,
  ShoppingCart,
  Pickaxe,
  Receipt,
  HeartHandshake,
  Table,
  Activity,
  Bell,
  Cpu,
  ArrowUpRight,
} from "lucide-react";
import {
  fetchHomeDashboard,
  type HomeDashboardData,
  type RecentPayment,
  type RecentGRN,
  type RecentExpense,
  type ApprovalInboxItem,
  type TaskSummary,
  type SalesSummaryData,
} from "@/api/homeDashboardApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";

// ─── Role helpers ─────────────────────────────────────────────────────────────
// These mirror the logic in TopNavbar / auth.utils so the home page
// shows exactly the same modules a user can actually navigate to.

type UserRoleStr = string;

function isPrivileged(role: UserRoleStr) {
  return ["super_admin", "admin", "dba"].includes(role);
}

// ─── Universal activity feed ──────────────────────────────────────────────────
interface LiveActivityItem {
  Kind: string;
  Module: string;
  DocNo: string | null;
  Title: string;
  Subtitle: string | null;
  Actor: string | null;
  Amount: number | null;
  Status: string | null;
  At: string;
  Href: string;
}

const MODULE_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  finance:     { label: "Finance",     color: "#3b82f6", icon: IndianRupee },
  material:    { label: "Material",    color: "#8b5cf6", icon: Package },
  engineering: { label: "Engineering", color: "#ec4899", icon: Wrench },
  sales:       { label: "Sales",       color: "#7c3aed", icon: ShoppingCart },
  crm:         { label: "CRM",         color: "#e11d48", icon: HeartHandshake },
  ticket:      { label: "Tickets",     color: "#ef4444", icon: Ticket },
  followup:    { label: "Follow-Up",   color: "#0d9488", icon: Table },
  fixedasset:  { label: "Fixed Asset", color: "#eab308", icon: Cpu },
  admin:       { label: "Admin",       color: "#a855f7", icon: ShieldCheck },
};
const moduleMeta = (m: string) => MODULE_META[m] ?? { label: m, color: "#64748b", icon: Activity };

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d || d < 946684800000) return ""; // pre-2000 sentinel = unknown
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const compactINR = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
  : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K`
  : `₹${Math.round(n)}`;

// Recharts' default auto-tick algorithm, fed a small/skewed dataset (mostly
// zero with one or two real spikes — exactly what a 7-day activity window
// often looks like), can produce ticks that round to the same displayed
// label once passed through a formatter (e.g. two different raw values
// both showing "30.0L"). Generating clean, evenly-spaced round-number
// ticks ourselves guarantees every label is genuinely distinct.
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const rawStep = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}


// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedCounter({
  target,
  prefix = "",
  suffix = "",
  duration = 1.6,
}: {
  target: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1000 / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setCount(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, target, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {count.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

// ─── Bento primitives ─────────────────────────────────────────────────────────
function Bento({
  children, className = "", title, subtitle, icon: Icon, accent = "#6366f1", action, delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ElementType;
  accent?: string;
  action?: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden flex flex-col ${className}`}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      {title && (
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-2.5">
          {Icon && (
            <span
              className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}
            >
              <Icon size={12} style={{ color: accent }} />
            </span>
          )}
          <div className="min-w-0">
            <span className="font-heading text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground block">
              {title}
            </span>
            {subtitle && (
              <span className="text-[10px] text-muted-foreground/45 block mt-0.5 normal-case tracking-normal font-normal">
                {subtitle}
              </span>
            )}
          </div>
          {action && <span className="ml-auto shrink-0">{action}</span>}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </motion.div>
  );
}

interface Attention {
  severity: "high" | "med" | "low";
  label: string;
  count: number;
  hint: string;
  href: string;
  icon: React.ElementType;
}
const SEV_COLOR: Record<Attention["severity"], string> = {
  high: "#ef4444",
  med: "#f59e0b",
  low: "#3b82f6",
};

function AttentionRow({ a, i, onGo }: { a: Attention; i: number; onGo: (h: string) => void }) {
  const c = SEV_COLOR[a.severity];
  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.05 + i * 0.05 }}
      onClick={() => onGo(a.href)}
      className="group w-full flex items-center gap-3 px-4 py-2.5 border-b border-border/25 last:border-0 hover:bg-muted/30 transition-colors text-left"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {a.severity === "high" && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: c }} />
        )}
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: c }} />
      </span>
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${c}14` }}
      >
        <a.icon size={13} style={{ color: c }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight truncate">{a.label}</p>
        <p className="text-[10px] text-muted-foreground/55 mt-0.5 truncate">{a.hint}</p>
      </div>
      <span className="font-heading font-bold text-lg tabular-nums shrink-0" style={{ color: c }}>
        {a.count.toLocaleString("en-IN")}
      </span>
      <ArrowUpRight size={13} className="text-muted-foreground/20 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
    </motion.button>
  );
}

function KpiPill({
  label, value, prefix = "", suffix = "", color, icon: Icon, i,
}: {
  label: string;
  value: number | string | null;
  prefix?: string;
  suffix?: string;
  color: string;
  icon: React.ElementType;
  i: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.1 + i * 0.04 }}
      className="rounded-xl border border-border/45 bg-card/50 backdrop-blur-sm px-3.5 py-3 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5">
        <Icon size={11} style={{ color }} />
        <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/55 truncate">{label}</span>
      </div>
      <span className="font-heading font-bold text-[1.35rem] leading-none tabular-nums" style={{ color }}>
        {value == null ? (
          <span className="animate-pulse inline-block h-5 w-14 bg-muted rounded" />
        ) : typeof value === "number" ? (
          <AnimatedCounter target={value} prefix={prefix} suffix={suffix} duration={1.1} />
        ) : (
          `${prefix}${value}${suffix}`
        )}
      </span>
    </motion.div>
  );
}

function LiveRow({ item, onGo }: { item: LiveActivityItem; onGo: (h: string) => void }) {
  const m = moduleMeta(item.Module);
  const t = relTime(item.At);
  return (
    <button
      onClick={() => onGo(item.Href)}
      className="group w-full flex items-start gap-2.5 px-4 py-2.5 border-b border-border/20 last:border-0 hover:bg-muted/25 transition-colors text-left"
    >
      <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${m.color}16` }}>
        <m.icon size={11} style={{ color: m.color }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold text-foreground leading-snug truncate">{item.Title}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
          <span style={{ color: m.color }}>{m.label}</span>
          {item.Subtitle ? ` · ${item.Subtitle}` : ""}
          {item.Actor ? ` · ${item.Actor}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        {item.Amount != null && item.Amount > 0 && (
          <span className="text-[10.5px] font-heading font-bold tabular-nums" style={{ color: m.color }}>
            {compactINR(item.Amount)}
          </span>
        )}
        {t && <span className="text-[9.5px] text-muted-foreground/35 font-mono tabular-nums">{t}</span>}
      </div>
    </button>
  );
}

// ─── Stat card — hero KPI tile with a small trend sparkline ─────────────────
function StatCard({
  icon: Icon, label, value, prefix = "", suffix = "", color, sparkline, i,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string | null;
  prefix?: string;
  suffix?: string;
  color: string;
  sparkline: number[];
  i: number;
}) {
  const max = Math.max(...sparkline, 1);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 flex flex-col gap-4 overflow-hidden"
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-center justify-between">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon size={16} style={{ color }} />
        </span>
        {/* 7-day trend — same activity series the charts below plot */}
        <div className="flex items-end gap-[3px] h-7">
          {sparkline.map((v, idx) => (
            <div
              key={idx}
              className="w-1.5 rounded-full transition-all"
              style={{
                height: `${Math.max(12, (v / max) * 100)}%`,
                background: idx >= sparkline.length - 2 ? color : `${color}35`,
              }}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground/55 mb-1 truncate">
          {label}
        </p>
        <p className="font-heading font-bold text-[1.65rem] leading-none tabular-nums" style={{ color }}>
          {value == null ? (
            <span className="animate-pulse inline-block h-7 w-20 bg-muted rounded" />
          ) : typeof value === "number" ? (
            <AnimatedCounter target={value} prefix={prefix} suffix={suffix} duration={1.2} />
          ) : (
            `${prefix}${value}${suffix}`
          )}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Circular gauge — the one genuinely percentage-shaped hero metric ───────
function CircularGauge({ pct, size = 128, color = "#7c3aed" }: { pct: number; size?: number; color?: string }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - pct / 100) }}
        transition={{ duration: 1.3, delay: 0.3, ease: "easeOut" }}
      />
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-heading font-bold" style={{ fontSize: size * 0.22 }}>
        {pct}%
      </text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: size * 0.075, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Completed
      </text>
    </svg>
  );
}

// ─── Project Network — the "world map" panel. This app has no populated
// per-project geo-coordinates yet (dbo.enterprise.latitude/longitude exist
// on the schema but aren't filled in on any project today), so this is a
// deliberately illustrative network diagram — a central hub (the company)
// radiating out to each real project — rather than a literal map claiming
// false geographic precision. Every project gets its own node (no
// grouping/overflow bucket); only the node LAYOUT (an evenly-spaced fan
// around the hub, sized down as the count grows) is decorative. Swap in
// real lat/long-projected positions here once that data actually exists.
// HARD_CAP exists purely as a defensive ceiling against a pathological
// project count blowing up the SVG, not a normal product limit.
const HARD_CAP_NODES = 24;

function ProjectNetworkMap({ projects, total }: { projects: { id: number; name: string; active: boolean }[]; total: number }) {
  const hub = { x: 360, y: 140 };
  const radiusX = 260;
  const radiusY = 95;

  // Active projects lead (they're the ones worth seeing at a glance).
  const shown = [...projects].sort((a, b) => Number(b.active) - Number(a.active)).slice(0, HARD_CAP_NODES);
  const overflow = projects.length - shown.length;
  // More nodes → smaller dots/type so a growing project list stays legible
  // instead of overlapping.
  const density = shown.length <= 6 ? 1 : shown.length <= 12 ? 0.8 : 0.6;

  const nodes = shown.map((p, i) => {
    // Half-circle fan above/around the hub (avoids the caption strip at
    // the bottom) — angle sweeps from -170° to -10° across however many
    // nodes there actually are.
    const t = shown.length <= 1 ? 0.5 : i / (shown.length - 1);
    const angle = (-170 + t * 160) * (Math.PI / 180);
    return {
      ...p,
      x: hub.x + Math.cos(angle) * radiusX,
      y: hub.y + Math.sin(angle) * radiusY,
    };
  });

  const arcPath = (n: { x: number; y: number }) =>
    `M ${hub.x} ${hub.y} Q ${(hub.x + n.x) / 2} ${Math.min(hub.y, n.y) - 30} ${n.x} ${n.y}`;

  return (
    <div className="relative w-full h-[280px] overflow-hidden rounded-xl">
      <svg viewBox="0 0 720 280" className="w-full h-full" style={{ overflow: "visible" }}>
        <defs>
          <pattern id="homeMapGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" className="text-primary/15" />
          </pattern>
        </defs>
        <rect width="720" height="280" fill="url(#homeMapGrid)" />

        {nodes.map((n) => (
          <path key={`arc-${n.id}`} d={arcPath(n)} fill="none" stroke="#7c3aed" strokeWidth="1.2" strokeDasharray="4 4" opacity={n.active ? 0.4 : 0.18} />
        ))}

        {/* Traveling pulse — active projects only, so the eye reads "live" as literally the live ones */}
        {nodes.filter((n) => n.active).map((n, i) => (
          <circle key={`pulse-${n.id}`} r={2.5 * density} fill="#a78bfa">
            <animateMotion dur={`${3 + i * 0.6}s`} repeatCount="indefinite" path={arcPath(n)} />
            <animate attributeName="opacity" values="0;1;0" dur={`${3 + i * 0.6}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {nodes.map((n, i) => (
          <g key={`node-${n.id}`}>
            <circle cx={n.x} cy={n.y} r={(n.active ? 13 : 9) * density} fill="#7c3aed" opacity={n.active ? 0.12 : 0.06}>
              {n.active && <animate attributeName="r" values={`${11 * density};${17 * density};${11 * density}`} dur="2.6s" repeatCount="indefinite" begin={`${i * 0.3}s`} />}
            </circle>
            <circle cx={n.x} cy={n.y} r={(n.active ? 7 : 5) * density} fill={n.active ? "#a78bfa" : "hsl(var(--muted-foreground))"} stroke={n.active ? "#7c3aed" : "hsl(var(--border))"} strokeWidth="1.5" />
            <text
              x={n.x}
              y={n.y + (n.y > hub.y ? 20 * density + 4 : -14 * density - 4)}
              textAnchor="middle"
              className={n.active ? "fill-foreground font-semibold" : "fill-muted-foreground"}
              style={{ fontSize: 11 * density }}
            >
              {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}
            </text>
          </g>
        ))}

        {/* Hub */}
        <circle cx={hub.x} cy={hub.y} r="16" fill="#7c3aed" opacity="0.15">
          <animate attributeName="r" values="14;20;14" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={hub.x} cy={hub.y} r="9" fill="#7c3aed" stroke="#c4b5fd" strokeWidth="2" />
      </svg>

      {/* Caption overlay — the only free-floating numbers in this panel */}
      <div className="absolute bottom-2.5 left-3 right-3 flex items-end justify-between pointer-events-none">
        <div>
          <p className="font-heading font-bold text-2xl text-foreground leading-none tabular-nums">
            <AnimatedCounter target={projects.filter((p) => p.active).length} />
          </p>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mt-1">Active Projects</p>
        </div>
        <div className="text-right">
          <p className="font-heading font-bold text-2xl text-muted-foreground/70 leading-none tabular-nums">
            <AnimatedCounter target={total} />
          </p>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mt-1">
            Total Projects{overflow > 0 ? ` · +${overflow} not shown` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Blueprint BG ─────────────────────────────────────────────────────────────
function BgGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.02]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="g1" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern
            id="g2"
            width="240"
            height="240"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 240 0 L 0 0 0 240"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#g1)"
          className="text-primary"
        />
        <rect
          width="100%"
          height="100%"
          fill="url(#g2)"
          className="text-primary"
        />
      </svg>
      <div className="absolute -top-32 -left-24 w-[50%] h-[50%] bg-primary/6 blur-[180px] rounded-full" />
      <div className="absolute bottom-0 right-0 w-[35%] h-[40%] bg-violet-500/5 blur-[150px] rounded-full" />

      {/* ── Drafting compass — far bottom-right corner, out of content flow ── */}
      <motion.svg
        className="absolute opacity-[0.07] hidden xl:block"
        style={{ bottom: "4%", right: "3%" }}
        width="110"
        height="110"
        viewBox="0 0 90 90"
        fill="none"
        animate={{ rotate: 360 }}
        transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
      >
        <circle
          cx="45"
          cy="45"
          r="3"
          fill="currentColor"
          className="text-primary"
        />
        <line
          x1="45"
          y1="45"
          x2="78"
          y2="20"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="45"
          y1="45"
          x2="20"
          y2="80"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          cx="20"
          cy="80"
          r="2"
          fill="currentColor"
          className="text-primary"
        />
      </motion.svg>

      {/* ── Small crane silhouette — far bottom-left corner ── */}
      <div
        className="absolute opacity-[0.07] hidden xl:block"
        style={{ bottom: "2%", left: "2%", width: 170, height: 110 }}
      >
        <svg width="170" height="110" viewBox="0 0 170 110" fill="none">
          <line
            x1="20"
            y1="8"
            x2="20"
            y2="105"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="12"
            x2="160"
            y2="12"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="12"
            x2="4"
            y2="20"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="30"
            x2="120"
            y2="12"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="1"
          />
          <motion.g
            initial={{ x: 145 }}
            animate={{ x: [145, 75, 145] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          >
            <line
              x1="0"
              y1="12"
              x2="0"
              y2="58"
              stroke="currentColor"
              className="text-primary"
              strokeWidth="1.5"
            />
            <motion.rect
              x="-8"
              y="58"
              width="16"
              height="16"
              rx="3"
              fill="currentColor"
              className="text-primary"
              animate={{ y: [58, 64, 58] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.g>
        </svg>
      </div>

      {/* ── Subtle blueprint scan line, full width, slow ── */}
      <motion.div
        className="absolute left-0 right-0 h-48"
        style={{
          background:
            "linear-gradient(to bottom, transparent, hsl(var(--primary) / 0.025), transparent)",
        }}
        initial={{ top: "-20%" }}
        animate={{ top: "120%" }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "linear",
          repeatDelay: 6,
        }}
      />
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { currentUser, canAccessPage } = useAuth();
  const navigate = useNavigate();

  const role: UserRoleStr = currentUser?.role ?? "";
  const firstName = currentUser?.name?.split(" ")[0] ?? "there";

  // Customer portal redirect
  if (role === "customer") return <Navigate to="/customer-portal" replace />;

  const privileged = isPrivileged(role);
  const isDba = role === "dba";
  const isAdmin = privileged;

  // Compute which modules this user can see.
  // Uses canAccessPage (same source as ModuleStrip) so all roles — including
  // "engineer", custom roles, etc. — get the correct tile set based on their
  // actual DB-assigned pagePermissions rather than hardcoded role strings.
  const MODULE_PAGES: Record<string, string[]> = {
    finance: [
      "finance-dashboard",
      "new-payment",
      "received-payment",
      "brs",
      "transactions",
    ],
    material: [
      "material-dashboard",
      "purchase-orders",
      "grn-master",
      "material-request",
      "material-issues",
      "stock-ledger",
    ],
    followup: [
      "followup-dashboard",
      "followup-applications",
      "followup-bookings",
      "followup-agreements",
      "followup-demands",
    ],
    engineering: [
      "engineering-dashboard",
      "boq",
      "engineering-work-order",
      "work-done",
      "dpr",
    ],
    ticket: ["ticket-dashboard", "tickets"],
    sales: ["sale-order", "sale-invoice", "sales-payment"],
    salesAutomation: ["sa-leads", "sa-inquiry", "sa-site-visits", "sa-campaigns", "sa-ads"],
    civilworkdpr: [
      "civilworkdpr-dashboard",
      "civilworkdpr-dependency",
      "civilworkdpr-worker-attendance",
    ],
    crm: [
      "crm-dashboard",
      "crm-customers",
      "crm-applications",
      "crm-bookings",
      "crm-payments",
    ],
    fixedasset: [
      "fixed-asset-record",
      "fixed-asset-tagging",
      "fixed-asset-assignment",
      "asset-transfer",
      "fixed-asset-quality-check",
      "fixed-asset-maintenance",
    ],
  };

  const hasModuleAccess = (moduleId: string): boolean => {
    if (privileged) return true;
    return (MODULE_PAGES[moduleId] ?? []).some((pk) =>
      canAccessPage(pk as any),
    );
  };

  const access = {
    finance: hasModuleAccess("finance"),
    material: hasModuleAccess("material"),
    engineering: hasModuleAccess("engineering"),
    followup: hasModuleAccess("followup"),
    ticket: hasModuleAccess("ticket"),
    sales: hasModuleAccess("sales"),
    salesAutomation: hasModuleAccess("salesAutomation"),
    civilworkdpr: hasModuleAccess("civilworkdpr"),
    crm: hasModuleAccess("crm"),
    fixedasset: hasModuleAccess("fixedasset"),
    approvals: privileged,
    admin: privileged && !isDba,
    dba: isDba,
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<HomeDashboardData>({
      // Include access flags in key so the query refires when permissions change
      queryKey: [
        "home-dashboard",
        role,
        access.finance,
        access.material,
        access.engineering,
      ],
      queryFn: () => fetchHomeDashboard(isAdmin, access),
      staleTime: 2 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      retry: 2,
    });

  // Real project list for the "Project Network" panel — /api/project-master
  // has no engineering permission gate (same reason fetchHomeDashboard
  // itself uses it for the active-project-count fallback), so every role
  // that reaches Home can resolve real project names for the map's nodes.
  const { data: projectListData } = useQuery({
    queryKey: ["home-project-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/project-master");
      if (!res.ok) throw new Error("Failed to fetch project list");
      return res.json().catch(() => []);
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
  const projectList: { id: number; name: string; active: boolean }[] = (() => {
    const raw = Array.isArray(projectListData)
      ? projectListData
      : Array.isArray((projectListData as any)?.data)
        ? (projectListData as any).data
        : [];
    return raw.map((p: any) => ({
      id: p.Id ?? p.id,
      name: p.Name ?? p.name ?? `Project #${p.Id ?? p.id}`,
      active: p.IsActive === 1 || p.IsActive === true,
    }));
  })();

  // Civil Work DPR isn't part of the main home-dashboard aggregator yet —
  // it has its own lightweight stats endpoint, so the tile queries that
  // directly instead of growing the shared backend aggregation.
  const { data: civilDpr } = useQuery({
    queryKey: ["home-civilworkdpr"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch Civil Work DPR stats");
      return res.json().catch(() => ({}));
    },
    enabled: access.civilworkdpr,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // CRM dashboard stats
  const { data: crmData } = useQuery({
    queryKey: ["home-crm"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/dashboard");
      if (!res.ok) throw new Error("CRM stats unavailable");
      return res.json().catch(() => ({}));
    },
    enabled: access.crm,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Universal recent-activity feed (server-side UNION across every module) ──
  const feedModules = privileged
    ? ""
    : Object.entries(access)
        .filter(([, v]) => v)
        .map(([k]) => (k === "approvals" ? "" : k))
        .filter(Boolean)
        .join(",");
  const { data: liveFeed } = useQuery<{ items: LiveActivityItem[] }>({
    queryKey: ["home-activity-feed", feedModules],
    queryFn: async () => {
      const qs = feedModules ? `?modules=${encodeURIComponent(feedModules)}&limit=50` : "?limit=50";
      const res = await fetchWithAuth(`/api/home/activity-feed${qs}`);
      if (!res.ok) throw new Error("activity feed unavailable");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    retry: 1,
  });

  const fin  = data?.finance;
  const mat  = data?.material;
  const adm  = data?.admin;
  const tick = data?.tickets;
  const eng  = data?.engineering;
  const fol  = data?.followup;
  const sal  = data?.sales;
  const pendingApprovals = data?.pendingApprovals ?? [];

  // Derive handy CRM scalars from the grouped recordsets
  const crmBookings     = (crmData?.bookings     ?? []) as { Status: string; Count: number; TotalValue: number }[];
  const crmApps         = (crmData?.applications ?? []) as { Status: string; Count: number }[];
  const crmTickets      = (crmData?.serviceTickets ?? []) as { Status: string; Count: number }[];
  const crmConfirmed    = crmBookings.find(b => b.Status === "Confirmed")?.Count ?? 0;
  const crmTotalBookings = crmBookings.reduce((s, b) => s + b.Count, 0);
  const crmPendingApps  = crmApps.find(a => a.Status === "Pending")?.Count ?? 0;
  const crmOpenTickets  = crmTickets.filter(t => t.Status !== "Closed" && t.Status !== "Resolved").reduce((s, t) => s + t.Count, 0);
  const crmOverdue      = crmData?.payments?.OverdueCount ?? 0;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ── Actionable insights — "needs your attention" ─────────────────────────
  type Sev = "high" | "med" | "low";
  const rawAttn: Array<Attention | false> = [
    access.approvals && { severity: "high" as Sev, label: "Approvals awaiting you", count: pendingApprovals.length, hint: `${new Set(pendingApprovals.map((a: ApprovalInboxItem) => a.Module)).size} module(s) affected`, href: "/admin/approval/inbox", icon: FileCheck },
    access.followup && { severity: "high" as Sev, label: "Follow-ups overdue", count: fol?.overdue ?? 0, hint: "Past their due date", href: "/followup", icon: Table },
    access.ticket && { severity: "high" as Sev, label: "Urgent tickets open", count: tick?.urgent ?? 0, hint: "High-priority, unresolved", href: "/ticket", icon: TriangleAlert },
    access.crm && { severity: "high" as Sev, label: "CRM payments overdue", count: crmOverdue, hint: "Milestones past due", href: "/crm/dashboard", icon: IndianRupee },
    access.sales && { severity: "med" as Sev, label: "Sale orders pending approval", count: sal?.pendingApproval ?? 0, hint: "Waiting in the approval queue", href: "/sales/sale-order", icon: ShoppingCart },
    access.engineering && { severity: "med" as Sev, label: "Work done pending certification", count: eng?.workDone?.pending ?? 0, hint: "Awaiting engineer sign-off", href: "/engineering", icon: Hammer },
    access.civilworkdpr && { severity: "med" as Sev, label: "DPR entries pending review", count: civilDpr?.progress?.pendingReviewCount ?? 0, hint: "Daily progress awaiting review", href: "/civilworkdpr", icon: Pickaxe },
    access.followup && { severity: "med" as Sev, label: "Follow-ups due today", count: fol?.dueToday ?? 0, hint: "Scheduled for today", href: "/followup", icon: Table },
    access.crm && { severity: "med" as Sev, label: "CRM applications pending", count: crmPendingApps, hint: "Not yet processed", href: "/crm/dashboard", icon: HeartHandshake },
    access.ticket && { severity: "low" as Sev, label: "Tickets open", count: (tick?.pending ?? 0) + (tick?.inProgress ?? 0), hint: "Pending + in progress", href: "/ticket", icon: Ticket },
    access.material && { severity: "low" as Sev, label: "Purchase orders open", count: mat?.purchaseOrders?.open ?? 0, hint: "Not yet closed / cancelled", href: "/material/purchase-order", icon: Package },
  ];
  const sevRank: Record<Sev, number> = { high: 0, med: 1, low: 2 };
  const attention: Attention[] = (rawAttn.filter(Boolean) as Attention[])
    .filter((a) => a.count > 0)
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.count - a.count);

  // ── KPI pills (wrap → scale with module count) ───────────────────────────
  const kpis = [
    access.finance && { label: "Transferred all-time", value: isLoading ? null : ((fin?.payments?.totalAmount ?? 0) / 1e7).toFixed(2), prefix: "₹", suffix: "Cr", color: "#10b981", icon: IndianRupee },
    (access.material || access.finance) && { label: "Open PO value", value: isLoading ? null : Math.round((mat?.purchaseOrders?.openValue ?? fin?.purchaseOrders?.openValue ?? 0) / 100000), prefix: "₹", suffix: "L", color: "#f59e0b", icon: Layers },
    access.material && { label: "GRNs this month", value: isLoading ? null : (mat?.grns?.thisMonth ?? 0), color: "#8b5cf6", icon: Warehouse },
    { label: "Active projects", value: isLoading ? null : (eng?.projects?.active ?? 0), color: "#06b6d4", icon: Building2 },
    access.finance && { label: "Active suppliers", value: isLoading ? null : (fin?.parties?.activeSupplierCount ?? 0), color: "#3b82f6", icon: Building2 },
    access.sales && { label: "Sales this month", value: isLoading ? null : (() => { const a = sal?.thisMonthAmount ?? 0; return a >= 1e5 ? Math.round(a / 1e5) : a; })(), prefix: "₹", suffix: (sal?.thisMonthAmount ?? 0) >= 1e5 ? "L" : "", color: "#7c3aed", icon: TrendingUp },
    access.crm && { label: "Total bookings", value: isLoading ? null : crmTotalBookings, color: "#e11d48", icon: HeartHandshake },
    access.ticket && { label: "Resolution rate", value: isLoading ? null : `${tick?.resolvedPct ?? 0}%`, color: "#0d9488", icon: CheckCircle2 },
    (access.admin || access.dba) && { label: "Active users", value: isLoading ? null : (adm?.stats?.activeUsers ?? 0), color: "#a855f7", icon: Users },
    access.engineering && { label: "Open work orders", value: isLoading ? null : (eng?.workOrders?.open ?? 0), color: "#ec4899", icon: Hammer },
  ].filter(Boolean) as Array<{ label: string; value: number | string | null; prefix?: string; suffix?: string; color: string; icon: React.ElementType }>;

  const feedItems: LiveActivityItem[] = liveFeed?.items ?? [];

  // ── Last-7-days activity series — bucketed from the same universal feed
  // the "Live activity" list already renders, so the bar/area charts show
  // genuinely real counts/values instead of an invented time series.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const byDay = new Map<string, { count: number; amount: number }>();
  last7Days.forEach((d) => byDay.set(dayKey(d), { count: 0, amount: 0 }));
  feedItems.forEach((it) => {
    const k = dayKey(new Date(it.At));
    const bucket = byDay.get(k);
    if (bucket) {
      bucket.count += 1;
      bucket.amount += it.Amount ?? 0;
    }
  });
  const activitySeries = last7Days.map((d) => {
    const b = byDay.get(dayKey(d))!;
    return { day: d.toLocaleDateString("en-IN", { weekday: "short" }), count: b.count, amount: Math.round(b.amount) };
  });

  // ── Work Order completion — the one genuinely percentage-shaped metric
  // available, given the hero gauge (mirrors "Profit Analysis" in the
  // reference layout).
  const woTotal = eng?.workOrders?.total ?? 0;
  const woOpen = eng?.workOrders?.open ?? 0;
  const woCompletionPct = woTotal > 0 ? Math.round(((woTotal - woOpen) / woTotal) * 100) : 0;

  // Always show at least something
  const hasAnyAccess = Object.values(access).some(Boolean);

  const heroKpis = kpis.slice(0, 4);
  const restKpis = kpis.slice(4);
  const chartTooltipStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    fontSize: 11,
    padding: "8px 10px",
  } as const;

  // Explicit, clean ticks for both charts — see niceTicks' comment.
  const countTicks = niceTicks(Math.max(...activitySeries.map((d) => d.count), 1), 4);
  const amountTicks = niceTicks(Math.max(...activitySeries.map((d) => d.amount), 1), 4);

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] bg-background overflow-hidden font-body">
      <BgGrid />

      <div className="relative z-10 w-full px-4 sm:px-6 md:px-8 lg:px-10 xl:px-14 2xl:px-20 py-5 sm:py-6">
        {/* ── Header — full-width, no side rail. A small utility strip
            (brand/live/refresh) on top, the greeting back at its original
            large size on its own line below it. ── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2"
        >
          <HardHat size={14} className="text-primary/70 shrink-0" />
          <span className="font-heading text-[10px] font-bold uppercase tracking-[0.24em] text-primary/55 shrink-0">
            CivilierERP
          </span>
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {lastUpdated && (
              <span className="text-[10px] text-muted-foreground/35 font-mono tabular-nums hidden sm:inline">
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="group p-1.5 rounded-lg hover:bg-muted/50 transition-all duration-200 active:scale-90 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw
                size={13}
                className={`text-muted-foreground/40 transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
              />
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-10 sm:mb-12"
        >
          <h1 className="font-heading font-bold text-4xl sm:text-5xl md:text-[4rem] 2xl:text-[4.5rem] tracking-tight leading-[1.06] text-foreground break-words">
            {greeting}, <span className="bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent">{firstName}.</span>
          </h1>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-heading font-semibold uppercase tracking-wider border shrink-0"
            style={{
              background: privileged ? "hsl(var(--primary)/0.08)" : "hsl(var(--muted)/0.5)",
              borderColor: privileged ? "hsl(var(--primary)/0.25)" : "hsl(var(--border))",
              color: privileged ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
            }}
          >
            {privileged ? <ShieldCheck size={10} /> : <Users size={10} />}
            {role.replace(/_/g, " ")}
          </span>
        </motion.div>

        {isError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive max-w-sm"
          >
            <AlertCircle size={13} className="shrink-0" />
            <span className="text-xs">Could not reach the server — showing cached data.</span>
          </motion.div>
        )}

        {!hasAnyAccess ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl border border-border/40 bg-card/40 p-10 text-center max-w-lg mx-auto"
          >
            <ShieldCheck size={28} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground/60">No module access assigned.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Contact your administrator to get module permissions.</p>
          </motion.div>
        ) : (
          // key tied to dataUpdatedAt so the whole subtree remounts on every
          // reload (initial load, manual refresh, or the 5-minute
          // auto-refetch) — every tile's entrance animation (Bento's own
          // fade+rise, StatCard's sparkline/counter) replays each time,
          // not just once on first mount.
          <div key={dataUpdatedAt || "initial"} className="space-y-4">
            {/* ── Hero stat cards ── */}
            {heroKpis.length > 0 && (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {heroKpis.map((k, i) => (
                  <StatCard
                    key={k.label}
                    icon={k.icon}
                    label={k.label}
                    value={k.value}
                    prefix={k.prefix}
                    suffix={k.suffix}
                    color={k.color}
                    sparkline={activitySeries.map((d) => d.count)}
                    i={i}
                  />
                ))}
              </div>
            )}

            {/* ── Charts row: activity volume, activity value, WO completion gauge ── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Bento
                title="Actions This Week"
                subtitle="Documents & transactions created, per day, across every module"
                icon={BarChart3}
                accent="#7c3aed"
                className="xl:col-span-1 min-h-[240px]"
                delay={0.15}
              >
                <div className="p-3 h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activitySeries} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="homeActionsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a78bfa" />
                          <stop offset="100%" stopColor="#6d28d9" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={6} />
                      <YAxis
                        domain={[0, countTicks[countTicks.length - 1]]}
                        ticks={countTicks}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => [`${v} action${v === 1 ? "" : "s"}`, "Logged"]}
                      />
                      <Bar dataKey="count" name="Actions" radius={[6, 6, 2, 2]} fill="url(#homeActionsFill)" maxBarSize={28}>
                        {activitySeries.map((d, i) => (
                          <Cell key={i} opacity={d.count > 0 ? 1 : 0.25} />
                        ))}
                        <LabelList
                          dataKey="count"
                          position="top"
                          formatter={(v: number) => (v > 0 ? v : "")}
                          style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Bento>

              <Bento
                title="Transaction Value This Week"
                subtitle="Rupee value behind those same actions, per day"
                icon={LineChart}
                accent="#06b6d4"
                className="xl:col-span-1 min-h-[240px]"
                delay={0.2}
              >
                <div className="p-3 h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="homeValueFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} dy={6} />
                      <YAxis
                        domain={[0, amountTicks[amountTicks.length - 1]]}
                        ticks={amountTicks}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => compactINR(v)}
                        width={52}
                      />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [compactINR(v), "Value"]} labelStyle={{ color: "hsl(var(--foreground))" }} />
                      <Area type="monotone" dataKey="amount" name="Value" stroke="#06b6d4" strokeWidth={2} fill="url(#homeValueFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Bento>

              <Bento title="Work Order Completion" icon={Hammer} accent="#7c3aed" className="xl:col-span-1 min-h-[240px]" delay={0.25}>
                <div className="flex flex-col items-center justify-center gap-4 p-4 h-[210px]">
                  <CircularGauge pct={woCompletionPct} />
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Completed</span>
                      <span className="font-heading font-semibold tabular-nums text-foreground">{(woTotal - woOpen).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${woCompletionPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Open</span>
                      <span className="font-heading font-semibold tabular-nums text-foreground">{woOpen.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
              </Bento>
            </div>

            {/* ── Project Network (map-style panel) + remaining key numbers ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <Bento title="Project Network" icon={Building2} accent="#7c3aed" className="lg:col-span-2" delay={0.3}>
                <ProjectNetworkMap projects={projectList} total={eng?.projects?.total ?? projectList.length} />
              </Bento>

              <Bento title="More key numbers" icon={Database} accent="#6366f1" delay={0.35}>
                {restKpis.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-muted-foreground/40">Nothing else to show.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 p-3">
                    {restKpis.map((k, i) => (
                      <KpiPill key={k.label} label={k.label} value={k.value} prefix={k.prefix} suffix={k.suffix} color={k.color} icon={k.icon} i={i} />
                    ))}
                  </div>
                )}
              </Bento>
            </div>

            {/* ── Needs attention — full width ── */}
            <div>
              <Bento
                title={`Needs your attention${attention.length ? ` · ${attention.length}` : ""}`}
                icon={Bell}
                accent="#ef4444"
                delay={0.4}
              >
                {isLoading ? (
                  <div className="px-4 py-6 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-7 h-7 rounded-lg bg-muted shrink-0" />
                        <div className="flex-1 space-y-1.5"><div className="h-3 bg-muted rounded w-2/3" /><div className="h-2 bg-muted rounded w-1/3" /></div>
                      </div>
                    ))}
                  </div>
                ) : attention.length === 0 ? (
                  <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/12 flex items-center justify-center">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">All clear</p>
                    <p className="text-[11px] text-muted-foreground/50">Nothing needs your action right now.</p>
                  </div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto">
                    {attention.slice(0, 10).map((a, i) => (
                      <AttentionRow key={a.label} a={a} i={i} onGo={navigate} />
                    ))}
                  </div>
                )}
              </Bento>
            </div>

            {/* ── Recent Activity — full-width table, universal feed ── */}
            <Bento
              title="Recent Activity"
              icon={Activity}
              accent="#7c3aed"
              delay={0.45}
              action={
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <button onClick={() => refetch()} disabled={isFetching} className="p-1 rounded hover:bg-muted/50 disabled:opacity-40">
                    <RefreshCw size={11} className={`text-muted-foreground/40 ${isFetching ? "animate-spin" : ""}`} />
                  </button>
                </div>
              }
            >
              {feedItems.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-muted-foreground/40">
                  {isLoading ? "Loading activity…" : "No recent activity."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground/60 uppercase tracking-wide text-[10px] font-heading">
                        <th className="text-left px-4 py-2.5 font-semibold">Module</th>
                        <th className="text-left px-3 py-2.5 font-semibold">Item</th>
                        <th className="text-left px-3 py-2.5 font-semibold">By</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Amount</th>
                        <th className="text-right px-4 py-2.5 font-semibold">When</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/25">
                      {feedItems.slice(0, 8).map((it, i) => {
                        const m = moduleMeta(it.Module);
                        return (
                          <tr
                            key={`${it.Kind}-${it.DocNo ?? i}-${it.At}`}
                            onClick={() => navigate(it.Href)}
                            className="cursor-pointer hover:bg-muted/25 transition-colors"
                          >
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: `${m.color}16`, color: m.color }}>
                                <m.icon size={10} /> {m.label}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 max-w-[280px]">
                              <p className="font-semibold text-foreground truncate">{it.Title}</p>
                              {it.Subtitle && <p className="text-[10px] text-muted-foreground/50 truncate">{it.Subtitle}</p>}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[140px]">{it.Actor ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-heading font-semibold" style={{ color: it.Amount ? m.color : undefined }}>
                              {it.Amount != null && it.Amount > 0 ? compactINR(it.Amount) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground/50 font-mono tabular-nums whitespace-nowrap">{relTime(it.At)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Bento>

            {/* ── Approval Inbox (privileged) or My Tasks — full-width table ── */}
            {access.approvals ? (
              <Bento title="Approval Inbox" icon={FileCheck} accent="#f59e0b" delay={0.5}>
                {pendingApprovals.length === 0 ? (
                  <div className="px-4 py-12 text-center text-xs text-muted-foreground/40">
                    {isLoading ? "Loading…" : "Nothing waiting on approval."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr className="border-b border-border/40 text-muted-foreground/60 uppercase tracking-wide text-[10px] font-heading">
                          <th className="text-left px-4 py-2.5 font-semibold">Module</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Reference</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Date</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/25">
                        {pendingApprovals.slice(0, 8).map((a, i) => (
                          <tr key={`${a.Module}-${a.RecordId}-${i}`} onClick={() => navigate("/admin/approval/inbox")} className="cursor-pointer hover:bg-muted/25 transition-colors">
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground font-medium">{a.ModuleLabel}</td>
                            <td className="px-3 py-2.5 font-mono text-muted-foreground">{a.Reference}</td>
                            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{a.RecordDate ? new Date(a.RecordDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/12 text-amber-600">{a.Status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-heading font-semibold text-foreground">
                              {a.Amount != null ? compactINR(a.Amount) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Bento>
            ) : data?.recentTasks && data.recentTasks.length > 0 ? (
              <Bento title="My Tasks" icon={ClipboardList} accent="#f59e0b" delay={0.5}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground/60 uppercase tracking-wide text-[10px] font-heading">
                        <th className="text-left px-4 py-2.5 font-semibold">Task</th>
                        <th className="text-left px-3 py-2.5 font-semibold">Priority</th>
                        <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/25">
                      {data.recentTasks.slice(0, 8).map((t) => (
                        <tr key={t.id} className="hover:bg-muted/25 transition-colors">
                          <td className="px-4 py-2.5 text-foreground font-medium max-w-[280px] truncate">{t.title}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{t.priority}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{t.status}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">{t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Bento>
            ) : null}
          </div>
        )}

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="mt-8 flex flex-col items-center gap-1.5"
        >
          <div className="flex items-center gap-3 text-muted-foreground/25 text-[10px] font-heading tracking-widest uppercase">
            <div className="w-10 h-px bg-border/40" />
            <span>Civilier ERP · {new Date().getFullYear()}</span>
            <div className="w-10 h-px bg-border/40" />
          </div>
          <span className="text-[9px] font-heading tracking-[0.2em] uppercase text-muted-foreground/20">
            crafted by Rajwada Infotech
          </span>
        </motion.div>
      </div>
    </div>
  );
}
