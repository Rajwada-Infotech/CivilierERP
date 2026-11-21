-- Legal: one clean route.
--   Data entry → "Submit for verification" → Land verification (verifier ticks sections) → Versions (Approver) → version.
--   The first approved version of a draft land moves it to Deed Process; there the user asks for final approval → Deed approval.
--   A registered land changes only through an amendment: once the request is approved the land opens for editing, and
--   the edits come back through verification and approval as the next version (no new deed process).
IF COL_LENGTH('dbo.LegalLandReview', 'EntrySubmittedBy') IS NULL
  ALTER TABLE dbo.LegalLandReview ADD EntrySubmittedBy INT NULL, EntrySubmittedAt DATETIME2 NULL, AmendmentId INT NULL;
GO
IF COL_LENGTH('dbo.LegalLand', 'DeedApprovalRequestedAt') IS NULL
  ALTER TABLE dbo.LegalLand ADD DeedApprovalRequestedAt DATETIME2 NULL, DeedApprovalRequestedBy INT NULL;
GO
-- Amendment: Open = approved, the land is open for editing; Completed = the edits were approved as a version.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalLandAmendment_Status')
  ALTER TABLE dbo.LegalLandAmendment DROP CONSTRAINT CK_LegalLandAmendment_Status;
ALTER TABLE dbo.LegalLandAmendment ADD CONSTRAINT CK_LegalLandAmendment_Status
  CHECK (Status IN (N'Pending', N'Approved', N'Open', N'Completed', N'Rejected', N'Withdrawn'));
GO
