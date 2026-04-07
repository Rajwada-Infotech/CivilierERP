const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all ledger heads
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      `SELECT
        lh.LHeadId, lh.LHeadName, lh.LHeadType, lh.LHeadPhone, lh.LHeadEmail,
        lh.LHeadAddress, lh.LHeadContactPerson, lh.LHeadStatus, lh.LHeadPaymentTerms,
        lh.LBranchName, lh.LGST, lh.LGSTState, lh.LCountry, lh.LBelongsTo,
        lh.LDescription, lh.isEdited,
        ag.Name AS GroupName
       FROM dbo.AccountHeadMaster lh
       LEFT JOIN dbo.AccountGroup ag ON ag.AGId = lh.LBelongsTo`,
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD ledger head
router.post("/", async (req, res) => {
  const {
    LHeadName,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadType,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("LHeadName", sql.NVarChar(200), LHeadName)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || "0000000000")
      .input(
        "LHeadEmail",
        sql.NVarChar(100),
        LHeadEmail || `ledger-${Date.now()}@civilier.local`,
      )
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || "N/A")
      .input("LHeadType", sql.VarChar(50), LHeadType || null)
      .input(
        "LHeadContactPerson",
        sql.VarChar(100),
        LHeadContactPerson || "N/A",
      )
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || "N/A")
      .input("LBranchName", sql.VarChar(100), LBranchName || "Main")
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || "India")
      .input("LBelongsTo", sql.Int, LBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null)
      .input("CreatedBy", sql.Int, 1)
      .input("CreatedAt", sql.DateTime, new Date()).query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadPhone, LHeadEmail, LHeadAddress, LHeadType,
          LHeadContactPerson, LHeadStatus, LHeadPaymentTerms, LBranchName,
          LGST, LGSTState, LCountry, LBelongsTo, LDescription,
          CreatedBy, CreatedAt
        ) VALUES (
          @LHeadName, @LHeadPhone, @LHeadEmail, @LHeadAddress, @LHeadType,
          @LHeadContactPerson, @LHeadStatus, @LHeadPaymentTerms, @LBranchName,
          @LGST, @LGSTState, @LCountry, @LBelongsTo, @LDescription,
          @CreatedBy, @CreatedAt
        )
      `);
    res.json({ message: "Ledger head added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET id+name for FK dropdowns (used by DebitNote supplier field)
// IMPORTANT: must be declared before /:id so Express does not treat "options" as a record id
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query(
        "SELECT LHeadId AS id, LHeadName AS label FROM dbo.AccountHeadMaster WHERE LHeadStatus = 1 ORDER BY LHeadName",
      );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ledger head
router.put("/:id", async (req, res) => {
  const {
    LHeadName,
    LHeadType,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("LHeadName", sql.NVarChar(200), LHeadName || null)
      .input("LHeadType", sql.VarChar(50), LHeadType || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || null)
      .input("LHeadContactPerson", sql.VarChar(100), LHeadContactPerson || null)
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || null)
      .input("LBranchName", sql.VarChar(100), LBranchName || null)
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || null)
      .input("LBelongsTo", sql.Int, LBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null).query(`
        UPDATE dbo.AccountHeadMaster SET
          LHeadName          = @LHeadName,
          LHeadType          = @LHeadType,
          LHeadPhone         = @LHeadPhone,
          LHeadEmail         = @LHeadEmail,
          LHeadAddress       = @LHeadAddress,
          LHeadContactPerson = @LHeadContactPerson,
          LHeadStatus        = @LHeadStatus,
          LHeadPaymentTerms  = @LHeadPaymentTerms,
          LBranchName        = @LBranchName,
          LGST               = @LGST,
          LGSTState          = @LGSTState,
          LCountry           = @LCountry,
          LBelongsTo         = @LBelongsTo,
          LDescription       = @LDescription,
          isEdited           = 1
        WHERE LHeadId = @id
      `);
    res.json({ message: "Ledger head updated" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE ledger head
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @id");
    res.json({ message: "Ledger head deleted" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
