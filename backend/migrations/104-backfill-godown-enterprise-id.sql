-- ============================================================
-- Migration 104: Back-fill Godowns.EnterpriseID from project
--
-- Godowns created before the Company→Project→Godown cascade
-- was enforced may have ProjectID set but EnterpriseID = NULL.
-- This migration derives EnterpriseID from the linked project's
-- company_id (or belongs_to) so the frontend filter works
-- correctly without requiring a SQL recompute every GET call.
-- ============================================================

SET NOCOUNT ON;
GO

PRINT 'Migration 104: back-filling Godowns.EnterpriseID from project company_id…';

UPDATE g
SET
  g.EnterpriseID = COALESCE(p.company_id, TRY_CAST(p.belongs_to AS INT)),
  g.UpdatedAt    = SYSDATETIME()
FROM dbo.Godowns g
INNER JOIN dbo.enterprise p
  ON p.id = g.ProjectID
  AND p.business_type = 'P'
WHERE
  g.IsDeleted    = 0
  AND g.IsMain   = 0
  AND g.ProjectID IS NOT NULL
  AND g.EnterpriseID IS NULL
  AND COALESCE(p.company_id, TRY_CAST(p.belongs_to AS INT)) IS NOT NULL;

PRINT CONCAT('Updated ', @@ROWCOUNT, ' godown(s).');
GO

PRINT '104-backfill-godown-enterprise-id applied successfully.';
GO
