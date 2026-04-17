const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")
const { cache } = require("../middleware/cache")
const { bumpCacheVersion } = require("../redis")

// GET all T&C records
router.get("/", cache("tc-master", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.TCMaster ORDER BY Id")
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST new T&C record
router.post("/", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body
  try {
    const pool = getPool()
    await pool
      .request()
      .input("Name",              sql.NVarChar(100), Name              || null)
      .input("TermsAndCondition", sql.NVarChar(500), TermsAndCondition || null)
      .input("Remarks",           sql.NVarChar(200), Remarks           || null)
      .input("isActive",          sql.Bit,           isActive !== false ? 1 : 0)
      .query(`
        INSERT INTO dbo.TCMaster (Name, TermsAndCondition, Remarks, isActive)
        VALUES (@Name, @TermsAndCondition, @Remarks, @isActive)
      `)
    await bumpCacheVersion("tc-master")
    res.json({ message: "T&C record added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT update T&C record
router.put("/:id", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body
  try {
    const pool = getPool()
    await pool
      .request()
      .input("Id",               sql.Int,           req.params.id)
      .input("Name",             sql.NVarChar(100), Name              || null)
      .input("TermsAndCondition",sql.NVarChar(500), TermsAndCondition || null)
      .input("Remarks",          sql.NVarChar(200), Remarks           || null)
      .input("isActive",         sql.Bit,           isActive !== false ? 1 : 0)
      .query(`
        UPDATE dbo.TCMaster SET
          Name              = @Name,
          TermsAndCondition = @TermsAndCondition,
          Remarks           = @Remarks,
          isActive          = @isActive
        WHERE Id = @Id
      `)
    await bumpCacheVersion("tc-master")
    res.json({ message: "T&C record updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE T&C record
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
