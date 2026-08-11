const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

router.get("/", cache("tds-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    // GLHeadId alone isn't enough for the frontend to show which ledger a
    // record is linked to without a second round-trip — join the head's own
    // name/code in directly, same pattern as every other *Name convenience
    // column already returned elsewhere in this codebase.
    const result = await pool.request().query(`
      SELECT tm.*, ahm.LHeadName AS GLHeadName, ahm.LHeadCode AS GLHeadCode
      FROM dbo.TDSMaster tm
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = tm.GLHeadId
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("tds-master", "create"), async (req, res) => {
  const { Nature, Name, Percentage, Status, GLHeadId } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Nature", sql.NVarChar, Nature || null)
      .input("Name", sql.NVarChar, Name || null)
      .input("Percentage", sql.Decimal(5, 2), Percentage ?? null)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("GLHeadId", sql.Int, GLHeadId || null)
      .input("CreatedAt", sql.DateTime, new Date()).query(`
        INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, GLHeadId, CreatedAt)
        VALUES (@Nature, @Name, @Percentage, @Status, @GLHeadId, @CreatedAt)
      `);
    await bumpCacheVersion("tds-master");

    res.json({ message: "TDS added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("tds-master", "edit"), async (req, res) => {
  const { Nature, Name, Percentage, Status, GLHeadId } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("TDSId", sql.Int, req.params.id)
      .input("Nature", sql.NVarChar, Nature || null)
      .input("Name", sql.NVarChar, Name || null)
      .input("Percentage", sql.Decimal(5, 2), Percentage ?? null)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("GLHeadId", sql.Int, GLHeadId || null)
      .input("UpdatedAt", sql.DateTime, new Date()).query(`
        UPDATE dbo.TDSMaster SET
          Nature=@Nature, Name=@Name, Percentage=@Percentage,
          Status=@Status, GLHeadId=@GLHeadId, UpdatedAt=@UpdatedAt
        WHERE TDSId=@TDSId
      `);
    await bumpCacheVersion("tds-master");

    res.json({ message: "TDS updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("tds-master", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("TDSId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.TDSMaster WHERE TDSId=@TDSId");
    await bumpCacheVersion("tds-master");

    res.json({ message: "TDS deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




