// Small drawing-sheet pieces shared by the Maintenance pages (docs/DESIGN.md) — display only.
import React from "react";
import { HR_HEAD, HR_NUM } from "@/components/hrpayroll/HrUi";
import type { MarkTone } from "@/components/sheet/Sheet";

// Service ticket status / priority as sheet marks: solid = settled, hatched = waiting, half = under way, red = attention.
export const TICKET_STATUS_TONE: Record<string, MarkTone> = {
  Open: "waiting", Assigned: "waiting", InProgress: "moving", Resolved: "done", Closed: "done", Reopened: "stopped",
};
export const TICKET_PRIORITY_TONE: Record<string, MarkTone> = { Urgent: "stopped", High: "moving", Normal: "waiting", Low: "draft" };
export const ticketStatusLabel = (s: string) => (s === "InProgress" ? "In Progress" : s);

/** A ruled box with a capitals heading, an optional count/note and an action on the right. */
export function SheetBox({ title, note, action, children, flush }: { title: string; note?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="bg-card border border-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-foreground/20">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className={HR_HEAD}>{title}</h2>
          {note != null && <span className={`text-[0.6875rem] text-muted-foreground ${HR_NUM}`}>{note}</span>}
        </div>
        {action}
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** Table cells on the sheet: capitals header on a faint wash, light rules between rows. */
export const TH = "px-3 py-2 text-left font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground bg-foreground/5 border-b border-foreground/20 whitespace-nowrap";
export const TD = "px-3 py-2 border-b border-foreground/10 align-middle";

/** Dialog body on the sheet: square ruled frame (pass to DialogContent's className with its size). */
export const SHEET_DIALOG = "sheet-frame rounded-none";

/** Tabs as ruled cells in one box; the active one has an ink underline and a faint blue wash. */
export function SheetTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: React.ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap bg-card border border-foreground" role="tablist">
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`flex-1 min-w-[96px] h-10 px-3 inline-flex items-center justify-center gap-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
              i ? "border-l border-foreground/20" : ""
            } ${active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
            style={active ? { boxShadow: "inset 0 -2px 0 hsl(var(--foreground))" } : undefined}
          >
            {t.label}
            {t.count != null && <span className={`${HR_NUM} text-[0.625rem]`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Icon-only row action: a 28px square with an ink outline on hover (red for destructive). */
export const ICON_ACT = "w-7 h-7 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-40";
export const ICON_ACT_RED = "w-7 h-7 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-40";

/** A small ruled tag (category, type) — graphite text in a thin box. */
export const TAG = "inline-flex items-center px-1.5 py-0.5 border border-foreground/30 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
