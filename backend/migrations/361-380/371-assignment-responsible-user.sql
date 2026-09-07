-- Migration 371: Responsible User on Fixed Asset Assignment.
--
-- Adds dbo.FixedAssetAssignment.ResponsibleUserId — the person responsible
-- for overseeing / monitoring the assigned asset, distinct from UserId (the
-- person the asset is assigned to). Nullable at the DB level so
-- transfer-auto-created rows and pre-existing rows stay valid; the manual
-- Assignment form enforces it as required. Owner & Quality Checking reads
-- this via the asset-context endpoint to pre-fill the follow-up's
-- Responsible User so reminders go to the right person.

IF COL_LENGTH('dbo.FixedAssetAssignment', 'ResponsibleUserId') IS NULL
  ALTER TABLE dbo.FixedAssetAssignment ADD ResponsibleUserId INT NULL
    CONSTRAINT FK_FAAsn_ResponsibleUser REFERENCES dbo.users(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAAsn_ResponsibleUserId' AND object_id = OBJECT_ID('dbo.FixedAssetAssignment'))
  CREATE INDEX IX_FAAsn_ResponsibleUserId ON dbo.FixedAssetAssignment(ResponsibleUserId);
GO

PRINT '371-assignment-responsible-user applied successfully.';
GO
