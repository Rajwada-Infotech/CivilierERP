-- Migration 615: dbo.SystemMaintenance.Variant.
-- Which page the held users see while the switch is on: 'maintenance' (the countdown page, the default) or
-- 'unavailable' (a plain 404 page, used when the cloud bill is unpaid and nobody should be told why).
-- NULL reads as 'maintenance'. Safe to run on a database that already has it.

IF OBJECT_ID('dbo.SystemMaintenance', 'U') IS NOT NULL AND COL_LENGTH('dbo.SystemMaintenance', 'Variant') IS NULL
BEGIN
  ALTER TABLE dbo.SystemMaintenance ADD Variant NVARCHAR(20) NULL;
  PRINT 'Migration 615: added SystemMaintenance.Variant.';
END
GO
