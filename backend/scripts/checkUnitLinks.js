// READ-ONLY. For each unit of the given projects, shows exactly what it is
// linked to — bookings (with the unit no/type/areas each booking copied),
// applications, rooms (and how many have DPR work), dependency chains — so a
// correction to a unit's name/type/area is never made blind.
//
// Usage: node scripts/checkUnitLinks.js --projects 2033,1019,1014
//        add --all to also list units whose only link is their own rooms

const { connectDB, getPool, closeDB } = require("../db");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const IDS = String(arg("--projects") || "").split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite);
const ALL = process.argv.includes("--all");

async function main() {
  if (!IDS.length) throw new Error("pass --projects id,id,...");
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;
  const tbl = async (t) => (await q(`SELECT OBJECT_ID('dbo.${t}') AS id`))[0].id != null;
  const ids = IDS.join(",");

  const units = await q(`SELECT u.Id, u.UnitName, u.UnitType, e.name AS Project FROM dbo.UnitMaster u JOIN dbo.enterprise e ON e.id = u.ProjectId WHERE u.ProjectId IN (${ids})`);
  const bookings = await q(`
    SELECT b.UnitId, b.BookingNo, b.Status, b.WorkflowStage, b.IsActive, b.UnitNo, b.UnitType,
           b.AreaSqFt, b.SuperBuiltUpAreaSqFt, b.CarpetAreaSqFt, b.BuiltUpAreaSqFt
    FROM dbo.CrmBooking b JOIN dbo.UnitMaster u ON u.Id = b.UnitId WHERE u.ProjectId IN (${ids})`);
  const bookingUnits = (await tbl("CrmBookingUnit")) ? await q(`
    SELECT bu.UnitId, b.BookingNo, b.Status FROM dbo.CrmBookingUnit bu JOIN dbo.CrmBooking b ON b.Id = bu.BookingId
    JOIN dbo.UnitMaster u ON u.Id = bu.UnitId WHERE u.ProjectId IN (${ids})`) : [];
  const apps = await q(`
    SELECT x.UnitId, a.ApplicationNo, a.Status FROM (
      SELECT PreferredUnitId AS UnitId, Id AS AppId FROM dbo.CrmApplication WHERE PreferredUnitId IS NOT NULL
      ${(await tbl("CrmApplicationUnit")) ? "UNION SELECT UnitId, ApplicationId FROM dbo.CrmApplicationUnit" : ""}
    ) x JOIN dbo.CrmApplication a ON a.Id = x.AppId JOIN dbo.UnitMaster u ON u.Id = x.UnitId WHERE u.ProjectId IN (${ids})`);
  const rooms = await q(`
    SELECT UnitId, COUNT(*) AS Total, SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active, SUM(HasWork) AS WithWork
    FROM (
      SELECT r.UnitId, r.IsActive,
        CASE WHEN r.BlueprintFileData IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id)
             OR EXISTS (SELECT 1 FROM dbo.DailyLabourEntry l WHERE l.RoomId = r.Id) THEN 1 ELSE 0 END AS HasWork
      FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId WHERE u.ProjectId IN (${ids})
    ) x GROUP BY UnitId`);
  const chains = await q(`SELECT d.FlatId AS UnitId, COUNT(*) AS n FROM dbo.DependencyMaster d JOIN dbo.UnitMaster u ON u.Id = d.FlatId WHERE u.ProjectId IN (${ids}) GROUP BY d.FlatId`);

  const by = (arr) => { const m = new Map(); for (const r of arr) (m.get(r.UnitId) || m.set(r.UnitId, []).get(r.UnitId)).push(r); return m; };
  const B = by(bookings), BU = by(bookingUnits), A = by(apps), R = by(rooms), C = by(chains);
  const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const f = (v) => (v == null ? "-" : Number(v) === Math.round(Number(v)) ? Math.round(Number(v)) : v);

  let shown = 0;
  const summary = { units: units.length, booked: 0, applied: 0, chains: 0, roomsWithWork: 0 };
  for (const u of units.sort((a, b) => cmp(a.Project + a.UnitName, b.Project + b.UnitName))) {
    const b = B.get(u.Id) || [], bu = BU.get(u.Id) || [], a = A.get(u.Id) || [], r = (R.get(u.Id) || [])[0], c = (C.get(u.Id) || [])[0];
    if (b.length || bu.length) summary.booked++;
    if (a.length) summary.applied++;
    if (c) summary.chains++;
    if (r && r.WithWork) summary.roomsWithWork++;
    const interesting = b.length || bu.length || a.length || c || (r && r.WithWork);
    if (!interesting && !ALL) continue;
    shown++;
    const parts = [];
    for (const x of b) parts.push(`BOOKING ${x.BookingNo} [${x.Status}/${x.WorkflowStage || "-"}${x.IsActive ? "" : "/inactive"}] copy: no=${x.UnitNo || "-"} type=${x.UnitType || "-"} area=${f(x.AreaSqFt)} sbu=${f(x.SuperBuiltUpAreaSqFt)} carpet=${f(x.CarpetAreaSqFt)} builtup=${f(x.BuiltUpAreaSqFt)}`);
    for (const x of bu) if (!b.some((y) => y.BookingNo === x.BookingNo)) parts.push(`BOOKING-UNIT ${x.BookingNo} [${x.Status}]`);
    for (const x of a) parts.push(`APPLICATION ${x.ApplicationNo} [${x.Status}]`);
    if (c) parts.push(`${c.n} DPR chain(s)`);
    if (r) parts.push(`rooms ${r.Active} active/${r.Total}${r.WithWork ? `, ${r.WithWork} with work` : ""}`);
    console.log(`${u.Project.trim()} | #${u.Id} ${u.UnitName} [${u.UnitType || "-"}]  ->  ${parts.join("  |  ")}`);
  }
  console.log(`\n${JSON.stringify(summary)}  (${shown} unit(s) listed${ALL ? "" : "; units linked only to their own rooms omitted — use --all"}). READ-ONLY.`);
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("checkUnitLinks failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
