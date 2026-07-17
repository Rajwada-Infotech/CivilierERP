-- ============================================================
-- Migration 187: Agreement — Legal Executive assignment
-- The workflow spec describes two distinct people on the Agreement:
-- "a legal person will arrange/prepare the papers works" and, separately,
-- a senior approver who signs off (already built as Senior Approval).
-- No dedicated "Legal" role exists in this system's RBAC yet, so rather
-- than fabricate one, this makes the *preparer* an explicit, trackable
-- assignment on the record itself — same pattern already used for
-- CrmApplication.AssignedTo / CrmBooking.AssignedTo — so it's real,
-- visible, and notifiable, without inventing role infrastructure that
-- isn't there.
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'LegalExecutiveId')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD LegalExecutiveId INT NULL;
  PRINT 'Added CrmAgreement.LegalExecutiveId';
END
GO
