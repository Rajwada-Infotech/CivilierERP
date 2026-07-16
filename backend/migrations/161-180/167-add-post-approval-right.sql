-- Migration 167: Real "Post Approval" right
--
-- approvalService.guardEdit() blocks editing any record once it reaches
-- Approved status, across 7 modules (JournalVoucher, GRN, ExpenseBooking,
-- PurchaseOrders, WorkOrderHeader, BOQ, WorkDone). "Post Approval Rights"
-- previously had a UI toggle that did nothing — no backend at all. This
-- adds a real per-page "post-approval" action: a role/user granted it can
-- bypass guardEdit's Approved-status block for that specific page (Pending
-- records still require Reject-first, unchanged).

-- 1) Role-level column (per-user is already free-form JSON in
--    UserPageRightsJson — no schema change needed there).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.RoleRights') AND name = N'CanPostApproval'
)
BEGIN
  ALTER TABLE dbo.RoleRights ADD CanPostApproval BIT NOT NULL CONSTRAINT DF_RoleRights_CanPostApproval DEFAULT 0;
  PRINT 'Added dbo.RoleRights.CanPostApproval';
END
ELSE
  PRINT 'dbo.RoleRights.CanPostApproval already exists';
GO

-- 2) Make "post-approval" a selectable action on the 7 guardEdit-gated pages
--    so it shows up as a real checkbox column in Menu Rights / Post Approval
--    Rights instead of a dead toggle.
UPDATE dbo.PageDefinitions
SET Actions = Actions + ',post-approval'
WHERE PageKey IN ('journal-voucher','grn-master','expense-booking','purchase-orders','work-order','boq','engineering-work-order')
  AND CHARINDEX('post-approval', Actions) = 0;

PRINT 'Updated PageDefinitions.Actions for post-approval-eligible pages';
GO

SELECT PageKey, Label, Actions FROM dbo.PageDefinitions
WHERE PageKey IN ('journal-voucher','grn-master','expense-booking','purchase-orders','work-order','boq','engineering-work-order');
GO
