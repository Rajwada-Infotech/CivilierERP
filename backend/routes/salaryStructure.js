const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_SalaryStructure_Name|UQ_SalaryStructure_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_SalaryStructure_Code/i.test(err.message || "")
    ? "A salary structure with this code already exists"
    : "A salary structure with this name already exists";

const HEADER_SELECT = `
  SELECT s.SalaryStructureId, s.CompanyId, comp.name AS CompanyName, s.Name, s.Code,
         s.IsActive, s.CreatedAt, s.UpdatedAt
  FROM dbo.SalaryStructure s
  LEFT JOIN dbo.enterprise comp ON comp.id = s.CompanyId
`;

const LINES_SELECT = `
  SELECT l.LineId, l.SalaryStructureId, l.DeductionAdditionId, l.Percentage, l.Amount,
         d.Name AS HeadName, d.Code AS HeadCode, d.Type AS HeadType
  FROM dbo.SalaryStructureLines l
  JOIN dbo.DeductionAdditionMaster d ON d.Id = l.DeductionAdditionId
`;

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "At least one Deduction/Addition line is required";
  const seen = new Set();
  for (const line of lines) {
    const headId = Number(line.DeductionAdditionId);
    if (!Number.isFinite(headId) || headId <= 0) return "Each line needs a Deduction/Addition head";
    if (seen.has(headId)) return "The same Deduction/Addition head cannot be added twice";
    seen.add(headId);
    const hasPercentage = line.Percentage !== "" && line.Percentage != null;
    const hasAmount = line.Amount !== "" && line.Amount != null;
    if (!hasPercentage && !hasAmount) return "Each line needs either a Percentage or an Amount";
  }
  return null;
}

// GET all salary structures, each with its lines attached
router.get("/", cache("salary-structure", 300), async (req, res) => {
  try {
    const pool = getPool();
    const headers = await pool.request().query(`${HEADER_SELECT} ORDER BY s.Name`);
    const lines = await pool.request().query(`${LINES_SELECT} ORDER BY l.LineId`);
    const linesByStructure = new Map();
    for (const line of lines.recordset) {
      if (!linesByStructure.has(line.SalaryStructureId)) linesByStructure.set(line.SalaryStructureId, []);
      linesByStructure.get(line.SalaryStructureId).push(line);
    }
    const result = headers.recordset.map((h) => ({
      ...h,
      Lines: linesByStructure.get(h.SalaryStructureId) || [],
    }));
    res.json(result);
  } catch (err) {
    console.error("[salary-structure] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add salary structure + its lines
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CompanyId, Name, Code, IsActive, Lines } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!Code?.trim()) return res.status(400).json({ error: "Code is required" });
  const linesError = validateLines(Lines);
  if (linesError) return res.status(400).json({ error: linesError });
  const createdBy = req.user?.userId || null;

  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const hdr = await tx
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("Name", sql.NVarChar(150), Name.trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.SalaryStructure (CompanyId, Name, Code, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.SalaryStructureId
        VALUES (@CompanyId, @Name, @Code, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    const structureId = hdr.recordset[0].SalaryStructureId;

    for (const line of Lines) {
      await tx
        .request()
        .input("StructureId", sql.Int, structureId)
        .input("HeadId", sql.Int, Number(line.DeductionAdditionId))
        .input("Percentage", sql.Decimal(9, 4), line.Percentage === "" || line.Percentage == null ? null : Number(line.Percentage))
        .input("Amount", sql.Decimal(18, 2), line.Amount === "" || line.Amount == null ? null : Number(line.Amount))
        .query(`
          INSERT INTO dbo.SalaryStructureLines (SalaryStructureId, DeductionAdditionId, Percentage, Amount, CreatedAt)
          VALUES (@StructureId, @HeadId, @Percentage, @Amount, SYSUTCDATETIME())
        `);
    }

    await tx.commit();
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure added successfully", id: structureId });
  } catch (err) {
    await tx.rollback();
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[salary-structure] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update salary structure header + replace its lines
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { CompanyId, Name, Code, IsActive, Lines } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!Code?.trim()) return res.status(400).json({ error: "Code is required" });
  const linesError = validateLines(Lines);
  if (linesError) return res.status(400).json({ error: linesError });
  const updatedBy = req.user?.userId || null;

  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const existing = await tx.request().input("Id", sql.Int, id)
      .query("SELECT SalaryStructureId FROM dbo.SalaryStructure WHERE SalaryStructureId = @Id");
    if (!existing.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ error: "Salary structure not found" });
    }

    await tx
      .request()
      .input("Id", sql.Int, id)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("Name", sql.NVarChar(150), Name.trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.SalaryStructure SET
          CompanyId = @CompanyId, Name = @Name, Code = @Code,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE SalaryStructureId = @Id
      `);

    await tx.request().input("Id", sql.Int, id)
      .query("DELETE FROM dbo.SalaryStructureLines WHERE SalaryStructureId = @Id");

    for (const line of Lines) {
      await tx
        .request()
        .input("StructureId", sql.Int, id)
        .input("HeadId", sql.Int, Number(line.DeductionAdditionId))
        .input("Percentage", sql.Decimal(9, 4), line.Percentage === "" || line.Percentage == null ? null : Number(line.Percentage))
        .input("Amount", sql.Decimal(18, 2), line.Amount === "" || line.Amount == null ? null : Number(line.Amount))
        .query(`
          INSERT INTO dbo.SalaryStructureLines (SalaryStructureId, DeductionAdditionId, Percentage, Amount, CreatedAt)
          VALUES (@StructureId, @HeadId, @Percentage, @Amount, SYSUTCDATETIME())
        `);
    }

    await tx.commit();
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure updated successfully" });
  } catch (err) {
    await tx.rollback();
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: uniqueViolationMessage(err) });
    }
    console.error("[salary-structure] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — lines cascade automatically (ON DELETE CASCADE)
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Name FROM dbo.SalaryStructure WHERE SalaryStructureId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Salary structure not found" });

    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.SalaryStructure WHERE SalaryStructureId = @Id");
    await bumpCacheVersion("salary-structure");
    res.json({ message: `"${existing.recordset[0].Name}" deleted successfully` });
  } catch (err) {
    console.error("[salary-structure] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
