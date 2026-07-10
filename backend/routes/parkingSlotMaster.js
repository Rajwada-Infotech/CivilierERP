const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];

bumpCacheVersion("parking-slot-master").catch(() => {});

// GET all parking slots
router.get("/", cache("parking-slot-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        s.Id, s.ProjectId, e.name AS ProjectName,
        s.BlockId, b.BlockName,
        s.SlotNo, s.ParkingType, s.IsActive,
        s.CreatedAt, s.UpdatedAt
      FROM dbo.ParkingSlot s
      LEFT JOIN dbo.enterprise  e ON e.id = s.ProjectId AND e.business_type = 'P'
      LEFT JOIN dbo.BlockMaster b ON b.Id = s.BlockId
      ORDER BY e.name, b.BlockName, s.SlotNo
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[parking-slot-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add a parking slot
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, BlockId, SlotNo, ParkingType, IsActive } = req.body;
  if (!SlotNo?.trim()) return res.status(400).json({ error: "SlotNo is required" });
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
      .input("SlotNo",    sql.NVarChar(50), SlotNo.trim())
      .input("Type",      sql.NVarChar(50), ParkingType)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockId, @SlotNo, @Type, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: "Parking slot added successfully" });
  } catch (err) {
    console.error("[parking-slot-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update a parking slot
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, SlotNo, ParkingType, IsActive } = req.body;
  if (!SlotNo?.trim()) return res.status(400).json({ error: "SlotNo is required" });
  if (ParkingType && !PARKING_TYPES.includes(ParkingType)) {
    return res.status(400).json({ error: `Invalid ParkingType. Must be: ${PARKING_TYPES.join(", ")}` });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("SlotNo",    sql.NVarChar(50), SlotNo.trim())
      .input("Type",      sql.NVarChar(50), ParkingType)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ParkingSlot SET
          ProjectId = @ProjectId, BlockId = @BlockId, SlotNo = @SlotNo,
          ParkingType = @Type, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: "Parking slot updated successfully" });
  } catch (err) {
    console.error("[parking-slot-master] PUT error:", err.message);
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
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmParkingAllotment WHERE ParkingSlotId = @id AND IsActive = 1");
    if (inUse.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This parking slot is currently allotted and cannot be deleted. Deactivate it instead." });
    }
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Parking slot not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.ParkingSlot WHERE Id = @Id");
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: `Parking slot "${existing.recordset[0].SlotNo}" deleted successfully` });
  } catch (err) {
    console.error("[parking-slot-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
