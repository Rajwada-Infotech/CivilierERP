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
