const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// UQ_DepartmentMaster_Name enforces uniqueness at the DB level — this just
// gives a friendly 409 instead of surfacing the raw SQL constraint error.
const isUniqueViolation = (err) => /UQ_DepartmentMaster_Name/i.test(err.message || "");

// GET all departments
router.get("/", cache("department-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, DepartmentName, IsActive, CreatedAt, UpdatedAt
      FROM dbo.DepartmentMaster
      ORDER BY DepartmentName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[department-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add department
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { DepartmentName, IsActive } = req.body;
  if (!DepartmentName?.trim()) return res.status(400).json({ error: "DepartmentName is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(150), DepartmentName.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.DepartmentMaster (DepartmentName, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("department-master");
    res.json({ message: "Department added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A department with this name already exists" });
    }
    console.error("[department-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update department
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { DepartmentName, IsActive } = req.body;
  if (!DepartmentName?.trim()) return res.status(400).json({ error: "DepartmentName is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(150), DepartmentName.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.DepartmentMaster SET
          DepartmentName = @Name, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("department-master");
    res.json({ message: "Department updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A department with this name already exists" });
    }
    console.error("[department-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const inUse = await pool.request().input("Name", sql.NVarChar(150), null).input("Id", sql.Int, id)
      .query(`
        SELECT COUNT(*) AS Cnt FROM dbo.TaskMaster t
        JOIN dbo.DepartmentMaster d ON d.Id = @Id
        WHERE t.Department = d.DepartmentName AND t.IsDeleted = 0
      `);
    if (inUse.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This department is in use on existing tasks and cannot be deleted. Deactivate it instead." });
    }
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT DepartmentName FROM dbo.DepartmentMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Department not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.DepartmentMaster WHERE Id = @Id");
    await bumpCacheVersion("department-master");
    res.json({ message: `Department "${existing.recordset[0].DepartmentName}" deleted successfully` });
  } catch (err) {
    console.error("[department-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
