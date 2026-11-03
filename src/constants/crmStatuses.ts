export const CrmStatus = {
  // Core Lifecycle
  DRAFT: 'Draft',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  
  // Bookings / Units
  ACTIVE: 'Active',
  BOOKED: 'Booked',
  
  // Finance / Payments / Refunds
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partially Paid',
  VOIDED: 'Voided',
  REFUNDED: 'Refunded',
  FINANCE_PENDING: 'FinancePending',
  DEMANDED: 'Demanded',
  CLAWBACK_REQUIRED: 'Clawback Required',
  
  // Legal / Agreements
  EXECUTED: 'Executed',
  REGISTERED: 'Registered',
  PENDING_CUSTOMER_REVIEW: 'PendingCustomerReview',
  
  // Tickets / Support
  OPEN: 'Open',
  IN_PROGRESS: 'InProgress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed'
} as const;

export type CrmStatusType = typeof CrmStatus[keyof typeof CrmStatus];

// Booking approval stages (CrmBooking.WorkflowStage) -> what staff read. "Data Review" is
// the name the booking screen, its checklist and its Verify & Send button use.
// The booking's first stage: until it leaves Data Review (verified and sent
// for approval) its application may still change unit, plan and rate.
export const BOOKING_STAGE_REVIEW = 'Review';
export const bookingWorkflowStageLabel: Record<string, string> = {
  Review: 'Data Review',
  MarketingHeadApproval: 'Marketing Head Approval',
  DirectorApproval: 'Director Approval',
  Confirmed: 'Confirmed',
};

/**
 * After a booking approval sends a booking back one stage: who sent it, whose
 * turn it is now, and whether that turn is correcting the application (only
 * when it went back to Data Review — from an approval stage it is that
 * approver's to approve again, or to send further back for correction).
 */
export function bookingSendBack(stageNow: string | null | undefined, fromStage: string | null | undefined) {
  const who = (stage?: string | null) => (stage ? (bookingWorkflowStageLabel[stage] || stage).replace(/ Approval$/, "") : "an approver");
  const toReview = !stageNow || stageNow === BOOKING_STAGE_REVIEW;
  return {
    from: who(fromStage),
    now: toReview ? "the application's preparer" : who(stageNow),
    preparerCorrects: toReview,
    next: toReview
      ? "Correct the application, then verify the Data Review and send it for approval again."
      : `Now with the ${who(stageNow)} to approve again — or to send it back to Data Review if the application needs correcting.`,
  };
}

// A booking in one of these has ended — no stage, checklist or approval applies to it any more.
export const BOOKING_CLOSED_STATUSES: readonly string[] = [CrmStatus.CANCELLED, CrmStatus.REJECTED, 'Expired', 'Transferred'];
export const isBookingClosed = (status: string | null | undefined) => !!status && BOOKING_CLOSED_STATUSES.includes(status);
