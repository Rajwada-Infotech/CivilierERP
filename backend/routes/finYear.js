const express = require("express")
const { cache } = require("../middleware/cache");
// FIX: use bumpCacheVersion instead of redisDelPattern.
// The cache middleware stores keys as: cache:fin-year:v{N}:{userId}:{query}
// redisDelPattern("cache:fin-year:*") does NOT match those keys because the
// pattern doesn't account for the version segment — so the cache was never
// actually cleared after a PUT/DELETE, and the GET kept returning stale data.
// bumpCacheVersion("fin-year") increments the version number so the next GET
// generates a new key that has no cached value, forcing a fresh DB read.
const { bumpCacheVersion } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")
const { validateBody } = require("../middleware/validateRequest")
const {
  finYearCreateSchema,
  finYearUpdateSchema,
} = require("../validation/finYearSchemas")

router.get("/", cache("fin-year", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.FinYear")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", validateBody(finYearCreateSchema), async (req, res) => {
  const { FName, FStartDate, FEndDate, FStatus, FisLocked } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("FName",      sql.NVarChar,  FName || null)
      .input("FStartDate", sql.Date,      FStartDate || null)
      .input("FEndDate",   sql.Date,      FEndDate || null)
      .input("FStatus",    sql.Bit,       FStatus ? 1 : 0)
      .input("FisLocked",  sql.Bit,       FisLocked ? 1 : 0)
      .input("FCreatedBy", sql.Int,       1)
      .input("FCreatedAt", sql.DateTime2, new Date())
      .query(`
        INSERT INTO dbo.FinYear (FName, FStartDate, FEndDate, FStatus, FisLocked, FCreatedBy, FCreatedAt)
        VALUES (@FName, @FStartDate, @FEndDate, @FStatus, @FisLocked, @FCreatedBy, @FCreatedAt)
      `)
    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Partial UPDATE — only columns present in req.body are modified.
// This ensures toggleLock (which sends only FisLocked) does not null out
// FName, FStartDate, FEndDate, or FStatus.
router.put("/:id", validateBody(finYearUpdateSchema), async (req, res) => {
  const { FName, FStartDate, FEndDate, FStatus, FisLocked } = req.body
  try {
    const pool = getPool()

    const setClauses = []
    const request = pool.request().input("FId", sql.Int, req.params.id)

    if (FName !== undefined) {
      setClauses.push("FName=@FName")
      request.input("FName", sql.NVarChar, FName)
    }
    if (FStartDate !== undefined) {
      setClauses.push("FStartDate=@FStartDate")
      request.input("FStartDate", sql.Date, FStartDate)
    }
    if (FEndDate !== undefined) {
      setClauses.push("FEndDate=@FEndDate")
      request.input("FEndDate", sql.Date, FEndDate)
    }
    if (FStatus !== undefined) {
      setClauses.push("FStatus=@FStatus")
      request.input("FStatus", sql.Bit, FStatus ? 1 : 0)
    }
    if (FisLocked !== undefined) {
      setClauses.push("FisLocked=@FisLocked")
      request.input("FisLocked", sql.Bit, FisLocked ? 1 : 0)
    }

    setClauses.push("FUpdatedBy=@FUpdatedBy", "FUpdatedAt=@FUpdatedAt")
    request.input("FUpdatedBy", sql.Int, 1)
    request.input("FUpdatedAt", sql.DateTime2, new Date())

    if (setClauses.length === 2) {
      return res.json({ message: "Nothing to update" })
    }

    await request.query(`
      UPDATE dbo.FinYear
      SET ${setClauses.join(", ")}
      WHERE FId=@FId
    `)

    // FIX: bump cache version so next GET skips the stale cached response
    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("FId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.FinYear WHERE FId=@FId")
    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
