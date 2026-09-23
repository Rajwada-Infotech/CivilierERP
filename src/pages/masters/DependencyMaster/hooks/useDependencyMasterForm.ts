import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addDependencyMaster,
  updateDependencyMaster,
  type DependencyMasterDetail,
  type WorkType,
} from "@/api/dependencyMasterApi";
import { useScopeCascade, type ScopeSelection } from "./useScopeCascade";
import { useActivityLadder } from "./useActivityLadder";

/** Aggregates every step's state into one place: scope cascade, alias,
 * work type, and the activity ladder — plus the validate/submit gate. */
export function useDependencyMasterForm(editing: DependencyMasterDetail | null, onSaved: () => void) {
  const qc = useQueryClient();

  const initialScope: Partial<ScopeSelection> | undefined = editing
    ? {
        projectId: editing.projectId,
        towerId: editing.towerId,
        floor: editing.floor,
        flatId: editing.flatId,
        roomId: editing.roomId,
      }
    : undefined;

  const cascade = useScopeCascade(initialScope);
  const [alias, setAlias] = useState(editing?.alias ?? "");
  const [workType, setWorkType] = useState<WorkType>(editing?.workType ?? "INTERNAL");
  const ladder = useActivityLadder(editing?.activities ?? []);

  // Re-sync when `editing` arrives after this hook's first render — the
  // page renders before its GET /dependency-master/:id query resolves
  // (DependencyMasterFormPage calls this hook unconditionally, before its
  // own loading-guard return), so the useState initializers above always
  // ran once against `editing === null` and never re-ran once the real
  // record loaded. Without this, opening Edit on an existing chain always
  // showed a blank Alias and an empty Activity Chain — indistinguishable
  // from starting a brand new one — exactly like useScopeCascade's own
  // re-sync effect already exists to prevent for the scope cascade.
  useEffect(() => {
    if (!editing) return;
    setAlias(editing.alias ?? "");
    setWorkType(editing.workType ?? "INTERNAL");
    ladder.reset(editing.activities ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const aliasActive = cascade.isComplete;
  const toggleActive = aliasActive && alias.trim().length > 0;
  const ladderActive = toggleActive;

  const canSubmit =
    cascade.isComplete && alias.trim().length > 0 && ladder.rungs.length > 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dependency-masters"] });

  const createMutation = useMutation({
    mutationFn: addDependencyMaster,
    onSuccess: (res) => {
      toast.success(res.message || "Dependency record created");
      invalidate();
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof updateDependencyMaster>[1] }) =>
      updateDependencyMaster(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "Dependency record updated");
      invalidate();
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = () => {
    if (!cascade.resolvedScope) return toast.error("Complete the task scope first");
    if (!alias.trim()) return toast.error("Alias is required");
    if (ladder.rungs.length === 0) return toast.error("Add at least one activity to the chain");

    const payload = {
      scope: cascade.resolvedScope,
      alias: alias.trim(),
      workType,
      activities: ladder.rungs,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return {
    cascade,
    alias,
    setAlias,
    workType,
    setWorkType,
    ladder,
    aliasActive,
    toggleActive,
    ladderActive,
    canSubmit,
    submit,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
