const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all account heads
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      "SELECT LHeadId, LHeadName, LHeadType, LHeadPhone, LHeadEmail, LHeadStatus, LGST, LGSTState, LCountry FROM dbo.AccountHeadMaster"
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD account head
router.post("/", async (req, res) => {
  console.log("POST BODY:", req.body);
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
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input("LHeadName", sql.NVarChar, LHeadName)
      .input("LHeadPhone", sql.NVarChar, LHeadPhone || "0000000000")
      .input("LHeadEmail", sql.NVarChar, LHeadEmail)
      .input("LHeadAddress", sql.NVarChar, LHeadAddress || "N/A")
      .input("LHeadType", sql.NVarChar, LHeadType)
      .input("LHeadContactPerson", sql.NVarChar, LHeadContactPerson || "N/A")
      .input("LHeadStatus", sql.Int, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar, LHeadPaymentTerms || "N/A")
      .input("LBranchName", sql.NVarChar, LBranchName || "Main")
      .input("LGST", sql.NVarChar, LGST)
      .input("LGSTState", sql.NVarChar, LGSTState)
      .input("LCountry", sql.NVarChar, LCountry || "India")
      .query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadPhone, LHeadEmail, LHeadAddress, LHeadType,
          LHeadContactPerson, LHeadStatus, LHeadPaymentTerms, LBranchName,
          CreatedBy, LGST, LGSTState, LCountry
        ) VALUES (
          @LHeadName, @LHeadPhone, @LHeadEmail, @LHeadAddress, @LHeadType,
          @LHeadContactPerson, @LHeadStatus, @LHeadPaymentTerms, @LBranchName,
          1, @LGST, @LGSTState, @LCountry
        )
      `);
    res.json({ message: "Account head added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE account head
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  console.log("PUT ID:", id, "BODY:", req.body);

  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .input("LHeadName", sql.NVarChar, req.body.LHeadName)
      .input("LHeadType", sql.NVarChar, req.body.LHeadType)
      .input("LGST", sql.NVarChar, req.body.LGST)
      .query(`
        UPDATE dbo.AccountHeadMaster SET
          LHeadName = @LHeadName,
          LHeadType = @LHeadType,
          LGST = @LGST,
          isEdited = 1
        WHERE LHeadId = @id
      `);
    res.json({ message: "Account head updated" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE account head
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  console.log("DELETE ID:", id);

  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @id");
    res.json({ message: "Account head deleted" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
