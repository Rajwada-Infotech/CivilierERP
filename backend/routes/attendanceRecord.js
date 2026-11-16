const allowRoles = require("../middleware/role");
const { pageRightByMethod } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");

const STATUSES = ["Present", "Absent", "Half Day", "On Leave", "Holiday", "Week Off"];
const isUniqueViolation = (err) => /UQ_AttendanceRecord_EmployeeDate/i.test(err.message || "");

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
    const loc = (lat, lng, acc) => (lat != null ? { lat: Number(lat), lng: Number(lng), accuracyM: acc ?? null } : null);
    res.json({
      punch: {
        inTime: p.InTime ? new Date(p.InTime).toISOString() : null,
        outTime: p.OutTime ? new Date(p.OutTime).toISOString() : null,
        inLocation: loc(p.InLatitude, p.InLongitude, p.InAccuracyM),
        outLocation: loc(p.OutLatitude, p.OutLongitude, p.OutAccuracyM),
        inPhoto: p.InPhoto || null,
        outPhoto: p.OutPhoto || null,
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
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT AttendanceId FROM dbo.AttendanceRecord WHERE AttendanceId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Attendance record not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.AttendanceRecord WHERE AttendanceId = @Id");
    await bumpCacheVersion("attendance-record");
    res.json({ message: "Attendance record deleted" });
  } catch (err) {
    console.error("[attendance-record] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
