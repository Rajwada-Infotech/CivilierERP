// Flat Master layout overrides (migration 480): a layout type's room list
// overridden for one Project, Block, floor range of a Block, or Unit.
// Resolution/validation/preview live in services/unitLayout.js; this file
// only wires them to HTTP.
//
//   GET    /project/:projectId      active overrides with their room lists
//   POST   /preview   { scope..., LayoutTypeId, items | reset: true }
//   PUT    /          { scope..., LayoutTypeId, items }   save + sync rooms
//   POST   /reset     { scope..., LayoutTypeId }           reset + sync rooms
const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  validateScope, validateItems, previewOverrideChange, saveOverride, resetOverride,
  listProjectOverrides, syncRoomsForUnits, bumpFlatMasterCaches, LayoutValidationError,
} = require("../services/unitLayout");

const PAGE = "civilworkdpr-room-master";
const actorOf = (req) => req.user?.email || req.user?.name || String(req.user?.userId || "system");

function fail(res, err, where) {
  if (err instanceof LayoutValidationError) return res.status(400).json({ error: err.message });
  console.error(`[unit-layout-override] ${where} error:`, err.message);
  return res.status(500).json({ error: err.message });
}

router.get("/project/:projectId", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Invalid projectId" });
  try {
    res.json(await listProjectOverrides(getPool(), projectId));
  } catch (err) { fail(res, err, "GET /project"); }
});

router.post("/preview", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const s = await validateScope(pool, req.body || {});
    const composition = req.body?.reset ? null : (await validateItems(pool, req.body?.items)).composition;
    res.json(await previewOverrideChange(pool, s, composition));
  } catch (err) { fail(res, err, "POST /preview"); }
});

router.put("/", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const s = await validateScope(pool, req.body || {});
    const { all } = await validateItems(pool, req.body?.items);
    const { overrideId, unitIds } = await saveOverride(pool, s, all, actorOf(req));
    // Rooms follow the new layout: add missing, retire surplus WITHOUT DPR
    // work, keep (and report) surplus with work. Each unit its own transaction.
    const sync = await syncRoomsForUnits(pool, unitIds, { removeUnused: true, createdBy: req.user?.userId || null });
    await bumpFlatMasterCaches();
    if (sync.failed.length) console.error("[unit-layout-override] PUT sync failures:", sync.failed);
    res.json({
      overrideId,
      units: sync.units, unitsChanged: sync.unitsChanged,
      roomsAdded: sync.created + sync.reactivated, roomsRemoved: sync.deactivated, failed: sync.failed.length,
    });
  } catch (err) { fail(res, err, "PUT /"); }
});

router.post("/reset", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const s = await validateScope(pool, req.body || {});
    const r = await resetOverride(pool, s, actorOf(req));
    if (!r) return res.status(404).json({ error: "There is no override here to reset." });
    const sync = await syncRoomsForUnits(pool, r.unitIds, { removeUnused: true, createdBy: req.user?.userId || null });
    await bumpFlatMasterCaches();
    if (sync.failed.length) console.error("[unit-layout-override] reset sync failures:", sync.failed);
    res.json({
      overrideId: r.overrideId,
      units: sync.units, unitsChanged: sync.unitsChanged,
      roomsAdded: sync.created + sync.reactivated, roomsRemoved: sync.deactivated, failed: sync.failed.length,
    });
  } catch (err) { fail(res, err, "POST /reset"); }
});

module.exports = router;
