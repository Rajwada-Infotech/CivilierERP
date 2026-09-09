const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");

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
        LHeadId            AS id,
        ISNULL(DisplayName, LHeadName) AS label,
        LHeadCode          AS code,
        ISNULL(IsSystemGenerated, 0) AS isSystemGenerated
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

// ── GET /system-generated ─────────────────────────────────────────────────────
// Returns only the system-generated GL ledger accounts (for GRN posting dropdowns).
router.get("/system-generated", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        LHeadId   AS id,
        LHeadName AS label,
        LHeadCode AS code
      FROM dbo.AccountHeadMaster
      WHERE LHeadType         = 'GL'
        AND LHeadStatus       = 1
        AND ISNULL(IsSystemGenerated, 0) = 1
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GL SYSTEM-GENERATED ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Direct/Indirect classification for a GL head's own AccountGroup id —
// reuses the exact rule financialStatements.js's classifyExpenseBucketName
// already applies for the P&L (walk up to the nearest ancestor that's a
// direct child of the EXPENSES root, classify THAT bucket's name: a name
// matching "direct expense" or "project"/"construction" is Direct,
// everything else — including heads that aren't under EXPENSES at all,
// e.g. Assets/Income/Equity — falls back to Indirect/not-applicable).
// Loads the AccountGroup tree once per request (a few hundred rows at
// most) instead of a recursive CTE per row, since this report classifies
// every GL head on the page, not just one.
async function loadExpenseTypeClassifier(pool) {
  const rootRes = await pool.request().query(
    `SELECT AGId FROM dbo.AccountGroup WHERE Name = 'EXPENSES' AND ParentGroupId IS NULL`,
  );
  const expensesRootId = rootRes.recordset[0]?.AGId ?? null;

  const groupsRes = await pool.request().query(`SELECT AGId, Name, ParentGroupId FROM dbo.AccountGroup`);
  const groupMap = new Map(
    groupsRes.recordset.map((g) => [
      Number(g.AGId),
      { id: Number(g.AGId), name: g.Name, parentId: g.ParentGroupId != null ? Number(g.ParentGroupId) : null },
    ]),
  );

  function scheduleBucketOf(groupId) {
    let cur = groupMap.get(Number(groupId));
    let hops = 0;
    while (cur && hops < 20) {
      if (cur.parentId === expensesRootId) return cur;
      if (cur.parentId == null) return null;
      cur = groupMap.get(cur.parentId);
      hops++;
    }
    return null;
  }

  return (groupId) => {
    if (groupId == null) return null;
    const bucket = scheduleBucketOf(groupId);
    if (!bucket) return null;
    const n = (bucket.name || "").toLowerCase();
    const isDirect = /\bdirect expense/.test(n) || /project|construction/.test(n);
    return isDirect ? "Direct Expense" : "Indirect Expense";
  };
}

// ── GET /transactions ────────────────────────────────────────────────────────
// Every posted GL entry (debit/credit — invoice bookings, payments, JVs,
// GRNs, fund transfers) across every GL-type head at once, for the Ledger
// Report — unlike GET / (an account-head master list) or Vendor Ledger's
// /all-transactions (hard-scoped to LHeadType='S' suppliers only), this is
// the actual General Ledger transaction feed, scoped to LHeadType='GL' so
// Supplier/Customer/Bank postings don't flood a report about expense/income
// GL accounts. Each row carries its own Direct/Indirect Expense Type.
router.get("/transactions", async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 2000);
    const offset = (page - 1) * limit;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const groupId = req.query.groupId ? parseInt(req.query.groupId, 10) : null;
    const search = req.query.search ? String(req.query.search).trim() : null;

    // Resolved supplier/contractor for the ExpenseBooking/InvoicePosting leg
    // (GRN/PO/WO_PO/WORK_DONE -> source doc's supplier, direct/manual ->
    // eb.LHeadId) — same helper Expense Register's own "Paid To" column uses.
    const ebSup = expenseBookingSupplierSql("eb", "glt");

    const result = await pool
      .request()
      .input("Offset", sql.Int, offset)
      .input("Limit", sql.Int, limit)
      .input("From", sql.Date, from)
      .input("To", sql.Date, to)
      .input("GroupId", sql.Int, groupId)
      .input("Search", sql.NVarChar(200), search ? `%${search}%` : null).query(`
      SELECT
        gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.DebitAmount, gle.CreditAmount,
        gle.Narration, gle.SourceType, gle.SourceId,
        ahm.LHeadId, ISNULL(ahm.DisplayName, ahm.LHeadName) AS LHeadName, ahm.LBelongsTo AS GroupId,
        ag.Name AS GroupName,
        np.DocNo        AS NewPaymentDocNo,
        rp.RPDocNo      AS ReceivedPaymentDocNo,
        jv.JVNo         AS JournalVoucherNo,
        ft.DocNo        AS FundTransferDocNo,
        eb.EDocNo       AS ExpenseBookingDocNo,
        ISNULL(grn.DocNo, grn.GRNNo) AS GrnDocNo,
        -- The counter-party this leg was actually paid to/received from,
        -- whichever source this leg came from — payments/received payments
        -- resolve via their own party head, invoices via the same resolved-
        -- supplier logic the Expense Register report uses, and a direct
        -- GRN posting via the GRN's own SupplierID. Journal Vouchers and
        -- Fund Transfers have no single "party" concept, so this stays
        -- NULL for them (shown as "—" on the client).
        -- NULLIF strips the empty string expenseBookingSupplierSql's
        -- nameExpr falls back to (ISNULL(...,'')) when eb has no match at
        -- all, so COALESCE actually reaches the later fallbacks instead of
        -- short-circuiting on '' (an empty string is non-NULL to COALESCE).
        COALESCE(npParty.LHeadName, rp.RPCustomerName, NULLIF(${ebSup.nameExpr}, ''), grnSupplier.LHeadName) AS PaidTo,
        COUNT(*) OVER() AS TotalCount
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = gle.LHeadId AND ahm.LHeadType = 'GL'
      LEFT JOIN dbo.AccountGroup ag ON ag.AGId = ahm.LBelongsTo
      LEFT JOIN dbo.NewPayment np
        ON gle.SourceType IN ('NewPayment', 'PaymentPosting') AND np.PPaymentID = gle.SourceId
      LEFT JOIN dbo.AccountHeadMaster npParty ON npParty.LHeadId = np.PPartyId
      LEFT JOIN dbo.ReceivedPayment rp
        ON gle.SourceType = 'ReceivedPayment' AND rp.RPPaymentID = gle.SourceId
      LEFT JOIN dbo.JournalVoucher jv
        ON gle.SourceType = 'JournalVoucher' AND jv.JVID = gle.SourceId
      LEFT JOIN dbo.FundTransfer ft
        ON gle.SourceType = 'FundTransfer' AND ft.FTId = gle.SourceId
      LEFT JOIN dbo.ExpenseBooking eb
        ON gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND eb.Eid = gle.SourceId
      ${ebSup.joins}
      LEFT JOIN dbo.GoodsReceiptNotes grn
        ON gle.SourceType IN ('GRN', 'GRNPosting') AND grn.GRNID = gle.SourceId
      LEFT JOIN dbo.AccountHeadMaster grnSupplier ON grnSupplier.LHeadId = grn.SupplierID
      WHERE gle.IsReversed = 0
        AND (@From IS NULL OR gle.VoucherDate >= @From)
        AND (@To IS NULL OR gle.VoucherDate <= @To)
        AND (@GroupId IS NULL OR ahm.LBelongsTo = @GroupId)
        AND (@Search IS NULL OR ahm.LHeadName LIKE @Search)
      ORDER BY gle.VoucherDate DESC, gle.EntryId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
    `);

    const classify = await loadExpenseTypeClassifier(pool);
    const rows = result.recordset;
    const total = rows.length > 0 ? Number(rows[0].TotalCount) : 0;

    const data = rows.map(({ TotalCount, NewPaymentDocNo, ReceivedPaymentDocNo, JournalVoucherNo, FundTransferDocNo, ExpenseBookingDocNo, GrnDocNo, GroupId: rowGroupId, ...r }) => ({
      ...r,
      GroupId: rowGroupId,
      ExpenseType: classify(rowGroupId),
      // One resolved doc number, whichever source this leg came from —
      // same "pick the matching join" pattern as Vendor Ledger's own
      // all-transactions endpoint, just for the GL side's source types.
      DocNo: NewPaymentDocNo || ReceivedPaymentDocNo || JournalVoucherNo || FundTransferDocNo || ExpenseBookingDocNo || GrnDocNo || r.VoucherNo || null,
    }));

    res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("GL TRANSACTIONS ERROR:", err.message);
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
        ISNULL(lh.IsSystemGenerated, 0) AS IsSystemGenerated,
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
          ISNULL(lh.IsSystemGenerated, 0) AS IsSystemGenerated,
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
  const { LHeadName, LHeadCode, LBelongsTo, LHeadStatus, IsSystemGenerated } = req.body;

  if (!LHeadName || !String(LHeadName).trim()) {
    return res.status(400).json({ error: "LHeadName is required" });
  }

  // Only super_admin can create system-generated ledgers
  if (IsSystemGenerated) {
    const userRole = req.user?.role ?? "";
    if (userRole !== "super_admin") {
      return res.status(403).json({ error: "Only Super Admin can create system-generated ledger accounts." });
    }
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
      .input("IsSystemGenerated", sql.Bit, IsSystemGenerated ? 1 : 0)
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
      "IsSystemGenerated",
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

  const { LHeadName, LHeadCode, LBelongsTo, LHeadStatus, IsSystemGenerated } = req.body;

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

    // Only super_admin can toggle IsSystemGenerated
    const userRole = req.user?.role ?? "";
    if (IsSystemGenerated !== undefined && userRole === "super_admin") {
      request.input("IsSystemGenerated", sql.Bit, IsSystemGenerated ? 1 : 0);
    }

    const updates = [
      "LHeadName   = @LHeadName",
      "LHeadCode   = @LHeadCode",
      "LBelongsTo  = @LBelongsTo",
      "LHeadStatus = @LHeadStatus",
      "isEdited    = 1",
    ];

    if (IsSystemGenerated !== undefined && userRole === "super_admin") {
      updates.push("IsSystemGenerated = @IsSystemGenerated");
    }

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
// System-generated ledgers (IsSystemGenerated = 1) can only be deleted by super_admin.
router.delete("/:id", requirePageRight("general-ledger", "delete"), async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();

    // Fetch the record first to check IsSystemGenerated
    const checkResult = await pool
      .request()
      .input("id", sql.Int, numericId)
      .query(`
        SELECT ISNULL(IsSystemGenerated, 0) AS IsSystemGenerated
        FROM dbo.AccountHeadMaster
        WHERE LHeadId = @id AND LHeadType = 'GL'
      `);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: "General ledger record not found" });
    }

    const isSystemGenerated = checkResult.recordset[0].IsSystemGenerated === true
      || checkResult.recordset[0].IsSystemGenerated === 1;

    if (isSystemGenerated) {
      const userRole = req.user?.role ?? "";
      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "System-generated ledger accounts can only be deleted by a Super Admin.",
        });
      }
    }

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




