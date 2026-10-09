// A villa type owns its rooms, floor by floor (migration 539).
//
// A villa is the reverse of a tower: the unit contains its floors. Each villa
// design lists the rooms on each of its floors (G, 1, 2 ...) in
// dbo.VillaTypeRoomPlan. From that plan this module keeps one room layout per
// villa type (RoomLayoutType.OwnerVillaTypeId) with the rooms summed per
// category — so room generation, sync, overrides, undo and DPR all run on the
// existing engine unchanged. After a villa's rooms exist, each is stamped with
// the floor it sits on (RoomMaster.Storey): Bedroom 1 on G, Bedrooms 2-3 on 1,
// and so on, in the plan's bottom-to-top order.
const { sql } = require("../db");

// "G" first, then numbered floors, then anything else (e.g. "Roof") last.
// Floors inside a villa, bottom to top: Basement (B), Ground (G), 1, 2 …, then
// named floors such as Roof / Terrace above the numbered ones.
function storeyOrder(storey) {
  const s = String(storey || "").trim().toUpperCase();
  if (s === "B") return -1;
  if (s === "G") return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && String(n) === s ? n : 1000;
}

function normaliseStorey(storey) {
  const s = String(storey || "").trim();
  const u = s.toUpperCase();
  return u === "G" || u === "B" ? u : s;
}

class VillaPlanError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** The plan of one villa type, bottom floor first. */
async function getPlan(db, villaTypeId) {
  const r = await db.request().input("v", sql.Int, villaTypeId).query(`
    SELECT p.Storey AS storey, p.StoreyOrder AS storeyOrder, p.RoomCategoryId AS categoryId,
           c.Alias AS alias, c.CategoryName AS categoryName, p.Quantity AS quantity
    FROM dbo.VillaTypeRoomPlan p
    JOIN dbo.RoomCategoryMaster c ON c.Id = p.RoomCategoryId
    WHERE p.VillaTypeId = @v
    ORDER BY p.StoreyOrder, c.SortOrder, c.Alias`);
  return r.recordset;
}

/**
 * Replaces a villa type's plan and keeps its own room layout in step.
 * `rooms`: [{ storey, categoryId, quantity }]. Runs inside the caller's
 * transaction. Returns { layoutTypeId, roomCount }.
 */
