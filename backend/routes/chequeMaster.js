const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

let chequeColumnMetaPromise = null;

async function getChequeColumnMeta() {
  if (!chequeColumnMetaPromise) {
    chequeColumnMetaPromise = getPool()
      .request()
      .query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'ChequeMaster'
      `)
      .then((result) => {
        const meta = new Set();
        result.recordset.forEach((row) => meta.add(row.COLUMN_NAME.toLowerCase()));
        return meta;
      })
      .catch(() => new Set());
  }

  return chequeColumnMetaPromise;
}

const hasColumn = (meta, columnName) => meta.has(columnName.toLowerCase());

const requireUserId = (req, res) => {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return userId;
};

router.get("/", cache("cheque-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query("SELECT * FROM dbo.ChequeMaster");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    TotalCheques,
    Remarks,
    Status,
  } = req.body;
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const pool = getPool();
    const columnMeta = await getChequeColumnMeta();
    const request = pool
      .request()
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("BankId", sql.Int, BankId || null)
      .input("AccountNumber", sql.NVarChar, AccountNumber || null)
      .input("IFSCCode", sql.NVarChar, IFSCCode || null)
      .input("ChequeLotNumber", sql.NVarChar, ChequeLotNumber || null)
      .input("ChequeStartNumber", sql.BigInt, ChequeStartNumber || null)
      .input("ChequeEndNumber", sql.BigInt, ChequeEndNumber || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("Status", sql.Bit, Status ? 1 : 0);

    const insertColumns = [
      "CompanyId",
      "BankId",
      "AccountNumber",
      "IFSCCode",
      "ChequeLotNumber",
      "ChequeStartNumber",
      "ChequeEndNumber",
      "Remarks",
      "Status",
    ];
    const insertValues = insertColumns.map((column) => `@${column}`);

    if (hasColumn(columnMeta, "TotalCheques")) {
      request.input("TotalCheques", sql.Int, TotalCheques || null);
      insertColumns.push("TotalCheques");
      insertValues.push("@TotalCheques");
    }

    if (hasColumn(columnMeta, "CreatedBy")) {
      request.input("CreatedBy", sql.Int, userId);
      insertColumns.push("CreatedBy");
      insertValues.push("@CreatedBy");
    }

    if (hasColumn(columnMeta, "CreatedAt")) {
      request.input("CreatedAt", sql.DateTime2, new Date());
      insertColumns.push("CreatedAt");
      insertValues.push("@CreatedAt");
    }

    await request.query(`
      INSERT INTO dbo.ChequeMaster (
        ${insertColumns.join(", ")}
      ) VALUES (
        ${insertValues.join(", ")}
      )
    `);
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    TotalCheques,
    Remarks,
    Status,
  } = req.body;
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const pool = getPool();
    const columnMeta = await getChequeColumnMeta();
    const request = pool
      .request()
      .input("CId", sql.Int, req.params.id)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("BankId", sql.Int, BankId || null)
      .input("AccountNumber", sql.NVarChar, AccountNumber || null)
      .input("IFSCCode", sql.NVarChar, IFSCCode || null)
      .input("ChequeLotNumber", sql.NVarChar, ChequeLotNumber || null)
      .input("ChequeStartNumber", sql.BigInt, ChequeStartNumber || null)
      .input("ChequeEndNumber", sql.BigInt, ChequeEndNumber || null)
      .input("Remarks", sql.NVarChar, Remarks || null)
      .input("Status", sql.Bit, Status ? 1 : 0);

    const updates = [
      "CompanyId=@CompanyId",
      "BankId=@BankId",
      "AccountNumber=@AccountNumber",
      "IFSCCode=@IFSCCode",
      "ChequeLotNumber=@ChequeLotNumber",
      "ChequeStartNumber=@ChequeStartNumber",
      "ChequeEndNumber=@ChequeEndNumber",
      "Remarks=@Remarks",
      "Status=@Status",
    ];

    if (hasColumn(columnMeta, "TotalCheques")) {
      request.input("TotalCheques", sql.Int, TotalCheques || null);
      updates.push("TotalCheques=@TotalCheques");
    }

    if (hasColumn(columnMeta, "UpdatedBy")) {
      request.input("UpdatedBy", sql.Int, userId);
      updates.push("UpdatedBy=@UpdatedBy");
    }

    if (hasColumn(columnMeta, "UpdatedAt")) {
      request.input("UpdatedAt", sql.DateTime2, new Date());
      updates.push("UpdatedAt=@UpdatedAt");
    }

    await request.query(`
      UPDATE dbo.ChequeMaster SET
        ${updates.join(",\n        ")}
      WHERE CId=@CId
    `);
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("CId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.ChequeMaster WHERE CId=@CId");
    await bumpCacheVersion("cheque-master");
    res.json({ message: "Cheque lot deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
