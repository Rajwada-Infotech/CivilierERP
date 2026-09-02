/**
 * vendorLedger.js — Finance → Vendor Ledger Report
 *
 * A party "passbook": search any AccountHeadMaster row by name — supplier,
 * customer, contractor, broker, loan counterparty, or any other ledger head —
 * and see every transaction ever posted against it (invoices, payments,
 * loans, journal vouchers, fund transfers, GRNs...), with a running balance.
 * Same evidence and pattern as balanceEnquiry.js (dbo.GeneralLedgerEntry is
 * the single canonical, provably-complete ledger table — every module that
 * ever posts against a party head goes through services/generalLedger.js's
 * postVoucher()), just not restricted to LHeadType='B' banks and searched by
 * name instead of picked from a company-scoped dropdown.
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authenticateToken = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(authenticateToken);
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

const HEAD_SELECT = `
  ahm.LHeadId                            AS Id,
  ISNULL(ahm.DisplayName, ahm.LHeadName) AS Name,
  ahm.LHeadType                          AS Type,
  ahm.LHeadCode                          AS Code,
  ahm.CompanyName                        AS CompanyName
`;

// ── GET /search?q= — find a party/GL head by name ───────────────────────────
router.get("/search", requirePageRight("vendor-ledger", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const q = req.query.q ? String(req.query.q).trim() : "";
    if (q.length < 2) return res.json([]);

    const result = await pool.request().input("Q", sql.NVarChar(200), `%${q}%`).query(`
      SELECT TOP 30 ${HEAD_SELECT}
      FROM dbo.AccountHeadMaster ahm
      WHERE ahm.LHeadStatus = 1
        AND (ahm.LHeadName LIKE @Q OR ahm.DisplayName LIKE @Q OR ahm.LHeadCode LIKE @Q)
      ORDER BY ISNULL(ahm.DisplayName, ahm.LHeadName)
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("VENDOR LEDGER SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Shared: resolve a head row (404 if not found / inactive).
async function loadHead(pool, headId) {
  const result = await pool.request().input("Id", sql.Int, headId).query(`
    SELECT ${HEAD_SELECT}
    FROM dbo.AccountHeadMaster ahm
    WHERE ahm.LHeadId = @Id AND ahm.LHeadStatus = 1
  `);
  return result.recordset[0] || null;
}

// Opening-balance-equivalent baked into the head itself, same convention
// financialStatements.js's /balance-sheet uses: BankOpeningBalance for a
// bank head, OnAccountBalance for a Supplier/Customer head — never both,
// harmless to always select since the other column is just null/0 for any
// other type.
const OPENING_ADJ_SQL = `
  ISNULL(ahm.BankOpeningBalance, 0)
  + CASE WHEN ahm.LHeadType IN ('S', 'C') THEN ISNULL(ahm.OnAccountBalance, 0) ELSE 0 END
`;

// ── GET /:headId/summary — headline figures ─────────────────────────────────
router.get("/:headId/summary", requirePageRight("vendor-ledger", "view"), async (req, res) => {
  const headId = parseInt(req.params.headId, 10);
  if (!headId) return res.status(400).json({ error: "Invalid head id" });

  try {
    const pool = getPool();
    const head = await loadHead(pool, headId);
    if (!head) return res.status(404).json({ error: "Ledger head not found" });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const openingRes = await pool.request().input("Id", sql.Int, headId).query(`
      SELECT ${OPENING_ADJ_SQL} AS OpeningAdj FROM dbo.AccountHeadMaster ahm WHERE ahm.LHeadId = @Id
    `);
    const openingAdj = Number(openingRes.recordset[0]?.OpeningAdj || 0);

    const result = await pool
      .request()
      .input("Id", sql.Int, headId)
      .input("From", sql.Date, from || null)
      .input("To", sql.Date, to || null).query(`
      SELECT
        ISNULL(SUM(gle.DebitAmount), 0) - ISNULL(SUM(gle.CreditAmount), 0) AS AllTimeNet,
        ISNULL(SUM(CASE WHEN @From IS NOT NULL AND gle.VoucherDate < @From
                         THEN gle.DebitAmount ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN @From IS NOT NULL AND gle.VoucherDate < @From
                           THEN gle.CreditAmount ELSE 0 END), 0) AS PreWindowNet,
        ISNULL(SUM(CASE WHEN (@From IS NULL OR gle.VoucherDate >= @From)
                          AND (@To IS NULL OR gle.VoucherDate <= @To)
                         THEN gle.DebitAmount ELSE 0 END), 0) AS PeriodDebit,
        ISNULL(SUM(CASE WHEN (@From IS NULL OR gle.VoucherDate >= @From)
                          AND (@To IS NULL OR gle.VoucherDate <= @To)
                         THEN gle.CreditAmount ELSE 0 END), 0) AS PeriodCredit,
        COUNT(CASE WHEN (@From IS NULL OR gle.VoucherDate >= @From)
                     AND (@To IS NULL OR gle.VoucherDate <= @To)
                   THEN 1 END) AS PeriodTxnCount,
        MAX(gle.VoucherDate) AS LastTransactionDate
      FROM dbo.GeneralLedgerEntry gle
      WHERE gle.LHeadId = @Id AND gle.IsReversed = 0
    `);

    const row = result.recordset[0] || {};
    const currentBalance = openingAdj + Number(row.AllTimeNet || 0);
    const windowOpeningBalance = openingAdj + Number(row.PreWindowNet || 0);

    res.json({
      head,
      openingBalance: openingAdj,
      currentBalance,
      windowOpeningBalance: from ? windowOpeningBalance : openingAdj,
      periodDebit: Number(row.PeriodDebit || 0),
      periodCredit: Number(row.PeriodCredit || 0),
      periodTxnCount: Number(row.PeriodTxnCount || 0),
      lastTransactionDate: row.LastTransactionDate || null,
    });
  } catch (err) {
    console.error("VENDOR LEDGER SUMMARY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:headId/transactions — the ledger itself ───────────────────────────
// Every invoice (ExpenseBooking), loan (LoanPosting/LoanRepayment), payment
// (NewPayment/ReceivedPayment) and journal voucher (JournalVoucher) made
// against this party, in one running-balance list.
router.get("/:headId/transactions", requirePageRight("vendor-ledger", "view"), async (req, res) => {
  const headId = parseInt(req.params.headId, 10);
  if (!headId) return res.status(400).json({ error: "Invalid head id" });

  try {
    const pool = getPool();
    const head = await loadHead(pool, headId);
    if (!head) return res.status(404).json({ error: "Ledger head not found" });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 2000);

    const openingResult = await pool
      .request()
      .input("Id", sql.Int, headId)
      .input("From", sql.Date, from || null).query(`
      SELECT ${OPENING_ADJ_SQL}
           + ISNULL((
               SELECT SUM(g.DebitAmount) - SUM(g.CreditAmount)
               FROM dbo.GeneralLedgerEntry g
               WHERE g.LHeadId = @Id AND g.IsReversed = 0
                 AND @From IS NOT NULL AND g.VoucherDate < @From
             ), 0) AS WindowOpening
      FROM dbo.AccountHeadMaster ahm
      WHERE ahm.LHeadId = @Id
    `);
    const windowOpening = Number(openingResult.recordset[0]?.WindowOpening || 0);

    const result = await pool
      .request()
      .input("Id", sql.Int, headId)
      .input("Limit", sql.Int, limit)
      .input("Opening", sql.Decimal(18, 2), windowOpening)
      .input("From", sql.Date, from || null)
      .input("To", sql.Date, to || null).query(`
      SELECT TOP (@Limit) *
      FROM (
        SELECT
          gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.DebitAmount, gle.CreditAmount,
          gle.Narration, gle.SourceType, gle.SourceId, gle.CompanyId, gle.ProjectId, gle.CostCenterId,
          cc.Code AS CostCenterCode, cc.Name AS CostCenterName,
          np.DocNo   AS NewPaymentDocNo,
          rp.RPDocNo AS ReceivedPaymentDocNo,
          jv.JVNo    AS JournalVoucherNo,
          ft.DocNo   AS FundTransferDocNo,
          eb.EDocNo  AS ExpenseBookingDocNo,
          ls.LoanNo  AS LoanDocNo,
          @Opening + SUM(gle.DebitAmount - gle.CreditAmount)
            OVER (ORDER BY gle.VoucherDate, gle.EntryId ROWS UNBOUNDED PRECEDING) AS RunningBalance
        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = gle.CostCenterId
        LEFT JOIN dbo.NewPayment np
          ON gle.SourceType IN ('NewPayment', 'PaymentPosting', 'BounceChargePosting', 'LoanRepayment')
         AND np.PPaymentID = gle.SourceId
        LEFT JOIN dbo.ReceivedPayment rp
          ON gle.SourceType = 'ReceivedPayment' AND rp.RPPaymentID = gle.SourceId
        LEFT JOIN dbo.JournalVoucher jv
          ON gle.SourceType = 'JournalVoucher' AND jv.JVID = gle.SourceId
        LEFT JOIN dbo.FundTransfer ft
          ON gle.SourceType = 'FundTransfer' AND ft.FTId = gle.SourceId
        LEFT JOIN dbo.ExpenseBooking eb
          ON gle.SourceType = 'ExpenseBooking' AND eb.Eid = gle.SourceId
        LEFT JOIN dbo.LoanSanction ls
          ON gle.SourceType = 'LoanPosting' AND ls.LoanId = gle.SourceId
        WHERE gle.LHeadId = @Id AND gle.IsReversed = 0
          AND (@From IS NULL OR gle.VoucherDate >= @From)
          AND (@To IS NULL OR gle.VoucherDate <= @To)
      ) t
      ORDER BY t.VoucherDate DESC, t.EntryId DESC
    `);

    res.json({
      head,
      windowOpeningBalance: windowOpening,
      transactions: result.recordset,
    });
  } catch (err) {
    console.error("VENDOR LEDGER TRANSACTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
