const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { validateBody } = require("../middleware/validateRequest");
const { bumpCacheVersion } = require("../redis");
const {
  bankMasterCreateSchema,
  bankMasterUpdateSchema,
} = require("../utils/bankMasterSchemas");

let accountHeadColumnMetaPromise = null;

async function getAccountHeadColumnMeta() {
  if (!accountHeadColumnMetaPromise) {
    accountHeadColumnMetaPromise = getPool()
      .request()
      .query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'AccountHeadMaster'
      `)
      .then((result) => {
        const meta = new Map();
        result.recordset.forEach((row) => {
          meta.set(row.COLUMN_NAME.toLowerCase(), row.COLUMN_NAME);
        });
        return meta;
      })
      .catch(() => new Map());
  }

  return accountHeadColumnMetaPromise;
}

const hasColumn = (meta, columnName) => meta.has(columnName.toLowerCase());

const findColumn = (meta, names, fallback = null) => {
  for (const name of names) {
    const match = meta.get(name.toLowerCase());
    if (match) return match;
  }
  return fallback;
};

const requireUserName = (req, res) => {
  const email = req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ====================== HELPERS ======================
const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

const cleanIfsc = (v) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().toUpperCase().slice(0, 11);
};

const cleanDecimal = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

// ====================== GET ALL BANKS ======================
router.get("/", cache("bank-master", 300), async (req, res) => {
  try {
    const pool = await getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const companyColumn = findColumn(
      columnMeta,
      ["CompanyName", "companyname", "LCompanyName"],
      "LDescription",
    );

    const selectColumns = [
      "LHeadId AS BId",
      "ISNULL(DisplayName, LHeadName) AS BName",
      "LBranchName AS BBranch",
      "LAccountNo AS BAccountNumber",
      "LIFSCCode AS BIfscCode",
      "LAccountType AS BAccountType",
      "LBankType AS BBankType",
      "AccountHolderName AS BAccountHolderName",
      "BankOpeningBalance AS BOpeningBalance",
      "LHeadAddress AS BAddress",
      "LHeadStatus AS BStatus",
      `${companyColumn} AS BCompanyName`,
      "LBankDetails AS BBankDetails",
      "LHeadCode AS BCode",
    ];

    if (hasColumn(columnMeta, "CreatedAt"))  selectColumns.push("CreatedAt");
    if (hasColumn(columnMeta, "UpdatedAt"))  selectColumns.push("UpdatedAt");
    if (hasColumn(columnMeta, "ApprovedBy")) selectColumns.push("ApprovedBy");

    // CreatedBy and UpdatedBy now store email strings directly — no JOIN needed
    if (hasColumn(columnMeta, "CreatedBy")) selectColumns.push("CreatedBy AS CreatedByEmail");
    if (hasColumn(columnMeta, "UpdatedBy")) selectColumns.push("UpdatedBy AS UpdatedByEmail");

    const result = await pool
      .request()
      .input("type", sql.VarChar(50), "B")
      .query(`
        SELECT
          ${selectColumns.join(",\n          ")}
        FROM dbo.AccountHeadMaster ahm
        WHERE LHeadType = @type
        ORDER BY LHeadId DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET BANK ERROR:", err);
    res.status(500).json({ error: "Failed to fetch banks", message: err.message });
  }
});

