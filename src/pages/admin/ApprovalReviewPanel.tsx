/**
 * ApprovalReviewPanel.tsx — full-screen centered review modal for the
 * Approval Inbox, styled like a proper "issue detail" workspace rather than
 * a side drawer: a two-column takeover — record details on the left, the
 * approval chain pinned on the right — with the Approve/Reject action bar
 * anchored across the bottom.
 *
 * Built as a plain fixed-position overlay (not a Radix Dialog) so that
 * ApprovalActions' own reject-note Dialog can nest inside it without two
 * Dialog portals fighting over focus/scroll-lock.
 */
// Split into parts under ./approvalInbox/review: useApprovalReview holds the state; each section has its own file.
import React from "react";
import { createPortal } from "react-dom";
import { openInModulePath } from "./approvalInbox/config";
import { ArrowUpRight } from "lucide-react";
import { ApprovalReviewPanelProps, WoActivities } from "./approvalInbox/review/parts";
import { useApprovalReview } from "./approvalInbox/review/useApprovalReview";
import { ReviewHeader } from "./approvalInbox/review/ReviewHeader";
import { ReviewSummary } from "./approvalInbox/review/ReviewSummary";
import { ReviewWorkAllocation } from "./approvalInbox/review/ReviewWorkAllocation";
import { ReviewBoq } from "./approvalInbox/review/ReviewBoq";
import { ReviewLineItems } from "./approvalInbox/review/ReviewLineItems";
import { ReviewDetails } from "./approvalInbox/review/ReviewDetails";
import { ReviewFooter } from "./approvalInbox/review/ReviewFooter";

export const ApprovalReviewPanel: React.FC<ApprovalReviewPanelProps> = (props) => {
  const r = useApprovalReview(props);
  const { item, onClose } = props;
  const { navigate, cfg, woActivities, chainSection } = r;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Modal takeover */}
      <div className="relative w-full h-full sm:h-[min(90vh,880px)] sm:w-[min(94vw,1160px)] bg-background sm:rounded-2xl shadow-2xl ring-1 ring-border/60 flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        <ReviewHeader r={r} />

        {/* Body — two columns on large screens: details left, chain pinned right */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: record details */}
          <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
            <ReviewSummary r={r} />

            <ReviewWorkAllocation r={r} />

            {item.RejectionNote && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/5 px-3 py-2">
                <p className="text-[0.5625rem] font-semibold uppercase tracking-widest text-red-500/80 mb-0.5">
                  Rejection Note
                </p>
                <p className="text-xs text-foreground">{item.RejectionNote}</p>
              </div>
            )}

            {woActivities.length > 0 && <WoActivities activities={woActivities} />}

            <ReviewBoq r={r} />

            <ReviewLineItems r={r} />

            <ReviewDetails r={r} />

            {/* Chain shows here too on small screens, where the sidebar collapses out */}
            <div className="lg:hidden pt-1">{chainSection}</div>

            {cfg?.navPath && (
              <button
                onClick={() => {
                  onClose();
                  navigate(openInModulePath(item, cfg.navPath));
                }}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/8 hover:border-primary/30 transition-all"
              >
                <ArrowUpRight size={14} className="shrink-0" />
                Open full record in {item.ModuleLabel}
              </button>
            )}
          </div>

          {/* Right: approval chain, pinned — desktop only */}
          <div className="hidden lg:block w-full sm:w-[340px] shrink-0 border-l border-border bg-muted/5 overflow-y-auto px-5 py-5">
            {chainSection}
          </div>
        </div>

        <ReviewFooter r={r} />
      </div>
    </div>,
    document.body,
  );
};
