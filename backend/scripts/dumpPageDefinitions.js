// One-off, READ-ONLY: dumps every dbo.PageDefinitions row in a stable,
// diffable text format (one line per row, sorted by PageKey) so two
// environments (e.g. local dev vs production) can be compared with a plain
// `diff` between two runs of this script.
//
// Usage: node scripts/dumpPageDefinitions.js > pagedefs-<env>.txt
const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
    FROM dbo.PageDefinitions
    ORDER BY PageKey
  `);

  for (const r of result.recordset) {
    console.log(
      [
        r.PageKey,
        r.Label,
        r.Module,
        r.GroupName,
        r.Actions,
        r.SortOrder,
        r.IsActive ? 1 : 0,
      ].join(" | "),
    );
  }

  console.error(`\n[dumpPageDefinitions] ${result.recordset.length} rows`);

  await closeDB();
}

main().catch((err) => {
  console.error("Dump failed:", err);
  process.exit(1);
});
