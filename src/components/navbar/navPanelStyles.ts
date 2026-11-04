// The top bar's drop-down panels drawn on the sheet (same look as Reminders, Compass and the shortcuts cheatsheet): a
// square card with an ink border and a hard shadow on the faint grid, a title block, numbered rows with square marks,
// and square ink keys. Colours come from the theme's variables, so every theme matches.
export const NAV_PANEL_CSS = `
.np-sheet {
  --np-ink: hsl(var(--foreground));
  --np-graphite: hsl(var(--muted-foreground));
  --np-rule: hsl(var(--border));
  --np-rule-soft: hsl(var(--border) / 0.55);
  --np-paper: hsl(var(--card));
  --np-wash: hsl(var(--primary) / 0.10);
  background-color: var(--np-paper);
  background-image:
    linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--np-ink);
  border: 1.5px solid var(--np-ink);
  box-shadow: 6px 6px 0 hsl(var(--foreground) / 0.14);
  font-family: "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
}
.np-sheet .np-label {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--np-graphite);
}
.np-sheet .np-label.ink { color: var(--np-ink); }
.np-sheet .np-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1.5px solid var(--np-ink); }
.np-sheet .np-title { font-family: "Sora", sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.02em; line-height: 1.1; margin-top: 5px; color: var(--np-ink); }
.np-sheet .np-count { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.np-sheet .np-figure { font-family: "Sora", sans-serif; font-weight: 600; font-size: 26px; line-height: 1; letter-spacing: -0.02em; color: var(--np-ink); }
.np-sheet .np-key {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 9px; flex-shrink: 0;
  border: 1px solid var(--np-ink); color: var(--np-ink); background: var(--np-paper);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase;
  transition: background-color .15s, color .15s;
}
.np-sheet .np-key:hover { background: var(--np-ink); color: var(--np-paper); }
.np-sheet .np-list { overflow-y: auto; overscroll-behavior: contain; }
.np-sheet .np-row {
  display: grid; grid-template-columns: 20px auto minmax(0, 1fr) auto; align-items: start; gap: 10px; width: 100%;
  padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--np-rule-soft); transition: background-color .12s;
}
.np-sheet .np-row:last-child { border-bottom: 0; }
.np-sheet .np-row:hover, .np-sheet .np-row:focus-visible { background: var(--np-wash); box-shadow: inset 3px 0 0 var(--np-ink); outline: none; }
.np-sheet .np-row.center { align-items: center; }
.np-sheet .np-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--np-graphite); padding-top: 2px; }
.np-sheet .np-row.center .np-num { padding-top: 0; }
.np-sheet .np-dot { width: 9px; height: 9px; margin-top: 3px; border: 1px solid var(--np-ink); flex-shrink: 0; }
.np-sheet .np-dot.solid { background: var(--np-ink); }
.np-sheet .np-text { display: flex; flex-direction: column; min-width: 0; }
.np-sheet .np-name { font-size: 13px; font-weight: 600; color: var(--np-ink); line-height: 1.35; }
.np-sheet .np-row.read .np-name { font-weight: 500; color: hsl(var(--foreground) / 0.78); }
.np-sheet .np-sub { font-size: 11.5px; color: var(--np-graphite); line-height: 1.4; margin-top: 2px; }
.np-sheet .np-swatch { width: 22px; height: 22px; border: 1px solid var(--np-ink); flex-shrink: 0; }
.np-sheet .np-tag {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px; background: var(--np-ink); color: var(--np-paper);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase;
}
.np-sheet .np-mark {
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 1px solid var(--np-rule); background: var(--np-paper); color: var(--np-ink);
}
.np-sheet .np-row:hover .np-mark { border-color: var(--np-ink); }
.np-sheet .np-row.danger .np-name, .np-sheet .np-row.danger .np-mark { color: hsl(var(--destructive)); }
.np-sheet .np-row.danger:hover { background: hsl(var(--destructive) / 0.08); box-shadow: inset 3px 0 0 hsl(var(--destructive)); }
.np-sheet .np-row.danger:hover .np-mark { border-color: hsl(var(--destructive)); }
.np-sheet .np-who { display: flex; align-items: center; gap: 12px; margin-top: 10px; min-width: 0; }
.np-sheet .np-avatar {
  width: 42px; height: 42px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  border: 1.5px solid var(--np-ink); background: var(--np-paper);
  font-family: "Sora", sans-serif; font-weight: 700; font-size: 14px; color: var(--np-ink);
}
.np-sheet .np-avatar img { width: 100%; height: 100%; object-fit: cover; }
.np-sheet .np-role {
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px; margin-top: 10px; border: 1px solid currentColor;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
}
.np-sheet .np-empty { margin: 16px; padding: 20px; text-align: center; border: 1px dashed var(--np-rule); font-size: 12px; color: var(--np-graphite); }
.np-sheet .np-empty p + p { margin-top: 4px; }
`;

