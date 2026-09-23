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

// GET all rooms — supports optional ?unitId=X and ?activeOnly=1 filters
// so callers like locationMasterApi can fetch only the rooms they need
// instead of loading the entire table (which scales poorly for large projects).
router.get("/", cache("room-master", 300), async (req, res) => {
  const unitId    = parseInt(req.query.unitId, 10);
  const activeOnly = req.query.activeOnly === "1";
  try {
    const pool = getPool();
    const request = pool.request();
    let where = "WHERE 1=1";
    if (Number.isFinite(unitId) && unitId > 0) {
      request.input("UnitId", sql.Int, unitId);
      where += " AND r.UnitId = @UnitId";
    }
    if (activeOnly) {
      where += " AND r.IsActive = 1";
    }
    const result = await request.query(`
      SELECT
        r.Id,
        r.ProjectId,
        ep.name   AS ProjectName,
        r.BlockId,
        b.BlockName,
        r.UnitId,
        u.UnitName,
        r.RoomName,
        r.RoomCategoryId,
        cat.Alias AS RoomCategoryAlias,
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
      LEFT JOIN dbo.RoomCategoryMaster cat ON cat.Id = r.RoomCategoryId
      ${where}
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
router.get("/units", cache("room-master-units", 300), async (req, res) => {
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
        u.UnitType,
        u.FloorNo
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

// GET /structure?projectId= — the Block > Floor scaffold Flat Master's tree
// browses, reusing the same dbo.CrmProjectAutoSetupFloor rows the CRM Auto
// Project Setup wizard maintains (Blocks/Floors/Units all live upstream of
// this page — Flat Master only tags real rooms onto units that already
// exist). Deliberately NOT gated behind "crm-auto-project-setup" rights
// (requirePageRight elsewhere in this file's GETs isn't used at all) so
// anyone with Flat Master access can browse the tree without also needing
// CRM Auto Setup access.
router.get("/structure", cache("room-master-structure", 120), async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  if (!Number.isFinite(projectId) || projectId <= 0) return res.status(400).json({ error: "projectId is required" });
  try {
    const pool = getPool();
    const blocks = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT Id, BlockName FROM dbo.BlockMaster WHERE ProjectId = @pid AND IsActive = 1 ORDER BY BlockName
    `);
    const floors = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT
        f.Id, f.BlockId, f.FloorNo, f.FloorLabel,
        (SELECT COUNT(*) FROM dbo.UnitMaster u
         WHERE u.BlockId = f.BlockId AND u.IsActive = 1
           AND ((f.FloorNo = -1 AND u.FloorNo IS NULL) OR (f.FloorNo <> -1 AND u.FloorNo = f.FloorNo))
        ) AS UnitCount
      FROM dbo.CrmProjectAutoSetupFloor f
      WHERE f.ProjectId = @pid AND f.IsActive = 1
      ORDER BY f.BlockId, f.FloorNo
    `);
    res.json({ blocks: blocks.recordset, floors: floors.recordset });
  } catch (err) {
    console.error("[room-master] GET /structure error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /floor-units/:floorId — the real Units generated on this floor (Unit
// Master's own data, same source the auto-setup wizard writes to), each
// annotated with how many of its template's rooms already have a real
// RoomMaster row vs. how many the template calls for — so the tree can show
// a "4/6 rooms" progress badge per unit without a per-unit round trip.
router.get("/floor-units/:floorId", async (req, res) => {
  const floorId = parseInt(req.params.floorId, 10);
  if (!Number.isFinite(floorId) || floorId <= 0) return res.status(400).json({ error: "Invalid floorId" });
  try {
    const pool = getPool();
    const floorRes = await pool.request().input("id", sql.Int, floorId)
      .query("SELECT BlockId, FloorNo FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id AND IsActive = 1");
    if (!floorRes.recordset.length) return res.status(404).json({ error: "Floor not found" });
    const { BlockId, FloorNo } = floorRes.recordset[0];

    const request = pool.request().input("bid", sql.Int, BlockId);
    const floorFilter = FloorNo === -1 ? "u.FloorNo IS NULL" : "u.FloorNo = @fno";
    if (FloorNo !== -1) request.input("fno", sql.Int, FloorNo);

    const result = await request.query(`
      SELECT
        u.Id, u.UnitName, u.FloorNo, u.UnitType,
        (SELECT COUNT(*) FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1) AS GeneratedRoomCount,
        (
          SELECT SUM(rc.Quantity) FROM dbo.UnitRoomConfig cfg
          JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
          JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
          WHERE cfg.BhkType = REPLACE(UPPER(ISNULL(u.UnitType, '')), ' ', '')
            AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
        ) AS TemplateRoomCount
      FROM dbo.UnitMaster u
      WHERE u.BlockId = @bid AND ${floorFilter} AND u.IsActive = 1
      ORDER BY u.UnitName
    `);
    res.json({ units: result.recordset });
  } catch (err) {
    console.error("[room-master] GET /floor-units/:floorId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /unit-rooms/:unitId — the unit's room template (from Unit Composition,
// keyed off its UnitType) alongside whatever real RoomMaster rows already
// exist for it, for the "rooms configured for this unit" preview card. Same
// template query POST /generate/:unitId itself runs, just without writing
// anything — lets the UI show what generating would create before the user
// commits to it.
router.get("/unit-rooms/:unitId", async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId) || unitId <= 0) return res.status(400).json({ error: "Invalid unitId" });
  try {
    const pool = getPool();
    const unitRes = await pool.request().input("UnitId", sql.Int, unitId).query(`
      SELECT Id, ProjectId, BlockId, UnitName, FloorNo, UnitType FROM dbo.UnitMaster WHERE Id = @UnitId AND IsActive = 1
    `);
    if (!unitRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const unit = unitRes.recordset[0];
    const typeKey = String(unit.UnitType || "").toUpperCase().replace(/\s+/g, "");

    const template = typeKey
      ? await pool.request().input("typeKey", sql.NVarChar(20), typeKey).query(`
          SELECT rc.Quantity AS quantity, cat.Alias AS alias
          FROM dbo.UnitRoomConfig cfg
          JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
          JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
          WHERE cfg.BhkType = @typeKey AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
          ORDER BY cat.SortOrder ASC, cat.Alias ASC
        `)
      : { recordset: [] };

    const existing = await pool.request().input("UnitId", sql.Int, unitId).query(`
      SELECT Id, RoomName, Floor, IsActive, BlueprintFileName
      FROM dbo.RoomMaster WHERE UnitId = @UnitId ORDER BY RoomName
    `);

    res.json({ unit, template: template.recordset, existing: existing.recordset });
  } catch (err) {
    console.error("[room-master] GET /unit-rooms/:unitId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add room
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, UnitId, RoomName, RoomCategoryId, IsActive } = req.body;
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
  if (!Number.isFinite(parseInt(ProjectId, 10))) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!Number.isFinite(parseInt(UnitId, 10))) {
    return res.status(400).json({ error: "UnitId is required." });
  }
  if (!RoomName || !String(RoomName).trim()) {
    return res.status(400).json({ error: "RoomName is required." });
  }

  try {
    const pool = getPool();

    // Block and Floor are never chosen by the user — both derive from the
    // selected unit's own Auto Project Setup data (BlockId directly,
    // Floor from FloorNo using the same 'G'/numbered-string convention
    // CrmProjectAutoSetupFloor.FloorLabel uses), same reasoning /generate/:unitId
    // below already follows. A free-typed Floor field used to let a room's
    // Floor drift out of sync with the unit's real floor — this removes that
    // possibility entirely rather than trusting the client to keep them in sync.
    const unitRow = await pool
      .request()
      .input("UnitId", sql.Int, parseInt(UnitId))
      .query("SELECT BlockId, FloorNo FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const { BlockId, FloorNo } = unitRow.recordset[0];
    const Floor = FloorNo === 0 ? "G" : FloorNo != null ? String(FloorNo) : null;

    const insertRes = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("RoomCategoryId", sql.Int, RoomCategoryId ? parseInt(RoomCategoryId) : null)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockId, @UnitId, @RoomName, @RoomCategoryId, @Floor, @IsActive, @CreatedBy, @CreatedAt)
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
  const { ProjectId, UnitId, RoomName, RoomCategoryId, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;

  // Same NOT NULL columns as POST / — this UPDATE overwrites them
  // unconditionally, so omitting any of them here would null out the
  // existing value and crash the same way the create path did before the
  // fix above.
  if (!Number.isFinite(parseInt(ProjectId, 10))) {
    return res.status(400).json({ error: "ProjectId is required." });
  }
  if (!Number.isFinite(parseInt(UnitId, 10))) {
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
      .query("SELECT BlockId, FloorNo FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const { BlockId, FloorNo } = unitRow.recordset[0];
    const Floor = FloorNo === 0 ? "G" : FloorNo != null ? String(FloorNo) : null;

    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("RoomCategoryId", sql.Int, RoomCategoryId ? parseInt(RoomCategoryId) : null)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.RoomMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitId    = @UnitId,
          RoomName  = @RoomName,
          RoomCategoryId = @RoomCategoryId,
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
      SELECT Id, ProjectId, BlockId, UnitType, FloorNo FROM dbo.UnitMaster WHERE Id = @UnitId AND IsActive = 1
    `);
    if (!unitRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const unit = unitRes.recordset[0];
    // Same 'G' / numbered-string convention CrmProjectAutoSetupFloor.FloorLabel
    // uses, so a generated room's Floor reads the same as the tree it was
    // generated from. Legacy units with no FloorNo just get a null Floor,
    // same as before this field was ever populated here.
    const floorLabel = unit.FloorNo === 0 ? "G" : unit.FloorNo != null ? String(unit.FloorNo) : null;
    const typeKey = String(unit.UnitType || "").toUpperCase().replace(/\s+/g, "");
    if (!typeKey) {
      return res.status(400).json({
        error: "This unit has no Unit Type set — set one in Unit Master (or the auto project setup's Unit Type template) first.",
      });
    }

    const compRes = await pool.request().input("typeKey", sql.NVarChar(20), typeKey).query(`
      SELECT rc.Quantity AS quantity, cat.Alias AS alias, cat.Id AS categoryId
      FROM dbo.UnitRoomConfig cfg
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE cfg.BhkType = @typeKey AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
      ORDER BY cat.SortOrder ASC, cat.Alias ASC
    `);
    if (!compRes.recordset.length) {
      return res.status(400).json({
        error: `No unit composition template set up for "${unit.UnitType}" yet — set one in Unit Composition first.`,
      });
    }

    const names = [];
    for (const row of compRes.recordset) {
      for (let i = 1; i <= row.quantity; i++) {
        names.push({ name: row.quantity > 1 ? `${row.alias} ${i}` : row.alias, categoryId: row.categoryId });
      }
    }

    // Check ALL rooms for this unit — active AND inactive — so we can
    // reactivate a soft-deleted room rather than inserting a duplicate.
    // Previously only checked IsActive=1, so soft-deleted rooms would get
    // a brand-new row inserted on regenerate, leaving two rows with the
    // same name (one inactive orphan, one new active).
    const existing = await pool.request().input("UnitId", sql.Int, unitId).query(`
      SELECT Id, RoomName, IsActive FROM dbo.RoomMaster WHERE UnitId = @UnitId
    `);
    const activeSet = new Set(
      existing.recordset.filter((r) => r.IsActive).map((r) => String(r.RoomName).toLowerCase())
    );
    const inactiveMap = new Map(
      existing.recordset.filter((r) => !r.IsActive).map((r) => [String(r.RoomName).toLowerCase(), r.Id])
    );

    let created = 0;
    for (const { name, categoryId } of names) {
      const lower = name.toLowerCase();
      if (activeSet.has(lower)) continue; // already exists and is active
      if (inactiveMap.has(lower)) {
        // Reactivate the soft-deleted row — preserves its Id, blueprints, etc.
        // Also backfills RoomCategoryId in case this row predates migration 466.
        await pool.request()
          .input("Id", sql.Int, inactiveMap.get(lower))
          .input("Floor", sql.NVarChar(50), floorLabel)
          .input("CategoryId", sql.Int, categoryId)
          .query(`UPDATE dbo.RoomMaster SET IsActive = 1, Floor = @Floor, RoomCategoryId = ISNULL(RoomCategoryId, @CategoryId) WHERE Id = @Id`);
        created++;
        continue;
      }
      // Brand-new room — insert
      await pool.request()
        .input("ProjectId", sql.Int, unit.ProjectId)
        .input("BlockId", sql.Int, unit.BlockId)
        .input("UnitId", sql.Int, unitId)
        .input("RoomName", sql.NVarChar(100), name)
        .input("Floor", sql.NVarChar(50), floorLabel)
        .input("CategoryId", sql.Int, categoryId)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime2(3), new Date())
        .query(`
          INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, RoomCategoryId, Floor, IsActive, CreatedBy, CreatedAt)
          VALUES (@ProjectId, @BlockId, @UnitId, @RoomName, @CategoryId, @Floor, 1, @CreatedBy, @CreatedAt)
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
