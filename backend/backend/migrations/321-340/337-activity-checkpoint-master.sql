-- 337: Work Checkpoint Master — a Civil Work DPR setup page where each
-- Activity (dbo.ActivityMaster, activity_type = 1) gets its own list of
-- named checkpoints (e.g. "Wall Surface Cleaned", "Curing Done") to check
-- off later during work reporting/verification. Only the template is built
-- here (create/rename/remove checkpoints per activity) — nothing yet
-- consumes these as an actual checklist to fill in; that's a later feature.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityCheckpoint' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityCheckpoint (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    ActivityId INT NOT NULL,
    FieldName  NVARCHAR(200) NOT NULL,
    SortOrder  INT NOT NULL DEFAULT 0,
    CreatedBy  NVARCHAR(200) NULL,
    CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityCheckpoint_Activity
      FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_ActivityCheckpoint_ActivityId ON dbo.ActivityCheckpoint(ActivityId);
END
GO

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'work-checkpoint-master' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('work-checkpoint-master', 'Work Checkpoint Master', 'Civil Work DPR', 'Setup Masters', 'view,create,edit,delete', 21, 1, 'migration', GETDATE());
END
GO