// A panel swells out of its icon like a bubble: it starts as a small round blob at the icon, grows on a real spring (the height
// leads and the width follows a beat later, so it wobbles like jelly before settling), and its corners go from round to square as it
// fills. Closing pops it back into a bubble. The icon gives a soft squash-and-stretch when its panel opens. Put "genie" and
// "genie-open" / "genie-close" on the sheet and "genie-rub" on the open button. The keyframes are sampled from the spring equation
// below, so the motion is a physical one, not an eased guess. The individual scale / translate properties are used (not transform), so
// nothing fights the Tailwind centring on phones. --genie-dir is 1 for a panel that drops down from its icon and -1 for one that rises up
// from it (the mobile nav's sheets); --genie-ox / --genie-oy place the icon on the panel.
const spring = (zeta: number, w: number) => {
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return (t: number) => 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
};

function genieOutKeyframes(): string {
  const DURATION = 0.66; // seconds the spring is sampled over; it has settled well before this
  const START = 0.1; // the bubble's first size
  const springX = spring(0.74, 16); // width: softer, a beat behind
  const springY = spring(0.66, 19); // height: livelier, leads, so the bubble stretches down first
  const STEPS = 28;
  let css = "@keyframes genie-out {";
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const t = p * DURATION;
    const sx = i === STEPS ? 1 : START + (1 - START) * springX(t);
    const sy = i === STEPS ? 1 : START + (1 - START) * springY(t);
    const fade = Math.min(1, p / 0.2);
    const radius = i === STEPS ? 0 : 56 * Math.pow(1 - Math.min(1, p / 0.62), 2);
    const blur = i === STEPS ? 0 : 2.4 * Math.pow(1 - Math.min(1, p / 0.45), 2);
    const rise = i === STEPS ? 0 : -12 * (1 - springY(t));
    css += `${(p * 100).toFixed(2)}%{scale:${sx.toFixed(4)} ${sy.toFixed(4)};translate:0 calc(var(--genie-dir, 1) * ${rise.toFixed(2)}px);opacity:${fade.toFixed(3)};border-radius:${radius.toFixed(1)}px;filter:blur(${blur.toFixed(2)}px)}`;
  }
  return css + "}";
}

export const GENIE_CSS = `
${genieOutKeyframes()}
@keyframes genie-in {
  0%   { scale: 1 1; translate: 0 0; opacity: 1; border-radius: 0; filter: blur(0); }
  20%  { scale: 1.03 0.985; translate: 0 calc(var(--genie-dir, 1) * 1px); opacity: 1; border-radius: 6px; filter: blur(0); }
  100% { scale: 0.1 0.1; translate: 0 calc(var(--genie-dir, 1) * -12px); opacity: 0; border-radius: 56px; filter: blur(2.4px); }
}
@keyframes genie-rub {
  0%   { scale: 1 1; }
  22%  { scale: 1.22 0.88; }
  46%  { scale: 0.9 1.14; }
  68%  { scale: 1.07 0.96; }
  86%  { scale: 0.98 1.02; }
  100% { scale: 1 1; }
}
.genie {
  /* where the icon is, as a point on the panel: phones keep the panel centred under the bar, wider screens drop it from the icon */
  --genie-ox: calc(100% - 28px);
  --genie-oy: -28px;
  transform-origin: var(--genie-ox) var(--genie-oy);
  will-change: scale, translate, opacity;
}
@media (min-width: 640px) { .genie { --genie-ox: calc(100% - 16px); --genie-oy: -12px; } }
.genie-open  { animation: genie-out 660ms linear both; }
.genie-close { animation: genie-in 300ms cubic-bezier(0.55, 0, 0.75, 0.35) both; pointer-events: none; }
.genie-rub svg { animation: genie-rub 520ms cubic-bezier(0.34, 0.2, 0.3, 1); transform-origin: 50% 70%; }
/* a trigger that is not an icon (the avatar) squashes and stretches as a whole */
.genie-pop { animation: genie-rub 520ms cubic-bezier(0.34, 0.2, 0.3, 1); transform-origin: 50% 60%; }
@media (prefers-reduced-motion: reduce) {
  .genie-open, .genie-close { animation: none; }
  .genie-rub svg, .genie-pop { animation: none; }
}
`;
