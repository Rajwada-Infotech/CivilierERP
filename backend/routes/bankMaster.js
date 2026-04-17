const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");

// ====================== HELPERS ======================
const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const cleanIfsc = (v) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().toUpperCase().slice(0, 11);
};

const validateIfsc = (v) => {
  if (!v) return false;
  return IFSC_REGEX.test(String(v).trim().toUpperCase());
};

const cleanDecimal = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

// ====================== GET ALL BANKS ======================
router.get("/", cache("bank-master", 300), async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input("type", sql.VarChar(50), "B")
      .query(`
        SELECT
          LHeadId AS BId,
          LHeadName AS BName,
          LBranchName AS BBranch,
          LAccountNo AS BAccountNumber,
          LIFSCCode AS BIfscCode,
          LAccountType AS BAccountType,
          LBankType AS BBankType,
          AccountHolderName AS BAccountHolderName,
          BankOpeningBalance AS BOpeningBalance,
          LHeadAddress AS BAddress,
          LHeadStatus AS BStatus,
          LDescription AS BCompanyName,
          LBankDetails AS BBankDetails,
          LHeadCode AS BCode,
          CreatedBy,
          CreatedAt
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = @type
        ORDER BY LHeadId DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET BANK ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch banks", message: err.message });
  }
});

// ====================== CREATE BANK ======================
router.post("/", async (req, res) => {
  const {
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
    BCompanyName,
  } = req.body;

  // Validation
  if (!BName?.trim()) {
    return res.status(400).json({ error: "Bank Name is required" });
  }
  if (!BIfscCode?.trim()) {
    return res.status(400).json({ error: "IFSC Code is required" });
  }
  if (!validateIfsc(BIfscCode)) {
    return res.status(400).json({
      error:
        "Invalid IFSC Code format. Expected format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)",
    });
  }

  try {
    const pool = await getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    const result = await pool
      .request()
      // Core fields
      .input("LHeadName", sql.NVarChar(200), BName.trim())
      .input("LHeadType", sql.VarChar(50), "B")
      .input("LHeadCode", sql.NVarChar(20), null)

      // Bank related fields
      .input(
        "LBranchName",
        sql.VarChar(100),
        cleanStr(BBranch, 100) || "Main Branch",
      )
      .input("LAccountNo", sql.VarChar(20), cleanStr(BAccountNumber, 20))
      .input("LIFSCCode", sql.NVarChar(11), cleanIfsc(BIfscCode))
      .input("LAccountType", sql.NVarChar(50), cleanStr(BAccountType, 50))
      .input("LBankType", sql.NVarChar(50), cleanStr(BBankType, 50))
      .input(
        "AccountHolderName",
        sql.NVarChar(150),
        cleanStr(BAccountHolderName, 150),
      )
      .input(
        "BankOpeningBalance",
        sql.Decimal(18, 2),
        cleanDecimal(BOpeningBalance),
      )
      .input(
        "LHeadAddress",
        sql.NVarChar(300),
        cleanStr(BAddress, 300) || "N/A",
      )

      // Required NOT NULL fields
      .input(
        "LHeadContactPerson",
        sql.NVarChar(100),
        cleanStr(BAccountHolderName, 100) || "System Admin",
      )

      // Critical: Explicit length for NVARCHAR columns to avoid TDS error
      .input("LHeadPhone", sql.NVarChar(15), null) // Allowed NULL now
      .input("LHeadEmail", sql.NVarChar(100), null) // Allowed NULL now

      // Other fields
      .input("LHeadStatus", sql.Bit, Boolean(BStatus) ? 1 : 0)
      .input(
        "LDescription",
        sql.NVarChar(4000),
        cleanStr(BCompanyName, 500) || null,
      )
      .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
      .input("LHeadCreditLimit", sql.Decimal(18, 2), 0)

      // Audit fields
      .input("CreatedBy", sql.Int, userId)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.AccountHeadMaster (
          LHeadName, LHeadType, LHeadCode,
          LBranchName, LAccountNo, LIFSCCode,
          LAccountType, LBankType, AccountHolderName, BankOpeningBalance,
          LHeadAddress, LHeadContactPerson, LHeadPhone, LHeadEmail,
          LHeadStatus, LDescription, LHeadPaymentTerms, LHeadCreditLimit,
          CreatedBy, CreatedAt
        )
        OUTPUT
          INSERTED.LHeadId AS BId,
          INSERTED.LHeadName AS BName,
          INSERTED.LBranchName AS BBranch,
          INSERTED.LAccountNo AS BAccountNumber,
          INSERTED.LIFSCCode AS BIfscCode,
          INSERTED.LAccountType AS BAccountType,
          INSERTED.LBankType AS BBankType,
          INSERTED.AccountHolderName AS BAccountHolderName,
          INSERTED.BankOpeningBalance AS BOpeningBalance,
          INSERTED.LHeadAddress AS BAddress,
          INSERTED.LHeadStatus AS BStatus,
          INSERTED.LDescription AS BCompanyName
        VALUES (
          @LHeadName, @LHeadType, @LHeadCode,
          @LBranchName, @LAccountNo, @LIFSCCode,
          @LAccountType, @LBankType, @AccountHolderName, @BankOpeningBalance,
          @LHeadAddress, @LHeadContactPerson, @LHeadPhone, @LHeadEmail,
          @LHeadStatus, @LDescription, @LHeadPaymentTerms, @LHeadCreditLimit,
          @CreatedBy, @CreatedAt
        )
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error("INSERT BANK ERROR:", err);

    if (err.number === 2627 || err.number === 547) {
      return res.status(400).json({
        error: "Validation failed",
        message: err.originalError?.info?.message || err.message,
      });
    }

    res
      .status(500)
      .json({ error: "Failed to create bank", message: err.message });
  }
});

// ====================== UPDATE BANK ======================
router.put("/:id", async (req, res) => {
  const { id } = req.params;
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
    BCompanyName,
  } = req.body;

  try {
    const pool = await getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    if (BIfscCode && !validateIfsc(BIfscCode)) {
      return res.status(400).json({
        error:
          "Invalid IFSC Code format. Expected format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)",
      });
    }

    await pool
      .request()
      .input("LHeadId", sql.Int, parseInt(id))
      .input("LHeadName", sql.NVarChar(200), cleanStr(BName, 200))
      .input("LBranchName", sql.VarChar(100), cleanStr(BBranch, 100))
      .input("LAccountNo", sql.VarChar(20), cleanStr(BAccountNumber, 20))
      .input("LIFSCCode", sql.NVarChar(11), cleanIfsc(BIfscCode))
      .input("LAccountType", sql.NVarChar(50), cleanStr(BAccountType, 50))
      .input("LBankType", sql.NVarChar(50), cleanStr(BBankType, 50))
      .input(
        "AccountHolderName",
        sql.NVarChar(150),
        cleanStr(BAccountHolderName, 150),
      )
      .input(
        "BankOpeningBalance",
        sql.Decimal(18, 2),
        BOpeningBalance != null ? cleanDecimal(BOpeningBalance) : null,
      )
      .input("LHeadAddress", sql.NVarChar(300), cleanStr(BAddress, 300))
      .input("LDescription", sql.NVarChar(4000), cleanStr(BCompanyName, 500))
      .input(
        "LHeadStatus",
        sql.Bit,
        BStatus !== undefined ? (Boolean(BStatus) ? 1 : 0) : null,
      )
      .input("ApprovedBy", sql.Int, userId).query(`
        UPDATE dbo.AccountHeadMaster
        SET
          LHeadName = COALESCE(@LHeadName, LHeadName),
          LBranchName = COALESCE(@LBranchName, LBranchName),
          LAccountNo = COALESCE(@LAccountNo, LAccountNo),
          LIFSCCode = COALESCE(@LIFSCCode, LIFSCCode),
          LAccountType = COALESCE(@LAccountType, LAccountType),
          LBankType = COALESCE(@LBankType, LBankType),
          AccountHolderName = COALESCE(@AccountHolderName, AccountHolderName),
          BankOpeningBalance = COALESCE(@BankOpeningBalance, BankOpeningBalance),
          LHeadAddress = COALESCE(@LHeadAddress, LHeadAddress),
          LDescription = COALESCE(@LDescription, LDescription),
          LHeadStatus = COALESCE(@LHeadStatus, LHeadStatus),
          ApprovedBy = @ApprovedBy,
          isEdited = 1,
          UpdatedAt = SYSDATETIME()
        WHERE LHeadId = @LHeadId AND LHeadType = 'B'
      `);

    res.json({ success: true, message: "Bank updated successfully" });
  } catch (err) {
    console.error("UPDATE BANK ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to update bank", message: err.message });
  }
});

// ====================== DELETE BANK ======================
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("LHeadId", sql.Int, parseInt(req.params.id))
      .query(`
        DELETE FROM dbo.AccountHeadMaster
        WHERE LHeadId = @LHeadId AND LHeadType = 'B'
      `);

    res.json({ success: true, message: "Bank deleted successfully" });
  } catch (err) {
    console.error("DELETE BANK ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to delete bank", message: err.message });
  }
});

module.exports = router;
