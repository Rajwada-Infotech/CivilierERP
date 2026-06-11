import os, re

PROJECT_QUERY_OLD = r"SELECT id AS Id, name AS Name\s+FROM dbo\.enterprise\s+WHERE business_type = 'P'\s+ORDER BY name"

PROJECT_QUERY_NEW = """SELECT
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
    new_content, count = re.subn(PROJECT_QUERY_OLD, PROJECT_QUERY_NEW, content, flags=re.DOTALL)
    if count == 0:
        print(f"NO MATCH: {fname}")
    else:
        with open(fname, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"OK ({count} replacement{'s' if count > 1 else ''}): {fname}")
