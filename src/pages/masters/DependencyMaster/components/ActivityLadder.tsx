import { useState } from "react";
import { Plus } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";
import { ActivityRung } from "./ActivityRung";

interface Props {
  active: boolean;
  rungs: LadderActivity[];
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onMove?: (fromIndex: number, toIndex: number) => void;
  /** Inline list-row preview — no add/remove/reorder, just the chain as-is. */
  readOnly?: boolean;
  /** Skip the "Complete the scope..." wrapper chrome — used for the compact
   * inline preview under a list row, which is always rendering a saved
   * record (so `active` framing doesn't apply). */
  bare?: boolean;
}

// Step 4/5 — the ladder: a single connecting rail down the left with a
// numbered node per activity, "+" always appended at the bottom. Vertical
// ladder chosen over a horizontal stepper here since chains in this module
// are expected to stay short (well under ~8 activities per room) and the
// vertical form reads better on narrow/mobile layouts, which the rest of
// this admin UI already leans on.
export function ActivityLadder({ active, rungs, onAdd, onRemove, onMove, readOnly, bare }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDrop = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      onMove?.(dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  // onDragEnd always fires on release, even when the drop lands outside any
  // rung (or the drag is cancelled) and onDrop never gets called — without
  // this, dragIndex stayed set forever and that rung stayed dimmed at 40%
  // opacity with no way to clear it short of reloading the page.
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const rail = (
    <>
      {rungs.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {readOnly ? "No activities in this chain." : 'No activities added yet — click "Add Activity" below to start the chain.'}
        </div>
      ) : (
        <div className="mb-2">
          {rungs.map((rung, i) => (
            <ActivityRung
              key={`${rung.activityId}-${i}`}
              rung={rung}
              index={i}
              total={rungs.length}
              readOnly={readOnly}
              onRemove={() => onRemove?.(i)}
              onDragStart={setDragIndex}
              onDragOver={setOverIndex}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              isDragging={dragIndex === i}
              isDropTarget={overIndex === i && dragIndex !== i}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-full mt-1 py-2.5 border border-dashed border-foreground text-foreground hover:bg-primary/10"
        >
          <Plus size={13} /> Add activity
        </button>
      )}
    </>
  );

  if (bare) return rail;

  return (
    <div className={`p-4 border transition-opacity ${active ? "border-foreground/40" : "border-dashed border-foreground/30 opacity-60"}`}>
      <p className="text-[0.6875rem] text-muted-foreground mb-3">
        Strictly in order: each activity must finish before the next one starts. Drag a step to move it.
      </p>

      {!active ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Complete the scope and alias above to start building the chain.
        </p>
      ) : (
        rail
      )}
    </div>
  );
}
