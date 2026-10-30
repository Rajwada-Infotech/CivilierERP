const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { requireApprover } = require("../middleware/requireApprover");

// Checks shared by create and update. Returns the reason the activity can't be saved, or null.
//  - an Activity belongs to an existing Group (BOQ and Work Order pick the group first, so an ungrouped
//    activity could never be chosen there)
//  - names don't repeat inside a group, or among groups
//  - a Group that still has activities under it can't be turned into an Activity (they'd be left without a group)
async function whyNot(pool, { id, name, type, groupId }) {
  if (type === 1) {
    if (!groupId) return "Pick the group this activity belongs to.";
    const g = await pool.request().input("gid", sql.Int, groupId)
      .query("SELECT activity_type FROM dbo.EngineeringActivityMaster WHERE id = @gid");
    if (!g.recordset.length || g.recordset[0].activity_type !== 0) return "The group picked no longer exists.";
  }
  const dup = await pool.request()
    .input("name", sql.NVarChar(255), name)
    .input("type", sql.TinyInt, type)
    .input("gid", sql.Int, type === 1 ? groupId : null)
    .input("id", sql.Int, id || null).query(`
      SELECT TOP 1 id FROM dbo.EngineeringActivityMaster
      WHERE LTRIM(RTRIM(activity_name)) = @name AND activity_type = @type
        AND ((@gid IS NULL AND group_id IS NULL) OR group_id = @gid)
        AND (@id IS NULL OR id <> @id)`);
  if (dup.recordset.length) {
    return type === 0 ? `There is already a group named "${name}".` : `This group already has an activity named "${name}".`;
  }
  if (id && type === 1) {
    const kids = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(1) AS n FROM dbo.EngineeringActivityMaster WHERE group_id = @id AND activity_type = 1");
    if (kids.recordset[0].n > 0) return `This group has ${kids.recordset[0].n} activit${kids.recordset[0].n === 1 ? "y" : "ies"} under it; move or delete them before making it an activity.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engineering's own Activity Master — a clone of dbo.ActivityMaster
// (backend/routes/activityMaster.js), split out (migration 463) so
// Engineering (BOQ, Work Order) and Civil Work DPR can each edit their own
// activity list independently instead of sharing one. Seeded from a
// snapshot of dbo.ActivityMaster at split time, same ids preserved — from
// here on the two tables are fully separate.
//
// DB Schema (same shape as dbo.ActivityMaster):
//   activity_name     nvarchar(255)
//   short_description nvarchar(255)
//   activity_type     tinyint       → sql.TinyInt
//   group_id          int           → sql.Int
//   is_active         bit           → sql.Bit
//   created_by        nvarchar(300) → sql.NVarChar(300)
//   updated_by        nvarchar(300) → sql.NVarChar(300)
//   approved_by       nvarchar(300) → sql.NVarChar(300)
//   belongsTo         nvarchar(200) → sql.NVarChar(200)
//   gl_head_id        int NULL      → sql.Int   (Activities only)
//
// activity_type:  0 = Group    → group_id = NULL,      belongsTo = NULL
// activity_type:  1 = Activity → group_id = INT id,    belongsTo = String(group_id)
// ─────────────────────────────────────────────────────────────────────────────

// ─── GET ALL ─────────────────────────────────────────────────────────────────
router.get("/", cache("engineering-activity-master", 300), async (req, res) => {
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
      FROM dbo.EngineeringActivityMaster am
      LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = am.gl_head_id
      ORDER BY am.id ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[GET /engineering-activity-master]", err);
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
        FROM dbo.EngineeringActivityMaster am
        LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = am.gl_head_id
        WHERE am.id = @id
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Activity not found" });

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[GET /engineering-activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST (Create) ────────────────────────────────────────────────────────────
router.post("/", requirePageRight("engineering-activity-master", "create"), async (req, res) => {
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
    const reason = await whyNot(pool, { id: null, name: activity_name.trim(), type: activity_type, groupId: resolvedGroupId });
    if (reason) return res.status(400).json({ error: reason });
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
        INSERT INTO dbo.EngineeringActivityMaster
          (activity_name, short_description, activity_type, group_id,
           is_active, created_by, created_datetime, belongsTo, hsn_code,
           gl_head_id)
        OUTPUT INSERTED.id AS id
        VALUES
          (@activity_name, @short_description, @activity_type, @group_id,
           @is_active, @created_by, @created_datetime, @belongsTo, @hsn_code,
           @gl_head_id)
      `);

    await bumpCacheVersion("engineering-activity-master");
    res.status(201).json({
      message: "Activity added successfully",
      id: insertResult.recordset[0].id,
    });
  } catch (err) {
    console.error("[POST /engineering-activity-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT (Update) ─────────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("engineering-activity-master", "edit"), async (req, res) => {
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
  const resolvedGroupId =
    activity_type === 1 ? (group_id ? group_id : null) : null;
  const resolvedBelongsTo =
    activity_type === 1 ? (group_id ? String(group_id) : null) : null;
  const resolvedHsnCode = activity_type === 1 ? hsn_code || null : null;
  const resolvedGlHeadId = activity_type === 1 ? gl_head_id || null : null;

  try {
    const pool = getPool();
    const reason = await whyNot(pool, { id: parseInt(req.params.id, 10), name: activity_name.trim(), type: activity_type, groupId: resolvedGroupId });
    if (reason) return res.status(400).json({ error: reason });
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
        UPDATE dbo.EngineeringActivityMaster SET
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

    await bumpCacheVersion("engineering-activity-master");
    res.json({ message: "Activity updated successfully" });
  } catch (err) {
    console.error("[PUT /engineering-activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH (Approve) ──────────────────────────────────────────────────────────
router.patch("/:id/approve", requireApprover("engineering-activity-master", "engineering activities"), async (req, res) => {
  try {
    const pool = getPool();
    const now = new Date();
    const userEmail = req.user?.email || null;

    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("approved_by", sql.NVarChar(300), userEmail) // nvarchar(300)
      .input("approved_at", sql.DateTime2, now).query(`
        UPDATE dbo.EngineeringActivityMaster SET
          approved_by = @approved_by,
          approved_at = @approved_at
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Activity not found" });

    await bumpCacheVersion("engineering-activity-master");
    res.json({ message: "Activity approved successfully" });
  } catch (err) {
    console.error("[PATCH /engineering-activity-master/:id/approve]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("engineering-activity-master", "delete"), async (req, res) => {
  let tx;
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    // Deleting is for mistakes. A group with activities under it, or an activity a BOQ or work order already uses,
    // stays: deleting it left those lines pointing at nothing (their activity name went blank). Mark it inactive.
    const use = (
      await pool.request().input("id", sql.Int, id).query(`
        SELECT
          (SELECT COUNT(1) FROM dbo.EngineeringActivityMaster WHERE group_id = @id AND activity_type = 1) AS children,
          (SELECT COUNT(DISTINCT BoqID) FROM dbo.BoqActivities WHERE ActivityId = @id OR GroupId = @id)
            + (SELECT COUNT(DISTINCT BoqID) FROM dbo.BoqItems WHERE ActivityId = @id) AS boqs,
          (SELECT COUNT(DISTINCT WorkOrderHeaderId) FROM dbo.WorkOrderActivities WHERE ActivityId = @id OR ActivityGroupId = @id) AS wos`)
    ).recordset[0];
    if (use.children > 0) {
      return res.status(409).json({ error: `This group has ${use.children} activit${use.children === 1 ? "y" : "ies"} under it. Delete or move them first, or mark the group inactive.` });
    }
    if (use.boqs > 0 || use.wos > 0) {
      const where = [use.boqs && `${use.boqs} BOQ${use.boqs === 1 ? "" : "s"}`, use.wos && `${use.wos} work order${use.wos === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
      return res.status(409).json({ error: `Used on ${where}, so it can't be deleted. Mark it inactive instead.` });
    }

    tx = pool.transaction();
    await tx.begin();
    await tx.request().input("id", sql.Int, id).query("DELETE FROM dbo.EngineeringActivityItems WHERE ActivityId = @id");
    const result = await tx.request().input("id", sql.Int, id).query("DELETE FROM dbo.EngineeringActivityMaster WHERE id = @id");
    if (result.rowsAffected[0] === 0) {
      await tx.rollback();
      return res.status(404).json({ error: "Activity not found" });
    }
    await tx.commit();

    await bumpCacheVersion("engineering-activity-master");
    res.json({ message: "Activity deleted successfully" });
  } catch (err) {
    try {
      if (tx) await tx.rollback();
    } catch {
      /* already rolled back */
    }
    console.error("[DELETE /engineering-activity-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
