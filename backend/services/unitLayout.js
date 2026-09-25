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
      WHERE ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1 AND rc.Quantity > 0
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
    SELECT lt.Id AS LayoutTypeId, cat.Id AS CategoryId, cat.Alias, rc.Quantity
    FROM dbo.RoomLayoutType lt
    JOIN dbo.UnitRoomConfig cfg ON ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1
    JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id AND rc.Quantity > 0
    JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
    WHERE lt.IsActive = 1
    ORDER BY cat.SortOrder ASC, cat.Alias ASC
  `);
  const compById = new Map();
  for (const c of comp.recordset) {
    const rows = compById.get(c.LayoutTypeId) || [];
    rows.push({ categoryId: c.CategoryId, alias: c.Alias, quantity: c.Quantity });
    compById.set(c.LayoutTypeId, rows);
  }
  return types.recordset.map((row) => {
    const composition = compById.get(row.Id) || [];
    return {
      ...toLayout(row),
      summary: composition.map((c) => `${c.quantity} ${c.alias}`).join(" · "),
      composition,
    };
  });
}

// The active categories x quantities of one layout type.
async function getLayoutComposition(db, layoutTypeId) {
  const r = await db.request().input("id", sql.Int, layoutTypeId).query(`
    SELECT cat.Id AS categoryId, cat.Alias AS alias, rc.Quantity AS quantity
    FROM dbo.RoomLayoutType lt
    JOIN dbo.UnitRoomConfig cfg ON ${CONFIG_MATCHES_LAYOUT} AND cfg.IsActive = 1
    JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id AND rc.Quantity > 0
    JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
    WHERE lt.Id = @id
    ORDER BY cat.SortOrder ASC, cat.Alias ASC
  `);
  return r.recordset;
}

// ── Layout overrides (migration 480) ─────────────────────────────────────
// A layout type's global composition can be overridden for one Project,
// Block, floor range of a Block, or single Unit. The most specific active
// override wins:  UNIT > FLOOR > BLOCK > PROJECT > global.
const SCOPE_RANK = { UNIT: 4, FLOOR: 3, BLOCK: 2, PROJECT: 1 };
const SCOPE_LABEL = { UNIT: "Unit", FLOOR: "Floor", BLOCK: "Block", PROJECT: "Project" };

function floorText(n) {
  return n === 0 ? "G" : String(n);
}

function describeScope(o) {
  if (o.ScopeLevel === "FLOOR") {
    return o.FloorFrom === o.FloorTo ? `Floor ${floorText(o.FloorFrom)}` : `Floors ${floorText(o.FloorFrom)}–${floorText(o.FloorTo)}`;
  }
  return SCOPE_LABEL[o.ScopeLevel];
}

// Every ACTIVE override of one layout type in one project, each with its
// full room list (active categories only, quantity > 0, in category order).
// Set once the table is seen to exist, so the check isn't repeated. Code
// deployed before migration 480 ran must still work: no override table
// simply means no overrides.
let overrideTableExists = false;
async function overrideTableReady(db) {
  if (overrideTableExists) return true;
  const t = await db.request().query("SELECT OBJECT_ID('dbo.RoomLayoutOverride', 'U') AS id");
  overrideTableExists = t?.recordset?.[0]?.id != null;
  return overrideTableExists;
}

async function loadOverrides(db, layoutTypeId, projectId) {
  if (!(await overrideTableReady(db))) return [];
  const r = await db.request()
    .input("lt", sql.Int, layoutTypeId)
    .input("pid", sql.Int, projectId)
    .query(`
      SELECT o.Id, o.ScopeLevel, o.ProjectId, o.BlockId, o.FloorFrom, o.FloorTo, o.UnitId,
             cat.Id AS categoryId, cat.Alias AS alias, i.Quantity AS quantity, cat.IsActive AS categoryActive
      FROM dbo.RoomLayoutOverride o
      LEFT JOIN dbo.RoomLayoutOverrideItem i ON i.OverrideId = o.Id AND i.Quantity > 0
      LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = i.RoomCategoryId
      WHERE o.LayoutTypeId = @lt AND o.ProjectId = @pid AND o.IsActive = 1
      ORDER BY o.Id, cat.SortOrder, cat.Alias
    `);
  const byId = new Map();
  for (const row of r.recordset) {
    if (!byId.has(row.Id)) {
      byId.set(row.Id, {
        Id: row.Id, ScopeLevel: row.ScopeLevel, ProjectId: row.ProjectId, BlockId: row.BlockId,
        FloorFrom: row.FloorFrom, FloorTo: row.FloorTo, UnitId: row.UnitId, composition: [],
      });
    }
    if (row.categoryId != null) {
      byId.get(row.Id).composition.push({ categoryId: row.categoryId, alias: row.alias, quantity: row.quantity });
      if (!row.categoryActive) (byId.get(row.Id).inactive ||= []).push({ categoryId: row.categoryId, alias: row.alias, quantity: row.quantity });
    }
  }
  return [...byId.values()];
}

// Editing an EXISTING override keeps its rooms of now-deactivated categories
// (they can't be picked any more, but a deactivated category must not
// silently vanish from layouts that already use it).
function withInactiveCarryOver(current, composition) {
  const extra = (current?.inactive || []).filter((c) => !composition.some((x) => x.categoryId === c.categoryId));
  return extra.length ? [...composition, ...extra] : composition;
}

// Which override (if any) applies to a unit — the most specific one.
function pickOverride(overrides, unit) {
  let best = null;
  for (const o of overrides) {
    const applies =
      (o.ScopeLevel === "PROJECT" && o.ProjectId === unit.ProjectId) ||
      (o.ScopeLevel === "BLOCK" && o.BlockId === unit.BlockId) ||
      (o.ScopeLevel === "FLOOR" && o.BlockId === unit.BlockId && unit.FloorNo != null && unit.FloorNo >= o.FloorFrom && unit.FloorNo <= o.FloorTo) ||
      (o.ScopeLevel === "UNIT" && o.UnitId === unit.Id);
    if (applies && (!best || SCOPE_RANK[o.ScopeLevel] > SCOPE_RANK[best.ScopeLevel])) best = o;
  }
  return best;
}

// The composition a unit actually gets: its most specific override, else
// its layout type's global composition. `source` says where it came from.
// `cache` (Map, optional) shares global compositions + a project's
// overrides across a batch.
async function getEffectiveComposition(db, unit, layout, cache = null) {
  if (!layout) return { composition: [], source: { level: "NONE", label: "No layout type" } };
  const gKey = `global:${layout.id}`;
  let global = cache?.get(gKey);
  if (!global) { global = await getLayoutComposition(db, layout.id); cache?.set(gKey, global); }
  const oKey = `ovr:${layout.id}:${unit.ProjectId}`;
  let overrides = cache?.get(oKey);
  if (!overrides) { overrides = await loadOverrides(db, layout.id, unit.ProjectId); cache?.set(oKey, overrides); }
  const o = pickOverride(overrides, unit);
  if (o) return { composition: o.composition, source: { level: o.ScopeLevel, overrideId: o.Id, label: `${describeScope(o)} override` } };
  return { composition: global, source: { level: "GLOBAL", label: `Unit Composition (${layout.label})` } };
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
    cached = { layout };
    cache?.set(layoutKey, cached);
  }
  const { layout } = cached;
  result.layout = layout;
  // The unit's EFFECTIVE layout: its most specific Project / Block / Floor /
  // Unit override, else the layout type's global composition.
  const effective = await getEffectiveComposition(db, unit, layout, cache);
  const composition = effective.composition;
  result.source = effective.source;
  if (!composition.length && !removeUnused) {
    result.skipped = layout ? "no-composition" : "no-layout";
    return result;
  }

  const roomsRes = await db.request().input("uid", sql.Int, unitId).query(`
    SELECT r.Id, r.RoomName, r.IsActive, r.RoomCategoryId, ${ROOM_HAS_WORK} AS HasWork
    FROM dbo.RoomMaster r WHERE r.UnitId = @uid
  `);
  const rooms = roomsRes.recordset;

  // Legacy rooms saved without a category (e.g. created before migration
  // 466, or whose backfill found no match) are otherwise invisible to the
  // count below — the sync would then add a SECOND "Bedroom" next to the
  // old one. Adopt any such room whose name clearly is a category
  // ("Bedroom", "Balcony 2" — exactly one active category matches) so it
  // counts, keeping its Id and whatever work/blueprint is on it. Names that
  // match nothing (e.g. "Pooja Room") stay uncategorized and untouched.
  if (rooms.some((r) => r.RoomCategoryId == null)) {
    let cats = cache?.get("__categories");
    if (!cats) {
      cats = (await db.request().query("SELECT Id, Alias FROM dbo.RoomCategoryMaster WHERE IsActive = 1")).recordset;
      cache?.set("__categories", cats);
    }
    for (const r of rooms) {
      if (r.RoomCategoryId != null) continue;
      const matches = cats.filter((c) => autoNameIndex(r.RoomName, c.Alias) !== null);
      if (matches.length !== 1) continue;
      await db.request().input("id", sql.Int, r.Id).input("cat", sql.Int, matches[0].Id)
        .query("UPDATE dbo.RoomMaster SET RoomCategoryId = @cat, UpdatedAt = SYSDATETIME() WHERE Id = @id AND RoomCategoryId IS NULL");
      r.RoomCategoryId = matches[0].Id;
      result.categorized = (result.categorized || 0) + 1;
    }
  }

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

// ── Override editing: validate / preview / save / reset ──────────────────

const MAX_ROOM_QTY = 10;
const SCOPES = new Set(["PROJECT", "BLOCK", "FLOOR", "UNIT"]);

// Normalizes + validates the scope of an override request against the DB.
// Returns { layout, ScopeLevel, ProjectId, BlockId, FloorFrom, FloorTo, UnitId }.
async function validateScope(db, input) {
  const int = (v) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
  const ScopeLevel = String(input.ScopeLevel || "").toUpperCase();
  if (!SCOPES.has(ScopeLevel)) throw new LayoutValidationError("ScopeLevel must be PROJECT, BLOCK, FLOOR or UNIT.");
  const layout = await resolveLayoutType(db, { layoutTypeId: input.LayoutTypeId });
  if (!layout) throw new LayoutValidationError("Unknown or inactive layout type.");
  const s = { layout, ScopeLevel, ProjectId: int(input.ProjectId), BlockId: null, FloorFrom: null, FloorTo: null, UnitId: null };
  if (!Number.isInteger(s.ProjectId)) throw new LayoutValidationError("ProjectId is required.");

  if (ScopeLevel !== "PROJECT") {
    s.BlockId = int(input.BlockId);
    if (!Number.isInteger(s.BlockId)) throw new LayoutValidationError("BlockId is required for this scope.");
    const b = await db.request().input("b", sql.Int, s.BlockId).input("p", sql.Int, s.ProjectId)
      .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @b AND ProjectId = @p AND IsActive = 1");
    if (!b.recordset.length) throw new LayoutValidationError("That block doesn't belong to this project.");
  }
  if (ScopeLevel === "FLOOR") {
    s.FloorFrom = int(input.FloorFrom);
    s.FloorTo = int(input.FloorTo);
    if (!Number.isInteger(s.FloorFrom) || !Number.isInteger(s.FloorTo)) throw new LayoutValidationError("Floor range needs a From and To floor.");
    if (s.FloorFrom < -10 || s.FloorTo > 300) throw new LayoutValidationError("Floor range is out of bounds.");
    if (s.FloorFrom > s.FloorTo) throw new LayoutValidationError("Floor range 'From' must not be above 'To'.");
  }
  if (ScopeLevel === "UNIT") {
    s.UnitId = int(input.UnitId);
    if (!Number.isInteger(s.UnitId)) throw new LayoutValidationError("UnitId is required for a unit override.");
    const u = await db.request().input("u", sql.Int, s.UnitId).query("SELECT Id, ProjectId, BlockId, LayoutTypeId FROM dbo.UnitMaster WHERE Id = @u AND IsActive = 1");
    const unit = u.recordset[0];
    if (!unit || unit.ProjectId !== s.ProjectId || unit.BlockId !== s.BlockId) throw new LayoutValidationError("That unit doesn't belong to this project/block.");
    if (unit.LayoutTypeId !== layout.id) throw new LayoutValidationError(`That unit isn't a ${layout.label}.`);
  }
  return s;
}