async function savePlan(tx, villaTypeId, rooms, actor = null) {
  const vt = (await tx.request().input("v", sql.Int, villaTypeId).query(`
    SELECT v.Id, v.Name, v.ProjectId, LTRIM(RTRIM(e.short_name)) AS Short
    FROM dbo.VillaTypeMaster v LEFT JOIN dbo.enterprise e ON e.id = v.ProjectId
    WHERE v.Id = @v AND v.IsActive = 1`)).recordset[0];
  if (!vt) throw new VillaPlanError("Villa type not found", 404);

  // Merge duplicates (same floor + category) and validate.
  const merged = new Map();
  for (const r of rooms || []) {
    const storey = normaliseStorey(r.storey);
    const categoryId = parseInt(r.categoryId, 10);
    const quantity = parseInt(r.quantity, 10);
    if (!storey || storey.length > 10) throw new VillaPlanError("Each room needs a floor (G, 1, 2 …), at most 10 characters");
    if (!Number.isInteger(categoryId)) throw new VillaPlanError("Each room needs a room type");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new VillaPlanError("Quantity must be 1–20");
    const k = `${storey}|${categoryId}`;
    merged.set(k, { storey, categoryId, quantity: (merged.get(k)?.quantity || 0) + quantity });
  }
  const lines = [...merged.values()];
  if (!lines.length) throw new VillaPlanError("Add at least one room");
  const cats = [...new Set(lines.map((l) => l.categoryId))];
  const known = (await tx.request().query(
    `SELECT Id FROM dbo.RoomCategoryMaster WHERE IsActive = 1 AND Id IN (${cats.join(",")})`)).recordset.map((x) => x.Id);
  const missing = cats.filter((c) => !known.includes(c));
  if (missing.length) throw new VillaPlanError("One or more room types are inactive or missing");

  // The plan itself.
  await tx.request().input("v", sql.Int, villaTypeId).query("DELETE FROM dbo.VillaTypeRoomPlan WHERE VillaTypeId = @v");
  for (const l of lines) {
    await tx.request().input("v", sql.Int, villaTypeId).input("s", sql.NVarChar(10), l.storey)
      .input("o", sql.Int, storeyOrder(l.storey)).input("c", sql.Int, l.categoryId).input("q", sql.Int, l.quantity)
      .query("INSERT INTO dbo.VillaTypeRoomPlan (VillaTypeId, Storey, StoreyOrder, RoomCategoryId, Quantity) VALUES (@v, @s, @o, @c, @q)");
  }

  // The villa type's own layout: the plan summed per room category.
  const typeKey = `VT${villaTypeId}`;
  const label = `${vt.Short ? vt.Short + " · " : ""}${vt.Name}`.slice(0, 50);
  let layoutId = (await tx.request().input("v", sql.Int, villaTypeId)
    .query("SELECT TOP 1 Id FROM dbo.RoomLayoutType WHERE OwnerVillaTypeId = @v")).recordset[0]?.Id;
  if (!layoutId) {
    layoutId = (await tx.request().input("k", sql.NVarChar(45), typeKey).input("l", sql.NVarChar(50), label)
      .input("v", sql.Int, villaTypeId).input("by", sql.NVarChar(200), actor)
      .query(`INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder, IsActive, CreatedBy, OwnerVillaTypeId)
              OUTPUT INSERTED.Id VALUES (@k, @l, 0, 900, 1, @by, @v)`)).recordset[0].Id;
  } else {
    await tx.request().input("id", sql.Int, layoutId).input("l", sql.NVarChar(50), label)
      .query("UPDATE dbo.RoomLayoutType SET Label = @l, IsActive = 1 WHERE Id = @id");
  }
  let cfgId = (await tx.request().input("lt", sql.Int, layoutId)
    .query("SELECT TOP 1 Id FROM dbo.UnitRoomConfig WHERE LayoutTypeId = @lt AND IsActive = 1")).recordset[0]?.Id;
  if (!cfgId) {
    cfgId = (await tx.request().input("k", sql.NVarChar(45), typeKey).input("lt", sql.Int, layoutId).input("by", sql.NVarChar(200), actor)
      .query("INSERT INTO dbo.UnitRoomConfig (BhkType, LayoutTypeId, IsActive, CreatedBy) OUTPUT INSERTED.Id VALUES (@k, @lt, 1, @by)")).recordset[0].Id;
  }
  const totals = new Map();
  for (const l of lines) totals.set(l.categoryId, (totals.get(l.categoryId) || 0) + l.quantity);
  // Categories dropped from the plan go to 0 (the engine reads Quantity > 0).
  await tx.request().input("c", sql.Int, cfgId).query("UPDATE dbo.RoomComposition SET Quantity = 0, UpdatedAt = SYSDATETIME() WHERE UnitRoomConfigId = @c");
  for (const [categoryId, quantity] of totals) {
    await tx.request().input("c", sql.Int, cfgId).input("cat", sql.Int, categoryId).input("q", sql.Int, quantity).query(`
      MERGE dbo.RoomComposition AS t
      USING (SELECT @c AS UnitRoomConfigId, @cat AS RoomCategoryId) AS s
      ON t.UnitRoomConfigId = s.UnitRoomConfigId AND t.RoomCategoryId = s.RoomCategoryId
      WHEN MATCHED THEN UPDATE SET Quantity = @q, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (UnitRoomConfigId, RoomCategoryId, Quantity) VALUES (@c, @cat, @q);`);
  }
  await tx.request().input("v", sql.Int, villaTypeId).input("lt", sql.Int, layoutId)
    .query("UPDATE dbo.VillaTypeMaster SET LayoutTypeId = @lt, UpdatedAt = SYSDATETIME() WHERE Id = @v");
  return { layoutTypeId: layoutId, label, roomCount: [...totals.values()].reduce((a, b) => a + b, 0) };
}

// Trailing number of a generated room name ("Bedroom 3" -> 3; "Kitchen" -> 0).
const roomNo = (name) => { const m = /(\d+)\s*$/.exec(String(name || "")); return m ? parseInt(m[1], 10) : 0; };

