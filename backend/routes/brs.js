const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const sql = require("mssql");

const { cache } = require("../middleware/cache");
const { syncBillStatus } = require("../utils/syncBillStatus");
const { bumpCacheVersion } = require("../redis");
const { getPool } = require("../db");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "BRS"));

// Bust cache on startup so the unmatched-payments filter fix above takes
// effect immediately instead of waiting out the 60s TTL on stale entries.
bumpCacheVersion("brs").catch(() => {});

// ── Dynamic column detection for AccountHeadMaster (same pattern as bankMaster.js) ──
let _colMetaPromise = null;
async function getAHMColumnMeta() {
  if (!_colMetaPromise) {
    _colMetaPromise = getPool()
      .request()
      .query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='AccountHeadMaster'`,
      )
      .then((r) => {
        const m = new Map();
        r.recordset.forEach((row) =>
          m.set(row.COLUMN_NAME.toLowerCase(), row.COLUMN_NAME),
        );
        return m;
      })
      .catch(() => {
        _colMetaPromise = null;
        return new Map();
      });
  }
  return _colMetaPromise;
}
const findAHMCol = (meta, names, fallback = null) => {
  for (const n of names) {
    const m = meta.get(n.toLowerCase());
    if (m) return m;
  }
  return fallback;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /brs/filters  —  companies + banks for dropdown filters
// ─────────────────────────────────────────────────────────────────────────────
router.get("/filters", cache("brs-filters", 300), async (req, res) => {
  try {
    const pool = getPool();

    const companyResult = await pool.request().query(`
      SELECT id, name
      FROM   dbo.enterprise
      WHERE  business_type = 'C'
      ORDER BY name
    `);

    // Detect the company column dynamically (may be CompanyName, LCompanyName, or fall back to LDescription)
    const colMeta = await getAHMColumnMeta();
    const companyCol = findAHMCol(
      colMeta,
      ["CompanyName", "companyname", "LCompanyName"],
      "LDescription",
    );

    const bankResult = await pool.request().query(`
      SELECT
        ahm.LHeadId            AS BId,
        ahm.LHeadName          AS BName,
        ahm.${companyCol}      AS CompanyName,
        ent.id                 AS CompanyId
      FROM dbo.AccountHeadMaster ahm
      LEFT JOIN dbo.enterprise ent
        ON  ent.business_type = 'C'
        AND ent.name          = ahm.${companyCol}
      WHERE ahm.LHeadType   = 'B'
        AND ahm.LHeadStatus = 1
      ORDER BY ahm.LHeadName
    `);

    const banks = bankResult.recordset.map((b) => ({
      id: b.BId,
      name: b.BName,
      companyId: b.CompanyId ?? null,
      companyName: b.CompanyName ?? null,
    }));

    res.json({ companies: companyResult.recordset, banks });
  } catch (err) {
    console.error("BRS filters error:", err);
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brs  —  unified list: NewPayment + ReceivedPayment rows that have a bank
//              linked, surfaced as BRS entries with clear/unclear status.
//
// Query params:
//   bankId      INT    filter by bank
//   companyId   INT    filter by company (matched via bank's CompanyName)
//   fromDate    DATE   payment date range start  (YYYY-MM-DD)
//   toDate      DATE   payment date range end    (YYYY-MM-DD)
//   status      STRING "clear" | "unclear"  (IsMatched 1/0 in BankReconciliation)
//   page        INT    default 1
//   limit       INT    default 20, max 100
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", cache("brs", 60), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    // ── WHERE clause for the unified UNION CTE ───────────────────────────────
    // companyName is passed as the enterprise name string for reliable matching
    const { bankId, companyName, fromDate, toDate, status, hideDummyBank } = req.query;

    const conditions = ["1=1"];
    if (bankId) conditions.push("u.BankID      = @bankId");
    if (companyName) conditions.push("u.CompanyName = @companyName");
    if (fromDate) conditions.push("u.PayDate    >= @fromDate");
    if (toDate) conditions.push("u.PayDate    <= @toDate");
    if (status === "clear")   conditions.push("u.IsMatched = 1");
    if (status === "unclear") conditions.push("u.IsMatched = 0 AND u.IsBounced = 0");
    if (status === "bounced") conditions.push("u.IsBounced = 1");
    if (hideDummyBank === "true") conditions.push(
      "NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster _ahm WHERE _ahm.LHeadId = u.BankID AND _ahm.LHeadCode = 'DUMMY-BANK')"
    );

    const where = "WHERE " + conditions.join(" AND ");

    // Helper: bind params onto a request object
    const bind = (r) => {
      if (bankId) r.input("bankId", sql.Int, parseInt(bankId));
      if (companyName) r.input("companyName", sql.NVarChar(255), companyName);
      if (fromDate) r.input("fromDate", sql.Date, fromDate);
      if (toDate) r.input("toDate", sql.Date, toDate);
      return r;
    };

    // ── Base CTE: merge NewPayment + ReceivedPayment ─────────────────────────
    //   We LEFT JOIN BankReconciliation by (source, sourceId) to get IsMatched.
    //   Payments that have no BRS row are surfaced as "unclear" (IsMatched=0).
    const baseCte = `
      WITH UnifiedPayments AS (
        -- Outgoing payments (NewPayment)
        SELECT
          np.PPaymentID            AS SourceID,
          'PAYMENT'                AS SourceType,
          np.PPaymentName          AS PaymentName,
          ISNULL(ent.name, np.PCompany) AS CompanyName,
          ent.id                   AS CompanyID,
          np.PBankID               AS BankID,
          np.PBankName             AS BankName,
          np.PAmount               AS Amount,
          np.PDate                 AS PayDate,
          np.PMode                 AS Mode,
          np.DocNo                 AS DocNo,
          -- Transaction ID: digital ref takes priority, then cheque
          COALESCE(
            np.PNeftNumber,
            np.PUpiTransactionId,
            np.PRtgsReference,
            np.PImpsReference,
            np.PChequeNo
          )                        AS TxnId,
          np.Status                AS PayStatus,
          np.PCreatedAt            AS CreatedAt,
          np.PChequeNo             AS ChequeNo,
          np.PChequeLotNumber      AS ChequeLotNumber,
          COALESCE(ep.name, np.PProject) AS ProjectName,
          COALESCE(brc.IsMatched, 0)  AS IsMatched,
          COALESCE(brc.IsBounced, 0)  AS IsBounced,
          brc.BounceDate           AS BounceDate,
          brc.BounceReason         AS BounceReason,
          brc.BounceRemarks        AS BounceRemarks,
          brc.BRSID                AS BRSID,
          -- Clearing timestamp: FORMAT() returns a plain string so mssql does not
          -- reinterpret the IST DATETIME2 value as UTC (which would add +5:30 in the browser).
          CASE WHEN brc.IsMatched = 1 THEN FORMAT(brc.UpdatedAt, 'yyyy-MM-ddTHH:mm:ss') ELSE NULL END AS ClearingDate,
          -- Re-issue chain: DocNo of the payment that replaced this one (if any)
          repl.DocNo               AS ReplacementDocNo,
          repl.PPaymentID          AS ReplacementPaymentId,
          -- Re-issue chain: DocNo of the bounced payment this one replaced (if any)
          orig.DocNo               AS OriginalDocNo,
          orig.PPaymentID          AS OriginalPaymentId
        FROM dbo.NewPayment np
        LEFT JOIN dbo.NewPayment repl
          ON  repl.ReplacesPaymentId = np.PPaymentID
          AND repl.Status NOT IN ('Draft', 'Rejected')
        LEFT JOIN dbo.NewPayment orig
          ON  orig.PPaymentID = np.ReplacesPaymentId
        LEFT JOIN dbo.enterprise ent
          ON  ent.business_type = 'C'
          AND (
            ent.name = np.PCompany
            OR (
              TRY_CAST(np.PCompany AS INT) IS NOT NULL
              AND ent.id = TRY_CAST(np.PCompany AS INT)
            )
          )
        LEFT JOIN dbo.enterprise ep
          ON  ep.business_type = 'P'
          AND TRY_CAST(np.PProject AS INT) IS NOT NULL
          AND ep.id = TRY_CAST(np.PProject AS INT)
        LEFT JOIN BankReconciliation brc
          ON  brc.SourceType = 'PAYMENT'
          AND brc.SourceID   = np.PPaymentID
        -- Cash payments never hit a bank, so they're rightly excluded from BRS.
        -- Every other mode belongs here even if PBankID wasn't captured at
        -- save time (PBankID is nullable — see migration 089).
        WHERE ISNULL(np.PMode, '') <> 'Cash'
          AND ISNULL(np.Status, 'Draft') NOT IN ('Draft', 'Rejected')

        UNION ALL

        -- Incoming payments (ReceivedPayment)
        SELECT
          rp.RPPaymentID           AS SourceID,
          'RECEIVED'               AS SourceType,
          ISNULL(rp.RPCustomerName, rp.RPReceivedFrom) AS PaymentName,
          rp.RPCompanyName         AS CompanyName,
          ent2.id                  AS CompanyID,
          -- Prefer RPDepositBankId (accurate FK), fall back to name-match
          COALESCE(rp.RPDepositBankId, bk.LHeadId) AS BankID,
          ISNULL(rp.RPDepositBankName, rp.RPBankName) AS BankName,
          rp.RPAmount              AS Amount,
          rp.RPDocDate             AS PayDate,
          rp.RPMode                AS Mode,
          rp.RPDocNo               AS DocNo,
          COALESCE(
            rp.RPTransactionId,
            rp.RPCheckNumber
          )                        AS TxnId,
          rp.RPStatus              AS PayStatus,
          rp.RPCreatedAt           AS CreatedAt,
          rp.RPCheckNumber         AS ChequeNo,
          CAST(NULL AS NVARCHAR(100)) AS ChequeLotNumber,
          CAST(NULL AS NVARCHAR(200)) AS ProjectName,
          COALESCE(brc2.IsMatched, 0)  AS IsMatched,
          COALESCE(brc2.IsBounced, 0)  AS IsBounced,
          brc2.BounceDate          AS BounceDate,
          brc2.BounceReason        AS BounceReason,
          brc2.BounceRemarks       AS BounceRemarks,
          brc2.BRSID               AS BRSID,
          CASE WHEN brc2.IsMatched = 1 THEN FORMAT(brc2.UpdatedAt, 'yyyy-MM-ddTHH:mm:ss') ELSE NULL END AS ClearingDate,
          CAST(NULL AS NVARCHAR(100)) AS ReplacementDocNo,
          CAST(NULL AS INT)           AS ReplacementPaymentId,
          CAST(NULL AS NVARCHAR(100)) AS OriginalDocNo,
          CAST(NULL AS INT)           AS OriginalPaymentId
        FROM dbo.ReceivedPayment rp
        -- Join by ID first (reliable), then fall back to name match
        LEFT JOIN dbo.AccountHeadMaster bk
          ON  bk.LHeadType   = 'B'
          AND bk.LHeadStatus = 1
          AND bk.LHeadId     = rp.RPDepositBankId
        LEFT JOIN dbo.enterprise ent2
          ON  ent2.business_type = 'C'
          AND ent2.name          = rp.RPCompanyName
        LEFT JOIN BankReconciliation brc2
          ON  brc2.SourceType = 'RECEIVED'
          AND brc2.SourceID   = rp.RPPaymentID
        -- Show Pending and Approved — exclude Draft and Rejected
        WHERE (rp.RPDepositBankId IS NOT NULL OR rp.RPBankName IS NOT NULL)
          AND ISNULL(rp.RPStatus, 'Draft') NOT IN ('Draft', 'Rejected')
      )
    `;

    // ── Count ────────────────────────────────────────────────────────────────
    const countSql = `${baseCte}
      SELECT COUNT(*) AS total
      FROM UnifiedPayments u
      ${where}
    `;
    const countResult = await bind(pool.request()).query(countSql);
    const total = countResult.recordset[0].total;

    // ── Summary (totals for clear / unclear) ─────────────────────────────────
    const summarySql = `${baseCte}
      SELECT
        SUM(CASE WHEN u.IsMatched = 1 THEN u.Amount ELSE 0 END)  AS clearAmount,
        SUM(CASE WHEN u.IsMatched = 0 THEN u.Amount ELSE 0 END)  AS unclearAmount,
        SUM(CASE WHEN u.IsBounced = 1 THEN u.Amount ELSE 0 END)  AS bounceAmount,
        COUNT(CASE WHEN u.IsMatched = 1 THEN 1 END)              AS clearCount,
        COUNT(CASE WHEN u.IsMatched = 0 AND u.IsBounced = 0 THEN 1 END) AS unclearCount,
        COUNT(CASE WHEN u.IsBounced = 1 THEN 1 END)              AS bounceCount
      FROM UnifiedPayments u
      ${where}
    `;
    const summaryResult = await bind(pool.request()).query(summarySql);
    const { clearAmount, unclearAmount, bounceAmount, clearCount, unclearCount, bounceCount } =
      summaryResult.recordset[0];

    // ── Data ─────────────────────────────────────────────────────────────────
    const dataReq = bind(pool.request())
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit);

    const dataSql = `${baseCte}
      SELECT
        u.BRSID,
        u.SourceID,
        u.SourceType,
        u.PaymentName,
        u.CompanyName,
        u.CompanyID,
        u.BankID,
        u.BankName,
        u.Amount,
        u.PayDate,
        u.Mode,
        u.DocNo,
        u.TxnId,
        u.ChequeNo,
        u.PayStatus,
        u.IsMatched,
        u.IsBounced,
        u.BounceDate,
        u.BounceReason,
        u.BounceRemarks,
        u.ReplacementDocNo,
        u.ReplacementPaymentId,
        u.OriginalDocNo,
        u.OriginalPaymentId,
        u.ClearingDate,
        u.CreatedAt
      FROM UnifiedPayments u
      ${where}
      ORDER BY u.PayDate DESC, u.SourceID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const dataResult = await dataReq.query(dataSql);

    res.json({
      data: dataResult.recordset,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      clearAmount:   clearAmount   || 0,
      unclearAmount: unclearAmount || 0,
      bounceAmount:  bounceAmount  || 0,
      clearCount:    clearCount    || 0,
      unclearCount:  unclearCount  || 0,
      bounceCount:   bounceCount   || 0,
    });
  } catch (err) {
    console.error("BRS list error:", err);
    res.status(500).json({ error: "Failed to fetch BRS entries" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /brs/:sourceType/:sourceId/clear   — mark a payment as clear (matched)
// PUT /brs/:sourceType/:sourceId/unclear — mark a payment as unclear
//
// sourceType: PAYMENT | RECEIVED
// sourceId:   the primary key in the source table
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:sourceType/:sourceId/clear", async (req, res) => {
  const { sourceType, sourceId } = req.params;
  if (!["PAYMENT", "RECEIVED"].includes(sourceType))
    return res.status(400).json({ error: "Invalid sourceType" });

  try {
    const pool = getPool();

    // Upsert into BankReconciliation
    await pool
      .request()
      .input("SourceType", sql.NVarChar(20), sourceType)
      .input("SourceID", sql.Int, parseInt(sourceId)).query(`
        IF EXISTS (
          SELECT 1 FROM BankReconciliation
          WHERE SourceType = @SourceType AND SourceID = @SourceID
        )
          UPDATE BankReconciliation
          SET IsMatched = 1, UpdatedAt = GETDATE()
          WHERE SourceType = @SourceType AND SourceID = @SourceID
        ELSE
          INSERT INTO BankReconciliation (SourceType, SourceID, IsMatched, CreatedAt, UpdatedAt)
          VALUES (@SourceType, @SourceID, 1, GETDATE(), GETDATE())
      `);

    await bumpCacheVersion("brs");
    // The payment/received-payment list's DisplayStatus (Cheque Issued ->
    // Cheque Cleared) is derived from this same BankReconciliation row —
    // without bumping its cache too, the list keeps serving the stale
    // cached response for up to its 5-minute TTL even though the UI
    // refetches immediately on navigating back to it.
    await bumpCacheVersion(sourceType === "PAYMENT" ? "new-payment" : "received-payment");
    res.json({ message: "Marked as clear" });

    // Fire-and-forget — update invoice balance after responding so UI isn't blocked
    if (sourceType === "PAYMENT") {
      const pool2 = getPool();
      pool2.request()
        .input("PPaymentID", sql.Int, parseInt(sourceId))
        .query("SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID")
        .then((refRes) => {
          const expenseRef = refRes.recordset[0]?.PExpenseRef;
          if (expenseRef) return syncBillStatus(pool2, sql, expenseRef);
        })
        .catch((err) => console.warn("syncBillStatus after clear failed:", err.message));
    }
  } catch (err) {
    console.error("BRS clear error:", err);
    res.status(500).json({ error: "Failed to mark as clear" });
  }
});

router.put("/:sourceType/:sourceId/unclear", async (req, res) => {
  const { sourceType, sourceId } = req.params;
  if (!["PAYMENT", "RECEIVED"].includes(sourceType))
    return res.status(400).json({ error: "Invalid sourceType" });

  try {
    const pool = getPool();

    await pool
      .request()
      .input("SourceType", sql.NVarChar(20), sourceType)
      .input("SourceID", sql.Int, parseInt(sourceId)).query(`
        UPDATE BankReconciliation
        SET IsMatched = 0, UpdatedAt = GETDATE()
        WHERE SourceType = @SourceType AND SourceID = @SourceID
      `);

    await bumpCacheVersion("brs");
    await bumpCacheVersion(sourceType === "PAYMENT" ? "new-payment" : "received-payment");
    res.json({ message: "Marked as unclear" });
  } catch (err) {
    console.error("BRS unclear error:", err);
    res.status(500).json({ error: "Failed to mark as unclear" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /brs/:sourceType/:sourceId/bounce   — mark a payment as bounced/dishonoured
// PUT /brs/:sourceType/:sourceId/unbound  — clear the bounce flag
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:sourceType/:sourceId/bounce", async (req, res) => {
  const { sourceType, sourceId } = req.params;
  if (!["PAYMENT", "RECEIVED"].includes(sourceType))
    return res.status(400).json({ error: "Invalid sourceType" });

  const { bounceDate, bounceReason, bounceRemarks } = req.body;
  if (!bounceDate || !bounceReason)
    return res.status(400).json({ error: "bounceDate and bounceReason are required" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("SourceType",    sql.NVarChar(20),  sourceType)
      .input("SourceID",      sql.Int,            parseInt(sourceId))
      .input("BounceDate",    sql.Date,           bounceDate)
      .input("BounceReason",  sql.NVarChar(200),  bounceReason)
      .input("BounceRemarks", sql.NVarChar(500),  bounceRemarks || null)
      .query(`
        IF EXISTS (
          SELECT 1 FROM BankReconciliation
          WHERE SourceType = @SourceType AND SourceID = @SourceID
        )
          UPDATE BankReconciliation
          SET IsBounced     = 1,
              IsMatched     = 0,
              BounceDate    = @BounceDate,
              BounceReason  = @BounceReason,
              BounceRemarks = @BounceRemarks,
              UpdatedAt     = GETDATE()
          WHERE SourceType = @SourceType AND SourceID = @SourceID
        ELSE
          INSERT INTO BankReconciliation
            (SourceType, SourceID, IsMatched, IsBounced, BounceDate, BounceReason, BounceRemarks, CreatedAt)
          VALUES
            (@SourceType, @SourceID, 0, 1, @BounceDate, @BounceReason, @BounceRemarks, GETDATE())
      `);

    await bumpCacheVersion("brs");
    await bumpCacheVersion(sourceType === "PAYMENT" ? "new-payment" : "received-payment");
    res.json({ message: "Marked as bounced" });

    // Fire-and-forget — bounced cheques must not count as paid, update after responding
    if (sourceType === "PAYMENT") {
      const pool2 = getPool();
      pool2.request()
        .input("PPaymentID", sql.Int, parseInt(sourceId))
        .query("SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID")
        .then((refRes) => {
          const expenseRef = refRes.recordset[0]?.PExpenseRef;
          if (expenseRef) return syncBillStatus(pool2, sql, expenseRef);
        })
        .catch((err) => console.warn("syncBillStatus after bounce failed:", err.message));
    }
  } catch (err) {
    console.error("BRS bounce error:", err);
    res.status(500).json({ error: "Failed to mark as bounced" });
  }
});

// ── Legacy match/unmatch routes kept for backward compat ──────────────────────
router.put("/:id/match", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("UPDATE BankReconciliation SET IsMatched = 1 WHERE BRSID = @id");
    await bumpCacheVersion("brs");
    res.json({ message: "Marked as matched" });
  } catch (err) {
    res.status(500).json({ error: "Match failed" });
  }
});

router.put("/:id/unmatch", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("UPDATE BankReconciliation SET IsMatched = 0 WHERE BRSID = @id");
    await bumpCacheVersion("brs");
    res.json({ message: "Marked as unmatched" });
  } catch (err) {
    res.status(500).json({ error: "Unmatch failed" });
  }
});

// ── Auto-match (legacy) ───────────────────────────────────────────────────────
router.put("/auto-match", async (req, res) => {
  res.json({
    message: "Auto-match is not applicable to the unified BRS view.",
  });
});

module.exports = router;
