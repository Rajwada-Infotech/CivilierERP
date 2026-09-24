-- 473: Work Allocation per-engineer approval.
--
-- Adds "ALLOCATED" to the assignment status set — sits between PENDING
-- (nobody assigned yet) and IN_PROGRESS (every assigned engineer has
-- confirmed). Widening a CHECK constraint means drop + recreate, same as
-- migration 466's NVARCHAR(MAX) constraint drop pattern.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_Status')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment DROP CONSTRAINT CK_DependencyActivityAssignment_Status;
END
GO

ALTER TABLE dbo.DependencyActivityAssignment
  ADD CONSTRAINT CK_DependencyActivityAssignment_Status
    CHECK (Status IN ('PENDING', 'ALLOCATED', 'IN_PROGRESS', 'HOLD', 'CANCELLED', 'APPROVED', 'REWORK', 'COMPLETED'));
GO

-- Each assigned engineer confirms their own row individually — once every
-- row on an assignment is Approved, the parent Status moves ALLOCATED ->
-- IN_PROGRESS (see dependencyActivityAssignment.js). Kept on the existing
-- per-engineer table rather than a new one: one row already exists per
-- (AssignmentId, EngineerId) pair, which is exactly the unit a confirmation
-- attaches to.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityEngineer') AND name = 'Approved'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityEngineer
    ADD Approved BIT NOT NULL CONSTRAINT DF_DependencyActivityEngineer_Approved DEFAULT (0);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityEngineer') AND name = 'ApprovedAt'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityEngineer ADD ApprovedAt DATETIME2(3) NULL;
END
GO
