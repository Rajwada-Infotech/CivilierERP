import { ShieldCheck, ShieldAlert, History } from "lucide-react";

// Shown wherever an activity row appears once it's been through Quality
// Check at least once — Reporting's table, Work Allocation's chips/Saved
// Flow, and the Activity Detail modal's header. Purely a read of the
// latest QC decision (ReportedAssignment.qcStatus); it doesn't drive
// anything itself.
export function QcBadge({ qcStatus }: { qcStatus: "APPROVED" | "REWORK" | null | undefined }) {
  if (!qcStatus) return null;
  const passed = qcStatus === "APPROVED";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${
        passed
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400"
      }`}
      title={passed ? "Passed Quality Check" : "Sent back for Rework at Quality Check"}
    >
      {passed ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
      {passed ? "QC Passed" : "QC Rework"}
    </span>
  );
}

// Shown next to QcBadge wherever attemptNo appears — a rework forks a
// brand-new attempt (see migration 488) rather than editing the rejected
// one in place, so this marks a row as a redo, with the full history
// (why it was reworked, by QC or Approval) one tab away in the Activity
// Detail modal's History tab.
export function AttemptBadge({ attemptNo }: { attemptNo: number | null | undefined }) {
  if (!attemptNo || attemptNo <= 1) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 bg-[#ffe2021a] text-amber-600 dark:text-amber-400"
      title={`Attempt ${attemptNo} — reworked from an earlier attempt`}
    >
      <History size={10} /> Attempt {attemptNo}
    </span>
  );
}
