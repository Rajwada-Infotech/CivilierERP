const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")

router.get("/", async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query("SELECT * FROM dbo.AccountGroup")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("Name",          sql.NVarChar,  Name || null)
      .input("Code",          sql.NVarChar,  Code || null)
      .input("ParentGroupId", sql.Int,       ParentGroupId || null)
      .input("Status",        sql.Bit,       Status ? 1 : 0)
      .input("CreatedBy",     sql.Int,       1)
      .input("CreatedAt",     sql.DateTime2, new Date())
      .query(`
        INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @ParentGroupId, @Status, @CreatedBy, @CreatedAt)
      `)
    res.json({ message: "Account group added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("AGId",          sql.Int,       req.params.id)
      .input("Name",          sql.NVarChar,  Name || null)
      .input("Code",          sql.NVarChar,  Code || null)
      .input("ParentGroupId", sql.Int,       ParentGroupId || null)
      .input("Status",        sql.Bit,       Status ? 1 : 0)
      .input("UpdatedBy",     sql.Int,       1)
      .input("UpdatedAt",     sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.AccountGroup SET
          Name=@Name, Code=@Code, ParentGroupId=@ParentGroupId,
          Status=@Status, UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE AGId=@AGId
      `)
    res.json({ message: "Account group updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("AGId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.AccountGroup WHERE AGId=@AGId")
    res.json({ message: "Account group deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router