const express = require("express")
const router = express.Router()
const { sql } = require("../db")

// GET all account groups
router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query(
      "SELECT LHeadId, LHeadName, LHeadType, LHeadPhone, LHeadEmail, LHeadStatus, LGST, LGSTState, LCountry FROM dbo.AccountHeadMaster"
    )
    res.json(result.recordset)
  } catch (err) {
    console.error("GET ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// ADD account group
router.post("/", async (req, res) => {
  console.log("POST BODY:", req.body)

  const {
    LHeadName,
    LHeadType,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LHeadStatus,
  } = req.body

  console.log("EMAIL USED:", LHeadEmail)

  try {
    const pool = await sql.connect()
    await pool
      .request()
      .input("LHeadName", sql.NVarChar, LHeadName)
      .input("LHeadPhone", sql.NVarChar, LHeadPhone || "0000000000")
      .input("LHeadEmail", sql.NVarChar, LHeadEmail)
      .input("LHeadAddress", sql.NVarChar, LHeadAddress || "N/A")
      .input("LHeadType", sql.NVarChar, LHeadType)
      .input("LHeadContactPerson", sql.NVarChar, LHeadContactPerson || "N/A")
      .input("LHeadStatus", sql.Int, LHeadStatus ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar, LHeadPaymentTerms || "N/A")
      .input("LBranchName", sql.NVarChar, LBranchName || "Main")
      .input("CreatedBy", sql.Int, 1)
      .input("LGST", sql.NVarChar, LGST || null)
      .input("LGSTState", sql.NVarChar, LGSTState || null)
      .input("LCountry", sql.NVarChar, LCountry || "India")
      .query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadPhone, LHeadEmail, LHeadAddress,
          LHeadType, LHeadContactPerson, LHeadStatus,
          LHeadPaymentTerms, LBranchName, CreatedBy,
          LGST, LGSTState, LCountry
        ) VALUES (
          @LHeadName, @LHeadPhone, @LHeadEmail, @LHeadAddress,
          @LHeadType, @LHeadContactPerson, @LHeadStatus,
          @LHeadPaymentTerms, @LBranchName, @CreatedBy,
          @LGST, @LGSTState, @LCountry
        )
      `)

    res.json({ message: "Account group added successfully" })
  } catch (err) {
    console.error("INSERT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// UPDATE account group
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const {
    LHeadName,
    LHeadType,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadStatus,
    LGST,
    LGSTState,
    LCountry,
  } = req.body

  try {
    const pool = await sql.connect()
    await pool
      .request()
      .input("LHeadId", sql.Int, id)
      .input("LHeadName", sql.NVarChar, LHeadName)
      .input("LHeadType", sql.NVarChar, LHeadType)
      .input("LHeadPhone", sql.NVarChar, LHeadPhone || "0000000000")
      .input("LHeadEmail", sql.NVarChar, LHeadEmail)
      .input("LHeadAddress", sql.NVarChar, LHeadAddress || "N/A")
      .input("LHeadStatus", sql.Int, LHeadStatus ? 1 : 0)
      .input("LGST", sql.NVarChar, LGST || null)
      .input("LGSTState", sql.NVarChar, LGSTState || null)
      .input("LCountry", sql.NVarChar, LCountry || "India")
      .query(`
        UPDATE dbo.AccountHeadMaster SET
          LHeadName = @LHeadName,
          LHeadType = @LHeadType,
          LHeadPhone = @LHeadPhone,
          LHeadEmail = @LHeadEmail,
          LHeadAddress = @LHeadAddress,
          LHeadStatus = @LHeadStatus,
          LGST = @LGST,
          LGSTState = @LGSTState,
          LCountry = @LCountry,
          isEdited = 1
        WHERE LHeadId = @LHeadId
      `)

    res.json({ message: "Account group updated successfully" })
  } catch (err) {
    console.error("UPDATE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE account group
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = await sql.connect()
    await pool
      .request()
      .input("LHeadId", sql.Int, id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @LHeadId")

    res.json({ message: "Account group deleted successfully" })
  } catch (err) {
    console.error("DELETE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router