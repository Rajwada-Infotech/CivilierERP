const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

router.get("/", cache("billing-terms", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query("SELECT * FROM dbo.Billing_Terms_Master ORDER BY Name");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("billing-terms", "create"), async (req, res) => {
  const { Name, Description, CalculationType, DeductionType, IsActive } =
    req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(200), Name || null)
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("CalculationType", sql.NVarChar(20), CalculationType || null)
      .input("DeductionType", sql.NVarChar(20), DeductionType || null)
      .input("IsActive", sql.Bit, IsActive ? 1 : 0)
      .input("CreatedBy", sql.Int, req.user?.userId || null)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.Billing_Terms_Master
          (Name, Description, CalculationType, DeductionType, IsActive, CreatedBy, CreatedAt)
        VALUES
          (@Name, @Description, @CalculationType, @DeductionType, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("billing-terms");
    res.json({ message: "Billing term added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("billing-terms", "edit"), async (req, res) => {
  const { Name, Description, CalculationType, DeductionType, IsActive } =
    req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("BillingTermID", sql.Int, parseInt(req.params.id, 10))
      .input("Name", sql.NVarChar(200), Name || null)
      .input("Description", sql.NVarChar(sql.MAX), Description || null)
      .input("CalculationType", sql.NVarChar(20), CalculationType || null)
      .input("DeductionType", sql.NVarChar(20), DeductionType || null)
      .input("IsActive", sql.Bit, IsActive ? 1 : 0)
      .input("UpdatedBy", sql.Int, req.user?.userId || null)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.Billing_Terms_Master
        SET
          Name = @Name,
          Description = @Description,
          CalculationType = @CalculationType,
          DeductionType = @DeductionType,
          IsActive = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE BillingTermID = @BillingTermID
      `);
    await bumpCacheVersion("billing-terms");
    res.json({ message: "Billing term updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("billing-terms", "delete"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    const delResult = await pool
      .request()
      .input("BillingTermID", sql.Int, id)
      .query(
        "DELETE FROM dbo.Billing_Terms_Master WHERE BillingTermID = @BillingTermID",
      );
    if (delResult.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Billing term not found" });
    await bumpCacheVersion("billing-terms");
    res.json({ message: "Billing term deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;