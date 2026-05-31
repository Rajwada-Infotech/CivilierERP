const express = require("express")
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")

router.get("/", cache("hsn", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query(
      "SELECT HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, ApprovedBy, ApprovedAt, HIsEdited FROM dbo.HSN"
    )
    res.json(result.recordset)
  } catch (err) {
    console.error("GET ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post("/", async (req, res) => {
  const {
    HCode, HDescription, HShortDescription,
    HCGST, HSGST, HIGST, HStatus,
  } = req.body

  const createdBy = req.user?.userId || null

  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode",             sql.VarChar,       HCode)
      .input("HDescription",      sql.NVarChar,      HDescription      || null)
      .input("HShortDescription", sql.NVarChar,      HShortDescription || null)
      .input("HCGST",             sql.Decimal(5, 2), HCGST             || null)
      .input("HSGST",             sql.Decimal(5, 2), HSGST             || null)
      .input("HIGST",             sql.Decimal(5, 2), HIGST             || null)
      .input("HStatus",           sql.Bit,           HStatus ? 1 : 0)
      .input("CreatedBy",         sql.Int,           createdBy)
      .input("CreatedAt",         sql.DateTime,      new Date())
      .input("HIsEdited",         sql.Bit,           0)
      .query(`
        INSERT INTO dbo.HSN (
          HCode, HDescription, HShortDescription,
          HCGST, HSGST, HIGST, HStatus,
          CreatedBy, CreatedAt, HIsEdited
        ) VALUES (
          @HCode, @HDescription, @HShortDescription,
          @HCGST, @HSGST, @HIGST, @HStatus,
          @CreatedBy, @CreatedAt, @HIsEdited
        )
      `)
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN added successfully" })
  } catch (err) {
    console.error("INSERT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put("/:code", async (req, res) => {
  const { code } = req.params
  const {
    HDescription, HShortDescription,
    HCGST, HSGST, HIGST, HStatus,
  } = req.body

  const updatedBy = req.user?.userId || null

  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode",             sql.VarChar,       code)
      .input("HDescription",      sql.NVarChar,      HDescription      || null)
      .input("HShortDescription", sql.NVarChar,      HShortDescription || null)
      .input("HCGST",             sql.Decimal(5, 2), HCGST             || null)
      .input("HSGST",             sql.Decimal(5, 2), HSGST             || null)
      .input("HIGST",             sql.Decimal(5, 2), HIGST             || null)
      .input("HStatus",           sql.Bit,           HStatus ? 1 : 0)
      .input("HIsEdited",         sql.Bit,           1)
      .input("UpdatedBy",         sql.Int,           updatedBy)
      .input("UpdatedAt",         sql.DateTime,      new Date())
      .query(`
        UPDATE dbo.HSN SET
          HDescription      = @HDescription,
          HShortDescription = @HShortDescription,
          HCGST             = @HCGST,
          HSGST             = @HSGST,
          HIGST             = @HIGST,
          HStatus           = @HStatus,
          HIsEdited         = @HIsEdited,
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = @UpdatedAt
        WHERE HCode = @HCode
      `)
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN updated successfully" })
  } catch (err) {
    console.error("UPDATE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete("/:code", async (req, res) => {
  const { code } = req.params
  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode", sql.VarChar, code)
      .query("DELETE FROM dbo.HSN WHERE HCode = @HCode")
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN deleted successfully" })
  } catch (err) {
    console.error("DELETE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

