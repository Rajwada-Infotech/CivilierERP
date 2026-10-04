const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid"];
const STATUSES = ["Pending", "Approved", "Rejected"];

const SELECT_COLUMNS = `
  SELECT l.LeaveId, l.EmployeeId, e.EmployeeCode, e.EmployeeName, l.LeaveType,
         l.FromDate, l.ToDate, l.TotalDays, l.Reason, l.Status, l.IsActive, l.CreatedAt, l.UpdatedAt
  FROM dbo.LeaveRecord l
  JOIN dbo.EmployeeMaster e ON e.EmployeeId = l.EmployeeId
`;

function totalDays(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

router.get("/", cache("leave-record", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY l.FromDate DESC, e.EmployeeName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[leave-record] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { EmployeeId, LeaveType, FromDate, ToDate, Reason, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!LEAVE_TYPES.includes(LeaveType)) return res.status(400).json({ error: `Leave Type must be one of: ${LEAVE_TYPES.join(", ")}` });
  if (!FromDate || !ToDate) return res.status(400).json({ error: "From Date and To Date are required" });
  if (new Date(ToDate) < new Date(FromDate)) return res.status(400).json({ error: "To Date cannot be before From Date" });
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("LeaveType", sql.NVarChar(20), LeaveType)
      .input("FromDate", sql.Date, FromDate)
      .input("ToDate", sql.Date, ToDate)
      .input("TotalDays", sql.Int, totalDays(FromDate, ToDate))
      .input("Reason", sql.NVarChar(500), Reason || null)
      .input("Status", sql.NVarChar(20), status)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.LeaveRecord (EmployeeId, LeaveType, FromDate, ToDate, TotalDays, Reason, Status, IsActive, CreatedBy, CreatedAt)
        VALUES (@EmployeeId, @LeaveType, @FromDate, @ToDate, @TotalDays, @Reason, @Status, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("leave-record");
    res.json({ message: "Leave recorded successfully" });
  } catch (err) {
    console.error("[leave-record] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { EmployeeId, LeaveType, FromDate, ToDate, Reason, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!LEAVE_TYPES.includes(LeaveType)) return res.status(400).json({ error: `Leave Type must be one of: ${LEAVE_TYPES.join(", ")}` });
  if (!FromDate || !ToDate) return res.status(400).json({ error: "From Date and To Date are required" });
  if (new Date(ToDate) < new Date(FromDate)) return res.status(400).json({ error: "To Date cannot be before From Date" });
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("LeaveType", sql.NVarChar(20), LeaveType)
      .input("FromDate", sql.Date, FromDate)
      .input("ToDate", sql.Date, ToDate)
      .input("TotalDays", sql.Int, totalDays(FromDate, ToDate))
      .input("Reason", sql.NVarChar(500), Reason || null)
      .input("Status", sql.NVarChar(20), status)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.LeaveRecord SET
          EmployeeId = @EmployeeId, LeaveType = @LeaveType, FromDate = @FromDate, ToDate = @ToDate,
          TotalDays = @TotalDays, Reason = @Reason, Status = @Status,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE LeaveId = @Id
      `);
    await bumpCacheVersion("leave-record");
    res.json({ message: "Leave updated successfully" });
  } catch (err) {
    console.error("[leave-record] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT LeaveId FROM dbo.LeaveRecord WHERE LeaveId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Leave record not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.LeaveRecord WHERE LeaveId = @Id");
    await bumpCacheVersion("leave-record");
    res.json({ message: "Leave record deleted" });
  } catch (err) {
    console.error("[leave-record] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
