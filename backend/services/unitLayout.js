// Single source of truth for the Unit -> Unit Composition layout -> Room
// Master chain:
//
//   RoomCategoryMaster (Bedroom, Kitchen, ...)            — Room Master
//     -> RoomLayoutType + UnitRoomConfig/RoomComposition   — Unit Composition
//       -> UnitMaster.LayoutTypeId (FK, migration 477)     — the flat
//         -> RoomMaster rows (Bedroom 1, Bedroom 2, ...)   — its real rooms
//
// Every writer that sets a unit's type (CRM auto-setup generate-units, Unit
// Master add/edit) and every reader that needs its layout (Room Master,
// Work Reporting) goes through here, so the normalization/matching rules
// can't drift between routes the way they had with each route carrying its
// own copy of normalizeTypeKey.
//
// All functions take `db` = a mssql ConnectionPool OR Transaction — both
// expose .request() — so callers can make a unit write and its room sync
// one atomic unit of work.
const { sql } = require("../db");
const { bumpCacheVersion } = require("../redis");

// Flat Master (routes/roomMaster.js) caches its room list, its Block >
// Floor tree (/structure) and its unit list (/units) under three separate
// namespaces. Anything that changes blocks, floors, units or rooms must
// refresh all three, or Flat Master keeps showing the pre-change tree for
// up to 5 minutes (e.g. right after CRM Auto Setup's Generate Units).
async function bumpFlatMasterCaches() {
  await Promise.all([
    bumpCacheVersion("room-master"),
    bumpCacheVersion("room-master-structure"),
    bumpCacheVersion("room-master-units"),
  ]);
}

// UnitMaster.UnitType is stored with a space ("3 BHK"), RoomLayoutType.
// TypeKey space-free ("3BHK") — same convention unitBhkConfig.js has always
// used for crossing that boundary.
function normalizeTypeKey(raw) {
  return String(raw || "").toUpperCase().replace(/\s+/g, "");
}

// A composition row set belongs to a layout type through the real FK
// (UnitRoomConfig.LayoutTypeId); the BhkType text match is only a fallback
// for a config row that predates migration 477's backfill.
const CONFIG_MATCHES_LAYOUT = `
  (cfg.LayoutTypeId = lt.Id OR (cfg.LayoutTypeId IS NULL AND cfg.BhkType = lt.TypeKey))
`;

const LAYOUT_SELECT = `
  SELECT lt.Id, lt.TypeKey, lt.Label,
    ISNULL((
      SELECT SUM(rc.Quantity)
      FROM dbo.UnitRoomConfig cfg
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
    ), 0) AS RoomCount
  FROM dbo.RoomLayoutType lt
`;

function toLayout(row) {
  return row ? { id: row.Id, typeKey: row.TypeKey, label: row.Label, roomCount: Number(row.RoomCount) || 0 } : null;
}

// Resolves a layout type by id (preferred) or by the free-text UnitType the
// older clients still send. Returns null when nothing active matches.
async function resolveLayoutType(db, { layoutTypeId, unitType } = {}) {
  const id = parseInt(layoutTypeId, 10);
  if (Number.isFinite(id) && id > 0) {
    const r = await db.request().input("id", sql.Int, id)
      .query(`${LAYOUT_SELECT} WHERE lt.Id = @id AND lt.IsActive = 1`);
    return toLayout(r.recordset[0]);
  }
  const key = normalizeTypeKey(unitType);
  if (!key) return null;
  const r = await db.request().input("key", sql.NVarChar(50), key)
    .query(`${LAYOUT_SELECT} WHERE lt.TypeKey = @key AND lt.IsActive = 1`);
  return toLayout(r.recordset[0]);
}

