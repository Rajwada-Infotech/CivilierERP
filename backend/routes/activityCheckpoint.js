const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// Work Checkpoint Master is ONE general, reusable catalog of checkpoints
// (migration 461) — not a list per activity. dbo.ActivityCheckpoint.ActivityId
// is kept (nullable) for history but no longer used on this table itself.
//
// Which of the catalog's checkpoints apply to a given Activity is configured
// separately, in Activity Master, via dbo.ActivityCheckpointTemplate
// (migration 469, see the /template/:activityId routes below) — this is
// what restores migration 337's original per-activity intent without going
// back to one non-reusable checkpoint row per activity. A rung's assignment
// auto-seeds its own checklist from that template the first time it's
// viewed (dependencyActivityAssignment.js's GET /:rungId); Work Allocation
// then only shows it read-only, and Work Reporting is where the actual
// check-off happens.

function parseMinWaitDays(raw) {
  if (raw === null || raw === undefined || raw === "") return { value: null };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return { error: "minWaitDays must be a non-negative number" };
  return { value: n };
}

// GET / — every checkpoint, in display order.
async function listCheckpoints(_req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT Id AS id, FieldName AS fieldName, SortOrder AS sortOrder, MinWaitDays AS minWaitDays,
             CAST(IsDaily AS BIT) AS isDaily
      FROM dbo.ActivityCheckpoint
      ORDER BY SortOrder ASC, Id ASC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[activity-checkpoint] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.get("/", authMiddleware, listCheckpoints);
// Older clients asked for a specific activity's list (GET /:activityId). There is
// no per-activity list any more, so they get the general one.
router.get("/:activityId", authMiddleware, listCheckpoints);

async function nameTaken(pool, fieldName, exceptId) {
  const r = await pool.request()
    .input("name", sql.NVarChar(200), fieldName)
    .input("except", sql.Int, exceptId ?? null)
    .query(`
      SELECT TOP 1 Id FROM dbo.ActivityCheckpoint
      WHERE LOWER(LTRIM(RTRIM(FieldName))) = LOWER(@name) AND (@except IS NULL OR Id <> @except)
    `);
  return r.recordset.length > 0;
}

// POST / — add a checkpoint to the general list, appended to the end
// (next SortOrder = current max + 10).
router.post("/", authMiddleware, requirePageRight("work-checkpoint-master", "create"), async (req, res) => {
  const fieldName = String(req.body?.fieldName || "").trim();
  if (!fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });
  const wait = parseMinWaitDays(req.body?.minWaitDays);
  if (wait.error) return res.status(400).json({ error: wait.error });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    if (await nameTaken(pool, fieldName, null)) {
      return res.status(409).json({ error: `"${fieldName}" is already in the checkpoint list.` });
    }

    const maxSort = await pool.request().query(`SELECT ISNULL(MAX(SortOrder), 0) AS m FROM dbo.ActivityCheckpoint`);
    const nextSort = (maxSort.recordset[0].m || 0) + 10;

    const inserted = await pool.request()
      .input("fieldName", sql.NVarChar(200), fieldName)
      .input("sortOrder", sql.Int, nextSort)
      .input("minWaitDays", sql.Int, wait.value)
      .input("isDaily", sql.Bit, req.body?.isDaily ? 1 : 0)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.ActivityCheckpoint (ActivityId, FieldName, SortOrder, MinWaitDays, IsDaily, CreatedBy)
        OUTPUT INSERTED.Id AS id, INSERTED.FieldName AS fieldName, INSERTED.SortOrder AS sortOrder,
               INSERTED.MinWaitDays AS minWaitDays, CAST(INSERTED.IsDaily AS BIT) AS isDaily
        VALUES (NULL, @fieldName, @sortOrder, @minWaitDays, @isDaily, @createdBy)
      `);
    res.status(201).json(inserted.recordset[0]);
  } catch (err) {
    console.error("[activity-checkpoint] POST / error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — rename a checkpoint, set its minimum wait duration and/or its
// "daily update" flag. All independent — send only what changed.
router.patch("/:id", authMiddleware, requirePageRight("work-checkpoint-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const hasFieldName = req.body?.fieldName !== undefined;
  const hasMinWaitDays = req.body?.minWaitDays !== undefined;
  const hasIsDaily = req.body?.isDaily !== undefined;
  if (!hasFieldName && !hasMinWaitDays && !hasIsDaily) {
    return res.status(400).json({ error: "fieldName, minWaitDays or isDaily is required" });
  }

  const fieldName = hasFieldName ? String(req.body.fieldName || "").trim() : null;
  if (hasFieldName && !fieldName) return res.status(400).json({ error: "fieldName is required" });
  if (hasFieldName && fieldName.length > 200) return res.status(400).json({ error: "fieldName must be 200 characters or fewer" });

  const wait = hasMinWaitDays ? parseMinWaitDays(req.body.minWaitDays) : { value: null };
  if (wait.error) return res.status(400).json({ error: wait.error });

  try {
    const pool = await getPool();
    if (hasFieldName && (await nameTaken(pool, fieldName, id))) {
      return res.status(409).json({ error: `"${fieldName}" is already in the checkpoint list.` });
    }
    const setClauses = [];
    const request = pool.request().input("id", sql.Int, id);
    if (hasFieldName) {
      setClauses.push("FieldName = @fieldName");
      request.input("fieldName", sql.NVarChar(200), fieldName);
    }
    if (hasMinWaitDays) {
      setClauses.push("MinWaitDays = @minWaitDays");
      request.input("minWaitDays", sql.Int, wait.value);
    }
    if (hasIsDaily) {
      setClauses.push("IsDaily = @isDaily");
      request.input("isDaily", sql.Bit, req.body.isDaily ? 1 : 0);
    }
    const result = await request.query(`UPDATE dbo.ActivityCheckpoint SET ${setClauses.join(", ")} WHERE Id = @id`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Checkpoint not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[activity-checkpoint] PATCH /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — remove a checkpoint. Hard delete — per-assignment completions
// (dbo.DependencyActivityCheckpoint, migration 338) snapshot FieldName/MinWaitDays
// when a checkpoint is added to a rung's checklist rather than referencing this
// row live, so removing it here doesn't touch checklists already in progress.
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

// ── Per-Activity checkpoint template ────────────────────────────────────────
// Which of the general catalog's checkpoints apply to a given Activity
// (dbo.ActivityMaster) — configured once, in Activity Master. A rung's
// assignment auto-seeds its own checklist from this the first time it's
// viewed (see dependencyActivityAssignment.js's GET /:rungId).

// GET /template/:activityId — the activity's configured checkpoints.
router.get("/template/:activityId", authMiddleware, async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);
  if (!Number.isFinite(activityId)) return res.status(400).json({ error: "Invalid activityId" });
  try {
    const pool = await getPool();
    const r = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT t.Id AS linkId, c.Id AS id, c.FieldName AS fieldName, t.SortOrder AS sortOrder,
             c.MinWaitDays AS minWaitDays, CAST(c.IsDaily AS BIT) AS isDaily
      FROM dbo.ActivityCheckpointTemplate t
      JOIN dbo.ActivityCheckpoint c ON c.Id = t.CheckpointId
      WHERE t.ActivityId = @activityId
      ORDER BY t.SortOrder ASC, t.Id ASC
    `);
    res.json(r.recordset.map((row) => ({ ...row, isDaily: !!row.isDaily })));
  } catch (err) {
    console.error("[activity-checkpoint] GET /template/:activityId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /template/:activityId — attach a catalog checkpoint to this activity.
router.post("/template/:activityId", authMiddleware, requirePageRight("dpr-activity-master", "edit"), async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);
  if (!Number.isFinite(activityId)) return res.status(400).json({ error: "Invalid activityId" });
  const checkpointId = parseInt(req.body?.checkpointId, 10);
  if (!Number.isFinite(checkpointId)) return res.status(400).json({ error: "checkpointId is required" });
  try {
    const pool = await getPool();
    const dup = await pool.request().input("activityId", sql.Int, activityId).input("checkpointId", sql.Int, checkpointId)
      .query(`SELECT TOP 1 Id FROM dbo.ActivityCheckpointTemplate WHERE ActivityId = @activityId AND CheckpointId = @checkpointId`);
    if (dup.recordset.length) return res.status(409).json({ error: "This checkpoint is already attached to the activity." });

    const maxSort = await pool.request().input("activityId", sql.Int, activityId)
      .query(`SELECT ISNULL(MAX(SortOrder), 0) AS m FROM dbo.ActivityCheckpointTemplate WHERE ActivityId = @activityId`);
    const nextSort = (maxSort.recordset[0].m || 0) + 10;
    const actor = req.user?.email || req.user?.name || "system";

    const inserted = await pool.request()
      .input("activityId", sql.Int, activityId)
      .input("checkpointId", sql.Int, checkpointId)
      .input("sortOrder", sql.Int, nextSort)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.ActivityCheckpointTemplate (ActivityId, CheckpointId, SortOrder, CreatedBy)
        OUTPUT INSERTED.Id AS linkId
        VALUES (@activityId, @checkpointId, @sortOrder, @createdBy)
      `);
    res.status(201).json({ linkId: inserted.recordset[0].linkId });
  } catch (err) {
    console.error("[activity-checkpoint] POST /template/:activityId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /template/:activityId/:linkId — detach one.
router.delete("/template/:activityId/:linkId", authMiddleware, requirePageRight("dpr-activity-master", "edit"), async (req, res) => {
  const linkId = parseInt(req.params.linkId, 10);
  if (!Number.isFinite(linkId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const result = await pool.request().input("id", sql.Int, linkId)
      .query(`DELETE FROM dbo.ActivityCheckpointTemplate WHERE Id = @id`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[activity-checkpoint] DELETE /template/:activityId/:linkId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
