// Civil Work DPR — full sync diagnostic. READ-ONLY: every statement is a
// SELECT; nothing is written, locked or wrapped in a transaction, so it is
// safe to run against production at any time.
//
// Self-contained on purpose (no services/ imports): it must give a true
// answer on whatever app version is deployed. Checks whose table/column
// doesn't exist yet on this DB are reported as SKIPPED with the reason
// (usually a migration that never ran) instead of crashing.
//
// What it reports, for EVERY project:
//   1. Pending migrations (files in migrations/ not in dbo.__Migrations)
//   2. Rooms vs layout, per unit — using the same rules the app uses:
//      layout = UnitMaster.LayoutTypeId (else UnitType text -> TypeKey),
//      effective composition = most specific active override
//      (UNIT > FLOOR > BLOCK > PROJECT) else the layout's global
//      composition. Each out-of-sync unit is classified and explained,
//      including whether a Generate would fix it or rooms with work block it.
//   3. Structure: Project/Block/Floor/Unit/Room consistency
//   4. Layout config: types, compositions, overrides
//   5. Dependency chains + Work Allocation status rules
//
// Usage (inside the backend container / folder):
//   node scripts/checkDprSync.js                 # summary + details
//   node scripts/checkDprSync.js --project 83    # one project only
//   node scripts/checkDprSync.js --json out.json # also write full JSON
//   node scripts/checkDprSync.js --limit 50      # detail rows per section (default 25)

const fs = require("fs");
const path = require("path");
const { connectDB, getPool, closeDB } = require("../db");

const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ONLY_PROJECT = argVal("--project") ? parseInt(argVal("--project"), 10) : null;
const JSON_OUT = argVal("--json");
const LIMIT = parseInt(argVal("--limit") || "25", 10);

const report = { generatedAt: new Date().toISOString(), database: null, sections: [] };
let pool;

const q = async (text) => (await pool.request().query(text)).recordset;

// ── schema introspection (so older production schemas degrade gracefully) ─
const schema = { tables: new Set(), columns: new Map() };
async function loadSchema() {
  for (const r of await q("SELECT t.name AS t, c.name AS c FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id")) {
    schema.tables.add(r.t);
    if (!schema.columns.has(r.t)) schema.columns.set(r.t, new Set());
    schema.columns.get(r.t).add(r.c);
  }
}
const hasTable = (t) => schema.tables.has(t);
const hasCol = (t, c) => schema.columns.get(t)?.has(c) ?? false;
function missing(reqs) {
  return reqs.filter(([t, c]) => (c ? !hasCol(t, c) : !hasTable(t))).map(([t, c]) => (c ? `${t}.${c}` : t));
}

// ── output helpers ────────────────────────────────────────────────────────
let failCount = 0;
let skipCount = 0;
function section(title) {
  const s = { title, checks: [] };
  report.sections.push(s);
  console.log(`\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}`);
  return s;
}
function record(sec, name, rows, { note, severity = "FAIL" } = {}) {
  const n = rows.length;
  if (n && severity === "FAIL") failCount++;
  sec.checks.push({ name, status: n ? severity : "OK", count: n, note: note || null, rows });
  const tag = n ? (severity === "FAIL" ? "FAIL" : "INFO") : " ok ";
  console.log(`${tag}  ${name}: ${n}${note ? `   (${note})` : ""}`);
  if (n) for (const r of rows.slice(0, LIMIT)) console.log(`        ${JSON.stringify(r)}`);
  if (n > LIMIT) console.log(`        … ${n - LIMIT} more (use --limit or --json)`);
}
function skip(sec, name, why) {
  skipCount++;
  sec.checks.push({ name, status: "SKIPPED", reason: why });
  console.log(`SKIP  ${name}   (${why})`);
}
async function check(sec, name, reqs, sqlText, opts) {
  const m = missing(reqs);
  if (m.length) return skip(sec, name, `missing on this DB: ${m.join(", ")}`);
  try {
    record(sec, name, await q(sqlText), opts);
  } catch (e) {
    failCount++;
    sec.checks.push({ name, status: "ERROR", error: e.message });
    console.log(`ERR   ${name}: ${e.message}`);
  }
}
const projectFilter = (col) => (ONLY_PROJECT ? ` AND ${col} = ${ONLY_PROJECT}` : "");

