// Activities reported before dates were worked out automatically: work has been done (progress above 0) but the
// allocation left the dates blank. This fills them the way reporting now does, never over a date someone entered:
//   Start date - the first day work was reported (FirstReportedAt, else the logbook's first entry with progress)
//   End date   - for an activity at 100% with a known start, the day the logbook first shows 100% (else the day it
//                was last updated); never before the start. No start known = no end filled either.
//   Days       - start to end, counting both days
//   node scripts/fillActivityDates.js           dry run - lists them, changes nothing
//   node scripts/fillActivityDates.js --apply   fills the dates in
const { connectDB, getPool, closeDB } = require("../db");

const apply = process.argv.includes("--apply");

// What each current assignment would get, worked out in one place so the dry run and the update agree.
const PLAN = `
  SELECT a.Id, a.DependencyMasterActivityId AS RungId, a.Status, a.ProgressPercent,
         a.StartDate AS OldStart, a.EndDate AS OldEnd, a.Days AS OldDays,
         s.NewStart,
         CASE WHEN a.ProgressPercent = 100 AND a.EndDate IS NULL AND COALESCE(a.StartDate, s.NewStart) IS NOT NULL THEN
           CASE WHEN COALESCE(a.StartDate, s.NewStart) > e.Done THEN COALESCE(a.StartDate, s.NewStart) ELSE e.Done END
         END AS NewEnd
  FROM dbo.DependencyActivityAssignment a
  OUTER APPLY (
    SELECT COALESCE(a.FirstReportedAt,
      (SELECT MIN(d.LogDate) FROM dbo.DependencyActivityDailyLog d
        WHERE d.DependencyMasterActivityId = a.DependencyMasterActivityId AND d.ProgressPercent > 0)) AS NewStart
    WHERE a.StartDate IS NULL
  ) s
  OUTER APPLY (
    SELECT COALESCE(
      (SELECT MIN(d.LogDate) FROM dbo.DependencyActivityDailyLog d
        WHERE d.DependencyMasterActivityId = a.DependencyMasterActivityId AND d.ProgressPercent = 100),
      CAST(a.UpdatedAt AS DATE)) AS Done
  ) e
  WHERE a.IsCurrent = 1 AND a.ProgressPercent > 0
    AND (a.StartDate IS NULL OR a.EndDate IS NULL OR a.Days IS NULL)`;

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`${PLAN} ORDER BY a.Id`)).recordset;
  const work = rows.filter((r) => r.NewStart || r.NewEnd || (r.OldDays == null && (r.OldStart || r.NewStart) && (r.OldEnd || r.NewEnd)));

  if (!work.length) {
    console.log("OK   every reported activity has its dates");
    await closeDB?.();
    process.exit(0);
  }
  for (const r of work.slice(0, 40)) {
    const start = r.OldStart || r.NewStart;
    const end = r.OldEnd || r.NewEnd;
    console.log(`FILL assignment #${r.Id} (${r.Status}, ${r.ProgressPercent}%): start ${fmt(start)}${r.OldStart ? "" : " (new)"}, end ${fmt(end)}${r.OldEnd ? "" : r.NewEnd ? " (new)" : ""}`);
  }
  if (work.length > 40) console.log(`... and ${work.length - 40} more`);
  console.log(`${work.length} activit${work.length === 1 ? "y" : "ies"}`);
  if (!apply) {
    console.log("Dry run - nothing changed. Run again with --apply to fill them in.");
    await closeDB?.();
    process.exit(0);
  }

  const result = await pool.request().query(`
    UPDATE a SET
      StartDate = COALESCE(a.StartDate, p.NewStart),
      EndDate   = COALESCE(a.EndDate, p.NewEnd)
    FROM dbo.DependencyActivityAssignment a
    JOIN (${PLAN}) p ON p.Id = a.Id
    WHERE (a.StartDate IS NULL AND p.NewStart IS NOT NULL) OR (a.EndDate IS NULL AND p.NewEnd IS NOT NULL);

    UPDATE dbo.DependencyActivityAssignment
      SET Days = DATEDIFF(DAY, StartDate, EndDate) + 1
      WHERE IsCurrent = 1 AND ProgressPercent > 0 AND Days IS NULL
        AND StartDate IS NOT NULL AND EndDate IS NOT NULL AND EndDate >= StartDate;`);
  console.log(`Done - dates filled on ${result.rowsAffected[0]} activit${result.rowsAffected[0] === 1 ? "y" : "ies"}, days on ${result.rowsAffected[1]}.`);
  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
