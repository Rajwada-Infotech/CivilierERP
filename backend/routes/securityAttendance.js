// Maintenance → Security Attendance
//
// Tracks check-in/check-out for security personnel, one row per
// (SecurityId, ShiftId, AttendanceDate) — dbo.SecurityAttendance. Every
// action (check-in, check-out, verify, reject, mark-absent) appends an
// immutable dbo.SecurityAttendanceLog row, same append-only audit
// convention this app already uses elsewhere (amendments, approvals).
//
// Present/Late is derived at check-in time by comparing the actual
// check-in against the assigned shift's ScheduledIn + GraceMinutes.
// Half Day is derived at check-out time if the actual duty duration comes
// in under half the shift's own scheduled duration. Absent is never a row
// a user "checks in" to — it's either derived live (personnel with no
// attendance row at all for a given date, see GET /dashboard and
// GET /report/daily) or explicitly recorded via POST /mark-absent for a
// documented no-show.

const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const PAGE_KEY = "maintenance-security-attendance";

function actorOf(req) {
  return req.user?.email || req.user?.name || "system";
}

// A TIME column comes back from mssql as a JS Date anchored to
// 1970-01-01 — only the time-of-day part is meaningful. Extract just
// that, in minutes since midnight, for arithmetic.
function timeToMinutes(t) {
  const d = new Date(t);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// mssql returns a TIME column as that same 1970-01-01-anchored Date —
// binding it straight back as a VARCHAR parameter fails ("Invalid
// string", it's not a string at all). Re-render it as "HH:MM:SS" so a
// shift's own StartTime/EndTime can be copied onto a new
// SecurityAttendance row's ScheduledIn/ScheduledOut.
function formatTimeHHMMSS(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Combine a DATE (attendanceDate) with a TIME-of-day (minutes since
// midnight) into a real Date instant — used to compare a shift's
// scheduled time against an actual CheckIn/CheckOut timestamp on the
// same calendar day.
function combineDateAndMinutes(dateStr, minutes) {
  const d = new Date(dateStr);
  d.setUTCHours(0, Math.round(minutes), 0, 0);
  return d;
}

// Append one immutable audit row. Never awaited-and-ignored — logging
// failure should surface, not silently vanish, but it also must never be
// the reason a real attendance action fails outright, so callers wrap
// this in try/catch and just log to the console on failure.
async function writeLog(pool, { attendanceId, securityId, action, oldValue, newValue, performedBy, deviceInfo, ipAddress, remarks }) {
  await pool
    .request()
    .input("AttendanceId", sql.Int, attendanceId)
    .input("SecurityId", sql.Int, securityId)
    .input("Action", sql.NVarChar(30), action)
    .input("OldValue", sql.NVarChar(sql.MAX), oldValue != null ? JSON.stringify(oldValue) : null)
    .input("NewValue", sql.NVarChar(sql.MAX), newValue != null ? JSON.stringify(newValue) : null)
    .input("PerformedBy", sql.NVarChar(150), performedBy || null)
    .input("DeviceInfo", sql.NVarChar(300), deviceInfo || null)
    .input("IPAddress", sql.NVarChar(50), ipAddress || null)
    .input("Remarks", sql.NVarChar(500), remarks || null)
    .query(`
      INSERT INTO dbo.SecurityAttendanceLog
        (AttendanceId, SecurityId, Action, OldValue, NewValue, PerformedBy, DeviceInfo, IPAddress, Remarks)
      VALUES
        (@AttendanceId, @SecurityId, @Action, @OldValue, @NewValue, @PerformedBy, @DeviceInfo, @IPAddress, @Remarks)
    `);
}

function requestIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null;
}

// ── SHIFTS ───────────────────────────────────────────────────────────────

router.get("/shifts", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT Id, Name, StartTime, EndTime, GraceMinutes, Status, CreatedAt
      FROM dbo.SecurityShift
      ORDER BY Status DESC, Name
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("GET /security-attendance/shifts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/shifts", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { name, startTime, endTime, graceMinutes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Shift name is required" });
  if (!startTime || !endTime) return res.status(400).json({ error: "Start time and end time are required" });
  try {
    const pool = getPool();
    const r = await pool
      .request()
      .input("Name", sql.NVarChar(100), String(name).trim())
      .input("StartTime", sql.VarChar(8), startTime)
      .input("EndTime", sql.VarChar(8), endTime)
      .input("GraceMinutes", sql.Int, Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 10)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.SecurityShift (Name, StartTime, EndTime, GraceMinutes, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@Name, @StartTime, @EndTime, @GraceMinutes, @CreatedBy)
      `);
    res.status(201).json({ id: r.recordset[0].Id, message: "Shift created" });
  } catch (err) {
    console.error("POST /security-attendance/shifts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/shifts/:id", requirePageRight(PAGE_KEY, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid shift id" });
  const { name, startTime, endTime, graceMinutes, status } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Shift name is required" });
  try {
    const pool = getPool();
    const r = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar(100), String(name).trim())
      .input("StartTime", sql.VarChar(8), startTime)
      .input("EndTime", sql.VarChar(8), endTime)
      .input("GraceMinutes", sql.Int, Number.isFinite(Number(graceMinutes)) ? Number(graceMinutes) : 10)
      .input("Status", sql.NVarChar(20), status || "Active")
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.SecurityShift SET
          Name = @Name, StartTime = @StartTime, EndTime = @EndTime, GraceMinutes = @GraceMinutes,
          Status = @Status, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Shift not found" });
    res.json({ message: "Shift updated" });
  } catch (err) {
    console.error("PUT /security-attendance/shifts/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SECURITY PERSONNEL ───────────────────────────────────────────────────

router.get("/personnel", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const search = req.query.search ? String(req.query.search).trim() : null;
    const req0 = pool.request();
    let where = "1=1";
    if (search) {
      req0.input("search", sql.NVarChar(200), `%${search}%`);
      where += " AND (sp.Name LIKE @search OR sp.SecurityCode LIKE @search)";
    }
    const r = await req0.query(`
      SELECT sp.Id, sp.SecurityCode, sp.Name, sp.Phone, sp.Status, sp.Remarks,
             sp.DefaultShiftId, sh.Name AS DefaultShiftName, sh.StartTime, sh.EndTime,
             sp.CreatedAt
      FROM dbo.SecurityPersonnel sp
      LEFT JOIN dbo.SecurityShift sh ON sh.Id = sp.DefaultShiftId
      WHERE ${where}
      ORDER BY sp.Status DESC, sp.Name
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("GET /security-attendance/personnel error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/personnel", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { securityCode, name, phone, defaultShiftId, remarks } = req.body;
  if (!securityCode || !String(securityCode).trim()) return res.status(400).json({ error: "Security ID is required" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  try {
    const pool = getPool();
    const dup = await pool.request().input("Code", sql.NVarChar(30), String(securityCode).trim())
      .query("SELECT TOP 1 1 FROM dbo.SecurityPersonnel WHERE SecurityCode = @Code");
    if (dup.recordset.length) return res.status(409).json({ error: `Security ID "${securityCode}" is already in use.` });

    const r = await pool
      .request()
      .input("SecurityCode", sql.NVarChar(30), String(securityCode).trim())
      .input("Name", sql.NVarChar(150), String(name).trim())
      .input("Phone", sql.NVarChar(20), phone || null)
      .input("DefaultShiftId", sql.Int, defaultShiftId || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.SecurityPersonnel (SecurityCode, Name, Phone, DefaultShiftId, Remarks, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@SecurityCode, @Name, @Phone, @DefaultShiftId, @Remarks, @CreatedBy)
      `);
    res.status(201).json({ id: r.recordset[0].Id, message: "Security personnel added" });
  } catch (err) {
    console.error("POST /security-attendance/personnel error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/personnel/:id", requirePageRight(PAGE_KEY, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const { name, phone, defaultShiftId, status, remarks } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  try {
    const pool = getPool();
    const r = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar(150), String(name).trim())
      .input("Phone", sql.NVarChar(20), phone || null)
      .input("DefaultShiftId", sql.Int, defaultShiftId || null)
      .input("Status", sql.NVarChar(20), status || "Active")
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.SecurityPersonnel SET
          Name = @Name, Phone = @Phone, DefaultShiftId = @DefaultShiftId,
          Status = @Status, Remarks = @Remarks, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Security personnel not found" });
    res.json({ message: "Security personnel updated" });
  } catch (err) {
    console.error("PUT /security-attendance/personnel/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ATTENDANCE LIST / HISTORY ────────────────────────────────────────────
// Powers both the Personnel List (today, unfiltered) and Attendance
// History (with filters) — same endpoint, the frontend just supplies
// different query params.

const ATTENDANCE_SELECT = `
  SELECT
    sa.Id, sa.SecurityId, sp.SecurityCode, sp.Name AS SecurityName,
    sa.ShiftId, sh.Name AS ShiftName,
    sa.AttendanceDate, sa.ScheduledIn, sa.ScheduledOut, sa.CheckIn, sa.CheckOut,
    sa.Status, sa.VerificationStatus, sa.VerifiedBy, sa.VerifiedAt, sa.VerificationRemarks,
    sa.Remarks, sa.IsCancelled, sa.CreatedAt, sa.CreatedBy
  FROM dbo.SecurityAttendance sa
  JOIN dbo.SecurityPersonnel sp ON sp.Id = sa.SecurityId
  JOIN dbo.SecurityShift sh ON sh.Id = sa.ShiftId
`;

router.get("/", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { dateFrom, dateTo, date, securityId, shiftId, status, verificationStatus } = req.query;
    const req0 = pool.request();
    const conds = ["sa.IsCancelled = 0"];

    if (date) {
      req0.input("date", sql.Date, date);
      conds.push("sa.AttendanceDate = @date");
    } else {
      if (dateFrom) {
        req0.input("dateFrom", sql.Date, dateFrom);
        conds.push("sa.AttendanceDate >= @dateFrom");
      }
      if (dateTo) {
        req0.input("dateTo", sql.Date, dateTo);
        conds.push("sa.AttendanceDate <= @dateTo");
      }
    }
    if (securityId) {
      req0.input("securityId", sql.Int, parseInt(securityId, 10));
      conds.push("sa.SecurityId = @securityId");
    }
    if (shiftId) {
      req0.input("shiftId", sql.Int, parseInt(shiftId, 10));
      conds.push("sa.ShiftId = @shiftId");
    }
    if (status) {
      req0.input("status", sql.NVarChar(20), status);
      conds.push("sa.Status = @status");
    }
    if (verificationStatus) {
      req0.input("verificationStatus", sql.NVarChar(20), verificationStatus);
      conds.push("sa.VerificationStatus = @verificationStatus");
    }

    const r = await req0.query(`
      ${ATTENDANCE_SELECT}
      WHERE ${conds.join(" AND ")}
      ORDER BY sa.AttendanceDate DESC, sa.CheckIn DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("GET /security-attendance error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DASHBOARD — today's summary tiles ────────────────────────────────────

router.get("/dashboard", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [personnelRes, todayRes, totalRecordsRes] = await Promise.all([
      pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.SecurityPersonnel WHERE Status = 'Active'`),
      pool.request().query(`
        SELECT sa.Status, sa.CheckOut
        FROM dbo.SecurityAttendance sa
        WHERE sa.AttendanceDate = CAST(GETDATE() AS DATE) AND sa.IsCancelled = 0
      `),
      pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.SecurityAttendance WHERE IsCancelled = 0`),
    ]);

    const totalPersonnel = personnelRes.recordset[0].cnt;
    const todayRows = todayRes.recordset;
    const presentToday = todayRows.filter((r) => r.Status === "Present" || r.Status === "HalfDay").length;
    const lateToday = todayRows.filter((r) => r.Status === "Late").length;
    const explicitAbsentToday = todayRows.filter((r) => r.Status === "Absent").length;
    const onDutyNow = todayRows.filter((r) => !r.CheckOut).length;
    // Absent = anyone with no attendance row at all today (never checked
    // in, never explicitly marked) + anyone explicitly marked Absent via
    // POST /mark-absent (that row already exists, so it isn't double
    // counted against "no row at all").
    const noRowToday = Math.max(0, totalPersonnel - todayRows.length);
    const absentToday = noRowToday + explicitAbsentToday;

    res.json({
      totalPersonnel,
      presentToday,
      absentToday,
      lateToday,
      currentlyOnDuty: onDutyNow,
      totalAttendanceRecords: totalRecordsRes.recordset[0].cnt,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /security-attendance/dashboard error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DAILY REPORT ──────────────────────────────────────────────────────────

router.get("/report/daily", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  try {
    const pool = getPool();
    const [personnelRes, dayRes] = await Promise.all([
      pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.SecurityPersonnel WHERE Status = 'Active'`),
      pool.request().input("Date", sql.Date, date).query(`
        ${ATTENDANCE_SELECT}
        WHERE sa.AttendanceDate = @Date AND sa.IsCancelled = 0
        ORDER BY sh.Name, sp.Name
      `),
    ]);
    const totalPersonnel = personnelRes.recordset[0].cnt;
    const rows = dayRes.recordset;
    const present = rows.filter((r) => r.Status === "Present" || r.Status === "HalfDay").length;
    const late = rows.filter((r) => r.Status === "Late").length;
    const explicitAbsent = rows.filter((r) => r.Status === "Absent").length;
    const absent = Math.max(0, totalPersonnel - rows.length) + explicitAbsent;
    const onDuty = rows.filter((r) => !r.CheckOut).length;

    res.json({
      date,
      totalSecurity: totalPersonnel,
      present,
      late,
      absent,
      currentlyOnDuty: onDuty,
      records: rows,
    });
  } catch (err) {
    console.error("GET /security-attendance/report/daily error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ATTENDANCE HISTORY SUMMARY — per-person totals over a date range ─────

router.get("/history-summary", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const { dateFrom, dateTo, securityId } = req.query;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: "dateFrom and dateTo are required" });
  try {
    const pool = getPool();
    const req0 = pool.request().input("dateFrom", sql.Date, dateFrom).input("dateTo", sql.Date, dateTo);
    let where = "sa.AttendanceDate BETWEEN @dateFrom AND @dateTo AND sa.IsCancelled = 0";
    if (securityId) {
      req0.input("securityId", sql.Int, parseInt(securityId, 10));
      where += " AND sa.SecurityId = @securityId";
    }
    const r = await req0.query(`
      SELECT
        COUNT(CASE WHEN sa.Status = 'Present' THEN 1 END) AS PresentCount,
        COUNT(CASE WHEN sa.Status = 'Late' THEN 1 END) AS LateCount,
        COUNT(CASE WHEN sa.Status = 'Absent' THEN 1 END) AS AbsentCount,
        COUNT(CASE WHEN sa.Status = 'HalfDay' THEN 1 END) AS HalfDayCount,
        COUNT(*) AS TotalRecords,
        ISNULL(SUM(CASE WHEN sa.CheckIn IS NOT NULL AND sa.CheckOut IS NOT NULL
                        THEN DATEDIFF(MINUTE, sa.CheckIn, sa.CheckOut) ELSE 0 END), 0) AS TotalDutyMinutes
      FROM dbo.SecurityAttendance sa
      WHERE ${where}
    `);
    res.json(r.recordset[0]);
  } catch (err) {
    console.error("GET /security-attendance/history-summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CHECK-IN ──────────────────────────────────────────────────────────────

router.post("/check-in", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { securityId, shiftId, remarks } = req.body;
  const secId = parseInt(securityId, 10);
  const shId = parseInt(shiftId, 10);
  if (!Number.isFinite(secId)) return res.status(400).json({ error: "Select a security person" });
  if (!Number.isFinite(shId)) return res.status(400).json({ error: "Select a shift" });

  try {
    const pool = getPool();

    const personRes = await pool.request().input("Id", sql.Int, secId)
      .query("SELECT Id, Name, Status, DefaultShiftId FROM dbo.SecurityPersonnel WHERE Id = @Id");
    const person = personRes.recordset[0];
    if (!person) return res.status(404).json({ error: "Security person not found" });
    if (person.Status !== "Active") return res.status(400).json({ error: `${person.Name} is not an active security personnel.` });

    // Prevents "attendance being created for a person who is not
    // scheduled for that shift" — the person's own DefaultShiftId is the
    // one legitimate shift for them, unless they simply have none set
    // (in which case any shift is accepted, since there's nothing to
    // check against).
    if (person.DefaultShiftId && person.DefaultShiftId !== shId) {
      return res.status(400).json({ error: `${person.Name} is not scheduled for this shift.` });
    }

    const shiftRes = await pool.request().input("Id", sql.Int, shId)
      .query("SELECT Id, Name, StartTime, EndTime, GraceMinutes, Status FROM dbo.SecurityShift WHERE Id = @Id");
    const shift = shiftRes.recordset[0];
    if (!shift) return res.status(404).json({ error: "Shift not found" });
    if (shift.Status !== "Active") return res.status(400).json({ error: `${shift.Name} is not an active shift.` });

    const today = new Date().toISOString().slice(0, 10);

    const dupRes = await pool.request()
      .input("SecurityId", sql.Int, secId)
      .input("ShiftId", sql.Int, shId)
      .input("Date", sql.Date, today)
      .query(`
        SELECT Id FROM dbo.SecurityAttendance
        WHERE SecurityId = @SecurityId AND ShiftId = @ShiftId AND AttendanceDate = @Date AND IsCancelled = 0
      `);
    if (dupRes.recordset.length) {
      return res.status(409).json({ error: "Attendance already recorded for this security person and shift." });
    }

    const now = new Date();
    const scheduledInMinutes = timeToMinutes(shift.StartTime);
    const scheduledOutMinutes = timeToMinutes(shift.EndTime);
    const scheduledInAt = combineDateAndMinutes(today, scheduledInMinutes);
    const lateAfter = new Date(scheduledInAt.getTime() + (Number(shift.GraceMinutes) || 0) * 60000);
    const status = now.getTime() > lateAfter.getTime() ? "Late" : "Present";

    const insertRes = await pool
      .request()
      .input("SecurityId", sql.Int, secId)
      .input("ShiftId", sql.Int, shId)
      .input("AttendanceDate", sql.Date, today)
      .input("ScheduledIn", sql.VarChar(8), formatTimeHHMMSS(shift.StartTime))
      .input("ScheduledOut", sql.VarChar(8), formatTimeHHMMSS(shift.EndTime))
      .input("CheckIn", sql.DateTime2, now)
      .input("Status", sql.NVarChar(20), status)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.SecurityAttendance
          (SecurityId, ShiftId, AttendanceDate, ScheduledIn, ScheduledOut, CheckIn, Status, Remarks, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES
          (@SecurityId, @ShiftId, @AttendanceDate, @ScheduledIn, @ScheduledOut, @CheckIn, @Status, @Remarks, @CreatedBy)
      `);
    const attendanceId = insertRes.recordset[0].Id;

    try {
      await writeLog(pool, {
        attendanceId, securityId: secId, action: "CHECK_IN",
        oldValue: null, newValue: { checkIn: now.toISOString(), status },
        performedBy: actorOf(req), deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] check-in audit log failed:", logErr.message);
    }

    res.status(201).json({ id: attendanceId, status, checkIn: now.toISOString(), message: `Checked in — marked ${status}.` });
  } catch (err) {
    console.error("POST /security-attendance/check-in error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CHECK-OUT ─────────────────────────────────────────────────────────────

router.post("/:id/check-out", requirePageRight(PAGE_KEY, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attendance id" });
  const { remarks } = req.body;

  try {
    const pool = getPool();
    const attRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT sa.Id, sa.SecurityId, sa.CheckIn, sa.CheckOut, sa.Status, sa.AttendanceDate,
             sh.StartTime, sh.EndTime
      FROM dbo.SecurityAttendance sa
      JOIN dbo.SecurityShift sh ON sh.Id = sa.ShiftId
      WHERE sa.Id = @Id AND sa.IsCancelled = 0
    `);
    const att = attRes.recordset[0];
    if (!att) return res.status(404).json({ error: "Attendance record not found" });
    if (!att.CheckIn) return res.status(400).json({ error: "This person hasn't checked in yet — cannot check out before check-in." });
    if (att.CheckOut) return res.status(409).json({ error: "This attendance record has already been checked out." });

    const now = new Date();
    if (now.getTime() < new Date(att.CheckIn).getTime()) {
      return res.status(400).json({ error: "Check-out time cannot be before check-in." });
    }

    const dutyMinutes = Math.round((now.getTime() - new Date(att.CheckIn).getTime()) / 60000);

    // Scheduled shift duration, handling an overnight shift (EndTime <=
    // StartTime means it wraps past midnight).
    const startMin = timeToMinutes(att.StartTime);
    let endMin = timeToMinutes(att.EndTime);
    if (endMin <= startMin) endMin += 24 * 60;
    const scheduledMinutes = endMin - startMin;

    // Half Day overrides Present, but never overrides Late — a late
    // arrival who also leaves early is still recorded as Late (the more
    // specific/important flag), not silently downgraded.
    let newStatus = att.Status;
    if (att.Status === "Present" && scheduledMinutes > 0 && dutyMinutes < scheduledMinutes / 2) {
      newStatus = "HalfDay";
    }

    const oldValue = { checkOut: null, status: att.Status };

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("CheckOut", sql.DateTime2, now)
      .input("Status", sql.NVarChar(20), newStatus)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("UpdatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.SecurityAttendance SET
          CheckOut = @CheckOut, Status = @Status,
          Remarks = COALESCE(@Remarks, Remarks),
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    try {
      await writeLog(pool, {
        attendanceId: id, securityId: att.SecurityId, action: "CHECK_OUT",
        oldValue, newValue: { checkOut: now.toISOString(), status: newStatus, dutyMinutes },
        performedBy: actorOf(req), deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] check-out audit log failed:", logErr.message);
    }

    const hours = Math.floor(dutyMinutes / 60);
    const mins = dutyMinutes % 60;
    res.json({
      id, status: newStatus, checkOut: now.toISOString(), dutyMinutes,
      dutyHoursLabel: `${hours}h ${String(mins).padStart(2, "0")}m`,
      message: `Checked out — duty hours ${hours}h ${String(mins).padStart(2, "0")}m.`,
    });
  } catch (err) {
    console.error("POST /security-attendance/:id/check-out error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MARK ABSENT (explicit) ────────────────────────────────────────────────

router.post("/mark-absent", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { securityId, shiftId, date, remarks } = req.body;
  const secId = parseInt(securityId, 10);
  const shId = parseInt(shiftId, 10);
  if (!Number.isFinite(secId)) return res.status(400).json({ error: "Select a security person" });
  if (!Number.isFinite(shId)) return res.status(400).json({ error: "Select a shift" });
  const attDate = date || new Date().toISOString().slice(0, 10);

  try {
    const pool = getPool();
    const shiftRes = await pool.request().input("Id", sql.Int, shId)
      .query("SELECT Id, StartTime, EndTime FROM dbo.SecurityShift WHERE Id = @Id");
    const shift = shiftRes.recordset[0];
    if (!shift) return res.status(404).json({ error: "Shift not found" });

    const dupRes = await pool.request()
      .input("SecurityId", sql.Int, secId).input("ShiftId", sql.Int, shId).input("Date", sql.Date, attDate)
      .query(`
        SELECT Id FROM dbo.SecurityAttendance
        WHERE SecurityId = @SecurityId AND ShiftId = @ShiftId AND AttendanceDate = @Date AND IsCancelled = 0
      `);
    if (dupRes.recordset.length) {
      return res.status(409).json({ error: "Attendance already recorded for this security person and shift." });
    }

    const insertRes = await pool
      .request()
      .input("SecurityId", sql.Int, secId)
      .input("ShiftId", sql.Int, shId)
      .input("AttendanceDate", sql.Date, attDate)
      .input("ScheduledIn", sql.VarChar(8), formatTimeHHMMSS(shift.StartTime))
      .input("ScheduledOut", sql.VarChar(8), formatTimeHHMMSS(shift.EndTime))
      .input("Status", sql.NVarChar(20), "Absent")
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), actorOf(req))
      .query(`
        INSERT INTO dbo.SecurityAttendance
          (SecurityId, ShiftId, AttendanceDate, ScheduledIn, ScheduledOut, Status, Remarks, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@SecurityId, @ShiftId, @AttendanceDate, @ScheduledIn, @ScheduledOut, 'Absent', @Remarks, @CreatedBy)
      `);
    const attendanceId = insertRes.recordset[0].Id;

    try {
      await writeLog(pool, {
        attendanceId, securityId: secId, action: "ATTENDANCE_EDITED",
        oldValue: null, newValue: { status: "Absent", date: attDate },
        performedBy: actorOf(req), remarks: "Marked absent manually",
        deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] mark-absent audit log failed:", logErr.message);
    }

    res.status(201).json({ id: attendanceId, message: "Marked absent." });
  } catch (err) {
    console.error("POST /security-attendance/mark-absent error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── VERIFY / REJECT ───────────────────────────────────────────────────────

router.post("/:id/verify", requirePageRight(PAGE_KEY, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attendance id" });
  const { remarks } = req.body;

  try {
    const pool = getPool();
    const attRes = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Id, SecurityId, VerificationStatus FROM dbo.SecurityAttendance WHERE Id = @Id AND IsCancelled = 0");
    const att = attRes.recordset[0];
    if (!att) return res.status(404).json({ error: "Attendance record not found" });

    const oldValue = { verificationStatus: att.VerificationStatus };
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("By", sql.NVarChar(150), actorOf(req))
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .query(`
        UPDATE dbo.SecurityAttendance SET
          VerificationStatus = 'Verified', VerifiedBy = @By, VerifiedAt = SYSDATETIME(),
          VerificationRemarks = @Remarks, UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    try {
      await writeLog(pool, {
        attendanceId: id, securityId: att.SecurityId, action: "ATTENDANCE_VERIFIED",
        oldValue, newValue: { verificationStatus: "Verified" }, performedBy: actorOf(req), remarks,
        deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] verify audit log failed:", logErr.message);
    }

    res.json({ message: "Attendance verified" });
  } catch (err) {
    console.error("POST /security-attendance/:id/verify error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/reject", requirePageRight(PAGE_KEY, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attendance id" });
  const { remarks } = req.body;
  if (!remarks || !String(remarks).trim()) return res.status(400).json({ error: "A reason is required to reject an attendance record." });

  try {
    const pool = getPool();
    const attRes = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Id, SecurityId, VerificationStatus FROM dbo.SecurityAttendance WHERE Id = @Id AND IsCancelled = 0");
    const att = attRes.recordset[0];
    if (!att) return res.status(404).json({ error: "Attendance record not found" });

    const oldValue = { verificationStatus: att.VerificationStatus };
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("By", sql.NVarChar(150), actorOf(req))
      .input("Remarks", sql.NVarChar(500), String(remarks).trim())
      .query(`
        UPDATE dbo.SecurityAttendance SET
          VerificationStatus = 'Rejected', VerifiedBy = @By, VerifiedAt = SYSDATETIME(),
          VerificationRemarks = @Remarks, UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    try {
      await writeLog(pool, {
        attendanceId: id, securityId: att.SecurityId, action: "ATTENDANCE_REJECTED",
        oldValue, newValue: { verificationStatus: "Rejected" }, performedBy: actorOf(req), remarks,
        deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] reject audit log failed:", logErr.message);
    }

    res.json({ message: "Attendance rejected" });
  } catch (err) {
    console.error("POST /security-attendance/:id/reject error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CANCEL (soft) ─────────────────────────────────────────────────────────
// A wrongly-created record (e.g. checked in the wrong person) is never
// hard-deleted — flipped to IsCancelled instead, same soft-cancel
// convention every other financial/workflow document in this app uses,
// so the audit trail (and the ATTENDANCE_CANCELLED log entry) survives.

router.post("/:id/cancel", requirePageRight(PAGE_KEY, "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attendance id" });
  const { remarks } = req.body;
  if (!remarks || !String(remarks).trim()) return res.status(400).json({ error: "A reason is required to cancel an attendance record." });

  try {
    const pool = getPool();
    const attRes = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Id, SecurityId, IsCancelled FROM dbo.SecurityAttendance WHERE Id = @Id");
    const att = attRes.recordset[0];
    if (!att) return res.status(404).json({ error: "Attendance record not found" });
    if (att.IsCancelled) return res.status(409).json({ error: "This attendance record is already cancelled." });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("By", sql.NVarChar(150), actorOf(req))
      .query(`
        UPDATE dbo.SecurityAttendance SET IsCancelled = 1, UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    try {
      await writeLog(pool, {
        attendanceId: id, securityId: att.SecurityId, action: "ATTENDANCE_CANCELLED",
        oldValue: { isCancelled: false }, newValue: { isCancelled: true }, performedBy: actorOf(req), remarks,
        deviceInfo: req.headers["user-agent"] || null, ipAddress: requestIp(req),
      });
    } catch (logErr) {
      console.error("[security-attendance] cancel audit log failed:", logErr.message);
    }

    res.json({ message: "Attendance record cancelled" });
  } catch (err) {
    console.error("POST /security-attendance/:id/cancel error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AUDIT LOG ─────────────────────────────────────────────────────────────

router.get("/:id/logs", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attendance id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).query(`
      SELECT Id, Action, OldValue, NewValue, PerformedBy, PerformedAt, DeviceInfo, IPAddress, Remarks
      FROM dbo.SecurityAttendanceLog
      WHERE AttendanceId = @Id
      ORDER BY PerformedAt ASC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("GET /security-attendance/:id/logs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
