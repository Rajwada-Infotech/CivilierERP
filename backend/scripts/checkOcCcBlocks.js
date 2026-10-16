// Read-only check after migration 577 (OC / CC by block, project from blocks).
// Compares, for every live booking, the OLD rule (own block's certificate, else
// any project-wide one) with the NEW one (vw_CrmBookingOcCc). Right after the
// deploy they must agree for every booking - differences would change who may
// proceed to possession and GST. Also lists each project's block coverage.
// Changes nothing.
//   node scripts/checkOcCcBlocks.js
const { connectDB, getPool, closeDB } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  const objs = await q(`SELECT OBJECT_ID('dbo.CrmOccupancyCertificateBlock','U') AS t, OBJECT_ID('dbo.vw_CrmBookingOcCc','V') AS v`);
  if (!objs[0].t || !objs[0].v) { console.log("FIX  migration 577 is not applied yet - run the migrations first"); await closeDB(); return; }

  const rows = await q(`
    SELECT b.Id, b.BookingNo, b.ProjectId,
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.CrmOccupancyCertificate oc
        LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
        WHERE oc.Status = 'Received' AND (
          (um.BlockId IS NOT NULL AND oc.BlockId = um.BlockId)
          OR (oc.ProjectId = b.ProjectId AND oc.BlockId IS NULL))
      ) THEN 1 ELSE 0 END AS OldRule,
      ISNULL(v.Received, 0) AS NewRule
    FROM dbo.CrmBooking b
    LEFT JOIN dbo.vw_CrmBookingOcCc v ON v.BookingId = b.Id
    WHERE b.IsActive = 1 AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred')`);
  const diff = rows.filter((r) => r.OldRule !== r.NewRule);
  console.log(`== Bookings: ${rows.length} live, cleared old ${rows.filter((r) => r.OldRule).length} / new ${rows.filter((r) => r.NewRule).length} ==`);
  if (!diff.length) console.log("OK   every booking is cleared exactly as before");
  for (const r of diff) console.log(`DIFF ${r.BookingNo} (project ${r.ProjectId}): before ${r.OldRule ? "cleared" : "waiting"}, now ${r.NewRule ? "cleared" : "waiting"}`);

  console.log("\n== Projects ==");
  const projs = await q(`
    SELECT pv.*, e.name AS ProjectName FROM dbo.vw_CrmProjectOcCc pv
    LEFT JOIN dbo.enterprise e ON e.id = pv.ProjectId
    WHERE pv.ActiveBlocks > 0 OR EXISTS (SELECT 1 FROM dbo.CrmOccupancyCertificate oc WHERE oc.ProjectId = pv.ProjectId)
    ORDER BY e.name`);
  for (const p of projs) {
    const state = p.Received ? "has OC/CC" : "not complete";
    console.log(`     ${String(p.ProjectName || p.ProjectId).padEnd(28)} ${state.padEnd(13)} ${p.Basis === "blocks" ? `${p.CoveredBlocks}/${p.ActiveBlocks} blocks` : "no blocks (project certificate)"}`);
  }
  await closeDB();
})().catch((e) => { console.error(e.message); process.exit(1); });
