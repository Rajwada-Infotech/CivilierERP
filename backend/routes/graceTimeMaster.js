const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_GraceTimeMaster_Name|UQ_GraceTimeMaster_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_GraceTimeMaster_Code/i.test(err.message || "")
    ? "A grace time with this Grace Code already exists"
    : "A grace time with this name already exists";

// GET all grace time rules
router.get("/", cache("grace-time-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT GraceId, GraceName, GraceCode, TimeMinutes, ReasonRemarks, IsActive, CreatedAt, UpdatedAt
      FROM dbo.GraceTimeMaster
      ORDER BY GraceName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[grace-time-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add grace time rule
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { GraceName, GraceCode, TimeMinutes, ReasonRemarks, IsActive } = req.body;
  if (!GraceName?.trim()) return res.status(400).json({ error: "GraceName is required" });
  if (!GraceCode?.trim()) return res.status(400).json({ error: "GraceCode is required" });
  if (TimeMinutes === undefined || TimeMinutes === null || TimeMinutes === "") {
    return res.status(400).json({ error: "TimeMinutes is required" });
  }
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(100), GraceName.trim())
      .input("Code", sql.NVarChar(30), GraceCode.trim())
      .input("TimeMinutes", sql.Int, Number(TimeMinutes))
      .input("ReasonRemarks", sql.NVarChar(500), ReasonRemarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.GraceTimeMaster (GraceName, GraceCode, TimeMinutes, ReasonRemarks, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @TimeMinutes, @ReasonRemarks, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("grace-time-master");
    res.json({ message: "Grace time added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[grace-time-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update grace time rule
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { GraceName, GraceCode, TimeMinutes, ReasonRemarks, IsActive } = req.body;
  if (!GraceName?.trim()) return res.status(400).json({ error: "GraceName is required" });
  if (!GraceCode?.trim()) return res.status(400).json({ error: "GraceCode is required" });
  if (TimeMinutes === undefined || TimeMinutes === null || TimeMinutes === "") {
    return res.status(400).json({ error: "TimeMinutes is required" });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(100), GraceName.trim())
      .input("Code", sql.NVarChar(30), GraceCode.trim())
      .input("TimeMinutes", sql.Int, Number(TimeMinutes))
      .input("ReasonRemarks", sql.NVarChar(500), ReasonRemarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.GraceTimeMaster SET
          GraceName = @Name, GraceCode = @Code, TimeMinutes = @TimeMinutes,
          ReasonRemarks = @ReasonRemarks, IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE GraceId = @Id
      `);
    await bumpCacheVersion("grace-time-master");
    res.json({ message: "Grace time updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[grace-time-master] PUT error:", err.message);
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
      .query("SELECT GraceName FROM dbo.GraceTimeMaster WHERE GraceId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Grace time not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.GraceTimeMaster WHERE GraceId = @Id");
    await bumpCacheVersion("grace-time-master");
    res.json({ message: `Grace time "${existing.recordset[0].GraceName}" deleted successfully` });
  } catch (err) {
    console.error("[grace-time-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
