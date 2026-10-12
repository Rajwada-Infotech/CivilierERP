import React from "react";

// The "drawing sheet" look shared by the Home screen and the CRM dashboard: one bordered sheet on a faint grid, a title
// block, lettered details, dimension lines and hatching. Colours and fonts come from the app theme.

// ── The sheet's own styles ──────────────────────────────────────────────────
const SHEET_BASE = `
.crm-sheet {
  --sheet: hsl(var(--card));
  --ink: hsl(var(--foreground));
  --ink-2: hsl(var(--foreground) / 0.78);
  --graphite: hsl(var(--muted-foreground));
  --faint: hsl(var(--muted-foreground) / 0.6);
  --rule: hsl(var(--border));
  --rule-soft: hsl(var(--border) / 0.55);
  --blue: hsl(var(--primary));
  --blue-mid: hsl(var(--primary) / 0.55);
  --blue-wash: hsl(var(--primary) / 0.10);
  --blue-tint: hsl(var(--primary) / 0.18);
  --red: hsl(var(--destructive));
  --red-wash: hsl(var(--destructive) / 0.10);
  --grid: hsl(var(--foreground) / 0.04);
  --hatch: hsl(var(--foreground) / 0.24);
  color: var(--ink);
  background-color: var(--sheet);
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  border: 1.5px solid var(--ink);
  outline: 1px solid var(--rule);
  outline-offset: 5px;
  font-family: "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
  margin: 6px;
}
.crm-sheet * { box-sizing: border-box; }
.crm-sheet .mono { font-family: "DM Sans", sans-serif; }
.crm-sheet .label {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--graphite);
}
.crm-sheet .figure { font-family: "Sora", sans-serif; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); line-height: 1; }
.crm-sheet .title { font-family: "Sora", sans-serif; font-weight: 700; letter-spacing: -0.03em; }
.crm-sheet .cell { border-top: 1px solid var(--rule); padding: 20px 22px 22px; min-width: 0; }
.crm-sheet .cell + .cell { border-left: 1px solid var(--rule); }
.crm-sheet .stack { display: flex; flex-direction: column; min-width: 0; }
.crm-sheet .stack > .cell + .cell { border-left: 0; flex: 1; }
.crm-sheet .stack + .cell { border-left: 1px solid var(--rule); }
.crm-sheet .tag {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid var(--ink); font-family: "Sora", sans-serif; font-size: 11px; font-weight: 600; color: var(--ink);
  background: var(--sheet); flex-shrink: 0;
}
.crm-sheet .hatch {
  background-image: repeating-linear-gradient(135deg, var(--hatch) 0, var(--hatch) 1px, transparent 1px, transparent 6px);
}
.crm-sheet .row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 56px; align-items: center; gap: 12px; width: 100%;
  padding: 9px 6px; border-bottom: 1px solid var(--rule-soft); transition: background-color .15s; }
.crm-sheet .row:hover { background: var(--blue-wash); }
.crm-sheet .row.hot:hover { background: var(--red-wash); }
.crm-sheet .link { border-bottom: 1px dashed var(--graphite); }
.crm-sheet .link:hover { color: var(--blue); border-bottom-color: var(--blue); }
.crm-sheet .grid2 { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); }
.crm-sheet .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.crm-sheet .num { text-align: right; padding-right: 0; white-space: nowrap; }
.crm-sheet .grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.crm-sheet .noscroll { scrollbar-width: none; -ms-overflow-style: none; }
.crm-sheet .noscroll::-webkit-scrollbar { display: none; }
.crm-sheet .seg { display: inline-flex; border: 1px solid var(--ink); }
.crm-sheet .seg button { padding: 5px 11px; font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--graphite); text-align: center; transition: background-color .15s, color .15s; }
.crm-sheet .seg button + button { border-left: 1px solid var(--ink); }
.crm-sheet .seg button:hover { color: var(--ink); background: var(--blue-wash); }
.crm-sheet .seg button.on { background: var(--ink); color: var(--sheet); }
.crm-sheet .skel { background: var(--rule-soft); border-radius: 2px; animation: crm-pulse 1.4s ease-in-out infinite; }
/* Entrance: the title block and each detail rise into place, one after another. */
@keyframes crm-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes crm-title { from { opacity: 0; transform: translateY(0.35em); } to { opacity: 1; transform: none; } }
@keyframes crm-rule { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.crm-sheet.sheet-in > * { animation: crm-rise .55s cubic-bezier(.2,.7,.2,1) both; }
.crm-sheet.sheet-in > *:nth-child(2) { animation-delay: .06s; }
.crm-sheet.sheet-in > *:nth-child(3) { animation-delay: .12s; }
.crm-sheet.sheet-in > *:nth-child(4) { animation-delay: .18s; }
.crm-sheet.sheet-in > *:nth-child(5) { animation-delay: .24s; }
.crm-sheet.sheet-in > *:nth-child(6) { animation-delay: .30s; }
.crm-sheet.sheet-in > *:nth-child(7) { animation-delay: .36s; }
.crm-sheet.sheet-in > *:nth-child(n+8) { animation-delay: .42s; }
.crm-sheet.sheet-in .title { animation: crm-title .8s cubic-bezier(.2,.7,.2,1) both; }
.crm-sheet.sheet-in .cell > header > span:nth-child(3) { transform-origin: left center; animation: crm-rule .9s .25s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
  .crm-sheet.sheet-in > *, .crm-sheet.sheet-in .title, .crm-sheet.sheet-in .cell > header > span:nth-child(3) { animation: none; }
}
@keyframes crm-pulse { 50% { opacity: .45; } }
@keyframes crm-draw { from { stroke-dashoffset: var(--len, 1200); } to { stroke-dashoffset: 0; } }
@keyframes crm-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.crm-sheet .grow { transform-origin: left center; animation: crm-grow .9s cubic-bezier(.2,.7,.2,1) both; }
.crm-sheet .draw { stroke-dasharray: var(--len, 1200); animation: crm-draw 1.4s ease-out both; }
@media (prefers-reduced-motion: reduce) { .crm-sheet .grow, .crm-sheet .draw, .crm-sheet .skel { animation: none; } }
@media (max-width: 720px) {
  .crm-sheet .titleblock { max-width: none !important; border-left: 0 !important; border-top: 1px solid var(--ink); }
  .crm-sheet .stages .label { font-size: 8.5px; letter-spacing: 0.04em; }
  .crm-sheet .stages .figure { font-size: 20px !important; }
}
@media (max-width: 1023px) {
  .crm-sheet .grid2, .crm-sheet .grid3 { grid-template-columns: minmax(0, 1fr); }
  .crm-sheet .grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .crm-sheet .cell + .cell, .crm-sheet .stack + .cell { border-left: 0; }
  .crm-sheet .cell { padding: 18px 16px 20px; }
}
`;