/**
 * Stamps each room of a villa with the floor it sits on, from its villa
 * type's plan. Rooms of a category are filled bottom floor first in name
 * order; rooms beyond the plan keep no floor. No-op for units without a
 * planned villa type. Returns the number of rooms changed.
 */
async function applyStoreys(db, unitId) {
  const unit = (await db.request().input("u", sql.Int, unitId)
    .query("SELECT VillaTypeId FROM dbo.UnitMaster WHERE Id = @u AND IsActive = 1")).recordset[0];
  if (!unit?.VillaTypeId) return 0;
  const plan = await getPlan(db, unit.VillaTypeId);
  if (!plan.length) return 0;
  const rooms = (await db.request().input("u", sql.Int, unitId).query(
    "SELECT Id, RoomName, RoomCategoryId, Storey FROM dbo.RoomMaster WHERE UnitId = @u AND IsActive = 1 AND RoomCategoryId IS NOT NULL")).recordset;
  let changed = 0;
  for (const cat of new Set(rooms.map((r) => r.RoomCategoryId))) {
    const slots = plan.filter((p) => p.categoryId === cat).flatMap((p) => Array(p.quantity).fill(p.storey));
    const mine = rooms.filter((r) => r.RoomCategoryId === cat).sort((a, b) => roomNo(a.RoomName) - roomNo(b.RoomName) || a.Id - b.Id);
    for (let i = 0; i < mine.length; i++) {
      const want = slots[i] ?? null;
      if ((mine[i].Storey ?? null) !== want) {
        await db.request().input("id", sql.Int, mine[i].Id).input("s", sql.NVarChar(10), want)
          .query("UPDATE dbo.RoomMaster SET Storey = @s, UpdatedAt = SYSDATETIME() WHERE Id = @id");
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Brings a built villa up to its type's floor plan by ADDING the rooms the
 * plan has and the villa lacks — never removing, renaming or touching a room
 * that exists (so its DPR steps and work stay exactly as they are). New rooms
 * get their floor and, where a step list exists, their DPR chains. Runs in the
 * caller's transaction and throws VillaPlanError (the caller rolls back) if
 * the sync would change any existing room. Returns { added, chains, withoutSteps }.
 */
async function addMissingPlanRooms(tx, unitId, actorUserId = null) {
  const u = (await tx.request().input("u", sql.Int, unitId).query(`
    SELECT u.UnitName, u.LayoutTypeId, v.Id AS TypeId, v.LayoutTypeId AS TypeLayout
    FROM dbo.UnitMaster u LEFT JOIN dbo.VillaTypeMaster v ON v.Id = u.VillaTypeId AND v.IsActive = 1
    WHERE u.Id = @u AND u.IsActive = 1
      AND EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id AND p.IsActive = 1)`)).recordset[0];
  if (!u) throw new VillaPlanError("That is not an active villa built on a plot", 404);
  if (!u.TypeId) throw new VillaPlanError(`${u.UnitName} has no villa type — set its type first`);
  if (!u.TypeLayout) throw new VillaPlanError("Its villa type has no floor plan yet");
  if (u.LayoutTypeId !== u.TypeLayout) {
    await tx.request().input("u", sql.Int, unitId).input("l", sql.Int, u.TypeLayout)
      .query("UPDATE dbo.UnitMaster SET LayoutTypeId = @l, UpdatedAt = SYSDATETIME() WHERE Id = @u");
  }
  const { syncUnitRooms } = require("./unitLayout");
  const r = await syncUnitRooms(tx, unitId, { removeUnused: false, createdBy: actorUserId });
  if (r.deactivated || r.renamed) {
    throw new VillaPlanError(`${u.UnitName}: bringing it to the plan would change ${r.renamed ? `${r.renamed} room name(s)` : ""}${r.renamed && r.deactivated ? " and " : ""}${r.deactivated ? `${r.deactivated} room(s)` : ""} that already exist — nothing was changed`, 409);
  }
  return { added: (r.created || 0) + (r.reactivated || 0), chains: r.dprChainsCreated || 0, withoutSteps: r.dprRoomsWithoutTemplate || [] };
}

module.exports = { getPlan, savePlan, applyStoreys, addMissingPlanRooms, storeyOrder, VillaPlanError };
