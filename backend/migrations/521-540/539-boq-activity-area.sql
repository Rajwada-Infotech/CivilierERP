-- Migration 539: BOQ activities carry a Total Area.
-- With the activity's Total Qty it is the basis for the BOQ screen's per-unit figures
-- (Per Activity Price = amount / area, or / qty when no area; each item's Per Unit Qty =
-- item qty / the same basis). NULL = no area entered, so existing rows are unchanged.

IF COL_LENGTH('dbo.BoqActivities', 'Area') IS NULL
BEGIN
  ALTER TABLE dbo.BoqActivities ADD Area DECIMAL(18,4) NULL;
  PRINT 'Migration 539: added BoqActivities.Area.';
END
GO
