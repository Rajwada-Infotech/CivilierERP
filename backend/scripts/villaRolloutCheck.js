// READ-ONLY. Where the plotted-villa rollout stands on this database — run it
// before and after each rollout step. Nothing is written.
//   node scripts/villaRolloutCheck.js
const { connectDB, getPool, closeDB } = require("../db");

(async () => {
  await connectDB();
  const q = async (s) => (await getPool().request().query(s)).recordset;
  const has = async (table, col) => (await q(`SELECT COL_LENGTH('dbo.${table}', '${col}') AS c`))[0].c != null;
  const line = (s = "") => console.log(s);

  line("== 1. Schema");
  const planTable = (await q("SELECT OBJECT_ID('dbo.VillaTypeRoomPlan') AS o"))[0].o != null;
  const storeyCol = await has("RoomMaster", "Storey");
  line(`  villa floor plans table (migration 539): ${planTable ? "yes" : "MISSING — deploy backend first"}`);
  line(`  RoomMaster.Storey:                       ${storeyCol ? "yes" : "MISSING — deploy backend first"}`);
  if (!planTable || !storeyCol) { await closeDB(); return; }

  line("\n== 2. Villa types per project (active)");
  for (const r of await q(`
    SELECT e.name AS Project, v.Code, v.Name,
           (SELECT ISNULL(SUM(rp.Quantity), 0) FROM dbo.VillaTypeRoomPlan rp WHERE rp.VillaTypeId = v.Id) AS PlanRooms,
           (SELECT COUNT(DISTINCT rp.Storey) FROM dbo.VillaTypeRoomPlan rp WHERE rp.VillaTypeId = v.Id) AS Floors,
           (SELECT COUNT(*) FROM dbo.UnitMaster u WHERE u.VillaTypeId = v.Id AND u.IsActive = 1) AS Villas
    FROM dbo.VillaTypeMaster v JOIN dbo.enterprise e ON e.id = v.ProjectId
    WHERE v.IsActive = 1 ORDER BY e.name, v.SortOrder, v.Code`)) {
    line(`  ${r.Project.padEnd(22)} ${String(r.Code).padEnd(6)} ${String(r.Name).padEnd(18)} plan: ${r.PlanRooms ? `${r.PlanRooms} rooms on ${r.Floors} floor(s)` : "NONE"}   villas: ${r.Villas}`);
  }

  line("\n== 3. Villas built on plots");
  const villas = await q(`
    SELECT e.name AS Project, u.Id, u.UnitName, vt.Code AS TypeCode,
           (SELECT COUNT(*) FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1) AS Rooms,
           (SELECT COUNT(*) FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1 AND r.Storey IS NULL) AS RoomsNoFloor,
           (SELECT COUNT(*) FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id AND d.IsActive = 1)) AS RoomsNoDpr,
           (SELECT TOP 1 b.BookingNo FROM dbo.CrmBooking b WHERE b.UnitId = u.Id AND b.IsActive = 1
              AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')) AS BookingNo,
           (SELECT COUNT(*) FROM dbo.DependencyActivityAssignment a JOIN dbo.DependencyMasterActivity x ON x.Id = a.DependencyMasterActivityId
              JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId
             WHERE d.FlatId = u.Id AND (ISNULL(a.Status, N'PENDING') NOT IN (N'PENDING', N'CANCELLED') OR a.EngineerId IS NOT NULL OR a.StartDate IS NOT NULL)) AS StepsStarted
    FROM dbo.UnitMaster u JOIN dbo.enterprise e ON e.id = u.ProjectId LEFT JOIN dbo.VillaTypeMaster vt ON vt.Id = u.VillaTypeId
    WHERE u.IsActive = 1 AND EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id AND p.IsActive = 1)
    ORDER BY e.name, u.UnitName`);
  if (!villas.length) line("  none");
  for (const v of villas) {
    const notes = [];
    if (!v.TypeCode) notes.push("NO VILLA TYPE — Plot Master > plot > Set type");
    if (v.RoomsNoFloor) notes.push(`${v.RoomsNoFloor} room(s) with no floor`);
    if (v.RoomsNoDpr) notes.push(`${v.RoomsNoDpr} room(s) without DPR steps`);
    if (v.StepsStarted) notes.push(`DPR work started (${v.StepsStarted} step(s)) — type can't be changed`);
    if (v.BookingNo) notes.push(`booked ${v.BookingNo} — areas locked`);
    line(`  ${v.Project.padEnd(22)} ${String(v.UnitName).padEnd(22)} type: ${(v.TypeCode || "—").padEnd(5)} rooms: ${String(v.Rooms).padEnd(3)} ${notes.join("; ") || "ok"}`);
  }

  line("\n== 4. Room types that villas need but no DPR step list exists for");
  const noSteps = await q(`
    SELECT c.Alias, COUNT(*) AS Rooms
    FROM dbo.RoomMaster r JOIN dbo.RoomCategoryMaster c ON c.Id = r.RoomCategoryId
    JOIN dbo.PlotMaster p ON p.ConvertedUnitId = r.UnitId AND p.IsActive = 1
    WHERE r.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id AND d.IsActive = 1)
      AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d2 JOIN dbo.RoomMaster r2 ON r2.Id = d2.RoomId
                       WHERE d2.IsActive = 1 AND r2.RoomCategoryId = r.RoomCategoryId
                         AND EXISTS (SELECT 1 FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d2.Id))
    GROUP BY c.Alias ORDER BY c.Alias`);
  if (!noSteps.length) line("  none — every villa room type has a step list to copy");
  for (const r of noSteps) line(`  ${r.Alias.padEnd(24)} ${r.Rooms} villa room(s) — set one chain for it in Dependency Master`);

  line("\n== 5. Units / plots still held by a dead application (stuck sales)");
  const dead = `(a.IsActive = 0 OR a.Status IN (N'Rejected', N'Cancelled', N'Expired')
    OR (a.Status = N'Converted' AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = a.Id AND b.IsActive = 1
          AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred'))))`;
  const su = (await q(`SELECT COUNT(*) n FROM dbo.CrmApplicationUnit l JOIN dbo.CrmApplication a ON a.Id = l.ApplicationId WHERE l.Status = N'Active' AND ${dead}`))[0].n;
  const sp = (await q(`SELECT COUNT(*) n FROM dbo.CrmApplicationPlot l JOIN dbo.CrmApplication a ON a.Id = l.ApplicationId WHERE l.Status = N'Active' AND ${dead}`))[0].n;
  line(`  unit lines: ${su}   plot lines: ${sp}${su + sp ? "   -> run scripts/releaseDeadApplicationLines.js" : ""}`);

  line("\n== 6. Refunds");
  for (const r of await q("SELECT Status, COUNT(*) n FROM dbo.CrmRefund WHERE Status IN (N'Pending', N'FinancePending', N'FinanceApproved') GROUP BY Status")) {
    const hint = r.Status === "FinancePending" ? "voucher not raised — Refunds page > Send to Finance"
      : r.Status === "FinanceApproved" ? "with Finance — approve the voucher in Payments" : "awaiting CRM approval in the Approval Inbox";
    line(`  ${r.Status.padEnd(16)} ${r.n}   ${hint}`);
  }
  line("\nRead-only — nothing was changed.");
  await closeDB();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
