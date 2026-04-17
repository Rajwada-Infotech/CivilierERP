const express = require("express")
const { cache } = require("../middleware/cache");
const { redisDelPattern, bumpCacheVersion } = require("../redis");
const router = express.Router()
const { getPool, sql } = require("../db")

// GET all
router.get("/", cache("document-type", 300), async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.documentType")
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ADD
router.post("/", async (req, res) => {
  const { code, name, description, module, status, remarks } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("code",        sql.NVarChar, code || null)
      .input("name",        sql.NVarChar, name || null)
      .input("description", sql.NVarChar, description || null)
      .input("module",      sql.NVarChar, module || null)
      .input("status",      sql.NVarChar, status || null)
      .input("remarks",     sql.NVarChar, remarks || null)
      .input("created_by",  sql.Int,      1)
      .input("created_at",  sql.DateTime, new Date())
      .input("updated_by",  sql.Int,      null)
      .input("updated_at",  sql.DateTime, null)
      .query(`
        INSERT INTO dbo.documentType
          (code, name, description, module, status, remarks, created_by, created_at, updated_by, updated_at)
        VALUES
          (@code, @name, @description, @module, @status, @remarks, @created_by, @created_at, @updated_by, @updated_at)
      `)
    await bumpCacheVersion("document-type");

    res.json({ message: "Document type added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { code, name, description, module, status, remarks } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("id",          sql.Int,      id)
      .input("code",        sql.NVarChar, code || null)
      .input("name",        sql.NVarChar, name || null)
      .input("description", sql.NVarChar, description || null)
      .input("module",      sql.NVarChar, module || null)
      .input("status",      sql.NVarChar, status || null)
      .input("remarks",     sql.NVarChar, remarks || null)
      .input("updated_by",  sql.Int,      1)
      .input("updated_at",  sql.DateTime, new Date())
      .query(`
        UPDATE dbo.documentType SET
          code=@code, name=@name, description=@description,
          module=@module, status=@status, remarks=@remarks,
          updated_by=@updated_by, updated_at=@updated_at
        WHERE id=@id
      `)
    await bumpCacheVersion("document-type");

    res.json({ message: "Document type updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = getPool()
    await pool.request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.documentType WHERE id=@id")
    await bumpCacheVersion("document-type");

    res.json({ message: "Document type deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router