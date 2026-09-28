-- Migration 492: backfill PreCancelStatus for activities already sitting
-- at Cancelled before migration 491 added that column — without this,
-- restoring one of them (POST /:rungId/restore) can't tell it was ever
-- actually Approved and falls back to IN_PROGRESS, even for an activity
-- that had genuinely cleared QC and its whole Approval Setup before being
-- cancelled. Going forward this is captured live the moment something is
-- cancelled (see the PATCH /:rungId/status route) — this migration only
-- catches up the rows that predate that.
--
-- "Was it really Approved" is reconstructed from the same two signals the
-- live app itself uses to decide that: no approval levels configured plus
-- a passing QC decision (QC alone was enough to finalize it), or every
-- configured level fully satisfied by recorded DependencyActivityApproval
-- rows (same satisfiedLevel logic as dependencyActivityAssignment.js's
-- own approval routes, just expressed in T-SQL via OPENJSON here).

-- Case 1: no approval levels configured — QC's own APPROVED decision was
-- enough to finalize it before, so it counts as "was Approved".
UPDATE daa
SET PreCancelStatus = 'APPROVED'
FROM dbo.DependencyActivityAssignment daa
CROSS APPLY (
  SELECT TOP 1 qc.Decision
  FROM dbo.DependencyActivityQc qc
  WHERE qc.AssignmentId = daa.Id
  ORDER BY qc.QcAt DESC, qc.Id DESC
) latest
WHERE daa.Status = 'CANCELLED'
  AND daa.PreCancelStatus IS NULL
  AND (daa.ApprovalLevelsJson IS NULL OR daa.ApprovalLevelsJson = '[]')
  AND latest.Decision = 'APPROVED';
GO

-- Case 2: approval levels configured — only counts as "was Approved" if
-- every single level is fully satisfied (mode "all": every named user
-- approved it; mode "any": at least one did).
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
  WHERE daa.Status = 'CANCELLED'
    AND daa.PreCancelStatus IS NULL
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
SET PreCancelStatus = 'APPROVED'
FROM dbo.DependencyActivityAssignment daa
JOIN AssignmentSatisfaction asat ON asat.AssignmentId = daa.Id
WHERE asat.AllLevelsSatisfied = 1;
GO

PRINT '492-backfill-precancel-status applied successfully.';
GO
