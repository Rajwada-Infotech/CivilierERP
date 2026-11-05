import React, { useCallback, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCheatsheetShortcut } from "@/hooks/useGlobalShortcuts";
import { moduleLook } from "@/components/compass/compassModules";
import { SHORTCUT_GROUPS, type ShortcutRow } from "./shortcutCatalog";

// The cheatsheet drawn on the sheet, like Compass: a square panel with an ink border and a hard shadow on the faint
// grid, a title block, lettered sections headed in Sora capitals with a rule, numbered rows, and square ink keys.
// Module switches carry their module's icon and colour and sit in two columns. Only the body scrolls - the panel is
// `overflow: clip`, so nothing can scroll the title block away.
const SC_CSS = `
.sc-sheet {
  --ink: hsl(var(--foreground));
  --graphite: hsl(var(--muted-foreground));
  --rule: hsl(var(--border));
  --rule-soft: hsl(var(--border) / 0.55);
  --paper: hsl(var(--card));
  background-color: var(--paper);
  background-image:
    linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--ink);
  border: 1.5px solid var(--ink) !important;
  border-radius: 0 !important;
  box-shadow: 8px 8px 0 hsl(var(--foreground) / 0.14) !important;
  overflow: clip !important;
  font-family: "DM Sans", sans-serif;
}
.sc-sheet .sc-label { font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--graphite); }
.sc-sheet .sc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 20px 14px; border-bottom: 1.5px solid var(--ink); }
.sc-sheet .sc-title { font-family: "Sora", sans-serif; font-weight: 700; font-size: 24px; letter-spacing: -0.03em; line-height: 1.1; margin-top: 6px; color: var(--ink); }
.sc-sheet .sc-desc { font-size: 12.5px; color: hsl(var(--foreground) / 0.72); margin-top: 5px; }
.sc-sheet .sc-close { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 1px solid var(--ink); color: var(--ink); background: var(--paper); transition: background-color .15s, color .15s; }
.sc-sheet .sc-close:hover { background: var(--ink); color: var(--paper); }
.sc-sheet .sc-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 0 12px; }
.sc-sheet .sc-sec-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px 4px; }
.sc-sheet .sc-tag { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 50%;
  border: 1.5px solid var(--ink); font-family: "Sora", sans-serif; font-size: 11px; font-weight: 600; color: var(--ink); background: var(--paper); }
.sc-sheet .sc-rule { flex: 1; height: 1px; background: var(--rule); }
.sc-sheet .sc-note { padding: 2px 20px 6px 52px; font-size: 11.5px; color: var(--graphite); }
.sc-sheet .sc-rows { display: grid; grid-template-columns: minmax(0, 1fr); }
.sc-sheet .sc-rows.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sc-sheet .sc-rows.two > li:nth-child(odd) { border-right: 1px solid var(--rule-soft); }
.sc-sheet .sc-row { display: grid; grid-template-columns: 22px auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 20px; border-bottom: 1px solid var(--rule-soft); }
.sc-sheet .sc-row.nomark { grid-template-columns: 22px minmax(0, 1fr) auto; }
.sc-sheet .sc-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--graphite); }
.sc-sheet .sc-mark { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rule); background: var(--paper); }
.sc-sheet .sc-name { font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-sheet .sc-hint { display: block; font-size: 11px; color: var(--graphite); margin-top: 1px; }
.sc-sheet .sc-keys { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
.sc-sheet .sc-join { font-family: "Sora", sans-serif; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--graphite); }
.sc-sheet .sc-key { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px;
  border: 1px solid var(--ink); background: var(--paper); color: var(--ink); box-shadow: 1.5px 1.5px 0 hsl(var(--foreground) / 0.18);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 10.5px; letter-spacing: 0.02em; }
.sc-sheet .sc-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 20px; border-top: 1.5px solid var(--ink); background: var(--paper); }
.sc-sheet .sc-foot .sc-hint-row { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 560px) {
  .sc-sheet .sc-rows.two { grid-template-columns: minmax(0, 1fr); }
  .sc-sheet .sc-rows.two > li:nth-child(odd) { border-right: 0; }
}
`;

const Key = ({ children }: { children: React.ReactNode }) => <kbd className="sc-key">{children}</kbd>;

function Keys({ row }: { row: ShortcutRow }) {
  return (
    <span className="sc-keys">
      {row.keys.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 && <span className="sc-join">{row.joiner === "then" ? "then" : "+"}</span>}
          <Key>{k}</Key>
        </React.Fragment>
      ))}
    </span>
  );
}

function Row({ row, index }: { row: ShortcutRow; index: number }) {
  const look = row.module ? moduleLook(row.module) : null;
  return (
    <li className={`sc-row ${look ? "" : "nomark"}`}>
      <span className="sc-num">{String(index).padStart(2, "0")}</span>
      {look && (
        <span className="sc-mark" style={{ color: look.color }}>
          <look.Icon size={14} />
        </span>
      )}
      <span className="min-w-0">
        <span className="sc-name">{row.label}</span>
        {row.hint && <span className="sc-hint">{row.hint}</span>}
      </span>
      <Keys row={row} />
    </li>
  );
}

/** Keyboard cheatsheet. Opens on Shift+C+S from anywhere; mounted once in AppLayout. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  useCheatsheetShortcut(toggle);

  let n = 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideCloseButton className="sc-sheet top-[8dvh] translate-y-0 flex flex-col gap-0 p-0 sm:p-0 sm:max-w-2xl max-h-[84dvh] overflow-clip">
        <style>{SC_CSS}</style>
        <div className="sc-head">
          <div className="min-w-0">
            <p className="sc-label">CivilierERP · Shortcuts</p>
            <DialogTitle className="sc-title">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="sc-desc">Shortcuts are ignored while you're typing in a field.</DialogDescription>
          </div>
          <DialogClose className="sc-close" aria-label="Close">
            <X size={14} />
          </DialogClose>
        </div>

        <div className="sc-body thin-scroll">
          {SHORTCUT_GROUPS.map((g, gi) => {
            const isModules = g.rows.some((r) => r.module);
            return (
              <section key={g.title}>
                <header className="sc-sec-head">
                  <span className="sc-tag">{String.fromCharCode(65 + gi)}</span>
                  <h3 className="sc-label" style={{ color: "var(--ink)" }}>{g.title}</h3>
                  <span className="sc-rule" />
                  <span className="sc-label">{g.rows.length}</span>
                </header>
                {g.note && <p className="sc-note">{g.note}</p>}
                <ul className={`sc-rows ${isModules ? "two" : ""}`}>
                  {g.rows.map((r) => (
                    <Row key={r.label} row={r} index={++n} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="sc-foot">
          <span className="sc-hint-row">
            <Key>Esc</Key>
            <span className="sc-label">Close</span>
          </span>
          <span className="sc-hint-row">
            <span className="sc-label">Open anywhere</span>
            <Key>Shift</Key>
            <span className="sc-join">+</span>
            <Key>C</Key>
            <span className="sc-join">+</span>
            <Key>S</Key>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
