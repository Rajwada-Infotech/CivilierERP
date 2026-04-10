const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all banks
router.get("/", cache("bank-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      `SELECT BId, BName, BBranch, BAccountNumber, BIfscCode,
              BAccountType, BBankType, BAccountHolderName,
              BOpeningBalance, BAddress, BStatus
       FROM dbo.BankMaster`,
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD bank
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
  const userId = req.user?.id || req.user?.userId || 1;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("BName", sql.NVarChar(150), BName || null)
      .input("BBranch", sql.NVarChar(150), BBranch || null)
      .input("BAccountNumber", sql.NVarChar(50), BAccountNumber || null)
      .input("BIfscCode", sql.NVarChar(20), BIfscCode || null)
      .input("BAccountType", sql.NVarChar(50), BAccountType || null)
      .input("BBankType", sql.NVarChar(50), BBankType || null)
      .input(
        "BAccountHolderName",
        sql.NVarChar(150),
        BAccountHolderName || null,
      )
      .input("BOpeningBalance", sql.Decimal(18, 2), BOpeningBalance || 0)
      .input("BAddress", sql.NVarChar(255), BAddress || null)
      .input("BStatus", sql.Bit, BStatus ? 1 : 0)
      .input("CompanyName", sql.NVarChar(150), CompanyName || "")
      .input("CreatedBy", sql.Int, userId)
      .input("UpdatedBy", sql.Int, userId)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.BankMaster (
          BName, BBranch, BAccountNumber, BIfscCode, BAccountType,
          BBankType, BAccountHolderName, BOpeningBalance, BAddress,
          BStatus, CompanyName, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt
        ) VALUES (
          @BName, @BBranch, @BAccountNumber, @BIfscCode, @BAccountType,
          @BBankType, @BAccountHolderName, @BOpeningBalance, @BAddress,
          @BStatus, @CompanyName, @CreatedBy, @UpdatedBy, @CreatedAt, @UpdatedAt
        )
      `);
    await redisDelPattern("cache:bank-master:*");

    res.json({ message: "Bank added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE bank
router.put("/:id", async (req, res) => {
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
  const userId = req.user?.id || req.user?.userId || 1;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("BId", sql.Int, parseInt(req.params.id))
      .input("BName", sql.NVarChar(150), BName || null)
      .input("BBranch", sql.NVarChar(150), BBranch || null)
      .input("BAccountNumber", sql.NVarChar(50), BAccountNumber || null)
      .input("BIfscCode", sql.NVarChar(20), BIfscCode || null)
      .input("BAccountType", sql.NVarChar(50), BAccountType || null)
      .input("BBankType", sql.NVarChar(50), BBankType || null)
      .input(
        "BAccountHolderName",
        sql.NVarChar(150),
        BAccountHolderName || null,
      )
      .input("BOpeningBalance", sql.Decimal(18, 2), BOpeningBalance || 0)
      .input("BAddress", sql.NVarChar(255), BAddress || null)
      .input("BStatus", sql.Bit, BStatus ? 1 : 0)
      .input("CompanyName", sql.NVarChar(150), CompanyName || "")
      .input("UpdatedBy", sql.Int, userId)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.BankMaster SET
          BName              = @BName,
          BBranch            = @BBranch,
          BAccountNumber     = @BAccountNumber,
          BIfscCode          = @BIfscCode,
          BAccountType       = @BAccountType,
          BBankType          = @BBankType,
          BAccountHolderName = @BAccountHolderName,
          BOpeningBalance    = @BOpeningBalance,
          BAddress           = @BAddress,
          BStatus            = @BStatus,
          CompanyName        = @CompanyName,
          UpdatedBy          = @UpdatedBy,
          UpdatedAt          = @UpdatedAt
        WHERE BId = @BId
      `);
    await redisDelPattern("cache:bank-master:*");

    res.json({ message: "Bank updated successfully" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE bank
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("BId", sql.Int, parseInt(req.params.id))
      .query("DELETE FROM dbo.BankMaster WHERE BId = @BId");
    await redisDelPattern("cache:bank-master:*");

    res.json({ message: "Bank deleted successfully" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
