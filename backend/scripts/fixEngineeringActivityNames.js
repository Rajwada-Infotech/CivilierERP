"use strict";
/**
 * Cleans up Engineering Activity Master names (typos, capitals, quantities in names) and the copies of those names
 * saved on BOQs and work orders. Matches on the exact current name + type, by id, in one transaction.
 *
 *   node scripts/fixEngineeringActivityNames.js            dry run: shows what would change
 *   APPLY=1 node scripts/fixEngineeringActivityNames.js    makes the changes
 */
let db;
try { db = require("/app/db"); } catch { require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true }); db = require("../db"); }
const { connectDB, getPool, sql } = db;

// [type, current name, new name]   type: 0 = Group, 1 = Activity
const RENAMES = [
  [0, "TOILET PLUMBING WORK AND CP FITTINGS", "Toilet Plumbing Work and CP Fittings"],
  [1, "TOILET PLUMBING WORK AND CP FITTINGS", "Toilet Plumbing Work and CP Fittings"],
  [0, "600X600MM MANEHOOL/STROM CHEMBER BRICK WORK,PLASTER,NET CIMENTING,COVER FIXING COMPLETATE", "Manhole / Storm Chamber Work (600 × 600 mm)"],
  [1, "600X600MM MANEHOOL/STROM CHEMBER BRICK WORK,PLASTER,NET CIMENTING,COVER FIXING COMPLETATE", "600 × 600 mm Manhole / Storm Chamber: Brick Work, Plaster, Net Cementing and Cover Fixing (Complete)"],
  [0, "EARTH CUTTING,SOLING,PCC DWC PIPE LAYN", "Earth Cutting, Soling, PCC and DWC Pipe Laying"],
  [1, "EARTH CUTTING,SOLING,PCC DWC PIPE LAYN", "Earth Cutting, Soling, PCC and DWC Pipe Laying"],
  [0, "KITCHEN PLUMBING WORK AND CP FITTINGS", "Kitchen Plumbing Work and CP Fittings"],
  [1, "KITCHEN PLUMBING WORK AND CP FITTINGS", "Kitchen Plumbing Work and CP Fittings"],
  [0, "Pile Foundation Work 146 NOS", "Pile Foundation Work"],
  [1, "Reinforcement Work 32.12 mt", "Reinforcement Work"],
  [1, "Concreting Work 464.28 cum", "Concreting Work"],
  [1, "PIle Work", "Pile Work"],
  [1, "Pile Cap & Tie beam", "Pile Cap & Tie Beam"],
];

const apply = process.env.APPLY === "1";

(async () => {
  await connectDB();
  const tx = new sql.Transaction(getPool());
  await tx.begin();
  try {
    for (const [type, from, to] of RENAMES) {
      const found = (await tx.request().input("t", sql.TinyInt, type).input("n", sql.NVarChar(255), from).query(`
        SELECT id FROM dbo.EngineeringActivityMaster WHERE activity_type = @t AND LTRIM(RTRIM(activity_name)) = @n`)).recordset;
      const kind = type === 0 ? "Group   " : "Activity";
      if (!found.length) {
        console.log(`  skip  ${kind} "${from}" (not found, maybe already renamed)`);
        continue;
      }
      for (const { id } of found) {
        const r = tx.request().input("id", sql.Int, id).input("to", sql.NVarChar(255), to);
        const res = await r.query(`
          UPDATE dbo.EngineeringActivityMaster SET activity_name = @to, updated_at = SYSUTCDATETIME() WHERE id = @id;
          ${type === 0
            ? `UPDATE dbo.BoqActivities SET GroupName = @to WHERE GroupId = @id;
               UPDATE dbo.WorkOrderActivities SET AGroupName = @to WHERE ActivityGroupId = @id;`
            : `UPDATE dbo.BoqActivities SET ActivityName = @to WHERE ActivityId = @id;
               UPDATE dbo.BoqItems SET ActivityName = @to WHERE ActivityId = @id;
               UPDATE dbo.WorkOrderActivities SET ActivityName = @to WHERE ActivityId = @id;`}`);
        const [, ...copies] = res.rowsAffected;
        console.log(`  ${apply ? "fixed" : "would"} ${kind} #${id} "${from}" → "${to}"  (BOQ/WO copies: ${copies.reduce((a, b) => a + b, 0)})`);
      }
    }
    if (apply) {
      await tx.commit();
      console.log("\nSaved.");
    } else {
      await tx.rollback();
      console.log("\nDry run, nothing saved. Run with APPLY=1 to make the changes.");
    }
    process.exit(0);
  } catch (e) {
    await tx.rollback().catch(() => {});
    console.error("Failed, nothing saved:", e.message);
    process.exit(1);
  }
})();
