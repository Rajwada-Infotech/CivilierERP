"use strict";

/**
 * backend/routes/pdcReport.js
 *
 * PDC (Post-Dated Cheque) Tracking — implemented as a reporting/reminder
 * layer over the existing NewPayment / ReceivedPayment / BankReconciliation
 * tables rather than a new source-of-truth table. Cheque data already lives
 * on those tables (NewPayment: PChequeNo/PChequeDate/PIsPostDated/PBankID/
 * PPartyId; ReceivedPayment: RPCheckNumber/RPChequeDate/RPIsPostDated/
 * RPDepositBankId), and clear/bounce status already flows through
 * BankReconciliation via brs.js's clear/unclear/bounce routes — a separate
 * PDC_Cheques table would just be a second copy of the same facts, able to
 * drift the moment someone edits a payment without remembering to update it
 * too. This mirrors brs.js's UnifiedPayments CTE pattern, filtered down to
 * cheque-mode rows only.
 *
 * "Is this a PDC" — a cheque counts as post-dated if EITHER the user
 * explicitly flagged it (PIsPostDated / RPIsPostDated, set when the mode is
 * chosen as "Post-Dated Cheque" on the Payment page, or the new Post-dated
 * checkbox on Received Payment) OR its cheque date is in the future — either
 * signal is enough, matching how the existing Payment page's PDC option
 * already works.
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    validate: false,
    message: { error: "Too many requests, please try again later." },
  }),
);
const sql = require("mssql");
const { getPool } = require("../db");
const { cache } = require("../middleware/cache");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "Reports"));

// Every cheque-bearing row from both payment tables, joined to
// BankReconciliation for clear/bounce status and AccountHeadMaster for
// bank/party names — the same shape brs.js's UnifiedPayments CTE builds,
// just scoped to cheque-mode rows and carrying cheque_date through.
const UNIFIED_CHEQUES_CTE = `
  WITH UnifiedCheques AS (
    -- Payable — outgoing cheques (NewPayment)
    SELECT
      np.PPaymentID              AS SourceID,
      'PAYMENT'                  AS SourceType,
      'Payable'                  AS Direction,
      np.PCompanyId               AS CompanyId,
      np.PPartyId                AS PartyID,
      np.PPaymentName            AS PartyName,
      np.PBankID                 AS BankID,
      np.PBankName               AS BankName,
      np.PChequeNo                AS ChequeNo,
      np.PChequeDate              AS ChequeDate,
      np.PAmount                  AS Amount,
      np.DocNo                    AS DocNo,
      np.Status                   AS PayStatus,
      CASE WHEN np.PIsPostDated = 1 OR np.PChequeDate > CAST(GETDATE() AS DATE)
           THEN 1 ELSE 0 END      AS IsPostDated,
      TRY_CAST(np.PProject AS INT) AS ProjectID,
      COALESCE(brc.IsMatched, 0)  AS IsMatched,
      COALESCE(brc.IsBounced, 0)  AS IsBounced,
      brc.BounceDate              AS BounceDate,
      brc.BounceReason            AS BounceReason,
      CASE WHEN brc.IsMatched = 1
           THEN FORMAT(brc.UpdatedAt, 'yyyy-MM-dd')
           ELSE NULL END          AS ClearedDate
    FROM dbo.NewPayment np
    LEFT JOIN BankReconciliation brc
      ON  brc.SourceType = 'PAYMENT'
      AND brc.SourceID   = np.PPaymentID
    WHERE np.PMode IN ('Cheque', 'Post-Dated Cheque')
      AND np.PChequeNo IS NOT NULL
      AND ISNULL(np.Status, 'Draft') NOT IN ('Draft', 'Rejected')

    UNION ALL

    -- Receivable — incoming cheques (ReceivedPayment)
    SELECT
      rp.RPPaymentID              AS SourceID,
      'RECEIVED'                  AS SourceType,
      'Receivable'                 AS Direction,
      rp.RPCompanyId               AS CompanyId,
      CAST(NULL AS INT)            AS PartyID,
      ISNULL(rp.RPCustomerName, rp.RPReceivedFrom) AS PartyName,
      rp.RPDepositBankId           AS BankID,
      ISNULL(rp.RPDepositBankName, rp.RPBankName)  AS BankName,
      rp.RPCheckNumber             AS ChequeNo,
      rp.RPChequeDate              AS ChequeDate,
      rp.RPAmount                  AS Amount,
      ISNULL(rp.RPDocNo, CAST(rp.RPPaymentID AS NVARCHAR(20))) AS DocNo,
      rp.RPStatus                  AS PayStatus,
      CASE WHEN rp.RPIsPostDated = 1 OR rp.RPChequeDate > CAST(GETDATE() AS DATE)
           THEN 1 ELSE 0 END       AS IsPostDated,
      rp.RPProjectId                AS ProjectID,
      COALESCE(brc2.IsMatched, 0)  AS IsMatched,
      COALESCE(brc2.IsBounced, 0)  AS IsBounced,
      brc2.BounceDate              AS BounceDate,
      brc2.BounceReason            AS BounceReason,
      CASE WHEN brc2.IsMatched = 1
           THEN FORMAT(brc2.UpdatedAt, 'yyyy-MM-dd')
           ELSE NULL END           AS ClearedDate
    FROM dbo.ReceivedPayment rp
    LEFT JOIN BankReconciliation brc2
      ON  brc2.SourceType = 'RECEIVED'
      AND brc2.SourceID   = rp.RPPaymentID
    WHERE rp.RPMode IN ('Check', 'Cheque', 'Post-Dated Cheque')
      AND rp.RPCheckNumber IS NOT NULL
      AND ISNULL(rp.RPStatus, 'Draft') NOT IN ('Draft', 'Rejected')
  )
`;

// Resolves the raw IsMatched/IsBounced/ChequeDate columns into the single
// status label the report/reminders key off — matches the spec's status
// lifecycle exactly (Pending / Cleared / Bounced), plus an Overdue flag for
// Pending cheques whose date has already passed without being cleared.
const STATUS_CASE = `
  CASE
    WHEN u.IsBounced = 1 THEN 'Bounced'
    WHEN u.IsMatched = 1 THEN 'Cleared'
    WHEN u.ChequeDate < CAST(GETDATE() AS DATE) THEN 'Overdue'
    ELSE 'Pending'
  END
`;

// ─── GET /filters — party/bank dropdown sources for the report's filter bar ──
router.get("/filters", cache("pdc-report-filters", 300), async (req, res) => {
  try {
    const pool = getPool();
    const banks = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'B' AND LHeadStatus = 1
      ORDER BY LHeadName
    `);
    const parties = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name, LHeadType AS type
      FROM dbo.AccountHeadMaster
      WHERE LHeadType IN ('S', 'C', 'A') AND LHeadStatus = 1
      ORDER BY LHeadName
    `);
    res.json({ banks: banks.recordset, parties: parties.recordset });
  } catch (err) {
    console.error("PDC report filters error:", err.message);
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

// ─── GET / — paginated PDC report ───────────────────────────────────────────
// Query params: direction (Payable|Receivable), status (Pending|Presented|
// Cleared|Bounced|Cancelled — Cancelled has no source row so never matches),
// bankId, partyId, projectId, from, to (cheque_date range), page, limit.
router.get("/", cache("pdc-report", 60), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
    const offset = (page - 1) * limit;
    const { direction, status, bankId, partyId, projectId, from, to, companyId } = req.query;

    const conditions = ["1=1"];
    if (companyId) conditions.push("u.CompanyId = @companyId");
    if (direction) conditions.push("u.Direction = @direction");
    if (bankId) conditions.push("u.BankID = @bankId");
    if (partyId) conditions.push("u.PartyID = @partyId");
    // project_id is nullable (a party-level cheque not tied to one project) —
    // filtering must not silently drop those rows, so this only narrows when
    // a project filter is actually requested, never adds an implicit
    // "ProjectID IS NOT NULL" to the base query.
    if (projectId) conditions.push("u.ProjectID = @projectId");
    if (from) conditions.push("u.ChequeDate >= @from");
    if (to) conditions.push("u.ChequeDate <= @to");
    if (status) conditions.push(`${STATUS_CASE} = @status`);

    const where = "WHERE " + conditions.join(" AND ");
    const bind = (r) => {
      if (companyId) r.input("companyId", sql.Int, parseInt(companyId, 10));
      if (direction) r.input("direction", sql.NVarChar(20), direction);
      if (bankId) r.input("bankId", sql.Int, parseInt(bankId, 10));
      if (partyId) r.input("partyId", sql.Int, parseInt(partyId, 10));
      if (projectId) r.input("projectId", sql.Int, parseInt(projectId, 10));
      if (from) r.input("from", sql.Date, from);
      if (to) r.input("to", sql.Date, to);
      if (status) r.input("status", sql.NVarChar(20), status);
      return r;
    };

    const countSql = `${UNIFIED_CHEQUES_CTE}
      SELECT COUNT(*) AS total FROM UnifiedCheques u ${where}`;
    const countResult = await bind(pool.request()).query(countSql);
    const total = countResult.recordset[0].total;

    const dataReq = bind(pool.request())
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit);
    const dataSql = `${UNIFIED_CHEQUES_CTE}
      SELECT
        u.SourceID, u.SourceType, u.Direction,
        u.PartyID, u.PartyName,
        u.BankID, u.BankName,
        u.ChequeNo, u.ChequeDate, u.Amount, u.DocNo,
        u.IsPostDated, u.ProjectID,
        ${STATUS_CASE} AS Status,
        u.ClearedDate, u.BounceDate, u.BounceReason,
        DATEDIFF(day, CAST(GETDATE() AS DATE), u.ChequeDate) AS DaysRemaining,
        CASE
          WHEN u.IsBounced = 1 THEN NULL
          WHEN u.IsMatched = 1 THEN u.ClearedDate
          ELSE CONVERT(NVARCHAR(10), u.ChequeDate, 23)
        END AS ExpectedPaymentDate
      FROM UnifiedCheques u
      ${where}
      ORDER BY u.ChequeDate ASC, u.SourceID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;
    const dataResult = await dataReq.query(dataSql);

    res.json({
      data: dataResult.recordset,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("PDC report error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /due-count — reminder bell pill: due-soon + overdue counts ─────────
router.get("/due-count", cache("pdc-due-count", 60), async (req, res) => {
  try {
    const pool = getPool();
    const thresholdDays = Math.max(
      parseInt(req.query.thresholdDays, 10) || 3,
      0,
    );
    const result = await pool
      .request()
      .input("thresholdDays", sql.Int, thresholdDays).query(`
        ${UNIFIED_CHEQUES_CTE}
        SELECT
          COUNT(CASE WHEN ${STATUS_CASE} = 'Pending'
                      AND u.ChequeDate BETWEEN CAST(GETDATE() AS DATE)
                                            AND DATEADD(day, @thresholdDays, CAST(GETDATE() AS DATE))
                     THEN 1 END) AS dueSoonCount,
          COUNT(CASE WHEN ${STATUS_CASE} = 'Overdue' THEN 1 END) AS overdueCount
        FROM UnifiedCheques u
      `);
    const row = result.recordset[0] || {};
    res.json({
      dueSoonCount: row.dueSoonCount || 0,
      overdueCount: row.overdueCount || 0,
    });
  } catch (err) {
    console.error("PDC due-count error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
