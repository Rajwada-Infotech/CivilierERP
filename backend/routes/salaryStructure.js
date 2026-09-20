const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { validateStructure, calculateStructure, CALCULATION_TYPES, ROUNDING_RULES } = require("../lib/formulaEngine");

const isUniqueViolation = (err) => /UQ_SalaryStructure_Name|UQ_SalaryStructure_Code/i.test(err.message || "");
const uniqueViolationMessage = (err) =>
  /UQ_SalaryStructure_Code/i.test(err.message || "")
    ? "A salary structure with this code already exists"
    : "A salary structure with this name already exists";

const HEADER_SELECT = `
  SELECT s.SalaryStructureId, s.CompanyId, comp.name AS CompanyName, s.Name, s.Code, s.Description,
         s.EffectiveFrom, s.EffectiveTo, s.CTCFrequency, s.Version,
         s.IsActive, s.CreatedAt, s.UpdatedAt
  FROM dbo.SalaryStructure s
  LEFT JOIN dbo.enterprise comp ON comp.id = s.CompanyId
`;

const LINES_SELECT = `
  SELECT l.LineId, l.SalaryStructureId, l.DeductionAdditionId, l.CalculationType, l.CalculationBase,
         l.Percentage, l.Amount, l.Formula, l.MinAmount, l.MaxAmount, l.RoundingRule, l.Sequence,
         l.IncludeInGross, l.IncludeInCTC, l.IncludeInNet, l.Taxable, l.IsBalancing, l.IsActive,
         d.Name AS HeadName, d.Code AS HeadCode, d.Type AS HeadType, d.IsActive AS HeadActive
  FROM dbo.SalaryStructureLines l
  JOIN dbo.DeductionAdditionMaster d ON d.Id = l.DeductionAdditionId
`;

// Builds validator/engine-shaped line objects from the raw request payload
// by joining each DeductionAdditionId against the live Salary Head master
// (so HeadCode/HeadName/HeadType/HeadActive always reflect current data,
// never something the client could spoof).
async function buildEngineLines(pool, payloadLines) {
  const ids = [...new Set((payloadLines || []).map((l) => Number(l.DeductionAdditionId)).filter((n) => Number.isFinite(n)))];
  const headsById = new Map();
  if (ids.length) {
    const result = await pool.request().query(`
      SELECT Id, Name, Code, Type, IsActive FROM dbo.DeductionAdditionMaster
      WHERE Id IN (${ids.join(",")})
    `);
    for (const row of result.recordset) headsById.set(row.Id, row);
  }

  const errors = [];
  const engineLines = [];
  for (const raw of payloadLines || []) {
    const headId = Number(raw.DeductionAdditionId);
    const head = headsById.get(headId);
    if (!head) {
      errors.push({ message: `Invalid Salary Head (id ${raw.DeductionAdditionId})` });
      continue;
    }
    engineLines.push({
      DeductionAdditionId: headId,
      HeadName: head.Name,
      HeadCode: head.Code,
      HeadType: head.Type,
      HeadActive: !!head.IsActive,
      CalculationType: raw.CalculationType,
      CalculationBase: raw.CalculationBase || null,
      Percentage: raw.Percentage === "" || raw.Percentage == null ? null : Number(raw.Percentage),
      Amount: raw.Amount === "" || raw.Amount == null ? null : Number(raw.Amount),
      Formula: raw.Formula || null,
      MinAmount: raw.MinAmount === "" || raw.MinAmount == null ? null : Number(raw.MinAmount),
      MaxAmount: raw.MaxAmount === "" || raw.MaxAmount == null ? null : Number(raw.MaxAmount),
      RoundingRule: raw.RoundingRule || "None",
      Sequence: Number(raw.Sequence) || 0,
      IncludeInGross: !!raw.IncludeInGross,
      IncludeInCTC: !!raw.IncludeInCTC,
      IncludeInNet: !!raw.IncludeInNet,
      Taxable: !!raw.Taxable,
      IsBalancing: !!raw.IsBalancing,
      IsActive: raw.IsActive !== false,
    });
  }
  return { engineLines, errors };
}

function headerErrors(body) {
  const errors = [];
  if (!body.Name?.trim()) errors.push({ message: "Structure Name is required" });
  if (!body.Code?.trim()) errors.push({ message: "Structure Code is required" });
  if (body.CTCFrequency && !["Annual", "Monthly"].includes(body.CTCFrequency)) {
    errors.push({ message: "CTC Frequency must be Annual or Monthly" });
  }
  if (!Array.isArray(body.Lines) || body.Lines.length === 0) {
    errors.push({ message: "At least one Salary Head line is required" });
  }
  return errors;
}

