"use strict";

/**
 * backend/routes/employeePortal.js
 *
 * Employee-facing endpoints for the Employee Portal. Mounted at /api/employee-portal behind authenticateToken +
 * role("employee") in server.js. Every handler resolves the caller's own Employee Master record from the signed-in
 * user's e-mail (the same match Employee Attendance uses) and scopes every query to that EmployeeId -- the client
 * never supplies an employee id.
 *
 *   GET    /me                      profile
 *   GET    /salary                  CTC / structure, latest payslip breakdown, monthly history
 *   GET    /payslips                locked payroll months, newest first
 *   GET    /payslips/:runId         one payslip (earnings, deductions, net)
 *   GET    /login-history           this person's recent sign-ins
 *   GET    /attendance?month=YYYY-MM
 *   GET    /holidays?year=YYYY
 *   GET    /leave/balances?year=YYYY
 *   GET    /leave                   leave history
 *   POST   /leave                   apply (Pending until HR decides)
 *   DELETE /leave/:id               withdraw a Pending application
 */

const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { bumpCacheVersion } = require("../redis");

const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid"];
const LIMITED_TYPES = ["Casual", "Sick", "Earned"];

const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });

// ── The caller's own Employee Master record ──────────────────────────────────
async function resolveEmployee(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim();
    if (!email) return bad(res, "Your login has no e-mail address, so it can't be matched to an employee.", 403);
    const r = await getPool().request().input("Email", sql.NVarChar(150), email).query(`
      SELECT e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.Email, e.Mobile, e.Department, e.Designation, e.BranchLocation,
             e.EmploymentType, e.JoiningDate, e.CompanyId, comp.name AS CompanyName,
             e.CTCAmount, e.CTCFrequency, e.SalaryStructureCode, e.PhotoBase64,
             e.BankName, e.BankAccountNumber
      FROM dbo.EmployeeMaster e
      LEFT JOIN dbo.enterprise comp ON comp.id = e.CompanyId
      WHERE e.IsActive = 1 AND LOWER(LTRIM(RTRIM(e.Email))) = LOWER(@Email)
    `);
    if (r.recordset.length === 0) return bad(res, "Your login isn't linked to an active employee record. Please contact HR.", 403);
    if (r.recordset.length > 1) return bad(res, "More than one employee record has your e-mail address. Please contact HR.", 403);
    req.employee = r.recordset[0];
    next();
  } catch (err) {
    console.error("[employee-portal] resolveEmployee:", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.use(resolveEmployee);

const maskAccount = (n) => {
  const s = String(n || "").trim();
  return s.length > 4 ? `${"•".repeat(s.length - 4)}${s.slice(-4)}` : s;
};

// ── GET /me ──────────────────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  const e = req.employee;
  res.json({
    EmployeeId: e.EmployeeId, EmployeeCode: e.EmployeeCode, EmployeeName: e.EmployeeName, Email: e.Email, Mobile: e.Mobile,
    Department: e.Department, Designation: e.Designation, BranchLocation: e.BranchLocation, EmploymentType: e.EmploymentType,
    JoiningDate: e.JoiningDate, CompanyName: e.CompanyName, Photo: e.PhotoBase64 || null,
  });
});

// ── Payslips ─────────────────────────────────────────────────────────────────
// Only Locked runs: HR locks a month once it is final, so an employee never sees draft or reprocessed figures.
const RUN_ROWS = `
  FROM dbo.PayrollRunEmployee pre
  JOIN dbo.PayrollRun r ON r.PayrollRunId = pre.PayrollRunId
  WHERE pre.EmployeeId = @EmployeeId AND r.Status = N'Locked'
`;

