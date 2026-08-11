import { useNavigate } from "react-router-dom";
import { PenSquare, FilePenLine } from "lucide-react";
import { useAmendmentStatus } from "@/hooks/useAmendmentStatus";
import { AmendedBadge } from "@/components/AmendedBadge";

interface Props {
  /** RefDocType stored on dbo.Amendments — e.g. "Payment", "FundTransfer". */
  refDocType: string;
  refDocId: number | string;
  /** The document's own approval status (Draft/Pending/Approved/...), NOT
   *  the amendment's status. */
  docStatus: string | null | undefined;
  docNo?: string | null;
  projectName?: string | null;
  companyName?: string | null;
  totalAmount?: number | null;
  /** Which amendment tab this doc type lives under — "PO" | "GRN" | "EB" |
   *  "WO" | "BOQ" | "WORK_DONE", or a new Finance tab key once added. */
  amendTab: string;
  /** Route to the amendment menu that owns `amendTab` — e.g.
   *  "/engineering/amendment-menu" or "/material/amendment-menu". */
  amendMenuPath: string;
  canEdit: boolean;
  onEdit: () => void;
  /** Show the "Approved & Amended" badge inline next to the button.
   *  Set false to place <AmendedBadge> yourself elsewhere (e.g. next to a
   *  status chip) instead of beside the button. */
  showBadge?: boolean;
  className?: string;
  size?: "sm" | "icon";
}

/**
 * Shared across every Finance/Material/Engineering transaction page: before
 * approval, shows a normal Edit button; once the document's own status is
 * "Approved", swaps to an Amend button that deep-links into that module's
 * Amendment Menu with the document prefilled. See useAmendmentStatus.
 */
export function EditOrAmendButton({
  refDocType,
  refDocId,
  docStatus,
  docNo,
  projectName,
  companyName,
  totalAmount,
  amendTab,
  amendMenuPath,
  canEdit,
  onEdit,
  showBadge = true,
  className,
  size = "icon",
}: Props) {
  const navigate = useNavigate();
  const amendmentStatus = useAmendmentStatus(refDocType, refDocId, docStatus);

  if (!canEdit) return null;

  const goToAmend = () =>
    navigate(amendMenuPath, {
      state: {
        prefill: {
          tab: amendTab,
          docId: refDocId,
          docNo: docNo ?? "",
          projectName: projectName ?? "",
          companyName: companyName ?? "",
          totalAmount: totalAmount ?? undefined,
        },
      },
    });

  if (amendmentStatus.isApproved) {
    return (
      <>
        {size === "icon" ? (
          <button
            onClick={goToAmend}
            title="Amend"
            className={`p-1.5 rounded-md border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors ${className ?? ""}`}
          >
            <FilePenLine size={12} />
          </button>
        ) : (
          <button
            onClick={goToAmend}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 text-violet-600 dark:text-violet-400 text-xs font-medium hover:bg-violet-500/5 dark:hover:bg-violet-500/10 transition-colors ${className ?? ""}`}
          >
            <FilePenLine size={12} />
            Amend
          </button>
        )}
        {showBadge && amendmentStatus.isAmended && <AmendedBadge />}
      </>
    );
  }

  return size === "icon" ? (
    <button
      onClick={onEdit}
      title="Edit"
      className={`p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${className ?? ""}`}
    >
      <PenSquare size={12} />
    </button>
  ) : (
    <button
      onClick={onEdit}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 text-primary text-xs font-medium hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors ${className ?? ""}`}
    >
      <PenSquare size={12} />
      Edit
    </button>
  );
}
