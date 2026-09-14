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
      SELECT Id AS id, FieldName AS fieldName, SortOrder AS sortOrder, MinWaitDays AS minWaitDays
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
  const minWaitDaysRaw = req.body?.minWaitDays;
  const minWaitDays = minWaitDaysRaw === null || minWaitDaysRaw === undefined || minWaitDaysRaw === ""
    ? null
    : parseInt(minWaitDaysRaw, 10);
  if (!Number.isFinite(activityId)) return res.status(400).json({ error: "activityId is required" });
  if (!fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });
  if (minWaitDays !== null && (!Number.isFinite(minWaitDays) || minWaitDays < 0)) {
    return res.status(400).json({ error: "minWaitDays must be a non-negative number" });
  }

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
      .input("minWaitDays", sql.Int, minWaitDays)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.ActivityCheckpoint (ActivityId, FieldName, SortOrder, MinWaitDays, CreatedBy)
        OUTPUT INSERTED.Id AS id, INSERTED.FieldName AS fieldName, INSERTED.SortOrder AS sortOrder, INSERTED.MinWaitDays AS minWaitDays
        VALUES (@activityId, @fieldName, @sortOrder, @minWaitDays, @createdBy)
      `);
    res.status(201).json(inserted.recordset[0]);
  } catch (err) {
    console.error("[activity-checkpoint] POST / error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — rename a checkpoint field and/or set its minimum wait
// duration. Both fields are independent — a caller sending only
// minWaitDays doesn't need to resend fieldName, and vice versa.
router.patch("/:id", authMiddleware, requirePageRight("work-checkpoint-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const hasFieldName = req.body?.fieldName !== undefined;
  const hasMinWaitDays = req.body?.minWaitDays !== undefined;
  if (!hasFieldName && !hasMinWaitDays) {
    return res.status(400).json({ error: "fieldName or minWaitDays is required" });
  }

  const fieldName = hasFieldName ? String(req.body.fieldName || "").trim() : null;
  if (hasFieldName && !fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (hasFieldName && fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });

  const minWaitDaysRaw = req.body?.minWaitDays;
  const minWaitDays = minWaitDaysRaw === null || minWaitDaysRaw === "" ? null : parseInt(minWaitDaysRaw, 10);
  if (hasMinWaitDays && minWaitDays !== null && (!Number.isFinite(minWaitDays) || minWaitDays < 0)) {
    return res.status(400).json({ error: "minWaitDays must be a non-negative number" });
  }

  try {
    const pool = await getPool();
    const setClauses = [];
    const request = pool.request().input("id", sql.Int, id);
    if (hasFieldName) {
      setClauses.push("FieldName = @fieldName");
      request.input("fieldName", sql.NVarChar(200), fieldName);
    }
    if (hasMinWaitDays) {
      setClauses.push("MinWaitDays = @minWaitDays");
      request.input("minWaitDays", sql.Int, minWaitDays);
    }
    const result = await request.query(`UPDATE dbo.ActivityCheckpoint SET ${setClauses.join(", ")} WHERE Id = @id`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Checkpoint not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[activity-checkpoint] PATCH /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — remove a checkpoint field. Hard delete — per-assignment
// completions (dbo.DependencyActivityCheckpoint, migration 338) snapshot
// FieldName/MinWaitDays at the time a checkpoint is added to a rung's
// checklist rather than referencing this row live, so removing the
// template here doesn't touch checklists already in progress.
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
