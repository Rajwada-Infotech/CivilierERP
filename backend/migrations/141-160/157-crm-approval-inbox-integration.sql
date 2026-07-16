-- ============================================================
-- Migration 157: Route CRM approvals through the shared Approval Inbox
-- Previously, CrmApplication approve/reject, CrmAgreement senior-approve,
-- and CrmBrokerageMaster approve were all self-service — any user with
-- edit rights on that page could approve their own record. This aligns
-- their status vocabulary with the generic approvalService.js engine
-- (Draft/Rejected -> Pending -> Approved/Rejected) so approve/reject can
-- only happen through the same admin/super_admin/dba-gated flow every
-- other module (BOQ, Purchase Orders, ...) already uses, from the Admin
-- Approval Inbox.
-- ============================================================

-- CrmApplication: 'Submitted' is renamed to 'Pending' to match the engine's
-- hardcoded status vocabulary.
UPDATE dbo.CrmApplication SET Status = 'Pending' WHERE Status = 'Submitted';
GO
