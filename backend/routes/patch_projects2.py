import os, re

NEW_QUERY_INDENTED = """SELECT
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

NEW_QUERY_LESS_INDENTED = """SELECT
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

# Pattern A: Id/Name aliases, discontinue = 0 OR discontinue IS NULL
PAT_A = (
    r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P' AND \(discontinue = 0 OR discontinue IS NULL\)\s+ORDER BY name",
    NEW_QUERY_INDENTED
)
# Pattern B: Id/Name aliases, ISNULL(discontinue,0) = 0 (no space before comma)
PAT_B = (
    r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P' AND ISNULL\(discontinue,0\) = 0\s+ORDER BY name",
    NEW_QUERY_INDENTED
)
# Pattern C: Id/Name aliases, ISNULL(discontinue, 0) = 0 (space before comma) — multiline or single line
PAT_C = (
    r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P'\s+AND ISNULL\(discontinue,\s*0\) = 0\s+ORDER BY name",
    NEW_QUERY_INDENTED
)
# Pattern C2: less-indented variant (followupUnitSelections)
PAT_C2 = (
    r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P' AND ISNULL\(discontinue, 0\) = 0\s+ORDER BY name",
    NEW_QUERY_LESS_INDENTED
)
# Pattern D: ProjectId/ProjectName aliases, no discontinue filter (followupDemands, followupPayments)
PAT_D = (
    r"SELECT id AS ProjectId, name AS ProjectName\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P'\s+ORDER BY name",
    NEW_QUERY_INDENTED.replace("p.id   AS Id", "p.id   AS ProjectId").replace("p.name AS Name", "p.name AS ProjectName")
)
# Pattern E: Id/Name aliases, no discontinue filter (followupNoc standalone, followupDemands options)
PAT_E = (
    r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+"
    r"WHERE business_type = 'P'\s+ORDER BY name",
    NEW_QUERY_INDENTED
)

PATTERNS = [PAT_A, PAT_B, PAT_C, PAT_C2, PAT_D, PAT_E]

files = [
    "followupAgreements.js",
    "followupagreementworkflow.js",
    "followupBookings.js",
    "followupConstructionUpdates.js",
    "followupHandover.js",
    "followupLegalMilestones.js",
    "followupNoc.js",
    "followupPossessionNotice.js",
    "followupPrePossession.js",
    "followupSalesDeed.js",
    "followupUnitSelections.js",
    "followupDemands.js",
    "followupPayments.js",
]

for fname in files:
    if not os.path.exists(fname):
        print(f"SKIP (not found): {fname}")
        continue
    with open(fname, "r", encoding="utf-8") as f:
        content = f.read()
    total = 0
    for old_pat, new_sql in PATTERNS:
        content, n = re.subn(old_pat, new_sql, content, flags=re.DOTALL)
        total += n
    if total == 0:
        print(f"NO MATCH: {fname}")
    else:
        with open(fname, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"OK ({total} replacement{'s' if total > 1 else ''}): {fname}")