// ── 1. migrations ─────────────────────────────────────────────────────────
async function checkMigrations() {
  const sec = section("1. MIGRATIONS — files on disk not yet applied to this DB");
  if (!hasTable("__Migrations")) return skip(sec, "Pending migrations", "no dbo.__Migrations table");
  const nameCol = [...schema.columns.get("__Migrations")].find((c) => /name|file|migration/i.test(c));
  const applied = new Set((await q(`SELECT [${nameCol}] AS n FROM dbo.__Migrations`)).map((r) => path.basename(String(r.n))));
  const dir = path.join(__dirname, "..", "migrations");
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== "seeds") walk(path.join(d, e.name)); }
      else if (e.name.endsWith(".sql")) files.push(e.name);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  const pending = files.filter((f) => !applied.has(f)).sort().map((f) => ({ file: f }));
  record(sec, "Pending migrations", pending, { note: pending.length ? "run: npm run migrate" : null });
}

// ── 2. rooms vs layout, per unit ──────────────────────────────────────────
async function checkRoomSync() {
  const sec = section("2. ROOMS vs LAYOUT — every unit's active rooms vs its effective layout");
  const need = [["UnitMaster"], ["RoomMaster"], ["RoomLayoutType"], ["UnitRoomConfig"], ["RoomComposition"], ["RoomCategoryMaster"], ["RoomMaster", "RoomCategoryId"], ["UnitMaster", "LayoutTypeId"]];
  const m = missing(need);
  if (m.length) return skip(sec, "Per-unit room sync", `missing on this DB: ${m.join(", ")}`);

  // "Has work" = a row in ANY table with a FK to RoomMaster, or a blueprint —
  // read from this DB's own foreign keys, so nothing is hard-coded.
  const fkRefs = await q(`
    SELECT OBJECT_NAME(fk.parent_object_id) AS tbl, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS col
    FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.RoomMaster')`);
  const workParts = fkRefs.map((f) => `EXISTS (SELECT 1 FROM dbo.[${f.tbl}] w WHERE w.[${f.col}] = r.Id)`);
  if (hasCol("RoomMaster", "BlueprintFileData")) workParts.unshift("r.BlueprintFileData IS NOT NULL");
  const hasWorkSql = workParts.length ? `CASE WHEN ${workParts.join(" OR ")} THEN 1 ELSE 0 END` : "0";
  console.log(`  "has work" = ${workParts.length ? [hasCol("RoomMaster", "BlueprintFileData") ? "blueprint" : null, ...fkRefs.map((f) => `${f.tbl}.${f.col}`)].filter(Boolean).join(", ") : "(nothing references RoomMaster)"}`);

  const units = await q(`
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.FloorNo, u.UnitType, u.LayoutTypeId,
           ${hasCol("UnitMaster", "UnitKind") ? "u.UnitKind" : "CAST(NULL AS NVARCHAR(20)) AS UnitKind"},
           e.name AS ProjectName, b.BlockName
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise e ON e.id = u.ProjectId
    LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE u.IsActive = 1 ${projectFilter("u.ProjectId")}`);
  const layouts = await q("SELECT Id, TypeKey, Label, IsActive FROM dbo.RoomLayoutType");
  const comps = await q(`
    SELECT lt.Id AS LayoutTypeId, rc.RoomCategoryId AS categoryId, cat.Alias AS alias, rc.Quantity AS quantity
    FROM dbo.RoomLayoutType lt
    JOIN dbo.UnitRoomConfig cfg ON (${hasCol("UnitRoomConfig", "LayoutTypeId") ? "cfg.LayoutTypeId = lt.Id OR (cfg.LayoutTypeId IS NULL AND cfg.BhkType = lt.TypeKey)" : "cfg.BhkType = lt.TypeKey"}) AND cfg.IsActive = 1
    JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id AND rc.Quantity > 0
    JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId`);
  const overrides = hasTable("RoomLayoutOverride") && hasTable("RoomLayoutOverrideItem") ? await q(`
    SELECT o.Id, o.LayoutTypeId, o.ScopeLevel, o.ProjectId, o.BlockId, o.FloorFrom, o.FloorTo, o.UnitId,
           i.RoomCategoryId AS categoryId, cat.Alias AS alias, i.Quantity AS quantity
    FROM dbo.RoomLayoutOverride o
    LEFT JOIN dbo.RoomLayoutOverrideItem i ON i.OverrideId = o.Id AND i.Quantity > 0
    LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = i.RoomCategoryId
    WHERE o.IsActive = 1`) : [];
  const rooms = await q(`
    SELECT r.Id, r.UnitId, r.RoomName, r.RoomCategoryId, r.IsActive, ${hasWorkSql} AS HasWork
    FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId
    WHERE u.IsActive = 1 ${projectFilter("u.ProjectId")}`);

  const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, "");
  const layoutById = new Map(layouts.filter((l) => l.IsActive).map((l) => [l.Id, l]));
  const layoutByKey = new Map(layouts.filter((l) => l.IsActive).map((l) => [norm(l.TypeKey), l]));
  const compByLayout = new Map();
  for (const c of comps) (compByLayout.get(c.LayoutTypeId) || compByLayout.set(c.LayoutTypeId, []).get(c.LayoutTypeId)).push(c);
  const ovrById = new Map();
  for (const o of overrides) {
    if (!ovrById.has(o.Id)) ovrById.set(o.Id, { ...o, composition: [] });
    if (o.categoryId != null) ovrById.get(o.Id).composition.push({ categoryId: o.categoryId, alias: o.alias, quantity: o.quantity });
  }
  const RANK = { UNIT: 4, FLOOR: 3, BLOCK: 2, PROJECT: 1 };
  const roomsByUnit = new Map();
  for (const r of rooms) (roomsByUnit.get(r.UnitId) || roomsByUnit.set(r.UnitId, []).get(r.UnitId)).push(r);

  const out = { missingRooms: [], surplusRemovable: [], surplusBlockedByWork: [], uncategorized: [], flatNoLayout: [], layoutNoComposition: [], unitTypeTextOnly: [] };
  const perProject = new Map();
  const bump = (u, key) => {
    const p = perProject.get(u.ProjectId) || perProject.set(u.ProjectId, { project: u.ProjectName, units: 0, inSync: 0, outOfSync: 0 }).get(u.ProjectId);
    p[key]++;
  };

  for (const u of units) {
    bump(u, "units");
    const where = `${u.ProjectName} > ${u.BlockName} > ${u.FloorNo ?? "-"} > ${u.UnitName}`;
    const layout = u.LayoutTypeId ? layoutById.get(u.LayoutTypeId) : layoutByKey.get(norm(u.UnitType));
    const unitRooms = roomsByUnit.get(u.Id) || [];
    const active = unitRooms.filter((r) => r.IsActive);
    if (!layout) {
      if (u.UnitKind === "PLOT") { bump(u, "inSync"); continue; } // plots have no rooms by design
      out.flatNoLayout.push({ unitId: u.Id, where, unitType: u.UnitType, layoutTypeId: u.LayoutTypeId, activeRooms: active.length });
      bump(u, "outOfSync");
      continue;
    }
    if (!u.LayoutTypeId) out.unitTypeTextOnly.push({ unitId: u.Id, where, unitType: u.UnitType, resolvesTo: layout.Label });

    let best = null;
    for (const o of ovrById.values()) {
      if (o.LayoutTypeId !== layout.Id || o.ProjectId !== u.ProjectId) continue;
      const applies = (o.ScopeLevel === "PROJECT")
        || (o.ScopeLevel === "BLOCK" && o.BlockId === u.BlockId)
        || (o.ScopeLevel === "FLOOR" && o.BlockId === u.BlockId && u.FloorNo != null && u.FloorNo >= o.FloorFrom && u.FloorNo <= o.FloorTo)
        || (o.ScopeLevel === "UNIT" && o.UnitId === u.Id);
      if (applies && (!best || RANK[o.ScopeLevel] > RANK[best.ScopeLevel])) best = o;
    }
    const composition = best ? best.composition : (compByLayout.get(layout.Id) || []);
    const source = best ? `${best.ScopeLevel} override #${best.Id}` : `global ${layout.Label}`;
    if (!composition.length) {
      out.layoutNoComposition.push({ unitId: u.Id, where, layout: layout.Label, source, activeRooms: active.length });
      bump(u, "outOfSync");
      continue;
    }

    const want = new Map(composition.map((c) => [c.categoryId, c]));
    const catIds = new Set([...want.keys(), ...active.filter((r) => r.RoomCategoryId != null).map((r) => r.RoomCategoryId)]);
    const missingList = [];
    const removable = [];
    const blocked = [];
    for (const cid of catIds) {
      const qty = want.get(cid)?.quantity ?? 0;
      const alias = want.get(cid)?.alias ?? active.find((r) => r.RoomCategoryId === cid)?.RoomName ?? `category ${cid}`;
      const act = active.filter((r) => r.RoomCategoryId === cid);
      if (act.length < qty) {
        const reactivatable = unitRooms.filter((r) => !r.IsActive && r.RoomCategoryId === cid).length;
        missingList.push(`${alias} ${act.length}/${qty}${reactivatable ? ` (${Math.min(reactivatable, qty - act.length)} reactivatable)` : ""}`);
      } else if (act.length > qty) {
        let excess = act.length - qty;
        const empty = act.filter((r) => !r.HasWork);
        const canRemove = Math.min(excess, empty.length);
        if (canRemove) removable.push(`${alias} -${canRemove} (${empty.slice(-canRemove).map((r) => r.RoomName).join(", ")})`);
        excess -= canRemove;
        if (excess) blocked.push(`${alias} +${excess} kept: has work (${act.filter((r) => r.HasWork).map((r) => r.RoomName).join(", ")})`);
      }
    }
    const uncategorized = active.filter((r) => r.RoomCategoryId == null);
    if (uncategorized.length) out.uncategorized.push({ unitId: u.Id, where, rooms: uncategorized.map((r) => r.RoomName).join(", ") });

    const expected = composition.reduce((s, c) => s + c.quantity, 0);
    const base = { unitId: u.Id, where, layout: layout.Label, source, activeRooms: active.length, expected };
    if (missingList.length) out.missingRooms.push({ ...base, missing: missingList.join("; ") });
    if (removable.length) out.surplusRemovable.push({ ...base, surplus: removable.join("; ") });
    if (blocked.length) out.surplusBlockedByWork.push({ ...base, blocked: blocked.join("; ") });
    bump(u, missingList.length || removable.length || blocked.length ? "outOfSync" : "inSync");
  }

  console.log("\n  Per project:");
  for (const p of [...perProject.values()].sort((a, b) => b.outOfSync - a.outOfSync)) {
    console.log(`    ${String(p.project).padEnd(28)} units ${String(p.units).padStart(5)}   in sync ${String(p.inSync).padStart(5)}   OUT OF SYNC ${String(p.outOfSync).padStart(5)}`);
  }
  sec.perProject = [...perProject.values()];
  console.log("");
  record(sec, "Units MISSING rooms their layout requires  [fix: Room Master > Generate]", out.missingRooms);
  record(sec, "Units with SURPLUS empty rooms beyond their layout  [fix: Room Master > Generate]", out.surplusRemovable);
  record(sec, "Units with surplus rooms that HAVE WORK (Generate keeps them; needs a human decision)", out.surplusBlockedByWork);
  record(sec, "Flats with NO layout type (no rooms can be generated)", out.flatNoLayout);
  record(sec, "Units whose layout has NO composition defined", out.layoutNoComposition);
  record(sec, "Active rooms with no category (never counted or synced — renamed/manual rooms)", out.uncategorized, { severity: "INFO" });
  record(sec, "Units typed by UnitType text only, not linked by LayoutTypeId", out.unitTypeTextOnly, { severity: "INFO" });
}

