const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")

router.get("/", async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.request().query(
      `SELECT LHeadId, LHeadName, LHeadType, LHeadPhone, LHeadEmail, 
       LHeadStatus, LGST, LGSTState, LCountry, LBelongsTo, LDescription 
       FROM dbo.AccountHeadMaster`
    )
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const {
    LHeadName, LHeadPhone, LHeadEmail, LHeadAddress, LHeadType,
    LHeadContactPerson, LHeadStatus, LHeadPaymentTerms,
    LBranchName, LGST, LGSTState, LCountry, LBelongsTo, LDescription
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("LHeadName",          sql.NVarChar, LHeadName)
      .input("LHeadPhone",         sql.NVarChar, LHeadPhone  || "0000000000")
      .input("LHeadEmail",         sql.NVarChar, LHeadEmail  || `ledger-${Date.now()}@civilier.local`)
      .input("LHeadAddress",       sql.NVarChar, LHeadAddress || "N/A")
      .input("LHeadType",          sql.NVarChar, LHeadType   || null)
      .input("LHeadContactPerson", sql.NVarChar, LHeadContactPerson || "N/A")
      .input("LHeadStatus",        sql.Int,      LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms",  sql.NVarChar, LHeadPaymentTerms  || "N/A")
      .input("LBranchName",        sql.NVarChar, LBranchName || "Main")
      .input("LGST",               sql.NVarChar, LGST        || null)
      .input("LGSTState",          sql.NVarChar, LGSTState   || null)
      .input("LCountry",           sql.NVarChar, LCountry    || "India")
      .input("LBelongsTo",         sql.NVarChar, LBelongsTo  || null)
      .input("LDescription",       sql.NVarChar, LDescription || null)
      .query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadPhone, LHeadEmail, LHeadAddress, LHeadType,
          LHeadContactPerson, LHeadStatus, LHeadPaymentTerms, LBranchName,
          CreatedBy, LGST, LGSTState, LCountry, LBelongsTo, LDescription
        ) VALUES (
          @LHeadName, @LHeadPhone, @LHeadEmail, @LHeadAddress, @LHeadType,
          @LHeadContactPerson, @LHeadStatus, @LHeadPaymentTerms, @LBranchName,
          1, @LGST, @LGSTState, @LCountry, @LBelongsTo, @LDescription
        )
      `)
    res.json({ message: "Ledger added successfully" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const {
    LHeadName, LHeadType, LGST, LGSTState,
    LBelongsTo, LDescription
  } = req.body
  try {
    const pool = getPool()
    await pool.request()
      .input("id",           sql.Int,      req.params.id)
      .input("LHeadName",    sql.NVarChar, LHeadName    || null)
      .input("LHeadType",    sql.NVarChar, LHeadType    || null)
      .input("LGST",         sql.NVarChar, LGST         || null)
      .input("LGSTState",    sql.NVarChar, LGSTState    || null)
      .input("LBelongsTo",   sql.NVarChar, LBelongsTo   || null)
      .input("LDescription", sql.NVarChar, LDescription || null)
      .query(`
        UPDATE dbo.AccountHeadMaster SET
          LHeadName=@LHeadName, LHeadType=@LHeadType,
          LGST=@LGST, LGSTState=@LGSTState,
          LBelongsTo=@LBelongsTo, LDescription=@LDescription,
          isEdited=1
        WHERE LHeadId=@id
      `)
    res.json({ message: "Ledger updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool()
    await pool.request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId=@id")
    res.json({ message: "Ledger deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router