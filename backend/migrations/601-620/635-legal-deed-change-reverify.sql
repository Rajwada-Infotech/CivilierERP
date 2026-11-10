-- 635: A land already in Deed Process that is changed (data or documents) is flagged until a verifier re-verifies it;
-- Mark completed waits for that. Schema only; safe to re-run.
IF COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') IS NULL ALTER TABLE dbo.LegalLand ADD DeedChangedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedChangedBy') IS NULL ALTER TABLE dbo.LegalLand ADD DeedChangedBy INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedReverifiedAt') IS NULL ALTER TABLE dbo.LegalLand ADD DeedReverifiedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedReverifiedBy') IS NULL ALTER TABLE dbo.LegalLand ADD DeedReverifiedBy INT NULL;
