import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { ASSIGNMENT_PRIORITIES, updateAssignmentPriority, type AssignmentPriority } from "@/api/dependencyActivityAssignmentApi";
import { PRIORITY_META } from "@/components/civilworkdpr/PriorityBadge";

// The Priority picked on Work Allocation, editable right in Activity Reporting's table. Same field as the
// allocation form's, so a change here shows in Work Allocation (and vice versa) — both pages' queries are refreshed.
const NONE_CLASS = "!rounded-none border border-dashed border-foreground/30 text-muted-foreground";

export function AssignmentPrioritySelect({ rungId, priority }: { rungId: number; priority?: AssignmentPriority | null }) {
  const queryClient = useQueryClient();
  const canEdit = usePageRights("civilworkdpr-activity-reporting").canEdit || usePageRights("civilworkdpr-work-done").canEdit;
  const mutation = useMutation({
    mutationFn: (next: AssignmentPriority | "") => updateAssignmentPriority(rungId, next || null),
    onSuccess: () => {
      toast.success("Priority updated.");
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      queryClient.invalidateQueries({ queryKey: ["dependency-activity-assignment", rungId] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update priority."),
  });
  const cls = priority && PRIORITY_META[priority] ? PRIORITY_META[priority].className : NONE_CLASS;
  const base = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2 py-1";

  if (!canEdit) return <span className={`${base} ${cls}`}>{priority || "—"}</span>;
  return (
    <select
      value={priority ?? ""}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as AssignmentPriority | "")}
      className={`${base} cursor-pointer focus:outline-none disabled:opacity-50 ${cls}`}
    >
      <option value="">No priority</option>
      {ASSIGNMENT_PRIORITIES.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  );
}
