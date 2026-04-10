const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all ledger heads
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    let query = `SELECT
        lh.LHeadId, lh.LHeadName, lh.LHeadCode, lh.LHeadType, lh.LHeadPhone, lh.LHeadEmail,
        lh.LHeadAddress, lh.LHeadContactPerson, lh.LHeadStatus, lh.LHeadPaymentTerms,
        lh.LBranchName, lh.LGST, lh.LGSTState, lh.LCountry, lh.LBelongsTo,
        lh.LDescription, lh.isEdited,
        ag.Name  AS GroupName,
        ag.ParentGroupId,
        parent.Name AS ParentGroupName
       FROM dbo.AccountHeadMaster lh
       LEFT JOIN dbo.AccountGroup ag     ON ag.AGId     = lh.LBelongsTo
       LEFT JOIN dbo.AccountGroup parent ON parent.AGId = ag.ParentGroupId`;
    const request = pool.request();
    if (req.query.type) {
      query += ` WHERE lh.LHeadType = @type`;
      request.input("type", sql.VarChar(50), req.query.type);
    }
    const result = await request.query(query);
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
    LHeadCode,
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
    LHeadType,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("LHeadName", sql.NVarChar(200), LHeadName)
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || "N/A")
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
      .input("LHeadType", sql.VarChar(50), LHeadType || "GL")
      .input("CreatedBy", sql.Int, 1)
      .input("CreatedAt", sql.DateTime, new Date()).query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadCode, LHeadPhone, LHeadEmail, LHeadAddress,
          LHeadContactPerson, LHeadStatus, LHeadPaymentTerms, LBranchName,
          LGST, LGSTState, LCountry, LBelongsTo, LDescription,
          LHeadType, CreatedBy, CreatedAt
        ) VALUES (
          @LHeadName, @LHeadCode, @LHeadPhone, @LHeadEmail, @LHeadAddress,
          @LHeadContactPerson, @LHeadStatus, @LHeadPaymentTerms, @LBranchName,
          @LGST, @LGSTState, @LCountry, @LBelongsTo, @LDescription,
          @LHeadType, @CreatedBy, @CreatedAt
        )
      `);
    res.json({ message: "Ledger head added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET id+name for FK dropdowns
// IMPORTANT: declared before /:id so Express doesn't treat "options" as a record id
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    let query =
      "SELECT LHeadId AS id, LHeadName AS label FROM dbo.AccountHeadMaster WHERE LHeadStatus = 1";
    const request = pool.request();
    if (req.query.type) {
      query += " AND LHeadType = @type";
      request.input("type", sql.VarChar(50), req.query.type);
    }
    query += " ORDER BY LHeadName";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ledger head
router.put("/:id", async (req, res) => {
  const {
    LHeadName,
    LHeadCode,
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
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
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
          LHeadCode          = @LHeadCode,
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
