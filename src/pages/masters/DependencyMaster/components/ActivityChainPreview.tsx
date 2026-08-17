import { ChevronRight } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";

interface Props {
  rungs: LadderActivity[];
  /** When given, each rung becomes clickable (e.g. Work Reporting opens an
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
        const accent = isInternal ? "#f97316" : "#0ea5e9";
        const clickable = !!onRungClick && rung.rungId != null;
        const Chip = clickable ? "button" : "div";
        return (
          <div key={`${rung.activityId}-${i}`} className="flex items-center gap-1.5">
            <Chip
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => onRungClick!(rung) : undefined}
              className={`flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 ${
                clickable ? "cursor-pointer hover:brightness-110 transition-all" : ""
              }`}
              style={{ borderColor: `${accent}40`, background: `${accent}0d` }}
              title={clickable ? "Assign engineer & material" : undefined}
            >
              <span
                className="w-4 h-4 rounded-full text-white text-[9px] font-heading font-bold flex items-center justify-center shrink-0"
                style={{ background: accent }}
              >
                {rung.sequenceNo}
              </span>
              <span className="text-xs font-medium text-foreground whitespace-nowrap">{rung.activityName}</span>
            </Chip>
            {i < rungs.length - 1 && (
              <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