async function validateItems(db, items) {
  if (!Array.isArray(items)) throw new LayoutValidationError("items must be a list of { roomCategoryId, quantity }.");
  const cats = (await db.request().query("SELECT Id, Alias, SortOrder FROM dbo.RoomCategoryMaster WHERE IsActive = 1")).recordset;
  const byId = new Map(cats.map((c) => [c.Id, c]));
  const clean = new Map();
  for (const it of items) {
    const id = Number(it.roomCategoryId);
    const qty = Number(it.quantity);
    if (!byId.has(id)) throw new LayoutValidationError(`Room category ${it.roomCategoryId} doesn't exist or is inactive.`);
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_ROOM_QTY) throw new LayoutValidationError(`Quantity must be a whole number from 0 to ${MAX_ROOM_QTY}.`);
    clean.set(id, qty);
  }
  const composition = cats.filter((c) => clean.get(c.Id) > 0)
    .sort((a, b) => a.SortOrder - b.SortOrder || a.Alias.localeCompare(b.Alias))
    .map((c) => ({ categoryId: c.Id, alias: c.Alias, quantity: clean.get(c.Id) }));
  if (!composition.length) throw new LayoutValidationError("An override must have at least one room.");
  return { composition, all: cats.map((c) => ({ roomCategoryId: c.Id, quantity: clean.get(c.Id) || 0 })) };
}

