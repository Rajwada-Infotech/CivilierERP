const express = require("express")
const router = express.Router()
const { sql } = require("../db")

router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query("SELECT * FROM dbo.BankMaster")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const {
    BName, BBranch, BAccountNumber, BIfscCode,
    BAccountType, BBankType, BAccountHolderName,
    BOpeningBalance, BAddress, BStatus
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("BName",              sql.NVarChar,      BName || null)
      .input("BBranch",            sql.NVarChar,      BBranch || null)
      .input("BAccountNumber",     sql.NVarChar,      BAccountNumber || null)
      .input("BIfscCode",          sql.NVarChar,      BIfscCode || null)
      .input("BAccountType",       sql.NVarChar,      BAccountType || null)
      .input("BBankType",          sql.NVarChar,      BBankType || null)
      .input("BAccountHolderName", sql.NVarChar,      BAccountHolderName || null)
      .input("BOpeningBalance",    sql.Decimal(18,2), BOpeningBalance || null)
      .input("BAddress",           sql.NVarChar,      BAddress || null)
      .input("BStatus",            sql.Bit,           BStatus ? 1 : 0)
      .input("CreatedBy",          sql.Int,           1)
      .input("CreatedAt",          sql.DateTime2,     new Date())
      .query(`
        INSERT INTO dbo.BankMaster (
          BName, BBranch, BAccountNumber, BIfscCode, BAccountType,
          BBankType, BAccountHolderName, BOpeningBalance, BAddress,
          BStatus, CreatedBy, CreatedAt
        ) VALUES (
          @BName, @BBranch, @BAccountNumber, @BIfscCode, @BAccountType,
          @BBankType, @BAccountHolderName, @BOpeningBalance, @BAddress,
          @BStatus, @CreatedBy, @CreatedAt
        )
      `)
    res.json({ message: "Bank added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const {
    BName, BBranch, BAccountNumber, BIfscCode,
    BAccountType, BBankType, BAccountHolderName,
    BOpeningBalance, BAddress, BStatus
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("BId",                sql.Int,           req.params.id)
      .input("BName",              sql.NVarChar,      BName || null)
      .input("BBranch",            sql.NVarChar,      BBranch || null)
      .input("BAccountNumber",     sql.NVarChar,      BAccountNumber || null)
      .input("BIfscCode",          sql.NVarChar,      BIfscCode || null)
      .input("BAccountType",       sql.NVarChar,      BAccountType || null)
      .input("BBankType",          sql.NVarChar,      BBankType || null)
      .input("BAccountHolderName", sql.NVarChar,      BAccountHolderName || null)
      .input("BOpeningBalance",    sql.Decimal(18,2), BOpeningBalance || null)
      .input("BAddress",           sql.NVarChar,      BAddress || null)
      .input("BStatus",            sql.Bit,           BStatus ? 1 : 0)
      .input("UpdatedBy",          sql.Int,           1)
      .input("UpdatedAt",          sql.DateTime2,     new Date())
      .query(`
        UPDATE dbo.BankMaster SET
          BName=@BName, BBranch=@BBranch, BAccountNumber=@BAccountNumber,
          BIfscCode=@BIfscCode, BAccountType=@BAccountType, BBankType=@BBankType,
          BAccountHolderName=@BAccountHolderName, BOpeningBalance=@BOpeningBalance,
          BAddress=@BAddress, BStatus=@BStatus,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE BId=@BId
      `)
    res.json({ message: "Bank updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("BId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.BankMaster WHERE BId=@BId")
    res.json({ message: "Bank deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router