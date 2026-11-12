const CrmStatus = {
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
};

// Status of a booking LINE (dbo.CrmBookingUnit / dbo.CrmBookingPlot).
//
// Deliberately constants and not an editable master. A kind (dbo.ProjectTypeMaster,
// dbo.CrmConstructedAssetKind) CARRIES a behaviour flag the code reads, so a new
// row works with no code change. A status IS the behaviour: code frees a plot on
// Transferred and stops counting it on Cancelled. An editable status table would
// let a rename silently break every query that filters on it, and a newly added
// status would have no behaviour at all.
//
// Must stay identical to CK_CrmBookingUnit_Status (migrations 505 / 506).
// test/statusConstants.test.js fails if the two drift apart.
const LineStatus = Object.freeze({
  ACTIVE: 'Active',
  CANCELLED: 'Cancelled',
  // A resale moved the line to a new owner. Not Cancelled: nothing was undone,
  // the original sale stands and the original buyer was paid.
  TRANSFERRED: 'Transferred',
});

// Status of a resale (dbo.CrmUnitResale). Must stay identical to
// CK_CrmUnitResale_Status (migration 506) — pinned by the same test.
const ResaleStatus = Object.freeze({
  PENDING: 'Pending',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
});

// A booking in one of these statuses no longer counts: it holds no inventory,
// owes no dues, gets no deed or possession, and is not a sale in any report.
// Expired (never confirmed) and Transferred (resold to a new owner) are as
// dead as Cancelled and Rejected — every "live booking" filter uses this one
// list, so a new terminal status is added here once instead of in 60 queries.
const DEAD_BOOKING_STATUSES = Object.freeze(["Cancelled", "Rejected", "Expired", "Transferred"]);
const DEAD_BOOKING_SQL = `(${DEAD_BOOKING_STATUSES.map((s) => `N'${s}'`).join(", ")})`;

// A refund (dbo.CrmRefund) in one of these statuses was dropped: it no longer claims the money it was raised against,
// so a new refund or a re-booking can use that money. Withdrawn = taken back before approval (with a reason); Cancelled
// is kept for older rows. Every "is this money still claimed" check reads these lists, so a status is added here once.
const REFUND_DROPPED_STATUSES = Object.freeze(["Rejected", "Withdrawn", "Cancelled"]);
// Dropped, or finished (Paid: the money is spent through AppliedAmount): no longer a live claim on the credit.
const REFUND_CLOSED_STATUSES = Object.freeze([...REFUND_DROPPED_STATUSES, "Paid"]);
// The RERA refund due date stops running once a refund is paid or withdrawn (a rejected one is still owed).
const REFUND_DUE_STOPPED_STATUSES = Object.freeze(["Paid", "Withdrawn"]);
const sqlList = (xs) => `(${xs.map((s) => `N'${s}'`).join(", ")})`;
const REFUND_DROPPED_SQL = sqlList(REFUND_DROPPED_STATUSES);
const REFUND_CLOSED_SQL = sqlList(REFUND_CLOSED_STATUSES);
const REFUND_DUE_STOPPED_SQL = sqlList(REFUND_DUE_STOPPED_STATUSES);

module.exports = {
  CrmStatus, LineStatus, ResaleStatus, DEAD_BOOKING_STATUSES, DEAD_BOOKING_SQL,
  REFUND_DROPPED_STATUSES, REFUND_CLOSED_STATUSES, REFUND_DUE_STOPPED_STATUSES, REFUND_DROPPED_SQL, REFUND_CLOSED_SQL, REFUND_DUE_STOPPED_SQL,
};
