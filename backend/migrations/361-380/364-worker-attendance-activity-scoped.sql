-- Migration 364: Worker Attendance — scope to the real Activity chain
--
-- Worker Attendance previously kept one Present/Absent/Half-day status per
-- worker per calendar day (UQ_WorkerAttendance_Worker_Date), referencing a
-- ContractorAllocation "for display context only" (see migration 137's own
-- comment). That means a worker could never have independent attendance
-- for two different activities on the same day, and the "activity" shown
-- was a coarse catalog allocation, not the specific dependency-chain rung
-- (Company -> Project -> Tower/Floor/Flat/Room -> Activity) the Civil Work
-- DPR module actually tracks (dbo.DependencyMasterActivity, aka a "rung" —
-- see dependencyActivityAssignment.js).
--
-- This migration:
--   1. Adds DependencyMasterActivityId to dbo.WorkerAttendance (the real
--      Activity identity going forward) and relaxes the legacy AllocationId
--      FK to nullable — new rows key off the rung, not a ContractorAllocation.
--   2. Replaces the worker+date unique constraint with worker+activity+date,
--      so the same worker can have independent attendance per activity.
--   3. Creates dbo.WorkerActivityRoster — the persistent "which workers are
--      assigned to this activity" list populated via "+ Add Worker", so a
--      worker added once keeps showing up on every subsequent day's
--      attendance form without re-adding them.
--
-- Existing WorkerAttendance rows are left as-is (DependencyMasterActivityId
-- NULL) — there's no reliable mapping from the old ContractorAllocation-based
-- rows to a specific dependency-chain rung, so no backfill is attempted.
-- SQL Server's UNIQUE constraint treats multiple NULLs as distinct, so those
-- legacy rows don't collide with each other or with new activity-scoped rows.
--
-- Safe to run multiple times (all operations guarded).

-- ── 1. DependencyMasterActivityId + relax AllocationId ──────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.WorkerAttendance') AND name = N'DependencyMasterActivityId'
)
    ALTER TABLE dbo.WorkerAttendance ADD DependencyMasterActivityId INT NULL;
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.WorkerAttendance') AND name = N'AllocationId' AND is_nullable = 0
)
    ALTER TABLE dbo.WorkerAttendance ALTER COLUMN AllocationId INT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WorkerAttendance_Rung'
)
    ALTER TABLE dbo.WorkerAttendance
        ADD CONSTRAINT FK_WorkerAttendance_Rung FOREIGN KEY (DependencyMasterActivityId)
        REFERENCES dbo.DependencyMasterActivity(Id);
GO

-- ── 2. Replace the worker+date constraint with worker+activity+date ────────
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_WorkerAttendance_Worker_Date' AND parent_object_id = OBJECT_ID(N'dbo.WorkerAttendance')
)
    ALTER TABLE dbo.WorkerAttendance DROP CONSTRAINT UQ_WorkerAttendance_Worker_Date;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_WorkerAttendance_Worker_Activity_Date' AND parent_object_id = OBJECT_ID(N'dbo.WorkerAttendance')
)
    ALTER TABLE dbo.WorkerAttendance
        ADD CONSTRAINT UQ_WorkerAttendance_Worker_Activity_Date
        UNIQUE (WorkerId, DependencyMasterActivityId, AttendanceDate);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_WorkerAttendance_Rung' AND object_id = OBJECT_ID('dbo.WorkerAttendance')
)
    CREATE INDEX IX_WorkerAttendance_Rung ON dbo.WorkerAttendance (DependencyMasterActivityId);
GO

-- ── 3. Persistent per-activity worker roster ("+ Add Worker") ───────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'WorkerActivityRoster'
)
BEGIN
    CREATE TABLE dbo.WorkerActivityRoster (
        RosterId                   INT IDENTITY(1,1) PRIMARY KEY,
        WorkerId                   INT NOT NULL,
        DependencyMasterActivityId INT NOT NULL,
        IsActive                   BIT NOT NULL DEFAULT 1,
        CreatedBy                  NVARCHAR(150) NULL,
        CreatedAt                  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_WorkerActivityRoster_Worker FOREIGN KEY (WorkerId) REFERENCES dbo.Worker(WorkerId),
        CONSTRAINT FK_WorkerActivityRoster_Rung FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id),
        CONSTRAINT UQ_WorkerActivityRoster UNIQUE (WorkerId, DependencyMasterActivityId)
    );
    CREATE INDEX IX_WorkerActivityRoster_Rung ON dbo.WorkerActivityRoster (DependencyMasterActivityId);
    PRINT 'Created dbo.WorkerActivityRoster';
END
GO

PRINT '================================================================';
PRINT '364-worker-attendance-activity-scoped applied successfully.';
PRINT '================================================================';
GO
