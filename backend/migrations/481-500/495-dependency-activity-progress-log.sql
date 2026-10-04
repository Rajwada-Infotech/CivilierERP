-- Migration 495: per-update audit trail for an assignment's progress-bar
-- and Remarks changes (Civil Work DPR's Work Reporting) — who touched it
-- and when, shown as a history list in the Activity Detail modal below
-- the progress bar. Every PATCH /:rungId/status call that actually
-- changes ProgressPercent and/or Remarks logs one row here (dependencyActivityAssignment.js).
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityProgressLog' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.DependencyActivityProgressLog (
    Id                 INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId       INT            NOT NULL,
    FromProgressPercent  INT          NULL,
    ToProgressPercent    INT          NULL,
    Remarks            NVARCHAR(1000) NULL,
    StatusAfter        NVARCHAR(20)   NULL,
    LoggedBy           NVARCHAR(200)  NULL,
    LoggedAt           DATETIME2(3)   NOT NULL CONSTRAINT DF_DAProgressLog_LoggedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_DAProgressLog_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment (Id)
  );
  CREATE INDEX IX_DAProgressLog_Assignment ON dbo.DependencyActivityProgressLog (AssignmentId, LoggedAt DESC);
END
GO

PRINT '495-dependency-activity-progress-log applied successfully.';
GO
