const express = require("express")
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")

router.get("/", cache("billing-terms", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.Billing_Terms_Master")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const { Name, Description, GST, Type, IsActive } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("Name",         sql.NVarChar,  Name || null)
      .input("Description",  sql.NVarChar,  Description || null)
      .input("GST",          sql.VarChar,   GST || null)
      .input("Type",         sql.VarChar,   Type || null)
      .input("IsActive",     sql.Bit,       IsActive ? 1 : 0)
      .input("CreatedBy",    sql.Int,       1)
      .input("CreatedDate",  sql.DateTime2, new Date())
      .query(`
        INSERT INTO dbo.Billing_Terms_Master (Name, Description, GST, Type, IsActive, CreatedBy, CreatedDate)
        VALUES (@Name, @Description, @GST, @Type, @IsActive, @CreatedBy, @CreatedDate)
      `)
    await bumpCacheVersion("billing-terms");

    res.json({ message: "Billing term added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const { Name, Description, GST, Type, IsActive } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("BillingTermID", sql.Int,       req.params.id)
      .input("Name",          sql.NVarChar,  Name || null)
      .input("Description",   sql.NVarChar,  Description || null)
      .input("GST",           sql.VarChar,   GST || null)
      .input("Type",          sql.VarChar,   Type || null)
      .input("IsActive",      sql.Bit,       IsActive ? 1 : 0)
      .input("ModifiedBy",    sql.Int,       1)
      .input("ModifiedDate",  sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.Billing_Terms_Master SET
          Name=@Name, Description=@Description, GST=@GST, Type=@Type,
          IsActive=@IsActive, ModifiedBy=@ModifiedBy, ModifiedDate=@ModifiedDate
        WHERE BillingTermID=@BillingTermID
      `)
    await bumpCacheVersion("billing-terms");

    res.json({ message: "Billing term updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("BillingTermID", sql.Int, req.params.id)
      .query("DELETE FROM dbo.Billing_Terms_Master WHERE BillingTermID=@BillingTermID")
    await bumpCacheVersion("billing-terms");

    res.json({ message: "Billing term deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
