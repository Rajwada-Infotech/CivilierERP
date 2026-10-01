-- Migration 499: real per-day logbook entries for Civil Work DPR's
-- Reporting/Work Allocation activities — Remarks + Progress% used to be a
-- single mutable value per activity (DependencyActivityAssignment), with
-- DependencyActivityProgressLog only an append-only audit trail of changes
-- (you can't independently re-edit "Tuesday's entry" through it — there's
-- only ever one current value). This table is the actual daily record:
-- one row per (activity, date), independently created/updated without
-- touching any other day's row.
--
-- DependencyActivityAssignment stays as the "current snapshot" every
-- existing badge/status-tile/filter already reads — the daily-log write
-- route updates it to mirror whichever date is the MOST RECENT logged
-- entry, so nothing else in the app needs to change to keep working.
--
-- ActivityPhoto gets a nullable LogDate — existing rows stay NULL (shown
-- under an "earlier / undated" bucket), new uploads are tagged with the
-- date they were taken for, matching how Attendance already scopes by day
-- (dbo.WorkerAttendance.AttendanceDate).

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityDailyLog' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.DependencyActivityDailyLog (
    Id                          INT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterActivityId INT NOT NULL,
    LogDate                     DATE NOT NULL,
    ProgressPercent             INT NULL,
    Remarks                     NVARCHAR(1000) NULL,
    CreatedBy                   NVARCHAR(200) NULL,
    CreatedAt                   DATETIME2(3) NOT NULL CONSTRAINT DF_DADailyLog_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy                   NVARCHAR(200) NULL,
    UpdatedAt                   DATETIME2(3) NULL,
    CONSTRAINT FK_DADailyLog_Rung
      FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id) ON DELETE CASCADE,
    CONSTRAINT UX_DADailyLog_Rung_Date UNIQUE (DependencyMasterActivityId, LogDate),
    CONSTRAINT CK_DADailyLog_Progress CHECK (ProgressPercent IS NULL OR ProgressPercent BETWEEN 0 AND 100)
  );
  CREATE INDEX IX_DADailyLog_Rung ON dbo.DependencyActivityDailyLog (DependencyMasterActivityId, LogDate DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ActivityPhoto') AND name = 'LogDate'
)
BEGIN
  ALTER TABLE dbo.ActivityPhoto ADD LogDate DATE NULL;
END
GO

PRINT '499-dependency-activity-daily-log completed.';
GO
