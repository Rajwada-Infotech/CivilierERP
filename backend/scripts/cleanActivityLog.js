// Removes Activity Browser lines that recorded a change when nothing was changed:
//   - page-visit counts (POST /api/home/usage) and activity-log housekeeping, logged as "created" before the log moved
//     to the server
//   - opening an activity's photos (POST …/photos/carry-forward) when there was nothing to carry, which showed as
//     "Created Dependency Activity Assignment Photos" — kept when that visit did carry photos forward
//   - previews, checks and sums (…/preview, /validate, /calculate, /bulk-search), which only look things up
// Sign-ins, page opens and real changes are left alone.
//   node scripts/cleanActivityLog.js           dry run - counts what would go, changes nothing
//   node scripts/cleanActivityLog.js --apply   deletes those lines
const { connectDB, getPool, closeDB, sql } = require("../db");

const apply = process.argv.includes("--apply");
const CARRIED_NOTE = "Carried forward from previous After";

const KINDS = [
  { label: "page-visit counts", where: "RequestUrl LIKE '/api/home/usage%'" },
  { label: "activity-log housekeeping", where: "RequestUrl LIKE '/api/user-activity%'" },
  {
    label: "previews / checks / sums",
    where: `(RequestUrl LIKE '%/preview' OR RequestUrl LIKE '%/preview?%' OR RequestUrl LIKE '%/naming-preview%'
             OR RequestUrl LIKE '%/validate' OR RequestUrl LIKE '%/validate?%' OR RequestUrl LIKE '%/calculate'
             OR RequestUrl LIKE '%/calculate?%' OR RequestUrl LIKE '%/bulk-search%')`,
  },
];
const WRITES = "EventType = 'action' AND ActionType IN ('create', 'update', 'delete')";

(async () => {
  await connectDB();
  const pool = getPool();
  const ids = [];

  for (const k of KINDS) {
    const rows = (await pool.request().query(`SELECT Id FROM dbo.UserActivityLog WHERE ${WRITES} AND ${k.where}`)).recordset;
    console.log(`${String(rows.length).padStart(7)}  ${k.label}`);
    ids.push(...rows.map((r) => r.Id));
  }

  // Carry-forward: keep the visits that really copied photos (a carried photo on that activity within 6 hours of
  // the line, which covers the server's clock being UTC or IST).
  const carry = (
    await pool.request().query(`
      SELECT Id, RequestUrl, CreatedAt FROM dbo.UserActivityLog
      WHERE ${WRITES} AND RequestUrl LIKE '%/photos/carry-forward%'`)
  ).recordset;
  const carried = (
    await pool.request().input("note", sql.NVarChar(500), CARRIED_NOTE)
      .query("SELECT DependencyMasterActivityId AS rung, CapturedAt FROM dbo.ActivityPhoto WHERE Note = @note")
  ).recordset;
  const byRung = new Map();
  for (const c of carried) {
    if (!byRung.has(c.rung)) byRung.set(c.rung, []);
    byRung.get(c.rung).push(new Date(c.CapturedAt).getTime());
  }
  let kept = 0;
  for (const r of carry) {
    const rung = Number((/dependency-activity-assignment\/(\d+)\/photos/.exec(r.RequestUrl) || [])[1]);
    const at = new Date(r.CreatedAt).getTime();
    const real = (byRung.get(rung) || []).some((t) => Math.abs(t - at) <= 6 * 3600 * 1000);
    if (real) kept++;
    else ids.push(r.Id);
  }
  console.log(`${String(carry.length - kept).padStart(7)}  opening photos with nothing to carry (${kept} that did carry photos are kept)`);
  console.log(`${String(ids.length).padStart(7)}  lines in all`);

  if (!ids.length || !apply) {
    if (ids.length) console.log("Dry run - nothing changed. Run again with --apply to delete them.");
    await closeDB?.();
    process.exit(0);
  }

  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const req = pool.request();
    const params = chunk.map((id, j) => {
      req.input(`i${j}`, sql.NVarChar(50), String(id));
      return `@i${j}`;
    });
    deleted += (await req.query(`DELETE FROM dbo.UserActivityLog WHERE Id IN (${params.join(",")})`)).rowsAffected[0];
  }
  console.log(`Done - ${deleted} lines removed.`);
  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