// ====================== CREATE BANK ======================
router.post("/", validateBody(bankMasterCreateSchema), async (req, res) => {
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

  try {
    const pool = await getPool();
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const columnMeta = await getAccountHeadColumnMeta();
    const companyColumn = findColumn(
      columnMeta,
      ["CompanyName", "companyname", "LCompanyName"],
      "LDescription",
    );

    const request = pool
      .request()
      .input("LHeadName",          sql.NVarChar(200),  BName.trim())
      .input("LHeadType",          sql.VarChar(50),    "B")
      .input("LHeadCode",          sql.NVarChar(20),   null)
      .input("LBranchName",        sql.VarChar(100),   cleanStr(BBranch, 100) || "Main Branch")
      .input("LAccountNo",         sql.VarChar(20),    cleanStr(BAccountNumber, 20))
      .input("LIFSCCode",          sql.NVarChar(11),   cleanIfsc(BIfscCode))
      .input("LAccountType",       sql.NVarChar(50),   cleanStr(BAccountType, 50))
      .input("LBankType",          sql.NVarChar(50),   cleanStr(BBankType, 50))
      .input("AccountHolderName",  sql.NVarChar(150),  cleanStr(BAccountHolderName, 150))
      .input("BankOpeningBalance", sql.Decimal(18, 2), cleanDecimal(BOpeningBalance))
      .input("LHeadAddress",       sql.NVarChar(300),  cleanStr(BAddress, 300) || "N/A")
      .input("LHeadContactPerson", sql.NVarChar(100),  cleanStr(BAccountHolderName, 100) || "System Admin")
      .input("LHeadPhone",         sql.NVarChar(15),   null)
      .input("LHeadEmail",         sql.NVarChar(100),  null)
      .input("LHeadStatus",        sql.Bit,            Boolean(BStatus) ? 1 : 0)
      .input("LHeadPaymentTerms",  sql.NVarChar(100),  "N/A")
      .input("LHeadCreditLimit",   sql.Decimal(18, 2), 0);

    if (companyColumn === "LDescription") {
      request.input("LDescription", sql.NVarChar(4000), cleanStr(BCompanyName, 500) || null);
    } else {
      request.input(companyColumn,  sql.NVarChar(500),  cleanStr(BCompanyName, 500) || null);
    }

    if (hasColumn(columnMeta, "CreatedBy")) {
      request.input("CreatedBy", sql.NVarChar(100), userEmail);
    }
    if (hasColumn(columnMeta, "CreatedAt")) {
      request.input("CreatedAt", sql.DateTime2, new Date());
    }

    const insertColumns = [
      "LHeadName", "LHeadType", "LHeadCode",
      "LBranchName", "LAccountNo", "LIFSCCode",
      "LAccountType", "LBankType", "AccountHolderName", "BankOpeningBalance",
      "LHeadAddress", "LHeadContactPerson", "LHeadPhone", "LHeadEmail",
      "LHeadStatus", companyColumn, "LHeadPaymentTerms", "LHeadCreditLimit",
    ];
    const insertValues = insertColumns.map((col) => `@${col}`);

    if (hasColumn(columnMeta, "CreatedBy")) {
      insertColumns.push("CreatedBy");
      insertValues.push("@CreatedBy");
    }
    if (hasColumn(columnMeta, "CreatedAt")) {
      insertColumns.push("CreatedAt");
      insertValues.push("@CreatedAt");
    }

    const result = await request.query(`
      INSERT INTO dbo.AccountHeadMaster (
        ${insertColumns.join(", ")}
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
        INSERTED.${companyColumn} AS BCompanyName
      VALUES (
        ${insertValues.join(", ")}
      )
    `);

    await bumpCacheVersion("bank-master");
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error("INSERT BANK ERROR:", err);
    if (err.number === 2627 || err.number === 547) {
      return res.status(400).json({
        error: "Validation failed",
        message: err.originalError?.info?.message || err.message,
      });
    }
    res.status(500).json({ error: "Failed to create bank", message: err.message });
  }
});