// ── 3. structure ──────────────────────────────────────────────────────────
async function checkStructure() {
  const sec = section("3. STRUCTURE — Project > Block > Floor > Unit > Room consistency");
  const floorOf = "CASE WHEN u.FloorNo = 0 THEN 'G' ELSE CAST(u.FloorNo AS NVARCHAR(10)) END";
  await check(sec, "Unit's ProjectId differs from its Block's", [["UnitMaster"], ["BlockMaster"]],
    `SELECT u.Id, u.UnitName, u.ProjectId, b.ProjectId AS BlockProjectId FROM dbo.UnitMaster u JOIN dbo.BlockMaster b ON b.Id = u.BlockId WHERE u.ProjectId <> b.ProjectId ${projectFilter("u.ProjectId")}`);
  await check(sec, "Active unit inside an inactive block", [["UnitMaster"], ["BlockMaster"]],
    `SELECT u.Id, u.UnitName, b.BlockName FROM dbo.UnitMaster u JOIN dbo.BlockMaster b ON b.Id = u.BlockId WHERE u.IsActive = 1 AND b.IsActive = 0 ${projectFilter("u.ProjectId")}`);
  await check(sec, "Room's Project/Block/Floor differs from its Unit's", [["RoomMaster", "Floor"]],
    `SELECT r.Id, r.RoomName, r.UnitId, r.Floor AS RoomFloor, ${floorOf} AS UnitFloor FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId
     WHERE (r.ProjectId <> u.ProjectId OR r.BlockId <> u.BlockId OR ISNULL(r.Floor,'~') <> ISNULL(${floorOf},'~')) ${projectFilter("u.ProjectId")}`);
  await check(sec, "Active room on an inactive unit", [["RoomMaster"]],
    `SELECT r.Id, r.RoomName, r.UnitId FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId WHERE r.IsActive = 1 AND u.IsActive = 0 ${projectFilter("u.ProjectId")}`);
  await check(sec, "Active room whose category is inactive", [["RoomMaster", "RoomCategoryId"]],
    `SELECT r.Id, r.RoomName, c.Alias FROM dbo.RoomMaster r JOIN dbo.RoomCategoryMaster c ON c.Id = r.RoomCategoryId WHERE r.IsActive = 1 AND c.IsActive = 0 ${projectFilter("r.ProjectId")}`);
  await check(sec, "Active unit with no active floor row (hidden from the Room Master tree)", [["CrmProjectAutoSetupFloor"]],
    `SELECT u.Id, u.UnitName, u.BlockId, u.FloorNo FROM dbo.UnitMaster u JOIN dbo.BlockMaster b ON b.Id = u.BlockId AND b.IsActive = 1
     WHERE u.IsActive = 1 ${projectFilter("u.ProjectId")} AND NOT EXISTS (SELECT 1 FROM dbo.CrmProjectAutoSetupFloor f WHERE f.BlockId = u.BlockId AND f.IsActive = 1
       AND ((f.FloorNo = -1 AND u.FloorNo IS NULL) OR (f.FloorNo <> -1 AND f.FloorNo = u.FloorNo)))`);
  await check(sec, "Duplicate active floor rows (same Block + FloorNo)", [["CrmProjectAutoSetupFloor"]],
    `SELECT BlockId, FloorNo, COUNT(*) AS n FROM dbo.CrmProjectAutoSetupFloor WHERE IsActive = 1 ${projectFilter("ProjectId")} GROUP BY BlockId, FloorNo HAVING COUNT(*) > 1`);
  await check(sec, "Unit / Room / Block pointing at a missing project", [["enterprise"]],
    `SELECT 'Block' AS T, Id, ProjectId FROM dbo.BlockMaster x WHERE NOT EXISTS (SELECT 1 FROM dbo.enterprise e WHERE e.id = x.ProjectId)
     UNION ALL SELECT 'Unit', Id, ProjectId FROM dbo.UnitMaster x WHERE NOT EXISTS (SELECT 1 FROM dbo.enterprise e WHERE e.id = x.ProjectId)
     UNION ALL SELECT 'Room', Id, ProjectId FROM dbo.RoomMaster x WHERE NOT EXISTS (SELECT 1 FROM dbo.enterprise e WHERE e.id = x.ProjectId)`);
  await check(sec, "Discontinued project that still has active units/rooms (hidden from add/generate pickers)", [["enterprise", "discontinue"]],
    `SELECT e.id, e.name, COUNT(DISTINCT u.Id) AS ActiveUnits FROM dbo.enterprise e JOIN dbo.UnitMaster u ON u.ProjectId = e.id AND u.IsActive = 1
     WHERE e.business_type = 'P' AND ISNULL(e.discontinue,0) = 1 ${projectFilter("e.id")} GROUP BY e.id, e.name`, { severity: "INFO" });
}

