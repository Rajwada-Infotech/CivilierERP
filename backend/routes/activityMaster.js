const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

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
//   gl_head_id        int NULL      → sql.Int   (migration 315, Activities only)
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
        am.id,
        am.activity_name,
        am.short_description,
        am.activity_type,
        am.group_id,
        am.is_active,
        am.created_by,
        am.created_datetime,
        am.approved_by,
        am.approved_at,
        am.updated_by,
        am.updated_at,
        am.belongsTo,
        am.hsn_code,
        am.gl_head_id,
        gl.LHeadName AS gl_head_name
      FROM dbo.ActivityMaster am
      LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = am.gl_head_id
      ORDER BY am.id ASC
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
          am.id,
          am.activity_name,
          am.short_description,
          am.activity_type,
          am.group_id,
          am.is_active,
          am.created_by,
          am.created_datetime,
          am.approved_by,
          am.approved_at,
          am.updated_by,
          am.updated_at,
          am.belongsTo,
          am.hsn_code,
          am.gl_head_id,
          gl.LHeadName AS gl_head_name
        FROM dbo.ActivityMaster am
        LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = am.gl_head_id
        WHERE am.id = @id
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
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type, // 0 = Group, 1 = Activity
    group_id,
    is_active,
    hsn_code, // only for Activity (activity_type === 1)
    gl_head_id, // only for Activity (activity_type === 1)
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
  // activity_type === 0 (Group)    → group_id = NULL,  belongsTo = NULL, hsn_code/gl_head_id = NULL
  // activity_type === 1 (Activity) → group_id = INT,   belongsTo = String(group_id), hsn_code/gl_head_id = optional
  const resolvedGroupId = activity_type === 1 ? group_id || null : null;
  const resolvedBelongsTo =
    activity_type === 1 ? (group_id ? String(group_id) : null) : null;
  const resolvedHsnCode = activity_type === 1 ? hsn_code || null : null;
  const resolvedGlHeadId = activity_type === 1 ? gl_head_id || null : null;

  try {
    const pool = getPool();
    const now = new Date();
    const userEmail = req.user?.email || null;

    const insertResult = await pool
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
      .input("gl_head_id", sql.Int, resolvedGlHeadId) // null for Groups
      .query(`
        INSERT INTO dbo.ActivityMaster
          (activity_name, short_description, activity_type, group_id,
           is_active, created_by, created_datetime, belongsTo, hsn_code,
           gl_head_id)
        OUTPUT INSERTED.id AS id
        VALUES
          (@activity_name, @short_description, @activity_type, @group_id,
           @is_active, @created_by, @created_datetime, @belongsTo, @hsn_code,
           @gl_head_id)
      `);

    await bumpCacheVersion("activity-master");
    res.status(201).json({
      message: "Activity added successfully",
      id: insertResult.recordset[0].id,
    });
  } catch (err) {
    console.error("[POST /activity-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT (Update) ─────────────────────────────────────────────────────────────
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type, // 0 = Group, 1 = Activity
    group_id,
    is_active,
    hsn_code, // only for Activity (activity_type === 1)
    gl_head_id, // only for Activity (activity_type === 1)
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
  // activity_type === 0 (Group)    → group_id = NULL,  belongsTo = NULL, hsn_code/gl_head_id = NULL
  // activity_type === 1 (Activity) → group_id = INT,   belongsTo = String(group_id), hsn_code/gl_head_id = optional
  const resolvedGroupId =
    activity_type === 1 ? (group_id ? group_id : null) : null;
  const resolvedBelongsTo =
    activity_type === 1 ? (group_id ? String(group_id) : null) : null;
  const resolvedHsnCode = activity_type === 1 ? hsn_code || null : null;
  const resolvedGlHeadId = activity_type === 1 ? gl_head_id || null : null;

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
      .input("gl_head_id", sql.Int, resolvedGlHeadId) // null for Groups
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
          hsn_code          = @hsn_code,
          gl_head_id        = @gl_head_id
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
router.patch("/:id/approve", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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