// ====================== UPDATE BANK ======================
router.put("/:id", validateBody(bankMasterUpdateSchema), async (req, res) => {
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
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const columnMeta = await getAccountHeadColumnMeta();
    const companyColumn = findColumn(
      columnMeta,
      ["CompanyName", "companyname", "LCompanyName"],
      "LDescription",
    );

    const request = pool
      .request()
      .input("LHeadId",            sql.Int,            parseInt(id))
      .input("LHeadName",          sql.NVarChar(200),  cleanStr(BName, 200))
      .input("LBranchName",        sql.VarChar(100),   cleanStr(BBranch, 100))
      .input("LAccountNo",         sql.VarChar(20),    cleanStr(BAccountNumber, 20))
      .input("LIFSCCode",          sql.NVarChar(11),   cleanIfsc(BIfscCode))
      .input("LAccountType",       sql.NVarChar(50),   cleanStr(BAccountType, 50))
      .input("LBankType",          sql.NVarChar(50),   cleanStr(BBankType, 50))
      .input("AccountHolderName",  sql.NVarChar(150),  cleanStr(BAccountHolderName, 150))
      .input("BankOpeningBalance", sql.Decimal(18, 2), BOpeningBalance != null ? cleanDecimal(BOpeningBalance) : null)
      .input("LHeadAddress",       sql.NVarChar(300),  cleanStr(BAddress, 300))
      .input("LHeadStatus",        sql.Bit,            BStatus !== undefined ? (Boolean(BStatus) ? 1 : 0) : null);

    if (companyColumn === "LDescription") {
      request.input("LDescription", sql.NVarChar(4000), cleanStr(BCompanyName, 500));
    } else {
      request.input(companyColumn,  sql.NVarChar(500),  cleanStr(BCompanyName, 500));
    }

    const updates = [
      "LHeadName         = COALESCE(@LHeadName, LHeadName)",
      "LBranchName       = COALESCE(@LBranchName, LBranchName)",
      "LAccountNo        = COALESCE(@LAccountNo, LAccountNo)",
      "LIFSCCode         = COALESCE(@LIFSCCode, LIFSCCode)",
      "LAccountType      = COALESCE(@LAccountType, LAccountType)",
      "LBankType         = COALESCE(@LBankType, LBankType)",
      "AccountHolderName = COALESCE(@AccountHolderName, AccountHolderName)",
      "BankOpeningBalance= COALESCE(@BankOpeningBalance, BankOpeningBalance)",
      "LHeadAddress      = COALESCE(@LHeadAddress, LHeadAddress)",
      `${companyColumn}  = COALESCE(@${companyColumn}, ${companyColumn})`,
      "LHeadStatus       = COALESCE(@LHeadStatus, LHeadStatus)",
      "isEdited          = 1",
    ];

    // UpdatedBy and ApprovedBy now store email strings directly
    if (hasColumn(columnMeta, "UpdatedBy")) {
      request.input("UpdatedBy", sql.NVarChar(100), userEmail);
      updates.push("UpdatedBy  = @UpdatedBy");
    }
    if (hasColumn(columnMeta, "ApprovedBy")) {
      request.input("ApprovedBy", sql.NVarChar(100), userEmail);
      updates.push("ApprovedBy = @ApprovedBy");
    }
    if (hasColumn(columnMeta, "UpdatedAt")) {
      updates.push("UpdatedAt  = SYSDATETIME()");
    }

    await request.query(`
      UPDATE dbo.AccountHeadMaster SET
        ${updates.join(",\n        ")}
      WHERE LHeadId = @LHeadId AND LHeadType = 'B'
    `);

    await bumpCacheVersion("bank-master");
    res.json({ success: true, message: "Bank updated successfully" });
  } catch (err) {
    console.error("UPDATE BANK ERROR:", err);
    res.status(500).json({ error: "Failed to update bank", message: err.message });
  }
});

// ====================== DELETE BANK ======================
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("LHeadId", sql.Int, parseInt(req.params.id))
      .query(`
        DELETE FROM dbo.AccountHeadMaster
        WHERE LHeadId = @LHeadId AND LHeadType = 'B'
      `);

    await bumpCacheVersion("bank-master");
    res.json({ success: true, message: "Bank deleted successfully" });
  } catch (err) {
    console.error("DELETE BANK ERROR:", err);
    res.status(500).json({ error: "Failed to delete bank", message: err.message });
  }
});

module.exports = router;
