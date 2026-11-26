-- A reminder may only be activated after its CURRENT saved version has been
-- previewed.  This makes the "Check first" promise enforceable by the API,
-- not merely a browser convention.
IF COL_LENGTH('dbo.CrmReminderRule', 'LastPreviewedAt') IS NULL
  ALTER TABLE dbo.CrmReminderRule ADD LastPreviewedAt DATETIME2 NULL;
GO

-- Existing active rules predate this safeguard.  Do not interrupt them; they
-- were deliberately enabled before the preview gate existed.  Any subsequent
-- edit clears the effective preview because UpdatedAt becomes newer.
UPDATE dbo.CrmReminderRule
SET LastPreviewedAt = COALESCE(UpdatedAt, CreatedAt, SYSDATETIME())
WHERE IsActive = 1 AND LastPreviewedAt IS NULL;
GO
