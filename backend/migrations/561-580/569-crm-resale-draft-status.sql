-- Migration 569: a resale / buy-back case starts as a Draft.
--
-- Business decision 2026-10-14: a case goes to the Approval Inbox only once
-- the steps before approval are done (seller clearance, and for a resale the
-- developer NOC and the buyer's KYC / application) — "Send for approval" on
-- the case (services/crmResaleCase.js submitForApproval). Until then it is a
-- Draft. A rejected case can be fixed and sent again (Rejected -> Pending).
-- Cases already Pending / Approved / ... are untouched.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmUnitResale_Status' AND definition NOT LIKE '%Draft%')
BEGIN
  ALTER TABLE dbo.CrmUnitResale DROP CONSTRAINT CK_CrmUnitResale_Status;
  ALTER TABLE dbo.CrmUnitResale WITH NOCHECK
    ADD CONSTRAINT CK_CrmUnitResale_Status CHECK (Status IN (N'Draft', N'Pending', N'Approved', N'Completed', N'Cancelled', N'Rejected'));
END
GO
