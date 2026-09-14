import { useState } from "react";
import type { LadderActivity, WorkType } from "@/api/dependencyMasterApi";

/** Local state for the linear activity chain — add/remove/reorder, sequence
 * numbers renumbered on every change so they're always dense and 1-indexed. */
export function useActivityLadder(initial: LadderActivity[] = []) {
  const [rungs, setRungs] = useState<LadderActivity[]>(initial);

  const renumber = (list: LadderActivity[]) =>
    list.map((r, i) => ({ ...r, sequenceNo: i + 1 }));

  // workType is captured at the moment of adding, not re-derived later — a
  // rung's tag must not change just because the Step 3 toggle moves on to a
  // different value after this activity was already added.
  const add = (activityId: number, activityName: string, workType: WorkType) => {
    setRungs((prev) =>
      renumber([...prev, { activityId, activityName, sequenceNo: prev.length + 1, workType }]),
    );
  };

  const remove = (index: number) => {
    setRungs((prev) => renumber(prev.filter((_, i) => i !== index)));
  };

  const move = (fromIndex: number, toIndex: number) => {
    setRungs((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return renumber(next);
    });
  };

  const reset = (list: LadderActivity[] = []) => setRungs(list);

  return { rungs, add, remove, move, reset };
}
