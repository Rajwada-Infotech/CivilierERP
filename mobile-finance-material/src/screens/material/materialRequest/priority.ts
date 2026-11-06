/** A request's priority as the sheet marks it: Urgent red, High solid ink, Normal / Low graphite. */
export const priorityTone = (p?: string | null) => (p === "Urgent" ? "stopped" : p === "High" ? "done" : "draft") as "stopped" | "done" | "draft";
