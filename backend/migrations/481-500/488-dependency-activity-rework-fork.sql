-- Migration 488: rework no longer mutates the same assignment row in
-- place — it forks a brand new one, so the redo goes through the exact
-- same Work Allocation -> Reporting -> QC -> Approval pipeline as a fresh
-- activity, while the rejected attempt is kept, untouched, as history.
-- Triggered from either QC's REWORK decision or an Approval level being
-- rejected (see the new /:rungId/approval/reject route).
--
-- This means a rung can now have MORE THAN ONE assignment row over its
-- lifetime, so the old "one assignment per rung, ever" unique constraint
-- has to go — replaced by a filtered unique index that keeps the real
-- invariant that still matters: only one CURRENT (active) attempt per rung
-- at a time. Every route that reads/writes "the" assignment for a rung
-- must now filter IsCurrent = 1, or it risks touching stale history
-- instead of (or in addition to) the live attempt.
IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UX_DependencyActivityAssignment_Rung' AND parent_object_id = OBJECT_ID('dbo.DependencyActivityAssignment')
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment DROP CONSTRAINT UX_DependencyActivityAssignment_Rung;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'IsCurrent')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD IsCurrent BIT NOT NULL CONSTRAINT DF_DependencyActivityAssignment_IsCurrent DEFAULT (1);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'AttemptNo')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD AttemptNo INT NOT NULL CONSTRAINT DF_DependencyActivityAssignment_AttemptNo DEFAULT (1);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'ReworkFromAssignmentId')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD ReworkFromAssignmentId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'ReworkReason')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD ReworkReason NVARCHAR(1000) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'ReworkSource')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD ReworkSource NVARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_ReworkSource')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD CONSTRAINT CK_DependencyActivityAssignment_ReworkSource CHECK (ReworkSource IN ('QC', 'APPROVAL'));
END
GO
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DependencyActivityAssignment_ReworkFrom'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD CONSTRAINT FK_DependencyActivityAssignment_ReworkFrom
      FOREIGN KEY (ReworkFromAssignmentId) REFERENCES dbo.DependencyActivityAssignment (Id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'UX_DependencyActivityAssignment_Rung_Current' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment')
)
BEGIN
  CREATE UNIQUE INDEX UX_DependencyActivityAssignment_Rung_Current
    ON dbo.DependencyActivityAssignment (DependencyMasterActivityId)
    WHERE IsCurrent = 1;
END
GO

PRINT '488-dependency-activity-rework-fork applied successfully.';
GO
