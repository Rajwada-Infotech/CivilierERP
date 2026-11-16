const allowRoles = require("../middleware/role");
const { pageRightByMethod } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const attendanceSvc = require("../services/employeeAttendance");

const STATUSES = ["Present", "Absent", "Half Day", "On Leave", "Holiday", "Week Off"];
const isUniqueViolation = (err) => /UQ_AttendanceRecord_EmployeeDate/i.test(err.message || "");

// A day that was punched (Employee Portal / staff Attendance) has a punch behind its Attendance Record, and the employee sees
// the punch. So deleting or retiming the record here must change the punch too, or the employee keeps seeing the old one.
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const istHHMM = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(11, 16);
const istMoment = (date, hhmm) => new Date(`${date}T${hhmm.padStart(5, "0")}:00+05:30`);

async function loadRow(pool, id) {
  const r = await pool.request().input("Id", sql.Int, id).query(
    "SELECT AttendanceId, EmployeeId, CONVERT(NVARCHAR(10), AttendanceDate, 23) AS D FROM dbo.AttendanceRecord WHERE AttendanceId = @Id",
  );
  return r.recordset[0] || null;
}
async function findPunch(pool, employeeId, date) {
  const r = await pool.request().input("E", sql.Int, employeeId).input("D", sql.Date, date).query(
    "SELECT AttendanceId, InTime, OutTime FROM dbo.EmployeeAttendance WHERE EmployeeId = @E AND AttendanceDate = @D",
  );
  return r.recordset[0] || null;
}

const SELECT_COLUMNS = `
  SELECT a.AttendanceId, a.EmployeeId, e.EmployeeCode, e.EmployeeName, a.AttendanceDate,
         a.Status, a.CheckIn, a.CheckOut, a.Remarks, a.IsActive, a.CreatedAt, a.UpdatedAt
  FROM dbo.AttendanceRecord a
  JOIN dbo.EmployeeMaster e ON e.EmployeeId = a.EmployeeId
`;

