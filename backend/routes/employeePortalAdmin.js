"use strict";

/**
 * backend/routes/employeePortalAdmin.js
 *
 * HR/Admin side of the Employee Portal (page right "employee-portal-access"), mounted at /api/employee-portal-admin.
 *   GET  /employees                         every active employee and whether they have a portal login
 *   POST /employees/:id/enable              create (or re-enable) the login   { password }
 *   POST /employees/:id/reset-password      { password }
 *   POST /employees/:id/disable
 *   GET  /leave-policy      PUT /leave-policy                { items: [{ LeaveType, DaysPerYear }] }
 *   GET  /employees/:id/entitlements?year   PUT .../entitlements   { year, items: [{ LeaveType, Days|null }] }
 * Salary, payslips (payroll run), attendance, leave approval and holidays are managed on their existing HR pages;
 * the portal reads the same data.
 */

const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const authenticateToken = require("../middleware/auth");
const { pageRightByMethod } = require("../middleware/requirePageRight");
const { getPool, sql } = require("../db");

router.use(authenticateToken);
router.use(pageRightByMethod("employee-portal-access"));

const SALT_ROUNDS = 12;
const LIMITED_TYPES = ["Casual", "Sick", "Earned"];
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
const emailOf = (e) => String(e || "").trim().toLowerCase();
const passwordError = (p) => {
  const s = String(p || "");
  if (s.length < 8) return "Password must be at least 8 characters";
  if (s.length > 100) return "Password is too long";
  return null;
};

async function loadEmployee(pool, id) {
  const r = await pool.request().input("Id", sql.Int, id).query(
    "SELECT EmployeeId, EmployeeName, Email, Department FROM dbo.EmployeeMaster WHERE EmployeeId = @Id AND IsActive = 1",
  );
  return r.recordset[0] || null;
}

// The portal credential's private e-mail in dbo.users: it never equals a real e-mail, so it can't collide with (or sign in as)
// an ERP login. The employee still types their real e-mail at the Employee Portal.
const placeholderEmail = (employeeId) => `employee-${employeeId}@portal.invalid`;

async function employeeRoleId(pool) {
  const r = await pool.request().query("SELECT TOP 1 RId FROM dbo.Role WHERE LOWER(RName) = N'employee portal'");
  return r.recordset[0]?.RId ?? null;
}

