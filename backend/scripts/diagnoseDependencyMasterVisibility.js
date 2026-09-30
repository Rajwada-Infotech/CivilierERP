// Diagnoses why newly created Dependency Master chains might not show up on
// the Dependency Master list page (src/pages/masters/DependencyMaster/DependencyMasterPage.tsx).
// That page's GET / (backend/routes/dependencyMaster.js) has no scope filter,
// no IsActive filter, and no pagination — it should return every row. So if
// rows are missing from the UI, either they didn't actually get inserted,
// or something about their FK values breaks the LEFT JOINs used to build
// scopePath (which itself shouldn't hide a row, just blank a segment) — or
// they exist but under a project/date the user isn't expecting.
//
// Read-only. Usage:
//   node backend/scripts/diagnoseDependencyMasterVisibility.js [--project="Luxuria"]

const { connectDB, getPool, sql, closeDB } = require("../db");

const projectArg = process.argv.find((a) => a.startsWith("--project="));
const PROJECT_NAME = projectArg ? projectArg.split("=")[1].replace(/^"|"$/g, "") : null;

async function main() {
  await connectDB();
  const pool = getPool();

  const totalRes = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyMaster`);
  console.log(`Total DependencyMaster rows in DB: ${totalRes.recordset[0].c}`);

  const recentRes = await pool.request().query(`
    SELECT TOP 10 Id, Alias, ProjectId, CreatedBy, CreatedAt
    FROM dbo.DependencyMaster
    ORDER BY Id DESC
  `);
  console.log(`\nMost recent 10 rows (by Id):`);
  recentRes.recordset.forEach((r) =>
    console.log(`  Id ${r.Id} | ProjectId ${r.ProjectId} | "${r.Alias}" | CreatedBy ${r.CreatedBy} | ${r.CreatedAt}`),
  );

  // Rows whose ProjectId doesn't resolve to a project under the same join
  // condition the list route uses (ep.business_type = 'P') — these would
  // still show up (LEFT JOIN), just with a blank Project column, so this is
  // informational, not a hide-cause, but worth flagging.
  const orphanProjectRes = await pool.request().query(`
    SELECT COUNT(*) AS c
    FROM dbo.DependencyMaster dm
    LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
    WHERE ep.id IS NULL
  `);
  console.log(`\nRows whose ProjectId doesn't resolve to a Project (business_type='P'): ${orphanProjectRes.recordset[0].c}`);

  if (PROJECT_NAME) {
    const projRes = await pool.request().input("name", sql.NVarChar(200), `%${PROJECT_NAME}%`).query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND name LIKE @name ORDER BY name
    `);
    console.log(`\nProjects matching "${PROJECT_NAME}":`);
    projRes.recordset.forEach((p) => console.log(`  id ${p.id} — "${p.name}"`));

    for (const p of projRes.recordset) {
      const cntRes = await pool.request().input("pid", sql.Int, p.id).query(`
        SELECT COUNT(*) AS c FROM dbo.DependencyMaster WHERE ProjectId = @pid
      `);
      console.log(`  -> DependencyMaster rows for ProjectId ${p.id}: ${cntRes.recordset[0].c}`);
    }
  }

  // Confirm the GET / query itself actually returns what's in the table —
  // run it verbatim and compare its row count to the raw table count.
  const listRes = await pool.request().query(`
    SELECT dm.Id AS id
    FROM dbo.DependencyMaster dm
    LEFT JOIN dbo.enterprise   ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
    LEFT JOIN dbo.BlockMaster  bm ON bm.Id = dm.TowerId
    LEFT JOIN dbo.UnitMaster   um ON um.Id = dm.FlatId
    LEFT JOIN dbo.RoomMaster   rm ON rm.Id = dm.RoomId
    ORDER BY dm.Id DESC
  `);
  console.log(`\nGET / query (as the route runs it) returns: ${listRes.recordset.length} row(s).`);
  if (listRes.recordset.length !== totalRes.recordset[0].c) {
    console.log(`  MISMATCH — the route's JOINs are dropping rows! (should never happen with LEFT JOINs — investigate FK types)`);
  } else {
    console.log(`  Matches the raw table count — the backend returns every row. If the UI still shows fewer, it's a frontend/cache issue (hard refresh, or check the browser network tab response).`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
