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
export const bookingWorkflowStageLabel: Record<string, string> = {
  Review: 'Data Review',
  MarketingHeadApproval: 'Marketing Head Approval',
  DirectorApproval: 'Director Approval',
  Confirmed: 'Confirmed',
};

// A booking in one of these has ended — no stage, checklist or approval applies to it any more.
export const BOOKING_CLOSED_STATUSES: readonly string[] = [CrmStatus.CANCELLED, CrmStatus.REJECTED, 'Expired', 'Transferred'];
export const isBookingClosed = (status: string | null | undefined) => !!status && BOOKING_CLOSED_STATUSES.includes(status);
