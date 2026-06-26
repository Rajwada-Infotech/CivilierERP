const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");

let accountHeadColumnMetaPromise = null;

async function getAccountHeadColumnMeta() {
  if (!accountHeadColumnMetaPromise) {
    accountHeadColumnMetaPromise = getPool()
      .request()
      .query(
        `
        SELECT COLUMN_NAME, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'AccountHeadMaster'
      `,
      )
      .then((result) => {
        const meta = new Map();
        result.recordset.forEach((row) => {
          meta.set(row.COLUMN_NAME.toLowerCase(), {
            name: row.COLUMN_NAME,
            isNullable: row.IS_NULLABLE === "YES",
          });
        });
        return meta;
      })
      .catch(() => new Map());
  }

  return accountHeadColumnMetaPromise;
}

const hasColumn = (meta, columnName) => meta.has(columnName.toLowerCase());

const getColumnMeta = (meta, columnName) =>
  meta.get(columnName.toLowerCase()) || null;

const requireUserName = (req, res) => {
  const email = req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ─────────────────────────────────────────────────────────────────────────────
// General Ledger Routes
// Base path: /api/general-ledger
//
// All records are scoped to LHeadType = 'GL' so this table shares
// dbo.AccountHeadMaster with other ledger types but only surfaces GL entries.
//
// IMPORTANT: /options must be declared BEFORE /:id so Express does not treat
// the literal string "options" as a record id parameter.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /options ─────────────────────────────────────────────────────────────
// Lightweight id/label pairs for use in FK dropdowns elsewhere in the app.
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        LHeadId   AS id,
        ISNULL(DisplayName, LHeadName) AS label,
        LHeadCode AS code
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'GL'
        AND LHeadStatus = 1
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GL OPTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
// Returns all GL ledger heads joined with their account group names.
// Supports optional ?search= and ?groupId= query filters.
router.get("/", cache("general-ledger", 300), async (req, res) => {
  try {
    const pool = getPool();

    // Sanitized pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    let whereClause = "WHERE lh.LHeadType = 'GL'";

    const request = pool.request();
    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);

    if (req.query.search) {
      whereClause +=
        " AND (lh.LHeadName LIKE @search OR lh.LHeadCode LIKE @search)";
      request.input("search", sql.NVarChar(200), `%${req.query.search}%`);
    }

    if (req.query.groupId) {
      whereClause += " AND lh.LBelongsTo = @groupId";
      request.input("groupId", sql.Int, parseInt(req.query.groupId, 10));
    }

    // Use COUNT(*) OVER() to avoid executing the same Request object twice
    // (mssql Request instances are single-use — a second .query() call corrupts
    // the internal column stream and throws an unhandled 'error' event that
    // crashes the process).
    const result = await request.query(`
      SELECT
        lh.LHeadId,
        lh.LHeadName,
        lh.LHeadCode,
        lh.LBelongsTo,
        lh.LHeadStatus,
        lh.LHeadType,
        lh.isEdited,
        ag.Name        AS GroupName,
        ag.ParentGroupId,
        parent.Name    AS ParentGroupName,
        COUNT(*) OVER() AS TotalCount
      FROM dbo.AccountHeadMaster lh
      LEFT JOIN dbo.AccountGroup ag
             ON ag.AGId     = lh.LBelongsTo
      LEFT JOIN dbo.AccountGroup parent
             ON parent.AGId = ag.ParentGroupId
      ${whereClause}
      ORDER BY lh.LHeadName
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const total =
      result.recordset.length > 0 ? Number(result.recordset[0].TotalCount) : 0;

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GL GET ALL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
// Returns a single GL ledger head by its primary key.
router.get("/:id", cache("general-ledger-detail", 180), async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, numericId).query(`
        SELECT
          lh.LHeadId,
          lh.LHeadName,
          lh.LHeadCode,
          lh.LBelongsTo,
          lh.LHeadStatus,
          lh.LHeadType,
          lh.isEdited,
          ag.Name     AS GroupName,
          ag.ParentGroupId,
          parent.Name AS ParentGroupName
        FROM dbo.AccountHeadMaster lh
        LEFT JOIN dbo.AccountGroup ag
               ON ag.AGId     = lh.LBelongsTo
        LEFT JOIN dbo.AccountGroup parent
               ON parent.AGId = ag.ParentGroupId
        WHERE lh.LHeadId   = @id
          AND lh.LHeadType = 'GL'
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "General ledger record not found" });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("GL GET ONE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
// Creates a new GL ledger head. LHeadName is required; all other fields are optional.
router.post("/", requirePageRight("general-ledger", "create"), async (req, res) => {
  const { LHeadName, LHeadCode, LBelongsTo, LHeadStatus } = req.body;

  if (!LHeadName || !String(LHeadName).trim()) {
    return res.status(400).json({ error: "LHeadName is required" });
  }

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const request = pool
      .request()
      .input("LHeadName", sql.NVarChar(200), LHeadName.trim())
      .input(
        "LHeadCode",
        sql.NVarChar(20),
        LHeadCode ? LHeadCode.trim().toUpperCase() : null,
      )
      .input(
        "LBelongsTo",
        sql.Int,
        LBelongsTo ? parseInt(LBelongsTo, 10) : null,
      )
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadType", sql.VarChar(50), "GL")
      .input("LHeadAddress", sql.VarChar(300), "N/A")
      .input("LHeadContactPerson", sql.VarChar(100), "N/A")
      .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
      .input(
        "LBranchName",
        sql.VarChar(100),
        getColumnMeta(columnMeta, "LBranchName")?.isNullable ? null : "Main",
      )
      .input("LCountry", sql.VarChar(50), "India");

    const insertColumns = [
      "LHeadName",
      "LHeadCode",
      "LBelongsTo",
      "LHeadStatus",
      "LHeadType",
      "LHeadAddress",
      "LHeadContactPerson",
      "LHeadPaymentTerms",
      "LBranchName",
      "LCountry",
    ];
    const insertValues = insertColumns.map((column) => `@${column}`);

    if (hasColumn(columnMeta, "CreatedBy")) {
      request.input("CreatedBy", sql.NVarChar(100), userEmail);
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

    await bumpCacheVersion("general-ledger");
    await bumpCacheVersion("general-ledger-detail");
    res
      .status(201)
      .json({ message: "General ledger account created successfully" });
  } catch (err) {
    console.error("GL INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
// Updates an existing GL ledger head. LHeadType is always preserved as 'GL'.
router.put("/:id", requirePageRight("general-ledger", "edit"), async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  const { LHeadName, LHeadCode, LBelongsTo, LHeadStatus } = req.body;

  if (!LHeadName || !String(LHeadName).trim()) {
    return res.status(400).json({ error: "LHeadName is required" });
  }

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const request = pool
      .request()
      .input("id", sql.Int, numericId)
      .input("LHeadName", sql.NVarChar(200), LHeadName.trim())
      .input(
        "LHeadCode",
        sql.NVarChar(20),
        LHeadCode ? LHeadCode.trim().toUpperCase() : null,
      )
      .input(
        "LBelongsTo",
        sql.Int,
        LBelongsTo ? parseInt(LBelongsTo, 10) : null,
      )
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0);

    const updates = [
      "LHeadName   = @LHeadName",
      "LHeadCode   = @LHeadCode",
      "LBelongsTo  = @LBelongsTo",
      "LHeadStatus = @LHeadStatus",
      "isEdited    = 1",
    ];

    if (hasColumn(columnMeta, "UpdatedBy")) {
      request.input("UpdatedBy", sql.NVarChar(100), userEmail);
      updates.push("UpdatedBy   = @UpdatedBy");
    }

    if (hasColumn(columnMeta, "UpdatedAt")) {
      updates.push("UpdatedAt   = SYSDATETIME()");
    }

    const result = await request.query(`
        UPDATE dbo.AccountHeadMaster SET
          ${updates.join(",\n          ")}
        WHERE LHeadId   = @id
          AND LHeadType = 'GL'
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "General ledger record not found" });
    }

    await bumpCacheVersion("general-ledger");
    await bumpCacheVersion("general-ledger-detail");
    res.json({ message: "General ledger account updated successfully" });
  } catch (err) {
    console.error("GL UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// Hard-deletes a GL ledger head. Scoped to LHeadType = 'GL' as a safety guard
// so this route can never accidentally delete non-GL account heads.
router.delete("/:id", requirePageRight("general-ledger", "delete"), async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, numericId).query(`
        DELETE FROM dbo.AccountHeadMaster
        WHERE LHeadId   = @id
          AND LHeadType = 'GL'
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "General ledger record not found" });
    }

    await bumpCacheVersion("general-ledger");
    await bumpCacheVersion("general-ledger-detail");
    res.json({ message: "General ledger account deleted successfully" });
  } catch (err) {
    console.error("GL DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




