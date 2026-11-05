// The Fixed Asset dashboard's figures, from every page of the module, in one read: the register and what it is
// worth after posted depreciation, FA Inventory's untagged stock, Inventory Import, Assignment, User-wise Transfer,
// Owner & Quality Checking, Maintenance & Repair and Depreciation Generate, plus the latest activity across them.
// Every figure is kept to the user's projects (scope null = every project).
const { sql } = require("../db");
const { projectPredicate } = require("./projectScope");

// The register is what the Asset Register page shows: rows a person created (they carry an AssetCode), not deleted.
// GRN / import "batch" rows without an AssetCode are FA Inventory's untagged stock, counted separately.
const LIVE = "fa.AssetCode IS NOT NULL AND ISNULL(fa.Status, '') <> 'Deleted'";

// Indian financial year: 1 April to 31 March.
function fyStart(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1));
}

async function buildFixedAssetDashboard(pool, scope) {
  const inScope = (col) => projectPredicate(scope, col);
  const req = () => pool.request().input("fyStart", sql.Date, fyStart());
  const one = async (q) => (await req().query(q)).recordset[0] || {};
  const all = async (q) => (await req().query(q)).recordset;

  // Posted (not reversed) depreciation per live asset — the book value is cost less this.
  const DEP = `(SELECT e.AssetId, SUM(e.DepreciationAmount) AS Dep FROM dbo.FixedAssetDepreciationEntry e
                WHERE ISNULL(e.Status, '') <> 'Reversed' GROUP BY e.AssetId)`;

  const [register, byStatus, byCategory, byProject, inventory, imports, assignment, transfers, qc, qcByStatus, maintenance, depreciation, depTrend, recent] =
    await Promise.all([
      one(`
        SELECT COUNT(*) AS assets,
               ISNULL(SUM(fa.PurchaseCost), 0) AS cost,
               ISNULL(SUM(d.Dep), 0) AS depreciated,
               ISNULL(SUM(CASE WHEN fa.PurchaseCost - ISNULL(d.Dep, 0) > 0 THEN fa.PurchaseCost - ISNULL(d.Dep, 0) ELSE 0 END), 0) AS bookValue,
               SUM(CASE WHEN fa.DocDate >= @fyStart THEN 1 ELSE 0 END) AS addedThisYear,
               ISNULL(SUM(CASE WHEN fa.DocDate >= @fyStart THEN fa.PurchaseCost END), 0) AS addedThisYearCost
        FROM dbo.FixedAssetRecord fa LEFT JOIN ${DEP} d ON d.AssetId = fa.AssetId
        WHERE ${LIVE}${inScope("fa.ProjectId")}`),
      all(`
        SELECT ISNULL(fa.AssetStatus, 'Unknown') AS status, COUNT(*) AS count, ISNULL(SUM(fa.PurchaseCost), 0) AS cost
        FROM dbo.FixedAssetRecord fa WHERE ${LIVE}${inScope("fa.ProjectId")}
        GROUP BY ISNULL(fa.AssetStatus, 'Unknown') ORDER BY COUNT(*) DESC`),
      all(`
        SELECT TOP 8 ISNULL(NULLIF(LTRIM(RTRIM(fa.AssetCategory)), ''), 'No category') AS name, COUNT(*) AS count,
               ISNULL(SUM(fa.PurchaseCost), 0) AS cost,
               ISNULL(SUM(CASE WHEN fa.PurchaseCost - ISNULL(d.Dep, 0) > 0 THEN fa.PurchaseCost - ISNULL(d.Dep, 0) ELSE 0 END), 0) AS bookValue
        FROM dbo.FixedAssetRecord fa LEFT JOIN ${DEP} d ON d.AssetId = fa.AssetId
        WHERE ${LIVE}${inScope("fa.ProjectId")}
        GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(fa.AssetCategory)), ''), 'No category') ORDER BY SUM(fa.PurchaseCost) DESC`),
      all(`
        SELECT TOP 8 ISNULL(pr.name, 'No project') AS name, COUNT(*) AS count, ISNULL(SUM(fa.PurchaseCost), 0) AS cost,
               ISNULL(SUM(CASE WHEN fa.PurchaseCost - ISNULL(d.Dep, 0) > 0 THEN fa.PurchaseCost - ISNULL(d.Dep, 0) ELSE 0 END), 0) AS bookValue
        FROM dbo.FixedAssetRecord fa LEFT JOIN ${DEP} d ON d.AssetId = fa.AssetId
        LEFT JOIN dbo.enterprise pr ON pr.id = fa.ProjectId
        WHERE ${LIVE}${inScope("fa.ProjectId")}
        GROUP BY ISNULL(pr.name, 'No project') ORDER BY SUM(fa.PurchaseCost) DESC`),
      // FA Inventory: received stock still waiting for FA Item Codes (the page's own definition), and codes tagged.
      one(`
        SELECT
          (SELECT COUNT(*) FROM dbo.FixedAssetRecord fa
            WHERE fa.AssetCode IS NULL AND fa.SourceType IN ('GRN', 'IMPORT', 'ICT') AND fa.AssetStatus = 'Pending' AND ISNULL(fa.Status, '') <> 'Deleted'
              AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetTagging t WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged')${inScope("fa.ProjectId")}) AS untaggedBatches,
          (SELECT ISNULL(SUM(fa.Quantity), 0) FROM dbo.FixedAssetRecord fa
            WHERE fa.AssetCode IS NULL AND fa.SourceType IN ('GRN', 'IMPORT', 'ICT') AND fa.AssetStatus = 'Pending' AND ISNULL(fa.Status, '') <> 'Deleted'
              AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetTagging t WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged')${inScope("fa.ProjectId")}) AS untaggedQty,
          (SELECT COUNT(*) FROM dbo.FixedAssetRecord fa
            WHERE fa.AssetCode IS NULL AND fa.SourceType IN ('GRN', 'IMPORT', 'ICT') AND fa.AssetStatus = 'Pending' AND ISNULL(fa.Status, '') <> 'Deleted'
              AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetTagging t WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged')
              AND NOT EXISTS (SELECT 1 FROM dbo.IDTemplateMaster tpl WHERE tpl.ProjectId = fa.ProjectId AND tpl.IsActive = 1)${inScope("fa.ProjectId")}) AS noTemplate,
          (SELECT ISNULL(SUM(t.TaggedQty), 0) FROM dbo.FixedAssetTagging t WHERE t.Status = 'Tagged'${inScope("t.ProjectId")}) AS codesTagged,
          (SELECT ISNULL(SUM(t.TaggedQty), 0) FROM dbo.FixedAssetTagging t WHERE t.Status = 'Tagged' AND t.DocDate >= @fyStart${inScope("t.ProjectId")}) AS codesTaggedThisYear`),
      one(`
        SELECT COUNT(*) AS count, ISNULL(SUM(i.Quantity), 0) AS qty, ISNULL(SUM(i.Quantity * i.Rate), 0) AS value, MAX(i.DocDate) AS lastDate
        FROM dbo.FixedAssetInventoryImport i WHERE ISNULL(i.Status, '') = 'Active'${inScope("i.ProjectId")}`),
      // Assignment: live, in-use assets with a user against those without one.
      one(`
        SELECT
          (SELECT COUNT(DISTINCT a.AssetId) FROM dbo.FixedAssetAssignment a JOIN dbo.FixedAssetRecord fa ON fa.AssetId = a.AssetId
            WHERE a.Status = 'Active' AND ${LIVE}${inScope("fa.ProjectId")}) AS assigned,
          (SELECT COUNT(*) FROM dbo.FixedAssetRecord fa WHERE ${LIVE} AND fa.AssetStatus = 'Active'
            AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetAssignment a WHERE a.AssetId = fa.AssetId AND a.Status = 'Active')${inScope("fa.ProjectId")}) AS unassigned`),
      one(`
        SELECT COUNT(*) AS thisYear, MAX(h.TransferDate) AS lastDate
        FROM dbo.AssetTransferHistory h WHERE ISNULL(h.Status, '') <> 'Deleted' AND COALESCE(h.TransferDate, h.DocDate) >= @fyStart${inScope("h.ProjectId")}`),
      one(`
        SELECT COUNT(*) AS checks,
               SUM(CASE WHEN q.FollowUpStatus = 'Pending' THEN 1 ELSE 0 END) AS followUpsOpen,
               SUM(CASE WHEN q.FollowUpStatus = 'Pending' AND q.NextFollowUpDate < CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END) AS overdue,
               SUM(CASE WHEN q.FollowUpStatus = 'Pending' AND q.NextFollowUpDate BETWEEN CAST(SYSDATETIME() AS DATE) AND DATEADD(DAY, 7, CAST(SYSDATETIME() AS DATE)) THEN 1 ELSE 0 END) AS dueThisWeek
        FROM dbo.FixedAssetQualityCheck q WHERE ISNULL(q.Status, '') <> 'Deleted'${inScope("q.ProjectId")}`),
      all(`
        SELECT ISNULL(q.QualityStatus, 'Not set') AS status, COUNT(*) AS count
        FROM dbo.FixedAssetQualityCheck q WHERE ISNULL(q.Status, '') <> 'Deleted'${inScope("q.ProjectId")}
        GROUP BY ISNULL(q.QualityStatus, 'Not set') ORDER BY COUNT(*) DESC`),
      one(`
        SELECT SUM(CASE WHEN m.DocDate >= @fyStart THEN 1 ELSE 0 END) AS thisYear,
               ISNULL(SUM(CASE WHEN m.DocDate >= @fyStart AND m.Status = 'Posted' THEN COALESCE(m.TotalAmount, m.Amount) END), 0) AS spentThisYear,
               SUM(CASE WHEN m.Status = 'Draft' THEN 1 ELSE 0 END) AS notPosted,
               ISNULL(SUM(CASE WHEN m.Status = 'Draft' THEN COALESCE(m.TotalAmount, m.Amount) END), 0) AS notPostedAmount
        FROM dbo.FixedAssetMaintenance m WHERE m.Status IN ('Draft', 'Posted')${inScope("m.ProjectId")}`),
      // Depreciation: charged this financial year, the last month posted, and live assets that should depreciate
      // but have nothing posted for last month yet.
      one(`
        SELECT
          (SELECT ISNULL(SUM(e.DepreciationAmount), 0) FROM dbo.FixedAssetDepreciationEntry e
            WHERE ISNULL(e.Status, '') <> 'Reversed' AND DATEFROMPARTS(e.PeriodYear, e.PeriodMonth, 1) >= @fyStart${inScope("e.ProjectId")}) AS thisYear,
          (SELECT MAX(DATEFROMPARTS(e.PeriodYear, e.PeriodMonth, 1)) FROM dbo.FixedAssetDepreciationEntry e
            WHERE ISNULL(e.Status, '') <> 'Reversed'${inScope("e.ProjectId")}) AS lastPeriod,
          (SELECT COUNT(*) FROM dbo.FixedAssetRecord fa
            WHERE ${LIVE} AND fa.AssetStatus = 'Active' AND ISNULL(fa.DepreciationRate, 0) > 0
              AND COALESCE(fa.ActivationDate, fa.PurchaseDate) < DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)
              AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetDepreciationEntry e WHERE e.AssetId = fa.AssetId AND ISNULL(e.Status, '') <> 'Reversed'
                AND DATEFROMPARTS(e.PeriodYear, e.PeriodMonth, 1) = DATEADD(MONTH, -1, DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)))${inScope("fa.ProjectId")}) AS dueLastMonth`),
      all(`
        SELECT e.PeriodYear AS y, e.PeriodMonth AS m, ISNULL(SUM(e.DepreciationAmount), 0) AS amount
        FROM dbo.FixedAssetDepreciationEntry e
        WHERE ISNULL(e.Status, '') <> 'Reversed'
          AND DATEFROMPARTS(e.PeriodYear, e.PeriodMonth, 1) >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1))${inScope("e.ProjectId")}
        GROUP BY e.PeriodYear, e.PeriodMonth`),
      // The latest things done anywhere in the module.
      all(`
        SELECT TOP 12 x.* FROM (
          SELECT t.CreatedAt AS at, CAST('Tagged' AS NVARCHAR(40)) AS kind, CAST(t.DocNo AS NVARCHAR(100)) AS ref,
                 CAST(CONCAT(ISNULL(t.FAItemCode, ''), ' · ', CAST(CAST(t.TaggedQty AS FLOAT) AS NVARCHAR(30)), ' tagged') AS NVARCHAR(400)) AS detail,
                 CAST(t.CreatedBy AS NVARCHAR(200)) AS who, CAST('/fixed-asset/tagging' AS NVARCHAR(100)) AS path
            FROM dbo.FixedAssetTagging t WHERE t.Status IN ('Tagged', 'Transferred')${inScope("t.ProjectId")}
          UNION ALL
          SELECT a.CreatedAt, 'Assigned', a.DocNo, CONCAT(ISNULL(fa.FAItemCode, fa.AssetName), ' → ', ISNULL(u.name, 'a user')), a.CreatedBy, '/fixed-asset/assignment'
            FROM dbo.FixedAssetAssignment a LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = a.AssetId LEFT JOIN dbo.users u ON u.id = a.UserId
            WHERE ISNULL(a.Status, '') <> 'Deleted'${inScope("a.ProjectId")}
          UNION ALL
          SELECT h.CreatedAt, 'Transferred', h.DocNo, CONCAT(ISNULL(fa.FAItemCode, fa.AssetName), ': ', ISNULL(uf.name, '—'), ' → ', ISNULL(ut.name, '—')),
                 CAST(ISNULL(ub.email, ub.name) AS NVARCHAR(200)), '/fixed-asset/transfer'
            FROM dbo.AssetTransferHistory h LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
            LEFT JOIN dbo.users uf ON uf.id = h.FromUserId LEFT JOIN dbo.users ut ON ut.id = h.ToUserId
            LEFT JOIN dbo.users ub ON ub.id = h.TransferredBy
            WHERE ISNULL(h.Status, '') <> 'Deleted'${inScope("h.ProjectId")}
          UNION ALL
          SELECT q.CreatedAt, 'Quality check', q.DocNo, CONCAT(ISNULL(q.FAItemCode, q.ItemName), ' · ', ISNULL(q.QualityStatus, '')), q.CreatedBy, '/fixed-asset/quality-check'
            FROM dbo.FixedAssetQualityCheck q WHERE ISNULL(q.Status, '') <> 'Deleted'${inScope("q.ProjectId")}
          UNION ALL
          SELECT m.CreatedAt, 'Maintenance', m.DocNo, CONCAT(ISNULL(m.FAItemCode, m.ItemName), ' · ', ISNULL(m.RepairExpenseType, ''), ' · ₹', CAST(CAST(COALESCE(m.TotalAmount, m.Amount, 0) AS DECIMAL(18, 0)) AS NVARCHAR(30))), m.CreatedBy, '/fixed-asset/maintenance'
            FROM dbo.FixedAssetMaintenance m WHERE m.Status IN ('Draft', 'Posted')${inScope("m.ProjectId")}
          UNION ALL
          SELECT i.CreatedAt, 'Imported', i.DocNo, CONCAT(i.ItemName, ' · ', CAST(CAST(i.Quantity AS FLOAT) AS NVARCHAR(30)), ' received'), i.CreatedBy, '/fixed-asset/inventory-import'
            FROM dbo.FixedAssetInventoryImport i WHERE ISNULL(i.Status, '') = 'Active'${inScope("i.ProjectId")}
          UNION ALL
          SELECT MAX(e.PostedAt), 'Depreciation', e.VoucherNo, CONCAT(COUNT(*), CASE WHEN COUNT(*) = 1 THEN ' asset · ' ELSE ' assets · ' END, FORMAT(DATEFROMPARTS(MIN(e.PeriodYear), MIN(e.PeriodMonth), 1), 'MMM yyyy')), MAX(e.PostedBy), '/fixed-asset/depreciation-generate'
            FROM dbo.FixedAssetDepreciationEntry e WHERE e.Status = 'Posted' AND e.VoucherNo IS NOT NULL${inScope("e.ProjectId")}
            GROUP BY e.VoucherNo
        ) x WHERE x.at IS NOT NULL ORDER BY x.at DESC`),
    ]);

  // Twelve months, oldest first, with the months nothing was posted in shown as zero.
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const hit = depTrend.find((r) => r.y === d.getFullYear() && r.m === d.getMonth() + 1);
    months.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, amount: Number(hit?.amount) || 0 });
  }

  const n = (v) => Number(v) || 0;
  return {
    register: {
      assets: n(register.assets), cost: n(register.cost), depreciated: n(register.depreciated), bookValue: n(register.bookValue),
      addedThisYear: n(register.addedThisYear), addedThisYearCost: n(register.addedThisYearCost),
    },
    byStatus: byStatus.map((r) => ({ status: r.status, count: n(r.count), cost: n(r.cost) })),
    byCategory: byCategory.map((r) => ({ name: r.name, count: n(r.count), cost: n(r.cost), bookValue: n(r.bookValue) })),
    byProject: byProject.map((r) => ({ name: r.name, count: n(r.count), cost: n(r.cost), bookValue: n(r.bookValue) })),
    inventory: {
      untaggedBatches: n(inventory.untaggedBatches), untaggedQty: n(inventory.untaggedQty), noTemplate: n(inventory.noTemplate),
      codesTagged: n(inventory.codesTagged), codesTaggedThisYear: n(inventory.codesTaggedThisYear),
    },
    imports: { count: n(imports.count), qty: n(imports.qty), value: n(imports.value), lastDate: imports.lastDate || null },
    assignment: { assigned: n(assignment.assigned), unassigned: n(assignment.unassigned) },
    transfers: { thisYear: n(transfers.thisYear), lastDate: transfers.lastDate || null },
    qualityCheck: {
      checks: n(qc.checks), followUpsOpen: n(qc.followUpsOpen), overdue: n(qc.overdue), dueThisWeek: n(qc.dueThisWeek),
      byStatus: qcByStatus.map((r) => ({ status: r.status, count: n(r.count) })),
    },
    maintenance: {
      thisYear: n(maintenance.thisYear), spentThisYear: n(maintenance.spentThisYear),
      notPosted: n(maintenance.notPosted), notPostedAmount: n(maintenance.notPostedAmount),
    },
    depreciation: { thisYear: n(depreciation.thisYear), lastPeriod: depreciation.lastPeriod || null, dueLastMonth: n(depreciation.dueLastMonth), months },
    recent: recent.map((r) => ({ at: r.at, kind: r.kind, ref: r.ref, detail: r.detail, who: r.who, path: r.path })),
    fyStart: fyStart().toISOString().slice(0, 10),
  };
}

module.exports = { buildFixedAssetDashboard, fyStart };
