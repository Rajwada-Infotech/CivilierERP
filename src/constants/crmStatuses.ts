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

// The statutory names, as RERA 2016 s.11(4)(b) and the competent authorities use them. Stored codes stay OC / CC / OC+CC
// and Applied / Received; every screen shows these words.
export const CERTIFICATE_TERMS = {
  PAGE: 'Occupancy & Completion Certificates',
  MENU: 'Occupancy & Completion',
  ONE: 'Occupancy or Completion Certificate',
} as const;
export const POSSESSION_PAGE = 'Possession & Handover';
export const CERT_TYPE_LABEL: Record<string, string> = {
  OC: 'Occupancy Certificate',
  CC: 'Completion Certificate',
  'OC+CC': 'Occupancy and Completion Certificate',
};
export const CERT_STATUS_LABEL: Record<string, string> = { Applied: 'Application filed', Received: 'Issued' };

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
const stageWho = (stage?: string | null) => (stage ? (bookingWorkflowStageLabel[stage] || stage).replace(/ Approval$/, "") : "an approver");

export function bookingSendBack(stageNow: string | null | undefined, fromStage: string | null | undefined) {
  const who = stageWho;
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

/**
 * Every send-back of this round, oldest first — so a reason given by the
 * Director is still read after the Marketing Head sends it further back. Read
 * from the booking's stage log (newest first; each row is the stage it moved
 * TO, so the stage it was sent back FROM is the row before). A round starts
 * at the last send for approval.
 */
export function bookingSendBackChain(history: any[] | null | undefined) {
  const asc = [...(history || [])].reverse();
  const start = asc.map((h) => h.Action).lastIndexOf("SubmittedForApproval");
  const chain: { from: string; to: string; remark: string; byName: string | null; at: string | null }[] = [];
  for (let i = Math.max(start, 0); i < asc.length; i++) {
    if (asc[i].Action !== "BouncedBackForCorrection") continue;
    chain.push({
      from: stageWho(asc[i - 1]?.Stage), to: stageWho(asc[i].Stage),
      remark: asc[i].Remarks || "", byName: asc[i].ActorName || null, at: asc[i].CreatedAt || null,
    });
  }
  return chain;
}

/**
 * The send-back choices the server allows from a stage (stageState.SendBackTo
 * or an inbox row's SendBackTo — default first), worded for the person
 * sending it. Whichever is chosen, every approval after it is cleared: the
 * booking passes each later level again.
 */
export function bookingSendBackChoices(targets: string[] | string | null | undefined) {
  const list = (Array.isArray(targets) ? targets : String(targets || "").split(",")).filter(Boolean);
  return list.map((to) => to === BOOKING_STAGE_REVIEW
    ? { value: to, label: "To Data Review", note: "the application needs correcting — it is then verified and approved at every level again" }
    : { value: to, label: `To the ${stageWho(to)}`, note: "to approve again, or send it further back" });
}

// A booking in one of these has ended — no stage, checklist or approval applies to it any more.
export const BOOKING_CLOSED_STATUSES: readonly string[] = [CrmStatus.CANCELLED, CrmStatus.REJECTED, 'Expired', 'Transferred', 'UnitChanged'];
export const isBookingClosed = (status: string | null | undefined) => !!status && BOOKING_CLOSED_STATUSES.includes(status);
