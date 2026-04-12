const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET ALL
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM dbo.BankMaster
      ORDER BY BId DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET BANK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// INSERT
router.post("/", async (req, res) => {
  const {
    BName,
    BBranch,
    BAccountNumber,
    BIfscCode,
    BAccountType,
    BBankType,
    BAccountHolderName,
    BOpeningBalance,
    BAddress,
    BStatus,
    CompanyName,
  } = req.body;

  // validation
  if (!BName || !BAccountNumber) {
    return res.status(400).json({
      error: "BName and BAccountNumber are required",
    });
  }

  try {
    const pool = await getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    const result = await pool
      .request()
      .input("BName", sql.NVarChar, BName)
      .input("BBranch", sql.NVarChar, BBranch || null)
      .input("BAccountNumber", sql.NVarChar, BAccountNumber)
      .input("BIfscCode", sql.NVarChar, BIfscCode || null)
      .input("BAccountType", sql.NVarChar, BAccountType || null)
      .input("BBankType", sql.NVarChar, BBankType || null)
      .input("BAccountHolderName", sql.NVarChar, BAccountHolderName || null)
      .input("BOpeningBalance", sql.Decimal(18, 2), BOpeningBalance ?? 0)
      .input("BAddress", sql.NVarChar, BAddress || null)
      .input("BStatus", sql.Bit, BStatus ?? true)
      .input("CompanyName", sql.NVarChar, CompanyName || null)
      .input("CreatedBy", sql.Int, userId)
      .input("UpdatedBy", sql.Int, userId).query(`
        INSERT INTO dbo.BankMaster (
          BName, BBranch, BAccountNumber, BIfscCode, BAccountType,
          BBankType, BAccountHolderName, BOpeningBalance, BAddress,
          BStatus, CompanyName, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt
        )
        OUTPUT INSERTED.*
        VALUES (
          @BName, @BBranch, @BAccountNumber, @BIfscCode, @BAccountType,
          @BBankType, @BAccountHolderName, @BOpeningBalance, @BAddress,
          @BStatus, @CompanyName, @CreatedBy, @UpdatedBy, GETDATE(), GETDATE()
        )
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error("INSERT BANK ERROR FULL:", err);

    res.status(500).json({
      error: err.message,
      detail: err.originalError?.info || null,
    });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { BName } = req.body;

  if (!BName) {
    return res.status(400).json({
      error: "BName is required",
    });
  }

  try {
    const pool = await getPool();

    await pool
      .request()
      .input("BId", sql.Int, id)
      .input("BName", sql.NVarChar, BName).query(`
        UPDATE dbo.BankMaster
        SET BName = @BName,
            UpdatedAt = GETDATE()
        WHERE BId = @BId
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE BANK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    await pool
      .request()
      .input("BId", sql.Int, id)
      .query(`DELETE FROM dbo.BankMaster WHERE BId = @BId`);

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE BANK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
