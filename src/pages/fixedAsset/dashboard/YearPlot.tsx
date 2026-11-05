import { useState } from "react";
import { fmt, monthName, short } from "./shared";

/** Depreciation charged each month, the last twelve months, oldest on the left. */
export function YearPlot({ months }: { months: { month: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, pad = 8, top = 24, base = 182;
  const n = Math.max(1, months.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...months.map((m) => m.amount));
  const w = Math.min(30, slot * 0.55);
  const cx = (i: number) => pad + slot * i + slot / 2;
  const active = hover != null ? months[hover] : null;
  const total = months.reduce((s, m) => s + m.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Depreciation charged
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${monthName(active.month)} · ${fmt(active.amount)}` : `${fmt(total)} over the twelve months · hover a month`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Depreciation charged each month, last twelve months" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{short(max)}</text>
        {months.map((m, i) => {
          const h = (m.amount / max) * (base - top);
          const on = hover == null || hover === i;
          const d = new Date(`${m.month}-01T00:00:00`);
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              {m.amount > 0 ? (
                <rect x={cx(i) - w / 2} y={base - h} width={w} height={h} fill="var(--blue)" fillOpacity={on ? 0.92 : 0.4} />
              ) : (
                <text x={cx(i)} y={base - 6} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--faint)">—</text>
              )}
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>
                {d.toLocaleDateString("en-IN", { month: "short" })}
              </text>
              {(i === 0 || d.getMonth() === 0) && (
                <text x={cx(i)} y={base + 30} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="8" letterSpacing="1" fill="var(--faint)">{d.getFullYear()}</text>
              )}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
