-- 633: Deed Process timeline columns. 641 ran on some databases in an earlier form (before the single timeline date),
-- so these are added again here. Schema only; safe to re-run.
IF COL_LENGTH('dbo.LegalLand', 'FinalVerifiedBy') IS NULL ALTER TABLE dbo.LegalLand ADD FinalVerifiedBy INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'FinalVerifiedAt') IS NULL ALTER TABLE dbo.LegalLand ADD FinalVerifiedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedTargetDate') IS NULL ALTER TABLE dbo.LegalLand ADD DeedTargetDate DATE NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedCompletedAt') IS NULL ALTER TABLE dbo.LegalLand ADD DeedCompletedAt DATETIME2 NULL;
