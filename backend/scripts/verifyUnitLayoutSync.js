"use strict";
/**
 * Regression check for the Unit -> Unit Composition layout -> Room Master
 * chain (migration 477 + services/unitLayout.js).
 *
 * Runs EVERYTHING — migration 477 itself (idempotent, so a no-op once
 * applied), throwaway test units, composition edits, room syncs — inside ONE
 * transaction that is always ROLLED BACK. Nothing it does persists, so it is
 * safe against any environment, including a shared dev DB. Tables it touches
 * are locked for the few seconds it runs.
 *
 * Run: node backend/scripts/verifyUnitLayoutSync.js
 * Exit code 0 = every check passed.
 */
require("../config/env").loadEnv();
const path = require("path");
const fs = require("fs");
const { connectDB, getPool, sql } = require("../db");
const L = require("../services/unitLayout");

const MIGRATION = path.join(__dirname, "../migrations/461-480/477-unit-layout-type-fk.sql");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

(async () => {
  const pool = (await connectDB()) || getPool();
  const tx = pool.transaction();
  await tx.begin();
  const q = async (text, inputs = {}) => {
    const r = tx.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };
  const roomsOf = (unitId) => q(
    "SELECT Id, RoomName, IsActive, RoomCategoryId FROM dbo.RoomMaster WHERE UnitId = @u ORDER BY RoomCategoryId, RoomName",
    { u: [sql.Int, unitId] },
  );
  const activeNames = async (unitId) => (await roomsOf(unitId)).filter((r) => r.IsActive).map((r) => r.RoomName).sort();
  const runMigration = async () => {
    const raw = fs.readFileSync(MIGRATION, "utf8");
    for (const batch of raw.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean)) await q(batch);
  };
  const runMigration480 = async () => {
    const raw = fs.readFileSync(path.join(__dirname, "../migrations/461-480/480-room-layout-override.sql"), "utf8");
    for (const batch of raw.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean)) await q(batch);
  };

  try {
    await q("SET LOCK_TIMEOUT 15000");

    // ── 1. Migration 477 ────────────────────────────────────────────────
    console.log("\n[1] Migration 477");
    await runMigration();
    await runMigration();
    check("runs twice without error (idempotent)", true);
    await runMigration480();
    await runMigration480();
    check("migration 480 runs twice (idempotent)", true);
    const byKey = Object.fromEntries((await q("SELECT Id, TypeKey FROM dbo.RoomLayoutType")).map((r) => [r.TypeKey, r]));
    check("2.5 BHK registered", !!byKey["2.5BHK"]);
    for (const [label, sqlText] of [
      ["every active typed unit linked", "SELECT COUNT(*) c FROM dbo.UnitMaster WHERE IsActive = 1 AND UnitType IS NOT NULL AND LayoutTypeId IS NULL"],
      ["every active CRM template row linked", "SELECT COUNT(*) c FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE IsActive = 1 AND LayoutTypeId IS NULL"],
      ["every block spec linked", "SELECT COUNT(*) c FROM dbo.BlockUnitTypeSpec WHERE LayoutTypeId IS NULL"],
      ["every composition config linked", "SELECT COUNT(*) c FROM dbo.UnitRoomConfig WHERE LayoutTypeId IS NULL"],
      ["unit UnitType text == its layout Label", "SELECT COUNT(*) c FROM dbo.UnitMaster u JOIN dbo.RoomLayoutType lt ON lt.Id = u.LayoutTypeId WHERE u.UnitType <> lt.Label"],
    ]) {
      const r = await q(sqlText);
      check(label, r[0].c === 0, r[0]);
    }
    check("unique composition-per-layout index", (await q("SELECT 1 x FROM sys.indexes WHERE name = 'UX_UnitRoomConfig_LayoutType'")).length === 1);
    await q("INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder) VALUES (@k, @k, 0, 999)", { k: [sql.NVarChar(50), "X".repeat(45)] });
    check("45-char layout TypeKey fits (was capped at 20)", true);
    const rn = await q("SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'RoomName'");
    check("RoomMaster.RoomName widened to 160", rn[0].max_length === 320, rn[0]);

    // ── 2. Resolution / validation ──────────────────────────────────────
    console.log("\n[2] Layout resolution + validation");
    // A layout type with no rooms defined, created here (inside the tx) so
    // the checks don't depend on whether anyone has set up a real type yet.
    await q("INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder) VALUES ('__VERIFYEMPTY__', '__VERIFY EMPTY__', 0, 998)");
    const types = await L.listLayoutTypes(tx);
    const t1 = types.find((t) => t.typeKey === "1BHK");
    const t2 = types.find((t) => t.typeKey === "2BHK");
    const t3 = types.find((t) => t.typeKey === "3BHK");
    const tEmpty = types.find((t) => t.typeKey === "__VERIFYEMPTY__");
    console.log(`   2BHK = ${t2.summary} (${t2.roomCount} rooms)`);
    check("2BHK has rooms + summary", t2.roomCount > 0 && t2.summary.length > 0);
    check("a type with no rooms defined reports roomCount 0", tEmpty.roomCount === 0 && tEmpty.summary === "");
    const r1 = await L.resolveUnitTypeInput(tx, { UnitType: "2bhk" }, { requireComposition: true });
    check('"2bhk" -> 2BHK, canonical label "2 BHK"', r1.layoutTypeId === t2.id && r1.unitType === "2 BHK", r1);
    const r2 = await L.resolveUnitTypeInput(tx, { LayoutTypeId: t3.id }, { requireComposition: true });
    check("LayoutTypeId resolves", r2.layoutTypeId === t3.id && r2.unitType === t3.label, r2);
    for (const [label, input, opts] of [
      ["unregistered '1.5 BHK' rejected", { UnitType: "1.5 BHK" }, { requireComposition: true }],
      ["type with no layout rejected as a new pick", { UnitType: "__VERIFY EMPTY__" }, { requireComposition: true }],
    ]) {
      let err = null;
      try { await L.resolveUnitTypeInput(tx, input, opts); } catch (e) { err = e; }
      check(label, err && err.status === 400, err && err.message);
    }
    const keep = await L.resolveUnitTypeInput(tx, { UnitType: "__VERIFY EMPTY__" }, { requireComposition: true, keepLayoutIds: [tEmpty.id] });
    check("type with no layout kept when the record already has it", keep.layoutTypeId === tEmpty.id);
    const keepText = await L.resolveUnitTypeInput(tx, { UnitType: "Villa" }, { requireComposition: true, keepText: "Villa" });
    check("unchanged legacy text kept", keepText.layoutTypeId === null && keepText.unitType === "Villa");
    const empty = await L.resolveUnitTypeInput(tx, { UnitType: "" });
    check("empty type -> nulls", empty.layoutTypeId === null && empty.unitType === null);

    // ── 3. New unit gets its rooms ──────────────────────────────────────
    console.log("\n[3] New unit gets its rooms");
    const blk = (await q("SELECT TOP 1 Id, ProjectId FROM dbo.BlockMaster WHERE IsActive = 1 ORDER BY Id DESC"))[0];
    const newUnit = async (name, floorNo, unitType, layoutTypeId) => (await q(`
      INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, LayoutTypeId, IsActive, CreatedAt)
      OUTPUT INSERTED.Id VALUES (@p, @b, @n, @f, @ut, @lt, 1, SYSDATETIME())`, {
      p: [sql.Int, blk.ProjectId], b: [sql.Int, blk.Id], n: [sql.NVarChar(100), name],
      f: [sql.Int, floorNo], ut: [sql.NVarChar(50), unitType], lt: [sql.Int, layoutTypeId],
    }))[0].Id;
    const unitId = await newUnit("__VERIFY_477_A__", 3, t2.label, t2.id);
    let s = await L.syncUnitRooms(tx, unitId, {});
    let names = await activeNames(unitId);
    console.log(`   rooms: ${names.join(", ")}`);
    check(`created ${t2.roomCount} rooms = 2BHK composition`, s.created === t2.roomCount && names.length === t2.roomCount, s);
    check("rooms carry their category", (await roomsOf(unitId)).every((r) => r.RoomCategoryId != null));
    check("floor label '3' on every room", (await q("SELECT DISTINCT Floor FROM dbo.RoomMaster WHERE UnitId = @u", { u: [sql.Int, unitId] })).map((r) => r.Floor).join() === "3");
    s = await L.syncUnitRooms(tx, unitId, {});
    check("re-sync is a no-op", s.created + s.reactivated + s.renamed + s.deactivated === 0, s);

    // ── 4. Composition edit, add-only propagation ───────────────────────
    console.log("\n[4] Composition edited (Bedroom +1), add-only");
    const bedroomCat = (await q("SELECT Id FROM dbo.RoomCategoryMaster WHERE CategoryName = 'BEDROOM'"))[0].Id;
    const cfg2 = (await q("SELECT Id FROM dbo.UnitRoomConfig WHERE LayoutTypeId = @lt", { lt: [sql.Int, t2.id] }))[0].Id;
    const bedQty = (await q("SELECT Quantity FROM dbo.RoomComposition WHERE UnitRoomConfigId = @c AND RoomCategoryId = @cat",
      { c: [sql.Int, cfg2], cat: [sql.Int, bedroomCat] }))[0].Quantity;
    const firstBedroom = (await roomsOf(unitId)).find((r) => r.RoomCategoryId === bedroomCat);
    await q("UPDATE dbo.RoomComposition SET Quantity = @q WHERE UnitRoomConfigId = @c AND RoomCategoryId = @cat",
      { q: [sql.Int, bedQty + 1], c: [sql.Int, cfg2], cat: [sql.Int, bedroomCat] });
    s = await L.syncUnitRooms(tx, unitId, { removeUnused: false });
    names = await activeNames(unitId);
    console.log(`   rooms: ${names.join(", ")}`);
    check("exactly 1 bedroom added", s.created === 1, s);
    check("bedrooms numbered 1..n with no stray unnumbered one",
      names.filter((n) => /^Bedroom( \d+)?$/.test(n)).join() === Array.from({ length: bedQty + 1 }, (_, i) => `Bedroom ${i + 1}`).join(), names);
    check("existing bedroom kept its Id", (await roomsOf(unitId)).some((r) => r.Id === firstBedroom.Id && r.IsActive));
    await q("UPDATE dbo.RoomComposition SET Quantity = @q WHERE UnitRoomConfigId = @c AND RoomCategoryId = @cat",
      { q: [sql.Int, bedQty], c: [sql.Int, cfg2], cat: [sql.Int, bedroomCat] });
    s = await L.syncUnitRooms(tx, unitId, { removeUnused: false });
    check("add-only never removes when composition shrinks", s.deactivated === 0, s);

    // ── 5. Hand-edited rooms ────────────────────────────────────────────
    console.log("\n[5] Hand-edited rooms");
    const hall = (await roomsOf(unitId)).find((r) => r.RoomName.startsWith("Hall Room"));
    await q("UPDATE dbo.RoomMaster SET RoomName = 'Living Area' WHERE Id = @id", { id: [sql.Int, hall.Id] });
    check("inferRoomCategoryId('Bedroom 7') -> Bedroom", (await L.inferRoomCategoryId(tx, "Bedroom 7")) === bedroomCat);
    check("inferRoomCategoryId('bedroom') is case-insensitive", (await L.inferRoomCategoryId(tx, "bedroom")) === bedroomCat);
    check("inferRoomCategoryId('Pooja Room') -> null", (await L.inferRoomCategoryId(tx, "Pooja Room")) === null);
    await q(`INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedAt)
             VALUES (@p, @b, @u, 'Bedroom 9', @cat, '3', 1, SYSDATETIME())`,
      { p: [sql.Int, blk.ProjectId], b: [sql.Int, blk.Id], u: [sql.Int, unitId], cat: [sql.Int, bedroomCat] });
    s = await L.syncUnitRooms(tx, unitId, { removeUnused: false });
    check("complete unit: sync renames nothing (hand-added 'Bedroom 9' untouched)",
      s.renamed === 0 && s.created === 0 && (await activeNames(unitId)).includes("Bedroom 9"), s);
    await q("DELETE FROM dbo.RoomMaster WHERE UnitId = @u AND RoomName = 'Bedroom 9'", { u: [sql.Int, unitId] });

    // A legacy room with NO category but a category's name must be adopted,
    // not duplicated (found on dev: an old uncategorized "Bedroom" with a
    // blueprint got a second "Bedroom" next to it).
    const legacyUnit = await newUnit("__VERIFY_477_LEGACY__", 2, t2.label, t2.id);
    await q(`INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedAt, BlueprintFileData)
             VALUES (@p, @b, @u, 'Balcony', NULL, '2', 1, SYSDATETIME(), 'x')`,
      { p: [sql.Int, blk.ProjectId], b: [sql.Int, blk.Id], u: [sql.Int, legacyUnit] });
    s = await L.syncUnitRooms(tx, legacyUnit, {});
    const legacyRooms = (await roomsOf(legacyUnit)).filter((r) => r.IsActive);
    check("uncategorized legacy 'Balcony' adopted (categorized), no duplicate built",
      s.categorized === 1 && legacyRooms.filter((r) => r.RoomName === "Balcony").length === 1 && legacyRooms.length === t2.roomCount, { s, n: legacyRooms.length });
    const pooja = await q(`INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedAt)
             OUTPUT INSERTED.Id VALUES (@p, @b, @u, 'Pooja Room', NULL, '2', 1, SYSDATETIME())`,
      { p: [sql.Int, blk.ProjectId], b: [sql.Int, blk.Id], u: [sql.Int, legacyUnit] });
    s = await L.syncUnitRooms(tx, legacyUnit, {});
    check("custom uncategorized 'Pooja Room' left alone", !s.categorized
      && (await q("SELECT RoomCategoryId FROM dbo.RoomMaster WHERE Id = @i", { i: [sql.Int, pooja[0].Id] }))[0].RoomCategoryId === null, s);

    // ── 6. Type change with work on some rooms ──────────────────────────
    console.log("\n[6] Type change 2BHK -> 1BHK; 'Kitchen 2' + 'Master Bedroom' have blueprints");
    const pre = await roomsOf(unitId);
    const kitchen1 = pre.find((r) => r.RoomName === "Kitchen 1");
    const kitchen2 = pre.find((r) => r.RoomName === "Kitchen 2");
    const master = pre.find((r) => r.RoomName === "Master Bedroom");
    await q("UPDATE dbo.RoomMaster SET BlueprintFileData = 'x' WHERE Id IN (@a, @b)", { a: [sql.Int, kitchen2.Id], b: [sql.Int, master.Id] });
    await q("UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = @ut WHERE Id = @u", { lt: [sql.Int, t1.id], ut: [sql.NVarChar(50), t1.label], u: [sql.Int, unitId] });
    s = await L.syncUnitRooms(tx, unitId, { removeUnused: true });
    names = await activeNames(unitId);
    const post = await roomsOf(unitId);
    console.log(`   rooms: ${names.join(", ")} | kept: ${s.keptWithWork.join(", ")}`);
    check("Kitchen x2 -> x1: clean one retired, the one with work survives",
      !post.find((r) => r.Id === kitchen1.Id).IsActive && post.find((r) => r.Id === kitchen2.Id).IsActive);
    check("surviving kitchen renamed 'Kitchen'", post.find((r) => r.Id === kitchen2.Id).RoomName === "Kitchen");
    check("'Master Bedroom' (not in 1BHK, has work) kept + reported", s.keptWithWork.join() === "Master Bedroom" && names.includes("Master Bedroom"), s);
    check("hand-renamed 'Living Area' kept its name", names.includes("Living Area"));
    check("single 'Bathroom' left", names.filter((n) => n.startsWith("Bathroom")).join() === "Bathroom", names);
    check("retired rooms are soft-deactivated", post.filter((r) => !r.IsActive).length === s.deactivated && s.deactivated > 0);

    // ── 7. Back again: reactivate, don't duplicate ──────────────────────
    console.log("\n[7] Type change back 1BHK -> 2BHK");
    const rowsBefore = (await roomsOf(unitId)).length;
    await q("UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = @ut WHERE Id = @u", { lt: [sql.Int, t2.id], ut: [sql.NVarChar(50), t2.label], u: [sql.Int, unitId] });
    s = await L.syncUnitRooms(tx, unitId, { removeUnused: true });
    check("reactivated, no duplicates inserted", s.reactivated > 0 && s.created === 0 && (await roomsOf(unitId)).length === rowsBefore, s);

    // ── 8. Unit delete ──────────────────────────────────────────────────
    console.log("\n[8] Unit delete");
    let blocker = await L.removeUnitRoomsForDelete(tx, unitId);
    check("refused while a room has work", !!blocker && blocker.includes("DPR work"), blocker);
    check("nothing removed on refusal", (await roomsOf(unitId)).length === rowsBefore);
    await q("UPDATE dbo.RoomMaster SET BlueprintFileData = NULL WHERE UnitId = @u", { u: [sql.Int, unitId] });
    blocker = await L.removeUnitRoomsForDelete(tx, unitId);
    check("clean rooms removed", blocker === null && (await roomsOf(unitId)).length === 0);
    await q("DELETE FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, unitId] });
    check("unit hard delete succeeds", true);

    // ── 9. Edge cases ───────────────────────────────────────────────────
    console.log("\n[9] Edge cases");
    const legacyId = await newUnit("__VERIFY_477_B__", 0, "3 BHK", null);
    s = await L.syncUnitRooms(tx, legacyId, {});
    check("unlinked '3 BHK' unit builds 3BHK rooms via text fallback", s.created === t3.roomCount, s);
    check("ground floor labelled 'G'", (await q("SELECT DISTINCT Floor FROM dbo.RoomMaster WHERE UnitId = @u", { u: [sql.Int, legacyId] }))[0].Floor === "G");
    await q("UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = '__VERIFY EMPTY__' WHERE Id = @u", { lt: [sql.Int, tEmpty.id], u: [sql.Int, legacyId] });
    s = await L.syncUnitRooms(tx, legacyId, { removeUnused: false });
    check("layout with no composition -> skipped", s.skipped === "no-composition" && s.created === 0, s);
    // ── 9b. Layout overrides (migration 480) ──────────────────────────────
    console.log("\n[9b] Layout overrides: Unit > Floor range > Block > Project > global");
    const catByName = Object.fromEntries((await q("SELECT Id, CategoryName FROM dbo.RoomCategoryMaster WHERE IsActive = 1")).map((c) => [c.CategoryName, c.Id]));
    const allCats = Object.values(catByName);
    const addOverride = async (lvl, { blockId = null, ff = null, ft = null, unitId = null }, comp) => {
      const id = (await q(`INSERT INTO dbo.RoomLayoutOverride (LayoutTypeId, ScopeLevel, ProjectId, BlockId, FloorFrom, FloorTo, UnitId, CreatedBy)
        OUTPUT INSERTED.Id AS id VALUES (@lt, @l, @p, @b, @ff, @ft, @u, 'verify')`, {
        lt: [sql.Int, t2.id], l: [sql.NVarChar(10), lvl], p: [sql.Int, blk.ProjectId], b: [sql.Int, blockId],
        ff: [sql.Int, ff], ft: [sql.Int, ft], u: [sql.Int, unitId],
      }))[0].id;
      await setItems(id, comp);
      return id;
    };
    const setItems = async (id, comp) => {
      await q("DELETE FROM dbo.RoomLayoutOverrideItem WHERE OverrideId = @o", { o: [sql.Int, id] });
      for (const c of allCats) {
        const name = Object.keys(catByName).find((k) => catByName[k] === c);
        await q("INSERT INTO dbo.RoomLayoutOverrideItem (OverrideId, RoomCategoryId, Quantity) VALUES (@o, @c, @n)",
          { o: [sql.Int, id], c: [sql.Int, c], n: [sql.Int, comp[name] || 0] });
      }
    };
    const itemsOf = (comp) => allCats.map((c) => ({ roomCategoryId: c, quantity: comp[Object.keys(catByName).find((k) => catByName[k] === c)] || 0 }));
    const unitRow = async (id) => (await q("SELECT Id, ProjectId, BlockId, FloorNo, UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, id] }))[0];
    const eff = async (id) => L.getEffectiveComposition(tx, await unitRow(id), t2);
    const sum = (comp) => Object.values(comp).reduce((a, b) => a + b, 0);

    const tb = (await q("INSERT INTO dbo.BlockMaster (ProjectId, BlockName) OUTPUT INSERTED.Id AS id VALUES (@p, '__VERIFY_480__')", { p: [sql.Int, blk.ProjectId] }))[0].id;
    const mk = async (name, floor) => (await q(`INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, LayoutTypeId, IsActive, CreatedAt)
      OUTPUT INSERTED.Id AS id VALUES (@p, @b, @n, @f, @ut, @lt, 1, SYSDATETIME())`, {
      p: [sql.Int, blk.ProjectId], b: [sql.Int, tb], n: [sql.NVarChar(100), name], f: [sql.Int, floor], ut: [sql.NVarChar(50), t2.label], lt: [sql.Int, t2.id],
    }))[0].id;
    const uF1 = await mk("__V480_F1__", 1), uF5a = await mk("__V480_F5A__", 5), uF5b = await mk("__V480_F5B__", 5);
    for (const u of [uF1, uF5a, uF5b]) await L.syncUnitRooms(tx, u, {});
    check("baseline: all 3 units follow the global layout", (await eff(uF1)).source.level === "GLOBAL");

    const P = { BEDROOM: 2, KITCHEN: 1, HALL_ROOM: 1, BATHROOM: 1 };
    const Bk = { BEDROOM: 3, KITCHEN: 1, HALL_ROOM: 1, BATHROOM: 2 };
    const F = { BEDROOM: 1, KITCHEN: 1, BATHROOM: 1 };
    const U = { BEDROOM: 4, KITCHEN: 1 };
    await addOverride("PROJECT", {}, P);
    check("project override applies", (await eff(uF1)).source.level === "PROJECT");
    const blockOv = await addOverride("BLOCK", { blockId: tb }, Bk);
    check("block override beats project", (await eff(uF1)).source.level === "BLOCK");
    await addOverride("FLOOR", { blockId: tb, ff: 5, ft: 5 }, F);
    check("floor-range override beats block (floor 5), block still on floor 1",
      (await eff(uF5a)).source.level === "FLOOR" && (await eff(uF1)).source.level === "BLOCK");
    const unitOv = await addOverride("UNIT", { blockId: tb, unitId: uF5b }, U);
    check("unit override beats floor range", (await eff(uF5b)).source.level === "UNIT" && (await eff(uF5a)).source.level === "FLOOR");

    for (const u of [uF1, uF5a, uF5b]) await L.syncUnitRooms(tx, u, { removeUnused: true });
    check("rooms follow the effective layout (block 9 / floor 3 / unit 5)",
      (await activeNames(uF1)).length === sum(Bk) && (await activeNames(uF5a)).length === sum(F) && (await activeNames(uF5b)).length === sum(U),
      [(await activeNames(uF1)).length, (await activeNames(uF5a)).length, (await activeNames(uF5b)).length]);

    const sFloor = await L.validateScope(tx, { LayoutTypeId: t2.id, ScopeLevel: "FLOOR", ProjectId: blk.ProjectId, BlockId: tb, FloorFrom: 4, FloorTo: 6 });
    const ov1 = await L.previewOverrideChange(tx, sFloor, (await L.validateItems(tx, itemsOf(F))).composition);
    check("overlapping floor range (4-6 vs 5-5) is flagged", ov1.overlap && ov1.overlap.label === "Floor 5", ov1.overlap);
    const sSame = await L.validateScope(tx, { LayoutTypeId: t2.id, ScopeLevel: "FLOOR", ProjectId: blk.ProjectId, BlockId: tb, FloorFrom: 5, FloorTo: 5 });
    check("editing the same range is not an overlap", (await L.previewOverrideChange(tx, sSame, (await L.validateItems(tx, itemsOf(F))).composition)).overlap === null);

    // preview must match what the sync then really does
    const newBk = { BEDROOM: 2, KITCHEN: 1, HALL_ROOM: 1, BATHROOM: 3 };
    const sBlock = await L.validateScope(tx, { LayoutTypeId: t2.id, ScopeLevel: "BLOCK", ProjectId: blk.ProjectId, BlockId: tb });
    const pv = await L.previewOverrideChange(tx, sBlock, (await L.validateItems(tx, itemsOf(newBk))).composition);
    check("preview: 3 units in scope, 2 shadowed by more specific overrides", pv.unitsInScope === 3 && pv.unitsShadowed === 2, pv);
    await setItems(blockOv, newBk);
    let added = 0, removed = 0;
    for (const u of [uF1, uF5a, uF5b]) { const r = await L.syncUnitRooms(tx, u, { removeUnused: true }); added += r.created + r.reactivated; removed += r.deactivated; }
    check("preview numbers == actual sync (added/removed)", pv.roomsToAdd === added && pv.roomsToRemove === removed, { pv, added, removed });

    // removal keeps rooms with DPR work
    const bedroom = (await roomsOf(uF1)).find((r) => r.IsActive && r.RoomCategoryId === catByName.BEDROOM);
    await q("UPDATE dbo.RoomMaster SET BlueprintFileData = 'x' WHERE Id = @i", { i: [sql.Int, bedroom.Id] });
    const noBed = { KITCHEN: 1, HALL_ROOM: 1 };
    const pv2 = await L.previewOverrideChange(tx, sBlock, (await L.validateItems(tx, itemsOf(noBed))).composition);
    check("preview lists the bedroom with work as kept", pv2.roomsKeptWithWork.some((n) => n.includes(bedroom.RoomName)), pv2.roomsKeptWithWork);
    await setItems(blockOv, noBed);
    const rWork = await L.syncUnitRooms(tx, uF1, { removeUnused: true });
    check("sync keeps the bedroom with work, removes the clean one",
      (await roomsOf(uF1)).find((r) => r.Id === bedroom.Id).IsActive && rWork.keptWithWork.length === 1 && rWork.deactivated >= 1, rWork);

    // reset (soft-deactivate) falls back to the level above
    await q("UPDATE dbo.RoomLayoutOverride SET IsActive = 0 WHERE Id = @i", { i: [sql.Int, unitOv] });
    await L.syncUnitRooms(tx, uF5b, { removeUnused: true });
    check("reset unit override -> unit follows the floor range again",
      (await eff(uF5b)).source.level === "FLOOR" && (await activeNames(uF5b)).length === sum(F));

    const listed = await L.listProjectOverrides(tx, blk.ProjectId);
    const mine = listed.filter((o) => o.LayoutTypeId === t2.id && (o.BlockId === tb || o.ScopeLevel === "PROJECT"));
    check("listProjectOverrides returns active overrides with their room lists (reset one excluded)",
      mine.some((o) => o.ScopeLevel === "PROJECT" && o.composition.length === 4)
      && mine.some((o) => o.ScopeLevel === "FLOOR" && o.FloorFrom === 5 && o.composition.length === 3)
      && !mine.some((o) => o.ScopeLevel === "UNIT"), mine.map((o) => [o.ScopeLevel, o.composition.length]));
    const typesNow = await L.listLayoutTypes(tx);
    check("layout types list carries each type's composition", typesNow.find((t) => t.id === t2.id).composition.length > 0);
    let bad = null;
    try { await L.validateItems(tx, itemsOf({})); } catch (e) { bad = e; }
    check("an override with zero rooms is rejected", bad && bad.status === 400);
    // a unit moved to another block keeps (and carries) its own override
    const unitOv2 = await addOverride("UNIT", { blockId: tb, unitId: uF1 }, U);
    const tb2 = (await q("INSERT INTO dbo.BlockMaster (ProjectId, BlockName) OUTPUT INSERTED.Id AS id VALUES (@p, '__VERIFY_480_B__')", { p: [sql.Int, blk.ProjectId] }))[0].id;
    await q("UPDATE dbo.UnitMaster SET BlockId = @b WHERE Id = @u", { b: [sql.Int, tb2], u: [sql.Int, uF1] });
    await L.moveUnitOverrides(tx, uF1, blk.ProjectId, tb2);
    check("moved unit keeps its own override (scope follows the unit)",
      (await eff(uF1)).source.level === "UNIT"
      && (await q("SELECT BlockId FROM dbo.RoomLayoutOverride WHERE Id = @i", { i: [sql.Int, unitOv2] }))[0].BlockId === tb2);

    // delete paths: a unit / block with overrides (active or reset) can be deleted
    await L.removeOverridesFor(tx, { unitId: uF5b });
    await q("DELETE FROM dbo.RoomMaster WHERE UnitId = @u", { u: [sql.Int, uF5b] });
    await q("DELETE FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, uF5b] });
    check("unit with a (reset) override deletes cleanly after removeOverridesFor", true);
    await L.removeOverridesFor(tx, { blockId: tb });
    await q("DELETE FROM dbo.RoomMaster WHERE BlockId = @b", { b: [sql.Int, tb] });
    await q("DELETE FROM dbo.UnitMaster WHERE BlockId = @b", { b: [sql.Int, tb] });
    await q("DELETE FROM dbo.BlockMaster WHERE Id = @b", { b: [sql.Int, tb] });
    check("block with overrides deletes cleanly; the moved unit's override survives in its new block",
      (await q("SELECT COUNT(*) n FROM dbo.RoomLayoutOverride WHERE Id = @i", { i: [sql.Int, unitOv2] }))[0].n === 1);

    // ── deactivated room category: layouts keep it (Room Category Master's promise)
    const catBal = catByName.BALCONY;
    const unitDc = (await q(`INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, LayoutTypeId, IsActive, CreatedAt)
      OUTPUT INSERTED.Id AS id VALUES (@p, @b, '__V480_DC__', 7, @ut, @lt, 1, SYSDATETIME())`, {
      p: [sql.Int, blk.ProjectId], b: [sql.Int, tb2], ut: [sql.NVarChar(50), t2.label], lt: [sql.Int, t2.id] }))[0].id;
    await L.syncUnitRooms(tx, unitDc, {});
    const beforeDc = (await activeNames(unitDc)).length;
    const hadBalcony = (await roomsOf(unitDc)).some((r) => r.IsActive && r.RoomCategoryId === catBal);
    await q("UPDATE dbo.RoomCategoryMaster SET IsActive = 0 WHERE Id = @c", { c: [sql.Int, catBal] });
    const sDc = await L.syncUnitRooms(tx, unitDc, { removeUnused: true });
    check("deactivated category stays in the layout: sync removes nothing",
      sDc.deactivated === 0 && (await activeNames(unitDc)).length === beforeDc && hadBalcony === (await roomsOf(unitDc)).some((r) => r.IsActive && r.RoomCategoryId === catBal), sDc);
    // an existing override with the (now inactive) category: editing it keeps it, preview == save
    await q("UPDATE dbo.RoomCategoryMaster SET IsActive = 1 WHERE Id = @c", { c: [sql.Int, catBal] });
    const sUdc = await L.validateScope(tx, { LayoutTypeId: t2.id, ScopeLevel: "UNIT", ProjectId: blk.ProjectId, BlockId: tb2, UnitId: uF1 });
    await setItems(unitOv2, { BEDROOM: 2, KITCHEN: 1, BALCONY: 1 });
    await L.syncUnitRooms(tx, uF1, { removeUnused: true });
    await q("UPDATE dbo.RoomCategoryMaster SET IsActive = 0 WHERE Id = @c", { c: [sql.Int, catBal] });
    const editItems = (await L.validateItems(tx, itemsOf({ BEDROOM: 3, KITCHEN: 1 }).filter((i) => i.roomCategoryId !== catBal))).composition;
    const pvDc = await L.previewOverrideChange(tx, sUdc, editItems);
    check("editing an override keeps its deactivated-category rooms (preview: only +1 bedroom, nothing removed)",
      pvDc.roomsToAdd === 1 && pvDc.roomsToRemove === 0, pvDc);
    await q("UPDATE dbo.RoomCategoryMaster SET IsActive = 1 WHERE Id = @c", { c: [sql.Int, catBal] });

    // category renamed: generated rooms follow the new alias, same Ids; hand-named rooms untouched
    const kitchenCat = catByName.KITCHEN;
    const kBefore = (await roomsOf(unitDc)).filter((r) => r.RoomCategoryId === kitchenCat);
    await q(`INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedAt)
             VALUES (@p, @b, @u, 'Chef Corner', @c, '7', 1, SYSDATETIME())`, { p: [sql.Int, blk.ProjectId], b: [sql.Int, tb2], u: [sql.Int, unitDc], c: [sql.Int, kitchenCat] });
    const renamed = await L.renameCategoryRooms(tx, kitchenCat, "Kitchen", "Pantry");
    const kAfter = (await roomsOf(unitDc)).filter((r) => r.RoomCategoryId === kitchenCat);
    check("renaming a category renames its generated rooms (same Ids), leaves hand-named ones",
      renamed > 0 && kBefore.every((r) => kAfter.find((a) => a.Id === r.Id)?.RoomName.startsWith("Pantry")) && kAfter.some((r) => r.RoomName === "Chef Corner"),
      kAfter.map((r) => r.RoomName));
    await L.renameCategoryRooms(tx, kitchenCat, "Pantry", "Kitchen");

    // later sections test the global layout — switch the test overrides off
    await q("UPDATE dbo.RoomLayoutOverride SET IsActive = 0 WHERE CreatedBy = 'verify'");

    const longAlias = "L".repeat(150);
    const longCat = (await q("INSERT INTO dbo.RoomCategoryMaster (CategoryName, Alias, IsActive, SortOrder) OUTPUT INSERTED.Id VALUES ('__VERIFY_LONG__', @a, 1, 999)",
      { a: [sql.NVarChar(150), longAlias] }))[0].Id;
    await q("INSERT INTO dbo.RoomComposition (UnitRoomConfigId, RoomCategoryId, Quantity) VALUES (@c, @cat, 10)", { c: [sql.Int, cfg2], cat: [sql.Int, longCat] });
    const longUnit = await newUnit("__VERIFY_477_C__", 1, t2.label, t2.id);
    s = await L.syncUnitRooms(tx, longUnit, {});
    check("150-char alias x10 ('… 10') fits RoomName", (await activeNames(longUnit)).includes(`${longAlias} 10`), s);

    // ── 10. Bulk generate over every real unit (timing) ─────────────────
    console.log("\n[10] Bulk sync over every active unit (inside the same tx)");
    const all = (await q("SELECT Id FROM dbo.UnitMaster WHERE IsActive = 1")).map((r) => r.Id);
    const cache = new Map();
    const t0 = Date.now();
    let created = 0;
    let skipped = 0;
    for (const id of all) {
      const r = await L.syncUnitRooms(tx, id, { cache });
      created += r.created + r.reactivated;
      if (r.skipped) skipped++;
    }
    const secs = (Date.now() - t0) / 1000;
    console.log(`   ${all.length} units, ${created} rooms, ${skipped} skipped, ${secs.toFixed(1)}s`);
    check("bulk sync completes", created > 0);
    const again = [];
    for (const id of all.slice(0, 50)) again.push(await L.syncUnitRooms(tx, id, { cache }));
    check("second bulk pass is a no-op", again.every((r) => r.created + r.reactivated + r.renamed === 0));
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.message);
  } finally {
    await tx.rollback();
    console.log("\nTransaction ROLLED BACK — nothing persisted.");
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
