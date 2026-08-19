-- 338: Per-assignment checkpoint checklist — Work Reporting's assignment
-- popup can pull an activity's checkpoint template (Work Checkpoint Master,
-- dbo.ActivityCheckpoint) and track completion per rung, milestone-style.
-- FieldName is snapshotted at the moment it's added rather than always
-- joined live, so renaming/removing the master checkpoint later never
-- corrupts what a specific piece of work was actually checked against.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityCheckpoint' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityCheckpoint (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId INT NOT NULL,
    CheckpointId INT NULL,
    FieldName    NVARCHAR(200) NOT NULL,
    SortOrder    INT NOT NULL DEFAULT 0,
    IsChecked    BIT NOT NULL DEFAULT 0,
    CheckedAt    DATETIME2(3) NULL,
    CheckedBy    NVARCHAR(200) NULL,
    CONSTRAINT FK_DependencyActivityCheckpoint_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DependencyActivityCheckpoint_Checkpoint
      FOREIGN KEY (CheckpointId) REFERENCES dbo.ActivityCheckpoint(Id) ON DELETE SET NULL
  );
END
GO
