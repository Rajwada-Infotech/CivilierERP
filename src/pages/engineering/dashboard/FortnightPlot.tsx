import { useState } from "react";
import { fmt, short } from "./shared";

/** Work order value raised against work done certified, day by day for fourteen days: work orders solid, work done hatched. */
export function FortnightPlot({ rows }: { rows: { date: string; workOrders: number; workDone: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 230, pad = 8, top = 24, base = 188;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.flatMap((r) => [r.workOrders, r.workDone]));
  const w = Math.min(14, slot * 0.3);
  const cx = (i: number) => pad + slot * i + slot / 2;
  const active = hover != null ? rows[hover] : null;
  const day = (d: string) => new Date(`${d}T00:00:00`);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Work orders raised
        </span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i className="hatch" style={{ width: 10, height: 10, border: "1px solid var(--ink)", display: "inline-block" }} /> Work done certified
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active
            ? `${day(active.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · raised ${fmt(active.workOrders)} · certified ${fmt(active.workDone)}`
            : "Hover a day for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Work order and work done value each day, last fourteen days" onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="eng-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" strokeWidth="1.2" />
          </pattern>
        </defs>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{short(max)}</text>
        {rows.map((r, i) => {
          const on = hover == null || hover === i;
          const ho = (r.workOrders / max) * (base - top);
          const hd = (r.workDone / max) * (base - top);
          const d = day(r.date);
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              {r.workOrders > 0 && <rect x={cx(i) - w - 1} y={base - ho} width={w} height={ho} fill="var(--blue)" fillOpacity={on ? 0.92 : 0.4} />}
              {r.workDone > 0 && (
                <rect x={cx(i) + 1} y={base - hd} width={w} height={hd} fill="url(#eng-hatch)" stroke="var(--ink)" strokeWidth="1" opacity={on ? 1 : 0.4} />
              )}
              {r.workOrders === 0 && r.workDone === 0 && (
                <text x={cx(i)} y={base - 6} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--faint)">—</text>
              )}
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{d.getDate()}</text>
              {(i === 0 || d.getDate() === 1) && (
                <text x={cx(i)} y={base + 30} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="8" letterSpacing="1" fill="var(--faint)">
                  {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
