const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_DesignationMaster_Name|UQ_DesignationMaster_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_DesignationMaster_Code/i.test(err.message || "")
    ? "A designation with this DG Code already exists"
    : "A designation with this name already exists";

const SELECT_COLUMNS = `
  SELECT d.Id, d.DesignationName, d.DesignationCode, d.DepartmentId,
         dept.DepartmentName, d.IsActive, d.CreatedAt, d.UpdatedAt
  FROM dbo.DesignationMaster d
  LEFT JOIN dbo.DepartmentMaster dept ON dept.Id = d.DepartmentId
`;

// GET all designations
router.get("/", cache("designation-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY d.DesignationName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[designation-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add designation
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { DesignationName, DesignationCode, DepartmentId, IsActive } = req.body;
  if (!DesignationName?.trim()) return res.status(400).json({ error: "DesignationName is required" });
  if (!DesignationCode?.trim()) return res.status(400).json({ error: "DesignationCode is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(150), DesignationName.trim())
      .input("Code", sql.NVarChar(30), DesignationCode.trim())
      .input("DepartmentId", sql.Int, DepartmentId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.DesignationMaster (DesignationName, DesignationCode, DepartmentId, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @DepartmentId, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("designation-master");
    res.json({ message: "Designation added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[designation-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update designation
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { DesignationName, DesignationCode, DepartmentId, IsActive } = req.body;
  if (!DesignationName?.trim()) return res.status(400).json({ error: "DesignationName is required" });
  if (!DesignationCode?.trim()) return res.status(400).json({ error: "DesignationCode is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(150), DesignationName.trim())
      .input("Code", sql.NVarChar(30), DesignationCode.trim())
      .input("DepartmentId", sql.Int, DepartmentId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.DesignationMaster SET
          DesignationName = @Name, DesignationCode = @Code, DepartmentId = @DepartmentId,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("designation-master");
    res.json({ message: "Designation updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[designation-master] PUT error:", err.message);
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
      .query("SELECT DesignationName FROM dbo.DesignationMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Designation not found" });

    const inUse = await pool.request().input("Id", sql.Int, id)
      .query(`
        SELECT COUNT(*) AS Cnt FROM dbo.EmployeeMaster e
        JOIN dbo.DesignationMaster d ON d.Id = @Id
        WHERE e.Designation = d.DesignationName AND e.IsActive = 1
      `);
    if (inUse.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This designation is assigned to active employees and cannot be deleted. Deactivate it instead." });
    }

    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.DesignationMaster WHERE Id = @Id");
    await bumpCacheVersion("designation-master");
    res.json({ message: `Designation "${existing.recordset[0].DesignationName}" deleted successfully` });
  } catch (err) {
    console.error("[designation-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