function sameScope(o, s) {
  return o.ScopeLevel === s.ScopeLevel &&
    (s.ScopeLevel === "PROJECT" ||
     (s.ScopeLevel === "BLOCK" && o.BlockId === s.BlockId) ||
     (s.ScopeLevel === "FLOOR" && o.BlockId === s.BlockId && o.FloorFrom === s.FloorFrom && o.FloorTo === s.FloorTo) ||
     (s.ScopeLevel === "UNIT" && o.UnitId === s.UnitId));
}

// A floor range may not overlap another floor-range override of the same
// block + layout type (other than itself) — otherwise which one wins would
// be ambiguous.
function findOverlap(overrides, s) {
  if (s.ScopeLevel !== "FLOOR") return null;
  return overrides.find((o) => o.ScopeLevel === "FLOOR" && o.BlockId === s.BlockId && !sameScope(o, s)
    && o.FloorFrom <= s.FloorTo && s.FloorFrom <= o.FloorTo) || null;
}

// Active units of this layout type inside the scope.
async function unitsInScope(db, s) {
  const r = db.request().input("lt", sql.Int, s.layout.id).input("p", sql.Int, s.ProjectId);
  let where = "u.IsActive = 1 AND u.LayoutTypeId = @lt AND u.ProjectId = @p";
  if (s.BlockId != null) { r.input("b", sql.Int, s.BlockId); where += " AND u.BlockId = @b"; }
  if (s.ScopeLevel === "FLOOR") { r.input("ff", sql.Int, s.FloorFrom).input("ft", sql.Int, s.FloorTo); where += " AND u.FloorNo BETWEEN @ff AND @ft"; }
  if (s.ScopeLevel === "UNIT") { r.input("u", sql.Int, s.UnitId); where += " AND u.Id = @u"; }
  return (await r.query(`SELECT u.Id, u.ProjectId, u.BlockId, u.FloorNo, u.UnitName FROM dbo.UnitMaster u WHERE ${where}`)).recordset;
}

