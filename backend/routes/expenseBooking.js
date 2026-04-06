const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: /options MUST be declared before /:id so Express does not treat
// the literal string "options" as a record id parameter.
// ─────────────────────────────────────────────────────────────────────────────

// GET options for Debit Note dropdown
// Returns the integer PK (Eid) as `id` so dbo.DebitNote.bill_id FK is satisfied.
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
        SELECT
          Eid AS id,
          Eid AS value,
          CONCAT(ISNULL(EDocNo, 'N/A'), ' — ', ISNULL(EProjectName, ''), ' (\u20b9', ISNULL(CAST(EAmount AS VARCHAR(20)), '0'), ')') AS label,
          ECreatedAt
        FROM dbo.ExpenseBooking
        ORDER BY ECreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query("SELECT * FROM dbo.ExpenseBooking");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD
router.post("/", async (req, res) => {
  const {
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount,
    EDocNo,
    EEmiPayment,
    EReminder,
    ERemarks,
    EStatus,
    ECompanyId,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("EProjectName",  sql.NVarChar(150), EProjectName  || null)
      .input("EDocumentType", sql.NVarChar(50),  EDocumentType || null)
      .input("EDocDate",      sql.Date,          EDocDate      || null)
      .input("EAmount",       sql.Decimal(18,2), EAmount       || null)
      .input("EDocNo",        sql.NVarChar(50),  EDocNo        || null)
      .input("EEmiPayment",   sql.Bit,           EEmiPayment ? 1 : 0)
      .input("EReminder",     sql.Date,          EReminder     || null)
      .input("ERemarks",      sql.NVarChar(300), ERemarks      || null)
      .input("EStatus",       sql.NVarChar(50),  EStatus       || "Pending")
      .input("ECreatedAt",    sql.DateTime2,     new Date())
      .input("EUpdatedAt",    sql.DateTime2,     new Date())
      .input("ECreatedBy",    sql.Int,           1)
      .input("EApprovedBy",   sql.Int,           null)
      .input("ECompanyId",    sql.Int,           ECompanyId ? parseInt(ECompanyId, 10) : null)
      .query(`
        INSERT INTO dbo.ExpenseBooking (
          EProjectName, EDocumentType, EDocDate, EAmount,
          EDocNo, EEmiPayment, EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyId
        ) VALUES (
          @EProjectName, @EDocumentType, @EDocDate, @EAmount,
          @EDocNo, @EEmiPayment, @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy, @ECompanyId
        )
      `);
    res.json({ message: "Expense booked successfully" });
  } catch (err) {
    console.error("EXPENSE INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  const {
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount,
    EDocNo,
    EEmiPayment,
    EReminder,
    ERemarks,
    EStatus,
    ECompanyId,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Eid",           sql.Int,           numericId)
      .input("EProjectName",  sql.NVarChar(150), EProjectName  || null)
      .input("EDocumentType", sql.NVarChar(50),  EDocumentType || null)
      .input("EDocDate",      sql.Date,          EDocDate      || null)
      .input("EAmount",       sql.Decimal(18,2), EAmount       || null)
      .input("EDocNo",        sql.NVarChar(50),  EDocNo        || null)
      .input("EEmiPayment",   sql.Bit,           EEmiPayment ? 1 : 0)
      .input("EReminder",     sql.Date,          EReminder     || null)
      .input("ERemarks",      sql.NVarChar(300), ERemarks      || null)
      .input("EStatus",       sql.NVarChar(50),  EStatus       || "Pending")
      .input("EUpdatedAt",    sql.DateTime2,     new Date())
      .input("ECompanyId",    sql.Int,           ECompanyId ? parseInt(ECompanyId, 10) : null)
      .query(`
        UPDATE dbo.ExpenseBooking SET
          EProjectName=@EProjectName, EDocumentType=@EDocumentType,
          EDocDate=@EDocDate, EAmount=@EAmount, EDocNo=@EDocNo,
          EEmiPayment=@EEmiPayment, EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId
        WHERE Eid=@Eid
      `);
    res.json({ message: "Expense updated successfully" });
  } catch (err) {
    console.error("EXPENSE UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Eid", sql.Int, numericId)
      .query("DELETE FROM dbo.ExpenseBooking WHERE Eid=@Eid");
    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("EXPENSE DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
