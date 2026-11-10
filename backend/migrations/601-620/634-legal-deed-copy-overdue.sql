-- 634: Deed Process — the deed copy uploaded against the land, and the day its overdue alert was last sent
-- (one alert a day while the timeline is passed). Schema only; safe to re-run.
IF COL_LENGTH('dbo.LegalLand', 'DeedFileId') IS NULL ALTER TABLE dbo.LegalLand ADD DeedFileId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'DeedOverdueAlertOn') IS NULL ALTER TABLE dbo.LegalLand ADD DeedOverdueAlertOn DATE NULL;
