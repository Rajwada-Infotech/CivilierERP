import { ApprovalActions } from "@/components/ApprovalActions";
import { SUB_GATE_SUFFIX, openInModulePath, needsBankReview } from "../config";
import type { ApprovalReviewState } from "./useApprovalReview";

// The action bar: approve / reject (or review first) across the bottom.
export function ReviewFooter({ r }: { r: ApprovalReviewState }) {
  const { item, onClose, onActionDone, navigate, cfg } = r;
  return (
    <>
      {/* Footer — the action bar, spanning full width */}
      <div className="shrink-0 border-t border-foreground px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
        <p className={`text-[0.6875rem] text-muted-foreground max-w-2xl ${["fund-transfer", "crm-refund-payment"].includes(item.Module) && item.Status === "Pending" ? "" : "hidden sm:block"}`}>
          {item.Module === "fund-transfer" && item.Status === "Pending"
            ? "Confirm the bank transfer was completed manually before approving. CivilierERP does not move the funds; approval posts the accounting entries and applies any linked CRM credit."
            : item.Module === "crm-refund-payment" && item.Status === "Pending"
              ? "Confirm the customer was paid manually outside CivilierERP before approving. Approval records the refund as paid and posts accounting; CivilierERP does not move funds."
              : item.Status === "Pending" ? "Review the details above before taking action." : `This record is ${item.Status.toLowerCase()}.`}
        </p>
        <ApprovalActions
          status={item.Status}
          recordId={item.RecordId}
          endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
          actionPathSuffix={SUB_GATE_SUFFIX[item.Module]}
          canAct={item._canAct !== false}
          // CRM payment without a deposit bank yet: Accounts sets it on the
          // Received Payment page first — Approve here would be refused.
          reviewInstead={needsBankReview(item) && cfg?.navPath
            ? { label: "Review — set bank", onClick: () => { onClose(); navigate(openInModulePath(item, cfg.navPath)); } }
            : undefined}
          className="[&_button]:h-10 [&_button]:px-5"
          onSuccess={(action) => {
            if (action === "approve" || action === "reject") {
              onActionDone(action);
              onClose();
            }
          }}
        />
      </div>
    </>
  );
}
