const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_HolidayMaster_NameDate/i.test(err.message || "");

const SELECT_COLUMNS = `
  SELECT h.HolidayId, h.HolidayName, h.HolidayDate, h.FinYearId,
         fy.FName AS FinYearName, h.IsActive, h.CreatedAt, h.UpdatedAt
  FROM dbo.HolidayMaster h
  LEFT JOIN dbo.FinYear fy ON fy.FId = h.FinYearId
`;

// GET all holidays
router.get("/", cache("holiday-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY h.HolidayDate`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[holiday-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add holiday
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { HolidayName, HolidayDate, FinYearId, IsActive } = req.body;
  if (!HolidayName?.trim()) return res.status(400).json({ error: "HolidayName is required" });
  if (!HolidayDate) return res.status(400).json({ error: "HolidayDate is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(150), HolidayName.trim())
      .input("Date", sql.Date, HolidayDate)
      .input("FinYearId", sql.Int, FinYearId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.HolidayMaster (HolidayName, HolidayDate, FinYearId, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Date, @FinYearId, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("holiday-master");
    res.json({ message: "Holiday added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "This holiday already exists on this date" });
    }
    console.error("[holiday-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update holiday
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { HolidayName, HolidayDate, FinYearId, IsActive } = req.body;
  if (!HolidayName?.trim()) return res.status(400).json({ error: "HolidayName is required" });
  if (!HolidayDate) return res.status(400).json({ error: "HolidayDate is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(150), HolidayName.trim())
      .input("Date", sql.Date, HolidayDate)
      .input("FinYearId", sql.Int, FinYearId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.HolidayMaster SET
          HolidayName = @Name, HolidayDate = @Date, FinYearId = @FinYearId,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE HolidayId = @Id
      `);
    await bumpCacheVersion("holiday-master");
    res.json({ message: "Holiday updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "This holiday already exists on this date" });
    }
    console.error("[holiday-master] PUT error:", err.message);
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
      .query("SELECT HolidayName FROM dbo.HolidayMaster WHERE HolidayId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Holiday not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.HolidayMaster WHERE HolidayId = @Id");
    await bumpCacheVersion("holiday-master");
    res.json({ message: `Holiday "${existing.recordset[0].HolidayName}" deleted successfully` });
  } catch (err) {
    console.error("[holiday-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
