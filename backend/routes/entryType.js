const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all
router.get("/", cache("entry-type", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query("SELECT * FROM dbo.Entry_Type");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD
router.post("/", async (req, res) => {
  const { Epname, EntryType, Eprefix, EDoc_N } = req.body;
  // Fix: E_CreatedBy was set to NEWID() inline in the SQL — NEWID() returns a UUID
  // but E_CreatedBy is an INT column (consistent with every other CreatedBy in the codebase).
  // This caused a type mismatch error on every insert. Use the authenticated user's ID instead.
  const createdBy = req.user?.userId || req.user?.id || 1;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Epname", sql.NVarChar, Epname || null)
      .input("EntryType", sql.NVarChar, EntryType || null)
      .input("Eprefix", sql.NVarChar, Eprefix || null)
      .input("EDoc_N", sql.Int, EDoc_N || 1)
      .input("E_CreatedBy", sql.Int, createdBy)
      .input("E_CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.Entry_Type
          (Epname, EntryType, Eprefix, EDoc_N, E_CreatedBy, E_CreatedAt)
        VALUES
          (@Epname, @EntryType, @Eprefix, @EDoc_N, @E_CreatedBy, @E_CreatedAt)
      `);
    await redisDelPattern("cache:entry-type:*");
    res.json({ message: "Entry type added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { Epname, EntryType, Eprefix, EDoc_N } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("E_Id", sql.UniqueIdentifier, id)
      .input("Epname", sql.NVarChar, Epname || null)
      .input("EntryType", sql.NVarChar, EntryType || null)
      .input("Eprefix", sql.NVarChar, Eprefix || null)
      .input("EDoc_N", sql.Int, EDoc_N || 1).query(`
        UPDATE dbo.Entry_Type SET
          Epname=@Epname, EntryType=@EntryType,
          Eprefix=@Eprefix, EDoc_N=@EDoc_N
        WHERE E_Id=@E_Id
      `);
    await redisDelPattern("cache:entry-type:*");
    res.json({ message: "Entry type updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("E_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Entry_Type WHERE E_Id=@E_Id");
    await redisDelPattern("cache:entry-type:*");
    res.json({ message: "Entry type deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
