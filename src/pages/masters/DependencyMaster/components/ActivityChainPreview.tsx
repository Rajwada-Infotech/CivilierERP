import { ChevronRight } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";

interface Props {
  rungs: LadderActivity[];
  /** When given, each rung becomes clickable (e.g. Work Allocation opens an
   * engineer/material assignment form for that specific rung) — omit to
   * keep the plain read-only rendering used elsewhere (the Dependency
   * Master list's own inline expand). */
  onRungClick?: (rung: LadderActivity) => void;
}

// Compact, read-only rendering of a saved chain for the list row's inline
// expand — a horizontal flow of chips rather than the full editable ladder
// (numbered rail, drag handles, delete icons), since here the chain is only
// ever being looked at, not worked on. Wraps onto multiple lines for longer
// chains instead of scrolling.
export function ActivityChainPreview({ rungs, onRungClick }: Props) {
  if (rungs.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">No activities in this chain.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {rungs.map((rung, i) => {
        const isInternal = rung.workType === "INTERNAL";
        const clickable = !!onRungClick && rung.rungId != null;
        const Chip = clickable ? "button" : "div";
        return (
          <div key={`${rung.activityId}-${i}`} className="flex items-center gap-1.5">
            <Chip
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => onRungClick!(rung) : undefined}
              className={`flex items-center gap-2 border pl-1 pr-2.5 py-1 bg-card ${isInternal ? "border-foreground" : "border-dashed border-foreground"} ${
                clickable ? "cursor-pointer hover:bg-primary/10 transition-colors" : ""
              }`}
              title={clickable ? "Assign engineer & material" : isInternal ? "Internal work" : "External work"}
            >
              <span
                className="min-w-[1.125rem] h-[1.125rem] px-0.5 bg-foreground text-card text-[0.5625rem] font-heading font-bold tabular-nums flex items-center justify-center shrink-0"
              >
                {rung.sequenceNo}
              </span>
              <span className="text-xs font-medium text-foreground whitespace-nowrap">{rung.activityName}</span>
            </Chip>
            {i < rungs.length - 1 && (
              <ChevronRight size={12} className="text-muted-foreground shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
