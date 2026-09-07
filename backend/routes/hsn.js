const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express")
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router()
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db")

router.get("/", cache("hsn", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query(
      "SELECT HId, HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, HIsSAC, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, ApprovedBy, ApprovedAt, HIsEdited FROM dbo.HSN"
    )
    res.json(result.recordset)
  } catch (err) {
    console.error("GET ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post("/", requirePageRight("hsn-master", "create"), async (req, res) => {
  const {
    HCode, HDescription, HShortDescription,
    HCGST, HSGST, HIGST, HStatus, HIsSAC,
  } = req.body

  // CreatedBy is NOT NULL on dbo.HSN — req.user?.userId alone reached null
  // for some sessions/tokens and crashed the INSERT with an unhandled SQL
  // constraint error (500, no useful message) instead of a clean check.
  // Same req.user?.id fallback already used in debitNote.js/accountGroup.js.
  const createdBy = req.user?.userId ?? req.user?.id ?? null
  if (!createdBy) {
    return res.status(401).json({ error: "User context missing — please sign in again." })
  }

  try {
    const pool = getPool()
    // HCode is deliberately NOT unique — the same HSN code legitimately
    // covers multiple product descriptions (e.g. '3506'/'UPVC SOLVENT' and
    // '3506'/'CPVC SOLUTION' are both valid, distinct rows). HId (identity)
    // is the row's real key — see migration 304.
    const result = await pool
      .request()
      .input("HCode",             sql.VarChar,       HCode)
      .input("HDescription",      sql.NVarChar,      HDescription      || null)
      .input("HShortDescription", sql.NVarChar,      HShortDescription || null)
      .input("HCGST",             sql.Decimal(5, 2), HCGST             || null)
      .input("HSGST",             sql.Decimal(5, 2), HSGST             || null)
      .input("HIGST",             sql.Decimal(5, 2), HIGST             || null)
      .input("HStatus",           sql.Bit,           HStatus ? 1 : 0)
      .input("HIsSAC",            sql.Bit,           HIsSAC ? 1 : 0)
      .input("CreatedBy",         sql.Int,           createdBy)
      .input("CreatedAt",         sql.DateTime,      new Date())
      .input("HIsEdited",         sql.Bit,           0)
      .query(`
        INSERT INTO dbo.HSN (
          HCode, HDescription, HShortDescription,
          HCGST, HSGST, HIGST, HStatus, HIsSAC,
          CreatedBy, CreatedAt, HIsEdited
        )
        OUTPUT INSERTED.HId
        VALUES (
          @HCode, @HDescription, @HShortDescription,
          @HCGST, @HSGST, @HIGST, @HStatus, @HIsSAC,
          @CreatedBy, @CreatedAt, @HIsEdited
        )
      `)
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN added successfully", HId: result.recordset[0]?.HId })
  } catch (err) {
    console.error("INSERT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put("/:id", requirePageRight("hsn-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid HSN id" })
  const {
    HCode, HDescription, HShortDescription,
    HCGST, HSGST, HIGST, HStatus, HIsSAC,
  } = req.body

  const updatedBy = req.user?.userId ?? req.user?.id ?? null

  try {
    const pool = getPool()
    const result = await pool
      .request()
      .input("HId",                sql.Int,           id)
      .input("HCode",              sql.VarChar,       HCode)
      .input("HDescription",       sql.NVarChar,      HDescription      || null)
      .input("HShortDescription",  sql.NVarChar,      HShortDescription || null)
      .input("HCGST",              sql.Decimal(5, 2), HCGST             || null)
      .input("HSGST",              sql.Decimal(5, 2), HSGST             || null)
      .input("HIGST",              sql.Decimal(5, 2), HIGST             || null)
      .input("HStatus",            sql.Bit,           HStatus ? 1 : 0)
      .input("HIsSAC",             sql.Bit,           HIsSAC ? 1 : 0)
      .input("HIsEdited",          sql.Bit,           1)
      .input("UpdatedBy",          sql.Int,           updatedBy)
      .input("UpdatedAt",          sql.DateTime,      new Date())
      .query(`
        UPDATE dbo.HSN SET
          HCode             = @HCode,
          HDescription      = @HDescription,
          HShortDescription = @HShortDescription,
          HCGST             = @HCGST,
          HSGST             = @HSGST,
          HIGST             = @HIGST,
          HStatus           = @HStatus,
          HIsSAC            = @HIsSAC,
          HIsEdited         = @HIsEdited,
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = @UpdatedAt
        WHERE HId = @HId
      `)
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "HSN record not found" })
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN updated successfully" })
  } catch (err) {
    console.error("UPDATE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete("/:id", requirePageRight("hsn-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid HSN id" })
  try {
    const pool = getPool()
    const result = await pool
      .request()
      .input("HId", sql.Int, id)
      .query("DELETE FROM dbo.HSN WHERE HId = @HId")
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "HSN record not found" })
    await bumpCacheVersion("hsn")
    res.json({ message: "HSN deleted successfully" })
  } catch (err) {
    console.error("DELETE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router





