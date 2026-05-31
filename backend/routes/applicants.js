// routes/applicants.js
const express = require("express");
const { getPool, sql } = require("../db");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// GET /api/applicants
// Fetches all records from AccountHeadMaster where LHeadType = 'A'
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const { search, status } = req.query;

    let query = `
      SELECT
        AHM.LHeadId,
        AHM.LHeadCode,
        AHM.LHeadName,
        AHM.LHeadType,
        AHM.LHeadStatus,
        AHM.LHeadPhone,
        AHM.LHeadEmail,
        AHM.LHeadAddress,
        AHM.LHeadContactPerson,
        AHM.LHeadPaymentTerms,
        AHM.LGST,
        AHM.LGSTState,
        AHM.LCountry,
        AHM.LBelongsTo,
        AHM.LDescription,
        AHM.LBranchName
      FROM dbo.AccountHeadMaster AHM
      WHERE AHM.LHeadType = 'A'
    `;

    const request = pool.request();

    if (search) {
      query += ` AND (
        AHM.LHeadName LIKE @search OR
        AHM.LHeadCode LIKE @search OR
        AHM.LHeadPhone LIKE @search OR
        AHM.LHeadEmail LIKE @search OR
        AHM.LGST LIKE @search OR
        AHM.LHeadAddress LIKE @search
      )`;
      request.input("search", sql.NVarChar, `%${search}%`);
    }

    if (status !== undefined && status !== "") {
      query += ` AND AHM.LHeadStatus = @status`;
      request.input("status", sql.Bit, status === "1" ? 1 : 0);
    }

    query += ` ORDER BY AHM.LHeadName ASC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("Error fetching applicants:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/applicants/:code — single applicant detail
router.get("/:code", async (req, res) => {
  try {
    const pool = getPool();
    const { code } = req.params;

    const result = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query(
        `SELECT * FROM dbo.AccountHeadMaster WHERE LHeadCode = @code AND LHeadType = 'A'`,
      );

    if (!result.recordset.length) {
      return res
        .status(404)
        .json({ success: false, message: "Applicant not found" });
    }

    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error("Error fetching applicant:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

