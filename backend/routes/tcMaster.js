const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

// GET all T&C records
router.get("/", cache("tc-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT t.*,
             ISNULL(u.email,  'Unknown') AS CreatedByEmail,
             ISNULL(u2.email, 'Unknown') AS UpdatedByEmail,
             ISNULL(u3.email, 'Unknown') AS ApprovedByEmail
      FROM dbo.TCMaster t
      LEFT JOIN dbo.users u  ON u.id  = t.CreatedBy
      LEFT JOIN dbo.users u2 ON u2.id = t.UpdatedBy
      LEFT JOIN dbo.users u3 ON u3.id = t.ApprovedBy
      ORDER BY t.Id
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[TCMaster GET]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — create new T&C record
router.post("/", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body;
  const createdBy = req.user?.userId || null;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(100), Name || null)
      .input(
        "TermsAndCondition",
        sql.NVarChar(sql.MAX),
        TermsAndCondition || null,
      )
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("isActive", sql.Bit, isActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedDate", sql.DateTime2(7), new Date()).query(`
        INSERT INTO dbo.TCMaster
          (Name, TermsAndCondition, Remarks, isActive, CreatedBy, CreatedDate)
        VALUES
          (@Name, @TermsAndCondition, @Remarks, @isActive, @CreatedBy, @CreatedDate)
      `);
    await bumpCacheVersion("tc-master");
    res.json({ message: "T&C record added successfully" });
  } catch (err) {
    console.error("[TCMaster POST]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update existing T&C record
router.put("/:id", async (req, res) => {
  const { Name, TermsAndCondition, Remarks, isActive } = req.body;
  const updatedBy = req.user?.userId || null;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .input("Name", sql.NVarChar(100), Name || null)
      .input(
        "TermsAndCondition",
        sql.NVarChar(sql.MAX),
        TermsAndCondition || null,
      )
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("isActive", sql.Bit, isActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedDate", sql.DateTime2(7), new Date()).query(`
        UPDATE dbo.TCMaster SET
          Name              = @Name,
          TermsAndCondition = @TermsAndCondition,
          Remarks           = @Remarks,
          isActive          = @isActive,
          UpdatedBy         = @UpdatedBy,
          UpdatedDate       = @UpdatedDate
        WHERE Id = @Id
      `);
    await bumpCacheVersion("tc-master");
    res.json({ message: "T&C record updated successfully" });
  } catch (err) {
    console.error("[TCMaster PUT]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — remove T&C record
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.TCMaster WHERE Id = @Id");
    await bumpCacheVersion("tc-master");
    res.json({ message: "T&C record deleted successfully" });
  } catch (err) {
    console.error("[TCMaster DELETE]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

