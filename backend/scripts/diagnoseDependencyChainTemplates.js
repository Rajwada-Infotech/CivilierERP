// Read-only diagnostic — no writes. For the planned bulk "copy the existing
// chain to every room missing one" fill-in:
//
//   1. Per Room Category: every distinct activity-chain "signature"
//      (ordered ActivityId list) already in use among existing Dependency
//      Master records for that category, and how many rooms use each —
//      so the most common one can be picked as the template with
//      confidence (or flagged if there's no clear majority).
//   2. How many active rooms of each category have NO Dependency Master
//      chain yet at all (across every project/block/floor/unit) — what
//      the bulk fill-in would actually create.
//
// Usage: node backend/scripts/diagnoseDependencyChainTemplates.js

const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  // Every existing chain, with its room's category and its activity signature.
  const chainsRes = await pool.request().query(`
    SELECT dm.Id, dm.RoomId, rm.RoomCategoryId, cat.Alias AS CategoryName,
           STRING_AGG(CAST(dma.ActivityId AS NVARCHAR(20)), ',') WITHIN GROUP (ORDER BY dma.SequenceNo) AS Signature,
           COUNT(dma.Id) AS StepCount
    FROM dbo.DependencyMaster dm
    JOIN dbo.RoomMaster rm ON rm.Id = dm.RoomId
    LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = rm.RoomCategoryId
    LEFT JOIN dbo.DependencyMasterActivity dma ON dma.DependencyMasterId = dm.Id
    WHERE dm.IsActive = 1
    GROUP BY dm.Id, dm.RoomId, rm.RoomCategoryId, cat.Alias
  `);

  const byCategory = new Map();
  let noCategory = 0;
  for (const row of chainsRes.recordset) {
    if (row.RoomCategoryId == null) { noCategory++; continue; }
    const key = row.RoomCategoryId;
    const g = byCategory.get(key) || { categoryName: row.CategoryName || `Category ${key}`, signatures: new Map() };
    const sigKey = row.Signature || "(empty)";
    const s = g.signatures.get(sigKey) || { count: 0, stepCount: row.StepCount, exampleDmId: row.Id };
    s.count++;
    g.signatures.set(sigKey, s);
    byCategory.set(key, g);
  }

  console.log(`=== Existing chains grouped by Room Category (${chainsRes.recordset.length} chains total, ${noCategory} on rooms with no category set) ===\n`);
  for (const [categoryId, g] of byCategory) {
    const sigs = [...g.signatures.entries()].sort((a, b) => b[1].count - a[1].count);
    const total = sigs.reduce((s, [, v]) => s + v.count, 0);
    console.log(`${g.categoryName} (RoomCategoryId ${categoryId}) — ${total} existing chain(s), ${sigs.length} distinct signature(s):`);
    for (const [sig, v] of sigs) {
      console.log(`    ${v.count}x  (${v.stepCount} step(s), e.g. DependencyMasterId ${v.exampleDmId})  [${sig}]`);
    }
    const majority = sigs[0];
    const isDominant = sigs.length === 1 || majority[1].count > total / 2;
    console.log(`    -> ${isDominant ? `Clear template candidate: DependencyMasterId ${majority[1].exampleDmId}` : "NO clear majority — needs manual pick"}`);
    console.log("");
  }

  // Rooms with no chain yet at all, grouped by category.
  const missingRes = await pool.request().query(`
    SELECT rm.RoomCategoryId, cat.Alias AS CategoryName, COUNT(*) AS MissingCount
    FROM dbo.RoomMaster rm
    LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = rm.RoomCategoryId
    LEFT JOIN dbo.DependencyMaster dm ON dm.RoomId = rm.Id AND dm.IsActive = 1
    WHERE rm.IsActive = 1 AND dm.Id IS NULL
    GROUP BY rm.RoomCategoryId, cat.Alias
    ORDER BY MissingCount DESC
  `);

  console.log(`=== Active rooms with NO Dependency Master chain yet, by category ===`);
  let totalMissing = 0;
  for (const row of missingRes.recordset) {
    totalMissing += row.MissingCount;
    console.log(`  ${row.CategoryName || `(no category set, RoomCategoryId ${row.RoomCategoryId ?? "NULL"})`}: ${row.MissingCount} room(s)`);
  }
  console.log(`\n${totalMissing} room(s) total would receive a new chain in the bulk fill-in.`);
  console.log("This is diagnostic only — nothing was changed.");

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