// What saving (items = composition) or resetting (items = null) this scope's
// override would do to each unit's rooms — computed, nothing written. Uses
// the same rules as syncUnitRooms(removeUnused: true): add missing rooms,
// retire surplus rooms WITHOUT work, keep (and list) surplus rooms WITH work.
async function previewOverrideChange(db, s, composition) {
  const overrides = await loadOverrides(db, s.layout.id, s.ProjectId);
  const current = overrides.find((o) => sameScope(o, s)) || null;
  if (composition) composition = withInactiveCarryOver(current, composition);
  const overlap = composition ? findOverlap(overrides, s) : null;
  const global = await getLayoutComposition(db, s.layout.id);
  const hypothetical = overrides.filter((o) => !sameScope(o, s));
  if (composition) hypothetical.push({ Id: 0, ...s, composition });

  const units = await unitsInScope(db, s);
  const result = {
    scope: { level: s.ScopeLevel, label: describeScope(s), layout: s.layout.label },
    existingOverrideId: current?.Id ?? null,
    overlap: overlap ? { id: overlap.Id, label: describeScope(overlap) } : null,
    unitsInScope: units.length, unitsChanged: 0, unitsShadowed: 0,
    roomsToAdd: 0, roomsToRemove: 0, roomsKeptWithWork: [],
  };
  if (!units.length) return result;

  const ids = units.map((u) => u.Id);
  const rooms = (await db.request().query(`
    SELECT r.UnitId, r.RoomCategoryId, r.RoomName, ${ROOM_HAS_WORK} AS HasWork
    FROM dbo.RoomMaster r WHERE r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL AND r.UnitId IN (${ids.join(",")})
  `)).recordset;
  const roomsByUnit = new Map();
  for (const r of rooms) {
    if (!roomsByUnit.has(r.UnitId)) roomsByUnit.set(r.UnitId, []);
    roomsByUnit.get(r.UnitId).push(r);
  }

  for (const u of units) {
    const target = (pickOverride(hypothetical, u) || { composition: global }).composition;
    const before = (pickOverride(overrides, u) || { composition: global }).composition;
    const want = new Map(target.map((c) => [c.categoryId, c.quantity]));
    // A more specific override (e.g. a unit override inside this block)
    // keeps the unit on its own layout — this change doesn't reach it.
    const winner = pickOverride(hypothetical, u);
    if (composition && winner && !sameScope(winner, s) && SCOPE_RANK[winner.ScopeLevel] > SCOPE_RANK[s.ScopeLevel]) { result.unitsShadowed++; continue; }
    const have = roomsByUnit.get(u.Id) || [];
    const cats = new Set([...want.keys(), ...have.map((r) => r.RoomCategoryId)]);
    let add = 0, remove = 0; const kept = [];
    for (const cat of cats) {
      const q = want.get(cat) || 0;
      const inCat = have.filter((r) => r.RoomCategoryId === cat);
      if (inCat.length < q) add += q - inCat.length;
      else if (inCat.length > q) {
        let excess = inCat.length - q;
        const clean = inCat.filter((r) => !r.HasWork).length;
        const drop = Math.min(excess, clean);
        remove += drop; excess -= drop;
        inCat.filter((r) => r.HasWork).slice(0, excess).forEach((r) => kept.push(`${u.UnitName}: ${r.RoomName}`));
      }
    }
    const layoutChanged = JSON.stringify(target) !== JSON.stringify(before);
    if (add || remove || kept.length || layoutChanged) result.unitsChanged++;
    result.roomsToAdd += add;
    result.roomsToRemove += remove;
    result.roomsKeptWithWork.push(...kept);
  }
  return result;
}

