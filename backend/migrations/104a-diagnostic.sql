-- ── Step 1: See all godowns with their current linkage state ─────────────────
SELECT
  g.GodownID,
  g.GodownCode,
  g.GodownName,
  g.IsMain,
  g.EnterpriseID,
  g.ProjectID,
  e.name  AS EnterpriseName,
  p.name  AS ProjectName,
  p.company_id  AS Project_company_id,
  p.belongs_to  AS Project_belongs_to
FROM dbo.Godowns g
LEFT JOIN dbo.enterprise e ON e.id = g.EnterpriseID
LEFT JOIN dbo.enterprise p ON p.id = g.ProjectID AND p.business_type = 'P'
WHERE g.IsDeleted = 0
ORDER BY g.IsMain DESC, g.GodownName;

-- ── Step 2: See all projects so you can find GLOBAL CITY's ID ────────────────
SELECT
  id,
  name,
  business_type,
  company_id,
  belongs_to
FROM dbo.enterprise
WHERE business_type = 'P'
  AND (discontinue IS NULL OR discontinue = 0)
ORDER BY name;
