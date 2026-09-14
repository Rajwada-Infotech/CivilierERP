-- ============================================================
-- Migration 163: Route CRM Booking through the shared Approval Inbox
-- Bookings previously auto-landed as 'Confirmed' on creation — no admin
-- ever saw them. Same fix already applied to Application/Agreement/
-- Brokerage/Cancellation/NOC: land in 'Pending' and only move to
-- 'Approved' (or 'Rejected') via the admin/super_admin/marketing_head-
-- gated Approval Inbox. 'Confirmed' is renamed to 'Approved' to match the
-- shared approvalService.js engine's hardcoded status vocabulary.
-- ============================================================

UPDATE dbo.CrmBooking SET Status = 'Approved' WHERE Status = 'Confirmed';
GO

PRINT 'Migration 163 complete — CrmBooking routed through Approval Inbox';
