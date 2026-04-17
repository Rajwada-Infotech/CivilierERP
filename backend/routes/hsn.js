const express = require("express")
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")

// GET all HSN
router.get("/", cache("hsn", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query(
      "SELECT HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, HCreatedBy, HCreatedAt, HApprovedBy, HIsEdited FROM dbo.HSN"
    )
    res.json(result.recordset)
  } catch (err) {
    console.error("GET ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// ADD HSN
router.post("/", async (req, res) => {
  console.log("POST BODY:", req.body)
  const {
    HCode,
    HDescription,
    HShortDescription,
    HCGST,
    HSGST,
    HIGST,
    HStatus,
  } = req.body

  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode", sql.VarChar, HCode)
      .input("HDescription", sql.NVarChar, HDescription || null)
      .input("HShortDescription", sql.NVarChar, HShortDescription || null)
      .input("HCGST", sql.Decimal(5, 2), HCGST || null)
      .input("HSGST", sql.Decimal(5, 2), HSGST || null)
      .input("HIGST", sql.Decimal(5, 2), HIGST || null)
      .input("HStatus", sql.Bit, HStatus ? 1 : 0)
      .input("HCreatedBy", sql.Int, 1)
      .input("HCreatedAt", sql.DateTime, new Date())
      .input("HApprovedBy", sql.Int, null)
      .input("HIsEdited", sql.Bit, 0)
      .query(`
        INSERT INTO dbo.HSN (
          HCode, HDescription, HShortDescription,
          HCGST, HSGST, HIGST, HStatus,
          HCreatedBy, HCreatedAt, HApprovedBy, HIsEdited
        ) VALUES (
          @HCode, @HDescription, @HShortDescription,
          @HCGST, @HSGST, @HIGST, @HStatus,
          @HCreatedBy, @HCreatedAt, @HApprovedBy, @HIsEdited
        )
      `)
    await bumpCacheVersion("hsn");

    res.json({ message: "HSN added successfully" })
  } catch (err) {
    console.error("INSERT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// UPDATE HSN
router.put("/:code", async (req, res) => {
  const { code } = req.params
  const {
    HDescription,
    HShortDescription,
    HCGST,
    HSGST,
    HIGST,
    HStatus,
  } = req.body

  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode", sql.VarChar, code)
      .input("HDescription", sql.NVarChar, HDescription || null)
      .input("HShortDescription", sql.NVarChar, HShortDescription || null)
      .input("HCGST", sql.Decimal(5, 2), HCGST || null)
      .input("HSGST", sql.Decimal(5, 2), HSGST || null)
      .input("HIGST", sql.Decimal(5, 2), HIGST || null)
      .input("HStatus", sql.Bit, HStatus ? 1 : 0)
      .input("HIsEdited", sql.Bit, 1)
      .query(`
        UPDATE dbo.HSN SET
          HDescription      = @HDescription,
          HShortDescription = @HShortDescription,
          HCGST             = @HCGST,
          HSGST             = @HSGST,
          HIGST             = @HIGST,
          HStatus           = @HStatus,
          HIsEdited         = @HIsEdited
        WHERE HCode = @HCode
      `)
    await bumpCacheVersion("hsn");

    res.json({ message: "HSN updated successfully" })
  } catch (err) {
    console.error("UPDATE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE HSN
router.delete("/:code", async (req, res) => {
  const { code } = req.params
  try {
    const pool = getPool()
    await pool
      .request()
      .input("HCode", sql.VarChar, code)
      .query("DELETE FROM dbo.HSN WHERE HCode = @HCode")
    await bumpCacheVersion("hsn");

    res.json({ message: "HSN deleted successfully" })
  } catch (err) {
    console.error("DELETE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
