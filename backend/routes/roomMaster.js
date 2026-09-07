const allowRoles = require("../middleware/role");
const express = require("express");
const multer = require("multer");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const BLUEPRINT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

bumpCacheVersion("room-master").catch(() => {});

// GET all rooms
router.get("/", cache("room-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        r.Id,
        r.ProjectId,
        ep.name   AS ProjectName,
        r.BlockId,
        b.BlockName,
        r.UnitId,
        u.UnitName,
        r.RoomName,
        r.Floor,
        r.IsActive,
        r.BlueprintFileName,
        r.BlueprintMimeType,
        r.CreatedAt,
        r.UpdatedAt
      FROM dbo.RoomMaster r
      LEFT JOIN dbo.enterprise  ep ON ep.id = r.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  b ON b.Id  = r.BlockId
      LEFT JOIN dbo.UnitMaster   u ON u.Id  = r.UnitId
      ORDER BY ep.name, b.BlockName, u.UnitName, r.RoomName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects dropdown (enterprise where business_type = P)
router.get("/projects", cache("room-master-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET units dropdown — filtered by projectId query param.
// Each unit carries its BlockId + BlockName so the frontend can show which
// block the unit (and therefore the room) belongs to, without letting the
// user pick the block directly.
router.get("/units", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT
        u.Id,
        u.UnitName AS Name,
        u.ProjectId,
        u.BlockId,
        b.BlockName,
        u.UnitType
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
      WHERE u.IsActive = 1
    `;
    if (Number.isFinite(projectId) && projectId > 0) {
      request.input("ProjectId", sql.Int, projectId);
      query += ` AND u.ProjectId = @ProjectId`;
    }
    query += ` ORDER BY u.UnitName`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET /units error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add room
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, UnitId, RoomName, Floor, IsActive } = req.body;
  const createdBy = req.user?.userId || null;

  // ProjectId, UnitId and RoomName are NOT NULL columns with no fallback
  // default in the insert below. UnitId happens to be indirectly guarded by
  // the unit lookup just below (a missing/invalid id won't match any row),
  // but ProjectId and RoomName have no such protection and would otherwise
  // reach the INSERT and crash with an unhandled SQL "Cannot insert the
  // value NULL" 500. Same bug class found and fixed across
  // purchaseOrders.js, expenseBooking.js, workOrder.js, materialIssues.js,
  // chequeMasterSchemas.js, debitNote.js, and cardMasterSchemas.js during a
  // live-DB workflow test.
  if (!ProjectId) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!UnitId) {
    return res.status(400).json({ error: "UnitId is required." });
  }
  if (!RoomName || !String(RoomName).trim()) {
    return res.status(400).json({ error: "RoomName is required." });
  }

  try {
    const pool = getPool();

    // Block is never chosen by the user — derive it from the selected unit.
    const unitRow = await pool
      .request()
      .input("UnitId", sql.Int, parseInt(UnitId))
      .query("SELECT BlockId FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const BlockId = unitRow.recordset[0].BlockId;

    const insertRes = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockId, @UnitId, @RoomName, @Floor, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("room-master");
    res.json({ id: insertRes.recordset[0].Id, message: "Room added successfully" });
  } catch (err) {
    console.error("[room-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update room
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, UnitId, RoomName, Floor, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;

  // Same NOT NULL columns as POST / — this UPDATE overwrites them
  // unconditionally, so omitting any of them here would null out the
  // existing value and crash the same way the create path did before the
  // fix above.
  if (!ProjectId) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!UnitId) {
    return res.status(400).json({ error: "UnitId is required." });
  }
  if (!RoomName || !String(RoomName).trim()) {
    return res.status(400).json({ error: "RoomName is required." });
  }

  try {
    const pool = getPool();

    const unitRow = await pool
      .request()
      .input("UnitId", sql.Int, parseInt(UnitId))
      .query("SELECT BlockId FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const BlockId = unitRow.recordset[0].BlockId;

    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.RoomMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitId    = @UnitId,
          RoomName  = @RoomName,
          Floor     = @Floor,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("room-master");
    res.json({ message: "Room updated successfully" });
  } catch (err) {
    console.error("[room-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT RoomName FROM dbo.RoomMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Room not found" });
    const { RoomName } = existing.recordset[0];
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.RoomMaster WHERE Id = @Id");
    await bumpCacheVersion("room-master");
    res.json({ message: `Room "${RoomName}" deleted successfully` });
  } catch (err) {
    console.error("[room-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — upload (or replace) a room's blueprint. PDF, JPG, or PNG only.
router.post("/:id/blueprint", allowRoles("admin", "super_admin", "dba"), upload.single("file"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!BLUEPRINT_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: "Blueprint must be a PDF, JPG, or PNG file" });
  }
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT Id FROM dbo.RoomMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Room not found" });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("FileData", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
      .input("UploadedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.RoomMaster SET
          BlueprintFileName = @FileName,
          BlueprintMimeType = @MimeType,
          BlueprintFileData = @FileData,
          BlueprintUploadedAt = @UploadedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("room-master");
    res.json({ fileName: req.file.originalname });
  } catch (err) {
    console.error("[room-master] POST /:id/blueprint error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET — a room's blueprint as base64 JSON (not a raw stream). This is
// always reached through fetchWithAuth on the frontend, never a plain
// <a href> — the app's auth is a Bearer token attached only by
// fetchWithAuth's own header, so a bare link/navigation to this endpoint
// 401s with "No token provided". The frontend decodes the base64 into a
// Blob and opens/downloads that instead.
router.get("/:id/blueprint", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT BlueprintFileName, BlueprintMimeType, BlueprintFileData FROM dbo.RoomMaster WHERE Id = @Id");
    const row = result.recordset[0];
    if (!row || !row.BlueprintFileData)
      return res.status(404).json({ error: "No blueprint uploaded for this room" });
    res.json({
      fileName: row.BlueprintFileName,
      mimeType: row.BlueprintMimeType,
      dataBase64: row.BlueprintFileData,
    });
  } catch (err) {
    console.error("[room-master] GET /:id/blueprint error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /generate/:unitId — bulk-creates real dbo.RoomMaster rows from the
// unit's own BHK layout: UnitMaster.UnitType (set during the auto project
// setup flow's Unit Type template, e.g. "2 BHK") resolves to the matching
// RoomLayoutType/UnitRoomConfig template (see unitBhkConfig.js's own
// GET /room-instances/:unitId, which drives Work Reporting's synthetic Room
// dropdown) and each active RoomCategory x Quantity becomes a real
// "{Alias} {index}" row here. Room Master needs real rows — unlike Work
// Reporting's on-the-fly instances — because blueprints and Dependency
// Master scope attach to a specific RoomMaster.Id.
// Idempotent/additive, same convention as generate-units/generate-parking-
// slots: an existing active RoomName for this unit is left untouched, so
// re-running after growing the unit's template only fills in the gap.
router.post("/generate/:unitId", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId) || unitId <= 0) return res.status(400).json({ error: "Invalid unitId" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const unitRes = await pool.request().input("UnitId", sql.Int, unitId).query(`
      SELECT Id, ProjectId, BlockId, UnitType FROM dbo.UnitMaster WHERE Id = @UnitId AND IsActive = 1
    `);
    if (!unitRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const unit = unitRes.recordset[0];
    const typeKey = String(unit.UnitType || "").toUpperCase().replace(/\s+/g, "");
    if (!typeKey) {
      return res.status(400).json({
        error: "This unit has no Unit Type set — set one in Unit Master (or the auto project setup's Unit Type template) first.",
      });
    }

    const compRes = await pool.request().input("typeKey", sql.NVarChar(20), typeKey).query(`
      SELECT rc.Quantity AS quantity, cat.Alias AS alias
      FROM dbo.UnitRoomConfig cfg
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE cfg.BhkType = @typeKey AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
      ORDER BY cat.SortOrder ASC, cat.Alias ASC
    `);
    if (!compRes.recordset.length) {
      return res.status(400).json({
        error: `No room composition template set up for "${unit.UnitType}" yet — set one in Room Composition Builder first.`,
      });
    }

    const names = [];
    for (const row of compRes.recordset) {
      for (let i = 1; i <= row.quantity; i++) names.push(row.quantity > 1 ? `${row.alias} ${i}` : row.alias);
    }

    const existing = await pool.request().input("UnitId", sql.Int, unitId).query(`
      SELECT RoomName FROM dbo.RoomMaster WHERE UnitId = @UnitId AND IsActive = 1
    `);
    const existingLower = new Set(existing.recordset.map((r) => String(r.RoomName).toLowerCase()));

    let created = 0;
    for (const name of names) {
      if (existingLower.has(name.toLowerCase())) continue;
      await pool.request()
        .input("ProjectId", sql.Int, unit.ProjectId)
        .input("BlockId", sql.Int, unit.BlockId)
        .input("UnitId", sql.Int, unitId)
        .input("RoomName", sql.NVarChar(100), name)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime2(3), new Date())
        .query(`
          INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, IsActive, CreatedBy, CreatedAt)
          VALUES (@ProjectId, @BlockId, @UnitId, @RoomName, 1, @CreatedBy, @CreatedAt)
        `);
      created++;
    }

    if (created > 0) await bumpCacheVersion("room-master");
    res.json({
      message: created > 0 ? `${created} room(s) generated from ${unit.UnitType} layout` : "Every room from this layout already exists",
      createdCount: created,
      total: names.length,
    });
  } catch (err) {
    console.error("[room-master] POST /generate/:unitId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
