"use strict";

// backend/services/employeeAttendance.js
//
// Employee clock In / Out / Break for the HR and Payroll module.
//
// Rules this enforces (all server-side — the buttons just call these):
//   • Every timestamp comes from the database clock (SYSUTCDATETIME()); nothing the browser
//     sends is ever used as a punch time, so an employee can't type or back-date one.
//   • One attendance record per employee per day (AttendanceDate = the Indian calendar date of
//     the In Time). In Time once; Out Time only after In and only once.
//   • Breaks: Start only while working, Stop only while on a break, never two at once (also
//     guarded by a unique index). Out Time is refused while a break is running.
//   • Durations are never stored — they are derived from the timestamps every time, so they are
//     correct across noon and midnight and can't go stale after an HR correction.
//   • A session still open after STALE_HOURS (forgot Out / Break Stop) stops blocking a new In
//     and is flagged "Incomplete" for HR.
//   • HR corrections require a reason and are written to EmployeeAttendanceAudit.

const { sql } = require("../db");

const STALE_HOURS = 18;
const IST_OFFSET_MIN = 330;

class AttendanceError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

const toIso = (d) => (d ? new Date(d).toISOString() : null);
const secs = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));

/** Indian calendar date (YYYY-MM-DD) of an instant. */
function istDate(d) {
  return new Date(new Date(d).getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

// ─── Calculation ─────────────────────────────────────────────────────────────

/**
 * Derived figures for one attendance record + its breaks.
 *   totalSec = Out − In            (null until Out is recorded)
 *   breakSec = Σ completed breaks
 *   netSec   = totalSec − breakSec
 * Plus live figures for a session still running, a status and review flags.
 */
function compute(rec, breaks, now = new Date()) {
  const inT = new Date(rec.InTime);
  const outT = rec.OutTime ? new Date(rec.OutTime) : null;
  const sorted = [...breaks].sort((a, b) => new Date(a.BreakStart) - new Date(b.BreakStart));
  const list = sorted.map((b, i) => ({
    breakId: b.BreakId,
    no: i + 1,
    start: toIso(b.BreakStart),
    end: toIso(b.BreakEnd),
    seconds: b.BreakEnd ? secs(b.BreakStart, b.BreakEnd) : null,
    open: !b.BreakEnd,
    hrEdited: !!b.IsHrEdited,
  }));
  const openBreak = list.find((b) => b.open) || null;
  const breakSec = list.reduce((s, b) => s + (b.seconds || 0), 0);
  const stale = !outT && now - inT > STALE_HOURS * 3_600_000;

  const flags = [];
  if (!outT && stale) flags.push("MISSING_OUT");
  if (openBreak && (outT || stale)) flags.push("OPEN_BREAK");

  const totalSec = outT ? secs(inT, outT) : null;
  const netSec = totalSec != null ? Math.max(0, totalSec - breakSec) : null;

  let status;
  if (flags.length) status = "Incomplete";
  else if (outT) status = "Present";
  else status = openBreak ? "On Break" : "Working";

  // Live figures for a running session (shown ticking on the employee's screen).
  const sessionSoFar = !outT ? secs(inT, now) : null;
  const liveBreakSec = breakSec + (openBreak && !outT ? secs(openBreak.start, now) : 0);

  return {
    attendanceId: rec.AttendanceId,
    employeeId: rec.EmployeeId,
    employeeCode: rec.EmployeeCode ?? null,
    employeeName: rec.EmployeeName ?? null,
    companyId: rec.CompanyId ?? null,
    companyName: rec.CompanyName ?? null,
    department: rec.Department ?? null,
    projectId: rec.ProjectId ?? null,
    projectName: rec.ProjectName ?? null,
    attendanceDate: typeof rec.AttendanceDate === "string" ? rec.AttendanceDate.slice(0, 10) : toIso(rec.AttendanceDate)?.slice(0, 10),
    inTime: toIso(inT),
    outTime: toIso(outT),
    breakCount: list.length,
    breaks: list,
    breakSeconds: breakSec,
    totalSeconds: totalSec,
    netSeconds: netSec,
    status,
    flags,
    hrEdited: !!rec.IsHrEdited,
    live: !outT && !stale ? { sessionSeconds: sessionSoFar, breakSeconds: liveBreakSec, netSeconds: Math.max(0, sessionSoFar - liveBreakSec) } : null,
  };
}

// ─── Loading ─────────────────────────────────────────────────────────────────

const RECORD_SELECT = `
  SELECT a.AttendanceId, a.EmployeeId, e.EmployeeCode, e.EmployeeName, e.CompanyId, comp.name AS CompanyName,
         e.Department, a.ProjectId, pr.name AS ProjectName, CONVERT(NVARCHAR(10), a.AttendanceDate, 23) AS AttendanceDate,
         a.InTime, a.OutTime, a.IsHrEdited
  FROM dbo.EmployeeAttendance a
  JOIN dbo.EmployeeMaster e ON e.EmployeeId = a.EmployeeId
  LEFT JOIN dbo.enterprise comp ON comp.id = e.CompanyId
  LEFT JOIN dbo.enterprise pr ON pr.id = a.ProjectId
`;

function bindFilters(request, f = {}) {
  const where = [];
  if (f.from)       { request.input("From", sql.Date, f.from); where.push("a.AttendanceDate >= @From"); }
  if (f.to)         { request.input("To", sql.Date, f.to); where.push("a.AttendanceDate <= @To"); }
  if (f.employeeId) { request.input("EmpId", sql.Int, f.employeeId); where.push("a.EmployeeId = @EmpId"); }
  if (f.companyId)  { request.input("CompanyId", sql.Int, f.companyId); where.push("e.CompanyId = @CompanyId"); }
  if (f.department) { request.input("Dept", sql.NVarChar(100), f.department); where.push("e.Department = @Dept"); }
  if (f.projectId)  { request.input("ProjectId", sql.Int, f.projectId); where.push("a.ProjectId = @ProjectId"); }
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

async function loadBreaks(pool, attendanceIds) {
  const map = new Map();
  if (!attendanceIds.length) return map;
  // Ids are integers we just read from the DB; inlined to avoid a 2,100-parameter limit.
  const r = await pool.request().query(`
    SELECT BreakId, AttendanceId, BreakStart, BreakEnd, IsHrEdited
    FROM dbo.EmployeeAttendanceBreak WHERE AttendanceId IN (${attendanceIds.map((i) => Number(i)).join(",")})
  `);
  for (const b of r.recordset) {
    if (!map.has(b.AttendanceId)) map.set(b.AttendanceId, []);
    map.get(b.AttendanceId).push(b);
  }
  return map;
}

/** Computed records for the filters (newest first). `status` filters on the derived status / "flagged". */
async function listRecords(pool, filters = {}, now = new Date()) {
  const request = pool.request();
  const where = bindFilters(request, filters);
  const r = await request.query(`SELECT TOP 5000 * FROM (${RECORD_SELECT} ${where}) x ORDER BY AttendanceDate DESC, EmployeeName`);
  const breaks = await loadBreaks(pool, r.recordset.map((x) => x.AttendanceId));
  let rows = r.recordset.map((rec) => compute(rec, breaks.get(rec.AttendanceId) || [], now));
  if (filters.status === "Flagged") rows = rows.filter((x) => x.flags.length > 0);
  else if (filters.status) rows = rows.filter((x) => x.status === filters.status);
  return rows;
}

async function getRecord(pool, attendanceId, now = new Date()) {
  const r = await pool.request().input("Id", sql.Int, attendanceId).query(`${RECORD_SELECT} WHERE a.AttendanceId = @Id`);
  const rec = r.recordset[0];
  if (!rec) return null;
  const breaks = await loadBreaks(pool, [attendanceId]);
  return compute(rec, breaks.get(attendanceId) || [], now);
}

async function getAudit(pool, attendanceId) {
  const r = await pool.request().input("Id", sql.Int, attendanceId).query(`
    SELECT AuditId, Action, Detail, Reason, ChangedBy, ChangedAt FROM dbo.EmployeeAttendanceAudit
    WHERE AttendanceId = @Id ORDER BY ChangedAt DESC, AuditId DESC
  `);
  return r.recordset.map((a) => ({ ...a, ChangedAt: toIso(a.ChangedAt) }));
}

async function audit(pool, { attendanceId, employeeId, action, detail, reason, by }) {
  await pool.request()
    .input("A", sql.Int, attendanceId ?? null).input("E", sql.Int, employeeId)
    .input("Act", sql.NVarChar(30), action).input("D", sql.NVarChar(sql.MAX), detail ?? null)
    .input("R", sql.NVarChar(500), reason ?? null).input("By", sql.NVarChar(150), by)
    .query(`INSERT INTO dbo.EmployeeAttendanceAudit (AttendanceId, EmployeeId, Action, Detail, Reason, ChangedBy) VALUES (@A, @E, @Act, @D, @R, @By)`);
}

// ─── Employee self-service ───────────────────────────────────────────────────

/** The Employee Master record of the logged-in user, matched on e-mail. */
async function resolveEmployee(pool, user) {
  const email = String(user?.email || "").trim();
  if (!email) throw new AttendanceError("Your login has no e-mail address, so it can't be matched to an employee.", 403);
  const r = await pool.request().input("Email", sql.NVarChar(150), email).query(`
    SELECT e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.CompanyId, comp.name AS CompanyName, e.Department, e.Designation
    FROM dbo.EmployeeMaster e LEFT JOIN dbo.enterprise comp ON comp.id = e.CompanyId
    WHERE e.IsActive = 1 AND LOWER(LTRIM(RTRIM(e.Email))) = LOWER(@Email)
  `);
  if (r.recordset.length === 0) {
    throw new AttendanceError("Your login isn't linked to an active Employee Master record — ask HR to set your e-mail on your employee record.", 403);
  }
  if (r.recordset.length > 1) {
    throw new AttendanceError("More than one employee record has your e-mail address — ask HR to fix the duplicate.", 403);
  }
  return r.recordset[0];
}

/** The session the employee is working in right now (open, not stale), else null. */
async function findActive(pool, employeeId) {
  const r = await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT TOP 1 AttendanceId FROM dbo.EmployeeAttendance
    WHERE EmployeeId = @E AND OutTime IS NULL AND InTime >= DATEADD(HOUR, -${STALE_HOURS}, SYSUTCDATETIME())
    ORDER BY InTime DESC
  `);
  return r.recordset[0]?.AttendanceId ?? null;
}

async function dbNow(pool) {
  const r = await pool.request().query("SELECT SYSUTCDATETIME() AS Now");
  return new Date(r.recordset[0].Now);
}

/** What the employee's screen needs: today's record, which buttons are allowed, recent days. */
async function getMyState(pool, user) {
  const employee = await resolveEmployee(pool, user);
  const now = await dbNow(pool);
  const activeId = await findActive(pool, employee.EmployeeId);
  let current = activeId ? await getRecord(pool, activeId, now) : null;
  if (!current) {
    const t = await pool.request().input("E", sql.Int, employee.EmployeeId).input("D", sql.Date, istDate(now))
      .query("SELECT AttendanceId FROM dbo.EmployeeAttendance WHERE EmployeeId = @E AND AttendanceDate = @D");
    if (t.recordset[0]) current = await getRecord(pool, t.recordset[0].AttendanceId, now);
  }
  const state = !current ? "NOT_STARTED" : current.outTime ? "COMPLETED" : current.status === "On Break" ? "ON_BREAK" : current.status === "Incomplete" ? "NOT_STARTED" : "WORKING";
  const allowed = {
    in: state === "NOT_STARTED",
    out: state === "WORKING",
    breakStart: state === "WORKING",
    breakStop: state === "ON_BREAK",
  };
  const history = await listRecords(pool, { employeeId: employee.EmployeeId, from: istDate(new Date(now.getTime() - 30 * 86_400_000)) }, now);
  return {
    employee: {
      id: employee.EmployeeId, code: employee.EmployeeCode, name: employee.EmployeeName,
      companyName: employee.CompanyName, department: employee.Department, designation: employee.Designation,
    },
    serverNow: toIso(now),
    today: istDate(now),
    state,
    allowed,
    current,
    history,
  };
}

const isUnique = (e) => /UQ_EmployeeAttendance_EmployeeDate|UX_EmployeeAttendanceBreak_OneOpen|duplicate key/i.test(e.message || "");
const isCheck = (e) => /CK_EmployeeAttendance_OutAfterIn|CK_EmployeeAttendanceBreak_EndAfterStart/i.test(e.message || "");
const TOO_FAST = "That was too quick after the previous punch — wait a few seconds and try again.";

async function clockIn(pool, user, { projectId } = {}) {
  const employee = await resolveEmployee(pool, user);
  const state = await getMyState(pool, user);
  if (!state.allowed.in) {
    throw new AttendanceError(
      state.state === "COMPLETED" ? "Today's attendance is already complete — In Time can be recorded only once." : "You are already clocked in.",
    );
  }
  let projId = null;
  if (projectId) {
    const p = await pool.request().input("P", sql.Int, Number(projectId)).query("SELECT id FROM dbo.enterprise WHERE id = @P AND business_type = 'P'");
    if (!p.recordset[0]) throw new AttendanceError("That project doesn't exist.", 400);
    projId = Number(projectId);
  }
  try {
    const r = await pool.request().input("E", sql.Int, employee.EmployeeId).input("P", sql.Int, projId).query(`
      DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
      INSERT INTO dbo.EmployeeAttendance (EmployeeId, AttendanceDate, InTime, ProjectId)
      OUTPUT INSERTED.AttendanceId
      VALUES (@E, CAST(DATEADD(MINUTE, ${IST_OFFSET_MIN}, @now) AS DATE), @now, @P)
    `);
    await audit(pool, { attendanceId: r.recordset[0].AttendanceId, employeeId: employee.EmployeeId, action: "IN", by: user.email });
  } catch (e) {
    if (isUnique(e)) throw new AttendanceError("In Time for today is already recorded.");
    throw e;
  }
  return getMyState(pool, user);
}

async function clockOut(pool, user) {
  const employee = await resolveEmployee(pool, user);
  const state = await getMyState(pool, user);
  if (state.state === "NOT_STARTED") throw new AttendanceError("Record In Time first — Out Time can only follow it.");
  if (state.state === "COMPLETED") throw new AttendanceError("Out Time is already recorded for today.");
  if (state.state === "ON_BREAK") throw new AttendanceError("Stop your current break before recording Out Time.");
  try {
    const r = await pool.request().input("Id", sql.Int, state.current.attendanceId).query(`
      UPDATE dbo.EmployeeAttendance SET OutTime = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE AttendanceId = @Id AND OutTime IS NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.EmployeeAttendanceBreak WHERE AttendanceId = @Id AND BreakEnd IS NULL)
    `);
    if (r.rowsAffected[0] === 0) throw new AttendanceError("Out Time can't be recorded right now — refresh and try again.");
  } catch (e) {
    if (isCheck(e)) throw new AttendanceError(TOO_FAST);
    throw e;
  }
  await audit(pool, { attendanceId: state.current.attendanceId, employeeId: employee.EmployeeId, action: "OUT", by: user.email });
  return getMyState(pool, user);
}

async function breakStart(pool, user) {
  const employee = await resolveEmployee(pool, user);
  const state = await getMyState(pool, user);
  if (state.state === "NOT_STARTED") throw new AttendanceError("Record In Time before starting a break.");
  if (state.state === "COMPLETED") throw new AttendanceError("You have already clocked out for today.");
  if (state.state === "ON_BREAK") throw new AttendanceError("A break is already running — stop it before starting another.");
  try {
    await pool.request().input("Id", sql.Int, state.current.attendanceId).query(`
      INSERT INTO dbo.EmployeeAttendanceBreak (AttendanceId, BreakStart) VALUES (@Id, SYSUTCDATETIME())
    `);
  } catch (e) {
    if (isUnique(e)) throw new AttendanceError("A break is already running — stop it before starting another.");
    throw e;
  }
  await audit(pool, { attendanceId: state.current.attendanceId, employeeId: employee.EmployeeId, action: "BREAK_START", by: user.email });
  return getMyState(pool, user);
}

async function breakStop(pool, user) {
  const employee = await resolveEmployee(pool, user);
  const state = await getMyState(pool, user);
  if (state.state !== "ON_BREAK") throw new AttendanceError("There is no running break to stop.");
  try {
    const r = await pool.request().input("Id", sql.Int, state.current.attendanceId).query(`
      UPDATE dbo.EmployeeAttendanceBreak SET BreakEnd = SYSUTCDATETIME()
      WHERE AttendanceId = @Id AND BreakEnd IS NULL
    `);
    if (r.rowsAffected[0] === 0) throw new AttendanceError("There is no running break to stop.");
  } catch (e) {
    if (isCheck(e)) throw new AttendanceError(TOO_FAST);
    throw e;
  }
  await audit(pool, { attendanceId: state.current.attendanceId, employeeId: employee.EmployeeId, action: "BREAK_STOP", by: user.email });
  return getMyState(pool, user);
}

// ─── HR: summaries ───────────────────────────────────────────────────────────

/** Per-employee totals over the filtered range (+ grand totals). */
async function summary(pool, filters = {}, now = new Date()) {
  const rows = await listRecords(pool, { ...filters, status: undefined }, now);
  const byEmp = new Map();
  for (const r of rows) {
    let s = byEmp.get(r.employeeId);
    if (!s) {
      s = {
        employeeId: r.employeeId, employeeCode: r.employeeCode, employeeName: r.employeeName, companyName: r.companyName,
        department: r.department, days: 0, completeDays: 0, incompleteDays: 0, breakCount: 0,
        breakSeconds: 0, totalSeconds: 0, netSeconds: 0,
      };
      byEmp.set(r.employeeId, s);
    }
    s.days++;
    s.breakCount += r.breakCount;
    s.breakSeconds += r.breakSeconds;
    if (r.status === "Present") {
      s.completeDays++;
      s.totalSeconds += r.totalSeconds || 0;
      s.netSeconds += r.netSeconds || 0;
    } else if (r.status === "Incomplete") s.incompleteDays++;
  }
  const employees = [...byEmp.values()].sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
  const sum = (k) => employees.reduce((t, e) => t + e[k], 0);
  return {
    employees,
    totals: {
      employees: employees.length, days: sum("days"), completeDays: sum("completeDays"), incompleteDays: sum("incompleteDays"),
      breakCount: sum("breakCount"), breakSeconds: sum("breakSeconds"), totalSeconds: sum("totalSeconds"), netSeconds: sum("netSeconds"),
    },
  };
}

/** Active employees with no attendance record on `date` (missing In Time). */
async function notMarked(pool, { date, companyId, department, employeeId }) {
  const request = pool.request().input("D", sql.Date, date);
  const where = ["e.IsActive = 1", "NOT EXISTS (SELECT 1 FROM dbo.EmployeeAttendance a WHERE a.EmployeeId = e.EmployeeId AND a.AttendanceDate = @D)",
    "(e.JoiningDate IS NULL OR e.JoiningDate <= @D)"];
  if (companyId)  { request.input("CompanyId", sql.Int, companyId); where.push("e.CompanyId = @CompanyId"); }
  if (department) { request.input("Dept", sql.NVarChar(100), department); where.push("e.Department = @Dept"); }
  if (employeeId) { request.input("EmpId", sql.Int, employeeId); where.push("e.EmployeeId = @EmpId"); }
  const r = await request.query(`
    SELECT e.EmployeeId, e.EmployeeCode, e.EmployeeName, comp.name AS CompanyName, e.Department
    FROM dbo.EmployeeMaster e LEFT JOIN dbo.enterprise comp ON comp.id = e.CompanyId
    WHERE ${where.join(" AND ")} ORDER BY e.EmployeeName
  `);
  return r.recordset;
}

async function hrFilterOptions(pool) {
  const [companies, departments, projects, employees] = await Promise.all([
    pool.request().query("SELECT id, name AS label FROM dbo.enterprise WHERE business_type = 'C' AND (discontinue IS NULL OR discontinue = 0) ORDER BY name"),
    pool.request().query("SELECT DISTINCT Department FROM dbo.EmployeeMaster WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> '' ORDER BY Department"),
    pool.request().query("SELECT id, name AS label FROM dbo.enterprise WHERE business_type = 'P' AND (discontinue IS NULL OR discontinue = 0) ORDER BY name"),
    pool.request().query("SELECT EmployeeId AS id, EmployeeName AS label, EmployeeCode AS code FROM dbo.EmployeeMaster WHERE IsActive = 1 ORDER BY EmployeeName"),
  ]);
  return {
    companies: companies.recordset,
    departments: departments.recordset.map((d) => d.Department),
    projects: projects.recordset,
    employees: employees.recordset,
  };
}

// ─── HR: corrections (reason required, fully audited) ────────────────────────

function needReason(reason) {
  const r = String(reason || "").trim();
  if (r.length < 3) throw new AttendanceError("A reason is required for an HR correction.", 400);
  return r.slice(0, 500);
}

function parseWhen(v, label) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw new AttendanceError(`${label} is not a valid date and time.`, 400);
  d.setMilliseconds(0);
  return d;
}

const fmtIst = (d) => (d ? new Date(new Date(d).getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16).replace("T", " ") + " IST" : "—");

/** Throws unless the breaks (as they would be after the change) are valid inside the session. */
function assertBreaksValid(inT, outT, breaks) {
  const sorted = [...breaks].sort((a, b) => a.start - b.start);
  let prevEnd = null;
  let open = 0;
  for (const b of sorted) {
    if (b.start < inT) throw new AttendanceError("A break can't start before In Time.", 400);
    if (outT && b.start >= outT) throw new AttendanceError("A break can't start at or after Out Time.", 400);
    if (b.end) {
      if (b.end <= b.start) throw new AttendanceError("Break Stop must be after Break Start.", 400);
      if (outT && b.end > outT) throw new AttendanceError("A break can't end after Out Time.", 400);
    } else {
      open++;
      if (outT) throw new AttendanceError("A break still running can't coexist with an Out Time — give it a Break Stop.", 400);
    }
    if (prevEnd && b.start < prevEnd) throw new AttendanceError("Breaks overlap — each break must start after the previous one ended.", 400);
    prevEnd = b.end || null;
    if (!b.end && b !== sorted[sorted.length - 1]) throw new AttendanceError("Only the last break can be left running.", 400);
  }
  if (open > 1) throw new AttendanceError("Only one break can be running.", 400);
}

async function loadRaw(pool, attendanceId) {
  const a = await pool.request().input("Id", sql.Int, attendanceId).query("SELECT AttendanceId, EmployeeId, InTime, OutTime FROM dbo.EmployeeAttendance WHERE AttendanceId = @Id");
  const rec = a.recordset[0];
  if (!rec) throw new AttendanceError("Attendance record not found.", 404);
  const b = await pool.request().input("Id", sql.Int, attendanceId).query("SELECT BreakId, BreakStart, BreakEnd FROM dbo.EmployeeAttendanceBreak WHERE AttendanceId = @Id");
  return {
    rec: { ...rec, InTime: new Date(rec.InTime), OutTime: rec.OutTime ? new Date(rec.OutTime) : null },
    breaks: b.recordset.map((x) => ({ id: x.BreakId, start: new Date(x.BreakStart), end: x.BreakEnd ? new Date(x.BreakEnd) : null })),
  };
}

/** Correct In Time / Out Time (null Out reopens the session). */
async function hrUpdateRecord(pool, attendanceId, { inTime, outTime, reason }, actor) {
  const why = needReason(reason);
  const { rec, breaks } = await loadRaw(pool, attendanceId);
  const newIn = inTime !== undefined ? parseWhen(inTime, "In Time") : rec.InTime;
  const newOut = outTime === undefined ? rec.OutTime : outTime === null || outTime === "" ? null : parseWhen(outTime, "Out Time");
  if (newOut && newOut <= newIn) throw new AttendanceError("Out Time must be after In Time.", 400);
  assertBreaksValid(newIn, newOut, breaks);

  const changes = [];
  if (+newIn !== +rec.InTime) changes.push(`In Time: ${fmtIst(rec.InTime)} → ${fmtIst(newIn)}`);
  if ((newOut ? +newOut : null) !== (rec.OutTime ? +rec.OutTime : null)) changes.push(`Out Time: ${fmtIst(rec.OutTime)} → ${fmtIst(newOut)}`);
  if (!changes.length) throw new AttendanceError("Nothing was changed.", 400);

  try {
    await pool.request()
      .input("Id", sql.Int, attendanceId).input("In", sql.DateTime2(0), newIn).input("Out", sql.DateTime2(0), newOut)
      .input("D", sql.Date, istDate(newIn))
      .query(`UPDATE dbo.EmployeeAttendance SET InTime = @In, OutTime = @Out, AttendanceDate = @D, IsHrEdited = 1, UpdatedAt = SYSUTCDATETIME() WHERE AttendanceId = @Id`);
  } catch (e) {
    if (isUnique(e)) throw new AttendanceError("The employee already has an attendance record on that date.");
    if (isCheck(e)) throw new AttendanceError("Out Time must be after In Time.", 400);
    throw e;
  }
  await audit(pool, { attendanceId, employeeId: rec.EmployeeId, action: "HR_EDIT", detail: changes.join("; "), reason: why, by: actor });
  return getRecord(pool, attendanceId);
}

async function hrAddBreak(pool, attendanceId, { start, end, reason }, actor) {
  const why = needReason(reason);
  const { rec, breaks } = await loadRaw(pool, attendanceId);
  const s = parseWhen(start, "Break Start");
  const e = end ? parseWhen(end, "Break Stop") : null;
  assertBreaksValid(rec.InTime, rec.OutTime, [...breaks, { start: s, end: e }]);
  try {
    await pool.request().input("Id", sql.Int, attendanceId).input("S", sql.DateTime2(0), s).input("E", sql.DateTime2(0), e)
      .query("INSERT INTO dbo.EmployeeAttendanceBreak (AttendanceId, BreakStart, BreakEnd, IsHrEdited) VALUES (@Id, @S, @E, 1)");
  } catch (err) {
    if (isUnique(err)) throw new AttendanceError("A break is already running on this record.");
    throw err;
  }
  await pool.request().input("Id", sql.Int, attendanceId).query("UPDATE dbo.EmployeeAttendance SET IsHrEdited = 1, UpdatedAt = SYSUTCDATETIME() WHERE AttendanceId = @Id");
  await audit(pool, { attendanceId, employeeId: rec.EmployeeId, action: "HR_BREAK_ADD", detail: `Break ${fmtIst(s)} → ${fmtIst(e)}`, reason: why, by: actor });
  return getRecord(pool, attendanceId);
}

async function hrUpdateBreak(pool, breakId, { start, end, reason }, actor) {
  const why = needReason(reason);
  const row = await pool.request().input("B", sql.Int, breakId).query("SELECT AttendanceId, BreakStart, BreakEnd FROM dbo.EmployeeAttendanceBreak WHERE BreakId = @B");
  const cur = row.recordset[0];
  if (!cur) throw new AttendanceError("Break not found.", 404);
  const { rec, breaks } = await loadRaw(pool, cur.AttendanceId);
  const s = start !== undefined ? parseWhen(start, "Break Start") : new Date(cur.BreakStart);
  const e = end === undefined ? (cur.BreakEnd ? new Date(cur.BreakEnd) : null) : end === null || end === "" ? null : parseWhen(end, "Break Stop");
  assertBreaksValid(rec.InTime, rec.OutTime, breaks.map((b) => (b.id === breakId ? { start: s, end: e } : b)));
  try {
    await pool.request().input("B", sql.Int, breakId).input("S", sql.DateTime2(0), s).input("E", sql.DateTime2(0), e)
      .query("UPDATE dbo.EmployeeAttendanceBreak SET BreakStart = @S, BreakEnd = @E, IsHrEdited = 1 WHERE BreakId = @B");
  } catch (err) {
    if (isUnique(err)) throw new AttendanceError("A break is already running on this record.");
    throw err;
  }
  await pool.request().input("Id", sql.Int, cur.AttendanceId).query("UPDATE dbo.EmployeeAttendance SET IsHrEdited = 1, UpdatedAt = SYSUTCDATETIME() WHERE AttendanceId = @Id");
  await audit(pool, {
    attendanceId: cur.AttendanceId, employeeId: rec.EmployeeId, action: "HR_BREAK_EDIT",
    detail: `Break ${fmtIst(cur.BreakStart)} → ${fmtIst(cur.BreakEnd)}  changed to  ${fmtIst(s)} → ${fmtIst(e)}`, reason: why, by: actor,
  });
  return getRecord(pool, cur.AttendanceId);
}

async function hrDeleteBreak(pool, breakId, { reason }, actor) {
  const why = needReason(reason);
  const row = await pool.request().input("B", sql.Int, breakId).query("SELECT AttendanceId, BreakStart, BreakEnd FROM dbo.EmployeeAttendanceBreak WHERE BreakId = @B");
  const cur = row.recordset[0];
  if (!cur) throw new AttendanceError("Break not found.", 404);
  const { rec } = await loadRaw(pool, cur.AttendanceId);
  await pool.request().input("B", sql.Int, breakId).query("DELETE FROM dbo.EmployeeAttendanceBreak WHERE BreakId = @B");
  await pool.request().input("Id", sql.Int, cur.AttendanceId).query("UPDATE dbo.EmployeeAttendance SET IsHrEdited = 1, UpdatedAt = SYSUTCDATETIME() WHERE AttendanceId = @Id");
  await audit(pool, {
    attendanceId: cur.AttendanceId, employeeId: rec.EmployeeId, action: "HR_BREAK_DELETE",
    detail: `Removed break ${fmtIst(cur.BreakStart)} → ${fmtIst(cur.BreakEnd)}`, reason: why, by: actor,
  });
  return getRecord(pool, cur.AttendanceId);
}

module.exports = {
  AttendanceError, STALE_HOURS, compute, istDate,
  getMyState, clockIn, clockOut, breakStart, breakStop,
  listRecords, getRecord, getAudit, summary, notMarked, hrFilterOptions,
  hrUpdateRecord, hrAddBreak, hrUpdateBreak, hrDeleteBreak,
};
