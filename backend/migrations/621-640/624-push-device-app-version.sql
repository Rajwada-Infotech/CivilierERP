-- Migration 624: the installed build of each push-registered phone.
-- Phones now send their Android version code when they register for push
-- (POST /api/push-devices/register), so publishing a new build in APK Manager
-- can notify only the phones still on an older one. NULL = a build from before
-- phones reported this, which is older than any build that does — those phones
-- are treated as outdated.
-- Safe to re-run.

IF COL_LENGTH('dbo.PushDeviceToken', 'AppVersionCode') IS NULL
  ALTER TABLE dbo.PushDeviceToken ADD AppVersionCode INT NULL;
GO

-- Every update push is "this app's phones below version n".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushDeviceToken_App' AND object_id = OBJECT_ID('dbo.PushDeviceToken'))
  CREATE INDEX IX_PushDeviceToken_App ON dbo.PushDeviceToken (AppKey, AppVersionCode);
GO

PRINT 'Migration 624: dbo.PushDeviceToken.AppVersionCode.';
GO
