/**
 * findGodownsMissingProject.js
 *
 * Read-only diagnostic. Lists every Godown that has no ProjectID set —
 * these will fail the "Both the source and destination godowns must be
 * linked to a Project" validation in Stock Transfer / Inter-Company
 * Transfer. There's no safe way to auto-infer the correct project for an
 * existing godown, so this just surfaces the list for manual fix-up via
 * the Godown Admin UI.
 *
 * Run on the target server (uses its own .env / DB connection):
 *   node backend/scripts/findGodownsMissingProject.js
 */

require("../config/env").loadEnv();
const { connectDB, getPool } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT g.GodownID, g.GodownName, g.EnterpriseID, e.name AS EnterpriseName, e.business_type
    FROM dbo.Godowns g
    LEFT JOIN dbo.enterprise e ON e.id = g.EnterpriseID
    WHERE g.ProjectID IS NULL
    ORDER BY g.GodownID
  `);

  if (result.recordset.length === 0) {
    console.log("No godowns missing a ProjectID link. All clear.");
  } else {
    console.log(`${result.recordset.length} godown(s) missing a ProjectID link:\n`);
    for (const row of result.recordset) {
      console.log(
        `  GodownID=${row.GodownID}  "${row.GodownName}"  Enterprise=${row.EnterpriseID} (${row.EnterpriseName ?? "unknown"}, type=${row.business_type ?? "?"})`,
      );
    }
    console.log(
      "\nFix each of these via the Godown Admin page by assigning the correct Project — there is no reliable way to auto-infer it.",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
