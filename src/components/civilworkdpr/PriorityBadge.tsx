import type { AssignmentPriority } from "@/api/dependencyActivityAssignmentApi";

// Colour per Activity Priority, mildest to most pressing — shared by the Work Allocation form and every
// place an activity's record is shown.
export const PRIORITY_META: Record<AssignmentPriority, { className: string }> = {
  Low: { className: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  High: { className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  Urgent: { className: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  "Very Urgent": { className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

/** Small pill showing an activity's priority; renders nothing when none was set. */
export function PriorityBadge({ priority }: { priority?: AssignmentPriority | null }) {
  if (!priority || !PRIORITY_META[priority]) return null;
  return (
    <span
      className={`text-[0.625rem] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_META[priority].className}`}
      title={`Priority: ${priority}`}
    >
      {priority}
    </span>
  );
}
