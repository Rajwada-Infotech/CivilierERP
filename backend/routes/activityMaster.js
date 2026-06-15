const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { validateBody } = require("../middleware/validateBody");
const { activityBodySchema } = require("../validation/masterDataSchemas");

// ─────────────────────────────────────────────────────────────────────────────
// DB Schema (from sp_help):
//   activity_name     nvarchar(510) → sql.NVarChar(255)
//   short_description nvarchar(510) → sql.NVarChar(255)
//   activity_type     tinyint       → sql.TinyInt
//   group_id          int           → sql.Int
//   is_active         bit           → sql.Bit
//   created_by        nvarchar(300) → sql.NVarChar(300)
//   updated_by        nvarchar(300) → sql.NVarChar(300)
//   approved_by       nvarchar(300) → sql.NVarChar(300)
//   belongsTo         nvarchar(200) → sql.NVarChar(200)
//
// activity_type:  0 = Group    → group_id = NULL,      belongsTo = NULL
// activity_type:  1 = Activity → group_id = INT id,    belongsTo = String(group_id)
// ─────────────────────────────────────────────────────────────────────────────

// ─── GET ALL ─────────────────────────────────────────────────────────────────
router.get("/", cache("activity-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        id,
        activity_name,
        short_description,
        activity_type,
        group_id,
        is_active,
        created_by,
        created_datetime,
        approved_by,
        approved_at,
        updated_by,
        updated_at,
        belongsTo,
        hsn_code
      FROM dbo.ActivityMaster
      ORDER BY id ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /activity-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET BY ID ───────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT
          id,
          activity_name,
          short_description,
          activity_type,
          group_id,
          is_active,
          created_by,
          created_datetime,
          approved_by,
          approved_at,
          updated_by,
          updated_at,
          belongsTo,
          hsn_code
        FROM dbo.ActivityMaster
        WHERE id = @id
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Activity not found" });

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[GET /activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST (Create) ────────────────────────────────────────────────────────────
router.post("/", validateBody(activityBodySchema), async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type, // 0 = Group, 1 = Activity
    group_id,
    is_active,
    hsn_code, // only for Activity (activity_type === 1)
  } = req.body;

  // ── Validation ───────────────────────────────────────────────────────────
  if (!activity_name || activity_name.trim() === "") {
    return res.status(400).json({ error: "activity_name is required" });
  }
  if (activity_type === undefined || activity_type === null) {
    return res
      .status(400)
      .json({ error: "activity_type is required (0=Group, 1=Activity)" });
  }

  // ── belongsTo logic ───────────────────────────────────────────────────────
  // activity_type === 0 (Group)    → group_id = NULL,  belongsTo = NULL, hsn_code = NULL
  // activity_type === 1 (Activity) → group_id = INT,   belongsTo = String(group_id), hsn_code = optional
  const resolvedGroupId = activity_type === 1 ? group_id || null : null;
  const resolvedBelongsTo =
    activity_type === 1 ? (group_id ? String(group_id) : null) : null;
  const resolvedHsnCode = activity_type === 1 ? hsn_code || null : null;

  try {
    const pool = getPool();
    const now = new Date();
    const userEmail = req.user?.email || null;

    await pool
      .request()
      .input("activity_name", sql.NVarChar(255), activity_name.trim())
      .input("short_description", sql.NVarChar(255), short_description || null)
      .input("activity_type", sql.TinyInt, activity_type)
      .input("group_id", sql.Int, resolvedGroupId) // INT column
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("created_by", sql.NVarChar(300), userEmail) // nvarchar(300)
      .input("created_datetime", sql.DateTime2, now)
      .input("belongsTo", sql.NVarChar(200), resolvedBelongsTo) // nvarchar(200) — group id as string
      .input("hsn_code", sql.NVarChar(50), resolvedHsnCode) // nvarchar(50) — null for Groups
      .query(`
        INSERT INTO dbo.ActivityMaster
          (activity_name, short_description, activity_type, group_id,
           is_active, created_by, created_datetime, belongsTo, hsn_code)
        VALUES
          (@activity_name, @short_description, @activity_type, @group_id,
           @is_active, @created_by, @created_datetime, @belongsTo, @hsn_code)
      `);

    await bumpCacheVersion("activity-master");
    res.status(201).json({ message: "Activity added successfully" });
  } catch (err) {
    console.error("[POST /activity-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT (Update) ─────────────────────────────────────────────────────────────
router.put("/:id", validateBody(activityBodySchema), async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type, // 0 = Group, 1 = Activity
    group_id,
    is_active,
    hsn_code, // only for Activity (activity_type === 1)
  } = req.body;

  // ── Validation ───────────────────────────────────────────────────────────
  if (!activity_name || activity_name.trim() === "") {
    return res.status(400).json({ error: "activity_name is required" });
  }
  if (activity_type === undefined || activity_type === null) {
    return res
      .status(400)
      .json({ error: "activity_type is required (0=Group, 1=Activity)" });
  }

  // ── belongsTo logic ───────────────────────────────────────────────────────
  // activity_type === 0 (Group)    → group_id = NULL,  belongsTo = NULL, hsn_code = NULL
  // activity_type === 1 (Activity) → group_id = INT,   belongsTo = String(group_id), hsn_code = optional
  const resolvedGroupId =
    activity_type === 1 ? (group_id ? group_id : null) : null;
  const resolvedBelongsTo =
    activity_type === 1 ? (group_id ? String(group_id) : null) : null;
  const resolvedHsnCode = activity_type === 1 ? hsn_code || null : null;

  try {
    const pool = getPool();
    const now = new Date();
    const userEmail = req.user?.email || null;

    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("activity_name", sql.NVarChar(255), activity_name.trim())
      .input("short_description", sql.NVarChar(255), short_description || null)
      .input("activity_type", sql.TinyInt, activity_type)
      .input("group_id", sql.Int, resolvedGroupId) // INT column
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("updated_by", sql.NVarChar(300), userEmail) // nvarchar(300)
      .input("updated_at", sql.DateTime2, now)
      .input("belongsTo", sql.NVarChar(200), resolvedBelongsTo) // nvarchar(200) — group id as string
      .input("hsn_code", sql.NVarChar(50), resolvedHsnCode) // nvarchar(50) — null for Groups
      .query(`
        UPDATE dbo.ActivityMaster SET
          activity_name     = @activity_name,
          short_description = @short_description,
          activity_type     = @activity_type,
          group_id          = @group_id,
          is_active         = @is_active,
          updated_by        = @updated_by,
          updated_at        = @updated_at,
          belongsTo         = @belongsTo,
          hsn_code          = @hsn_code
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Activity not found" });

    await bumpCacheVersion("activity-master");
    res.json({ message: "Activity updated successfully" });
  } catch (err) {
    console.error("[PUT /activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH (Approve) ──────────────────────────────────────────────────────────
router.patch("/:id/approve", async (req, res) => {
  try {
    const pool = getPool();
    const now = new Date();
    const userEmail = req.user?.email || null;

    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("approved_by", sql.NVarChar(300), userEmail) // nvarchar(300)
      .input("approved_at", sql.DateTime2, now).query(`
        UPDATE dbo.ActivityMaster SET
          approved_by = @approved_by,
          approved_at = @approved_at
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Activity not found" });

    await bumpCacheVersion("activity-master");
    res.json({ message: "Activity approved successfully" });
  } catch (err) {
    console.error("[PATCH /activity-master/:id/approve]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.ActivityMaster WHERE id = @id");

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Activity not found" });

    await bumpCacheVersion("activity-master");
    res.json({ message: "Activity deleted successfully" });
  } catch (err) {
    console.error("[DELETE /activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;