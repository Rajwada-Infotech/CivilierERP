// READ-ONLY. Before any structure/name correction: shows where every name a
// unit is built from actually lives, so nothing is hard-coded.
//   1. per project: enterprise.name / short_name / business_identity vs the
//      prefix its units actually use, and the unit-name formats in use
//   2. every OTHER column in the DB that stores a copy of a unit, block or
//      project name (found by scanning the schema, then counting real
//      matches against live names) — these must be kept in sync on rename
//   3. reference values: UnitKind values in use, RoomLayoutType labels
//
// Usage: node scripts/discoverNamingSources.js

const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  console.log("== 1. PROJECTS: stored names vs unit prefixes in use ==");
  const projects = await q(`
    SELECT e.id, e.name, e.short_name, e.business_identity, ISNULL(e.discontinue,0) AS disc
    FROM dbo.enterprise e WHERE e.business_type = 'P'
      AND EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE u.ProjectId = e.id)
    ORDER BY e.name`);
  const units = await q(`SELECT u.ProjectId, u.UnitName, b.BlockName FROM dbo.UnitMaster u LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId`);
  const shape = (name, block) => {
    const parts = String(name).split("/");
    const blockAt = parts.findIndex((p) => p === block);
    return parts.map((p, i) => (i === 0 ? "PREFIX" : i === blockAt ? "BLOCK" : /^\d+[A-Z]$/.test(p) ? "nX" : /^\d{3,4}$/.test(p) ? "nnn" : /^\d+$/.test(p) ? "n" : /^[A-Z]$/.test(p) ? "X" : `?${p}`)).join("/");
  };
  for (const p of projects) {
    const pu = units.filter((u) => u.ProjectId === p.id);
    const prefixes = {}, shapes = {};
    for (const u of pu) {
      const pre = String(u.UnitName).split("/")[0];
      prefixes[pre] = (prefixes[pre] || 0) + 1;
      const s = shape(u.UnitName, u.BlockName);
      shapes[s] = (shapes[s] || 0) + 1;
    }
    console.log(`#${p.id} name="${p.name}" short_name="${p.short_name ?? ""}" business_identity="${p.business_identity ?? ""}"${p.disc ? " [DISCONTINUED]" : ""}`);
    console.log(`     unit prefixes in use: ${JSON.stringify(prefixes)}   name shapes: ${JSON.stringify(shapes)}`);
  }

  console.log("\n== 2. OTHER COLUMNS HOLDING A COPY OF A UNIT / BLOCK / PROJECT NAME ==");
  const cands = await q(`
    SELECT t.name AS tbl, c.name AS col
    FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE ty.name IN ('nvarchar','varchar','nchar','char')
      AND (c.name LIKE '%Unit%' OR c.name LIKE '%Flat%' OR c.name LIKE '%Block%' OR c.name LIKE '%Tower%'
           OR c.name LIKE '%Project%' OR c.name IN ('Alias','Name','name','Title','Description'))
      AND NOT (t.name = 'UnitMaster' AND c.name = 'UnitName')
      AND NOT (t.name = 'BlockMaster' AND c.name = 'BlockName')
      AND NOT (t.name = 'enterprise' AND c.name IN ('name','short_name'))
    ORDER BY t.name, c.name`);
  const unitNames = [...new Set(units.map((u) => u.UnitName))];
  const blockNames = [...new Set((await q("SELECT BlockName FROM dbo.BlockMaster")).map((r) => r.BlockName))];
  const projNames = projects.map((p) => p.name);
  const tvp = (arr) => arr.map((s) => `N'${String(s).replace(/'/g, "''")}'`).join(",");
  for (const { tbl, col } of cands) {
    let r;
    try {
      r = (await q(`
        SELECT SUM(eu) AS exactUnit, SUM(up) AS unitPrefixed, SUM(eb) AS exactBlock, SUM(ep) AS exactProject, COUNT(*) AS total
        FROM (
          SELECT
            CASE WHEN EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE u.UnitName = LTRIM(RTRIM(x.[${col}]))) THEN 1 ELSE 0 END AS eu,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE x.[${col}] LIKE u.UnitName + '/%') THEN 1 ELSE 0 END AS up,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.BlockMaster b WHERE b.BlockName = LTRIM(RTRIM(x.[${col}]))) THEN 1 ELSE 0 END AS eb,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.enterprise e WHERE e.business_type = 'P' AND LTRIM(RTRIM(e.name)) = LTRIM(RTRIM(x.[${col}]))) THEN 1 ELSE 0 END AS ep
          FROM dbo.[${tbl}] x WHERE x.[${col}] IS NOT NULL
        ) z`))[0];
    } catch (e) {
      console.log(`  (skipped ${tbl}.${col}: ${e.message})`);
      continue;
    }
    if (r.exactUnit || r.unitPrefixed || r.exactProject || (r.exactBlock && /block|tower/i.test(col))) {
      console.log(`  ${tbl}.${col}: rows=${r.total}  = unit name: ${r.exactUnit}   starts with "unitname/": ${r.unitPrefixed}   = block name: ${r.exactBlock}   = project name: ${r.exactProject}`);
    }
  }

  console.log("\n== 3. REFERENCE VALUES ==");
  console.log("UnitKind in use:", JSON.stringify(await q("SELECT ISNULL(UnitKind,'(null)') AS k, COUNT(*) AS n FROM dbo.UnitMaster GROUP BY UnitKind")));
  console.log("RoomLayoutType:", (await q("SELECT Id, TypeKey, Label, IsActive FROM dbo.RoomLayoutType ORDER BY SortOrder, Label")).map((r) => `#${r.Id} ${r.Label}${r.IsActive ? "" : "(x)"}`).join(", "));
  console.log("\nREAD-ONLY — nothing was changed.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("discoverNamingSources failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
