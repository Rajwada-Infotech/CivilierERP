const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { logAudit } = require("../utils/auditLog");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

bumpCacheVersion("unit-master").catch(() => {});

// GET all units — ?isActive=1 filters out soft-deleted units (used by unit
// pickers like CrmBooking's; the Unit Master admin grid itself omits this
// param so it can still see/reactivate deactivated units).
router.get("/", cache("unit-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const where = req.query.isActive != null ? "WHERE u.IsActive = 1" : "";
    const result = await req0.query(`
      SELECT
        u.Id,
        u.ProjectId,
        ep.name   AS ProjectName,
        u.BlockId,
        b.BlockName,
        u.UnitName,
        u.FloorNo,
        u.UnitType,
        u.AreaSqFt,
        u.IsActive,
        u.CreatedAt,
        u.UpdatedAt
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise  ep ON ep.id = u.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  b ON b.Id  = u.BlockId
      ${where}
      ORDER BY ep.name, b.BlockName, u.UnitName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects dropdown (enterprise where business_type = P)
router.get("/projects", cache("unit-master-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name, company_id AS CompanyId
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET blocks dropdown — filtered by projectId query param
router.get("/blocks", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT Id, BlockName AS Name, ProjectId
      FROM dbo.BlockMaster
      WHERE IsActive = 1
    `;
    if (Number.isFinite(projectId) && projectId > 0) {
      request.input("ProjectId", sql.Int, projectId);
      query += ` AND ProjectId = @ProjectId`;
    }
    query += ` ORDER BY BlockName`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add unit
router.post("/", requirePageRight("followup-unit-master", "create"), async (req, res) => {
  const { ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("Area",      sql.Decimal(18,2), AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockId, @UnitName, @FloorNo, @UnitType, @Area, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: result.recordset[0].Id, recordNo: UnitName, action: "Created", changedBy: userName });
    res.json({ message: "Unit added successfully" });
  } catch (err) {
    console.error("[unit-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update unit
router.put("/:id", requirePageRight("followup-unit-master", "edit"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("Area",      sql.Decimal(18,2), AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.UnitMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitName  = @UnitName,
          FloorNo   = @FloorNo,
          UnitType  = @UnitType,
          AreaSqFt  = @Area,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: parseInt(id), recordNo: UnitName, action: "Updated", changedBy: userName });
    res.json({ message: "Unit updated successfully" });
  } catch (err) {
    console.error("[unit-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft delete (IsActive = 0), matching the platform-wide convention
// used everywhere else. Previously this was a hard DELETE, the one place in
// the module that didn't follow that pattern: since there are no DB-level FK
// constraints in this system, a unit referenced by CrmBooking.UnitId (or any
// other table's UnitId column) would silently become a dangling reference —
// a NULL/broken join surfacing later — rather than a clean, reversible
// deactivation. Bookings themselves are unaffected either way since
// CrmBooking snapshots UnitNo/BlockName/UnitType/AreaSqFt onto its own row
// at creation time rather than re-joining UnitMaster live.
router.delete("/:id", requirePageRight("followup-unit-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  const userName = req.user?.name || req.user?.email || null;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Unit not found" });
    const { UnitName } = existing.recordset[0];
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date())
      .query("UPDATE dbo.UnitMaster SET IsActive = 0, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt WHERE Id = @Id");
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: id, recordNo: UnitName, action: "Deleted", changedBy: userName });
    res.json({ message: `Unit "${UnitName}" deactivated successfully` });
  } catch (err) {
    console.error("[unit-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