// ── GET /employees ───────────────────────────────────────────────────────────
router.get("/employees", async (req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.Email, e.Department, e.Designation,
             u.id AS UserId, u.discontinue AS Discontinued,
             (SELECT MAX(h.LoginAt) FROM dbo.UserLoginHistory h WHERE h.UserId = u.id AND h.Success = 1) AS LastLoginAt
      FROM dbo.EmployeeMaster e
      -- The portal login is its own credential, linked to the employee (migration 677) -- not matched on e-mail,
      -- so an ERP login on the same e-mail is irrelevant here.
      LEFT JOIN dbo.EmployeePortalLogin l ON l.EmployeeId = e.EmployeeId
      LEFT JOIN dbo.users u ON u.id = l.UserId
      WHERE e.IsActive = 1
      ORDER BY e.EmployeeName
    `);
    res.json(
      r.recordset.map((x) => ({
        EmployeeId: x.EmployeeId, EmployeeCode: x.EmployeeCode, EmployeeName: x.EmployeeName, Email: x.Email,
        Department: x.Department, Designation: x.Designation, LastLoginAt: x.LastLoginAt,
        // none: no portal login yet | active | disabled. An e-mail that is also an ERP login no longer matters.
        Access: !x.UserId ? "none" : x.Discontinued ? "disabled" : "active",
        UserRole: null,
      })),
    );
  } catch (err) {
    console.error("[employee-portal-admin] GET /employees:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Enable / reset / disable ─────────────────────────────────────────────────
router.post("/employees/:id/enable", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pwErr = passwordError(req.body?.password);
  if (!Number.isInteger(id)) return bad(res, "Invalid employee");
  if (pwErr) return bad(res, pwErr);
  try {
    const pool = getPool();
    const emp = await loadEmployee(pool, id);
    if (!emp) return bad(res, "Employee not found", 404);
    const email = emailOf(emp.Email);
    if (!email) return bad(res, "Set an e-mail address on the Employee Master record first. The employee signs in with it.");
    const roleId = await employeeRoleId(pool);
    if (!roleId) return bad(res, "The 'Employee Portal' role is missing. Run the latest database migration.", 500);

    // The Employee Portal finds an employee by e-mail, so two active employees can't share one.
    const dup = await pool.request().input("Email", sql.NVarChar(150), email).input("Id", sql.Int, id).query(
      "SELECT COUNT(*) AS N FROM dbo.EmployeeMaster WHERE IsActive = 1 AND EmployeeId <> @Id AND LOWER(LTRIM(RTRIM(Email))) = @Email",
    );
    if (dup.recordset[0].N > 0) return bad(res, "Another active employee has the same e-mail address. Give each employee their own e-mail first.", 409);

    // The portal login is its OWN credential -- a separate dbo.users row (private placeholder e-mail) linked to the
    // employee -- so an ERP login on the same e-mail is no obstacle and its password is never touched.
    const hash = await bcrypt.hash(String(req.body.password), SALT_ROUNDS);
    const existing = (await pool.request().input("E", sql.Int, id).query("SELECT UserId FROM dbo.EmployeePortalLogin WHERE EmployeeId = @E")).recordset[0];
    if (existing) {
      await pool.request().input("Id", sql.Int, existing.UserId).input("Pw", sql.NVarChar, hash)
        .query("UPDATE dbo.users SET discontinue = 0, password = @Pw WHERE id = @Id");
      return res.json({ message: "Employee Portal access re-enabled with the new password" });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const u = await tx.request()
        .input("Name", sql.NVarChar(150), emp.EmployeeName).input("Email", sql.NVarChar(150), placeholderEmail(id))
        .input("Pw", sql.NVarChar, hash).input("RoleId", sql.Int, roleId)
        .query(`
          INSERT INTO dbo.users (name, email, password, RoleId, created_datetime, discontinue, can_accept_tickets)
          OUTPUT INSERTED.id
          VALUES (@Name, @Email, @Pw, @RoleId, GETDATE(), 0, 0)
        `);
      await tx.request().input("E", sql.Int, id).input("U", sql.Int, u.recordset[0].id)
        .query("INSERT INTO dbo.EmployeePortalLogin (EmployeeId, UserId) VALUES (@E, @U)");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already aborted */ } throw e; }
    res.status(201).json({ message: "Employee Portal access enabled" });
  } catch (err) {
    console.error("[employee-portal-admin] POST enable:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function employeeLogin(pool, id) {
  const emp = await loadEmployee(pool, id);
  if (!emp) return { error: "Employee not found", status: 404 };
  const r = (await pool.request().input("E", sql.Int, id).query("SELECT UserId FROM dbo.EmployeePortalLogin WHERE EmployeeId = @E")).recordset;
  if (r.length !== 1) return { error: "This employee has no Employee Portal login.", status: 404 };
  return { userId: r[0].UserId };
}

router.post("/employees/:id/reset-password", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pwErr = passwordError(req.body?.password);
  if (!Number.isInteger(id)) return bad(res, "Invalid employee");
  if (pwErr) return bad(res, pwErr);
  try {
    const pool = getPool();
    const l = await employeeLogin(pool, id);
    if (l.error) return bad(res, l.error, l.status);
    await pool.request().input("Id", sql.Int, l.userId).input("Pw", sql.NVarChar, await bcrypt.hash(String(req.body.password), SALT_ROUNDS))
      .query("UPDATE dbo.users SET password = @Pw WHERE id = @Id");
    res.json({ message: "Password reset" });
  } catch (err) {
    console.error("[employee-portal-admin] POST reset-password:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/employees/:id/disable", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return bad(res, "Invalid employee");
  try {
    const pool = getPool();
    const l = await employeeLogin(pool, id);
    if (l.error) return bad(res, l.error, l.status);
    await pool.request().input("Id", sql.Int, l.userId).query("UPDATE dbo.users SET discontinue = 1 WHERE id = @Id");
    res.json({ message: "Employee Portal access disabled" });
  } catch (err) {
    console.error("[employee-portal-admin] POST disable:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Leave policy and per-employee entitlements ───────────────────────────────
const validDays = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 366;

router.get("/leave-policy", async (req, res) => {
  try {
    const r = await getPool().request().query(
      "SELECT LeaveType, DaysPerYear FROM dbo.LeavePolicy ORDER BY CASE LeaveType WHEN N'Casual' THEN 1 WHEN N'Sick' THEN 2 ELSE 3 END",
    );
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/leave-policy", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return bad(res, "Nothing to save");
  for (const it of items) {
    if (!LIMITED_TYPES.includes(it?.LeaveType)) return bad(res, "Leave type must be Casual, Sick or Earned");
    if (!validDays(it.DaysPerYear)) return bad(res, "Days per year must be between 0 and 366");
  }
  try {
    const pool = getPool();
    for (const it of items) {
      await pool.request().input("T", sql.NVarChar(20), it.LeaveType).input("D", sql.Decimal(5, 1), Number(it.DaysPerYear)).input("By", sql.Int, req.user?.userId ?? null)
        .query("UPDATE dbo.LeavePolicy SET DaysPerYear = @D, UpdatedBy = @By, UpdatedAt = SYSUTCDATETIME() WHERE LeaveType = @T");
    }
    res.json({ message: "Leave policy saved" });
  } catch (err) {
    console.error("[employee-portal-admin] PUT /leave-policy:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Break rules: allowed minutes and whether the time comes off working time ─
router.get("/break-types", async (req, res) => {
  try {
    const r = await getPool().request().query("SELECT BreakType, DeductFromWork, AllowedMinutes, RequiresNote, IsActive FROM dbo.AttendanceBreakType ORDER BY SortOrder");
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/break-types", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return bad(res, "Nothing to save");
  for (const it of items) {
    const m = it.AllowedMinutes;
    if (m !== null && m !== "" && m !== undefined && !(Number.isInteger(Number(m)) && Number(m) >= 0 && Number(m) <= 1440)) return bad(res, "Allowed minutes must be a whole number from 0 to 1440, or empty for no limit");
  }
  try {
    const pool = getPool();
    for (const it of items) {
      const limit = it.AllowedMinutes === null || it.AllowedMinutes === "" || it.AllowedMinutes === undefined ? null : Number(it.AllowedMinutes);
      const r = await pool.request().input("T", sql.NVarChar(40), String(it.BreakType))
        .input("M", sql.Int, limit).input("D", sql.Bit, it.DeductFromWork ? 1 : 0).input("A", sql.Bit, it.IsActive === false ? 0 : 1).input("By", sql.Int, req.user?.userId ?? null)
        .query("UPDATE dbo.AttendanceBreakType SET AllowedMinutes = @M, DeductFromWork = @D, IsActive = @A, UpdatedBy = @By, UpdatedAt = SYSUTCDATETIME() WHERE BreakType = @T");
      if (!r.rowsAffected[0]) return bad(res, `Unknown break reason: ${it.BreakType}`, 404);
    }
    res.json({ message: "Break rules saved" });
  } catch (err) {
    console.error("[employee-portal-admin] PUT /break-types:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/employees/:id/entitlements", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  if (!Number.isInteger(id)) return bad(res, "Invalid employee");
  try {
    const r = await getPool().request().input("E", sql.Int, id).input("Y", sql.Int, year).query(`
      SELECT p.LeaveType, p.DaysPerYear AS PolicyDays, o.Days AS OverrideDays
      FROM dbo.LeavePolicy p
      LEFT JOIN dbo.EmployeeLeaveEntitlement o ON o.EmployeeId = @E AND o.LeaveYear = @Y AND o.LeaveType = p.LeaveType
      ORDER BY CASE p.LeaveType WHEN N'Casual' THEN 1 WHEN N'Sick' THEN 2 ELSE 3 END
    `);
    res.json({ Year: year, Items: r.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/employees/:id/entitlements", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const year = parseInt(req.body?.year, 10);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!Number.isInteger(id) || !Number.isInteger(year) || year < 2000 || year > 2100) return bad(res, "Invalid employee or year");
  for (const it of items) {
    if (!LIMITED_TYPES.includes(it?.LeaveType)) return bad(res, "Leave type must be Casual, Sick or Earned");
    if (it.Days != null && it.Days !== "" && !validDays(it.Days)) return bad(res, "Days must be between 0 and 366");
  }
  try {
    const pool = getPool();
    if (!(await loadEmployee(pool, id))) return bad(res, "Employee not found", 404);
    for (const it of items) {
      const clear = it.Days == null || it.Days === "";
      const rq = pool.request().input("E", sql.Int, id).input("Y", sql.Int, year).input("T", sql.NVarChar(20), it.LeaveType);
      if (clear) {
        await rq.query("DELETE FROM dbo.EmployeeLeaveEntitlement WHERE EmployeeId = @E AND LeaveYear = @Y AND LeaveType = @T");
      } else {
        await rq.input("D", sql.Decimal(5, 1), Number(it.Days)).input("By", sql.Int, req.user?.userId ?? null).query(`
          MERGE dbo.EmployeeLeaveEntitlement AS t
          USING (SELECT @E AS EmployeeId, @Y AS LeaveYear, @T AS LeaveType) AS s
            ON t.EmployeeId = s.EmployeeId AND t.LeaveYear = s.LeaveYear AND t.LeaveType = s.LeaveType
          WHEN MATCHED THEN UPDATE SET Days = @D, UpdatedBy = @By, UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (EmployeeId, LeaveYear, LeaveType, Days, UpdatedBy) VALUES (@E, @Y, @T, @D, @By);
        `);
      }
    }
    res.json({ message: "Entitlements saved" });
  } catch (err) {
    console.error("[employee-portal-admin] PUT entitlements:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
