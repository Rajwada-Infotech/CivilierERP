// A document's numbered step bar (Agreement, Sale Deed, Transfer Deed): each
// step a button that opens its tab. Steps wrap onto a second line instead of
// scrolling sideways, so every step stays in view inside a narrow panel.
import React from "react";
import { Check } from "lucide-react";

export type StepBarState = "done" | "current" | "upcoming";

export function StepBar<T extends string>({ steps, activeTab, onStepClick }: {
  steps: { label: string; state: StepBarState; tab: T }[];
  activeTab: T;
  onStepClick: (t: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-y-1">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <button onClick={() => onStepClick(s.tab)}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`flex items-center gap-1.5 shrink-0 px-2 py-1.5 hover:bg-primary/10 transition-colors ${activeTab === s.tab ? "bg-primary/10" : ""}`}>
            <span className={`w-6 h-6 flex items-center justify-center text-[0.625rem] font-bold shrink-0 border ${
              s.state === "done" ? "bg-foreground text-card border-foreground"
              : s.state === "current" ? "bg-card text-foreground border-foreground border-2"
              : "bg-card text-muted-foreground border-foreground/25"}`}>
              {s.state === "done" ? <Check size={11} /> : <span className="font-heading tabular-nums">{i + 1}</span>}
            </span>
            <span className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap leading-tight ${
              s.state === "upcoming" ? "text-muted-foreground/60" : "text-foreground"}`}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <div className={`w-4 h-px mx-0.5 shrink-0 ${steps[i + 1].state !== "upcoming" ? "bg-foreground" : "bg-foreground/20"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