// ── 4. layout config ──────────────────────────────────────────────────────
async function checkLayouts() {
  const sec = section("4. LAYOUT CONFIG — types, compositions, overrides");
  await check(sec, "Active unit linked to an inactive layout type", [["UnitMaster", "LayoutTypeId"]],
    `SELECT u.Id, u.UnitName, t.Label FROM dbo.UnitMaster u JOIN dbo.RoomLayoutType t ON t.Id = u.LayoutTypeId WHERE u.IsActive = 1 AND t.IsActive = 0 ${projectFilter("u.ProjectId")}`);
  await check(sec, "Unit's UnitType text disagrees with its linked layout label", [["UnitMaster", "LayoutTypeId"]],
    `SELECT u.Id, u.UnitName, u.UnitType, t.Label FROM dbo.UnitMaster u JOIN dbo.RoomLayoutType t ON t.Id = u.LayoutTypeId
     WHERE u.IsActive = 1 AND REPLACE(UPPER(ISNULL(u.UnitType,'')),' ','') <> REPLACE(UPPER(t.Label),' ','') ${projectFilter("u.ProjectId")}`, { severity: "INFO" });
  await check(sec, "Layout type in use with 0 or >1 active compositions", [["UnitRoomConfig", "LayoutTypeId"]],
    `SELECT t.Id, t.Label, (SELECT COUNT(*) FROM dbo.UnitRoomConfig c WHERE c.LayoutTypeId = t.Id AND c.IsActive = 1) AS ActiveConfigs FROM dbo.RoomLayoutType t
     WHERE t.IsActive = 1 AND EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE u.LayoutTypeId = t.Id AND u.IsActive = 1)
       AND (SELECT COUNT(*) FROM dbo.UnitRoomConfig c WHERE c.LayoutTypeId = t.Id AND c.IsActive = 1) <> 1`);
  await check(sec, "Composition line using an inactive room category", [["RoomComposition"]],
    `SELECT rc.Id, cfg.BhkType, c.Alias FROM dbo.RoomComposition rc JOIN dbo.UnitRoomConfig cfg ON cfg.Id = rc.UnitRoomConfigId AND cfg.IsActive = 1
     JOIN dbo.RoomCategoryMaster c ON c.Id = rc.RoomCategoryId WHERE c.IsActive = 0 AND rc.Quantity > 0`);
  await check(sec, "Override scope inconsistent, or on an inactive unit", [["RoomLayoutOverride"]],
    `SELECT o.Id, o.ScopeLevel, o.ProjectId, o.BlockId, o.UnitId FROM dbo.RoomLayoutOverride o
     LEFT JOIN dbo.UnitMaster u ON u.Id = o.UnitId LEFT JOIN dbo.BlockMaster b ON b.Id = o.BlockId
     WHERE o.IsActive = 1 ${projectFilter("o.ProjectId")} AND ((o.UnitId IS NOT NULL AND (u.IsActive = 0 OR u.ProjectId <> o.ProjectId OR (o.BlockId IS NOT NULL AND u.BlockId <> o.BlockId)))
        OR (o.BlockId IS NOT NULL AND b.ProjectId <> o.ProjectId))`);
  await check(sec, "Unit-level override for a layout the unit no longer uses (dead override)", [["RoomLayoutOverride"]],
    `SELECT o.Id, o.UnitId, o.LayoutTypeId, u.LayoutTypeId AS UnitLayoutTypeId FROM dbo.RoomLayoutOverride o JOIN dbo.UnitMaster u ON u.Id = o.UnitId
     WHERE o.IsActive = 1 AND o.ScopeLevel = 'UNIT' AND ISNULL(u.LayoutTypeId,-1) <> o.LayoutTypeId ${projectFilter("o.ProjectId")}`);
}

