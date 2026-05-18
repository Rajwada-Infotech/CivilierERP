// routes/applicants.js
const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../db");

// GET /api/applicants
// Fetches all records from AccountHeadMaster where LHeadType = 'A'
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { search, status, city } = req.query;

    let query = `
      SELECT
        AHM.LHeadCode,
        AHM.LHeadName,
        AHM.LHeadAlias,
        AHM.LHeadType,
        AHM.LHeadStatus,
        AHM.Address1,
        AHM.Address2,
        AHM.City,
        AHM.State,
        AHM.PinCode,
        AHM.Phone1,
        AHM.Phone2,
        AHM.Mobile,
        AHM.Email,
        AHM.GSTNo,
        AHM.PANNo,
        AHM.OpeningBalance,
        AHM.CreditLimit,
        AHM.CreditDays,
        AHM.CreatedDate,
        AHM.ModifiedDate
      FROM AccountHeadMaster AHM
      WHERE AHM.LHeadType = 'A'
    `;

    const request = pool.request();

    if (search) {
      query += ` AND (
        AHM.LHeadName LIKE @search OR
        AHM.LHeadCode LIKE @search OR
        AHM.Mobile LIKE @search OR
        AHM.Email LIKE @search OR
        AHM.GSTNo LIKE @search OR
        AHM.City LIKE @search
      )`;
      request.input("search", sql.NVarChar, `%${search}%`);
    }

    if (status) {
      query += ` AND AHM.LHeadStatus = @status`;
      request.input("status", sql.NVarChar, status);
    }

    if (city) {
      query += ` AND AHM.City = @city`;
      request.input("city", sql.NVarChar, city);
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
    const pool = await poolPromise;
    const { code } = req.params;

    const result = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query(
        `SELECT * FROM AccountHeadMaster WHERE LHeadCode = @code AND LHeadType = 'A'`,
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
