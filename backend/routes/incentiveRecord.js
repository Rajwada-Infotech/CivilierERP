const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const INCENTIVE_TYPES = ["Performance", "Sales", "Festival", "Referral", "Retention", "Other"];
const STATUSES = ["Pending", "Approved", "Rejected", "Paid"];

// INC-00001, INC-00002 ... Two concurrent creates can compute the same next
// number, so POST retries on the unique-index violation rather than locking.
async function nextDocumentNo(pool) {
  const r = await pool.request().query(
    "SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(DocumentNo, 5, 10) AS INT)), 0) AS n FROM dbo.IncentiveRecord WHERE DocumentNo LIKE 'INC-%'",
  );
  return `INC-${String(r.recordset[0].n + 1).padStart(5, "0")}`;
}

const SELECT_COLUMNS = `
  SELECT i.IncentiveId, i.DocumentNo, i.EmployeeId, e.EmployeeCode, e.EmployeeName, i.IncentiveType,
         i.IncentiveDate, i.Amount, i.Remarks, i.Status, i.IsActive, i.CreatedAt, i.UpdatedAt
  FROM dbo.IncentiveRecord i
  JOIN dbo.EmployeeMaster e ON e.EmployeeId = i.EmployeeId
`;

router.get("/", cache("incentive-record", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY i.IncentiveDate DESC, e.EmployeeName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[incentive-record] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { EmployeeId, IncentiveType, IncentiveDate, Amount, Remarks, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!INCENTIVE_TYPES.includes(IncentiveType)) return res.status(400).json({ error: `Incentive Type must be one of: ${INCENTIVE_TYPES.join(", ")}` });
  if (!IncentiveDate) return res.status(400).json({ error: "Date is required" });
  const amount = Number(Amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be a positive number" });
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    let documentNo = null;
    for (let attempt = 0; attempt < 5 && !documentNo; attempt++) {
      const candidate = await nextDocumentNo(pool);
      try {
        await pool
          .request()
          .input("DocumentNo", sql.NVarChar(30), candidate)
          .input("EmployeeId", sql.Int, Number(EmployeeId))
          .input("IncentiveType", sql.NVarChar(20), IncentiveType)
          .input("IncentiveDate", sql.Date, IncentiveDate)
          .input("Amount", sql.Decimal(18, 2), amount)
          .input("Remarks", sql.NVarChar(500), Remarks || null)
          .input("Status", sql.NVarChar(20), status)
          .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
          .input("CreatedBy", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.IncentiveRecord (DocumentNo, EmployeeId, IncentiveType, IncentiveDate, Amount, Remarks, Status, IsActive, CreatedBy, CreatedAt)
            VALUES (@DocumentNo, @EmployeeId, @IncentiveType, @IncentiveDate, @Amount, @Remarks, @Status, @IsActive, @CreatedBy, SYSUTCDATETIME())
          `);
        documentNo = candidate;
      } catch (insertErr) {
        if (insertErr.number !== 2601 && insertErr.number !== 2627) throw insertErr;
      }
    }
    if (!documentNo) return res.status(409).json({ error: "Could not allocate a document number, please try again." });
    await bumpCacheVersion("incentive-record");
    res.json({ message: `Incentive ${documentNo} recorded successfully`, documentNo });
  } catch (err) {
    console.error("[incentive-record] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { EmployeeId, IncentiveType, IncentiveDate, Amount, Remarks, Status, IsActive } = req.body;
  if (!EmployeeId) return res.status(400).json({ error: "Employee is required" });
  if (!INCENTIVE_TYPES.includes(IncentiveType)) return res.status(400).json({ error: `Incentive Type must be one of: ${INCENTIVE_TYPES.join(", ")}` });
  if (!IncentiveDate) return res.status(400).json({ error: "Date is required" });
  const amount = Number(Amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be a positive number" });
  const status = STATUSES.includes(Status) ? Status : "Pending";
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("EmployeeId", sql.Int, Number(EmployeeId))
      .input("IncentiveType", sql.NVarChar(20), IncentiveType)
      .input("IncentiveDate", sql.Date, IncentiveDate)
      .input("Amount", sql.Decimal(18, 2), amount)
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("Status", sql.NVarChar(20), status)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.IncentiveRecord SET
          EmployeeId = @EmployeeId, IncentiveType = @IncentiveType, IncentiveDate = @IncentiveDate,
          Amount = @Amount, Remarks = @Remarks, Status = @Status,
          IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE IncentiveId = @Id
      `);
    await bumpCacheVersion("incentive-record");
    res.json({ message: "Incentive updated successfully" });
  } catch (err) {
    console.error("[incentive-record] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT IncentiveId FROM dbo.IncentiveRecord WHERE IncentiveId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Incentive record not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.IncentiveRecord WHERE IncentiveId = @Id");
    await bumpCacheVersion("incentive-record");
    res.json({ message: "Incentive record deleted" });
  } catch (err) {
    console.error("[incentive-record] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