router.get("/payslips", async (req, res) => {
  try {
    const r = await getPool().request().input("EmployeeId", sql.Int, req.employee.EmployeeId).query(`
      SELECT r.PayrollRunId, r.PeriodMonth, r.PeriodYear, pre.GrossSalary, pre.TotalEmployeeDeduction, pre.NetSalary
      ${RUN_ROWS}
      ORDER BY r.PeriodYear DESC, r.PeriodMonth DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[employee-portal] GET /payslips:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function loadPayslip(pool, employee, runId) {
  const pre = (await pool.request().input("EmployeeId", sql.Int, employee.EmployeeId).input("RunId", sql.Int, runId).query(`
    SELECT pre.PayrollRunEmployeeId, r.PayrollRunId, r.PeriodMonth, r.PeriodYear,
           ss.Name AS SalaryStructureName, pre.GrossSalary, pre.TotalEmployeeDeduction, pre.NetSalary
    FROM dbo.PayrollRunEmployee pre
    JOIN dbo.PayrollRun r ON r.PayrollRunId = pre.PayrollRunId
    LEFT JOIN dbo.SalaryStructure ss ON ss.SalaryStructureId = pre.SalaryStructureId
    WHERE pre.EmployeeId = @EmployeeId AND r.Status = N'Locked' AND r.PayrollRunId = @RunId
  `)).recordset[0];
  if (!pre) return null;
  const lines = (await pool.request().input("PREId", sql.Int, pre.PayrollRunEmployeeId).query(`
    SELECT HeadName, HeadCode, ComponentType, Amount
    FROM dbo.PayrollRunEmployeeLines WHERE PayrollRunEmployeeId = @PREId ORDER BY LineId
  `)).recordset;
  return {
    Employee: {
      EmployeeCode: employee.EmployeeCode, EmployeeName: employee.EmployeeName, Designation: employee.Designation,
      Department: employee.Department, CompanyName: employee.CompanyName, JoiningDate: employee.JoiningDate,
      BankName: employee.BankName, BankAccountNumber: maskAccount(employee.BankAccountNumber),
    },
    PayrollRunId: pre.PayrollRunId, PeriodMonth: pre.PeriodMonth, PeriodYear: pre.PeriodYear,
    SalaryStructureName: pre.SalaryStructureName,
    Earnings: lines.filter((l) => l.ComponentType === "Earning"),
    Deductions: lines.filter((l) => l.ComponentType === "Deduction"),
    GrossSalary: pre.GrossSalary, TotalEmployeeDeduction: pre.TotalEmployeeDeduction, NetSalary: pre.NetSalary,
  };
}

router.get("/payslips/:runId", async (req, res) => {
  const runId = parseInt(req.params.runId, 10);
  if (!Number.isInteger(runId)) return bad(res, "Invalid payslip");
  try {
    const slip = await loadPayslip(getPool(), req.employee, runId);
    if (!slip) return bad(res, "No payslip found for that month.", 404);
    res.json(slip);
  } catch (err) {
    console.error("[employee-portal] GET /payslips/:runId:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /salary ──────────────────────────────────────────────────────────────
router.get("/salary", async (req, res) => {
  try {
    const pool = getPool();
    const e = req.employee;
    const history = (await pool.request().input("EmployeeId", sql.Int, e.EmployeeId).query(`
      SELECT TOP 12 r.PayrollRunId, r.PeriodMonth, r.PeriodYear, pre.GrossSalary, pre.TotalEmployeeDeduction, pre.NetSalary
      ${RUN_ROWS}
      ORDER BY r.PeriodYear DESC, r.PeriodMonth DESC
    `)).recordset;
    const structure = e.SalaryStructureCode
      ? (await pool.request().input("Code", sql.NVarChar(50), e.SalaryStructureCode).query(
          "SELECT TOP 1 Name FROM dbo.SalaryStructure WHERE Code = @Code ORDER BY IsActive DESC, Version DESC",
        )).recordset[0]
      : null;
    const latest = history.length ? await loadPayslip(pool, e, history[0].PayrollRunId) : null;
    res.json({
      CTCAmount: e.CTCAmount, CTCFrequency: e.CTCFrequency, SalaryStructureName: structure?.Name || null,
      Latest: latest, History: history,
    });
  } catch (err) {
    console.error("[employee-portal] GET /salary:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /login-history ───────────────────────────────────────────────────────
router.get("/login-history", async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    const r = await getPool().request().input("UserId", sql.Int, userId).query(`
      SELECT TOP 100 LoginHistoryId, LoginAt, Success, FailureReason, IpAddress, UserAgent, Portal
      FROM dbo.UserLoginHistory WHERE UserId = @UserId ORDER BY LoginAt DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[employee-portal] GET /login-history:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /holidays ────────────────────────────────────────────────────────────
router.get("/holidays", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const r = await getPool().request().input("Year", sql.Int, year).query(`
      SELECT HolidayId, HolidayName, HolidayDate
      FROM dbo.HolidayMaster WHERE IsActive = 1 AND YEAR(HolidayDate) = @Year ORDER BY HolidayDate
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[employee-portal] GET /holidays:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /attendance?month=YYYY-MM ────────────────────────────────────────────
// One row per day that has anything: HR's attendance entry wins; otherwise the employee's own clock in/out counts as
// Present; approved leave and holidays fill the rest. Times are UTC ISO strings (the page formats them in IST).
router.get("/attendance", async (req, res) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ""));
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const month = m ? Number(m[2]) : now.getMonth() + 1;
  if (month < 1 || month > 12) return bad(res, "Invalid month");
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = ymd(new Date(Date.UTC(year, month, 0)));
  try {
    const pool = getPool();
    const q = (extra = (r) => r) => extra(pool.request().input("E", sql.Int, req.employee.EmployeeId).input("From", sql.Date, from).input("To", sql.Date, to));
    const [self, hr, leave, hol] = await Promise.all([
      q().query(`SELECT AttendanceDate, InTime, OutTime FROM dbo.EmployeeAttendance WHERE EmployeeId = @E AND AttendanceDate BETWEEN @From AND @To`),
      q().query(`SELECT AttendanceDate, Status, CheckIn, CheckOut, Remarks FROM dbo.AttendanceRecord WHERE EmployeeId = @E AND IsActive = 1 AND AttendanceDate BETWEEN @From AND @To`),
      q().query(`SELECT FromDate, ToDate, LeaveType FROM dbo.LeaveRecord WHERE EmployeeId = @E AND IsActive = 1 AND Status = N'Approved' AND ToDate >= @From AND FromDate <= @To`),
      q().query(`SELECT HolidayDate, HolidayName FROM dbo.HolidayMaster WHERE IsActive = 1 AND HolidayDate BETWEEN @From AND @To`),
    ]);

    const days = new Map();
    const put = (date, patch) => days.set(date, { Date: date, Status: null, CheckIn: null, CheckOut: null, Hours: null, Note: null, ...(days.get(date) || {}), ...patch });

    for (const h of hol.recordset) put(ymd(h.HolidayDate), { Status: "Holiday", Note: h.HolidayName });
    for (const l of leave.recordset) {
      for (let d = new Date(l.FromDate); d <= new Date(l.ToDate); d = new Date(d.getTime() + 86400000)) {
        const key = ymd(d);
        if (key >= from && key <= to) put(key, { Status: "On Leave", Note: `${l.LeaveType} leave` });
      }
    }
    for (const s of self.recordset) {
      const hours = s.OutTime ? Math.round(((new Date(s.OutTime) - new Date(s.InTime)) / 3600000) * 100) / 100 : null;
      put(ymd(s.AttendanceDate), { Status: "Present", CheckIn: new Date(s.InTime).toISOString(), CheckOut: s.OutTime ? new Date(s.OutTime).toISOString() : null, Hours: hours, Note: s.OutTime ? null : "Not clocked out" });
    }
    for (const a of hr.recordset) {
      put(ymd(a.AttendanceDate), { Status: a.Status, CheckInText: a.CheckIn, CheckOutText: a.CheckOut, Note: a.Remarks || null });
    }

    const rows = [...days.values()].sort((a, b) => (a.Date < b.Date ? -1 : 1));
    const count = (s) => rows.filter((r) => r.Status === s).length;
    res.json({
      Month: `${year}-${String(month).padStart(2, "0")}`,
      Summary: { Present: count("Present"), Absent: count("Absent"), HalfDay: count("Half Day"), OnLeave: count("On Leave"), Holiday: count("Holiday"), WeekOff: count("Week Off") },
      Days: rows,
    });
  } catch (err) {
    console.error("[employee-portal] GET /attendance:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Leave ────────────────────────────────────────────────────────────────────
async function balancesFor(pool, employeeId, year) {
  const r = await pool.request().input("E", sql.Int, employeeId).input("Y", sql.Int, year).query(`
    SELECT p.LeaveType,
           ISNULL(o.Days, p.DaysPerYear) AS Entitled,
           ISNULL((SELECT SUM(TotalDays) FROM dbo.LeaveRecord l WHERE l.EmployeeId = @E AND l.IsActive = 1 AND l.LeaveType = p.LeaveType AND l.Status = N'Approved' AND YEAR(l.FromDate) = @Y), 0) AS Used,
           ISNULL((SELECT SUM(TotalDays) FROM dbo.LeaveRecord l WHERE l.EmployeeId = @E AND l.IsActive = 1 AND l.LeaveType = p.LeaveType AND l.Status = N'Pending' AND YEAR(l.FromDate) = @Y), 0) AS Pending
    FROM dbo.LeavePolicy p
    LEFT JOIN dbo.EmployeeLeaveEntitlement o ON o.EmployeeId = @E AND o.LeaveYear = @Y AND o.LeaveType = p.LeaveType
    ORDER BY CASE p.LeaveType WHEN N'Casual' THEN 1 WHEN N'Sick' THEN 2 ELSE 3 END
  `);
  const rows = r.recordset.map((x) => ({ ...x, Entitled: Number(x.Entitled), Balance: Number(x.Entitled) - Number(x.Used) - Number(x.Pending) }));
  const unpaid = (await pool.request().input("E", sql.Int, employeeId).input("Y", sql.Int, year).query(`
    SELECT ISNULL(SUM(CASE WHEN Status = N'Approved' THEN TotalDays END), 0) AS Used, ISNULL(SUM(CASE WHEN Status = N'Pending' THEN TotalDays END), 0) AS Pending
    FROM dbo.LeaveRecord WHERE EmployeeId = @E AND IsActive = 1 AND LeaveType = N'Unpaid' AND YEAR(FromDate) = @Y
  `)).recordset[0];
  rows.push({ LeaveType: "Unpaid", Entitled: null, Used: unpaid.Used, Pending: unpaid.Pending, Balance: null });
  return rows;
}

router.get("/leave/balances", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json({ Year: year, Balances: await balancesFor(getPool(), req.employee.EmployeeId, year) });
  } catch (err) {
    console.error("[employee-portal] GET /leave/balances:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/leave", async (req, res) => {
  try {
    const r = await getPool().request().input("E", sql.Int, req.employee.EmployeeId).query(`
      SELECT LeaveId, LeaveType, FromDate, ToDate, TotalDays, Reason, Status, HrRemarks, CreatedAt
      FROM dbo.LeaveRecord WHERE EmployeeId = @E AND IsActive = 1 ORDER BY FromDate DESC, LeaveId DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[employee-portal] GET /leave:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/leave", async (req, res) => {
  const { LeaveType, Reason } = req.body || {};
  const FromDate = toDate(req.body?.FromDate);
  const ToDate = toDate(req.body?.ToDate);
  if (!LEAVE_TYPES.includes(LeaveType)) return bad(res, `Leave type must be one of: ${LEAVE_TYPES.join(", ")}`);
  if (!FromDate || !ToDate) return bad(res, "From date and to date are required");
  if (ToDate < FromDate) return bad(res, "To date cannot be before from date");
  if (FromDate.slice(0, 4) !== ToDate.slice(0, 4)) return bad(res, "A leave application cannot span two calendar years. Apply for each year separately.");
  const reason = String(Reason || "").trim();
  if (!reason) return bad(res, "Please give a reason for the leave");
  if (reason.length > 500) return bad(res, "Reason must be 500 characters or less");
  const today = ymd(new Date());
  if (FromDate < ymd(new Date(Date.now() - 30 * 86400000))) return bad(res, "Leave cannot be applied for dates more than 30 days in the past. Please contact HR.");
  if (ToDate > ymd(new Date(Date.now() + 366 * 86400000))) return bad(res, "Leave cannot be applied more than a year ahead");

  const days = Math.round((new Date(ToDate) - new Date(FromDate)) / 86400000) + 1;
  try {
    const pool = getPool();
    const e = req.employee;

    const overlap = await pool.request().input("E", sql.Int, e.EmployeeId).input("From", sql.Date, FromDate).input("To", sql.Date, ToDate).query(`
      SELECT TOP 1 LeaveId FROM dbo.LeaveRecord
      WHERE EmployeeId = @E AND IsActive = 1 AND Status IN (N'Pending', N'Approved') AND FromDate <= @To AND ToDate >= @From
    `);
    if (overlap.recordset.length) return bad(res, "You already have a pending or approved leave that overlaps these dates.", 409);

    if (LIMITED_TYPES.includes(LeaveType)) {
      const b = (await balancesFor(pool, e.EmployeeId, Number(FromDate.slice(0, 4)))).find((x) => x.LeaveType === LeaveType);
      if (b && days > b.Balance) return bad(res, `Not enough ${LeaveType} leave: you asked for ${days} day(s) but have ${Math.max(b.Balance, 0)} left this year.`);
    }

    const userId = req.user?.userId ?? req.user?.id ?? null;
    const ins = await pool.request()
      .input("E", sql.Int, e.EmployeeId).input("Type", sql.NVarChar(20), LeaveType)
      .input("From", sql.Date, FromDate).input("To", sql.Date, ToDate).input("Days", sql.Int, days)
      .input("Reason", sql.NVarChar(500), reason).input("By", sql.Int, userId)
      .query(`
        INSERT INTO dbo.LeaveRecord (EmployeeId, LeaveType, FromDate, ToDate, TotalDays, Reason, Status, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LeaveId
        VALUES (@E, @Type, @From, @To, @Days, @Reason, N'Pending', 1, @By, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("leave-record");
    res.status(201).json({ message: "Leave application submitted", LeaveId: ins.recordset[0].LeaveId, TotalDays: days, AppliedOn: today });
  } catch (err) {
    console.error("[employee-portal] POST /leave:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/leave/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return bad(res, "Invalid leave");
  try {
    const r = await getPool().request().input("Id", sql.Int, id).input("E", sql.Int, req.employee.EmployeeId).query(`
      DELETE FROM dbo.LeaveRecord WHERE LeaveId = @Id AND EmployeeId = @E AND Status = N'Pending'
    `);
    if (!r.rowsAffected[0]) return bad(res, "Only your own pending applications can be withdrawn.", 404);
    await bumpCacheVersion("leave-record");
    res.json({ message: "Application withdrawn" });
  } catch (err) {
    console.error("[employee-portal] DELETE /leave/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