// GET all salary structures, each with its lines attached
router.get("/", cache("salary-structure", 300), async (req, res) => {
  try {
    const pool = getPool();
    const headers = await pool.request().query(`${HEADER_SELECT} ORDER BY s.Name`);
    const lines = await pool.request().query(`${LINES_SELECT} ORDER BY l.Sequence, l.LineId`);
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

// GET distinct structure "families" (Code+Name) for the Employee Master
// assignment dropdown -- one entry per Code, regardless of how many
// versions exist, matching spec 12's "Standard/Management/..." example.
router.get("/families", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Code, MAX(Name) AS Name
      FROM dbo.SalaryStructure
      WHERE IsActive = 1
      GROUP BY Code
      ORDER BY MAX(Name)
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[salary-structure] GET /families error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /validate -- stateless validation of a draft (not-yet-saved) structure.
router.post("/validate", async (req, res) => {
  try {
    const pool = getPool();
    const errs = headerErrors(req.body);
    const { engineLines, errors: buildErrors } = await buildEngineLines(pool, req.body.Lines || []);
    const { errors: engineErrors } = validateStructure(engineLines);
    res.json({ errors: [...errs, ...buildErrors, ...engineErrors] });
  } catch (err) {
    console.error("[salary-structure] POST /validate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /calculate -- stateless preview. Body: either a draft structure
// (CompanyId/Name/Code/CTCFrequency/Lines) or { Id } for a saved one, plus
// TestCTC + TestCTCFrequency.
router.post("/calculate", async (req, res) => {
  try {
    const pool = getPool();
    let payloadLines = req.body.Lines;
    let structureFrequency = req.body.CTCFrequency || "Monthly";

    if (req.body.Id) {
      const hdr = await pool.request().input("Id", sql.Int, Number(req.body.Id))
        .query(`${HEADER_SELECT} WHERE s.SalaryStructureId = @Id`);
      if (!hdr.recordset.length) return res.status(404).json({ error: "Salary structure not found" });
      structureFrequency = hdr.recordset[0].CTCFrequency;
      const linesRes = await pool.request().input("Id", sql.Int, Number(req.body.Id))
        .query(`${LINES_SELECT} WHERE l.SalaryStructureId = @Id ORDER BY l.Sequence, l.LineId`);
      payloadLines = linesRes.recordset.map((l) => ({
        DeductionAdditionId: l.DeductionAdditionId,
        CalculationType: l.CalculationType,
        CalculationBase: l.CalculationBase,
        Percentage: l.Percentage,
        Amount: l.Amount,
        Formula: l.Formula,
        MinAmount: l.MinAmount,
        MaxAmount: l.MaxAmount,
        RoundingRule: l.RoundingRule,
        Sequence: l.Sequence,
        IncludeInGross: l.IncludeInGross,
        IncludeInCTC: l.IncludeInCTC,
        IncludeInNet: l.IncludeInNet,
        Taxable: l.Taxable,
        IsBalancing: l.IsBalancing,
        IsActive: l.IsActive,
      }));
    }

    const testCtc = Number(req.body.TestCTC);
    if (!Number.isFinite(testCtc) || testCtc <= 0) {
      return res.status(400).json({ error: "TestCTC must be a positive number" });
    }
    const testFrequency = req.body.TestCTCFrequency === "Annual" ? "Annual" : "Monthly";

    const { engineLines, errors: buildErrors } = await buildEngineLines(pool, payloadLines || []);
    if (buildErrors.length) return res.json({ valid: false, errors: buildErrors, lines: [], totals: null });

    const result = calculateStructure(engineLines, testCtc, testFrequency, structureFrequency);
    res.json(result);
  } catch (err) {
    console.error("[salary-structure] POST /calculate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add salary structure + its lines
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CompanyId, Name, Code, Description, EffectiveFrom, EffectiveTo, CTCFrequency, IsActive, Lines } = req.body;
  const pool = getPool();

  const errs = headerErrors(req.body);
  const { engineLines, errors: buildErrors } = await buildEngineLines(pool, Lines || []);
  const { errors: engineErrors } = validateStructure(engineLines);
  const allErrors = [...errs, ...buildErrors, ...engineErrors];

  // Activating (IsActive=true) is blocked while validation errors exist;
  // saving as a Draft/Inactive template is allowed so users can iterate.
  if (IsActive === true && allErrors.length) {
    return res.status(400).json({ error: "Cannot activate: validation failed", errors: allErrors });
  }
  if (errs.length) {
    // Header-level errors (missing Name/Code/Lines) always block saving.
    return res.status(400).json({ error: errs[0].message, errors: allErrors });
  }

  const createdBy = req.user?.userId || null;
  const tx = pool.transaction();
  await tx.begin();
  try {
    const hdr = await tx
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("Name", sql.NVarChar(150), Name.trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("EffectiveFrom", sql.Date, EffectiveFrom || null)
      .input("EffectiveTo", sql.Date, EffectiveTo || null)
      .input("CTCFrequency", sql.NVarChar(10), CTCFrequency === "Annual" ? "Annual" : "Monthly")
      .input("IsActive", sql.Bit, IsActive === true ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.SalaryStructure (CompanyId, Name, Code, Description, EffectiveFrom, EffectiveTo, CTCFrequency, Version, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.SalaryStructureId
        VALUES (@CompanyId, @Name, @Code, @Description, @EffectiveFrom, @EffectiveTo, @CTCFrequency, 1, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    const structureId = hdr.recordset[0].SalaryStructureId;
    await insertLines(tx, structureId, engineLines);

    await tx.commit();
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure added successfully", id: structureId, warnings: allErrors });
  } catch (err) {
    await tx.rollback();
    if (isUniqueViolation(err)) return res.status(409).json({ error: uniqueViolationMessage(err) });
    console.error("[salary-structure] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function insertLines(tx, structureId, engineLines) {
  for (const line of engineLines) {
    await tx
      .request()
      .input("StructureId", sql.Int, structureId)
      .input("HeadId", sql.Int, line.DeductionAdditionId)
      .input("CalculationType", sql.NVarChar(20), line.CalculationType)
      .input("CalculationBase", sql.NVarChar(50), line.CalculationBase)
      .input("Percentage", sql.Decimal(9, 4), line.Percentage)
      .input("Amount", sql.Decimal(18, 2), line.Amount)
      .input("Formula", sql.NVarChar(500), line.Formula)
      .input("MinAmount", sql.Decimal(18, 2), line.MinAmount)
      .input("MaxAmount", sql.Decimal(18, 2), line.MaxAmount)
      .input("RoundingRule", sql.NVarChar(10), line.RoundingRule)
      .input("Sequence", sql.Int, line.Sequence)
      .input("IncludeInGross", sql.Bit, line.IncludeInGross ? 1 : 0)
      .input("IncludeInCTC", sql.Bit, line.IncludeInCTC ? 1 : 0)
      .input("IncludeInNet", sql.Bit, line.IncludeInNet ? 1 : 0)
      .input("Taxable", sql.Bit, line.Taxable ? 1 : 0)
      .input("IsBalancing", sql.Bit, line.IsBalancing ? 1 : 0)
      .input("IsActive", sql.Bit, line.IsActive ? 1 : 0)
      .query(`
        INSERT INTO dbo.SalaryStructureLines (
          SalaryStructureId, DeductionAdditionId, CalculationType, CalculationBase, Percentage, Amount,
          Formula, MinAmount, MaxAmount, RoundingRule, Sequence, IncludeInGross, IncludeInCTC, IncludeInNet,
          Taxable, IsBalancing, IsActive, CreatedAt
        )
        VALUES (
          @StructureId, @HeadId, @CalculationType, @CalculationBase, @Percentage, @Amount,
          @Formula, @MinAmount, @MaxAmount, @RoundingRule, @Sequence, @IncludeInGross, @IncludeInCTC, @IncludeInNet,
          @Taxable, @IsBalancing, @IsActive, SYSUTCDATETIME()
        )
      `);
  }
}

// PUT — update salary structure header + replace its lines
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { CompanyId, Name, Code, Description, EffectiveFrom, EffectiveTo, CTCFrequency, IsActive, Lines } = req.body;
  const pool = getPool();

  const errs = headerErrors(req.body);
  const { engineLines, errors: buildErrors } = await buildEngineLines(pool, Lines || []);
  const { errors: engineErrors } = validateStructure(engineLines);
  const allErrors = [...errs, ...buildErrors, ...engineErrors];

  if (IsActive === true && allErrors.length) {
    return res.status(400).json({ error: "Cannot activate: validation failed", errors: allErrors });
  }
  if (errs.length) {
    return res.status(400).json({ error: errs[0].message, errors: allErrors });
  }

  const updatedBy = req.user?.userId || null;
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
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("EffectiveFrom", sql.Date, EffectiveFrom || null)
      .input("EffectiveTo", sql.Date, EffectiveTo || null)
      .input("CTCFrequency", sql.NVarChar(10), CTCFrequency === "Annual" ? "Annual" : "Monthly")
      .input("IsActive", sql.Bit, IsActive === true ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.SalaryStructure SET
          CompanyId = @CompanyId, Name = @Name, Code = @Code, Description = @Description,
          EffectiveFrom = @EffectiveFrom, EffectiveTo = @EffectiveTo, CTCFrequency = @CTCFrequency,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE SalaryStructureId = @Id
      `);

    await tx.request().input("Id", sql.Int, id).query("DELETE FROM dbo.SalaryStructureLines WHERE SalaryStructureId = @Id");
    await insertLines(tx, id, engineLines);

    await tx.commit();
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure updated successfully", warnings: allErrors });
  } catch (err) {
    await tx.rollback();
    if (isUniqueViolation(err)) return res.status(409).json({ error: uniqueViolationMessage(err) });
    console.error("[salary-structure] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/activate -- blocked while validation errors exist.
router.post("/:id/activate", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const linesRes = await pool.request().input("Id", sql.Int, id).query(`${LINES_SELECT} WHERE l.SalaryStructureId = @Id`);
    if (!linesRes.recordset.length) return res.status(400).json({ error: "Cannot activate: at least one Salary Head line is required" });
    const { engineLines } = await buildEngineLines(pool, linesRes.recordset);
    const { errors } = validateStructure(engineLines);
    if (errors.length) return res.status(400).json({ error: "Cannot activate: validation failed", errors });

    const updatedBy = req.user?.userId || null;
    await pool.request().input("Id", sql.Int, id).input("UpdatedBy", sql.Int, updatedBy)
      .query("UPDATE dbo.SalaryStructure SET IsActive = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE SalaryStructureId = @Id");
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure activated" });
  } catch (err) {
    console.error("[salary-structure] POST /activate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/deactivate", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const updatedBy = req.user?.userId || null;
    await pool.request().input("Id", sql.Int, id).input("UpdatedBy", sql.Int, updatedBy)
      .query("UPDATE dbo.SalaryStructure SET IsActive = 0, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE SalaryStructureId = @Id");
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure deactivated" });
  } catch (err) {
    console.error("[salary-structure] POST /deactivate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/copy -- duplicate as a new Draft (new Code supplied by caller).
router.post("/:id/copy", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { Code, Name } = req.body;
  if (!Code?.trim()) return res.status(400).json({ error: "A new Structure Code is required for the copy" });
  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const hdrRes = await tx.request().input("Id", sql.Int, id).query(`${HEADER_SELECT} WHERE s.SalaryStructureId = @Id`);
    if (!hdrRes.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ error: "Salary structure not found" });
    }
    const src = hdrRes.recordset[0];
    const linesRes = await tx.request().input("Id", sql.Int, id).query(`${LINES_SELECT} WHERE l.SalaryStructureId = @Id`);

    const createdBy = req.user?.userId || null;
    const hdr = await tx
      .request()
      .input("CompanyId", sql.Int, src.CompanyId || null)
      .input("Name", sql.NVarChar(150), (Name || src.Name).trim())
      .input("Code", sql.NVarChar(30), Code.trim())
      .input("Description", sql.NVarChar(sql.MAX), src.Description || null)
      .input("EffectiveFrom", sql.Date, src.EffectiveFrom || null)
      .input("EffectiveTo", sql.Date, src.EffectiveTo || null)
      .input("CTCFrequency", sql.NVarChar(10), src.CTCFrequency)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.SalaryStructure (CompanyId, Name, Code, Description, EffectiveFrom, EffectiveTo, CTCFrequency, Version, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.SalaryStructureId
        VALUES (@CompanyId, @Name, @Code, @Description, @EffectiveFrom, @EffectiveTo, @CTCFrequency, 1, 0, @CreatedBy, SYSUTCDATETIME())
      `);
    const newId = hdr.recordset[0].SalaryStructureId;
    const engineLines = linesRes.recordset.map((l) => ({
      DeductionAdditionId: l.DeductionAdditionId,
      CalculationType: l.CalculationType,
      CalculationBase: l.CalculationBase,
      Percentage: l.Percentage,
      Amount: l.Amount,
      Formula: l.Formula,
      MinAmount: l.MinAmount,
      MaxAmount: l.MaxAmount,
      RoundingRule: l.RoundingRule,
      Sequence: l.Sequence,
      IncludeInGross: l.IncludeInGross,
      IncludeInCTC: l.IncludeInCTC,
      IncludeInNet: l.IncludeInNet,
      Taxable: l.Taxable,
      IsBalancing: l.IsBalancing,
      IsActive: l.IsActive,
    }));
    await insertLines(tx, newId, engineLines);

    await tx.commit();
    await bumpCacheVersion("salary-structure");
    res.json({ message: "Salary structure copied successfully", id: newId });
  } catch (err) {
    await tx.rollback();
    if (isUniqueViolation(err)) return res.status(409).json({ error: uniqueViolationMessage(err) });
    console.error("[salary-structure] POST /copy error:", err.message);
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
module.exports.HEADER_SELECT = HEADER_SELECT;
module.exports.LINES_SELECT = LINES_SELECT;
module.exports.buildEngineLines = buildEngineLines;
