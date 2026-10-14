import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { X } from "lucide-react";
import type { ApprovalReviewState } from "./useApprovalReview";

// The panel's header: what the record is, its status, print / download, close.
export function ReviewHeader({ r }: { r: ApprovalReviewState }) {
  const { item, onClose, cfg, Icon, docActions } = r;
  return (
    <>
      {/* Header — coloured gradient keyed to the module accent */}
      <div className="shrink-0 border-b border-foreground px-5 sm:px-6 py-4 flex items-center gap-3">
        <div className="w-10 h-10 flex items-center justify-center border border-foreground text-foreground shrink-0">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-lg font-bold tracking-tight text-foreground truncate leading-tight">{item.ModuleLabel}</p>
          <p className="text-[0.75rem] text-muted-foreground font-heading tabular-nums truncate mt-0.5">
            {item.Reference || `#${item.RecordId}`}
          </p>
        </div>
        <SheetMark text={item.Status} tone={statusTone(item.Status)} />
        {docActions}
        <button
          onClick={onClose}
          className="ml-2 w-8 h-8 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors shrink-0"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>
    </>
  );
}