// Rules on bare elements (button, select, table). A full sheet page wants them; a page that only borrows the frame
// (its own form controls and tables inside) must not get them.
const SHEET_ELEMENTS = `
.crm-sheet button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.crm-sheet button:focus-visible, .crm-sheet select:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.crm-sheet select option { background: hsl(var(--card)); color: hsl(var(--foreground)); }
.crm-sheet select {
  font-family: "DM Sans", sans-serif; font-size: 13px; font-weight: 600; color: var(--ink); background: transparent; border: 0;
  padding: 0 14px 0 0; cursor: pointer; max-width: 100%;
}
.crm-sheet table { width: 100%; border-collapse: collapse; font-size: 13px; }
.crm-sheet th { text-align: left; padding: 0 10px 8px 0; border-bottom: 1px solid var(--ink); font-family: "Sora", sans-serif; font-weight: 600;
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--graphite); white-space: nowrap; }
.crm-sheet td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
.crm-sheet tbody tr.go { cursor: pointer; transition: background-color .15s; }
.crm-sheet tbody tr.go:hover { background: var(--blue-wash); }
`;

/** For a page drawn entirely on the sheet (Home, CRM and Finance dashboards): wrap it in `.crm-sheet`. */
export const SHEET_CSS = SHEET_BASE + SHEET_ELEMENTS;

/** For a working page that keeps its own controls: wrap it in `.sheet-frame` - same paper, rules, labels and figures,
 *  but no styling of bare buttons, selects or tables. */
