-- "Book / Send for Approval" on CrmBookingDetail.tsx's Review tab used to be
-- a pure UI no-op (handleFinalBook only showed a toast, called no API) —
-- staff had no way to actually signal a booking was ready; the real Approve
-- action still only lives in the Admin Approval Inbox with nothing telling
-- an approver a booking had cleared its checklist. This timestamp backs the
-- new PUT /:id/ready-for-approval route, which re-runs the exact same gate
-- already enforced in PUT /:id/approve (Unit + Plan review confirmed, and
-- the booking-amount milestone paid in full) before stamping it and
-- notifying admin/super_admin/marketing_head.
ALTER TABLE dbo.CrmBooking ADD ReadyForApprovalAt DATETIME2(3) NULL;
