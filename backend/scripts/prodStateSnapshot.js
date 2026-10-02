"use strict";
/**
 * READ-ONLY snapshot of the database state that the plot / villa / resale,
 * GST and accounting work depends on. Writes nothing.
 *
 * Sections: migrations applied, schema pieces present, GST masters (HSN +
 * CrmGstRule), chart of accounts (groups + the CRM heads and where they sit),
 * ledger health (Dr = Cr, unbalanced vouchers, unmapped heads, balances by
 * group), CRM inventory and sales (projects, plots, bookings, resales),
 * document number sequences.
 *
 * Run: node scripts/prodStateSnapshot.js
 */
const { connectDB, getPool, closeDB } = require("../db");

const out = (s = "") => console.log(s);
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

async function q(sqlText) {
  return (await getPool().request().query(sqlText)).recordset;
}
async function section(title, fn) {
  out(`\n=== ${title} ===`);
  try { await fn(); } catch (e) { out(`  (could not read: ${e.message})`); }
}
async function exists(table) {
  return (await q(`SELECT OBJECT_ID('dbo.${table}', 'U') AS id`))[0].id != null;
}
async function hasCol(table, col) {
  return (await q(`SELECT COL_LENGTH('dbo.${table}', '${col}') AS l`))[0].l != null;
}
const table = (rows, cols) => {
  if (!rows.length) { out("  (none)"); return; }
  const keys = cols || Object.keys(rows[0]);
  const w = keys.map((k) => Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k] ?? "—").length))));
  out("  " + keys.map((k, i) => k.padEnd(w[i])).join(" | "));
  out("  " + w.map((x) => "-".repeat(x)).join("-+-"));
  for (const r of rows) out("  " + keys.map((k, i) => String(r[k] ?? "—").slice(0, 48).padEnd(w[i])).join(" | "));
};

