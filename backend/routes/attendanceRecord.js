const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
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

router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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

router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
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

router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
