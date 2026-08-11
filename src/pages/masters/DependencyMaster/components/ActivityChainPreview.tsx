import { ChevronRight } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";

interface Props {
  rungs: LadderActivity[];
}

// Compact, read-only rendering of a saved chain for the list row's inline
// expand — a horizontal flow of chips rather than the full editable ladder
// (numbered rail, drag handles, delete icons), since here the chain is only
// ever being looked at, not worked on. Wraps onto multiple lines for longer
// chains instead of scrolling.
export function ActivityChainPreview({ rungs }: Props) {
  if (rungs.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">No activities in this chain.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {rungs.map((rung, i) => {
        const isInternal = rung.workType === "INTERNAL";
        const accent = isInternal ? "#f97316" : "#0ea5e9";
        return (
          <div key={`${rung.activityId}-${i}`} className="flex items-center gap-1.5">
            <div
              className="flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1"
              style={{ borderColor: `${accent}40`, background: `${accent}0d` }}
            >
              <span
                className="w-4 h-4 rounded-full text-white text-[9px] font-heading font-bold flex items-center justify-center shrink-0"
                style={{ background: accent }}
              >
                {rung.sequenceNo}
              </span>
              <span className="text-xs font-medium text-foreground whitespace-nowrap">{rung.activityName}</span>
            </div>
            {i < rungs.length - 1 && (
              <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
