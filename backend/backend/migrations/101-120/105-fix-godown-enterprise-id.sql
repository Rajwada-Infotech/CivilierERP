-- 105-fix-godown-enterprise-id.sql
-- Project-linked godowns were stamped with the grandparent Enterprise id
-- (business_type='E') instead of the parent Company id (business_type='C')
-- in dbo.Godowns.EnterpriseID. Every read path (Stock.tsx, StockTransfer.tsx)
-- filters EnterpriseID against the selected Company id, so these godowns
-- never matched and were invisible in company/project filters.
-- This backfills every existing project godown to the correct Company id.

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
