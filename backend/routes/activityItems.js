const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// Links an Activity (dbo.ActivityMaster) to one or more Items
// (dbo.Item_Master_Group) — name + UOM are always read live from Item
// Master, never duplicated onto this table, so they can't drift if the
// item is later renamed/re-unit'd.

// ─── GET / — items linked to one activity ────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
  const activityId = req.query.activityId ? parseInt(req.query.activityId, 10) : null;
  if (!activityId) return res.status(400).json({ error: "activityId is required" });

  try {
    const pool = getPool();
    const result = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT
        ai.ActivityItemId AS id,
        ai.ActivityId      AS activityId,
        ai.ItemId          AS itemId,
        item.M_Name         AS itemName,
        item.M_code         AS itemCode,
        item.M_UOM          AS uom,
        ai.CreatedBy        AS createdBy,
        ai.CreatedAt        AS createdAt
      FROM dbo.ActivityItems ai
      JOIN dbo.Item_Master_Group item ON item.M_Id = ai.ItemId
      WHERE ai.ActivityId = @activityId
      ORDER BY item.M_Name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ActivityItems / error:", err);
    res.status(500).json({ error: "Failed to fetch linked items" });
  }
});

// ─── POST / — link an item to an activity ────────────────────────────────────
// Accepts either the original single `itemId`, or `itemIds: string[]` to
// link several items in one request — same shape as
// activity-checkpoint.js's POST /template/:activityId multi-add.
router.post("/", authMiddleware, requirePageRight("activity-master", "edit"), async (req, res) => {
  const { activityId } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  const rawIds = Array.isArray(req.body?.itemIds)
    ? req.body.itemIds
    : req.body?.itemId
      ? [req.body.itemId]
      : [];
  const itemIds = [...new Set(rawIds.filter(Boolean))];

  if (!activityId) return res.status(400).json({ error: "activityId is required" });
  if (itemIds.length === 0) return res.status(400).json({ error: "itemId or itemIds is required" });

  try {
    const pool = getPool();

    const dup = await pool.request()
      .input("activityId", sql.Int, activityId)
      .query(`SELECT ItemId FROM dbo.ActivityItems WHERE ActivityId = @activityId`);
    const already = new Set(dup.recordset.map((r) => r.ItemId));
    if (itemIds.some((id) => already.has(id))) {
      return res.status(409).json({ error: "This item is already linked to this activity" });
    }

    const ids = [];
    for (const itemId of itemIds) {
      const result = await pool.request()
        .input("activityId", sql.Int, activityId)
        .input("itemId", sql.UniqueIdentifier, itemId)
        .input("createdBy", sql.NVarChar(100), actor)
        .query(`
          INSERT INTO dbo.ActivityItems (ActivityId, ItemId, CreatedBy, CreatedAt)
          OUTPUT INSERTED.ActivityItemId AS id
          VALUES (@activityId, @itemId, @createdBy, GETDATE())
        `);
      ids.push(result.recordset[0].id);
    }

    // Single-id requests keep the original `{ id }` shape so any other
    // caller of this route isn't broken by this change.
    if (rawIds.length === 1 && req.body?.itemId !== undefined) {
      return res.status(201).json({ success: true, id: ids[0] });
    }
    res.status(201).json({ success: true, ids });
  } catch (err) {
    console.error("ActivityItems POST error:", err);
    res.status(500).json({ error: "Failed to link item to activity" });
  }
});

// ─── DELETE /:id — unlink ─────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("activity-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM dbo.ActivityItems WHERE ActivityItemId = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Link not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("ActivityItems DELETE error:", err);
    res.status(500).json({ error: "Failed to unlink item" });
  }
});

module.exports = router;
