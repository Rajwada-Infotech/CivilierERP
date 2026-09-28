-- Migration 493: corrects a real bug in POST /:rungId/approval/approve
-- (dependencyActivityAssignment.js) — "fully approved" was decided purely
-- by whether the level just acted on was the LAST one by position, not
-- whether it was actually satisfied. For a mode "all" level with several
-- named approvers, that meant the activity flipped to Status = APPROVED
-- the moment the FIRST of several required people approved it, as long as
-- that level happened to be the last one configured.
--
-- This reverts every currently-APPROVED assignment whose configured
-- levels genuinely aren't all satisfied back to COMPLETED (still QC-
-- passed, correctly back to awaiting the rest of its approval chain) —
-- same satisfiedLevel logic the fixed route itself now uses, expressed in
-- T-SQL via OPENJSON, same shape as migration 492's own backfill.
;WITH LevelData AS (
  SELECT
    daa.Id AS AssignmentId,
    JSON_VALUE(lvl.value, '$.id') AS LevelId,
    JSON_VALUE(lvl.value, '$.mode') AS Mode,
    (
      SELECT COUNT(*) FROM OPENJSON(JSON_QUERY(lvl.value, '$.userIds'))
    ) AS TotalUsers,
    (
      SELECT COUNT(*)
      FROM OPENJSON(JSON_QUERY(lvl.value, '$.userIds')) u
      JOIN dbo.DependencyActivityApproval a
        ON a.AssignmentId = daa.Id
       AND a.LevelId = JSON_VALUE(lvl.value, '$.id')
       AND a.ApproverUserId = TRY_CAST(u.value AS INT)
    ) AS ApprovedUsers
  FROM dbo.DependencyActivityAssignment daa
  CROSS APPLY OPENJSON(daa.ApprovalLevelsJson) lvl
  WHERE daa.Status = 'APPROVED'
    AND daa.ApprovalLevelsJson IS NOT NULL
    AND daa.ApprovalLevelsJson <> '[]'
),
AssignmentSatisfaction AS (
  SELECT
    AssignmentId,
    MIN(CASE WHEN (Mode = 'any' AND ApprovedUsers > 0) OR (Mode <> 'any' AND ApprovedUsers = TotalUsers) THEN 1 ELSE 0 END) AS AllLevelsSatisfied
  FROM LevelData
  GROUP BY AssignmentId
)
UPDATE daa
SET Status = 'COMPLETED', UpdatedBy = 'migration-493', UpdatedAt = SYSDATETIME()
FROM dbo.DependencyActivityAssignment daa
JOIN AssignmentSatisfaction asat ON asat.AssignmentId = daa.Id
WHERE asat.AllLevelsSatisfied = 0;
GO

PRINT '493-fix-premature-approvals applied successfully.';
GO
