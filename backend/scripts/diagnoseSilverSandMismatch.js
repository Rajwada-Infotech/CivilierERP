// Read-only: the user flagged that Item Master's own "Silver Sand" record
// shows an EMPTY Days of Supply field, contradicting the earlier finding
// that the 3rd item on MRId 1028 has M_DaysOfSupply=5 — that earlier query
// actually returned the item NAME "Medium Sand" for that GUID, not "Silver
// Sand", which went unnoticed. This checks whether MRId 1028's stored
// ItemId genuinely points to a Item_Master_Group row named something other
// than "Silver Sand" (a stale ItemName on the MR line vs. the item it's
// actually linked to), and separately looks up the real "Silver Sand" row.
//
// Usage: node backend/scripts/diagnoseSilverSandMismatch.js [--mr=1028]

const { connectDB, getPool, sql, closeDB } = require("../db");

const mrArg = process.argv.find((a) => a.startsWith("--mr="));
const MR_ID = mrArg ? parseInt(mrArg.split("=")[1], 10) : 1028;

async function main() {
  await connectDB();
  const pool = getPool();

  const mrItemRes = await pool.request().input("mr", sql.Int, MR_ID).query(`
    SELECT MRItemId, ItemId, ItemName AS StoredItemName, Quantity, UOMCode
    FROM dbo.MaterialRequestItems
    WHERE MRId = @mr
  `);
  console.log(`MaterialRequestItems rows for MRId ${MR_ID}:`);
  mrItemRes.recordset.forEach((r) =>
    console.log(`  MRItemId ${r.MRItemId} | ItemId=${r.ItemId} | StoredItemName="${r.StoredItemName}" | Qty=${r.Quantity} ${r.UOMCode || ""}`),
  );

  console.log(`\nWhat each ItemId actually resolves to in Item_Master_Group right now:`);
  for (const row of mrItemRes.recordset) {
    const im = await pool.request().input("id", sql.NVarChar(50), row.ItemId).query(`
      SELECT M_Id, M_Name, M_DaysOfSupply
      FROM dbo.Item_Master_Group
      WHERE CONVERT(NVARCHAR(50), M_Id) = @id
    `);
    if (!im.recordset.length) {
      console.log(`  ItemId ${row.ItemId}: NO MATCHING Item_Master_Group row at all (orphaned reference).`);
    } else {
      const m = im.recordset[0];
      const mismatch = m.M_Name?.trim().toLowerCase() !== row.StoredItemName?.trim().toLowerCase();
      console.log(`  ItemId ${row.ItemId}: Item Master says "${m.M_Name}", DaysOfSupply=${m.M_DaysOfSupply ?? "NULL"} ${mismatch ? `  <-- MISMATCH vs MR's stored name "${row.StoredItemName}"` : "(name matches)"}`);
    }
  }

  console.log(`\nActual "Silver Sand" row(s) in Item_Master_Group (by name):`);
  const bySilver = await pool.request().query(`
    SELECT M_Id, M_Name, M_DaysOfSupply
    FROM dbo.Item_Master_Group
    WHERE M_Name LIKE '%Silver Sand%'
  `);
  if (!bySilver.recordset.length) console.log("  (none found by that name)");
  bySilver.recordset.forEach((m) => console.log(`  M_Id ${m.M_Id} — "${m.M_Name}" — DaysOfSupply=${m.M_DaysOfSupply ?? "NULL"}`));

  console.log(`\nActual "Medium Sand" row(s) in Item_Master_Group (by name):`);
  const byMedium = await pool.request().query(`
    SELECT M_Id, M_Name, M_DaysOfSupply
    FROM dbo.Item_Master_Group
    WHERE M_Name LIKE '%Medium Sand%'
  `);
  if (!byMedium.recordset.length) console.log("  (none found by that name)");
  byMedium.recordset.forEach((m) => console.log(`  M_Id ${m.M_Id} — "${m.M_Name}" — DaysOfSupply=${m.M_DaysOfSupply ?? "NULL"}`));

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