// ── 5. dependency chains + work allocation ───────────────────────────────
async function checkWorkflow() {
  const sec = section("5. DEPENDENCY CHAINS + WORK ALLOCATION");
  await check(sec, "Chain's Room/Flat/Tower/Floor/Project don't line up", [["DependencyMaster"]],
    `SELECT d.Id, d.Alias, d.TowerId, d.Floor, d.FlatId, d.RoomId FROM dbo.DependencyMaster d
     LEFT JOIN dbo.RoomMaster r ON r.Id = d.RoomId LEFT JOIN dbo.UnitMaster u ON u.Id = d.FlatId LEFT JOIN dbo.BlockMaster b ON b.Id = d.TowerId
     WHERE ((d.RoomId IS NOT NULL AND (r.UnitId <> d.FlatId OR ISNULL(r.Floor,'~') <> ISNULL(d.Floor,'~')))
        OR (d.FlatId IS NOT NULL AND (u.BlockId <> d.TowerId OR u.ProjectId <> d.ProjectId))
        OR (d.TowerId IS NOT NULL AND b.ProjectId <> d.ProjectId)) ${projectFilter("d.ProjectId")}`);
  await check(sec, "Active chain on an inactive room / flat / tower", [["DependencyMaster"]],
    `SELECT d.Id, d.Alias, r.IsActive AS RoomActive, u.IsActive AS FlatActive, b.IsActive AS TowerActive FROM dbo.DependencyMaster d
     LEFT JOIN dbo.RoomMaster r ON r.Id = d.RoomId LEFT JOIN dbo.UnitMaster u ON u.Id = d.FlatId LEFT JOIN dbo.BlockMaster b ON b.Id = d.TowerId
     WHERE d.IsActive = 1 AND (r.IsActive = 0 OR u.IsActive = 0 OR b.IsActive = 0) ${projectFilter("d.ProjectId")}`);
  await check(sec, "Chain step on an inactive activity", [["DependencyMasterActivity"], ["ActivityMaster", "is_active"]],
    `SELECT dma.Id, dma.DependencyMasterId, a.activity_name FROM dbo.DependencyMasterActivity dma JOIN dbo.ActivityMaster a ON a.id = dma.ActivityId
     JOIN dbo.DependencyMaster d ON d.Id = dma.DependencyMasterId WHERE a.is_active = 0 AND d.IsActive = 1 ${projectFilter("d.ProjectId")}`);
  await check(sec, "Duplicate step number inside one chain", [["DependencyMasterActivity", "SequenceNo"]],
    `SELECT DependencyMasterId, SequenceNo, COUNT(*) AS n FROM dbo.DependencyMasterActivity GROUP BY DependencyMasterId, SequenceNo HAVING COUNT(*) > 1`);

  const cur = hasCol("DependencyActivityAssignment", "IsCurrent") ? "a.IsCurrent = 1 AND" : "";
  const byProj = ONLY_PROJECT ? `AND EXISTS (SELECT 1 FROM dbo.DependencyMasterActivity x JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId WHERE x.Id = a.DependencyMasterActivityId AND d.ProjectId = ${ONLY_PROJECT})` : "";
  await check(sec, "Step with more than one current attempt", [["DependencyActivityAssignment", "IsCurrent"]],
    `SELECT a.DependencyMasterActivityId AS StepId, COUNT(*) AS CurrentAttempts FROM dbo.DependencyActivityAssignment a WHERE a.IsCurrent = 1 ${byProj} GROUP BY a.DependencyMasterActivityId HAVING COUNT(*) > 1`);
  await check(sec, "Step with attempts but none current", [["DependencyActivityAssignment", "IsCurrent"]],
    `SELECT a.DependencyMasterActivityId AS StepId FROM dbo.DependencyActivityAssignment a WHERE 1 = 1 ${byProj} GROUP BY a.DependencyMasterActivityId HAVING SUM(CASE WHEN a.IsCurrent = 1 THEN 1 ELSE 0 END) = 0`);
  await check(sec, "Pre-rework-fork data: more than one attempt but no IsCurrent column (code/DB mismatch)", [["DependencyActivityAssignment"]],
    hasCol("DependencyActivityAssignment", "IsCurrent")
      ? "SELECT TOP 0 1 AS x"
      : `SELECT DependencyMasterActivityId AS StepId, COUNT(*) AS Attempts FROM dbo.DependencyActivityAssignment GROUP BY DependencyMasterActivityId HAVING COUNT(*) > 1`);
  await check(sec, "COMPLETED/APPROVED but progress below 100%", [["DependencyActivityAssignment", "ProgressPercent"]],
    `SELECT a.Id, a.Status, a.ProgressPercent FROM dbo.DependencyActivityAssignment a WHERE ${cur} a.Status IN ('COMPLETED','APPROVED') AND ISNULL(a.ProgressPercent,0) < 100 ${byProj}`);
  await check(sec, "In Progress at 100% (never auto-completed, so never reaches QC)", [["DependencyActivityAssignment", "ProgressPercent"]],
    `SELECT a.Id, a.Status, a.ProgressPercent FROM dbo.DependencyActivityAssignment a WHERE ${cur} a.Status = 'IN_PROGRESS' AND a.ProgressPercent = 100 ${byProj}`);
  await check(sec, "Latest QC passed but activity not Completed/Approved", [["DependencyActivityQc"]],
    `SELECT a.Id, a.Status, q.Decision FROM dbo.DependencyActivityAssignment a
     CROSS APPLY (SELECT TOP 1 Decision FROM dbo.DependencyActivityQc WHERE AssignmentId = a.Id ORDER BY QcAt DESC, Id DESC) q
     WHERE ${cur} q.Decision = 'APPROVED' AND a.Status NOT IN ('COMPLETED','APPROVED') ${byProj}`);
  await check(sec, "QC result row pointing at another attempt's checkpoint", [["DependencyActivityQcCheck", "AssignmentCheckpointId"]],
    `SELECT qc.Id, qc.QcId, qc.AssignmentCheckpointId FROM dbo.DependencyActivityQcCheck qc JOIN dbo.DependencyActivityQc q ON q.Id = qc.QcId
     LEFT JOIN dbo.DependencyActivityCheckpoint c ON c.Id = qc.AssignmentCheckpointId
     WHERE qc.AssignmentCheckpointId IS NOT NULL AND (c.Id IS NULL OR c.AssignmentId <> q.AssignmentId)`);
  await check(sec, "Inactive chain that still has live (Pending/In Progress) work", [["DependencyActivityAssignment"]],
    `SELECT d.Id, d.Alias, COUNT(a.Id) AS LiveAttempts FROM dbo.DependencyMaster d JOIN dbo.DependencyMasterActivity dma ON dma.DependencyMasterId = d.Id
     JOIN dbo.DependencyActivityAssignment a ON a.DependencyMasterActivityId = dma.Id AND ${cur} a.Status IN ('PENDING','IN_PROGRESS')
     WHERE d.IsActive = 0 ${projectFilter("d.ProjectId")} GROUP BY d.Id, d.Alias`);
}

async function main() {
  await connectDB();
  pool = getPool();
  report.database = (await q("SELECT DB_NAME() AS db, @@SERVERNAME AS server"))[0];
  console.log(`Civil Work DPR sync check — READ-ONLY — ${report.database.server}/${report.database.db}${ONLY_PROJECT ? ` — project ${ONLY_PROJECT}` : " — all projects"}`);
  await loadSchema();
  await checkMigrations();
  await checkRoomSync();
  await checkStructure();
  await checkLayouts();
  await checkWorkflow();
  report.summary = { failingChecks: failCount, skippedChecks: skipCount };
  console.log(`\n${"═".repeat(78)}\nRESULT: ${failCount} failing check(s), ${skipCount} skipped. Nothing was changed.`);
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log(`Full report written to ${JSON_OUT}`); }
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("checkDprSync failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
