-- Migration 538: BOQ items remember which BOQ Activity they are required for.
-- ActivityId is the Activity Master id (same value stored on dbo.BoqActivities.ActivityId);
-- ActivityName is kept alongside so the item still reads correctly in lists and documents.
-- NULL = the item is not tied to an activity, so existing rows are unchanged.

IF COL_LENGTH('dbo.BoqItems', 'ActivityId') IS NULL
BEGIN
  ALTER TABLE dbo.BoqItems ADD ActivityId NVARCHAR(100) NULL;
  PRINT 'Migration 538: added BoqItems.ActivityId.';
END
GO

IF COL_LENGTH('dbo.BoqItems', 'ActivityName') IS NULL
BEGIN
  ALTER TABLE dbo.BoqItems ADD ActivityName NVARCHAR(255) NULL;
  PRINT 'Migration 538: added BoqItems.ActivityName.';
END
GO
