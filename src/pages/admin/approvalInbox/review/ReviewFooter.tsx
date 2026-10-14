import { ApprovalActions } from "@/components/ApprovalActions";
import { SUB_GATE_SUFFIX, SUB_GATE_MODULES, CRM_MODULES, CRM_APPROVER_ROLES, DATE_APPROVER_ROLES, MR_APPROVER_ROLES, RESTRICTED_MODULES, openInModulePath, needsBankReview } from "../config";
import type { ApprovalReviewState } from "./useApprovalReview";

// The action bar: approve / reject (or review first) across the bottom.
export function ReviewFooter({ r }: { r: ApprovalReviewState }) {
  const { item, onClose, onActionDone, navigate, cfg } = r;
  return (
    <>
      {/* Footer — the action bar, spanning full width */}
      <div className="shrink-0 border-t border-border px-5 sm:px-6 py-4 bg-muted/10 flex items-center justify-between gap-3">
        <p className="text-[0.6875rem] text-muted-foreground hidden sm:block">
          {item.Status === "Pending" ? "Review the details above before taking action." : `This record is ${item.Status.toLowerCase()}.`}
        </p>
        <ApprovalActions
          status={item.Status}
          recordId={item.RecordId}
          endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
          actionPathSuffix={SUB_GATE_SUFFIX[item.Module]}
          approverRoles={
            SUB_GATE_MODULES.has(item.Module) ? DATE_APPROVER_ROLES
            : item.Module === "crm-money-receipts" || item.Module === "crm-refund-payment" ? MR_APPROVER_ROLES
            : CRM_MODULES.has(item.Module) ? CRM_APPROVER_ROLES
            : undefined
          }
          restricted={RESTRICTED_MODULES.has(item.Module)}
          // CRM payment without a deposit bank yet: Accounts sets it on the
          // Received Payment page first — Approve here would be refused.
          reviewInstead={needsBankReview(item) && cfg?.navPath
            ? { label: "Review — set bank", onClick: () => { onClose(); navigate(openInModulePath(item, cfg.navPath)); } }
            : undefined}
          className="[&_button]:h-10 [&_button]:px-5 [&_button]:text-sm [&_button]:font-semibold [&_button]:rounded-xl"
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