// Every active layout type with its room count + a short composition
// summary ("2 Bedroom · 1 Hall Room · 1 Kitchen"), for pickers.
async function listLayoutTypes(db) {
  const types = await db.request().query(`${LAYOUT_SELECT} WHERE lt.IsActive = 1 ORDER BY lt.SortOrder ASC, lt.Label ASC`);
  const comp = await db.request().query(`
    SELECT lt.Id AS LayoutTypeId, cat.Alias, rc.Quantity
    FROM dbo.RoomLayoutType lt
    JOIN dbo.UnitRoomConfig cfg ON ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1
    JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id AND rc.Quantity > 0
    JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId AND cat.IsActive = 1
    WHERE lt.IsActive = 1
    ORDER BY cat.SortOrder ASC, cat.Alias ASC
  `);
  const summaryById = new Map();
  for (const c of comp.recordset) {
    const parts = summaryById.get(c.LayoutTypeId) || [];
    parts.push(`${c.Quantity} ${c.Alias}`);
    summaryById.set(c.LayoutTypeId, parts);
  }
  return types.recordset.map((row) => ({
    ...toLayout(row),
    summary: (summaryById.get(row.Id) || []).join(" · "),
  }));
}

// The active categories x quantities of one layout type.
async function getLayoutComposition(db, layoutTypeId) {
  const r = await db.request().input("id", sql.Int, layoutTypeId).query(`
    SELECT cat.Id AS categoryId, cat.Alias AS alias, rc.Quantity AS quantity
    FROM dbo.RoomLayoutType lt
    JOIN dbo.UnitRoomConfig cfg ON ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1
    JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id AND rc.Quantity > 0
    JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId AND cat.IsActive = 1
    WHERE lt.Id = @id
    ORDER BY cat.SortOrder ASC, cat.Alias ASC
  `);
  return r.recordset;
}

class LayoutValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Validates a Unit Type coming in from a form (LayoutTypeId and/or the
// UnitType label) and returns what to store: { layoutTypeId, unitType }.
//   - empty input -> both null (a unit may still be left untyped)
//   - an unregistered type is rejected, EXCEPT the exact text the record
//     already carries (`keepText`) so an untouched legacy value never blocks
//     saving an unrelated field
//   - `requireComposition`: a type with no rooms defined yet is rejected,
//     EXCEPT one already in `keepLayoutIds` (so an existing unit/template row
//     can keep its type while its composition is still being set up)
async function resolveUnitTypeInput(db, { LayoutTypeId, UnitType } = {}, { requireComposition = false, keepLayoutIds = [], keepText = null } = {}) {
  const text = String(UnitType ?? "").trim();
  const hasId = LayoutTypeId != null && LayoutTypeId !== "";
  if (!hasId && !text) return { layoutTypeId: null, unitType: null };

  const layout = await resolveLayoutType(db, hasId ? { layoutTypeId: LayoutTypeId } : { unitType: text });
  if (!layout) {
    if (!hasId && keepText != null && text === String(keepText).trim()) {
      return { layoutTypeId: null, unitType: text };
    }
    throw new LayoutValidationError(
      `Unit Type "${text || LayoutTypeId}" isn't a registered layout type — add it in Unit Composition first.`,
    );
  }
  if (requireComposition && layout.roomCount === 0 && !keepLayoutIds.includes(layout.id)) {
    throw new LayoutValidationError(
      `"${layout.label}" has no rooms defined yet — set up its layout in Unit Composition first.`,
    );
  }
  return { layoutTypeId: layout.id, unitType: layout.label };
}

// ── Rooms ────────────────────────────────────────────────────────────────

// A room "has work" once anything real hangs off it — these are exactly the
// tables with a FK to dbo.RoomMaster (sys.foreign_keys) plus an uploaded
// blueprint. Such a room is never deactivated or removed automatically.
const ROOM_HAS_WORK = `
  CASE WHEN r.BlueprintFileData IS NOT NULL
    OR EXISTS (SELECT 1 FROM dbo.DailyLabourEntry d WHERE d.RoomId = r.Id)
    OR EXISTS (SELECT 1 FROM dbo.DependencyMaster dm WHERE dm.RoomId = r.Id)
    OR EXISTS (SELECT 1 FROM dbo.ActivityBlueprintAnnotation a WHERE a.RoomId = r.Id)
  THEN 1 ELSE 0 END
`;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Generated rooms are named "{Alias}" (one of a category) or "{Alias} {n}".
// Only names following that pattern are ever renamed here — a room someone
// renamed by hand in Room Master keeps its name.
function autoNameIndex(name, alias) {
  const m = new RegExp(`^${escapeRegex(alias)}(?:\\s+(\\d+))?$`, "i").exec(String(name || "").trim());
  if (!m) return null;
  return m[1] ? parseInt(m[1], 10) : 0;
}

// dbo.RoomMaster.RoomName width (migration 477) — fits a 150-char category
// Alias plus " {n}".
const ROOM_NAME_MAX = 160;

function floorLabelOf(floorNo) {
  // Same 'G' / numbered-string convention CrmProjectAutoSetupFloor.FloorLabel uses.
  return floorNo === 0 ? "G" : floorNo != null ? String(floorNo) : null;
}

// Brings one unit's RoomMaster rows in line with its layout's composition.
// Matching is by RoomCategoryId COUNT, not by name — so a Bathroom going
// from 1 to 2 turns "Bathroom" into "Bathroom 1" + a new "Bathroom 2"
// rather than leaving "Bathroom" and adding two more.
//   - missing rooms: an inactive room of that category is reactivated
//     first (keeps its Id/blueprint), otherwise a new row is inserted
//   - `removeUnused` (unit type changed): surplus rooms — and rooms of a
//     category the new layout doesn't have — are soft-deactivated ONLY if
//     they have no work; ones with work are kept and reported back
//   - rooms with no RoomCategoryId (manual free-text rooms) are never touched
// Must run inside a transaction: the unit row is UPDLOCKed first so two
// syncs of the same unit (e.g. a composition save propagating while an
// admin runs the bulk generate) serialize instead of both inserting.
// `cache` (a Map) lets a batch caller share layout/composition lookups.
async function syncUnitRooms(db, unitId, { removeUnused = false, createdBy = null, cache = null } = {}) {
  const result = { created: 0, reactivated: 0, deactivated: 0, renamed: 0, keptWithWork: [], layout: null, skipped: null };

  const unitRes = await db.request().input("id", sql.Int, unitId).query(`
    SELECT Id, ProjectId, BlockId, FloorNo, UnitType, LayoutTypeId
    FROM dbo.UnitMaster WITH (UPDLOCK, ROWLOCK)
    WHERE Id = @id AND IsActive = 1
  `);
  const unit = unitRes.recordset[0];
  if (!unit) { result.skipped = "unit-not-found"; return result; }

  const layoutKey = unit.LayoutTypeId ? `id:${unit.LayoutTypeId}` : `text:${normalizeTypeKey(unit.UnitType)}`;
  let cached = cache?.get(layoutKey);
  if (!cached) {
    const layout = unit.LayoutTypeId
      ? await resolveLayoutType(db, { layoutTypeId: unit.LayoutTypeId })
      : await resolveLayoutType(db, { unitType: unit.UnitType });
    cached = { layout, composition: layout ? await getLayoutComposition(db, layout.id) : [] };
    cache?.set(layoutKey, cached);
  }
  const { layout, composition } = cached;
  result.layout = layout;
  if (!composition.length && !removeUnused) {
    result.skipped = layout ? "no-composition" : "no-layout";
    return result;
  }

  const roomsRes = await db.request().input("uid", sql.Int, unitId).query(`
    SELECT r.Id, r.RoomName, r.IsActive, r.RoomCategoryId, ${ROOM_HAS_WORK} AS HasWork
    FROM dbo.RoomMaster r WHERE r.UnitId = @uid
  `);
  const rooms = roomsRes.recordset;
  const floor = floorLabelOf(unit.FloorNo);
  const desired = new Map(composition.map((c) => [c.categoryId, c]));
  const categoryIds = new Set([
    ...desired.keys(),
    ...rooms.filter((r) => r.IsActive && r.RoomCategoryId != null).map((r) => r.RoomCategoryId),
  ]);
  const inserts = []; // { name, categoryId } — written in one statement below

  for (const categoryId of categoryIds) {
    const want = desired.get(categoryId);
    const qty = want ? want.quantity : 0;
    const catRooms = rooms.filter((r) => r.RoomCategoryId === categoryId);
    const bySuffixThenId = (a, b) => {
      const ai = want ? autoNameIndex(a.RoomName, want.alias) : null;
      const bi = want ? autoNameIndex(b.RoomName, want.alias) : null;
      return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER) || a.Id - b.Id;
    };
    // final: [{ row|null, reactivate }]
    const final = catRooms.filter((r) => r.IsActive).sort(bySuffixThenId).map((row) => ({ row, reactivate: false }));

    if (final.length < qty) {
      const inactive = catRooms.filter((r) => !r.IsActive).sort(bySuffixThenId);
      while (final.length < qty && inactive.length) final.push({ row: inactive.shift(), reactivate: true });
      while (final.length < qty) final.push({ row: null, reactivate: false });
    }
    let retiredHere = 0;
    if (final.length > qty && removeUnused) {
      // Surplus: retire rooms WITHOUT work first (last-numbered first), so a
      // room with work survives in preference to an empty one. Only what
      // still exceeds the layout after that is reported as kept.
      let excess = final.length - qty;
      for (let i = final.length - 1; i >= 0 && excess > 0; i--) {
        const { row } = final[i];
        if (row.HasWork) continue;
        await db.request().input("id", sql.Int, row.Id)
          .query("UPDATE dbo.RoomMaster SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
        result.deactivated++;
        retiredHere++;
        final.splice(i, 1);
        excess--;
      }
      for (let i = final.length - 1; i >= 0 && excess > 0; i--, excess--) final[i].keptOverLayout = true;
    }

    if (!want) {
      // Category not in the layout at all — when retiring, whatever
      // survived did so because it has work.
      if (removeUnused) for (const f of final) result.keptWithWork.push(f.row.RoomName);
      continue;
    }

    // Names are only touched when THIS category actually changed in this
    // sync (a room added, reactivated or retired). A category that is
    // already complete keeps its names exactly as they are — including a
    // room someone added by hand as "Bedroom 9" — so a bulk run or a
    // composition save never renames rooms it had no reason to touch.
    const categoryChanged = retiredHere > 0 || final.some((f) => !f.row || f.reactivate);
    if (!categoryChanged) {
      for (const f of final) if (f.keptOverLayout) result.keptWithWork.push(f.row.RoomName);
      continue;
    }

    // Names: "{Alias}" alone, or "{Alias} 1..n". Hand-renamed rooms keep
    // their name and their name is never reused.
    const n = final.length;
    const taken = new Set(
      final.filter((f) => f.row && autoNameIndex(f.row.RoomName, want.alias) === null)
        .map((f) => String(f.row.RoomName).trim().toLowerCase()),
    );
    let next = 1;
    const nextName = () => {
      if (n === 1) return want.alias;
      let name;
      do { name = `${want.alias} ${next++}`; } while (taken.has(name.toLowerCase()));
      return name;
    };

    for (const f of final) {
      const isAuto = !f.row || autoNameIndex(f.row.RoomName, want.alias) !== null;
      const name = isAuto ? nextName() : f.row.RoomName;
      if (f.keptOverLayout) result.keptWithWork.push(name);
      if (!f.row) {
        inserts.push({ name, categoryId });
      } else if (f.reactivate || name !== f.row.RoomName) {
        await db.request()
          .input("id", sql.Int, f.row.Id)
          .input("RoomName", sql.NVarChar(ROOM_NAME_MAX), name)
          .input("Floor", sql.NVarChar(50), floor)
          .input("reactivate", sql.Bit, f.reactivate ? 1 : 0)
          .query(`
            UPDATE dbo.RoomMaster SET
              RoomName = @RoomName,
              IsActive = 1,
              Floor = CASE WHEN @reactivate = 1 THEN @Floor ELSE Floor END,
              UpdatedAt = SYSDATETIME()
            WHERE Id = @id
          `);
        if (f.reactivate) result.reactivated++;
        else result.renamed++;
      }
    }
  }

  // All new rooms of the unit in one multi-row INSERT (a layout is at most
  // a few dozen rooms — far under SQL Server's 2100-parameter limit).
  if (inserts.length) {
    const req = db.request()
      .input("ProjectId", sql.Int, unit.ProjectId)
      .input("BlockId", sql.Int, unit.BlockId)
      .input("UnitId", sql.Int, unitId)
      .input("Floor", sql.NVarChar(50), floor)
      .input("CreatedBy", sql.Int, createdBy);
    const values = inserts.map((ins, i) => {
      req.input(`n${i}`, sql.NVarChar(ROOM_NAME_MAX), ins.name);
      req.input(`c${i}`, sql.Int, ins.categoryId);
      return `(@ProjectId, @BlockId, @UnitId, @n${i}, @c${i}, @Floor, 1, @CreatedBy, SYSDATETIME())`;
    });
    await req.query(`
      INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedBy, CreatedAt)
      VALUES ${values.join(",\n")}
    `);
    result.created += inserts.length;
  }

  return result;
}

// Best-effort category for a room typed by hand in Room Master: its name is
// an active category's Alias alone or "{Alias} {n}" (the RoomNameField
// suggests exactly those). Same rule migration 466 used to backfill
// RoomCategoryId; returns null for no match or an ambiguous one.
async function inferRoomCategoryId(db, roomName) {
  const r = await db.request().query("SELECT Id, Alias FROM dbo.RoomCategoryMaster WHERE IsActive = 1");
  const matches = r.recordset.filter((c) => autoNameIndex(roomName, c.Alias) !== null);
  return matches.length === 1 ? matches[0].Id : null;
}

// Runs syncUnitRooms for many units, each in its own transaction so one bad
// unit can't roll back (or block) the rest. Returns totals + per-unit
// failures.
async function syncRoomsForUnits(pool, unitIds, opts = {}) {
  const totals = { units: 0, unitsChanged: 0, created: 0, reactivated: 0, renamed: 0, deactivated: 0, skippedNoLayout: 0, failed: [] };
  const cache = new Map(); // layout + composition, shared across the batch
  for (const unitId of unitIds) {
    totals.units++;
    const tx = pool.transaction();
    await tx.begin();
    try {
      const r = await syncUnitRooms(tx, unitId, { ...opts, cache });
      await tx.commit();
      if (r.skipped) totals.skippedNoLayout++;
      totals.created += r.created;
      totals.reactivated += r.reactivated;
      totals.renamed += r.renamed;
      totals.deactivated += r.deactivated;
      if (r.created || r.reactivated || r.renamed || r.deactivated) totals.unitsChanged++;
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      totals.failed.push({ unitId, error: e.message });
    }
  }
  return totals;
}

// Before a unit is permanently deleted: its rooms go with it, but only if
// none of them has work. Returns a blocker message (and deletes nothing) if
// any does; otherwise deletes every RoomMaster row of the unit (active and
// inactive). Meant to run inside the same transaction as the unit DELETE.
async function removeUnitRoomsForDelete(db, unitId) {
  const r = await db.request().input("uid", sql.Int, unitId).query(`
    SELECT r.RoomName FROM dbo.RoomMaster r WHERE r.UnitId = @uid AND ${ROOM_HAS_WORK} = 1
  `);
  if (r.recordset.length) {
    const names = r.recordset.map((x) => x.RoomName);
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
    return `has DPR work recorded against its room(s) (${shown}) — those rooms can't be removed`;
  }
  await db.request().input("uid", sql.Int, unitId).query("DELETE FROM dbo.RoomMaster WHERE UnitId = @uid");
  return null;
}

module.exports = {
  normalizeTypeKey,
  resolveLayoutType,
  listLayoutTypes,
  getLayoutComposition,
  resolveUnitTypeInput,
  LayoutValidationError,
  syncUnitRooms,
  syncRoomsForUnits,
  removeUnitRoomsForDelete,
  inferRoomCategoryId,
  bumpFlatMasterCaches,
  ROOM_NAME_MAX,
};
