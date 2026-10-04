import React, { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCheatsheetShortcut } from "@/hooks/useGlobalShortcuts";
import { SHORTCUT_GROUPS, type ShortcutRow } from "./shortcutCatalog";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="min-w-[1.5rem] rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[0.6875rem] text-foreground">
    {children}
  </kbd>
);

function Row({ row }: { row: ShortcutRow }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="min-w-0">
        <span className="text-sm text-foreground">{row.label}</span>
        {row.hint && <span className="block text-[0.6875rem] text-muted-foreground">{row.hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {row.keys.map((k, i) => (
          <React.Fragment key={`${k}-${i}`}>
            {i > 0 && <span className="text-[0.625rem] text-muted-foreground">{row.joiner === "then" ? "then" : "+"}</span>}
            <Kbd>{k}</Kbd>
          </React.Fragment>
        ))}
      </span>
    </li>
  );
}

/** Keyboard cheatsheet. Opens on Shift+C+S from anywhere; mounted once in AppLayout. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  useCheatsheetShortcut(toggle);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-xl thin-scroll">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">
            Shortcuts are ignored while you're typing in a field.
          </DialogDescription>
        </div>
        <div className="space-y-5 px-5 py-4">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h3>
              {g.note && <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{g.note}</p>}
              <ul className="mt-1 divide-y divide-border/60">
                {g.rows.map((r) => (
                  <Row key={r.label} row={r} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-2 text-[0.6875rem] text-muted-foreground">
          <span>
            <Kbd>esc</Kbd> close
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Shift</Kbd>
            <Kbd>C</Kbd>
            <Kbd>S</Kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
