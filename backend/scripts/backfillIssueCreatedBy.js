// Backfills MaterialIssues.CreatedBy for one record, given a known user
// name — for IssueId 23 (ISS-2026-00023), the user confirmed it was
// created by "Hrithik". CreatedBy is a numeric users.id (see
// materialIssues.js's POST / route), so this looks up the id by name
// rather than guessing it.
//
// Dry-run by default. Usage:
//   node backend/scripts/backfillIssueCreatedBy.js --issue=23 --user="Hrithik" [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const issueArg = process.argv.find((a) => a.startsWith("--issue="));
const userArg = process.argv.find((a) => a.startsWith("--user="));
const ISSUE_ID = issueArg ? parseInt(issueArg.split("=")[1], 10) : null;
const NAME = userArg ? userArg.split("=")[1].replace(/^"|"$/g, "") : null;

async function main() {
  if (!ISSUE_ID || !NAME) {
    console.error('Usage: node backfillIssueCreatedBy.js --issue=23 --user="Hrithik" [--apply]');
    process.exit(1);
  }
  await connectDB();
  const pool = getPool();

  const issueRes = await pool.request().input("id", sql.Int, ISSUE_ID).query(`
    SELECT IssueId, DocNo, CreatedBy FROM dbo.MaterialIssues WHERE IssueId = @id
  `);
  if (!issueRes.recordset.length) {
    console.error(`No MaterialIssues row with IssueId ${ISSUE_ID}.`);
    await closeDB();
    process.exit(1);
  }
  const issue = issueRes.recordset[0];
  console.log(`${issue.DocNo} (IssueId ${issue.IssueId}): current CreatedBy = ${issue.CreatedBy === null ? "NULL" : issue.CreatedBy}`);
  if (issue.CreatedBy !== null) {
    console.log("Already has a CreatedBy — refusing to overwrite. Aborting.");
    await closeDB();
    return;
  }

  const usersRes = await pool.request().input("name", sql.NVarChar(200), `%${NAME}%`).query(`
    SELECT id, name, email FROM dbo.users WHERE name LIKE @name
  `);
  if (usersRes.recordset.length !== 1) {
    console.error(`Expected exactly one user matching "${NAME}", found ${usersRes.recordset.length}:`);
    usersRes.recordset.forEach((u) => console.error(`  id ${u.id} — "${u.name}" <${u.email}>`));
    await closeDB();
    process.exit(1);
  }
  const user = usersRes.recordset[0];
  console.log(`Match: id ${user.id} — "${user.name}" <${user.email}>`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await closeDB();
    return;
  }

  await pool.request().input("IssueId", sql.Int, ISSUE_ID).input("CreatedBy", sql.Int, user.id).query(`
    UPDATE dbo.MaterialIssues SET CreatedBy = @CreatedBy WHERE IssueId = @IssueId
  `);
  console.log(`\nDone — ${issue.DocNo} CreatedBy set to ${user.name}.`);

  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
