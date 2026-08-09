/**
 * balanceEnquiry.js — Finance → Balance Enquiry
 *
 * A bank "passbook" view: pick a bank account (dbo.AccountHeadMaster,
 * LHeadType='B' — there is no separate BankMaster table), see its opening
 * balance, a running transaction history, and a robustly-computed current
 * balance.
 *
 * Robustness: dbo.GeneralLedgerEntry is the single canonical ledger table —
 * every module that ever moves money in/out of a bank (Payment, Received
 * Payment, Journal Voucher, Fund Transfer, bounce charges) posts into it via
 * services/generalLedger.js's postVoucher(), and CK_GLE_OneSided guarantees
 * every row is strictly one-sided (debit XOR credit). So
 *   balance = BankOpeningBalance + SUM(DebitAmount) - SUM(CreditAmount)
 * over WHERE LHeadId = @bankId AND IsReversed = 0 is a complete accounting
 * of every transaction that ever touched this specific bank account,
 * regardless of which module originated it or which company it was posted
 * under (a bank is never filtered by CompanyId — the same physical account
 * can legitimately carry postings tagged to different companies, e.g. an
 * inter-company Fund Transfer's destination leg).
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// A bank is a row in AccountHeadMaster — company is stored as a free-text
// name (CompanyName), not an FK, mirroring how Fund Transfer resolves it.
const BANK_SELECT = `
  ahm.LHeadId                          AS BId,
  ISNULL(ahm.DisplayName, ahm.LHeadName) AS BName,
  ahm.LBranchName                      AS BBranch,
  ahm.LAccountNo                       AS BAccountNumber,
  ahm.LIFSCCode                        AS BIfscCode,
  ahm.LAccountType                     AS BAccountType,
  ahm.LBankType                        AS BBankType,
  ISNULL(ahm.BankOpeningBalance, 0)    AS BOpeningBalance,
  ahm.CompanyName                      AS BCompanyName,
  ahm.LHeadStatus                      AS BStatus
`;

// ── GET /banks — bank accounts eligible for enquiry ────────────────────────────
// Excludes the system "DUMMY-BANK" placeholder (used internally for synthetic
// contra postings, not a real account). Optional ?companyName= filter.
router.get("/banks", requirePageRight("balance-enquiry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const companyName = req.query.companyName ? String(req.query.companyName).trim() : "";

    const request = pool.request();
    let where = "WHERE ahm.LHeadType = 'B' AND ISNULL(ahm.LHeadCode, '') <> 'DUMMY-BANK'";
    if (companyName) {
      request.input("CompanyName", sql.NVarChar(500), companyName);
      where += " AND ahm.CompanyName = @CompanyName";
    }

    const result = await request.query(`
      SELECT ${BANK_SELECT}
      FROM dbo.AccountHeadMaster ahm
      ${where}
      ORDER BY ahm.CompanyName, ISNULL(ahm.DisplayName, ahm.LHeadName)
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("BALANCE ENQUIRY BANKS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Shared: resolve a bank row (404 if not a real bank head).
async function loadBank(pool, bankId) {
  const result = await pool.request().input("BId", sql.Int, bankId).query(`
    SELECT ${BANK_SELECT}
    FROM dbo.AccountHeadMaster ahm
    WHERE ahm.LHeadId = @BId AND ahm.LHeadType = 'B'
  `);
  return result.recordset[0] || null;
}

// ── GET /:bankId/summary — headline figures ─────────────────────────────────────
// currentBalance is always all-time (opening + every non-reversed ledger row
// ever posted) — the "real" balance today, independent of whatever date
// range the transaction list below is filtered to.
router.get("/:bankId/summary", requirePageRight("balance-enquiry", "view"), async (req, res) => {
  const bankId = parseInt(req.params.bankId, 10);
  if (!bankId) return res.status(400).json({ error: "Invalid bank id" });

  try {
    const pool = getPool();
    const bank = await loadBank(pool, bankId);
    if (!bank) return res.status(404).json({ error: "Bank account not found" });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const request = pool.request().input("BId", sql.Int, bankId);
    if (from) request.input("From", sql.Date, from);
    if (to) request.input("To", sql.Date, to);

    const result = await request.query(`
      SELECT
        -- All-time net movement — the true current balance.
        ISNULL(SUM(gle.DebitAmount), 0) - ISNULL(SUM(gle.CreditAmount), 0) AS AllTimeNet,
        -- Opening balance for the requested window: everything before @From.
        ISNULL(SUM(CASE WHEN @From IS NOT NULL AND gle.VoucherDate < @From
                         THEN gle.DebitAmount ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN @From IS NOT NULL AND gle.VoucherDate < @From
                           THEN gle.CreditAmount ELSE 0 END), 0) AS PreWindowNet,
        -- Movement within the requested window (for the period stat tiles).
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
      WHERE gle.LHeadId = @BId AND gle.IsReversed = 0
    `);

    const row = result.recordset[0] || {};
    const opening = Number(bank.BOpeningBalance || 0);
    const currentBalance = opening + Number(row.AllTimeNet || 0);
    const windowOpeningBalance = opening + Number(row.PreWindowNet || 0);

    res.json({
      bank,
      openingBalance: opening,
      currentBalance,
      windowOpeningBalance: from ? windowOpeningBalance : opening,
      periodDebit: Number(row.PeriodDebit || 0),
      periodCredit: Number(row.PeriodCredit || 0),
      periodTxnCount: Number(row.PeriodTxnCount || 0),
      lastTransactionDate: row.LastTransactionDate || null,
    });
  } catch (err) {
    console.error("BALANCE ENQUIRY SUMMARY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:bankId/transactions — the passbook itself ─────────────────────────────
// Rows are returned newest-first for display, but the running balance is
// computed over ASCENDING date/entry order (how a real passbook accumulates)
// seeded from the pre-window opening balance, then reversed for the response.
router.get("/:bankId/transactions", requirePageRight("balance-enquiry", "view"), async (req, res) => {
  const bankId = parseInt(req.params.bankId, 10);
  if (!bankId) return res.status(400).json({ error: "Invalid bank id" });

  try {
    const pool = getPool();
    const bank = await loadBank(pool, bankId);
    if (!bank) return res.status(404).json({ error: "Bank account not found" });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 2000);

    const request = pool.request().input("BId", sql.Int, bankId).input("Limit", sql.Int, limit);
    if (from) request.input("From", sql.Date, from);
    if (to) request.input("To", sql.Date, to);

    // Pre-window opening: opening balance + everything strictly before @From.
    const openingResult = await request.query(`
      SELECT ISNULL(ahm.BankOpeningBalance, 0)
           + ISNULL((
               SELECT SUM(g.DebitAmount) - SUM(g.CreditAmount)
               FROM dbo.GeneralLedgerEntry g
               WHERE g.LHeadId = @BId AND g.IsReversed = 0
                 AND @From IS NOT NULL AND g.VoucherDate < @From
             ), 0) AS WindowOpening
      FROM dbo.AccountHeadMaster ahm
      WHERE ahm.LHeadId = @BId
    `);
    const windowOpening = Number(openingResult.recordset[0]?.WindowOpening || bank.BOpeningBalance || 0);

    const request2 = pool.request().input("BId", sql.Int, bankId).input("Limit", sql.Int, limit).input("Opening", sql.Decimal(18, 2), windowOpening);
    if (from) request2.input("From", sql.Date, from);
    if (to) request2.input("To", sql.Date, to);

    const result = await request2.query(`
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
          @Opening + SUM(gle.DebitAmount - gle.CreditAmount)
            OVER (ORDER BY gle.VoucherDate, gle.EntryId ROWS UNBOUNDED PRECEDING) AS RunningBalance
        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = gle.CostCenterId
        LEFT JOIN dbo.NewPayment np
          ON gle.SourceType IN ('NewPayment', 'PaymentPosting', 'BounceChargePosting')
         AND np.PPaymentID = gle.SourceId
        LEFT JOIN dbo.ReceivedPayment rp
          ON gle.SourceType = 'ReceivedPayment' AND rp.RPPaymentID = gle.SourceId
        LEFT JOIN dbo.JournalVoucher jv
          ON gle.SourceType = 'JournalVoucher' AND jv.JVID = gle.SourceId
        LEFT JOIN dbo.FundTransfer ft
          ON gle.SourceType = 'FundTransfer' AND ft.FTId = gle.SourceId
        WHERE gle.LHeadId = @BId AND gle.IsReversed = 0
          AND (@From IS NULL OR gle.VoucherDate >= @From)
          AND (@To IS NULL OR gle.VoucherDate <= @To)
      ) t
      ORDER BY t.VoucherDate DESC, t.EntryId DESC
    `);

    res.json({
      bank,
      windowOpeningBalance: windowOpening,
      transactions: result.recordset,
    });
  } catch (err) {
    console.error("BALANCE ENQUIRY TRANSACTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
