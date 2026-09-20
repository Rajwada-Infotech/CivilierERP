const allowRoles = require("../middleware/role");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { pickStructureVersion, calculateStructure } = require("../lib/formulaEngine");
const salaryStructureRoutes = require("./salaryStructure");

const RUN_SELECT = `
  SELECT r.PayrollRunId, r.CompanyId, comp.name AS CompanyName, r.PeriodMonth, r.PeriodYear, r.Status,
         r.ProcessedAt, r.CreatedAt,
         (SELECT COUNT(*) FROM dbo.PayrollRunEmployee pre WHERE pre.PayrollRunId = r.PayrollRunId) AS EmployeeCount
  FROM dbo.PayrollRun r
  LEFT JOIN dbo.enterprise comp ON comp.id = r.CompanyId
`;

// Last calendar day of the period -- used to resolve which Salary
// Structure version applies for that month (spec 16).
function periodEndDate(month, year) {
  return new Date(Date.UTC(year, month, 0));
}

// GET all payroll runs
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${RUN_SELECT} ORDER BY r.PeriodYear DESC, r.PeriodMonth DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[payroll-run] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET one payroll run + its per-employee summary
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const runRes = await pool.request().input("Id", sql.Int, id).query(`${RUN_SELECT} WHERE r.PayrollRunId = @Id`);
    if (!runRes.recordset.length) return res.status(404).json({ error: "Payroll run not found" });

    const employeesRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT pre.PayrollRunEmployeeId, pre.EmployeeId, e.EmployeeCode, e.EmployeeName,
             pre.SalaryStructureId, ss.Name AS SalaryStructureName,
             pre.CTCUsed, pre.MonthlyCTCUsed, pre.GrossSalary, pre.TotalEmployeeDeduction,
             pre.NetSalary, pre.TotalEmployerContribution, pre.TotalCTC, pre.ComputedAt
      FROM dbo.PayrollRunEmployee pre
      JOIN dbo.EmployeeMaster e ON e.EmployeeId = pre.EmployeeId
      LEFT JOIN dbo.SalaryStructure ss ON ss.SalaryStructureId = pre.SalaryStructureId
      WHERE pre.PayrollRunId = @Id
      ORDER BY e.EmployeeName
    `);

    res.json({ ...runRes.recordset[0], Employees: employeesRes.recordset });
  } catch (err) {
    console.error("[payroll-run] GET /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST -- create a Draft run for Company + Month + Year
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CompanyId, PeriodMonth, PeriodYear } = req.body;
  const month = Number(PeriodMonth);
  const year = Number(PeriodYear);
  if (!Number.isFinite(month) || month < 1 || month > 12) return res.status(400).json({ error: "PeriodMonth must be 1-12" });
  if (!Number.isFinite(year) || year < 2000) return res.status(400).json({ error: "PeriodYear is required" });
  try {
    const pool = getPool();
    const createdBy = req.user?.userId || null;
    const result = await pool
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("PeriodMonth", sql.Int, month)
      .input("PeriodYear", sql.Int, year)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.PayrollRun (CompanyId, PeriodMonth, PeriodYear, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.PayrollRunId
        VALUES (@CompanyId, @PeriodMonth, @PeriodYear, N'Draft', @CreatedBy, SYSUTCDATETIME())
      `);
    res.json({ message: "Payroll run created", id: result.recordset[0].PayrollRunId });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: "A payroll run for this company/period already exists" });
    }
    console.error("[payroll-run] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/process -- computes (or recomputes) every eligible employee's
// salary for this run's period, using the Salary Structure version whose
// Effective From/To window covers the period's last day. Idempotent while
// the run is Draft/Processed; rejected once Locked (spec 15).
router.post("/:id/process", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const pool = getPool();
  try {
    const runRes = await pool.request().input("Id", sql.Int, id)
      .query("SELECT PayrollRunId, CompanyId, PeriodMonth, PeriodYear, Status FROM dbo.PayrollRun WHERE PayrollRunId = @Id");
    const run = runRes.recordset[0];
    if (!run) return res.status(404).json({ error: "Payroll run not found" });
    if (run.Status === "Locked") return res.status(400).json({ error: "This payroll run is locked and cannot be reprocessed" });

    let empQuery = `
      SELECT EmployeeId, EmployeeName, CTCAmount, CTCFrequency, SalaryStructureCode
      FROM dbo.EmployeeMaster
      WHERE IsActive = 1 AND CTCAmount IS NOT NULL AND CTCFrequency IS NOT NULL AND SalaryStructureCode IS NOT NULL
    `;
    const empReq = pool.request();
    if (run.CompanyId) {
      empQuery += " AND CompanyId = @CompanyId";
      empReq.input("CompanyId", sql.Int, run.CompanyId);
    }
    const employees = (await empReq.query(empQuery)).recordset;

    const asOfDate = periodEndDate(run.PeriodMonth, run.PeriodYear);
    const results = [];
    const skipped = [];

    for (const emp of employees) {
      const versionsRes = await pool.request().input("Code", sql.NVarChar(30), emp.SalaryStructureCode)
        .query(`${salaryStructureRoutes.HEADER_SELECT} WHERE s.Code = @Code`);
      const structure = pickStructureVersion(versionsRes.recordset, asOfDate);
      if (!structure) {
        skipped.push({ EmployeeId: emp.EmployeeId, EmployeeName: emp.EmployeeName, reason: `No active Salary Structure version for code "${emp.SalaryStructureCode}"` });
        continue;
      }

      const linesRes = await pool.request().input("Id", sql.Int, structure.SalaryStructureId)
        .query(`${salaryStructureRoutes.LINES_SELECT} WHERE l.SalaryStructureId = @Id ORDER BY l.Sequence, l.LineId`);
      const { engineLines } = await salaryStructureRoutes.buildEngineLines(pool, linesRes.recordset);
      const calc = calculateStructure(engineLines, Number(emp.CTCAmount), emp.CTCFrequency, structure.CTCFrequency);
      if (!calc.valid) {
        skipped.push({ EmployeeId: emp.EmployeeId, EmployeeName: emp.EmployeeName, reason: calc.errors.map((e) => e.message).join("; ") });
        continue;
      }
      results.push({ emp, structure, calc, engineLines });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const { emp, structure, calc, engineLines } of results) {
        await tx.request().input("RunId", sql.Int, id).input("EmployeeId", sql.Int, emp.EmployeeId)
          .query(`
            DELETE prl FROM dbo.PayrollRunEmployeeLines prl
            JOIN dbo.PayrollRunEmployee pre ON pre.PayrollRunEmployeeId = prl.PayrollRunEmployeeId
            WHERE pre.PayrollRunId = @RunId AND pre.EmployeeId = @EmployeeId
          `);
        await tx.request().input("RunId", sql.Int, id).input("EmployeeId", sql.Int, emp.EmployeeId)
          .query("DELETE FROM dbo.PayrollRunEmployee WHERE PayrollRunId = @RunId AND EmployeeId = @EmployeeId");

        const preRes = await tx
          .request()
          .input("RunId", sql.Int, id)
          .input("EmployeeId", sql.Int, emp.EmployeeId)
          .input("StructureId", sql.Int, structure.SalaryStructureId)
          .input("CTCUsed", sql.Decimal(18, 2), Number(emp.CTCAmount))
          .input("MonthlyCTCUsed", sql.Decimal(18, 2), calc.totals.MonthlyCTC)
          .input("GrossSalary", sql.Decimal(18, 2), calc.totals.GrossSalary)
          .input("TotalEmployeeDeduction", sql.Decimal(18, 2), calc.totals.TotalEmployeeDeduction)
          .input("NetSalary", sql.Decimal(18, 2), calc.totals.NetSalary)
          .input("TotalEmployerContribution", sql.Decimal(18, 2), calc.totals.TotalEmployerContribution)
          .input("TotalCTC", sql.Decimal(18, 2), calc.totals.TotalCTC)
          .query(`
            INSERT INTO dbo.PayrollRunEmployee (
              PayrollRunId, EmployeeId, SalaryStructureId, CTCUsed, MonthlyCTCUsed, GrossSalary,
              TotalEmployeeDeduction, NetSalary, TotalEmployerContribution, TotalCTC, ComputedAt
            )
            OUTPUT INSERTED.PayrollRunEmployeeId
            VALUES (@RunId, @EmployeeId, @StructureId, @CTCUsed, @MonthlyCTCUsed, @GrossSalary,
              @TotalEmployeeDeduction, @NetSalary, @TotalEmployerContribution, @TotalCTC, SYSUTCDATETIME())
          `);
        const preId = preRes.recordset[0].PayrollRunEmployeeId;

        for (const line of calc.lines) {
          const engineLine = engineLines.find((l) => l.DeductionAdditionId === line.DeductionAdditionId);
          await tx
            .request()
            .input("PREId", sql.Int, preId)
            .input("HeadId", sql.Int, line.DeductionAdditionId)
            .input("HeadName", sql.NVarChar(150), line.HeadName)
            .input("HeadCode", sql.NVarChar(30), line.HeadCode)
            .input("ComponentType", sql.NVarChar(30), line.HeadType)
            .input("Amount", sql.Decimal(18, 2), line.Amount)
            .input("IncludeInGross", sql.Bit, engineLine?.IncludeInGross ? 1 : 0)
            .input("IncludeInCTC", sql.Bit, engineLine?.IncludeInCTC ? 1 : 0)
            .input("IncludeInNet", sql.Bit, engineLine?.IncludeInNet ? 1 : 0)
            .input("Taxable", sql.Bit, engineLine?.Taxable ? 1 : 0)
            .query(`
              INSERT INTO dbo.PayrollRunEmployeeLines (
                PayrollRunEmployeeId, DeductionAdditionId, HeadName, HeadCode, ComponentType, Amount,
                IncludeInGross, IncludeInCTC, IncludeInNet, Taxable
              )
              VALUES (@PREId, @HeadId, @HeadName, @HeadCode, @ComponentType, @Amount,
                @IncludeInGross, @IncludeInCTC, @IncludeInNet, @Taxable)
            `);
        }
      }

      const processedBy = req.user?.userId || null;
      await tx.request().input("Id", sql.Int, id).input("ProcessedBy", sql.Int, processedBy)
        .query("UPDATE dbo.PayrollRun SET Status = N'Processed', ProcessedAt = SYSUTCDATETIME(), ProcessedBy = @ProcessedBy WHERE PayrollRunId = @Id");

      await tx.commit();
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }

    res.json({
      message: `Processed ${results.length} employee(s)${skipped.length ? `, ${skipped.length} skipped` : ""}`,
      processed: results.length,
      skipped,
    });
  } catch (err) {
    console.error("[payroll-run] POST /process error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/lock -- finalize; once locked, /process is rejected for this
// run (spec 15) and the frozen payslip lines become immutable.
router.post("/:id/lock", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const runRes = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Status FROM dbo.PayrollRun WHERE PayrollRunId = @Id");
    if (!runRes.recordset.length) return res.status(404).json({ error: "Payroll run not found" });
    if (runRes.recordset[0].Status !== "Processed") {
      return res.status(400).json({ error: "Only a Processed run can be locked -- process it first" });
    }
    await pool.request().input("Id", sql.Int, id).query("UPDATE dbo.PayrollRun SET Status = N'Locked' WHERE PayrollRunId = @Id");
    res.json({ message: "Payroll run locked" });
  } catch (err) {
    console.error("[payroll-run] POST /lock error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET the frozen payslip for one employee in this run, shaped into
// Earnings / Deductions / Net / Employer Contribution / CTC sections
// (spec 13) -- reads only PayrollRunEmployeeLines, never live data, so it
// stays correct even after the Salary Structure later changes (spec 15).
router.get("/:id/employee/:employeeId/payslip", async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  const employeeId = parseInt(req.params.employeeId, 10);
  if (!Number.isFinite(runId) || !Number.isFinite(employeeId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const runRes = await pool.request().input("RunId", sql.Int, runId).query(`${RUN_SELECT} WHERE r.PayrollRunId = @RunId`);
    if (!runRes.recordset.length) return res.status(404).json({ error: "Payroll run not found" });

    const preRes = await pool.request().input("RunId", sql.Int, runId).input("EmployeeId", sql.Int, employeeId).query(`
      SELECT pre.PayrollRunEmployeeId, pre.EmployeeId, e.EmployeeCode, e.EmployeeName, e.Designation, e.Department,
             pre.SalaryStructureId, ss.Name AS SalaryStructureName,
             pre.CTCUsed, pre.MonthlyCTCUsed, pre.GrossSalary, pre.TotalEmployeeDeduction,
             pre.NetSalary, pre.TotalEmployerContribution, pre.TotalCTC, pre.ComputedAt
      FROM dbo.PayrollRunEmployee pre
      JOIN dbo.EmployeeMaster e ON e.EmployeeId = pre.EmployeeId
      LEFT JOIN dbo.SalaryStructure ss ON ss.SalaryStructureId = pre.SalaryStructureId
      WHERE pre.PayrollRunId = @RunId AND pre.EmployeeId = @EmployeeId
    `);
    const pre = preRes.recordset[0];
    if (!pre) return res.status(404).json({ error: "No payslip found for this employee in this run" });

    const linesRes = await pool.request().input("PREId", sql.Int, pre.PayrollRunEmployeeId).query(`
      SELECT HeadName, HeadCode, ComponentType, Amount, IncludeInGross, IncludeInCTC, IncludeInNet, Taxable
      FROM dbo.PayrollRunEmployeeLines WHERE PayrollRunEmployeeId = @PREId ORDER BY LineId
    `);
    const lines = linesRes.recordset;

    res.json({
      Run: runRes.recordset[0],
      Employee: { EmployeeId: pre.EmployeeId, EmployeeCode: pre.EmployeeCode, EmployeeName: pre.EmployeeName, Designation: pre.Designation, Department: pre.Department },
      SalaryStructureName: pre.SalaryStructureName,
      CTCUsed: pre.CTCUsed,
      MonthlyCTCUsed: pre.MonthlyCTCUsed,
      Earnings: lines.filter((l) => l.ComponentType === "Earning"),
      Deductions: lines.filter((l) => l.ComponentType === "Deduction"),
      EmployerContributions: lines.filter((l) => l.ComponentType === "Employer Contribution"),
      Informational: lines.filter((l) => l.ComponentType === "Informational"),
      GrossSalary: pre.GrossSalary,
      TotalEmployeeDeduction: pre.TotalEmployeeDeduction,
      NetSalary: pre.NetSalary,
      TotalEmployerContribution: pre.TotalEmployerContribution,
      TotalCTC: pre.TotalCTC,
    });
  } catch (err) {
    console.error("[payroll-run] GET /payslip error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE -- removes the whole run (and its per-employee snapshot + lines,
// cascading via the FK) regardless of Status, including Locked. Deleting a
// run is a distinct operation from mutating one: it doesn't touch any
// other run's frozen data, so it doesn't undermine the immutability
// guarantee Locked status gives already-issued payslips elsewhere.
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT PeriodMonth, PeriodYear FROM dbo.PayrollRun WHERE PayrollRunId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Payroll run not found" });

    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.PayrollRun WHERE PayrollRunId = @Id");
    const { PeriodMonth, PeriodYear } = existing.recordset[0];
    res.json({ message: `Payroll run for ${PeriodMonth}/${PeriodYear} deleted successfully` });
  } catch (err) {
    console.error("[payroll-run] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
