-- Migration 133: Add AssignedTo to dbo.ActivityDependency
--
-- Records who is actually responsible for that piece of dependency/progress
-- tracking — free text (matches the existing AllocatedBy/EngineerName
-- convention on ContractorAllocation), not a strict FK, since this can be
-- an internal team member or an external contractor.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ActivityDependency') AND name = 'AssignedTo'
)
BEGIN
  ALTER TABLE dbo.ActivityDependency ADD AssignedTo NVARCHAR(150) NULL;
  PRINT 'Added AssignedTo to dbo.ActivityDependency';
END
ELSE
  PRINT 'AssignedTo already exists on dbo.ActivityDependency — skipping';
GO
