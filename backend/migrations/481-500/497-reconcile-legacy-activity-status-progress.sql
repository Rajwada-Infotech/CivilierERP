-- 497: Reconcile Work Allocation rows left behind by the pre-rework-fork
-- code, which let Status and ProgressPercent drift apart. The current
-- rules (routes/dependencyActivityAssignment.js):
--   * COMPLETED is only ever set by dragging work to 100%
--   * QC can only run on a COMPLETED activity, and a QC pass keeps it at
--     COMPLETED ("QC Passed") until a separate Approve moves it to APPROVED
--   * progress only moves forward and is locked once COMPLETED
-- None of the rows below can be produced by that code any more; they are
-- legacy data. Rule-based, not Id-based, and idempotent — each UPDATE only
-- matches rows still in the invalid state.

-- 1) Finished work (COMPLETED/APPROVED) whose latest QC passed but whose
--    progress was never brought to 100% (e.g. rows migration 493 moved
--    from APPROVED back to COMPLETED without touching progress).
UPDATE a
SET ProgressPercent = 100, UpdatedBy = 'migration-497', UpdatedAt = SYSDATETIME()
FROM dbo.DependencyActivityAssignment a
CROSS APPLY (
  SELECT TOP 1 q.Decision FROM dbo.DependencyActivityQc q
  WHERE q.AssignmentId = a.Id ORDER BY q.QcAt DESC, q.Id DESC
) lastQc
WHERE a.IsCurrent = 1
  AND a.Status IN ('COMPLETED', 'APPROVED')
  AND ISNULL(a.ProgressPercent, 0) < 100
  AND lastQc.Decision = 'APPROVED';
GO

-- 2) Work reported at 100% but left In Progress. Reaching 100% is exactly
--    what sets COMPLETED today; that is also the state a QC pass lands on.
UPDATE dbo.DependencyActivityAssignment
SET Status = 'COMPLETED', UpdatedBy = 'migration-497', UpdatedAt = SYSDATETIME()
WHERE IsCurrent = 1
  AND Status = 'IN_PROGRESS'
  AND ProgressPercent = 100;
GO
