const express = require("express")
const router = express.Router()
const { sql } = require("../db")

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query("SELECT * FROM dbo.Entry_Type")
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ADD
router.post("/", async (req, res) => {
  const { Epname, EntryType, Eprefix, EDoc_N } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("Epname",    sql.NVarChar, Epname || null)
      .input("EntryType", sql.NVarChar, EntryType || null)
      .input("Eprefix",   sql.NVarChar, Eprefix || null)
      .input("EDoc_N",    sql.Int,      EDoc_N || 1)
      .input("E_CreatedBy", sql.UniqueIdentifier, "00000000-0000-0000-0000-000000000001")
      .input("E_CreatedAt", sql.DateTime2,        new Date())
      .query(`
        INSERT INTO dbo.Entry_Type
          (Epname, EntryType, Eprefix, EDoc_N, E_CreatedBy, E_CreatedAt)
        VALUES
          (@Epname, @EntryType, @Eprefix, @EDoc_N, @E_CreatedBy, @E_CreatedAt)
      `)
    res.json({ message: "Entry type added successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { Epname, EntryType, Eprefix, EDoc_N } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("E_Id",      sql.UniqueIdentifier, id)
      .input("Epname",    sql.NVarChar,         Epname || null)
      .input("EntryType", sql.NVarChar,         EntryType || null)
      .input("Eprefix",   sql.NVarChar,         Eprefix || null)
      .input("EDoc_N",    sql.Int,              EDoc_N || 1)
      .query(`
        UPDATE dbo.Entry_Type SET
          Epname=@Epname, EntryType=@EntryType,
          Eprefix=@Eprefix, EDoc_N=@EDoc_N
        WHERE E_Id=@E_Id
      `)
    res.json({ message: "Entry type updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("E_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Entry_Type WHERE E_Id=@E_Id")
    res.json({ message: "Entry type deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router