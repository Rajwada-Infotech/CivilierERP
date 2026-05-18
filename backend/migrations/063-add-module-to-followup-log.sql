IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME = 'FollowupLog'
    AND COLUMN_NAME = 'Module'
)
BEGIN
  ALTER TABLE dbo.FollowupLog
    ADD Module NVARCHAR(100) NULL;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_FollowupLog_Module'
    AND object_id = OBJECT_ID('dbo.FollowupLog')
)
BEGIN
  CREATE INDEX IX_FollowupLog_Module ON dbo.FollowupLog(Module);
END

PRINT 'Followup log module migration applied successfully';
