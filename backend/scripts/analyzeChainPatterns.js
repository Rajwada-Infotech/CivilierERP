// READ-ONLY. Learns the DPR chain pattern from the chains that already exist,
// so missing chains can be filled from data rather than a typed list:
//   1. coverage per project: active rooms, rooms with a chain
//   2. per room category (and room name): the distinct step sequences in use
//      (ordered ActivityIds + WorkType), how many chains use each, and in
//      which projects — so we can see whether one sequence is THE template
//
// Usage: node scripts/analyzeChainPatterns.js

const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  console.log("== 1. COVERAGE (active rooms vs rooms with a chain) ==");
  const cov = await q(`
    SELECT Project, COUNT(*) AS Rooms, SUM(HasChain) AS Chained FROM (
      SELECT LTRIM(RTRIM(e.name)) AS Project,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id AND d.IsActive = 1) THEN 1 ELSE 0 END AS HasChain
      FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId AND u.IsActive = 1
      JOIN dbo.enterprise e ON e.id = r.ProjectId
      WHERE r.IsActive = 1) x
    GROUP BY Project ORDER BY Project`);
  for (const c of cov) console.log(`   ${c.Project.padEnd(20)} rooms ${String(c.Rooms).padStart(5)}   with chain ${String(c.Chained).padStart(5)}   missing ${c.Rooms - c.Chained}`);

  console.log("\n== 2. STEP SEQUENCES IN USE, per room category ==");
  const rows = await q(`
    SELECT d.Id, c.Alias AS Category, r.RoomName, LTRIM(RTRIM(e.name)) AS Project, d.WorkType,
      (SELECT STRING_AGG(CONCAT(x.ActivityId, ':', ISNULL(x.WorkType, '')), ',') WITHIN GROUP (ORDER BY x.SequenceNo)
         FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d.Id) AS Seq
    FROM dbo.DependencyMaster d JOIN dbo.RoomMaster r ON r.Id = d.RoomId
    LEFT JOIN dbo.RoomCategoryMaster c ON c.Id = r.RoomCategoryId
    JOIN dbo.enterprise e ON e.id = d.ProjectId
    WHERE d.IsActive = 1`);
  const byCat = new Map();
  for (const r of rows) {
    const k = r.Category || "(no category)";
    if (!byCat.has(k)) byCat.set(k, new Map());
    const m = byCat.get(k);
    const key = `${r.WorkType}|${r.Seq}`;
    if (!m.has(key)) m.set(key, { n: 0, projects: new Set(), names: new Set(), sample: r.Id, steps: (r.Seq || "").split(",").filter(Boolean).length });
    const v = m.get(key); v.n++; v.projects.add(r.Project); v.names.add(r.RoomName.replace(/\s*\d+$/, ""));
  }
  for (const [cat, m] of byCat) {
    const total = [...m.values()].reduce((s, v) => s + v.n, 0);
    console.log(`\n   ${cat}: ${total} chains, ${m.size} distinct sequence(s)`);
    [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5).forEach(([key, v], i) => {
      console.log(`     #${i + 1} used by ${v.n} (${Math.round(100 * v.n / total)}%) — ${v.steps} steps, workType ${key.split("|")[0]}, e.g. chain #${v.sample}, projects: ${[...v.projects].join(", ")}; room names: ${[...v.names].join(", ")}`);
    });
  }
  console.log("\nREAD-ONLY — nothing was changed.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("analyzeChainPatterns failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