// Creates or replaces the override for this scope (one transaction).
// Returns { overrideId, unitIds } — the caller syncs those units' rooms.
async function saveOverride(pool, s, itemsAll, actor) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const overrides = await loadOverrides(tx, s.layout.id, s.ProjectId);
    const overlap = findOverlap(overrides, s);
    if (overlap) throw new LayoutValidationError(`This floor range overlaps the existing ${describeScope(overlap)} override for ${s.layout.label} — edit or reset that one first.`);
    const current = overrides.find((o) => sameScope(o, s));
    let overrideId = current?.Id;
    if (overrideId) {
      await tx.request().input("id", sql.Int, overrideId).input("by", sql.NVarChar(200), actor)
        .query("UPDATE dbo.RoomLayoutOverride SET UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
      await tx.request().input("id", sql.Int, overrideId).query("DELETE FROM dbo.RoomLayoutOverrideItem WHERE OverrideId = @id");
    } else {
      const ins = await tx.request()
        .input("lt", sql.Int, s.layout.id).input("lvl", sql.NVarChar(10), s.ScopeLevel).input("p", sql.Int, s.ProjectId)
        .input("b", sql.Int, s.BlockId).input("ff", sql.Int, s.FloorFrom).input("ft", sql.Int, s.FloorTo).input("u", sql.Int, s.UnitId)
        .input("by", sql.NVarChar(200), actor)
        .query(`INSERT INTO dbo.RoomLayoutOverride (LayoutTypeId, ScopeLevel, ProjectId, BlockId, FloorFrom, FloorTo, UnitId, CreatedBy)
                OUTPUT INSERTED.Id AS id VALUES (@lt, @lvl, @p, @b, @ff, @ft, @u, @by)`);
      overrideId = ins.recordset[0].id;
    }
    const kept = (current?.inactive || []).filter((c) => !itemsAll.some((i) => i.roomCategoryId === c.categoryId))
      .map((c) => ({ roomCategoryId: c.categoryId, quantity: c.quantity }));
    for (const it of [...itemsAll, ...kept]) {
      await tx.request().input("o", sql.Int, overrideId).input("c", sql.Int, it.roomCategoryId).input("q", sql.Int, it.quantity)
        .query("INSERT INTO dbo.RoomLayoutOverrideItem (OverrideId, RoomCategoryId, Quantity) VALUES (@o, @c, @q)");
    }
    await tx.commit();
    return { overrideId, unitIds: (await unitsInScope(pool, s)).map((u) => u.Id) };
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    if (e && (e.number === 2601 || e.number === 2627)) {
      throw new LayoutValidationError("Someone else just saved a layout for this same level — reload and try again.");
    }
    throw e;
  }
}

