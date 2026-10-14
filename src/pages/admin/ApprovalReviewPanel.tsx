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
      <div className="sheet-frame relative w-full h-full sm:h-[min(90vh,880px)] sm:w-[min(94vw,1160px)] bg-card flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200" style={{ margin: 0, border: "1px solid hsl(var(--foreground))", boxShadow: "10px 10px 0 hsl(var(--foreground) / 0.12)" }}>
        <ReviewHeader r={r} />

        {/* Body — two columns on large screens: details left, chain pinned right */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: record details */}
          <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
            <ReviewSummary r={r} />

            <ReviewWorkAllocation r={r} />

            {item.RejectionNote && (
              <div className="border border-destructive px-3 py-2">
                <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-destructive mb-0.5">
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
                className="flex items-center justify-center gap-2 w-full h-10 px-3 border border-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground hover:bg-primary/10 transition-colors"
              >
                <ArrowUpRight size={14} className="shrink-0" />
                Open full record in {item.ModuleLabel}
              </button>
            )}
          </div>

          {/* Right: approval chain, pinned — desktop only */}
          <div className="hidden lg:block w-full sm:w-[340px] shrink-0 border-l border-foreground overflow-y-auto px-5 py-5">
            {chainSection}
          </div>
        </div>

        <ReviewFooter r={r} />
      </div>
    </div>,
    document.body,
  );
};
