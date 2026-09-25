"use strict";
/**
 * End-to-end HTTP test of CRM Auto Setup -> Generate Units -> Flat Master
 * rooms (and Unit Master / Unit Composition / bulk generate / unit delete),
 * through the REAL route files mounted on a local express app. Only the JWT
 * check is swapped for the given user; page-rights and role middleware still
 * run.
 *
 * Unlike verifyUnitLayoutSync.js this one COMMITS real rows — it creates a
 * throwaway block "ZZ-E2E-477" (plus two throwaway layout types) in the given
 * project and deletes all of it again at the end (through the real delete
 * APIs, then a SQL safety net scoped strictly to that block / those types).
 * Real layout compositions are never modified.
 *
 * Run: node backend/scripts/e2eUnitLayoutFlow.js --project <projectId> --user <adminUserId>
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const PROJECT_ID = arg("project");
const USER_ID = arg("user");
if (!Number.isFinite(PROJECT_ID) || !Number.isFinite(USER_ID)) {
  console.error("Usage: node backend/scripts/e2eUnitLayoutFlow.js --project <projectId> --user <adminUserId>");
  process.exit(2);
}
const ADMIN = { userId: USER_ID, id: USER_ID, role: "admin" };
const authPath = require.resolve(path.join(BACKEND, "middleware/auth"));
const authStub = (req, _res, next) => { req.user = { ...ADMIN }; next(); };
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };

const express = require("express");
const { connectDB, sql } = require(path.join(BACKEND, "db"));

const BLOCK_NAME = "ZZ-E2E-477";
const TEMP_TYPE = "ZZ E2E Layout";
const EMPTY_TYPE = "ZZ E2E Empty";
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); }
};

(async () => {
  const pool = await connectDB();
  const q = async (text, inputs = {}) => {
    const r = pool.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => { req.user = { ...ADMIN }; next(); }); // what the global authMiddleware sets
  app.use("/api/crm/project-auto-setup", require(path.join(BACKEND, "routes/crmProjectAutoSetup")));
  app.use("/api/unit-master", require(path.join(BACKEND, "routes/unitMaster")));
  app.use("/api/room-master", require(path.join(BACKEND, "routes/roomMaster")));
  app.use("/api/unit-bhk-config", require(path.join(BACKEND, "routes/unitBhkConfig")));
  app.use("/api/unit-layout-overrides", require(path.join(BACKEND, "routes/unitLayoutOverride")));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };

  let blockId = null;
  let tempTypeId = null;
  let emptyTypeId = null;
  const roomsOf = async (unitId) => q("SELECT Id, RoomName, IsActive, RoomCategoryId, Floor FROM dbo.RoomMaster WHERE UnitId = @u ORDER BY RoomName", { u: [sql.Int, unitId] });

  try {
    // Pre-clean any leftovers from an interrupted earlier run.
    const stale = await q("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @p AND BlockName = @n", { p: [sql.Int, PROJECT_ID], n: [sql.NVarChar(100), BLOCK_NAME] });
    if (stale.length) throw new Error(`Block ${BLOCK_NAME} already exists (Id ${stale[0].Id}) — clean it up first`);

    // ── A. Layout types as the CRM dropdown sees them ─────────────────
    console.log("\n[A] Unit Type list (CRM dropdown source)");
    const types = await call("GET", "/api/unit-bhk-config/types");
    const byLabel = Object.fromEntries(types.data.map((t) => [t.label, t]));
    check("GET /types 200", types.status === 200);
    check("2 BHK / 3 BHK pickable with summary", byLabel["2 BHK"]?.roomCount > 0 && byLabel["3 BHK"]?.summary.length > 0, types.data);
    const t2 = byLabel["2 BHK"], t3 = byLabel["3 BHK"];
    const et = await call("POST", "/api/unit-bhk-config/types", { label: EMPTY_TYPE });
    emptyTypeId = et.data?.id;
    const types1 = await call("GET", "/api/unit-bhk-config/types");
    check("a newly added type with no rooms is listed with roomCount 0", types1.data.find((t) => t.id === emptyTypeId)?.roomCount === 0);

    // ── B. Auto Setup: block + floors ──────────────────────────────────
    console.log("\n[B] Auto Setup: block + floors");
    const blk = await call("POST", "/api/crm/project-auto-setup/blocks", { ProjectId: PROJECT_ID, Names: [BLOCK_NAME] });
    blockId = blk.data?.blocks?.[0]?.Id;
    check("block created", blk.status === 201 && blockId, blk);
    const fl = await call("POST", "/api/crm/project-auto-setup/floors", { ProjectId: PROJECT_ID, Blocks: [{ BlockId: blockId, FloorCount: 4 }] });
    const myFloors = (fl.data?.floors || []).filter((f) => f.BlockId === blockId);
    check("4 floors created (G,1,2,3)", fl.status === 201 && myFloors.length === 4, fl.status);
    const f1 = myFloors.find((f) => f.FloorNo === 1), f2 = myFloors.find((f) => f.FloorNo === 2), f3 = myFloors.find((f) => f.FloorNo === 3);

    // ── C. Unit Type template validation ───────────────────────────────
    console.log("\n[C] Unit Type template");
    let r = await call("PUT", `/api/crm/project-auto-setup/blocks/${blockId}/unit-template`, { Items: [{ UnitType: "1.5 BHK", Count: 1 }] });
    check("unregistered '1.5 BHK' rejected 400", r.status === 400, r.data);
    r = await call("PUT", `/api/crm/project-auto-setup/blocks/${blockId}/unit-template`, { Items: [{ UnitType: EMPTY_TYPE, Count: 1 }] });
    check("type with no layout rejected 400", r.status === 400 && /no rooms defined/.test(r.data?.error), r.data);
    r = await call("PUT", `/api/crm/project-auto-setup/blocks/${blockId}/unit-template`, {
      Items: [
        { UnitType: "2bhk", Count: 2, SuperBuiltUpAreaSqFt: 1000, RatePerSqFt: 5000 },
        { UnitType: "3 BHK", Count: 1, SuperBuiltUpAreaSqFt: 1400, RatePerSqFt: 5000 },
      ],
    });
    check("template saved", r.status === 200 && r.data?.total === 3, r.data);
    const tpl = await q("SELECT UnitType, LayoutTypeId FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE BlockId = @b AND IsActive = 1 ORDER BY SortOrder", { b: [sql.Int, blockId] });
    check("template rows linked + '2bhk' canonicalized to '2 BHK'", tpl[0].UnitType === "2 BHK" && tpl[0].LayoutTypeId === t2.id && tpl[1].LayoutTypeId === t3.id, tpl);
    const spec = await q("SELECT UnitType, LayoutTypeId FROM dbo.BlockUnitTypeSpec WHERE BlockId = @b ORDER BY UnitType", { b: [sql.Int, blockId] });
    check("block specs written with LayoutTypeId", spec.length === 2 && spec.every((s) => s.LayoutTypeId), spec);
    const getTpl = await call("GET", `/api/crm/project-auto-setup/blocks/${blockId}/unit-template`);
    check("GET template returns LayoutTypeId", getTpl.data?.items?.[0]?.LayoutTypeId === t2.id);

    for (const f of [f1, f2]) {
      r = await call("PUT", `/api/crm/project-auto-setup/floors/${f.Id}`, { UnitCount: 3 });
      check(`floor ${f.FloorLabel} unit count = 3`, r.status === 200, r.data);
    }

    // ── D. Warm Flat Master caches, then Generate Units ────────────────
    console.log("\n[D] Generate Units -> rooms in Flat Master");
    const before = await call("GET", `/api/room-master/units?projectId=${PROJECT_ID}`);
    const structBefore = await call("GET", `/api/room-master/structure?projectId=${PROJECT_ID}`);
    check("Flat Master caches warmed (no test units yet)", before.data.every((u) => u.BlockId !== blockId) && structBefore.status === 200);

    const gen = await call("POST", "/api/crm/project-auto-setup/generate-units", { ProjectId: PROJECT_ID, FloorIds: [f1.Id, f2.Id] });
    const expectRooms = 2 * (2 * t2.roomCount + t3.roomCount);
    console.log(`   response: created ${gen.data?.createdCount}, rooms ${gen.data?.roomsCreated}, sample ${gen.data?.sample?.slice(0, 3)}`);
    check("6 units generated", gen.status === 201 && gen.data.createdCount === 6, gen.data);
    check(`${expectRooms} rooms built (2×(2×${t2.roomCount} + ${t3.roomCount}))`, gen.data.roomsCreated === expectRooms, gen.data);
    check("no units without rooms", Array.isArray(gen.data.unitsWithoutRooms) && gen.data.unitsWithoutRooms.length === 0, gen.data.unitsWithoutRooms);

    const units = await q("SELECT Id, UnitName, FloorNo, UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE BlockId = @b AND IsActive = 1 ORDER BY FloorNo, UnitName", { b: [sql.Int, blockId] });
    check("units carry UnitType + LayoutTypeId from template",
      units.length === 6 && units.every((u, i) => (i % 3 < 2 ? u.LayoutTypeId === t2.id && u.UnitType === "2 BHK" : u.LayoutTypeId === t3.id && u.UnitType === "3 BHK")), units);
    for (const u of units) {
      const rooms = await roomsOf(u.Id);
      const want = u.LayoutTypeId === t2.id ? t2.roomCount : t3.roomCount;
      const okFloor = rooms.every((x) => x.Floor === String(u.FloorNo));
      if (rooms.length !== want || !okFloor || rooms.some((x) => !x.RoomCategoryId || !x.IsActive)) {
        check(`unit ${u.UnitName} rooms`, false, rooms);
      }
    }
    check("every unit: exact room count, active, categorized, correct floor label", true);
    const sampleRooms = (await roomsOf(units[0].Id)).map((x) => x.RoomName);
    console.log(`   ${units[0].UnitName}: ${sampleRooms.join(", ")}`);

    // Flat Master reads — immediately, through its caches
    const after = await call("GET", `/api/room-master/units?projectId=${PROJECT_ID}`);
    check("Flat Master /units shows the new units immediately (cache refreshed)", after.data.filter((u) => u.BlockId === blockId).length === 6);
    const structAfter = await call("GET", `/api/room-master/structure?projectId=${PROJECT_ID}`);
    const sFloors = structAfter.data.floors.filter((f) => f.BlockId === blockId);
    check("Flat Master /structure shows the block + floors with 3 units each immediately",
      structAfter.data.blocks.some((b) => b.Id === blockId) && sFloors.find((f) => f.FloorNo === 1)?.UnitCount === 3 && sFloors.find((f) => f.FloorNo === 2)?.UnitCount === 3, sFloors);
    const allRooms = await call("GET", `/api/room-master?unitId=${units[0].Id}&activeOnly=1`);
    check("Flat Master room list returns the unit's rooms", allRooms.data.length === t2.roomCount);
    const fu = await call("GET", `/api/room-master/floor-units/${f1.Id}`);
    check("floor badge: generated == template room count for every unit", fu.data.units.length === 3 && fu.data.units.every((u) => u.GeneratedRoomCount === u.TemplateRoomCount), fu.data.units);
    const ur = await call("GET", `/api/room-master/unit-rooms/${units[0].Id}`);
    check("unit-rooms preview: template from layout + existing rooms", ur.data.template.reduce((s, x) => s + x.quantity, 0) === t2.roomCount && ur.data.existing.length === t2.roomCount);
    const inst = await call("GET", `/api/unit-bhk-config/room-instances/${units[0].Id}`);
    check("Work Reporting room instances all map to real RoomMaster ids", inst.data.length === t2.roomCount && inst.data.every((i) => i.roomMasterId), inst.data);

    // ── E. Idempotency ──────────────────────────────────────────────────
    console.log("\n[E] Re-run generate");
    const regen = await call("POST", "/api/crm/project-auto-setup/generate-units", { ProjectId: PROJECT_ID, FloorIds: [f1.Id, f2.Id] });
    const roomTotal = (await q("SELECT COUNT(*) c FROM dbo.RoomMaster WHERE BlockId = @b", { b: [sql.Int, blockId] }))[0].c;
    check("no new units, no duplicate rooms", regen.status === 201 && regen.data.createdCount === 0 && roomTotal === expectRooms, { regen: regen.data, roomTotal });
    const single = await call("POST", `/api/room-master/generate/${units[0].Id}`);
    check("per-unit 'Create Rooms' says all exist", single.status === 200 && single.data.createdCount === 0, single.data);

    // A legacy template row whose type has no layout (only possible for rows
    // saved before this change) -> units are still generated, but the
    // response says which got no rooms so the CRM page can warn.
    console.log("\n[E2] Generate with a type that has no layout");
    await q("UPDATE dbo.CrmProjectAutoSetupUnitTemplate SET UnitType = @t, LayoutTypeId = @id WHERE BlockId = @b AND IsActive = 1",
      { t: [sql.NVarChar(50), EMPTY_TYPE], id: [sql.Int, emptyTypeId], b: [sql.Int, blockId] });
    r = await call("PUT", `/api/crm/project-auto-setup/floors/${f3.Id}`, { UnitCount: 2 });
    const gen3 = await call("POST", "/api/crm/project-auto-setup/generate-units", { ProjectId: PROJECT_ID, FloorIds: [f3.Id] });
    console.log(`   response: ${JSON.stringify({ created: gen3.data?.createdCount, rooms: gen3.data?.roomsCreated, without: gen3.data?.unitsWithoutRooms })}`);
    check("2 units still generated, 0 rooms", gen3.status === 201 && gen3.data.createdCount === 2 && gen3.data.roomsCreated === 0, gen3.data);
    check("unitsWithoutRooms reports 2 × that type", JSON.stringify(gen3.data.unitsWithoutRooms) === JSON.stringify([{ unitType: EMPTY_TYPE, count: 2 }]), gen3.data.unitsWithoutRooms);

    // ── F. Unit Master edit: type change 2 BHK -> 3 BHK ───────────────
    console.log("\n[F] Unit Master type change");
    const u0 = units[0];
    const body = (over) => ({ ProjectId: PROJECT_ID, BlockId: blockId, UnitName: u0.UnitName, FloorNo: u0.FloorNo, UnitType: "2 BHK", PaymentPlanIds: [], IsActive: true, ...over });
    r = await call("PUT", `/api/unit-master/${u0.Id}`, body({ UnitType: EMPTY_TYPE }));
    check("change to a type with no layout rejected 400", r.status === 400, r.data);
    r = await call("PUT", `/api/unit-master/${u0.Id}`, body({ RatePerSqFt: 5100 }));
    check("edit without type change: no room sync", r.status === 200 && r.data.roomSync === null, r.data);
    r = await call("PUT", `/api/unit-master/${u0.Id}`, body({ UnitType: "3 BHK" }));
    console.log(`   roomSync: ${JSON.stringify(r.data?.roomSync)}`);
    const active = (await roomsOf(u0.Id)).filter((x) => x.IsActive);
    check("type -> 3 BHK: rooms now match 3 BHK layout", r.status === 200 && active.length === t3.roomCount, { status: r.status, data: r.data, active: active.length });
    const dbU0 = (await q("SELECT UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, u0.Id] }))[0];
    check("unit row updated (UnitType + LayoutTypeId)", dbU0.UnitType === "3 BHK" && dbU0.LayoutTypeId === t3.id, dbU0);

    // ── G. Flat Master manual edits keep categories ───────────────────
    console.log("\n[G] Flat Master manual room edits");
    const kitchen = active.find((x) => /^Kitchen/.test(x.RoomName));
    r = await call("PUT", `/api/room-master/${kitchen.Id}`, { ProjectId: PROJECT_ID, UnitId: u0.Id, RoomName: "Modular Kitchen", IsActive: true });
    const k2 = (await roomsOf(u0.Id)).find((x) => x.Id === kitchen.Id);
    check("rename without RoomCategoryId keeps the category", r.status === 200 && k2.RoomCategoryId === kitchen.RoomCategoryId, k2);
    const sync2 = await call("POST", `/api/room-master/generate/${u0.Id}`);
    check("…and a later sync adds no duplicate kitchen", sync2.data.createdCount === 0, sync2.data);
    r = await call("POST", "/api/room-master", { ProjectId: PROJECT_ID, UnitId: u0.Id, RoomName: "Bedroom 9", IsActive: true });
    const b9 = (await q("SELECT r.RoomCategoryId, c.CategoryName FROM dbo.RoomMaster r JOIN dbo.RoomCategoryMaster c ON c.Id = r.RoomCategoryId WHERE r.Id = @id", { id: [sql.Int, r.data.id] }))[0];
    check("manual 'Bedroom 9' gets category BEDROOM", b9?.CategoryName === "BEDROOM", b9);
    r = await call("POST", "/api/room-master", { ProjectId: PROJECT_ID, UnitId: u0.Id, RoomName: "Pooja Room", IsActive: true });
    check("manual custom 'Pooja Room' stays uncategorized", (await q("SELECT RoomCategoryId FROM dbo.RoomMaster WHERE Id = @id", { id: [sql.Int, r.data.id] }))[0].RoomCategoryId === null);

    // ── H. Unit Composition edit propagates (temp layout type) ─────────
    console.log("\n[H] Unit Composition edit propagation (temporary layout type)");
    const nt = await call("POST", "/api/unit-bhk-config/types", { label: TEMP_TYPE });
    tempTypeId = nt.data?.id;
    check("temp layout type registered", nt.status === 201 && tempTypeId, nt.data);
    const cats = await q("SELECT Id, CategoryName FROM dbo.RoomCategoryMaster WHERE IsActive = 1");
    const catId = (n) => cats.find((c) => c.CategoryName === n).Id;
    const comp = (bed) => ({ composition: cats.map((c) => ({ roomCategoryId: c.Id, quantity: c.CategoryName === "BEDROOM" ? bed : c.CategoryName === "KITCHEN" ? 1 : 0 })) });
    r = await call("POST", `/api/unit-bhk-config/template/${encodeURIComponent(TEMP_TYPE)}`, comp(1));
    check("temp layout composition saved (1 Bedroom + 1 Kitchen)", r.status === 200, r.data);
    const u1 = units[1];
    r = await call("PUT", `/api/unit-master/${u1.Id}`, { ProjectId: PROJECT_ID, BlockId: blockId, UnitName: u1.UnitName, FloorNo: u1.FloorNo, UnitType: TEMP_TYPE, PaymentPlanIds: [], IsActive: true });
    let u1Active = (await roomsOf(u1.Id)).filter((x) => x.IsActive).map((x) => x.RoomName).sort();
    check("unit switched to temp layout -> exactly Bedroom + Kitchen", r.status === 200 && u1Active.join() === "Bedroom,Kitchen", { r: r.data, u1Active });
    r = await call("POST", `/api/unit-bhk-config/template/${encodeURIComponent(TEMP_TYPE)}`, comp(2));
    u1Active = (await roomsOf(u1.Id)).filter((x) => x.IsActive).map((x) => x.RoomName).sort();
    check("layout edit (Bedroom 1->2) propagated: 1 unit updated, 1 room added", r.data?.roomSync?.unitsUpdated === 1 && r.data?.roomSync?.roomsAdded === 1, r.data);
    check("unit now Bedroom 1, Bedroom 2, Kitchen", u1Active.join() === "Bedroom 1,Bedroom 2,Kitchen", u1Active);
    const types2 = await call("GET", "/api/unit-bhk-config/types");
    check("CRM dropdown now offers the temp type with its summary", types2.data.find((t) => t.id === tempTypeId)?.summary === "2 Bedroom · 1 Kitchen", types2.data.find((t) => t.id === tempTypeId));

    // ── I. Flat Master bulk generate ────────────────────────────────────
    console.log("\n[I] Flat Master bulk generate");
    const u2 = units[2];
    await q("DELETE FROM dbo.RoomMaster WHERE UnitId = @u", { u: [sql.Int, u2.Id] });
    r = await call("POST", "/api/room-master/generate-bulk", { ProjectId: PROJECT_ID, BlockId: blockId });
    console.log(`   ${r.data?.message}`);
    check("bulk rebuilt only the unit that had no rooms (renamed nothing elsewhere)", r.status === 200 && r.data.unitsUpdated === 1 && r.data.roomsAdded === t3.roomCount, r.data);
    check("bulk reports the 2 no-layout units as skipped", r.data.skippedNoLayout === 2, r.data);
    const u0Names = (await roomsOf(units[0].Id)).filter((x) => x.IsActive).map((x) => x.RoomName);
    check("hand-added 'Bedroom 9' untouched by the bulk run", u0Names.includes("Bedroom 9"), u0Names);
    r = await call("POST", "/api/room-master/generate-bulk", { ProjectId: PROJECT_ID, BlockId: blockId });
    check("bulk again = no-op", r.data.roomsAdded === 0, r.data);

    // ── J. Unit delete ─────────────────────────────────────────────────
    console.log("\n[J] Unit delete");
    const u3 = units[3];
    const someRoom = (await roomsOf(u3.Id))[0];
    await q("UPDATE dbo.RoomMaster SET BlueprintFileName = 'e2e.pdf', BlueprintMimeType = 'application/pdf', BlueprintFileData = 'eA==' WHERE Id = @id", { id: [sql.Int, someRoom.Id] });
    r = await call("DELETE", `/api/unit-master/${u3.Id}`);
    check("delete refused (409) while a room has a blueprint", r.status === 409 && /DPR work/.test(r.data?.error), r.data);
    check("unit + rooms untouched after refusal", (await roomsOf(u3.Id)).length > 0 && (await q("SELECT 1 x FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, u3.Id] })).length === 1);
    await q("UPDATE dbo.RoomMaster SET BlueprintFileName = NULL, BlueprintMimeType = NULL, BlueprintFileData = NULL WHERE Id = @id", { id: [sql.Int, someRoom.Id] });
    r = await call("DELETE", `/api/unit-master/${u3.Id}`);
    check("delete succeeds once clean; rooms removed with it", r.status === 200 && (await roomsOf(u3.Id)).length === 0, r.data);
    const afterDel = await call("GET", `/api/room-master/units?projectId=${PROJECT_ID}`);
    check("Flat Master /units drops the deleted unit immediately", !afterDel.data.some((u) => u.Id === u3.Id));

    // ── K. Layout overrides (Flat Master tree "Layout" editor) ─────────
    console.log("\n[K] Layout overrides over HTTP");
    const catRows = await q("SELECT Id, CategoryName FROM dbo.RoomCategoryMaster WHERE IsActive = 1");
    const items = (m) => catRows.map((c) => ({ roomCategoryId: c.Id, quantity: m[c.CategoryName] || 0 }));
    const sumOf = (m) => Object.values(m).reduce((a, b) => a + b, 0);
    const u3s = await q("SELECT Id, FloorNo FROM dbo.UnitMaster WHERE BlockId = @b AND IsActive = 1 AND LayoutTypeId = @lt ORDER BY FloorNo, Id",
      { b: [sql.Int, blockId], lt: [sql.Int, t3.id] });
    check("block has 3 BHK units to test with", u3s.length >= 2, u3s);
    // layout rooms only — a hand-added custom room with no category (e.g.
    // [G]'s "Pooja Room") is never touched by the sync, by design
    const activeCount = async (id) => (await roomsOf(id)).filter((x) => x.IsActive && x.RoomCategoryId != null).length;
    const customLeft = async (id) => (await roomsOf(id)).filter((x) => x.IsActive && x.RoomCategoryId == null).map((x) => x.RoomName);
    const scopeB = { ScopeLevel: "BLOCK", ProjectId: PROJECT_ID, BlockId: blockId, LayoutTypeId: t3.id };
    const BK = { BEDROOM: 3, KITCHEN: 1, HALL_ROOM: 1, BATHROOM: 3 };
    let pv = await call("POST", "/api/unit-layout-overrides/preview", { ...scopeB, items: items(BK) });
    check("preview (block, 3 BHK) — all 3 BHK units in scope", pv.status === 200 && pv.data.unitsInScope === u3s.length && !pv.data.overlap, pv.data);
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeB, items: items(BK) });
    check("save block override: rooms added/removed exactly as previewed", r.status === 200 && r.data.roomsAdded === pv.data.roomsToAdd && r.data.roomsRemoved === pv.data.roomsToRemove && r.data.failed === 0, { pv: pv.data, r: r.data });
    check("every 3 BHK unit now has the block layout's room count", (await Promise.all(u3s.map((u) => activeCount(u.Id)))).every((n) => n === sumOf(BK)),
      await Promise.all(u3s.map(async (u) => ({ id: u.Id, layoutRooms: await activeCount(u.Id), custom: await customLeft(u.Id) }))));
    check("custom 'Pooja Room' still there after the layout change", (await customLeft(units[0].Id)).includes("Pooja Room"));

    const f = u3s[0].FloorNo;
    const scopeF = { ScopeLevel: "FLOOR", ProjectId: PROJECT_ID, BlockId: blockId, FloorFrom: f, FloorTo: f, LayoutTypeId: t3.id };
    const FL = { BEDROOM: 1, KITCHEN: 1 };
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeF, items: items(FL) });
    check(`floor ${f} override saved`, r.status === 200, r.data);
    const onF = u3s.filter((u) => u.FloorNo === f);
    check("units on that floor follow the floor layout, others keep the block layout",
      (await Promise.all(onF.map((u) => activeCount(u.Id)))).every((n) => n === sumOf(FL))
      && (await Promise.all(u3s.filter((u) => u.FloorNo !== f).map((u) => activeCount(u.Id)))).every((n) => n === sumOf(BK)));
    pv = await call("POST", "/api/unit-layout-overrides/preview", { ...scopeF, FloorFrom: f, FloorTo: f + 1, items: items(FL) });
    check("overlapping range is flagged in preview", pv.status === 200 && pv.data.overlap && pv.data.overlap.label === `Floor ${f === 0 ? "G" : f}`, pv.data);
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeF, FloorFrom: f, FloorTo: f + 1, items: items(FL) });
    check("overlapping range is refused on save (400)", r.status === 400 && /overlaps/.test(r.data?.error), r.data);

    const target = u3s[u3s.length - 1];
    const scopeU = { ScopeLevel: "UNIT", ProjectId: PROJECT_ID, BlockId: blockId, UnitId: target.Id, LayoutTypeId: t3.id };
    const UN = { BEDROOM: 2, KITCHEN: 1, HALL_ROOM: 1 };
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeU, items: items(UN) });
    check("unit override saved; unit follows it", r.status === 200 && (await activeCount(target.Id)) === sumOf(UN), r.data);
    const ur2 = await call("GET", `/api/room-master/unit-rooms/${target.Id}`);
    check("Room Configuration box shows the unit override", ur2.data.templateSource?.level === "UNIT" && ur2.data.template.reduce((a, x) => a + x.quantity, 0) === sumOf(UN), ur2.data.templateSource);
    const inst2 = await call("GET", `/api/unit-bhk-config/room-instances/${target.Id}`);
    check("Work Reporting rooms follow the unit override, all mapped to real rooms", inst2.data.length === sumOf(UN) && inst2.data.every((i) => i.roomMasterId), inst2.data.length);
    const listed = await call("GET", `/api/unit-layout-overrides/project/${PROJECT_ID}`);
    const mine = (listed.data || []).filter((o) => o.BlockId === blockId);
    check("project override list returns block + floor + unit overrides with room lists",
      listed.status === 200 && ["BLOCK", "FLOOR", "UNIT"].every((l) => mine.some((o) => o.ScopeLevel === l && o.composition.length > 0)), mine.map((o) => o.ScopeLevel));
    const flr = await q("SELECT Id FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @b AND FloorNo = @f", { b: [sql.Int, blockId], f: [sql.Int, target.FloorNo] });
    const fu2 = await call("GET", `/api/room-master/floor-units/${flr[0].Id}`);
    check("floor badge uses the effective layout (unit override)", fu2.data.units.find((u) => u.Id === target.Id)?.TemplateRoomCount === sumOf(UN));

    r = await call("POST", "/api/unit-layout-overrides/reset", scopeU);
    const backTo = target.FloorNo === f ? sumOf(FL) : sumOf(BK);
    check("reset unit override -> back to the inherited layout", r.status === 200 && (await activeCount(target.Id)) === backTo, { r: r.data, n: await activeCount(target.Id), backTo });
    r = await call("POST", "/api/unit-layout-overrides/reset", scopeU);
    check("resetting again -> 404 (nothing to reset)", r.status === 404);
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeB, items: items({}) });
    check("empty layout refused (400)", r.status === 400);
    r = await call("PUT", "/api/unit-layout-overrides", { ...scopeU, LayoutTypeId: t2.id, items: items(UN) });
    check("unit override with the wrong type refused (400)", r.status === 400 && /isn't a 2 BHK/.test(r.data?.error), r.data);
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.stack || e.message);
  } finally {
    // ── Cleanup — through the API first (exercises delete paths), then a
    // SQL safety net for anything left, scoped strictly to the test block
    // and the temp layout type.
    console.log("\n[Cleanup]");
    try {
      if (blockId) {
        const left = await q("SELECT Id FROM dbo.UnitMaster WHERE BlockId = @b", { b: [sql.Int, blockId] });
        for (const u of left) {
          const d = await call("DELETE", `/api/unit-master/${u.Id}`);
          if (d.status !== 200) console.log(`   unit ${u.Id} delete: ${d.status} ${JSON.stringify(d.data)}`);
        }
        const fls = await q("SELECT Id FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @b AND IsActive = 1", { b: [sql.Int, blockId] });
        const del = await call("DELETE", `/api/crm/project-auto-setup/blocks/${blockId}`);
        console.log(`   block delete via API: ${del.status} ${JSON.stringify(del.data)}`);
        check("block (which had overrides) deletes through the real API", del.status === 200, del.data);
        // Safety net (only rows belonging to the test block)
        await q("DELETE i FROM dbo.RoomLayoutOverrideItem i JOIN dbo.RoomLayoutOverride o ON o.Id = i.OverrideId WHERE o.BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.RoomLayoutOverride WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.RoomMaster WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.CrmUnitPaymentPlan WHERE UnitId IN (SELECT Id FROM dbo.UnitMaster WHERE BlockId = @b)", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.UnitMaster WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.BlockUnitTypeSpec WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.CrmBlockPaymentPlan WHERE BlockId = @b", { b: [sql.Int, blockId] });
        await q("DELETE FROM dbo.BlockMaster WHERE Id = @b", { b: [sql.Int, blockId] });
        void fls;
      }
      if (emptyTypeId) await q("DELETE FROM dbo.RoomLayoutType WHERE Id = @t", { t: [sql.Int, emptyTypeId] });
      if (tempTypeId) {
        await q("DELETE rc FROM dbo.RoomComposition rc JOIN dbo.UnitRoomConfig c ON c.Id = rc.UnitRoomConfigId WHERE c.LayoutTypeId = @t", { t: [sql.Int, tempTypeId] });
        await q("DELETE FROM dbo.UnitRoomConfig WHERE LayoutTypeId = @t", { t: [sql.Int, tempTypeId] });
        await q("DELETE FROM dbo.RoomLayoutType WHERE Id = @t", { t: [sql.Int, tempTypeId] });
      }
      const residue = await q(`
        SELECT (SELECT COUNT(*) FROM dbo.BlockMaster WHERE BlockName = @n AND ProjectId = @p) AS blocks,
               (SELECT COUNT(*) FROM dbo.RoomLayoutType WHERE Label IN (@t, @e)) AS types,
               (SELECT COUNT(*) FROM dbo.UnitMaster WHERE BlockId = @b) AS units,
               (SELECT COUNT(*) FROM dbo.RoomMaster WHERE BlockId = @b) AS rooms,
               (SELECT COUNT(*) FROM dbo.RoomLayoutOverride WHERE BlockId = @b) AS overrides`,
      { n: [sql.NVarChar(100), BLOCK_NAME], p: [sql.Int, PROJECT_ID], t: [sql.NVarChar(50), TEMP_TYPE], e: [sql.NVarChar(50), EMPTY_TYPE], b: [sql.Int, blockId || -1] });
      check("cleanup: no test data left behind", residue[0].blocks === 0 && residue[0].types === 0 && residue[0].units === 0 && residue[0].rooms === 0 && residue[0].overrides === 0, residue[0]);
    } catch (e) {
      failures++;
      console.error("CLEANUP ERROR:", e.message);
    }
    server.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL END-TO-END CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
