const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];

bumpCacheVersion("parking-master").catch(() => {});

// GET all parking rates
router.get("/", cache("parking-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        p.Id, p.ProjectId, e.name AS ProjectName,
        p.BlockId, b.BlockName,
        p.ParkingType, p.Charge, p.GstRate, p.IsActive,
        p.CreatedAt, p.UpdatedAt
      FROM dbo.ParkingMaster p
      LEFT JOIN dbo.enterprise  e ON e.id = p.ProjectId AND e.business_type = 'P'
      LEFT JOIN dbo.BlockMaster b ON b.Id = p.BlockId
      ORDER BY e.name, b.BlockName, p.ParkingType
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[parking-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET the applicable rate for a project/block — block-specific rate wins
// over the project-wide rate when both exist. Used by booking-side
// parking allotment to snapshot the correct charge/GST.
router.get("/rate", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  const blockId = parseInt(req.query.blockId, 10);
  const parkingType = req.query.parkingType || "Open";
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("pid", sql.Int, projectId)
      .input("bid", sql.Int, Number.isFinite(blockId) ? blockId : null)
      .input("pt",  sql.NVarChar(50), parkingType)
      .query(`
        SELECT TOP 1 Id, Charge, GstRate, ParkingType, BlockId
        FROM dbo.ParkingMaster
        WHERE ProjectId = @pid AND ParkingType = @pt AND IsActive = 1
          AND (BlockId = @bid OR BlockId IS NULL)
        ORDER BY CASE WHEN BlockId = @bid THEN 0 ELSE 1 END
      `);
    res.json(result.recordset[0] || null);
  } catch (err) {
    console.error("[parking-master] GET /rate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add parking rate
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, BlockId, ParkingType, Charge, GstRate, IsActive } = req.body;
  if (!PARKING_TYPES.includes(ParkingType)) {
    return res.status(400).json({ error: `Invalid ParkingType. Must be: ${PARKING_TYPES.join(", ")}` });
  }
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("Type",      sql.NVarChar(50), ParkingType)
      .input("Charge",    sql.Decimal(18, 2), parseFloat(Charge))
      .input("Gst",       sql.Decimal(5, 2), GstRate != null ? parseFloat(GstRate) : 18)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.ParkingMaster (ProjectId, BlockId, ParkingType, Charge, GstRate, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockId, @Type, @Charge, @Gst, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    await bumpCacheVersion("parking-master");
    res.json({ message: "Parking rate added successfully" });
  } catch (err) {
    console.error("[parking-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update parking rate
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, ParkingType, Charge, GstRate, IsActive } = req.body;
  if (ParkingType && !PARKING_TYPES.includes(ParkingType)) {
    return res.status(400).json({ error: `Invalid ParkingType. Must be: ${PARKING_TYPES.join(", ")}` });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId",  sql.Int, parseInt(ProjectId))
      .input("BlockId",    sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("Type",       sql.NVarChar(50), ParkingType)
      .input("Charge",     sql.Decimal(18, 2), parseFloat(Charge))
      .input("Gst",        sql.Decimal(5, 2), GstRate != null ? parseFloat(GstRate) : 18)
      .input("IsActive",   sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy",  sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ParkingMaster SET
          ProjectId = @ProjectId, BlockId = @BlockId, ParkingType = @Type,
          Charge = @Charge, GstRate = @Gst, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("parking-master");
    res.json({ message: "Parking rate updated successfully" });
  } catch (err) {
    console.error("[parking-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const inUse = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmParkingAllotment WHERE ParkingMasterId = @id");
    if (inUse.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This parking rate has already been allotted to bookings and cannot be deleted. Deactivate it instead." });
    }
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT ParkingType FROM dbo.ParkingMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Parking rate not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.ParkingMaster WHERE Id = @Id");
    await bumpCacheVersion("parking-master");
    res.json({ message: `Parking rate "${existing.recordset[0].ParkingType}" deleted successfully` });
  } catch (err) {
    console.error("[parking-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
