const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const STATUSES = ["Pending", "Approved", "Rejected"];

const SELECT_COLUMNS = `
  SELECT o.OvertimeId, o.EmployeeId, e.EmployeeCode, e.EmployeeName, o.OvertimeDate,
         o.Hours, o.RateMultiplier, o.Remarks, o.Status, o.IsActive, o.CreatedAt, o.UpdatedAt
  FROM dbo.OvertimeRecord o
  JOIN dbo.EmployeeMaster e ON e.EmployeeId = o.EmployeeId
`;

router.get("/", cache("overtime-record", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY o.OvertimeDate DESC, e.EmployeeName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[overtime-record] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { EmployeeId, OvertimeDate, Hours, RateMultiplier, Remarks, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!OvertimeDate) return res.status(400).json({ error: "Date is required" });
  const hours = Number(Hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: "Hours must be a positive number" });
  const rate = Number(RateMultiplier);
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("OvertimeDate", sql.Date, OvertimeDate)
      .input("Hours", sql.Decimal(5, 2), hours)
      .input("RateMultiplier", sql.Decimal(4, 2), Number.isFinite(rate) && rate > 0 ? rate : 1.5)
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("Status", sql.NVarChar(20), status)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.OvertimeRecord (EmployeeId, OvertimeDate, Hours, RateMultiplier, Remarks, Status, IsActive, CreatedBy, CreatedAt)
        VALUES (@EmployeeId, @OvertimeDate, @Hours, @RateMultiplier, @Remarks, @Status, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCacheVersion("overtime-record");
    res.json({ message: "Overtime recorded successfully" });
  } catch (err) {
    console.error("[overtime-record] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { EmployeeId, OvertimeDate, Hours, RateMultiplier, Remarks, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!OvertimeDate) return res.status(400).json({ error: "Date is required" });
  const hours = Number(Hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: "Hours must be a positive number" });
  const rate = Number(RateMultiplier);
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("OvertimeDate", sql.Date, OvertimeDate)
      .input("Hours", sql.Decimal(5, 2), hours)
      .input("RateMultiplier", sql.Decimal(4, 2), Number.isFinite(rate) && rate > 0 ? rate : 1.5)
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("Status", sql.NVarChar(20), status)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.OvertimeRecord SET
          EmployeeId = @EmployeeId, OvertimeDate = @OvertimeDate, Hours = @Hours, RateMultiplier = @RateMultiplier,
          Remarks = @Remarks, Status = @Status, IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE OvertimeId = @Id
      `);
    await bumpCacheVersion("overtime-record");
    res.json({ message: "Overtime updated successfully" });
  } catch (err) {
    console.error("[overtime-record] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT OvertimeId FROM dbo.OvertimeRecord WHERE OvertimeId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Overtime record not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.OvertimeRecord WHERE OvertimeId = @Id");
    await bumpCacheVersion("overtime-record");
    res.json({ message: "Overtime record deleted" });
  } catch (err) {
    console.error("[overtime-record] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
