-- Migration 540: a BOQ activity is picked Activity Group -> Activity, so remember the group.
-- GroupId is the Activity Master group id (type 0); GroupName is kept alongside so the
-- BOQ reads correctly even if the group is later renamed. NULL on rows saved before groups
-- were recorded (the screen falls back to the activity's own group).

IF COL_LENGTH('dbo.BoqActivities', 'GroupId') IS NULL
BEGIN
  ALTER TABLE dbo.BoqActivities ADD GroupId NVARCHAR(100) NULL;
  PRINT 'Migration 540: added BoqActivities.GroupId.';
END
GO

IF COL_LENGTH('dbo.BoqActivities', 'GroupName') IS NULL
BEGIN
  ALTER TABLE dbo.BoqActivities ADD GroupName NVARCHAR(255) NULL;
  PRINT 'Migration 540: added BoqActivities.GroupName.';
END
GO
