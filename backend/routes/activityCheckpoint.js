const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// GET /:activityId — every checkpoint field configured for one activity,
// in display order.
router.get("/:activityId", authMiddleware, async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);
  if (!Number.isFinite(activityId)) return res.status(400).json({ error: "Invalid activityId" });
  try {
    const pool = await getPool();
    const r = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT Id AS id, FieldName AS fieldName, SortOrder AS sortOrder
      FROM dbo.ActivityCheckpoint
      WHERE ActivityId = @activityId
      ORDER BY SortOrder ASC, Id ASC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[activity-checkpoint] GET /:activityId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST / — add a checkpoint field to an activity, appended to the end of
// its list (next SortOrder = current max + 10, same spacing convention as
// RoomLayoutType).
router.post("/", authMiddleware, requirePageRight("work-checkpoint-master", "create"), async (req, res) => {
  const activityId = parseInt(req.body?.activityId, 10);
  const fieldName = String(req.body?.fieldName || "").trim();
  if (!Number.isFinite(activityId)) return res.status(400).json({ error: "activityId is required" });
  if (!fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const activityCheck = await pool.request().input("activityId", sql.Int, activityId)
      .query(`SELECT id FROM dbo.ActivityMaster WHERE id = @activityId AND activity_type = 1`);
    if (!activityCheck.recordset.length) return res.status(404).json({ error: "Activity not found" });

    const maxSort = await pool.request().input("activityId", sql.Int, activityId)
      .query(`SELECT ISNULL(MAX(SortOrder), 0) AS m FROM dbo.ActivityCheckpoint WHERE ActivityId = @activityId`);
    const nextSort = (maxSort.recordset[0].m || 0) + 10;

    const inserted = await pool.request()
      .input("activityId", sql.Int, activityId)
      .input("fieldName", sql.NVarChar(200), fieldName)
      .input("sortOrder", sql.Int, nextSort)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.ActivityCheckpoint (ActivityId, FieldName, SortOrder, CreatedBy)
        OUTPUT INSERTED.Id AS id, INSERTED.FieldName AS fieldName, INSERTED.SortOrder AS sortOrder
        VALUES (@activityId, @fieldName, @sortOrder, @createdBy)
      `);
    res.status(201).json(inserted.recordset[0]);
  } catch (err) {
    console.error("[activity-checkpoint] POST / error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — rename a checkpoint field.
router.patch("/:id", authMiddleware, requirePageRight("work-checkpoint-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fieldName = String(req.body?.fieldName || "").trim();
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  if (!fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("fieldName", sql.NVarChar(200), fieldName)
      .query(`UPDATE dbo.ActivityCheckpoint SET FieldName = @fieldName WHERE Id = @id`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Checkpoint not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[activity-checkpoint] PATCH /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — remove a checkpoint field. Hard delete — nothing yet
// records completions against an individual checkpoint row, so there's no
// history to preserve by soft-deleting instead.
router.delete("/:id", authMiddleware, requirePageRight("work-checkpoint-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const result = await pool.request().input("id", sql.Int, id)
      .query(`DELETE FROM dbo.ActivityCheckpoint WHERE Id = @id`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Checkpoint not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[activity-checkpoint] DELETE /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
