const express = require("express")
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")

router.get("/", cache("fin-year", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.FinYear")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
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
    await redisDelPattern("cache:fin-year:*");

    res.json({ message: "Financial year added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const { FName, FStartDate, FEndDate, FStatus, FisLocked } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("FId",        sql.Int,       req.params.id)
      .input("FName",      sql.NVarChar,  FName || null)
      .input("FStartDate", sql.Date,      FStartDate || null)
      .input("FEndDate",   sql.Date,      FEndDate || null)
      .input("FStatus",    sql.Bit,       FStatus ? 1 : 0)
      .input("FisLocked",  sql.Bit,       FisLocked ? 1 : 0)
      .input("FUpdatedBy", sql.Int,       1)
      .input("FUpdatedAt", sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.FinYear SET
          FName=@FName, FStartDate=@FStartDate, FEndDate=@FEndDate,
          FStatus=@FStatus, FisLocked=@FisLocked,
          FUpdatedBy=@FUpdatedBy, FUpdatedAt=@FUpdatedAt
        WHERE FId=@FId
      `)
    await redisDelPattern("cache:fin-year:*");

    res.json({ message: "Financial year updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("FId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.FinYear WHERE FId=@FId")
    await redisDelPattern("cache:fin-year:*");

    res.json({ message: "Financial year deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router