import React from "react";

// The parts of a working page drawn the way the other dashboards draw them: ruled figures in place of icon tiles, and a
// section heading with its letter and rule. Colours are the sheet's only: ink, blue, red and graphite.
// The same keys as the other sheet pages. Add the size where used: h-9 px-4 for a page's own actions, h-8 px-3 inside a row.
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground hover:bg-foreground/90`;
export const KEY_LINE = `${KEY} bg-card border border-foreground text-foreground hover:bg-primary/10`;
export const KEY_RED = `${KEY} bg-card border border-destructive text-destructive hover:bg-destructive/10`;
export const KEY_RED_SOLID = `${KEY} bg-destructive text-white border border-destructive hover:bg-destructive/90`;

export const TONE = {
  ink: "hsl(var(--foreground))",
  blue: "hsl(var(--primary))",
  red: "hsl(var(--destructive))",
  graphite: "hsl(var(--muted-foreground))",
};

export const PRIORITY_TONES: Record<string, string> = { "Very Important": TONE.red, Important: TONE.ink, Normal: TONE.blue };
export const STATUS_TONES: Record<string, string> = { Active: TONE.blue, Hold: TONE.graphite, Cancel: TONE.red, Closed: TONE.ink };
/** For charts with many categories (users, tags): steps of the sheet's ink and blue. */
export const SERIES_TONES = [
  TONE.ink,
  TONE.blue,
  "hsl(var(--foreground) / 0.6)",
  "hsl(var(--primary) / 0.6)",
  "hsl(var(--foreground) / 0.35)",
  "hsl(var(--primary) / 0.35)",
  "hsl(var(--foreground) / 0.18)",
  "hsl(var(--primary) / 0.18)",
];

export interface SheetStat {
  label: string;
  value: React.ReactNode;
  /** Written in red: something needs attention. */
  red?: boolean;
  /** A small line under the figure. */
  note?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

const COLUMNS: Record<number, string> = { 4: "four", 5: "five", 6: "six", 7: "seven" };

export const SheetStats: React.FC<{ items: SheetStat[]; loading?: boolean }> = ({ items, loading }) => (
  <div className={`statrow ${COLUMNS[items.length] || ""}`}>
    {items.map((s) => {
      const color = s.red ? "var(--red)" : undefined;
      const body = (
        <>
          <p className="label" style={{ color: s.active ? "var(--ink)" : color }}>{s.label}</p>
          <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color }}>{loading ? "…" : s.value}</p>
          {s.note && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{s.note}</p>}
          {s.onClick && <span style={{ display: "block", height: 2, marginTop: 8, background: s.active ? "var(--ink)" : "transparent" }} />}
        </>
      );
      return (
        <div key={s.label}>
          {s.onClick ? (
            <button type="button" onClick={s.onClick} aria-pressed={s.active} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              {body}
            </button>
          ) : body}
        </div>
      );
    })}
  </div>
);

export const SheetSection: React.FC<{ tag?: string; title: string; note?: React.ReactNode; children: React.ReactNode }> = ({ tag, title, note, children }) => (
  <section>
    <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      {tag && <span className="tag">{tag}</span>}
      <h2 className="label" style={{ color: "var(--ink)", margin: 0 }}>{title}</h2>
      <span style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      {note && <span className="label">{note}</span>}
    </header>
    {children}
  </section>
);
