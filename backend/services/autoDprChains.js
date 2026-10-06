// Gives a new unit's rooms their DPR work chains at the moment the unit is
// created (e.g. a plot converted into a villa), so DPR follows conversion with
// no script run. Same rule as scripts/cloneChainForChainlessRooms.js: each
// room copies the step list most chains of its room category already use
// (this project's own when it has any), every step starting as a PENDING stub.
// Floor comes from chainFloorLabel, so a villa is placed by its plot.
// A room whose category has no chain anywhere yet is skipped and reported.
const { sql } = require("../db");
const { chainFloorLabel } = require("./unitLayout");

async function createChainsForUnit(db, unitId, actor) {
  const unit = (await db.request().input("u", sql.Int, unitId).query(
    "SELECT Id AS UnitId, UnitName, ProjectId, BlockId, FloorNo FROM dbo.UnitMaster WHERE Id = @u AND IsActive = 1")).recordset[0];
  if (!unit) return { created: 0, skipped: [] };
  const rooms = (await db.request().input("u", sql.Int, unitId).query(`
    SELECT r.Id, r.RoomName, r.RoomCategoryId FROM dbo.RoomMaster r
    WHERE r.UnitId = @u AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id)`)).recordset;
  if (!rooms.length) return { created: 0, skipped: [] };
  const floor = await chainFloorLabel(db, unit);

  // Donor per category: the most common step list among existing chains.
  const cats = [...new Set(rooms.map((r) => r.RoomCategoryId))];
  const donors = (await db.request().input("p", sql.Int, unit.ProjectId).query(`
    SELECT d.Id, d.WorkType, r.RoomCategoryId, d.ProjectId,
           STRING_AGG(CAST(a.ActivityId AS NVARCHAR(20)) + ':' + ISNULL(a.WorkType, ''), ',') WITHIN GROUP (ORDER BY a.SequenceNo) AS Sig
    FROM dbo.DependencyMaster d
    JOIN dbo.RoomMaster r ON r.Id = d.RoomId
    JOIN dbo.DependencyMasterActivity a ON a.DependencyMasterId = d.Id
    WHERE d.IsActive = 1 AND r.RoomCategoryId IN (${cats.map(Number).join(",")})
    GROUP BY d.Id, d.WorkType, r.RoomCategoryId, d.ProjectId`)).recordset;
  const pick = new Map();
  for (const cat of cats) {
    // The project's own chains win when it has any for this category: once a
    // villa's steps are tailored, every later villa copies the tailored list.
    const all = donors.filter((d) => d.RoomCategoryId === cat);
    const own = all.filter((d) => d.ProjectId === unit.ProjectId);
    const cs = own.length ? own : all;
    if (!cs.length) continue;
    const freq = new Map();
    for (const c of cs) freq.set(`${c.WorkType}|${c.Sig}`, (freq.get(`${c.WorkType}|${c.Sig}`) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const same = cs.filter((c) => `${c.WorkType}|${c.Sig}` === top);
    pick.set(cat, same.find((c) => c.ProjectId === unit.ProjectId) || same[0]);
  }

  let created = 0;
  const skipped = [];
  for (const room of rooms) {
    const donor = pick.get(room.RoomCategoryId);
    if (!donor) { skipped.push(room.RoomName); continue; }
    const ins = await db.request()
      .input("P", sql.Int, unit.ProjectId).input("T", sql.Int, unit.BlockId).input("Fl", sql.NVarChar(50), floor)
      .input("F", sql.Int, unit.UnitId).input("R", sql.Int, room.Id)
      .input("A", sql.NVarChar(200), `${unit.UnitName}/${room.RoomName}`)
      .input("W", sql.NVarChar(20), donor.WorkType).input("By", sql.NVarChar(300), actor || null)
      .query(`INSERT INTO dbo.DependencyMaster (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id AS id VALUES (@P, @T, @Fl, @F, @R, @A, @W, @By, SYSDATETIME())`);
    const newId = ins.recordset[0].id;
    await db.request().input("D", sql.Int, donor.Id).input("N", sql.Int, newId).query(`
      INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
      SELECT @N, x.ActivityId, x.SequenceNo, x.WorkType FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = @D ORDER BY x.SequenceNo`);
    await db.request().input("N", sql.Int, newId).input("by", sql.NVarChar(200), actor || null).query(`
      INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
      SELECT x.Id, @by FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = @N`);
    created++;
  }
  return { created, skipped };
}

module.exports = { createChainsForUnit };
