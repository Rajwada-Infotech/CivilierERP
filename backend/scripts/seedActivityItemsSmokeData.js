// Links a couple of real Item_Master_Group items to each of the 5
// activities used by the earlier smoke-seeded Dependency Master chains
// (seedDependencyMasterSmokeData.js), so Work Reporting's new per-rung
// "assign engineer & material" popup has something to show instead of
// "No materials are linked to this activity yet." Idempotent — re-running
// skips links that already exist. Not committed, matching this session's
// scratch-seed convention.
//
//   node scripts/seedActivityItemsSmokeData.js
//   node scripts/seedActivityItemsSmokeData.js --clean

const { getPool, connectDB, sql } = require("../db");

const LINKS = {
  "Electrical Wiring": ["Cables & Wires", "Anchors & Inserts"],
  "Plastering": ["Cement", "Sand"],
  "Tiling": ["Ceramic Tiles", "Vitrified Tiles"],
  "Painting": ["Interior Paints", "Exterior Paints"],
  "Fixture Installation": ["Sanitary Fixtures", "Lighting Fixtures", "Bolts, Nuts & Screws"],
};

async function main() {
  const clean = process.argv.includes("--clean");
  await connectDB();
  const pool = await getPool();

  const actRes = await pool.request().query(`
    SELECT id, activity_name FROM dbo.ActivityMaster WHERE activity_name IN (${Object.keys(LINKS)
      .map((n) => `'${n.replace(/'/g, "''")}'`)
      .join(",")})
  `);
  const activityByName = new Map(actRes.recordset.map((r) => [r.activity_name, r.id]));

  const itemNames = [...new Set(Object.values(LINKS).flat())];
  const itemRes = await pool.request().query(`
    SELECT M_Id, M_Name FROM dbo.Item_Master_Group WHERE M_Name IN (${itemNames
      .map((n) => `'${n.replace(/'/g, "''")}'`)
      .join(",")})
  `);
  const itemByName = new Map(itemRes.recordset.map((r) => [r.M_Name, r.M_Id]));

  if (clean) {
    const activityIds = [...activityByName.values()];
    if (activityIds.length) {
      await pool.request().query(`
        DELETE FROM dbo.ActivityItems WHERE ActivityId IN (${activityIds.join(",")}) AND CreatedBy = 'smoke-seed'
      `);
    }
    console.log("Cleaned smoke-seeded ActivityItems links.");
    process.exit(0);
  }

  let inserted = 0;
  for (const [activityName, items] of Object.entries(LINKS)) {
    const activityId = activityByName.get(activityName);
    if (!activityId) {
      console.warn(`Skip: activity "${activityName}" not found`);
      continue;
    }
    for (const itemName of items) {
      const itemId = itemByName.get(itemName);
      if (!itemId) {
        console.warn(`Skip: item "${itemName}" not found`);
        continue;
      }
      const existing = await pool
        .request()
        .input("activityId", sql.Int, activityId)
        .input("itemId", sql.UniqueIdentifier, itemId)
        .query(`SELECT 1 FROM dbo.ActivityItems WHERE ActivityId = @activityId AND ItemId = @itemId`);
      if (existing.recordset.length) continue;

      await pool
        .request()
        .input("activityId", sql.Int, activityId)
        .input("itemId", sql.UniqueIdentifier, itemId)
        .input("createdBy", sql.NVarChar(200), "smoke-seed")
        .query(`
          INSERT INTO dbo.ActivityItems (ActivityId, ItemId, CreatedBy)
          VALUES (@activityId, @itemId, @createdBy)
        `);
      inserted++;
    }
  }

  console.log(`Inserted ${inserted} ActivityItems links.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
