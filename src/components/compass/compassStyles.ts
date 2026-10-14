// Compass drawn like the rest of the sheet: a square panel with an ink border and a hard offset shadow on the faint
// grid, a title block over the search line, sections headed in Sora capitals with a rule, numbered rows with squared
// module marks, and square ink keys in the footer. Colours come from the theme's variables, so every theme matches.
//
// The panel is `overflow: clip`, not `overflow: hidden`: cmdk calls scrollIntoView() on the highlighted row as you
// type, and scrollIntoView scrolls every scrollable ancestor - a `hidden` box still counts as one, so the whole panel
// (search line included) used to slide up inside its own frame with no way back. A `clip` box can't be scrolled at
// all; only the result list scrolls.
export const COMPASS_CSS = `
.compass-sheet {
  --ink: hsl(var(--foreground));
  --ink-2: hsl(var(--foreground) / 0.78);
  --graphite: hsl(var(--muted-foreground));
  --rule: hsl(var(--border));
  --rule-soft: hsl(var(--border) / 0.55);
  --wash: hsl(var(--primary) / 0.10);
  --grid: hsl(var(--foreground) / 0.04);
  --paper: hsl(var(--card));
  background-color: var(--paper);
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--ink);
  border: 1.5px solid var(--ink) !important;
  border-radius: 0 !important;
  box-shadow: 8px 8px 0 hsl(var(--foreground) / 0.14) !important;
  overflow: clip !important;
  font-family: "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
}
.compass-sheet .c-label {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--graphite);
}

/* Title block and the search line */
.compass-sheet .c-head { padding: 16px 20px 0; border-bottom: 1.5px solid var(--ink); }
.compass-sheet .c-search { display: flex; align-items: center; gap: 12px; padding: 10px 0 14px; }
.compass-sheet .c-search svg { color: var(--graphite); flex-shrink: 0; }
.compass-sheet .c-search input {
  flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--ink);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 19px; letter-spacing: -0.01em;
}
.compass-sheet .c-search input::placeholder { color: var(--graphite); font-weight: 500; opacity: 0.8; }

/* The list is the only thing that scrolls */
.compass-sheet [cmdk-list] { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding-bottom: 8px; }

/* Sections */
.compass-sheet [cmdk-group-heading] { padding: 14px 20px 6px; }
.compass-sheet .c-section-head { display: flex; align-items: center; gap: 10px; }
.compass-sheet .c-section-head .c-title { color: var(--ink); }
.compass-sheet .c-section-head .c-rule { flex: 1; height: 1px; background: var(--rule); }

/* Rows */
.compass-sheet [cmdk-item] {
  display: grid; grid-template-columns: 22px 28px minmax(0, 1fr) auto; align-items: center; gap: 12px;
  padding: 8px 20px; border-bottom: 1px solid var(--rule-soft); cursor: pointer; outline: none;
  transition: background-color .12s;
}
.compass-sheet [cmdk-item][data-selected="true"] { background: var(--wash); box-shadow: inset 3px 0 0 var(--ink); }
.compass-sheet .c-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--graphite); }
.compass-sheet .c-mark {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--rule); background: var(--paper);
}
.compass-sheet [cmdk-item][data-selected="true"] .c-mark { border-color: var(--ink); }
.compass-sheet .c-text { display: flex; flex-direction: column; min-width: 0; }
.compass-sheet .c-name { font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.compass-sheet .c-sub { font-size: 11px; color: var(--graphite); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.compass-sheet .c-go { opacity: 0; transition: opacity .12s; }
.compass-sheet [cmdk-item][data-selected="true"] .c-go { opacity: 1; }

/* The module index: two columns of module rows */
.compass-sheet .c-modules [cmdk-group-items] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.compass-sheet .c-modules [cmdk-item]:nth-child(odd) { border-right: 1px solid var(--rule-soft); }
@media (max-width: 520px) {
  .compass-sheet .c-modules [cmdk-group-items] { grid-template-columns: minmax(0, 1fr); }
  .compass-sheet .c-modules [cmdk-item]:nth-child(odd) { border-right: 0; }
}

/* Nothing found */
.compass-sheet .c-empty { margin: 22px 20px; padding: 22px; text-align: center; font-size: 13px; color: var(--ink-2);
  border: 1px dashed var(--rule); }

/* Square ink keys */
.compass-sheet .c-key {
  display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px;
  border: 1px solid var(--ink); color: var(--ink); background: var(--paper);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.04em;
}
.compass-sheet .c-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 9px 20px; border-top: 1.5px solid var(--ink); background: var(--paper);
}
.compass-sheet .c-hints { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.compass-sheet .c-hint { display: inline-flex; align-items: center; gap: 5px; }
`;
