-- 106-resync-godown-enterprise-id.sql
-- Migration 105 backfilled project-linked godowns whose EnterpriseID was
-- stamped with the grandparent Enterprise id instead of the parent Company
-- id. Any project godown created (or whose project's company changed)
-- between then and the projectMaster.js route fix could still end up
-- with a missing/incorrect EnterpriseID, making it invisible in every
-- company/project filter on Stock.tsx / StockTransfer.tsx.
-- This re-runs the same backfill so existing data is corrected immediately.

UPDATE g
SET g.EnterpriseID = p.company_id
FROM dbo.Godowns g
JOIN dbo.enterprise p
  ON p.id = g.ProjectID
 AND p.business_type = 'P'
WHERE g.ProjectID IS NOT NULL
  AND p.company_id IS NOT NULL
  AND (g.EnterpriseID IS NULL OR g.EnterpriseID <> p.company_id);
GO
