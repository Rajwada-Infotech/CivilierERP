-- Migration 322: fix — the Activity Chain's Internal/External tag was
-- rendering as a live mirror of the Step 3 toggle (every rung re-colored
-- whenever the toggle changed, even rungs added before the switch). Each
-- rung now freezes its own work type at the moment it's added to the chain,
-- so flipping the toggle later only affects activities added afterwards.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyMasterActivity') AND name = 'WorkType'
)
BEGIN
  ALTER TABLE dbo.DependencyMasterActivity
    ADD WorkType NVARCHAR(20) NOT NULL CONSTRAINT DF_DependencyMasterActivity_WorkType DEFAULT ('INTERNAL');
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyMasterActivity_WorkType'
)
BEGIN
  ALTER TABLE dbo.DependencyMasterActivity
    ADD CONSTRAINT CK_DependencyMasterActivity_WorkType CHECK (WorkType IN ('INTERNAL', 'EXTERNAL'));
END
GO

-- Backfill any existing rows to their parent record's WorkType (best
-- available signal for data that predates this column).
UPDATE dma
SET dma.WorkType = dm.WorkType
FROM dbo.DependencyMasterActivity dma
JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId;
GO

PRINT '322-dependency-master-activity-per-rung-worktype applied successfully.';
GO
