const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Master — a task scope (Project > Tower > Floor > Flat > Room)
// tagged with a user alias, Internal/External, and a strictly linear chain
// of Activity Master activities (no branching — see DependencyMasterActivity,
// migration 320).
//
// "Tower" = dbo.BlockMaster, "Flat" = dbo.UnitMaster (this codebase's own
// naming) — "Floor" has no master table of its own (dbo.RoomMaster.Floor is
// free text, migration 136), so the cascade below derives Floor options as
// the distinct Floor values among Rooms under the selected Tower, and
// derives Flat/Room options by additionally filtering on the chosen Floor.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /scope-options?level=tower|floor|flat|room&projectId=&towerId=&floor=&flatId= ──
router.get("/scope-options", authMiddleware, async (req, res) => {
  const level = String(req.query.level || "");
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  const towerId = req.query.towerId ? parseInt(req.query.towerId, 10) : null;
  const floor = req.query.floor ? String(req.query.floor) : null;
  const flatId = req.query.flatId ? parseInt(req.query.flatId, 10) : null;

  try {
    const pool = getPool();

    if (level === "tower") {
      if (!projectId) return res.status(400).json({ error: "projectId is required" });
      const r = await pool.request().input("ProjectId", sql.Int, projectId).query(`
        SELECT Id AS id, BlockName AS label
        FROM dbo.BlockMaster
        WHERE ProjectId = @ProjectId AND IsActive = 1
        ORDER BY BlockName
      `);
      return res.json(r.recordset);
    }

    if (level === "floor") {
      if (!towerId) return res.status(400).json({ error: "towerId is required" });
      const r = await pool.request().input("TowerId", sql.Int, towerId).query(`
        SELECT DISTINCT r.Floor AS label
        FROM dbo.RoomMaster r
        WHERE r.BlockId = @TowerId AND r.IsActive = 1 AND r.Floor IS NOT NULL AND LTRIM(RTRIM(r.Floor)) <> ''
        ORDER BY r.Floor
      `);
      return res.json(r.recordset.map((row) => ({ id: row.label, label: row.label })));
    }

    if (level === "flat") {
      if (!towerId || !floor) return res.status(400).json({ error: "towerId and floor are required" });
      const r = await pool.request().input("TowerId", sql.Int, towerId).input("Floor", sql.NVarChar(50), floor).query(`
        SELECT DISTINCT u.Id AS id, u.UnitName AS label
        FROM dbo.UnitMaster u
        JOIN dbo.RoomMaster r ON r.UnitId = u.Id
        WHERE u.BlockId = @TowerId AND r.Floor = @Floor AND u.IsActive = 1 AND r.IsActive = 1
        ORDER BY u.UnitName
      `);
      return res.json(r.recordset);
    }

    if (level === "room") {
      if (!flatId || !floor) return res.status(400).json({ error: "flatId and floor are required" });
      const r = await pool.request().input("FlatId", sql.Int, flatId).input("Floor", sql.NVarChar(50), floor).query(`
        SELECT Id AS id, RoomName AS label
        FROM dbo.RoomMaster
        WHERE UnitId = @FlatId AND Floor = @Floor AND IsActive = 1
        ORDER BY RoomName
      `);
      return res.json(r.recordset);
    }

    return res.status(400).json({ error: "level must be one of tower, floor, flat, room" });
  } catch (err) {
    console.error("[GET /dependency-master/scope-options]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list (resolved scope path + activity count) ────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT
        dm.Id AS id,
        dm.Alias AS alias,
        dm.WorkType AS workType,
        dm.IsActive AS isActive,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        dm.RoomId AS roomId, rm.RoomName AS roomName,
        dm.CreatedAt AS createdAt,
        (SELECT COUNT(*) FROM dbo.DependencyMasterActivity dma WHERE dma.DependencyMasterId = dm.Id) AS activityCount,
        -- Built server-side so the list row is ready to render as-is —
        -- the client shouldn't have to join 4 names together itself.
        CONCAT(
          ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor,
          ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—')
        ) AS scopePath
      FROM dbo.DependencyMaster dm
      LEFT JOIN dbo.enterprise   ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster   um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster   rm ON rm.Id = dm.RoomId
      ORDER BY dm.Id DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[GET /dependency-master]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single record with full activity chain ──────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const headRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT
        dm.Id AS id,
        dm.Alias AS alias,
        dm.WorkType AS workType,
        dm.IsActive AS isActive,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        dm.RoomId AS roomId, rm.RoomName AS roomName,
        dm.CreatedAt AS createdAt, dm.UpdatedAt AS updatedAt
      FROM dbo.DependencyMaster dm
      LEFT JOIN dbo.enterprise   ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster   um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster   rm ON rm.Id = dm.RoomId
      WHERE dm.Id = @Id
    `);
    if (!headRes.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    const activitiesRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT dma.Id AS rungId, dma.ActivityId AS activityId, am.activity_name AS activityName, dma.SequenceNo AS sequenceNo,
             dma.WorkType AS workType
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      WHERE dma.DependencyMasterId = @Id
      ORDER BY dma.SequenceNo ASC
    `);

    res.json({ ...headRes.recordset[0], activities: activitiesRes.recordset });
  } catch (err) {
    console.error("[GET /dependency-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

function validatePayload(body) {
  const { scope, alias, workType, activities } = body;
  if (!scope || !scope.projectId || !scope.towerId || !scope.floor || !scope.flatId || !scope.roomId) {
    return "Full scope (Project, Tower, Floor, Flat, Room) is required";
  }
  if (!alias || !String(alias).trim()) return "Alias is required";
  if (workType !== "INTERNAL" && workType !== "EXTERNAL") return "workType must be INTERNAL or EXTERNAL";
  if (!Array.isArray(activities) || activities.length === 0) return "At least one activity is required";
  return null;
}

// ── POST / — create ──────────────────────────────────────────────────────
router.post("/", authMiddleware, requirePageRight("dependency-master", "create"), async (req, res) => {
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const { scope, alias, workType, activities } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();
    const insertRes = await pool
      .request()
      .input("ProjectId", sql.Int, scope.projectId)
      .input("TowerId", sql.Int, scope.towerId)
      .input("Floor", sql.NVarChar(50), String(scope.floor))
      .input("FlatId", sql.Int, scope.flatId)
      .input("RoomId", sql.Int, scope.roomId)
      .input("Alias", sql.NVarChar(200), String(alias).trim())
      .input("WorkType", sql.NVarChar(20), workType)
      .input("CreatedBy", sql.NVarChar(300), actor).query(`
        INSERT INTO dbo.DependencyMaster
          (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id AS id
        VALUES
          (@ProjectId, @TowerId, @Floor, @FlatId, @RoomId, @Alias, @WorkType, @CreatedBy, SYSDATETIME())
      `);
    const newId = insertRes.recordset[0].id;

    for (let i = 0; i < activities.length; i++) {
      // Each rung freezes its own WorkType at the moment it's added — falls
      // back to the record's own WorkType only for older callers that don't
      // send one per activity.
      await pool
        .request()
        .input("DependencyMasterId", sql.Int, newId)
        .input("ActivityId", sql.Int, activities[i].activityId)
        .input("SequenceNo", sql.Int, i + 1)
        .input("WorkType", sql.NVarChar(20), activities[i].workType || workType)
        .query(`
          INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
          VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
        `);
    }

    res.status(201).json({ success: true, id: newId, message: "Dependency record created" });
  } catch (err2) {
    console.error("[POST /dependency-master]", err2);
    res.status(500).json({ error: err2.message });
  }
});

// ── PUT /:id — update (activities always delete+reinsert) ──────────────────
router.put("/:id", authMiddleware, requirePageRight("dependency-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const { scope, alias, workType, activities } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT Id FROM dbo.DependencyMaster WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("ProjectId", sql.Int, scope.projectId)
      .input("TowerId", sql.Int, scope.towerId)
      .input("Floor", sql.NVarChar(50), String(scope.floor))
      .input("FlatId", sql.Int, scope.flatId)
      .input("RoomId", sql.Int, scope.roomId)
      .input("Alias", sql.NVarChar(200), String(alias).trim())
      .input("WorkType", sql.NVarChar(20), workType)
      .input("UpdatedBy", sql.NVarChar(300), actor).query(`
        UPDATE dbo.DependencyMaster SET
          ProjectId = @ProjectId, TowerId = @TowerId, Floor = @Floor,
          FlatId = @FlatId, RoomId = @RoomId, Alias = @Alias, WorkType = @WorkType,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    await pool.request().input("Id", sql.Int, id).query(`DELETE FROM dbo.DependencyMasterActivity WHERE DependencyMasterId = @Id`);
    for (let i = 0; i < activities.length; i++) {
      await pool
        .request()
        .input("DependencyMasterId", sql.Int, id)
        .input("ActivityId", sql.Int, activities[i].activityId)
        .input("SequenceNo", sql.Int, i + 1)
        .input("WorkType", sql.NVarChar(20), activities[i].workType || workType)
        .query(`
          INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
          VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
        `);
    }

    res.json({ success: true, message: "Dependency record updated" });
  } catch (err2) {
    console.error("[PUT /dependency-master/:id]", err2);
    res.status(500).json({ error: err2.message });
  }
});

// ── DELETE /:id — hard delete ───────────────────────────────────────────
router.delete("/:id", authMiddleware, requirePageRight("dependency-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id).query(`SELECT Alias FROM dbo.DependencyMaster WHERE Id = @Id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Dependency record not found" });

    // Hard delete — DependencyMasterActivity rows cascade automatically
    // (FK_DependencyMasterActivity_Master ON DELETE CASCADE, migration 320).
    await pool.request().input("Id", sql.Int, id).query(`DELETE FROM dbo.DependencyMaster WHERE Id = @Id`);

    res.json({ success: true, message: `"${existing.recordset[0].Alias}" deleted` });
  } catch (err) {
    console.error("[DELETE /dependency-master/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
