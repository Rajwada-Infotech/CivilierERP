const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")
const { cache } = require("../middleware/cache")
const { bumpCacheVersion } = require("../redis")

router.get("/", cache("card-master", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.card_master")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const {
    company_name, bank_name, account_number, ifsc_code,
    card_network, card_type, card_holder_name, card_number,
    cvv, expiry_month, expiry_year, reminder_enabled,
    reminder_days, status
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("company_name",     sql.VarChar,   company_name || null)
      .input("bank_name",        sql.VarChar,   bank_name || null)
      .input("account_number",   sql.VarChar,   account_number || null)
      .input("ifsc_code",        sql.VarChar,   ifsc_code || null)
      .input("card_network",     sql.VarChar,   card_network || null)
      .input("card_type",        sql.VarChar,   card_type || null)
      .input("card_holder_name", sql.VarChar,   card_holder_name || null)
      .input("card_number",      sql.VarChar,   card_number || null)
      .input("cvv",              sql.VarChar,   cvv || null)
      .input("expiry_month",     sql.TinyInt,   expiry_month || null)
      .input("expiry_year",      sql.SmallInt,  expiry_year || null)
      .input("reminder_enabled", sql.Bit,       reminder_enabled ? 1 : 0)
      .input("reminder_days",    sql.Int,       reminder_days || null)
      .input("status",           sql.Bit,       status ? 1 : 0)
      .input("created_at",       sql.DateTime2, new Date())
      .input("created_by",       sql.VarChar,   "system")
      .query(`
        INSERT INTO dbo.card_master (
          company_name, bank_name, account_number, ifsc_code,
          card_network, card_type, card_holder_name, card_number,
          cvv, expiry_month, expiry_year, reminder_enabled,
          reminder_days, status, created_at, created_by
        ) VALUES (
          @company_name, @bank_name, @account_number, @ifsc_code,
          @card_network, @card_type, @card_holder_name, @card_number,
          @cvv, @expiry_month, @expiry_year, @reminder_enabled,
          @reminder_days, @status, @created_at, @created_by
        )
      `)
    await bumpCacheVersion("card-master")
    res.json({ message: "Card added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const {
    company_name, bank_name, account_number, ifsc_code,
    card_network, card_type, card_holder_name, card_number,
    cvv, expiry_month, expiry_year, reminder_enabled,
    reminder_days, status
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("id",               sql.Int,       req.params.id)
      .input("company_name",     sql.VarChar,   company_name || null)
      .input("bank_name",        sql.VarChar,   bank_name || null)
      .input("account_number",   sql.VarChar,   account_number || null)
      .input("ifsc_code",        sql.VarChar,   ifsc_code || null)
      .input("card_network",     sql.VarChar,   card_network || null)
      .input("card_type",        sql.VarChar,   card_type || null)
      .input("card_holder_name", sql.VarChar,   card_holder_name || null)
      .input("card_number",      sql.VarChar,   card_number || null)
      .input("cvv",              sql.VarChar,   cvv || null)
      .input("expiry_month",     sql.TinyInt,   expiry_month || null)
      .input("expiry_year",      sql.SmallInt,  expiry_year || null)
      .input("reminder_enabled", sql.Bit,       reminder_enabled ? 1 : 0)
      .input("reminder_days",    sql.Int,       reminder_days || null)
      .input("status",           sql.Bit,       status ? 1 : 0)
      .input("updated_at",       sql.DateTime2, new Date())
      .input("updated_by",       sql.VarChar,   "system")
      .query(`
        UPDATE dbo.card_master SET
          company_name=@company_name, bank_name=@bank_name,
          account_number=@account_number, ifsc_code=@ifsc_code,
          card_network=@card_network, card_type=@card_type,
          card_holder_name=@card_holder_name, card_number=@card_number,
          cvv=@cvv, expiry_month=@expiry_month, expiry_year=@expiry_year,
          reminder_enabled=@reminder_enabled, reminder_days=@reminder_days,
          status=@status, updated_at=@updated_at, updated_by=@updated_by
        WHERE id=@id
      `)
    await bumpCacheVersion("card-master")
    res.json({ message: "Card updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.card_master WHERE id=@id")
    await bumpCacheVersion("card-master")
    res.json({ message: "Card deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
