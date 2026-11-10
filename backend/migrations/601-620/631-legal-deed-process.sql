-- 631: Final verification → Deed Process (replaces the per-section ticks and L1/L2 approval of a land).
-- The verifier sets one timeline (deed to be done by) and sends the land to the deed department. Schema only.
IF COL_LENGTH('dbo.LegalLand', 'FinalVerifiedBy') IS NULL ALTER TABLE dbo.LegalLand ADD FinalVerifiedBy INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'FinalVerifiedAt') IS NULL ALTER TABLE dbo.LegalLand ADD FinalVerifiedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedTargetDate') IS NULL ALTER TABLE dbo.LegalLand ADD DeedTargetDate DATE NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedCompletedAt') IS NULL ALTER TABLE dbo.LegalLand ADD DeedCompletedAt DATETIME2 NULL;
