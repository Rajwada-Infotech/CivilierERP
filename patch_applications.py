import re

fname = "backend\\routes\\followupApplications.js"
with open(fname, "r", encoding="utf-8") as f:
    content = f.read()

old_a = r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+WHERE business_type = 'P'\s+ORDER BY name"
old_b = r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+WHERE business_type = 'P' AND \(discontinue = 0 OR discontinue IS NULL\)\s+ORDER BY name"
old_c = r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+WHERE business_type = 'P' AND ISNULL\(discontinue,\s*0\) = 0\s+ORDER BY name"

new = """SELECT
          p.id   AS Id,
          p.name AS Name,
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

total = 0
for old in [old_a, old_b, old_c]:
    content, n = re.subn(old, new, content, flags=re.DOTALL)
    total += n

print(f"{'OK' if total else 'NO MATCH'} ({total} replacements): {fname}")
with open(fname, "w", encoding="utf-8") as f:
    f.write(content)
