// Gives a new unit's rooms their DPR work chains at the moment the unit is
// created (e.g. a plot converted into a villa), so DPR follows conversion with
// no script run. Each room copies the step list of the most recent chain of
// its room category (this project's own first), every step a PENDING stub.
// Floor comes from chainFloorLabel, so a villa is placed by its plot.
// A room whose category has no chain anywhere yet is skipped and reported.
const { sql } = require("../db");
const { chainFloorLabel } = require("./unitLayout");
// Template chain per room category: this project's own most recent chain for
// it (so once a pilot villa's steps are tailored, every later villa copies
// them), else the most recent one anywhere. One indexed TOP 1 per category on
// the caller's own connection — it used to group every chain's full step list
// across the database (~430k rows on production) on a second connection,
// which ran past the 60 s request limit inside the conversion transaction and
// held Plot Master locked while it did.
async function donorsFor(db, projectId, cats) {
  const pick = new Map();
  for (const cat of cats) {
    const row = (await db.request().input("cat", sql.Int, cat).input("p", sql.Int, projectId).query(`
      SELECT TOP 1 d.Id, d.WorkType, d.ProjectId, d.Alias, r.RoomName, u.UnitName
      FROM dbo.DependencyMaster d
      JOIN dbo.RoomMaster r ON r.Id = d.RoomId
      LEFT JOIN dbo.UnitMaster u ON u.Id = d.FlatId
      WHERE d.IsActive = 1 AND r.RoomCategoryId = @cat
        AND EXISTS (SELECT 1 FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d.Id)
      ORDER BY CASE WHEN d.ProjectId = @p THEN 0 ELSE 1 END, d.Id DESC`)).recordset[0];
    if (row) pick.set(cat, row);
  }
  return pick;
}

// Chain names are free text, so a new chain is named the way its donor is:
// the separator and letter case are read off the donor's own name (e.g.
// "SLV>A>V-100>BALCONY 1" or "SLV/A/P-21/Bedroom 1"), so a project's
// chains read alike whoever made them. Falls back to "UNIT/Room".
const CASES = { asIs: (x) => x, upper: (x) => x.toUpperCase(), lower: (x) => x.toLowerCase() };
const buildAlias = (f, unitName, roomName) =>
  String(unitName).split("/").map(CASES[f.unitCase]).join(f.sep) + f.sep + CASES[f.roomCase](String(roomName));
function aliasFormatOf(donor) {
  if (!donor?.Alias || !donor.UnitName || !donor.RoomName) return null;
  const first = String(donor.UnitName).split("/")[0];
  if (String(donor.Alias).toUpperCase().indexOf(first.toUpperCase()) !== 0) return null;
  const sep = String(donor.Alias).charAt(first.length);
  if (!sep) return null;
  for (const unitCase of Object.keys(CASES)) for (const roomCase of Object.keys(CASES)) {
    const f = { sep, unitCase, roomCase };
    if (buildAlias(f, donor.UnitName, donor.RoomName) === donor.Alias) return f;
  }
  return null;
}
function chainAlias(donor, unitName, roomName) {
  const f = aliasFormatOf(donor) || { sep: "/", unitCase: "asIs", roomCase: "asIs" };
  return buildAlias(f, unitName, roomName).slice(0, 200);
}

/** Kept for callers; templates are no longer cached (each lookup is a seek). */
function clearTemplateCache() {}


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
  const pick = await donorsFor(db, unit.ProjectId, cats);

  let created = 0;
  const skipped = [];
  for (const room of rooms) {
    const donor = pick.get(room.RoomCategoryId);
    if (!donor) { skipped.push(room.RoomName); continue; }
    const ins = await db.request()
      .input("P", sql.Int, unit.ProjectId).input("T", sql.Int, unit.BlockId).input("Fl", sql.NVarChar(50), floor)
      .input("F", sql.Int, unit.UnitId).input("R", sql.Int, room.Id)
      .input("A", sql.NVarChar(200), chainAlias(donor, unit.UnitName, room.RoomName))
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

/**
 * Villa rooms built before their room type had a step list get one as soon as
 * it exists: every villa (on a plot) with a chainless room of that type — or,
 * with no type given, of any type — gets its chains from the newest step
 * list. Each villa in its own transaction; rooms with a chain are never
 * touched. Returns { villas, chainsCreated, stillWithoutSteps, failed }.
 */
async function fillChainlessVillaRooms(pool, { projectId = null, categoryId = null, actor = null } = {}) {
  const villas = (await pool.request().input("p", sql.Int, projectId).input("c", sql.Int, categoryId).query(`
    SELECT DISTINCT u.Id, u.UnitName FROM dbo.UnitMaster u
    JOIN dbo.PlotMaster p ON p.ConvertedUnitId = u.Id AND p.IsActive = 1
    WHERE u.IsActive = 1 AND (@p IS NULL OR u.ProjectId = @p)
      AND EXISTS (SELECT 1 FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL
                    AND (@c IS NULL OR r.RoomCategoryId = @c)
                    AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id))`)).recordset;
  let chainsCreated = 0; const still = new Set(); const failed = [];
  for (const v of villas) {
    const tx = pool.transaction();
    await tx.begin();
    try {
      const r = await createChainsForUnit(tx, v.Id, actor);
      await tx.commit();
      chainsCreated += r.created;
      r.skipped.forEach((n) => still.add(String(n).replace(/\s+\d+$/, "")));
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* rolled back */ }
      failed.push(`${v.UnitName}: ${e.message}`);
    }
  }
  return { villas: villas.length, chainsCreated, stillWithoutSteps: [...still], failed };
}

module.exports = { createChainsForUnit, fillChainlessVillaRooms, clearTemplateCache, chainAlias, aliasFormatOf, buildAlias };
