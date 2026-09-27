-- Migration 485: one-time backfill for a bug in the old auto status
-- transition — assigning an engineer used to move PENDING -> ALLOCATED
-- (an "awaiting confirmation" step that's since been removed), but when
-- that transition was changed to go straight to IN_PROGRESS, the
-- transition only ever checked for a starting status of PENDING, not the
-- pre-existing ALLOCATED rows already sitting in the table — so every
-- activity allocated before that change stayed stuck at ALLOCATED forever,
-- even once it clearly had engineers on it. This migration only fixes the
-- data already in the table; dependencyActivityAssignment.js's own POST
-- /:rungId now also treats ALLOCATED as PENDING's equivalent starting
-- state, so this can't recur going forward.
UPDATE daa
SET Status = 'IN_PROGRESS'
FROM dbo.DependencyActivityAssignment daa
WHERE daa.Status = 'ALLOCATED'
  AND EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer dae WHERE dae.AssignmentId = daa.Id);
GO

-- Any ALLOCATED row that somehow has no engineer at all doesn't fit
-- either state cleanly — treat it as not-yet-started.
UPDATE daa
SET Status = 'PENDING'
FROM dbo.DependencyActivityAssignment daa
WHERE daa.Status = 'ALLOCATED'
  AND NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer dae WHERE dae.AssignmentId = daa.Id);
GO

PRINT '485-backfill-allocated-status applied successfully.';
GO
