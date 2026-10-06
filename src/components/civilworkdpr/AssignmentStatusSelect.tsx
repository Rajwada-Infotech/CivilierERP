import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  allowedNextStatuses,
  ASSIGNMENT_STATUS_META,
  updateAssignmentStatus,
  type AssignmentStatus,
} from "@/api/dependencyActivityAssignmentApi";

// Shared between the Reporting page's table and Work Allocation's own
// "Saved Flow" list — a rung's status is editable from wherever it's
// visible, not just from Reporting, so this always invalidates both pages'
// query keys regardless of which one it was clicked from.
// An In Progress activity that was put back after a hold reads "Resumed" (still In Progress underneath).
const RESUMED_META = { label: "Resumed", className: "bg-teal-500/10 text-teal-600 dark:text-teal-400" };

export function AssignmentStatusSelect({
  rungId,
  status,
  resumed = false,
}: {
  rungId: number;
  status: AssignmentStatus;
  resumed?: boolean;
}) {
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
  const showResumed = resumed && status === "IN_PROGRESS";
  const meta = showResumed ? RESUMED_META : ASSIGNMENT_STATUS_META[status];
  const labelFor = (s: AssignmentStatus) => (s === "IN_PROGRESS" && showResumed ? RESUMED_META.label : ASSIGNMENT_STATUS_META[s].label);
  // The current status must be one of the <option>s, otherwise the browser shows the first
  // option instead (an Allocated activity would read "In Progress" before any work is reported).
  const next = allowedNextStatuses(status);
  const options = next.includes(status) ? next : [status, ...next];

  // Nothing to toggle to — Completed/Approved/Cancelled are no longer
  // manually reachable from here (Completed comes from the progress bar,
  // Rework from a QC or approval decision, Approved only from an explicit
  // approval action afterwards), so this reads as a plain badge.
  if (options.length <= 1) {
    return (
      <span
        className={`text-[0.6875rem] font-heading font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${meta.className}`}
      >
        {meta.label}
      </span>
    );
  }

  return (
    <select
      value={status}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as AssignmentStatus)}
      className={`text-[0.6875rem] font-heading font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 ${meta.className}`}
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {labelFor(s)}
        </option>
      ))}
    </select>
  );
}
