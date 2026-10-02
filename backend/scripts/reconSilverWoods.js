"use strict";
/**
 * READ-ONLY: everything production holds that bears on entering the Silver
 * Woods plots — the project record(s), company, project type, blocks, plots,
 * units, facing master, asset kinds, CRM activity and the plot naming already
 * used elsewhere. Writes nothing.
 *
 * Run: node scripts/reconSilverWoods.js
 */
const { connectDB, getPool, closeDB } = require("../db");
const q = async (s) => (await getPool().request().query(s)).recordset;
const show = (title, rows) => {
  console.log(`\n=== ${title} === (${rows.length})`);
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  for (const r of rows) console.log("  " + keys.map((k) => `${k}=${r[k] instanceof Date ? r[k].toISOString().slice(0, 10) : r[k]}`).join(" | "));
};
const safe = async (title, s) => { try { show(title, await q(s)); } catch (e) { console.log(`\n=== ${title} === (could not read: ${e.message})`); } };

(async () => {
  await connectDB();
  console.log(`Silver Woods recon ${new Date().toISOString()} — database ${(await q("SELECT DB_NAME() d"))[0].d}`);

  await safe("Project records matching silver", `
    SELECT e.id, e.name, e.business_type, e.company_id, c.name AS company, ISNULL(e.discontinue,0) AS discontinued,
           e.project_type_id, pt.Name AS project_type
    FROM dbo.enterprise e
    LEFT JOIN dbo.enterprise c ON c.id = e.company_id
    LEFT JOIN dbo.ProjectTypeMaster pt ON pt.Id = e.project_type_id
    WHERE e.name LIKE '%silver%' OR e.name LIKE '%silverwood%'`);
  await safe("Account heads matching silver", `
    SELECT LHeadId, LHeadCode, LHeadName, LHeadType FROM dbo.AccountHeadMaster WHERE LHeadName LIKE '%silver%'`);
  await safe("Project types", `SELECT * FROM dbo.ProjectTypeMaster ORDER BY Id`);
  await safe("Blocks of silver projects", `
    SELECT b.Id, b.ProjectId, b.BlockName, b.IsActive FROM dbo.BlockMaster b
    JOIN dbo.enterprise e ON e.id = b.ProjectId WHERE e.name LIKE '%silver%' ORDER BY b.ProjectId, b.Id`);
  await safe("Floors of silver projects", `
    SELECT f.* FROM dbo.CrmProjectAutoSetupFloor f JOIN dbo.BlockMaster b ON b.Id = f.BlockId
    JOIN dbo.enterprise e ON e.id = b.ProjectId WHERE e.name LIKE '%silver%'`);
  await safe("Units in silver projects", `
    SELECT u.ProjectId, COUNT(*) AS Units, SUM(CASE WHEN u.IsActive = 1 THEN 1 ELSE 0 END) AS Active
    FROM dbo.UnitMaster u JOIN dbo.enterprise e ON e.id = u.ProjectId WHERE e.name LIKE '%silver%' GROUP BY u.ProjectId`);
  await safe("Plots in silver projects", `
    SELECT p.ProjectId, p.BlockId, COUNT(*) AS Plots, MIN(p.PlotName) AS FirstName, MAX(p.PlotName) AS LastName
    FROM dbo.PlotMaster p JOIN dbo.enterprise e ON e.id = p.ProjectId WHERE e.name LIKE '%silver%' GROUP BY p.ProjectId, p.BlockId`);
  await safe("Plot templates in silver projects", `
    SELECT t.* FROM dbo.CrmProjectAutoSetupPlotTemplate t JOIN dbo.BlockMaster b ON b.Id = t.BlockId JOIN dbo.enterprise e ON e.id = b.ProjectId WHERE e.name LIKE '%silver%'`);
  await safe("All plots anywhere (naming in use)", `
    SELECT TOP 10 p.ProjectId, p.PlotNo, p.PlotName FROM dbo.PlotMaster p ORDER BY p.Id`);
  await safe("PlotMaster columns", `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PlotMaster' ORDER BY ORDINAL_POSITION`);
  await safe("Plot facing master", `SELECT * FROM dbo.PlotFacingMaster ORDER BY 1`);
  await safe("Constructed asset kinds", `SELECT Code, Name, IsLand, IsActive FROM dbo.CrmConstructedAssetKind ORDER BY SortOrder`);
  await safe("Unit layout types (villa types?)", `SELECT Id, TypeKey, Label, IsActive FROM dbo.RoomLayoutType ORDER BY Id`);
  await safe("CRM activity on silver projects", `
    SELECT (SELECT COUNT(*) FROM dbo.CrmApplication a JOIN dbo.enterprise e ON e.id = a.ProjectId WHERE e.name LIKE '%silver%') AS Applications,
           (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.enterprise e ON e.id = b.ProjectId WHERE e.name LIKE '%silver%') AS Bookings,
           (SELECT COUNT(*) FROM dbo.CrmCustomer) AS CustomersTotal`);
  await safe("Customers already on file whose names appear in the sheet", `
    SELECT Id, CustomerNo, CustomerName FROM dbo.CrmCustomer
    WHERE CustomerName LIKE '%Ayushi%' OR CustomerName LIKE '%Bharat Chow%' OR CustomerName LIKE '%Veena%' OR CustomerName LIKE '%SREEKANT%'
       OR CustomerName LIKE '%Debraj%' OR CustomerName LIKE '%Abir Dutta%' OR CustomerName LIKE '%Malini%' OR CustomerName LIKE '%Satadru%'
       OR CustomerName LIKE '%Sambhu%' OR CustomerName LIKE '%Sejal%' OR CustomerName LIKE '%Abhinav%' OR CustomerName LIKE '%Sarek%'
       OR CustomerName LIKE '%Ashok Kumar Gupta%' OR CustomerName LIKE '%Shaikh Ali%' OR CustomerName LIKE '%Ankita%' OR CustomerName LIKE '%Sani Kumar%'
       OR CustomerName LIKE '%Sunil%' OR CustomerName LIKE '%Suchitra%'`);
  console.log("\nRecon complete — read-only, nothing changed.");
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
