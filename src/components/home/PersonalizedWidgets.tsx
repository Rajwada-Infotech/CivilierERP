import { useEffect, useMemo } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getHomeWidgets } from "@/api/homeWidgetsApi";
import {
  getWidgetMetric,
  type WidgetMetricBreakdown,
  type WidgetMetricData,
  type WidgetMetricDef,
  type WidgetMetricStat,
  type WidgetMetricTimeseries,
} from "@/api/widgetsApi";

const MODULE_COLORS: Record<string, string> = {
  Finance: "#6366f1",
  Material: "#10b981",
  Engineering: "#f97316",
  CRM: "#a855f7",
};

const EASE = [0.22, 1, 0.36, 1] as const;

const fmtCount = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtCurrency = (n: number) =>
  `₹${new Intl.NumberFormat("en-IN", {
    notation: Math.abs(n) >= 100000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) >= 100000 ? 2 : 0,
  }).format(n)}`;
const fmtUnit = (unit: string, n: number) => (unit === "currency" ? fmtCurrency(n) : fmtCount(n));

function AnimatedNumber({ value, unit }: { value: number; unit: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => fmtUnit(unit, Math.round(v)));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1.1, ease: EASE });
    return () => controls.stop();
  }, [value, reduce, mv]);
  return <motion.span>{text}</motion.span>;
}

function StatBody({ data, color }: { data: WidgetMetricStat; color: string }) {
  return (
    <div className="flex flex-col justify-end h-full pt-2">
      <p className="text-3xl font-heading font-bold tracking-tight" style={{ color }}>
        <AnimatedNumber value={data.value} unit={data.unit} />
      </p>
    </div>
  );
}

const W = 240;
const H = 84;
const PAD = 6;

function TimeseriesBody({ data, color }: { data: WidgetMetricTimeseries; color: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.series.flatMap((s) => s.data));
  const n = Math.max(2, data.labels.length);
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (n - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const total = data.series[0]?.data.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-lg font-heading font-bold" style={{ color }}>
        <AnimatedNumber value={total} unit={data.unit} />
        <span className="ml-1.5 text-[0.625rem] font-medium text-muted-foreground">last 14 days</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[84px] overflow-visible" role="img" aria-label={data.label}>
        {data.series.map((s, si) => {
          const line = s.data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
          const area = `${line} L${x(s.data.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`;
          const c = s.color || color;
          return (
            <g key={s.name}>
              {si === 0 && (
                <motion.path
                  d={area}
                  fill={c}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.14 }}
                  transition={{ duration: reduce ? 0 : 0.9, delay: reduce ? 0 : 0.5 }}
                />
              )}
              <motion.path
                d={line}
                fill="none"
                stroke={c}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: reduce ? 0 : 1.3, ease: EASE }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BreakdownBody({ data }: { data: WidgetMetricBreakdown }) {
  const reduce = useReducedMotion();
  const total = data.slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
        {data.slices.map((s, i) => (
          <motion.div
            key={s.name}
            style={{ background: s.color }}
            initial={{ width: 0 }}
            animate={{ width: `${(s.value / total) * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.9, delay: reduce ? 0 : 0.15 + i * 0.08, ease: EASE }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {data.slices.slice(0, 6).map((s, i) => (
          <motion.li
            key={s.name}
            className="flex items-center gap-1.5 text-[0.6875rem] min-w-0"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : 0.4 + i * 0.05 }}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="truncate text-muted-foreground">{s.name}</span>
            <span className="ml-auto font-semibold text-foreground">{fmtCount(s.value)}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2.5 pt-1">
      <div className="h-7 w-2/5 rounded-md bg-muted/60 animate-pulse" />
      <div className="h-14 w-full rounded-md bg-muted/40 animate-pulse" />
    </div>
  );
}

function WidgetCard({ def, index }: { def: WidgetMetricDef; index: number }) {
  const reduce = useReducedMotion();
  const color = MODULE_COLORS[def.module] ?? "#3b82f6";
  const { data, isLoading, isError } = useQuery<WidgetMetricData>({
    queryKey: ["widget-metric", def.key],
    queryFn: () => getWidgetMetric(def.key),
    staleTime: 60_000,
  });

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, y: 22, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay: reduce ? 0 : index * 0.07 }}
      whileHover={reduce ? undefined : { y: -3 }}
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-4 flex flex-col gap-2 min-h-[150px]"
      style={{ boxShadow: `0 6px 24px ${color}12` }}
    >
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full" style={{ background: color }} />
      <div
        className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-20"
        style={{ background: color }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-heading font-semibold text-foreground truncate">{def.label}</p>
        <span
          className="shrink-0 text-[0.5625rem] font-heading font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{ color, background: `${color}18` }}
        >
          {def.module}
        </span>
      </div>
      <div className="relative flex-1">
        {isLoading ? (
          <Skeleton />
        ) : isError || !data ? (
          <p className="text-xs text-muted-foreground">Couldn't load this widget.</p>
        ) : data.type === "stat" ? (
          <StatBody data={data} color={color} />
        ) : data.type === "timeseries" ? (
          <TimeseriesBody data={data} color={color} />
        ) : (
          <BreakdownBody data={data} />
        )}
      </div>
    </motion.div>
  );
}

interface Access {
  finance: boolean;
  material: boolean;
  engineering: boolean;
  crm: boolean;
}

// The widgets for the modules this user works in most and most recently.
// A new user, with no history yet, sees a starter set from the modules they
// can open; the section reshuffles itself as their usage builds up.
export function PersonalizedWidgets({ access }: { access: Access }) {
  const reduce = useReducedMotion();
  const allowed = useMemo(
    () =>
      [
        access.finance && "Finance",
        access.material && "Material",
        access.engineering && "Engineering",
        access.crm && "CRM",
      ].filter(Boolean) as string[],
    [access.finance, access.material, access.engineering, access.crm],
  );

  const { data } = useQuery({
    queryKey: ["home-widgets", allowed.join(",")],
    queryFn: () => getHomeWidgets(allowed),
    enabled: allowed.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  if (!data || data.widgets.length === 0) return null;

  return (
    <section aria-label="Your widgets" className="space-y-3">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-wrap items-center gap-2"
      >
        <Sparkles size={14} className="text-primary" />
        <h2 className="text-sm font-heading font-bold text-foreground">Your widgets</h2>
        <span className="text-xs text-muted-foreground">
          {data.personalized
            ? "from the modules you work in most"
            : "a starter set — it tailors itself as you use the app"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {data.modules.slice(0, 4).map((m) => (
            <span
              key={m.module}
              className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: MODULE_COLORS[m.module] ?? "#3b82f6" }} />
              {m.module}
            </span>
          ))}
        </div>
      </motion.div>

      <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {data.widgets.map((w, i) => (
            <WidgetCard key={w.key} def={w} index={i} />
          ))}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