// Removes (soft-deactivates) the override for this scope, so its units fall
// back to the next level up. Returns { overrideId, unitIds } or null.
async function resetOverride(pool, s, actor) {
  const overrides = await loadOverrides(pool, s.layout.id, s.ProjectId);
  const current = overrides.find((o) => sameScope(o, s));
  if (!current) return null;
  await pool.request().input("id", sql.Int, current.Id).input("by", sql.NVarChar(200), actor)
    .query("UPDATE dbo.RoomLayoutOverride SET IsActive = 0, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id AND IsActive = 1");
  return { overrideId: current.Id, unitIds: (await unitsInScope(pool, s)).map((u) => u.Id) };
}

// Every active override of a project — for the tree's "Custom" badges.
async function listProjectOverrides(db, projectId) {
  if (!(await overrideTableReady(db))) return [];
  const r = await db.request().input("p", sql.Int, projectId).query(`
    SELECT o.Id, o.LayoutTypeId, o.ScopeLevel, o.ProjectId, o.BlockId, o.FloorFrom, o.FloorTo, o.UnitId,
           cat.Id AS categoryId, cat.Alias AS alias, i.Quantity AS quantity
    FROM dbo.RoomLayoutOverride o
    LEFT JOIN dbo.RoomLayoutOverrideItem i ON i.OverrideId = o.Id AND i.Quantity > 0
    LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = i.RoomCategoryId
    WHERE o.ProjectId = @p AND o.IsActive = 1
    ORDER BY o.Id, cat.SortOrder, cat.Alias`);
  const byId = new Map();
  for (const row of r.recordset) {
    if (!byId.has(row.Id)) {
      byId.set(row.Id, {
        Id: row.Id, LayoutTypeId: row.LayoutTypeId, ScopeLevel: row.ScopeLevel, ProjectId: row.ProjectId,
        BlockId: row.BlockId, FloorFrom: row.FloorFrom, FloorTo: row.FloorTo, UnitId: row.UnitId, composition: [],
      });
    }
    if (row.categoryId != null) byId.get(row.Id).composition.push({ categoryId: row.categoryId, alias: row.alias, quantity: row.quantity });
  }
  return [...byId.values()];
}

