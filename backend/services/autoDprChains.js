// Gives a new unit's rooms their DPR work chains at the moment the unit is
// created (e.g. a plot converted into a villa), so DPR follows conversion with
// no script run. Same rule as scripts/cloneChainForChainlessRooms.js: each
// room copies the step list most chains of its room category already use
// (this project's own when it has any), every step starting as a PENDING stub.
// Floor comes from chainFloorLabel, so a villa is placed by its plot.
// A room whose category has no chain anywhere yet is skipped and reported.
const { sql } = require("../db");
const { chainFloorLabel } = require("./unitLayout");
const { getPool } = require("../db");
// Template chain per room category: the most common step list, from this
// project's own chains when it has any for that category, else from all.
// Read through the shared pool (not the caller's transaction, so it never
// sits inside a conversion's plot lock) and cached for a few minutes: the
// all-projects scan touches every chain and must not run once per villa.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // scope -> { at, map: Map(categoryId -> donor) }

async function templatesFor(scopeProjectId) {
  const key = scopeProjectId == null ? "all" : `p${scopeProjectId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const req = getPool().request();
  if (scopeProjectId != null) req.input("p", sql.Int, scopeProjectId);
  // READPAST: this runs on its own connection while the caller's transaction
  // (a plot conversion, a room re-sync) holds locks on the rooms it just
  // inserted. On a large table SQL Server scans RoomMaster rather than
  // seeking it, reaches those locked rows and waits on the very transaction
  // that is waiting for this query — the conversion then hangs until it times
  // out. Skipping locked rows is safe: they are brand-new rooms with no chain,
  // so they can never be a template.
  const rows = (await req.query(`
    SELECT d.Id, d.WorkType, r.RoomCategoryId,
           STRING_AGG(CAST(a.ActivityId AS NVARCHAR(20)) + ':' + ISNULL(a.WorkType, ''), ',') WITHIN GROUP (ORDER BY a.SequenceNo) AS Sig
    FROM dbo.DependencyMaster d WITH (READPAST)
    JOIN dbo.RoomMaster r WITH (READPAST) ON r.Id = d.RoomId
    JOIN dbo.DependencyMasterActivity a WITH (READPAST) ON a.DependencyMasterId = d.Id
    WHERE d.IsActive = 1 AND r.RoomCategoryId IS NOT NULL ${scopeProjectId != null ? "AND d.ProjectId = @p" : ""}
    GROUP BY d.Id, d.WorkType, r.RoomCategoryId`)).recordset;
  const byCat = new Map();
  for (const r of rows) (byCat.get(r.RoomCategoryId) || byCat.set(r.RoomCategoryId, []).get(r.RoomCategoryId)).push(r);
  const map = new Map();
  for (const [cat, cs] of byCat) {
    const freq = new Map();
    for (const c of cs) freq.set(`${c.WorkType}|${c.Sig}`, (freq.get(`${c.WorkType}|${c.Sig}`) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    map.set(cat, cs.find((c) => `${c.WorkType}|${c.Sig}` === top));
  }
  cache.set(key, { at: Date.now(), map });
  return map;
}

async function donorsFor(projectId, cats) {
  const own = await templatesFor(projectId);
  const pick = new Map();
  let all = null;
  for (const cat of cats) {
    if (own.has(cat)) { pick.set(cat, own.get(cat)); continue; }
    all = all || await templatesFor(null);
    if (all.has(cat)) pick.set(cat, all.get(cat));
  }
  return pick;
}

/** Drops cached templates, e.g. after a project's chains were tailored. */
function clearTemplateCache() { cache.clear(); }


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

  const cats = [...new Set(rooms.map((r) => r.RoomCategoryId))];
  const pick = await donorsFor(unit.ProjectId, cats);

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

module.exports = { createChainsForUnit, clearTemplateCache };
