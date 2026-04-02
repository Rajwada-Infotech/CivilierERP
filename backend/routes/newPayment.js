const express = require("express")
const router = express.Router()
const { sql } = require("../db")

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query("SELECT * FROM dbo.NewPayment")
    res.json(result.recordset)
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
    const pool = await sql.connect()
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
    const pool = await sql.connect()
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
    res.json({ message: "Payment updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("PPaymentID", sql.Int, id)
      .query("DELETE FROM dbo.NewPayment WHERE PPaymentID=@PPaymentID")
    res.json({ message: "Payment deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router