// Before a Unit / Block / Project is permanently deleted: its layout
// overrides (active or reset) go with it — they are settings OF that level
// and would otherwise block the delete through their foreign keys. Meant to
// run inside the same transaction as the delete.
async function removeOverridesFor(db, { unitId = null, blockId = null, projectId = null }) {
  if (!(await overrideTableReady(db))) return 0;
  const [col, val] = unitId != null ? ["UnitId", unitId] : blockId != null ? ["BlockId", blockId] : ["ProjectId", projectId];
  if (val == null) return 0;
  await db.request().input("v", sql.Int, val).query(`
    DELETE i FROM dbo.RoomLayoutOverrideItem i JOIN dbo.RoomLayoutOverride o ON o.Id = i.OverrideId WHERE o.${col} = @v`);
  const r = await db.request().input("v", sql.Int, val).query(`DELETE FROM dbo.RoomLayoutOverride WHERE ${col} = @v`);
  return r.rowsAffected[0] || 0;
}

// A unit moved to another block/project keeps its own UNIT override — its
// scope columns follow the unit (resolution loads overrides per project).
async function moveUnitOverrides(db, unitId, projectId, blockId) {
  if (!(await overrideTableReady(db))) return;
  await db.request().input("u", sql.Int, unitId).input("p", sql.Int, projectId).input("b", sql.Int, blockId)
    .query("UPDATE dbo.RoomLayoutOverride SET ProjectId = @p, BlockId = @b WHERE UnitId = @u AND (ProjectId <> @p OR BlockId <> @b)");
}

// A category's Alias changed ("Hall Room" -> "Living Room"): rename its
// generated rooms ("Hall Room", "Hall Room 2") to the new alias, keeping the
// number. Only names that follow the generated pattern are touched — a
// room renamed by hand keeps its name. Room Ids never change, so DPR work /
// blueprints stay attached. Returns how many rooms were renamed.
async function renameCategoryRooms(db, categoryId, oldAlias, newAlias) {
  if (!oldAlias || !newAlias || oldAlias === newAlias) return 0;
  const rooms = (await db.request().input("c", sql.Int, categoryId)
    .query("SELECT Id, RoomName FROM dbo.RoomMaster WHERE RoomCategoryId = @c")).recordset;
  let n = 0;
  for (const r of rooms) {
    const idx = autoNameIndex(r.RoomName, oldAlias);
    if (idx === null) continue;
    const name = idx === 0 ? newAlias : `${newAlias} ${idx}`;
    if (name.length > ROOM_NAME_MAX || name === r.RoomName) continue;
    await db.request().input("id", sql.Int, r.Id).input("n", sql.NVarChar(ROOM_NAME_MAX), name)
      .query("UPDATE dbo.RoomMaster SET RoomName = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    n++;
  }
  return n;
}

// How many rooms renameCategoryRooms would rename (for the edit form).
async function countCategoryRoomsToRename(db, categoryId, oldAlias) {
  const rooms = (await db.request().input("c", sql.Int, categoryId)
    .query("SELECT RoomName FROM dbo.RoomMaster WHERE RoomCategoryId = @c")).recordset;
  return rooms.filter((r) => autoNameIndex(r.RoomName, oldAlias) !== null).length;
}

module.exports = {
  renameCategoryRooms,
  countCategoryRoomsToRename,
  moveUnitOverrides,
  removeOverridesFor,
  getEffectiveComposition,
  validateScope,
  validateItems,
  previewOverrideChange,
  saveOverride,
  resetOverride,
  listProjectOverrides,
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