(async () => {
  await connectDB();
  out(`Snapshot taken ${new Date().toISOString()} — database ${(await q("SELECT DB_NAME() AS d"))[0].d}`);

  await section("Migrations", async () => {
    const tracker = (await q(`SELECT TOP 1 name FROM sys.tables WHERE name IN ('__Migrations','SequelizeMeta','umzug_migrations','MigrationLog') ORDER BY name`))[0]?.name;
    if (!tracker) { out("  no migration tracker table found"); return; }
    const col = (await q(`SELECT TOP 1 COLUMN_NAME c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tracker}' AND COLUMN_NAME IN ('name','Name','MigrationName')`))[0]?.c || "name";
    const all = (await q(`SELECT [${col}] AS n FROM dbo.[${tracker}]`)).map((r) => r.n);
    out(`  tracker dbo.${tracker}: ${all.length} applied`);
    const wanted = ["484", "485", "486", "487", "488", "489", "490", "491", "492", "493", "494", "495", "496", "497", "498", "499", "500", "501", "502"];
    out("  481-502 status: " + wanted.map((w) => `${w}:${all.some((n) => String(n).startsWith(w + "-")) ? "Y" : "-"}`).join(" "));
    out("  latest 10: " + all.sort().slice(-10).join(", "));
  });

  await section("Schema pieces", async () => {
    const tables = ["PlotMaster", "CrmBookingPlot", "CrmApplicationPlot", "CrmBookingUnit", "PlotAdjacency", "PlotFacingMaster",
      "PlotBlockLayout", "CrmGstRule", "CrmUnitResale", "CrmConstructedAssetKind", "ProjectTypeMaster", "CrmRefund", "CrmCancellation"];
    const rows = [];
    for (const t of tables) rows.push({ table: t, present: (await exists(t)) ? "yes" : "MISSING" });
    table(rows);
    const cols = [["CrmBooking", "BlockId"], ["UnitMaster", "UnitKind"], ["PlotMaster", "ConvertedUnitId"], ["PlotMaster", "GridRow"],
      ["CrmConstructedAssetKind", "IsLand"], ["CrmUnitResale", "PlotId"], ["CrmUnitResale", "DeveloperFeeHsnCode"], ["CrmUnitResale", "DeveloperFeeGstRate"]];
    const cr = [];
    for (const [t, c] of cols) cr.push({ column: `${t}.${c}`, present: (await exists(t)) && (await hasCol(t, c)) ? "yes" : "MISSING" });
    table(cr);
  });

  await section("GST — HSN rates used by CRM", async () => {
    table(await q(`SELECT HCode, HShortDescription, HCGST, HSGST, HIGST, HStatus FROM dbo.HSN
                   WHERE HCode LIKE '9954%' OR HCode LIKE '9997%' OR HCode LIKE '9972%' OR HCode LIKE '9995%' ORDER BY HCode`));
  });

  await section("GST — rules (which HSN applies)", async () => {
    if (!(await exists("CrmGstRule"))) { out("  dbo.CrmGstRule MISSING"); return; }
    table(await q(`SELECT Id, Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer AS LandOwned, Priority, IsActive FROM dbo.CrmGstRule ORDER BY AppliesTo, Priority`));
  });

  await section("Constructed asset kinds", async () => {
    if (!(await exists("CrmConstructedAssetKind"))) { out("  MISSING"); return; }
    table(await q(`SELECT * FROM dbo.CrmConstructedAssetKind ORDER BY 1`));
  });

  await section("Chart of accounts — groups", async () => {
    table(await q(`
      WITH g AS (
        SELECT AGId, Code, Name, ParentGroupId, CAST(Name AS NVARCHAR(400)) AS Path, 0 AS Lvl
        FROM dbo.AccountGroup WHERE ParentGroupId IS NULL OR ParentGroupId = 0
        UNION ALL
        SELECT c.AGId, c.Code, c.Name, c.ParentGroupId, CAST(g.Path + ' > ' + c.Name AS NVARCHAR(400)), g.Lvl + 1
        FROM dbo.AccountGroup c JOIN g ON c.ParentGroupId = g.AGId)
      SELECT AGId, Code, Path, (SELECT COUNT(*) FROM dbo.AccountHeadMaster h WHERE h.LBelongsTo = g.AGId) AS Heads
      FROM g ORDER BY Path OPTION (MAXRECURSION 20)`));
  });

  await section("Chart of accounts — CRM / GST / bank heads and their groups", async () => {
    table(await q(`
      SELECT h.LHeadId, h.LHeadCode, h.LHeadName, h.LHeadType, g.Code AS GroupCode, g.Name AS GroupName, h.LHeadStatus
      FROM dbo.AccountHeadMaster h LEFT JOIN dbo.AccountGroup g ON g.AGId = h.LBelongsTo
      WHERE h.LHeadCode LIKE 'CRM%' AND h.LHeadCode NOT LIKE 'CRMCUST-%'
         OR h.LHeadCode IN ('ADVC-CUST', 'GSTCA')
         OR h.LHeadName LIKE '%GST%' OR h.LHeadName LIKE 'Sale of%' OR h.LHeadName LIKE '%Forfeiture%'
         OR h.LHeadType = 'B'
      ORDER BY h.LHeadType, h.LHeadName`));
    table(await q(`SELECT
        (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NULL) AS HeadsWithNoGroup,
        (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LHeadCode LIKE 'CRMCUST-%') AS CrmCustomerHeads,
        (SELECT COUNT(*) FROM dbo.AccountHeadMaster) AS TotalHeads`));
    out("  heads with no group (first 20):");
    table(await q(`SELECT TOP 20 LHeadId, LHeadCode, LHeadName, LHeadType FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NULL ORDER BY LHeadId`));
  });

  await section("Ledger health", async () => {
    table(await q(`SELECT COUNT(*) AS Legs, COUNT(DISTINCT VoucherNo) AS Vouchers,
                          SUM(DebitAmount) AS TotalDr, SUM(CreditAmount) AS TotalCr, SUM(DebitAmount) - SUM(CreditAmount) AS Diff
                   FROM dbo.GeneralLedgerEntry WHERE ISNULL(IsReversed, 0) = 0`));
    out("  unbalanced vouchers (top 20):");
    table(await q(`SELECT TOP 20 VoucherNo, MIN(SourceType) AS SourceType, SUM(DebitAmount) AS Dr, SUM(CreditAmount) AS Cr
                   FROM dbo.GeneralLedgerEntry WHERE ISNULL(IsReversed, 0) = 0
                   GROUP BY VoucherNo HAVING ABS(SUM(DebitAmount) - SUM(CreditAmount)) > 0.01 ORDER BY VoucherNo`));
    out("  ledger postings to heads with no group (invisible in TB/BS):");
    table(await q(`SELECT h.LHeadId, h.LHeadName, COUNT(*) AS Legs, SUM(e.DebitAmount - e.CreditAmount) AS Net
                   FROM dbo.GeneralLedgerEntry e JOIN dbo.AccountHeadMaster h ON h.LHeadId = e.LHeadId
                   WHERE h.LBelongsTo IS NULL GROUP BY h.LHeadId, h.LHeadName`));
    out("  postings by source type:");
    table(await q(`SELECT SourceType, COUNT(*) AS Legs, SUM(DebitAmount) AS Dr, SUM(CreditAmount) AS Cr FROM dbo.GeneralLedgerEntry
                   WHERE ISNULL(IsReversed, 0) = 0 GROUP BY SourceType ORDER BY SourceType`));
  });

  await section("Balances by top-level group (trial balance shape)", async () => {
    table(await q(`
      WITH g AS (
        SELECT AGId, AGId AS RootId FROM dbo.AccountGroup WHERE ParentGroupId IS NULL OR ParentGroupId = 0
        UNION ALL SELECT c.AGId, g.RootId FROM dbo.AccountGroup c JOIN g ON c.ParentGroupId = g.AGId)
      SELECT r.Name AS RootGroup, SUM(e.DebitAmount) AS Dr, SUM(e.CreditAmount) AS Cr, SUM(e.DebitAmount - e.CreditAmount) AS NetDr
      FROM dbo.GeneralLedgerEntry e
      JOIN dbo.AccountHeadMaster h ON h.LHeadId = e.LHeadId
      JOIN g ON g.AGId = h.LBelongsTo
      JOIN dbo.AccountGroup r ON r.AGId = g.RootId
      WHERE ISNULL(e.IsReversed, 0) = 0
      GROUP BY r.Name ORDER BY r.Name OPTION (MAXRECURSION 20)`));
    out("  CRM heads — balances:");
    table(await q(`SELECT h.LHeadCode, h.LHeadName, SUM(e.DebitAmount) AS Dr, SUM(e.CreditAmount) AS Cr, SUM(e.CreditAmount - e.DebitAmount) AS NetCr
                   FROM dbo.GeneralLedgerEntry e JOIN dbo.AccountHeadMaster h ON h.LHeadId = e.LHeadId
                   WHERE ISNULL(e.IsReversed, 0) = 0 AND (h.LHeadCode LIKE 'CRM-%' OR h.LHeadCode IN ('ADVC-CUST','CRMCOLL','CRMCXLFORF'))
                   GROUP BY h.LHeadCode, h.LHeadName ORDER BY h.LHeadCode`));
  });

  await section("Projects and plot inventory", async () => {
    const ptm = await exists("ProjectTypeMaster");
    table(await q(`
      SELECT e.id AS ProjectId, e.name AS Project, e.company_id AS CompanyId,
             ${ptm ? "pt.Name" : "CAST(NULL AS NVARCHAR(50))"} AS ProjectType,
             (SELECT COUNT(*) FROM dbo.UnitMaster u WHERE u.ProjectId = e.id AND u.IsActive = 1) AS Units,
             ${await exists("PlotMaster") ? `(SELECT COUNT(*) FROM dbo.PlotMaster p WHERE p.ProjectId = e.id AND p.IsActive = 1)` : "0"} AS Plots
      FROM dbo.enterprise e
      ${ptm ? "LEFT JOIN dbo.ProjectTypeMaster pt ON pt.Id = e.project_type_id" : ""}
      WHERE e.business_type = 'P' AND ISNULL(e.discontinue, 0) = 0 ORDER BY e.name`));
    if (await exists("PlotMaster")) {
      table(await q(`SELECT ProjectId, COUNT(*) AS Plots,
                       SUM(CASE WHEN AreaSqFt > 0 THEN 1 ELSE 0 END) AS WithArea,
                       SUM(CASE WHEN RatePerSqFt > 0 THEN 1 ELSE 0 END) AS WithRate,
                       SUM(CASE WHEN ConvertedUnitId IS NOT NULL THEN 1 ELSE 0 END) AS Converted
                     FROM dbo.PlotMaster WHERE IsActive = 1 GROUP BY ProjectId`));
    }
  });

  await section("CRM sales", async () => {
    table(await q(`SELECT
        (SELECT COUNT(*) FROM dbo.CrmApplication WHERE IsActive = 1) AS Applications,
        (SELECT COUNT(*) FROM dbo.CrmBooking WHERE IsActive = 1) AS Bookings,
        ${await exists("CrmBookingPlot") ? "(SELECT COUNT(DISTINCT BookingId) FROM dbo.CrmBookingPlot)" : "0"} AS PlotBookings,
        (SELECT COUNT(*) FROM dbo.CrmBooking WHERE IsActive = 1 AND UnitId IS NULL) AS BookingsWithoutUnit,
        ${await hasCol("CrmBooking", "BlockId") ? "(SELECT COUNT(*) FROM dbo.CrmBooking WHERE IsActive = 1 AND BlockId IS NULL)" : "-1"} AS BookingsWithoutBlock,
        ${await exists("CrmUnitResale") ? "(SELECT COUNT(*) FROM dbo.CrmUnitResale)" : "0"} AS Resales,
        (SELECT COUNT(*) FROM dbo.CrmInvoice) AS Invoices`));
    table(await q(`SELECT Status, WorkflowStage, COUNT(*) AS N FROM dbo.CrmBooking WHERE IsActive = 1 GROUP BY Status, WorkflowStage`));
    out("  bookings whose GST total disagrees with GrandTotal - pre-tax parts (top 10):");
    table(await q(`SELECT TOP 10 Id, BookingNo, TotalValue, ParkingTotal, ExtraChargesTotal, TotalGstAmount, GrandTotal
                   FROM dbo.CrmBooking WHERE IsActive = 1
                     AND ABS(ISNULL(GrandTotal,0) - (ISNULL(TotalValue,0) + ISNULL(ParkingTotal,0) + ISNULL(ExtraChargesTotal,0) + ISNULL(UnitGstAmount,0))) > 1`));
  });

  await section("Document number sequences", async () => {
    const t = (await q(`SELECT TOP 1 name FROM sys.tables WHERE name IN ('DocNumberSequence','DocumentNumberSequence','DocSequence') ORDER BY name`))[0]?.name;
    if (!t) { out("  sequence table not found"); return; }
    const cols = (await q(`SELECT COLUMN_NAME c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${t}'`)).map((r) => r.c);
    if (cols.includes("DocNo") && cols.includes("TableName")) {
      // An issuance log: one row per number handed out — summarise per table.
      table(await q(`SELECT TableName, COUNT(*) AS Issued, MAX(DocNo) AS LatestDocNo, MAX(IssuedAt) AS LastIssued
                     FROM dbo.[${t}] GROUP BY TableName ORDER BY TableName`));
    } else {
      table(await q(`SELECT TOP 50 * FROM dbo.[${t}]`));
    }
  });

  out("\nSnapshot complete — read-only, nothing was changed.");
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
