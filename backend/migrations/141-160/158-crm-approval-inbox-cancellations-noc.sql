-- ============================================================
-- Migration 158: Route CrmCancellation and CrmNoc approvals through
-- the shared Approval Inbox too (same fix as migration 157, extended
-- to the two other self-service approval flows in the CRM module).
-- Also tightens all CRM approver roles to admin/super_admin/
-- marketing_head only (dba excluded), per explicit requirement.
-- ============================================================

-- CrmCancellation: 'Requested' is renamed to 'Pending' to match the
-- engine's hardcoded status vocabulary (Draft/Rejected -> Pending -> Approved/Rejected).
UPDATE dbo.CrmCancellation SET Status = 'Pending' WHERE Status = 'Requested';
GO
