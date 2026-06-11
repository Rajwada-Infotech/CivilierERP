import re

fname = "backend\\routes\\businessRoutes.js"
with open(fname, "r", encoding="utf-8") as f:
    content = f.read()

old = r"SELECT id, name\s+FROM dbo\.enterprise\s+WHERE business_type = 'P'\s+ORDER BY name"

new = """SELECT
          p.id,
          p.name,
          COALESCE(p.company_id, pc.PrimaryCompanyId) AS company_id,
          pc.CompanyIds AS company_ids
        FROM dbo.enterprise p
        OUTER APPLY (
          SELECT
            MIN(x.cid) AS PrimaryCompanyId,
            STRING_AGG(CAST(x.cid AS NVARCHAR(20)), ',')
              WITHIN GROUP (ORDER BY x.cid) AS CompanyIds
          FROM (
            SELECT p.company_id AS cid WHERE p.company_id IS NOT NULL
            UNION
            SELECT pc2.CompanyId FROM dbo.ProjectCompanies pc2 WHERE pc2.ProjectId = p.id
          ) x
        ) pc
        WHERE p.business_type = 'P'
        ORDER BY p.name"""

content, n = re.subn(old, new, content, flags=re.DOTALL)
print(f"{'OK' if n else 'NO MATCH'} ({n} replacement): {fname}")
with open(fname, "w", encoding="utf-8") as f:
    f.write(content)
