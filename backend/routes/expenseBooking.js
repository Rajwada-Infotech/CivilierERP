const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

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
    ECompanyName,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("EId", sql.NVarChar, `EXP-${Date.now()}`)
      .input("EProjectName", sql.VarChar, EProjectName || null)
      .input("EDocumentType", sql.VarChar, EDocumentType || null)
      .input("EDocDate", sql.Date, EDocDate || null)
      .input("EAmount", sql.Decimal(18, 2), EAmount || null)
      .input("EDocNo", sql.VarChar, EDocNo || null)
      .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
      .input("EReminder", sql.Date, EReminder || null)
      .input("ERemarks", sql.NVarChar, ERemarks || null)
      .input("EStatus", sql.VarChar, EStatus || "Pending")
      .input("ECreatedAt", sql.DateTime, new Date())
      .input("EUpdatedAt", sql.DateTime, new Date())
      .input("ECreatedBy", sql.Int, 1)
      .input("EApprovedBy", sql.Int, null)
      .input("ECompanyName", sql.VarChar, ECompanyName || null).query(`
        INSERT INTO dbo.ExpenseBooking (
          EId, EProjectName, EDocumentType, EDocDate, EAmount,
          EDocNo, EEmiPayment, EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyName
        ) VALUES (
          @EId, @EProjectName, @EDocumentType, @EDocDate, @EAmount,
          @EDocNo, @EEmiPayment, @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @ECreatedAt, @ECreatedBy, @EApprovedBy, @ECompanyName
        )
      `);
    res.json({
      message: "Expense booked successfully",
      EId: `EXP-${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params;
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
    ECompanyName,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("EId", sql.NVarChar, id)
      .input("EProjectName", sql.VarChar, EProjectName || null)
      .input("EDocumentType", sql.VarChar, EDocumentType || null)
      .input("EDocDate", sql.Date, EDocDate || null)
      .input("EAmount", sql.Decimal(18, 2), EAmount || null)
      .input("EDocNo", sql.VarChar, EDocNo || null)
      .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
      .input("EReminder", sql.Date, EReminder || null)
      .input("ERemarks", sql.NVarChar, ERemarks || null)
      .input("EStatus", sql.VarChar, EStatus || "Pending")
      .input("EUpdatedAt", sql.DateTime, new Date())
      .input("ECompanyName", sql.VarChar, ECompanyName || null).query(`
        UPDATE dbo.ExpenseBooking SET
          EProjectName=@EProjectName, EDocumentType=@EDocumentType,
          EDocDate=@EDocDate, EAmount=@EAmount, EDocNo=@EDocNo,
          EEmiPayment=@EEmiPayment, EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyName=@ECompanyName
        WHERE EId=@EId
      `);
    res.json({ message: "Expense updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("EId", sql.NVarChar, id)
      .query("DELETE FROM dbo.ExpenseBooking WHERE EId=@EId");
    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET options for Debit Note (Fixed)
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
        SELECT
          EId AS id,
          EId AS value,
          CONCAT(EId, ' — ', ISNULL(EDocNo, ''), ' (₹', ISNULL(CAST(EAmount AS VARCHAR(20)), '0'), ')') AS label,
          ECreatedAt
        FROM dbo.ExpenseBooking
        ORDER BY ECreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
