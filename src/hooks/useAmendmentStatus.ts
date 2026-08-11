import { useQuery } from "@tanstack/react-query";
import { getApprovedAmendmentForDoc, type Amendment } from "@/api/amendmentsApi";

/**
 * Shared across every Finance/Material/Engineering transaction page that
 * participates in the Approval & Amendment workflow: before approval a
 * document is directly editable; once its own status is "Approved", Edit
 * is replaced by Amend, and once an amendment against it is itself
 * Approved, the document carries an "Approved & Amended" badge.
 *
 * `docStatus` is the transaction's own approval status (e.g.
 * WorkOrder.Status, ExpenseBooking.Status) — NOT the amendment's status.
 */
export function useAmendmentStatus(
  refDocType: string,
  refDocId: number | string | null | undefined,
  docStatus: string | null | undefined,
) {
  const id =
    refDocId == null || refDocId === "" ? null : Number(refDocId);

  const query = useQuery<Amendment | null>({
    queryKey: ["amendment-status", refDocType, id],
    queryFn: () => getApprovedAmendmentForDoc(refDocType, id as number),
    enabled: id != null && Number.isFinite(id) && docStatus === "Approved",
    staleTime: 60 * 1000,
  });

  const isApproved = docStatus === "Approved";
  const latestApprovedAmendment = query.data ?? null;
  const isAmended = isApproved && !!latestApprovedAmendment;

  return {
    /** Show the Amend button (and hide Edit) once the document is approved. */
    isApproved,
    /** Show the "Approved & Amended" badge. */
    isAmended,
    latestApprovedAmendment,
    loading: query.isFetching,
  };
}
