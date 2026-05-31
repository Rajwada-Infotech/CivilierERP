const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { validateBody } = require("../middleware/validateRequest");
const {
  chequeMasterCreateSchema,
  chequeMasterUpdateSchema,
} = require("../validation/chequeMasterSchemas");

let chequeColumnMetaPromise = null;

async function getChequeColumnMeta() {
  if (!chequeColumnMetaPromise) {
    chequeColumnMetaPromise = getPool()
      .request()
      .query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'ChequeMaster'
      `,
      )
      .then((result) => {
        const meta = new Set();
        result.recordset.forEach((row) =>
          meta.add(row.COLUMN_NAME.toLowerCase()),
        );
        return meta;
      })
      .catch(() => new Set());
  }

  return chequeColumnMetaPromise;
}

const hasColumn = (meta, columnName) => meta.has(columnName.toLowerCase());

const requireUserName = (req, res) => {
  const email = req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// GET all cheques
// CreatedBy/UpdatedBy now store email strings directly — no JOIN needed
router.get("/", cache("cheque-master", 300), async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        cm.CId,
        cm.CompanyId,
        cm.BankId,
        cm.AccountNumber,
        cm.IFSCCode,
        cm.ChequeLotNumber,
        cm.ChequeStartNumber,
        cm.ChequeEndNumber,
        cm.TotalCheques,
        cm.Remarks,
        cm.Status,
        cm.CreatedBy,
        cm.UpdatedBy,
        cm.ApprovedBy,
        cm.CreatedAt,
        cm.UpdatedAt,
        cm.ApprovedAt,
        bm.BName        AS BankName,
        bm.BBranch      AS BankBranch,
        bm.BAccountType AS BankAccountType
      FROM dbo.ChequeMaster cm
      LEFT JOIN dbo.BankMaster bm ON cm.BankId = bm.BId
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("CHEQUE GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST - Create cheque lot
router.post("/", validateBody(chequeMasterCreateSchema), async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    Remarks,
    Status,
  } = req.body;

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

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
    const insertValues = insertColumns.map((col) => `@${col}`);

    // TotalCheques is computed as ((ChequeEndNumber - ChequeStartNumber) + 1)
    // DB calculates it automatically — NEVER insert or update it

    if (hasColumn(columnMeta, "createdby")) {
      request.input("CreatedBy", sql.NVarChar(100), userEmail);
      insertColumns.push("CreatedBy");
      insertValues.push("@CreatedBy");
    }

    if (hasColumn(columnMeta, "createdat")) {
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
    console.error("CHEQUE INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT - Update cheque lot
router.put("/:id", validateBody(chequeMasterUpdateSchema), async (req, res) => {
  const {
    CompanyId,
    BankId,
    AccountNumber,
    IFSCCode,
    ChequeLotNumber,
    ChequeStartNumber,
    ChequeEndNumber,
    Remarks,
    Status,
  } = req.body;

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

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

    // TotalCheques is computed — DB recalculates automatically, NEVER update it

    if (hasColumn(columnMeta, "updatedby")) {
      request.input("UpdatedBy", sql.NVarChar(100), userEmail);
      updates.push("UpdatedBy=@UpdatedBy");
    }

    if (hasColumn(columnMeta, "updatedat")) {
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
    console.error("CHEQUE UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Remove cheque lot
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
    console.error("CHEQUE DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


