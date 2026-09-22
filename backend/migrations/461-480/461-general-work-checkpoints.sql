-- Migration 461: Work Checkpoint Master becomes ONE general list.
--
-- Checkpoints used to be defined per activity (dbo.ActivityCheckpoint.ActivityId).
-- They're now a shared pool that Work Allocation picks from for any activity, so
-- ActivityId is no longer needed on new rows.
--
-- Existing per-activity rows are folded into the general list:
--   * ActivityId becomes NULL everywhere (column kept, nullable, for history);
--   * the same checkpoint defined under several activities (same name, same wait
--     days) collapses to a single row. Checklists already attached to a rung keep
--     working — DependencyActivityCheckpoint.CheckpointId is re-pointed to the
--     surviving row, and those checklists snapshot FieldName/MinWaitDays anyway.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ActivityCheckpoint') AND name = 'ActivityId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.ActivityCheckpoint ALTER COLUMN ActivityId INT NULL;
END
GO

-- Re-point attached checklists at the survivor of each duplicate group, then drop the duplicates.
;WITH Ranked AS (
  SELECT Id,
         MIN(Id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(FieldName))), ISNULL(MinWaitDays, -1)) AS KeepId
  FROM dbo.ActivityCheckpoint
)
UPDATE d
   SET d.CheckpointId = r.KeepId
  FROM dbo.DependencyActivityCheckpoint d
  JOIN Ranked r ON r.Id = d.CheckpointId
 WHERE r.Id <> r.KeepId;
GO

;WITH Ranked AS (
  SELECT Id,
         MIN(Id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(FieldName))), ISNULL(MinWaitDays, -1)) AS KeepId
  FROM dbo.ActivityCheckpoint
)
DELETE c
  FROM dbo.ActivityCheckpoint c
  JOIN Ranked r ON r.Id = c.Id
 WHERE r.Id <> r.KeepId;
GO

-- Detach from activities: the FK cascades on activity delete, which must no longer
-- take shared checkpoints with it.
UPDATE dbo.ActivityCheckpoint SET ActivityId = NULL WHERE ActivityId IS NOT NULL;
GO

-- Tidy the sort order into one dense list (alphabetical is the least surprising
-- starting point once several activities' lists have been merged).
;WITH Ordered AS (
  SELECT Id, ROW_NUMBER() OVER (ORDER BY FieldName, Id) * 10 AS NewSort
  FROM dbo.ActivityCheckpoint
)
UPDATE c SET c.SortOrder = o.NewSort
  FROM dbo.ActivityCheckpoint c
  JOIN Ordered o ON o.Id = c.Id;
GO

PRINT '461-general-work-checkpoints applied successfully.';
GO