export const SHEET_FRAME_CSS =
  // ".grow" is also a Tailwind utility a working page may use for layout, so the frame's bar animation gets its own name.
  SHEET_BASE.split(".crm-sheet").join(".sheet-frame").split(".sheet-frame .grow").join(".sheet-frame .bar-grow") +
  `
/* A working page keeps its own inputs, buttons and tables; the frame only squares them off and takes the glass away,
   so they sit on the sheet instead of floating over it. */
.sheet-frame [class*="rounded-"]:not(.rounded-full), .sheet-frame input, .sheet-frame select, .sheet-frame textarea, .sheet-frame button:not(.rounded-full) { border-radius: 0 !important; }
.sheet-frame .glass { background: hsl(var(--card)) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }
.sheet-frame .shadow-sm, .sheet-frame .shadow, .sheet-frame .shadow-md, .sheet-frame .shadow-lg { box-shadow: none !important; }
.sheet-frame thead th { font-family: "Sora", sans-serif; letter-spacing: 0.1em; }
.sheet-frame .statrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sheet-frame .statrow.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.sheet-frame .statrow > div { padding: 0 18px; min-width: 0; }
.sheet-frame .statrow > div + div { border-left: 1px solid var(--rule); }
.sheet-frame .statrow > div:first-child { padding-left: 0; }
@media (max-width: 640px) {
  .sheet-frame .statrow { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .sheet-frame .statrow.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sheet-frame .statrow > div { padding: 0; }
  .sheet-frame .statrow > div + div { border-left: 0; }
}
`;

/** The shell for a working page (lists, forms): the sheet's border, grid and title block around the page's own content. */
export const SheetShell: React.FC<{ eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ eyebrow, title, subtitle, action, children }) => (
  <>
    <style>{SHEET_FRAME_CSS}</style>
    <div className="sheet-frame sheet-in">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 14, padding: "20px 22px 18px" }}>
        <div style={{ minWidth: 0 }}>
          <p className="label">{eyebrow}</p>
          <h1 className="title" style={{ fontSize: "clamp(24px, 2.8vw, 36px)", margin: "8px 0 0", lineHeight: 1.08 }}>{title}</h1>
          {subtitle && <p style={{ margin: "7px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "64ch" }}>{subtitle}</p>}
        </div>
        {action && <div style={{ flexShrink: 0, maxWidth: "100%" }}>{action}</div>}
      </div>
      <div className="cell" style={{ display: "flex", flexDirection: "column", gap: 20 }}>{children}</div>
    </div>
  </>
);


// ── Small drawing parts ─────────────────────────────────────────────────────
export const Detail: React.FC<{ tag: string; title: string; note?: string; children: React.ReactNode; className?: string }> = ({ tag, title, note, children, className }) => (
  <section className={`cell ${className || ""}`}>
    <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <span className="tag">{tag}</span>
      <h2 className="label" style={{ color: "var(--ink)", margin: 0 }}>{title}</h2>
      <span style={{ flex: 1, height: 1, background: "var(--rule)" }} />
      {note && <span className="label">{note}</span>}
    </header>
    {children}
  </section>
);

/** A dimension line: a measured span with end ticks and its value written on it. */
export const Dimension: React.FC<{ from: number; to: number; text: string; color?: string }> = ({ from, to, text, color = "var(--graphite)" }) => (
  <div style={{ position: "relative", height: 22, marginTop: 6 }}>
    <div style={{ position: "absolute", left: `${from}%`, width: `${Math.max(0, to - from)}%`, top: 6, height: 1, background: color }}>
      <span style={{ position: "absolute", left: 0, top: -4, width: 1, height: 9, background: color }} />
      <span style={{ position: "absolute", right: 0, top: -4, width: 1, height: 9, background: color }} />
      <span className="mono" style={{ position: "absolute", left: "50%", top: 5, transform: "translateX(-50%)", fontSize: 10, color, whiteSpace: "nowrap", background: "var(--sheet)", padding: "0 6px" }}>{text}</span>
    </div>
  </div>
);

export const Skel: React.FC<{ h?: number; w?: string }> = ({ h = 14, w = "100%" }) => <div className="skel" style={{ height: h, width: w, marginBottom: 10 }} />;
