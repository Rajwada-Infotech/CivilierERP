import { AmendmentDiff, type AmendmentDiffData } from "@/components/amendment/AmendmentDiff";
import type { ApprovalReviewState } from "./useApprovalReview";

/** An amendment awaiting approval (Approval Inbox module "doc-amendment"): what it changes, and down the chain. */
export function ReviewAmendment({ r, module }: { r: ApprovalReviewState; module: string }) {
  if (module !== "doc-amendment") return null;
  return <AmendmentDiff d={r.detail as AmendmentDiffData | null} />;
}
