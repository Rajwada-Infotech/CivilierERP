-- Migration 549: dbo.SystemMaintenance.StartsAt.
-- Migration 548 first shipped without this column; databases that already ran 548 do not run it again, so the
-- column is added here. StartsAt = when maintenance actually begins holding people (the countdown strip is shown
-- from the moment it is switched on until then). NULL = held at once. Safe to run on a database that already has it.

IF OBJECT_ID('dbo.SystemMaintenance', 'U') IS NOT NULL AND COL_LENGTH('dbo.SystemMaintenance', 'StartsAt') IS NULL
BEGIN
  ALTER TABLE dbo.SystemMaintenance ADD StartsAt DATETIME2 NULL;
  PRINT 'Migration 549: added SystemMaintenance.StartsAt.';
END
GO
