import { useState } from "react";
import { Plus, GitBranch } from "lucide-react";
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

  const rail = (
    <>
      {rungs.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground italic">
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
          className="w-full mt-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-primary/40 text-primary text-xs font-heading font-semibold hover:bg-primary/5 transition-colors"
        >
          <Plus size={13} /> Add Activity
        </button>
      )}
    </>
  );

  if (bare) return rail;

  return (
    <div className={`rounded-xl border p-4 transition-opacity ${active ? "border-border" : "border-dashed border-border/60 opacity-50"}`}>
      <div className="flex items-center gap-2 mb-3">
        <GitBranch size={13} className="text-primary" />
        <h3 className="text-xs font-heading font-semibold uppercase tracking-widest text-foreground">
          Activity Chain
        </h3>
        <span className="text-[10px] text-muted-foreground/60 ml-1">
          strictly linear — each activity must finish before the next starts
        </span>
      </div>

      {!active ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">
          Complete the scope and alias above to start building the chain.
        </p>
      ) : (
        rail
      )}
    </div>
  );
}
