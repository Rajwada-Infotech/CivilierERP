-- 638: Deed Registration — an approver applies for registration (who / when kept), then uploads the registered deed
-- copy and submits; the land is then "Registered" and shows in Land & Projects. Schema only; safe to re-run.
IF COL_LENGTH('dbo.LegalLand', 'RegAppliedBy') IS NULL ALTER TABLE dbo.LegalLand ADD RegAppliedBy INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegAppliedAt') IS NULL ALTER TABLE dbo.LegalLand ADD RegAppliedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegDeedFileId') IS NULL ALTER TABLE dbo.LegalLand ADD RegDeedFileId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegCompletedBy') IS NULL ALTER TABLE dbo.LegalLand ADD RegCompletedBy INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'RegCompletedAt') IS NULL ALTER TABLE dbo.LegalLand ADD RegCompletedAt DATETIME2 NULL;
