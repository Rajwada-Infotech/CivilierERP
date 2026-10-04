const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_ShiftMaster_Name|UQ_ShiftMaster_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_ShiftMaster_Code/i.test(err.message || "")
    ? "A shift with this Shift Code already exists"
    : "A shift with this name already exists";

// GET all shifts
router.get("/", cache("shift-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ShiftId, ShiftName, ShiftCode, InTime, OutTime, WeekOff, IsActive, CreatedAt, UpdatedAt
      FROM dbo.ShiftMaster
      ORDER BY ShiftName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[shift-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add shift
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ShiftName, ShiftCode, InTime, OutTime, WeekOff, IsActive } = req.body;
  if (!ShiftName?.trim()) return res.status(400).json({ error: "ShiftName is required" });
  if (!ShiftCode?.trim()) return res.status(400).json({ error: "ShiftCode is required" });
  if (!InTime?.trim()) return res.status(400).json({ error: "InTime is required" });
  if (!OutTime?.trim()) return res.status(400).json({ error: "OutTime is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(100), ShiftName.trim())
      .input("Code", sql.NVarChar(30), ShiftCode.trim())
      .input("InTime", sql.NVarChar(10), InTime.trim())
      .input("OutTime", sql.NVarChar(10), OutTime.trim())
      .input("WeekOff", sql.NVarChar(20), WeekOff || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.ShiftMaster (ShiftName, ShiftCode, InTime, OutTime, WeekOff, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @InTime, @OutTime, @WeekOff, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("shift-master");
    res.json({ message: "Shift added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[shift-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update shift
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ShiftName, ShiftCode, InTime, OutTime, WeekOff, IsActive } = req.body;
  if (!ShiftName?.trim()) return res.status(400).json({ error: "ShiftName is required" });
  if (!ShiftCode?.trim()) return res.status(400).json({ error: "ShiftCode is required" });
  if (!InTime?.trim()) return res.status(400).json({ error: "InTime is required" });
  if (!OutTime?.trim()) return res.status(400).json({ error: "OutTime is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(100), ShiftName.trim())
      .input("Code", sql.NVarChar(30), ShiftCode.trim())
      .input("InTime", sql.NVarChar(10), InTime.trim())
      .input("OutTime", sql.NVarChar(10), OutTime.trim())
      .input("WeekOff", sql.NVarChar(20), WeekOff || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ShiftMaster SET
          ShiftName = @Name, ShiftCode = @Code, InTime = @InTime, OutTime = @OutTime,
          WeekOff = @WeekOff, IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE ShiftId = @Id
      `);
    await bumpCacheVersion("shift-master");
    res.json({ message: "Shift updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[shift-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT ShiftName FROM dbo.ShiftMaster WHERE ShiftId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Shift not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.ShiftMaster WHERE ShiftId = @Id");
    await bumpCacheVersion("shift-master");
    res.json({ message: `Shift "${existing.recordset[0].ShiftName}" deleted successfully` });
  } catch (err) {
    console.error("[shift-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
