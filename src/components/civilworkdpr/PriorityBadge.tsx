import type { AssignmentPriority } from "@/api/dependencyActivityAssignmentApi";

// Weight per Activity Priority, mildest to most pressing: a faint outline, an ink outline, inked solid, then red — shared by the Work Allocation form and every
// place an activity's record is shown.
export const PRIORITY_META: Record<AssignmentPriority, { className: string }> = {
  Low: { className: "!rounded-none border border-foreground/30 text-muted-foreground" },
  High: { className: "!rounded-none border border-foreground text-foreground" },
  Urgent: { className: "!rounded-none border border-foreground bg-foreground text-card" },
  "Very Urgent": { className: "!rounded-none border border-destructive bg-destructive text-destructive-foreground" },
};

/** Small pill showing an activity's priority; renders nothing when none was set. */
export function PriorityBadge({ priority }: { priority?: AssignmentPriority | null }) {
  if (!priority || !PRIORITY_META[priority]) return null;
  return (
    <span
      className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 shrink-0 ${PRIORITY_META[priority].className}`}
      title={`Priority: ${priority}`}
    >
      {priority}
    </span>
  );
}