router.get("/", cache("attendance-record", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY a.AttendanceDate DESC, e.EmployeeName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[attendance-record] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// The punch behind one Attendance Record (same employee, same day): In / Out time, device location and live photo --
// present when the day was punched (Employee Portal or staff Attendance), null for a day entered by hand.
router.get("/:id/punch", pageRightByMethod("attendance-leave-overtime"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT p.AttendanceId AS PunchId, p.InTime, p.OutTime,
             p.InLatitude, p.InLongitude, p.InAccuracyM, p.OutLatitude, p.OutLongitude, p.OutAccuracyM,
             p.InPhoto, p.OutPhoto
      FROM dbo.AttendanceRecord a
      JOIN dbo.EmployeeAttendance p ON p.EmployeeId = a.EmployeeId AND p.AttendanceDate = a.AttendanceDate
      WHERE a.AttendanceId = @Id
    `);
    const p = r.recordset[0];
    if (!p) return res.json({ punch: null });
    const rec = await attendanceSvc.getRecord(getPool(), p.PunchId); // breaks with reason, allowance and extra time
    const loc = (lat, lng, acc) => (lat != null ? { lat: Number(lat), lng: Number(lng), accuracyM: acc ?? null } : null);
    res.json({
      punch: {
        inTime: p.InTime ? new Date(p.InTime).toISOString() : null,
        outTime: p.OutTime ? new Date(p.OutTime).toISOString() : null,
        inLocation: loc(p.InLatitude, p.InLongitude, p.InAccuracyM),
        outLocation: loc(p.OutLatitude, p.OutLongitude, p.OutAccuracyM),
        inPhoto: p.InPhoto || null,
        outPhoto: p.OutPhoto || null,
        breaks: (rec?.breaks ?? []).map((b) => ({ type: b.type, note: b.note, start: b.start, end: b.end, seconds: b.seconds, deduct: b.deduct, allowedSeconds: b.allowedSeconds, overSeconds: b.overSeconds })),
        breakSeconds: rec?.breakSeconds ?? 0, officialSeconds: rec?.officialSeconds ?? 0, extraSeconds: rec?.extraSeconds ?? 0,
        totalSeconds: rec?.totalSeconds ?? null, netSeconds: rec?.netSeconds ?? null,
      },
    });
  } catch (err) {
    console.error("[attendance-record] GET /:id/punch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", pageRightByMethod("attendance-leave-overtime"), async (req, res) => {
  const { EmployeeId, AttendanceDate, Status, CheckIn, CheckOut, Remarks, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!AttendanceDate) return res.status(400).json({ error: "Date is required" });
  if (!STATUSES.includes(Status)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}` });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("AttendanceDate", sql.Date, AttendanceDate)
      .input("Status", sql.NVarChar(20), Status)
      .input("CheckIn", sql.NVarChar(10), CheckIn || null)
      .input("CheckOut", sql.NVarChar(10), CheckOut || null)
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.AttendanceRecord (EmployeeId, AttendanceDate, Status, CheckIn, CheckOut, Remarks, IsActive, CreatedBy, CreatedAt)
        VALUES (@EmployeeId, @AttendanceDate, @Status, @CheckIn, @CheckOut, @Remarks, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("attendance-record");
    res.json({ message: "Attendance recorded successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "Attendance for this employee and date already exists" });
    console.error("[attendance-record] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", pageRightByMethod("attendance-leave-overtime"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { EmployeeId, AttendanceDate, Status, CheckIn, CheckOut, Remarks, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!AttendanceDate) return res.status(400).json({ error: "Date is required" });
  if (!STATUSES.includes(Status)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}` });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();

    const current = await loadRow(pool, id);
    if (!current) return res.status(404).json({ error: "Attendance record not found" });
    const punch = await findPunch(pool, current.EmployeeId, current.D);
    if (punch) {
      if (Number(EmployeeId) !== current.EmployeeId || String(AttendanceDate).slice(0, 10) !== current.D) {
        return res.status(409).json({ error: "This day was punched by the employee, so its employee and date can't be changed here. Change the times, or delete the day and add it again." });
      }
      if (CheckIn && !HHMM.test(String(CheckIn).trim())) return res.status(400).json({ error: "Check In must be a time like 09:30" });
      if (CheckOut && !HHMM.test(String(CheckOut).trim())) return res.status(400).json({ error: "Check Out must be a time like 18:30" });
      const wantIn = CheckIn ? String(CheckIn).trim().padStart(5, "0") : istHHMM(punch.InTime);
      const wantOut = CheckOut ? String(CheckOut).trim().padStart(5, "0") : null;
      const sameIn = wantIn === istHHMM(punch.InTime);
      const sameOut = wantOut === (punch.OutTime ? istHHMM(punch.OutTime) : null);
      if (!sameIn || !sameOut) {
        await attendanceSvc.hrUpdateRecord(
          pool, punch.AttendanceId,
          { inTime: istMoment(current.D, wantIn).toISOString(), outTime: wantOut ? istMoment(current.D, wantOut).toISOString() : null, reason: "Edited on Attendance Records" },
          req.user?.email || "unknown",
        );
      }
    }

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("AttendanceDate", sql.Date, AttendanceDate)
      .input("Status", sql.NVarChar(20), Status)
      .input("CheckIn", sql.NVarChar(10), CheckIn || null)
      .input("CheckOut", sql.NVarChar(10), CheckOut || null)
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.AttendanceRecord SET
          EmployeeId = @EmployeeId, AttendanceDate = @AttendanceDate, Status = @Status,
          CheckIn = @CheckIn, CheckOut = @CheckOut, Remarks = @Remarks,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME(),
          Source = N'Manual' -- once HR edits a row here it is theirs; later punches no longer overwrite it
        WHERE AttendanceId = @Id
      `);
    await bumpCacheVersion("attendance-record");
    res.json({ message: "Attendance updated successfully" });
  } catch (err) {
    if (err instanceof attendanceSvc.AttendanceError) return res.status(err.status).json({ error: err.message });
    if (isUniqueViolation(err)) return res.status(409).json({ error: "Attendance for this employee and date already exists" });
    console.error("[attendance-record] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", pageRightByMethod("attendance-leave-overtime"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await loadRow(pool, id);
    if (!existing) return res.status(404).json({ error: "Attendance record not found" });
    // A punched day: remove the punch (and its photos / breaks) too, so the employee no longer sees it.
    const punch = await findPunch(pool, existing.EmployeeId, existing.D);
    if (punch) await attendanceSvc.hrDeleteRecord(pool, punch.AttendanceId, { reason: "Deleted from Attendance Records" }, req.user?.email || "unknown");
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.AttendanceRecord WHERE AttendanceId = @Id");
    await bumpCacheVersion("attendance-record");
    res.json({ message: "Attendance record deleted" });
  } catch (err) {
    if (err instanceof attendanceSvc.AttendanceError) return res.status(err.status).json({ error: err.message });
    console.error("[attendance-record] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
