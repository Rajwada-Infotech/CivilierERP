const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_DeductionAdditionMaster_Name|UQ_DeductionAdditionMaster_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_DeductionAdditionMaster_Code/i.test(err.message || "")
    ? "A deduction/addition with this code already exists"
    : "A deduction/addition with this name already exists";

const SELECT_COLUMNS = `
  SELECT d.Id, d.Name, d.Code, d.LedgerId,
         ISNULL(ahm.DisplayName, ahm.LHeadName) AS LedgerName,
         d.IsActive, d.CreatedAt, d.UpdatedAt
  FROM dbo.DeductionAdditionMaster d
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = d.LedgerId
`;

// GET all deduction/addition records
router.get("/", cache("deduction-addition-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY d.Name`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[deduction-addition-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add deduction/addition
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { Name, Code, LedgerId, IsActive } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!Code?.trim()) return res.status(400).json({ error: "Code is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(150), Name.trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("LedgerId", sql.Int, LedgerId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.DeductionAdditionMaster (Name, Code, LedgerId, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @LedgerId, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("deduction-addition-master");
    res.json({ message: "Deduction/Addition added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[deduction-addition-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update deduction/addition
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { Name, Code, LedgerId, IsActive } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!Code?.trim()) return res.status(400).json({ error: "Code is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Name", sql.NVarChar(150), Name.trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("LedgerId", sql.Int, LedgerId || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.DeductionAdditionMaster SET
          Name = @Name, Code = @Code, LedgerId = @LedgerId,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("deduction-addition-master");
    res.json({ message: "Deduction/Addition updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[deduction-addition-master] PUT error:", err.message);
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
      .query("SELECT Name FROM dbo.DeductionAdditionMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Deduction/Addition not found" });

    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.DeductionAdditionMaster WHERE Id = @Id");
    await bumpCacheVersion("deduction-addition-master");
    res.json({ message: `"${existing.recordset[0].Name}" deleted successfully` });
  } catch (err) {
    console.error("[deduction-addition-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
