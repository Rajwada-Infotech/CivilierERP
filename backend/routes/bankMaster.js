const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// ====================== HELPER FUNCTIONS ======================
const cleanIfsc = (value) => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim().toUpperCase();
};

const cleanAccountType = (value) => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim();
};

// ====================== ROUTES ======================

// GET ALL
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.BankMaster ORDER BY BId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET BANK ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch banks", message: err.message });
  }
});

// CREATE BANK
router.post("/", async (req, res) => {
  let {
    BName,
    BBranch,
    BAccountNumber,
    BIfscCode,
    BAccountType,
    BBankType,
    BAccountHolderName,
    BOpeningBalance = 0,
    BAddress,
    BStatus = true,
    CompanyName,
  } = req.body;

  if (!BName?.trim() || !BAccountNumber?.trim()) {
    return res.status(400).json({
      error: "BName and BAccountNumber are required",
    });
  }

  // === Cleaning ===
  const cleanedIfsc = cleanIfsc(BIfscCode);
  const cleanedAccountType = cleanAccountType(BAccountType);

  try {
    const pool = await getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    const result = await pool
      .request()
      .input("BName", sql.NVarChar(255), BName.trim())
      .input("BBranch", sql.NVarChar(255), BBranch?.trim() || null)
      .input("BAccountNumber", sql.NVarChar(50), BAccountNumber.trim())
      .input("BIfscCode", sql.NVarChar(20), cleanedIfsc)
      .input("BAccountType", sql.NVarChar(50), cleanedAccountType)
      .input("BBankType", sql.NVarChar(50), BBankType?.trim() || null)
      .input(
        "BAccountHolderName",
        sql.NVarChar(255),
        BAccountHolderName?.trim() || null,
      )
      .input(
        "BOpeningBalance",
        sql.Decimal(18, 2),
        Number(BOpeningBalance) || 0,
      )
      .input("BAddress", sql.NVarChar(500), BAddress?.trim() || null)
      .input("BStatus", sql.Bit, Boolean(BStatus))
      .input("CompanyName", sql.NVarChar(255), CompanyName?.trim() || null)
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

    if (err.number === 547) {
      const msg = err.originalError?.info?.message || "";
      if (msg.includes("CHK_Bank_IFSC")) {
        return res.status(400).json({
          error: "Invalid IFSC Code",
          message: "IFSC must be a valid 11-character code or left empty.",
        });
      }
      if (msg.includes("CHK_Bank_AccountType")) {
        return res.status(400).json({
          error: "Invalid Account Type",
          message: "Please select a valid Account Type from the list.",
        });
      }
    }

    res.status(500).json({
      error: "Failed to create bank master",
      message: err.message,
    });
  }
});

// UPDATE BANK
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  let { BName, BIfscCode, BAccountType, BStatus, BAddress, ...rest } = req.body;

  const cleanedIfsc = cleanIfsc(BIfscCode);
  const cleanedAccountType = cleanAccountType(BAccountType);

  try {
    const pool = await getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    await pool
      .request()
      .input("BId", sql.Int, parseInt(id))
      .input("BName", sql.NVarChar(255), BName?.trim() || null)
      .input("BIfscCode", sql.NVarChar(20), cleanedIfsc)
      .input("BAccountType", sql.NVarChar(50), cleanedAccountType)
      .input(
        "BStatus",
        sql.Bit,
        BStatus !== undefined ? Boolean(BStatus) : null,
      )
      .input("BAddress", sql.NVarChar(500), BAddress?.trim() || null)
      .input("UpdatedBy", sql.Int, userId).query(`
        UPDATE dbo.BankMaster
        SET
          BName = COALESCE(@BName, BName),
          BIfscCode = COALESCE(@BIfscCode, BIfscCode),
          BAccountType = COALESCE(@BAccountType, BAccountType),
          BStatus = COALESCE(@BStatus, BStatus),
          BAddress = COALESCE(@BAddress, BAddress),
          UpdatedBy = @UpdatedBy,
          UpdatedAt = GETDATE()
        WHERE BId = @BId
      `);

    res.json({ success: true, message: "Bank updated successfully" });
  } catch (err) {
    console.error("UPDATE BANK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("BId", sql.Int, parseInt(req.params.id))
      .query(`DELETE FROM dbo.BankMaster WHERE BId = @BId`);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE BANK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
