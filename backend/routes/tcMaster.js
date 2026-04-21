const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")
const { cache } = require("../middleware/cache")
const { bumpCacheVersion } = require("../redis")

router.get("/", cache("tc-master", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.TCMaster ORDER BY Id")
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post("/", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body
  // ✅ CreatedBy from JWT
  const createdBy = req.user?.userId || null

  try {
    const pool = getPool()
    await pool
      .request()
      .input("Name",              sql.NVarChar(100), Name              || null)
      .input("TermsAndCondition", sql.NVarChar(500), TermsAndCondition || null)
      .input("Remarks",           sql.NVarChar(200), Remarks           || null)
      .input("isActive",          sql.Bit,           isActive !== false ? 1 : 0)
      .input("CreatedBy",         sql.Int,           createdBy) // ✅ INT from JWT
      .input("CreatedDate",       sql.DateTime2(3),  new Date())
      .query(`
        INSERT INTO dbo.TCMaster (Name, TermsAndCondition, Remarks, isActive, CreatedBy, CreatedDate)
        VALUES (@Name, @TermsAndCondition, @Remarks, @isActive, @CreatedBy, @CreatedDate)
      `)
    await bumpCacheVersion("tc-master")
    res.json({ message: "T&C record added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put("/:id", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body
  // ✅ UpdatedBy from JWT
  const updatedBy = req.user?.userId || null

  try {
    const pool = getPool()
    await pool
      .request()
      .input("Id",                sql.Int,           req.params.id)
      .input("Name",              sql.NVarChar(100), Name              || null)
      .input("TermsAndCondition", sql.NVarChar(500), TermsAndCondition || null)
      .input("Remarks",           sql.NVarChar(200), Remarks           || null)
      .input("isActive",          sql.Bit,           isActive !== false ? 1 : 0)
      .input("UpdatedBy",         sql.Int,           updatedBy) // ✅ INT from JWT
      .input("UpdatedDate",       sql.DateTime2(3),  new Date())
      .query(`
        UPDATE dbo.TCMaster SET
          Name              = @Name,
          TermsAndCondition = @TermsAndCondition,
          Remarks           = @Remarks,
          isActive          = @isActive,
          UpdatedBy         = @UpdatedBy,
          UpdatedDate       = @UpdatedDate
        WHERE Id = @Id
      `)
    await bumpCacheVersion("tc-master")
    res.json({ message: "T&C record updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.TCMaster WHERE Id = @Id")
    await bumpCacheVersion("tc-master")
    res.json({ message: "T&C record deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router