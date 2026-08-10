import { FilePenLine } from "lucide-react";

/** "Approved & Amended" pill — shown alongside (not instead of) the normal
 *  Approved status badge once a document has at least one Approved
 *  amendment against it. See useAmendmentStatus. */
export function AmendedBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-violet-500/10 text-violet-600 border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25 ${className ?? ""}`}
    >
      <FilePenLine size={11} />
      Approved &amp; Amended
    </span>
  );
}
