import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_META,
  updateAssignmentStatus,
  type AssignmentStatus,
} from "@/api/dependencyActivityAssignmentApi";

// Shared between the Reporting page's table and Work Reporting's own
// "Saved Flow" list — a rung's status is editable from wherever it's
// visible, not just from Reporting, so this always invalidates both pages'
// query keys regardless of which one it was clicked from.
export function AssignmentStatusSelect({ rungId, status }: { rungId: number; status: AssignmentStatus }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: AssignmentStatus) => updateAssignmentStatus(rungId, next),
    onSuccess: () => {
      toast.success("Status updated.");
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update status."),
  });
  const meta = ASSIGNMENT_STATUS_META[status];

  return (
    <select
      value={status}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as AssignmentStatus)}
      className={`text-[11px] font-heading font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 ${meta.className}`}
    >
      {ASSIGNMENT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {ASSIGNMENT_STATUS_META[s].label}
        </option>
      ))}
    </select>
  );
}
