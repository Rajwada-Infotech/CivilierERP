"use strict";
/**
 * READ-ONLY post-deploy check for the plotted-land / villa / resale release:
 * migrations, schema, GST masters (rates in HSN, selection in rules), chart of
 * accounts placement, ledger health, Silver Woods data. Writes nothing.
 *
 * Run: node scripts/postDeployVerifyPlots.js
 */
const { connectDB, getPool, closeDB } = require("../db");
let fails = 0, warns = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m, x) => { fails++; console.log(`  FAIL  ${m}${x !== undefined ? "  -> " + JSON.stringify(x).slice(0, 400) : ""}`); };
const warn = (m, x) => { warns++; console.log(`  WARN  ${m}${x !== undefined ? "  -> " + JSON.stringify(x).slice(0, 400) : ""}`); };
const q = async (s) => (await getPool().request().query(s)).recordset;
const one = async (s) => (await q(s))[0] || {};

(async () => {
  await connectDB();
  console.log(`Post-deploy check ${new Date().toISOString()} — database ${(await one("SELECT DB_NAME() AS d")).d}`);

  console.log("\n[1] Migrations");
  const applied = new Set((await q("SELECT name FROM dbo.__Migrations")).map((r) => r.name));
  const expected = ["497-vehicle-in-out-item-brand.sql", "498-ict-source-mr-link.sql", "499-dependency-activity-daily-log.sql",
    "500-dependency-activity-list-index.sql", "501-payment-expense-booking-link.sql",
    "502-project-type-master.sql", "503-unit-kind-and-plot-attributes.sql", "504-sale-of-land-gl-head.sql", "505-crm-booking-unit-lines.sql",
    "506-crm-unit-resale.sql", "507-crm-gst-rule-master.sql", "508-project-type-master-page-key.sql", "509-crm-plot-template.sql",
    "510-crm-application-unit-lines.sql", "511-plot-master.sql", "512-constructed-asset-kind-master.sql", "513-plot-adjacency.sql",
    "514-resale-targets-plot-or-unit.sql", "515-crm-resales-page-key.sql", "516-plot-facing-master.sql", "517-asset-kind-is-land-flag.sql",
    "518-plot-grid-layout.sql", "519-booking-block-id.sql", "520-resale-page-label.sql", "521-plot-villa-resale-gst-seed.sql",
    "522-villa-and-resale-fee-ledger-heads.sql", "523-crm-and-tds-heads-account-groups.sql", "524-plot-sale-zero-gst-rules.sql"];
  const missing = expected.filter((m) => !applied.has(m));
  missing.length ? fail(`${missing.length} migration(s) not applied`, missing) : pass(`all ${expected.length} release migrations applied`);
  const oldNames = ["482-project-type-master.sql", "491-plot-master.sql", "501-plot-villa-resale-gst-seed.sql"].filter((m) => applied.has(m));
  oldNames.length ? warn("old pre-renumber names present (run scripts/reconcile-plot-migration-renumber.js)", oldNames) : pass("no pre-renumber migration names");

  console.log("\n[2] Schema");
  for (const t of ["PlotMaster", "CrmBookingPlot", "CrmApplicationPlot", "CrmBookingUnit", "PlotAdjacency", "PlotFacingMaster", "PlotBlockLayout",
                   "CrmGstRule", "CrmUnitResale", "CrmConstructedAssetKind", "ProjectTypeMaster"]) {
    (await one(`SELECT OBJECT_ID('dbo.${t}','U') AS id`)).id != null ? pass(`table ${t}`) : fail(`table ${t} missing`);
  }
  for (const [t, c] of [["CrmBooking", "BlockId"], ["UnitMaster", "UnitKind"], ["PlotMaster", "ConvertedUnitId"], ["PlotMaster", "GridRow"],
                        ["CrmConstructedAssetKind", "IsLand"], ["CrmUnitResale", "DeveloperFeeHsnCode"], ["CrmUnitResale", "DeveloperFeeGstRate"]]) {
    (await one(`SELECT COL_LENGTH('dbo.${t}','${c}') AS l`)).l != null ? pass(`column ${t}.${c}`) : fail(`column ${t}.${c} missing`);
  }

  console.log("\n[3] GST masters (rates in HSN, selection in rules)");
  const hsn = await q(`SELECT HCode, HCGST + HSGST AS Rate, HIGST, HStatus FROM dbo.HSN WHERE HCode IN ('9954AFH','9954OTH','9954EXW','9954VAF','9954VOT','999794','LANDNIL')`);
  const want = { "9954AFH": 1, "9954OTH": 5, "9954EXW": 18, "9954VAF": 1, "9954VOT": 5, "999794": 18, LANDNIL: 0 };
  for (const [code, rate] of Object.entries(want)) {
    const r = hsn.find((h) => h.HCode === code);
    const eff = r ? (Number(r.Rate) > 0 ? Number(r.Rate) : Number(r.HIGST || 0)) : null;
    if (!r) fail(`HSN ${code} missing`);
    else if (!r.HStatus) fail(`HSN ${code} inactive`);
    else if (eff !== rate) warn(`HSN ${code} rate is ${eff}% (seeded ${rate}%; fine if Finance changed it)`);
    else pass(`HSN ${code} ${rate}%`);
  }
  const rules = await q(`SELECT Name, AppliesTo, HsnCode, LandOwnedByCustomer FROM dbo.CrmGstRule WHERE IsActive = 1`);
  const need = [
    ["UNIT_PARKING", "9954AFH", null, "unit, up to 45 lakh"], ["UNIT_PARKING", "9954OTH", null, "unit, above 45 lakh"],
    ["EXTRA_WORK", "9954EXW", null, "extra charges"],
    ["UNIT_PARKING", "9954VAF", true, "villa on own plot, up to 45 lakh"], ["UNIT_PARKING", "9954VOT", true, "villa on own plot, above 45 lakh"],
    ["RESALE_FEE", "999794", null, "unit resale fee"],
    ["EXTRA_WORK_LAND", "LANDNIL", null, "plot sale extra charges, no GST"], ["RESALE_FEE_LAND", "LANDNIL", null, "plot resale fee, no GST"],
  ];
  for (const [a, h, land, label] of need) {
    rules.some((r) => r.AppliesTo === a && r.HsnCode === h && (land === null ? r.LandOwnedByCustomer == null : r.LandOwnedByCustomer === land))
      ? pass(`GST rule ${a} -> ${h} (${label})`) : fail(`GST rule ${a} -> ${h} missing (${label})`);
  }

  console.log("\n[4] Chart of accounts");
  const heads = await q(`
    WITH g AS (SELECT AGId, CAST(UPPER(Name) AS NVARCHAR(100)) AS RootName FROM dbo.AccountGroup WHERE ParentGroupId IS NULL OR ParentGroupId = 0
               UNION ALL SELECT c.AGId, g.RootName FROM dbo.AccountGroup c JOIN g ON c.ParentGroupId = g.AGId)
    SELECT h.LHeadCode, h.LHeadName, ag.Code AS GroupCode, g.RootName
    FROM dbo.AccountHeadMaster h LEFT JOIN dbo.AccountGroup ag ON ag.AGId = h.LBelongsTo LEFT JOIN g ON g.AGId = h.LBelongsTo
    WHERE h.LHeadCode IN ('CRM-SALE-LAND','CRM-SALE-INCOME','CRM-SALE-VILLA','CRM-RESALE-FEE','CRM-GST-OUTPUT','ADVC-CUST','CRM-STAMPDUTY','BNKCHG')
    OPTION (MAXRECURSION 20)`);
  const expectRoot = { "CRM-SALE-LAND": "REVENUE", "CRM-SALE-INCOME": "REVENUE", "CRM-SALE-VILLA": "REVENUE", "CRM-RESALE-FEE": "REVENUE",
                       "CRM-GST-OUTPUT": "LIABILITIES", "ADVC-CUST": "LIABILITIES", "CRM-STAMPDUTY": "EXPENSES", BNKCHG: "EXPENSES" };
  for (const [code, root] of Object.entries(expectRoot)) {
    const h = heads.find((x) => x.LHeadCode === code);
    if (!h) { ["CRM-STAMPDUTY", "BNKCHG"].includes(code) ? warn(`head ${code} not present`) : fail(`head ${code} missing`); continue; }
    h.RootName === root ? pass(`${code} (${h.LHeadName}) under ${root} > ${h.GroupCode}`) : fail(`${code} is under ${h.RootName || "NO GROUP"}, expected ${root}`, h);
  }
  const ungroupedTds = await one(`SELECT COUNT(*) AS n FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NULL AND LHeadType = 'GL' AND LHeadCode LIKE 'TDS-%'`);
  ungroupedTds.n === 0 ? pass("all TDS heads grouped") : fail(`${ungroupedTds.n} TDS head(s) without a group`);
  const ungrouped = await q(`SELECT h.LHeadCode, h.LHeadName FROM dbo.AccountHeadMaster h LEFT JOIN dbo.AccountGroup g ON g.AGId = h.LBelongsTo WHERE g.AGId IS NULL ORDER BY h.LHeadId`);
  ungrouped.length
    ? warn(`${ungrouped.length} head(s) without a valid group; Finance to place in Account Head Master`, ungrouped.map((h) => `${h.LHeadCode || "-"} ${h.LHeadName}`))
    : pass("every head has a valid group");
  const invisible = await q(`SELECT h.LHeadName, COUNT(*) AS Legs FROM dbo.GeneralLedgerEntry e JOIN dbo.AccountHeadMaster h ON h.LHeadId = e.LHeadId
                             LEFT JOIN dbo.AccountGroup g ON g.AGId = h.LBelongsTo WHERE g.AGId IS NULL GROUP BY h.LHeadName`);
  invisible.length ? fail("ledger postings on ungrouped heads (missing from TB/BS)", invisible) : pass("no ledger postings on ungrouped heads");

  console.log("\n[5] Ledger health");
  const t = await one(`SELECT SUM(DebitAmount) AS Dr, SUM(CreditAmount) AS Cr FROM dbo.GeneralLedgerEntry WHERE ISNULL(IsReversed,0) = 0`);
  Math.abs(Number(t.Dr) - Number(t.Cr)) < 0.01 ? pass(`ledger balances (Dr = Cr = ${Number(t.Dr).toLocaleString("en-IN")})`) : fail("ledger out of balance", t);
  const unb = await q(`SELECT TOP 10 VoucherNo, SUM(DebitAmount) Dr, SUM(CreditAmount) Cr FROM dbo.GeneralLedgerEntry WHERE ISNULL(IsReversed,0)=0
                       GROUP BY VoucherNo HAVING ABS(SUM(DebitAmount)-SUM(CreditAmount)) > 0.01`);
  unb.length ? fail("unbalanced vouchers", unb) : pass("no unbalanced vouchers");
  const adv = await one(`SELECT SUM(e.CreditAmount - e.DebitAmount) AS Bal FROM dbo.GeneralLedgerEntry e JOIN dbo.AccountHeadMaster h ON h.LHeadId = e.LHeadId
                         WHERE h.LHeadCode = 'ADVC-CUST' AND ISNULL(e.IsReversed,0) = 0`);
  Number(adv.Bal || 0) >= -0.01
    ? pass(`Advance from Customer is a credit (liability) balance: ${Number(adv.Bal || 0).toLocaleString("en-IN")}`)
    : fail("Advance from Customer has a DEBIT balance: invoices released more than was received", adv);
  const plotGst = await one(`SELECT COUNT(*) AS n FROM dbo.CrmExtraCharge x WHERE x.IsActive = 1 AND x.GstAmount <> 0
                             AND EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = x.BookingId)`);
  plotGst.n === 0 ? pass("no GST on extra charges of plot bookings")
    : warn(`${plotGst.n} extra charge(s) on plot bookings still carry GST; editing the booking re-prices them`);

  console.log("\n[6] Data");
  const d = await one(`SELECT (SELECT COUNT(*) FROM dbo.CrmBooking WHERE IsActive = 1 AND BlockId IS NULL AND UnitId IS NOT NULL) AS NoBlock,
                              (SELECT Label FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales') AS ResalePage`);
  d.NoBlock === 0 ? pass("every unit booking carries its BlockId") : warn(`${d.NoBlock} unit booking(s) without BlockId`);
  d.ResalePage === "Plot Resale" ? pass(`resale page labelled "Plot Resale"`) : fail("resale page label", d.ResalePage);

  console.log("\n[7] Silver Woods");
  const sw = await one(`SELECT (SELECT project_type_id FROM dbo.enterprise WHERE id = 1012) AS TypeId,
      (SELECT COUNT(*) FROM dbo.BlockMaster WHERE ProjectId = 1012 AND IsActive = 1) AS Blocks,
      (SELECT COUNT(*) FROM dbo.PlotMaster WHERE ProjectId = 1012 AND IsActive = 1) AS Plots,
      (SELECT SUM(AreaSqFt) FROM dbo.PlotMaster WHERE ProjectId = 1012 AND IsActive = 1) AS Area`);
  if (sw.Plots === 0) warn("Silver Woods (project 1012) has no plots on this database; expected on production only");
  else {
    sw.TypeId === 4 ? pass("Silver Woods is Plotted + Villa") : fail("Silver Woods project type", sw.TypeId);
    sw.Blocks === 1 && sw.Plots === 121 && Math.abs(Number(sw.Area) - 209660.46) < 0.01
      ? pass("Silver Woods: block A, 121 plots, 209,660.46 sq ft") : fail("Silver Woods plots", sw);
  }

  console.log("\n[8] Villa types (migration 525)");
  const vt = await one(`SELECT CASE WHEN OBJECT_ID('dbo.VillaTypeMaster') IS NULL THEN 0 ELSE 1 END AS Tbl,
      CASE WHEN COL_LENGTH('dbo.PlotMaster','PlannedVillaTypeId') IS NULL THEN 0 ELSE 1 END AS PlotCol,
      CASE WHEN COL_LENGTH('dbo.UnitMaster','VillaTypeId') IS NULL THEN 0 ELSE 1 END AS UnitCol`);
  vt.Tbl && vt.PlotCol && vt.UnitCol ? pass("villa type master, planned type on plots, villa type on units") : fail("migration 525 objects", vt);
  if (vt.Tbl && vt.PlotCol) {
    const bad = await one(`SELECT COUNT(*) AS n FROM dbo.PlotMaster p JOIN dbo.VillaTypeMaster v ON v.Id = p.PlannedVillaTypeId
                           WHERE p.IsActive = 1 AND v.ProjectId <> p.ProjectId`);
    bad.n === 0 ? pass("every planned villa type belongs to its plot's project") : fail(`${bad.n} plot(s) plan a villa type of another project`);
    const villas = await one(`SELECT COUNT(*) AS n FROM dbo.UnitMaster u WHERE u.IsActive = 1 AND u.BuiltUpAreaSqFt IS NULL
                              AND EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id)`);
    villas.n === 0 ? pass("every villa built on plots records its built-up area")
      : warn(`${villas.n} villa(s) converted before the area fix have no built-up area; set it in Unit Master`);
    const swt = await q(`SELECT v.Code, COUNT(p.Id) AS Plots FROM dbo.VillaTypeMaster v
      LEFT JOIN dbo.PlotMaster p ON p.PlannedVillaTypeId = v.Id AND p.IsActive = 1
      WHERE v.ProjectId = 1012 AND v.IsActive = 1 GROUP BY v.Code ORDER BY v.Code`);
    const got = swt.map((r) => `${r.Code}=${r.Plots}`).join(" ");
    if (sw.Plots === 0) warn("Silver Woods villa types: expected on production only");
    else got === "T1=75 T2=6 T3=5 T4=13 T5=5 T6=4" ? pass(`Silver Woods villa types: ${got}`) : fail("Silver Woods villa types", got || "none");
  }

  console.log(`\n${fails ? fails + " FAIL(S)" : "ALL CHECKS PASSED"}${warns ? `, ${warns} warning(s)` : ""} (read-only, nothing changed)`);
  await closeDB?.();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
