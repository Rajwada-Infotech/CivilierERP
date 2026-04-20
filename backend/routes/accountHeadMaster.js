const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

let accountHeadColumnMetaPromise = null;

async function getAccountHeadColumnMeta() {
  if (!accountHeadColumnMetaPromise) {
    accountHeadColumnMetaPromise = getPool()
      .request()
      .query(`
        SELECT
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'AccountHeadMaster'
      `)
      .then((result) => {
        const meta = new Map();
        result.recordset.forEach((row) => {
          meta.set(row.COLUMN_NAME.toLowerCase(), {
            name: row.COLUMN_NAME,
            type: row.DATA_TYPE,
            isNullable: row.IS_NULLABLE === "YES",
          });
        });
        return meta;
      })
      .catch(() => new Map());
  }

  return accountHeadColumnMetaPromise;
}

const getColumn = (meta, columnName) => meta.get(columnName.toLowerCase()) || null;

const hasColumn = (meta, columnName) => Boolean(getColumn(meta, columnName));

const requireUserId = (req, res) => {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return userId;
};

// GET all ledger heads
router.get("/", cache("account-head-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const selectColumns = [
      "lh.LHeadId",
      "lh.LHeadName",
      "lh.LHeadCode",
      "lh.LHeadType",
      "lh.LHeadPhone",
      "lh.LHeadEmail",
      "lh.LHeadAddress",
      "lh.LHeadContactPerson",
      "lh.LHeadStatus",
      "lh.LHeadPaymentTerms",
      "lh.LBranchName",
      "lh.LGST",
      "lh.LGSTState",
      "lh.LCountry",
      "lh.LBelongsTo",
      "lh.LDescription",
      "lh.isEdited",
    ];

    if (hasColumn(columnMeta, "LGSTType")) selectColumns.push("lh.LGSTType");
    if (hasColumn(columnMeta, "LHeadPan")) selectColumns.push("lh.LHeadPan");
    if (hasColumn(columnMeta, "LHeadCatagory")) selectColumns.push("lh.LHeadCatagory");
    if (hasColumn(columnMeta, "CreatedBy")) selectColumns.push("lh.CreatedBy");
    if (hasColumn(columnMeta, "CreatedAt")) selectColumns.push("lh.CreatedAt");
    if (hasColumn(columnMeta, "UpdatedBy")) selectColumns.push("lh.UpdatedBy");
    if (hasColumn(columnMeta, "UpdatedAt")) selectColumns.push("lh.UpdatedAt");
    if (hasColumn(columnMeta, "ApprovedBy")) selectColumns.push("lh.ApprovedBy");

    let query = `SELECT
        ${selectColumns.join(",\n        ")},
        ag.Name  AS GroupName,
        ag.ParentGroupId,
        parent.Name AS ParentGroupName
      FROM dbo.AccountHeadMaster lh
      LEFT JOIN dbo.AccountGroup ag     ON ag.AGId     = lh.LBelongsTo
      LEFT JOIN dbo.AccountGroup parent ON parent.AGId = ag.ParentGroupId`;
    const request = pool.request();
    if (req.query.type) {
      query += ` WHERE lh.LHeadType = @type`;
      request.input("type", sql.VarChar(50), req.query.type);
    }
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD ledger head
router.post("/", async (req, res) => {
  const {
    LHeadName,
    LHeadCode,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
    LGSTType,
    LHeadPan,
    LHeadCatagory,
    LHeadType,
  } = req.body;
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const request = pool
      .request()
      .input("LHeadName", sql.NVarChar(200), LHeadName)
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || "N/A")
      .input(
        "LHeadContactPerson",
        sql.VarChar(100),
        LHeadContactPerson || "N/A",
      )
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || "N/A")
      .input(
        "LBranchName",
        sql.VarChar(100),
        LHeadType === "B"
          ? LBranchName || "Main"
          : (LBranchName ?? null),
      )
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || "India")
      .input("LBelongsTo", sql.Int, LBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null)
      .input("LHeadType", sql.VarChar(50), LHeadType || "GL");

    const insertColumns = [
      "LHeadName",
      "LHeadCode",
      "LHeadPhone",
      "LHeadEmail",
      "LHeadAddress",
      "LHeadContactPerson",
      "LHeadStatus",
      "LHeadPaymentTerms",
      "LBranchName",
      "LGST",
      "LGSTState",
      "LCountry",
      "LBelongsTo",
      "LDescription",
      "LHeadType",
    ];
    const insertValues = insertColumns.map((column) => `@${column}`);

    if (hasColumn(columnMeta, "LGSTType")) {
      request.input("LGSTType", sql.NVarChar(50), LGSTType || null);
      insertColumns.push("LGSTType");
      insertValues.push("@LGSTType");
    }

    if (hasColumn(columnMeta, "LHeadPan")) {
      request.input("LHeadPan", sql.NVarChar(50), LHeadPan || null);
      insertColumns.push("LHeadPan");
      insertValues.push("@LHeadPan");
    }

    if (hasColumn(columnMeta, "LHeadCatagory")) {
      request.input("LHeadCatagory", sql.NVarChar(100), LHeadCatagory || null);
      insertColumns.push("LHeadCatagory");
      insertValues.push("@LHeadCatagory");
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
      INSERT INTO dbo.AccountHeadMaster (
        ${insertColumns.join(", ")}
      ) VALUES (
        ${insertValues.join(", ")}
      )
    `);
    await bumpCacheVersion("account-head-master");

    res.json({ message: "Ledger head added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET id+name for FK dropdowns
// IMPORTANT: declared before /:id so Express doesn't treat "options" as a record id
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    let query =
      "SELECT LHeadId AS id, LHeadName AS label FROM dbo.AccountHeadMaster WHERE LHeadStatus = 1";
    const request = pool.request();
    if (req.query.type) {
      query += " AND LHeadType = @type";
      request.input("type", sql.VarChar(50), req.query.type);
    }
    query += " ORDER BY LHeadName";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET bank options with account number and IFSC for auto-fill
// IMPORTANT: declared before /:id
router.get("/bank-options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
        SELECT
          LHeadId    AS id,
          LHeadName  AS label,
          LAccountNo AS accountNumber,
          LIFSCCode  AS ifscCode
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'B' AND LHeadStatus = 1
        ORDER BY LHeadName
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ledger head
router.put("/:id", async (req, res) => {
  const {
    LHeadName,
    LHeadCode,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
    LGSTType,
    LHeadPan,
    LHeadCatagory,
  } = req.body;
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const request = pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("LHeadName", sql.NVarChar(200), LHeadName || null)
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || null)
      .input("LHeadContactPerson", sql.VarChar(100), LHeadContactPerson || null)
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || null)
      .input("LBranchName", sql.VarChar(100), LBranchName || null)
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || null)
      .input("LBelongsTo", sql.Int, LBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null);

    const updates = [
      "LHeadName          = @LHeadName",
      "LHeadCode          = @LHeadCode",
      "LHeadPhone         = @LHeadPhone",
      "LHeadEmail         = @LHeadEmail",
      "LHeadAddress       = @LHeadAddress",
      "LHeadContactPerson = @LHeadContactPerson",
      "LHeadStatus        = @LHeadStatus",
      "LHeadPaymentTerms  = @LHeadPaymentTerms",
      "LBranchName        = @LBranchName",
      "LGST               = @LGST",
      "LGSTState          = @LGSTState",
      "LCountry           = @LCountry",
      "LBelongsTo         = @LBelongsTo",
      "LDescription       = @LDescription",
      "isEdited           = 1",
    ];

    if (hasColumn(columnMeta, "LGSTType")) {
      request.input("LGSTType", sql.NVarChar(50), LGSTType || null);
      updates.push("LGSTType           = @LGSTType");
    }

    if (hasColumn(columnMeta, "LHeadPan")) {
      request.input("LHeadPan", sql.NVarChar(50), LHeadPan || null);
      updates.push("LHeadPan           = @LHeadPan");
    }

    if (hasColumn(columnMeta, "LHeadCatagory")) {
      request.input("LHeadCatagory", sql.NVarChar(100), LHeadCatagory || null);
      updates.push("LHeadCatagory      = @LHeadCatagory");
    }

    if (hasColumn(columnMeta, "UpdatedBy")) {
      request.input("UpdatedBy", sql.Int, userId);
      updates.push("UpdatedBy          = @UpdatedBy");
    }

    if (hasColumn(columnMeta, "UpdatedAt")) {
      updates.push("UpdatedAt          = SYSDATETIME()");
    }

    await request.query(`
      UPDATE dbo.AccountHeadMaster SET
        ${updates.join(",\n        ")}
      WHERE LHeadId = @id
    `);
    await bumpCacheVersion("account-head-master");

    res.json({ message: "Ledger head updated" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE ledger head
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @id");
    await bumpCacheVersion("account-head-master");

    res.json({ message: "Ledger head deleted" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
