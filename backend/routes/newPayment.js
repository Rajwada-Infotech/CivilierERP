const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")
const { cache } = require("../middleware/cache")
const { bumpCacheVersion } = require("../redis")

// GET all
router.get("/", cache("new-payment", 300), async (req, res) => {
  try {
    const pool = getPool()

    // Sanitized pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    // Total count
    const countResult = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.NewPayment");
    const total = parseInt(countResult.recordset[0].total);

    // Paginated data
    const result = await pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query("SELECT * FROM dbo.NewPayment ORDER BY PPaymentID DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY");

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ADD
router.post("/", async (req, res) => {
  const {
    PPaymentName, PMode, PAmount, PDocType,
    PDate, PBankID, PBankName, PProject, PCompany
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("PPaymentName", sql.VarChar,        PPaymentName || null)
      .input("PMode",        sql.VarChar,        PMode || null)
      .input("PAmount",      sql.Decimal(18, 2), PAmount || null)
      .input("PDocType",     sql.VarChar,        PDocType || null)
      .input("PDate",        sql.Date,           PDate || null)
      .input("PBankID",      sql.Int,            PBankID || null)
      .input("PBankName",    sql.VarChar,        PBankName || null)
      .input("PProject",     sql.VarChar,        PProject || null)
      .input("PCompany",     sql.VarChar,        PCompany || null)
      .input("PCreatedAt",   sql.DateTime,       new Date())
      .input("PCreatedBy",   sql.Int,            1)
      .input("PApprovedBy",  sql.Int,            null)
      .query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PMode, PAmount, PDocType, PDate,
          PBankID, PBankName, PProject, PCompany,
          PCreatedAt, PCreatedBy, PApprovedBy
        ) VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany,
          @PCreatedAt, @PCreatedBy, @PApprovedBy
        )
      `)
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const {
    PPaymentName, PMode, PAmount, PDocType,
    PDate, PBankID, PBankName, PProject, PCompany
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("PPaymentID",   sql.Int,            id)
      .input("PPaymentName", sql.VarChar,        PPaymentName || null)
      .input("PMode",        sql.VarChar,        PMode || null)
      .input("PAmount",      sql.Decimal(18, 2), PAmount || null)
      .input("PDocType",     sql.VarChar,        PDocType || null)
      .input("PDate",        sql.Date,           PDate || null)
      .input("PBankID",      sql.Int,            PBankID || null)
      .input("PBankName",    sql.VarChar,        PBankName || null)
      .input("PProject",     sql.VarChar,        PProject || null)
      .input("PCompany",     sql.VarChar,        PCompany || null)
      .query(`
        UPDATE dbo.NewPayment SET
          PPaymentName=@PPaymentName, PMode=@PMode,
          PAmount=@PAmount, PDocType=@PDocType, PDate=@PDate,
          PBankID=@PBankID, PBankName=@PBankName,
          PProject=@PProject, PCompany=@PCompany
        WHERE PPaymentID=@PPaymentID
      `)
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = getPool()
    await pool.request()
      .input("PPaymentID", sql.Int, id)
      .query("DELETE FROM dbo.NewPayment WHERE PPaymentID=@PPaymentID")
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
