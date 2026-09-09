/**
 * vendorLedger.js — Finance → Vendor Ledger Report
 *
 * A supplier's "passbook": search any AccountHeadMaster row of type 'S' by
 * name and see every transaction ever posted against it (invoices,
 * payments, journal vouchers, fund transfers...), with a running balance.
 * Same evidence and pattern as balanceEnquiry.js (dbo.GeneralLedgerEntry is
 * the single canonical, provably-complete ledger table — every module that
 * ever posts against a party head goes through services/generalLedger.js's
 * postVoucher()), just scoped to Suppliers and searched by name instead of
 * picked from a company-scoped dropdown.
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
        AND ahm.LHeadType = 'S'
        AND (ahm.LHeadName LIKE @Q OR ahm.DisplayName LIKE @Q OR ahm.LHeadCode LIKE @Q)
      ORDER BY ISNULL(ahm.DisplayName, ahm.LHeadName)
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("VENDOR LEDGER SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Shared: resolve a head row (404 if not found / inactive / not a Supplier).
async function loadHead(pool, headId) {
  const result = await pool.request().input("Id", sql.Int, headId).query(`
    SELECT ${HEAD_SELECT}
    FROM dbo.AccountHeadMaster ahm
    WHERE ahm.LHeadId = @Id AND ahm.LHeadStatus = 1 AND ahm.LHeadType = 'S'
  `);
  return result.recordset[0] || null;
}

// Bank's own manually-entered opening balance — same convention
// financialStatements.js's /balance-sheet uses. This is the ONLY flat,
// non-date-scoped adjustment left here: a Supplier/Contractor's on-account
// balance (AccountHeadMaster.OnAccountBalance) is deliberately NOT folded
// in this way anymore — unlike a bank's pre-cutover balance, every rupee of
// OnAccountBalance IS itemized in dbo.OnAccountLedger, and this report
// already merges those rows into the transaction list (fetchOnAccountRows
// below). Adding the flat cached total on top double-counted every advance
// payment — it showed up once as the "opening balance" and again as its
// own transaction row. Use onAccountNet() against fetchOnAccountRows()
// instead, scoped to before the report's own `from` date the same way GL
// activity is.
const OPENING_ADJ_SQL = `ISNULL(ahm.BankOpeningBalance, 0)`;

// Net contribution of a set of OnAccountLedger rows, in the same sign
// convention AccountHeadMaster.OnAccountBalance uses (CREDIT adds, DEBIT
// subtracts) — mirrors mapOnAccountRow's Debit/Credit mapping below.
// `beforeDate` scopes to rows strictly before it (for a report's "opening"
// balance); omit it to sum every row (for "current balance" / no window).
function onAccountNet(rows, beforeDate) {
  return rows
    .filter((r) => !beforeDate || new Date(r.TxnDate) < new Date(beforeDate))
    .reduce((s, r) => s + (r.TxnType === "CREDIT" ? Number(r.Amount) : -Number(r.Amount)), 0);
}

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
    const bankOpening = Number(openingRes.recordset[0]?.OpeningAdj || 0);

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
        AND gle.SourceType NOT IN ('GRN', 'GRNPosting')
    `);

    const row = result.recordset[0] || {};

    // On-account advances/applications (dbo.OnAccountLedger) never post a
    // GeneralLedgerEntry leg — merge their own contribution the same way
    // the transactions list does, instead of the old flat, always-included
    // AccountHeadMaster.OnAccountBalance (see OPENING_ADJ_SQL's comment).
    const oaRows = await fetchOnAccountRows(pool, headId);
    const oaAllTimeNet = onAccountNet(oaRows);
    const oaPreWindowNet = from ? onAccountNet(oaRows, from) : 0;
    const oaPeriodRows = oaRows.filter((r) => {
      const d = new Date(r.TxnDate);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to)) return false;
      return true;
    });
    // Same sign flip mapOnAccountRow uses — a CREDIT (advance) row counts
    // toward Period Debit, a DEBIT (applied) row toward Period Credit.
    const oaPeriodDebit = oaPeriodRows.filter((r) => r.TxnType === "CREDIT").reduce((s, r) => s + Number(r.Amount), 0);
    const oaPeriodCredit = oaPeriodRows.filter((r) => r.TxnType === "DEBIT").reduce((s, r) => s + Number(r.Amount), 0);

    const currentBalance = bankOpening + Number(row.AllTimeNet || 0) + oaAllTimeNet;
    const windowOpeningBalance = bankOpening + Number(row.PreWindowNet || 0) + oaPreWindowNet;
    const lastOaDate = oaPeriodRows.reduce((max, r) => (!max || new Date(r.TxnDate) > new Date(max) ? r.TxnDate : max), null);
    const lastTransactionDate = [row.LastTransactionDate, lastOaDate].filter(Boolean).sort().pop() || null;

    res.json({
      head,
      openingBalance: from ? windowOpeningBalance : bankOpening,
      currentBalance,
      windowOpeningBalance: from ? windowOpeningBalance : bankOpening,
      periodDebit: Number(row.PeriodDebit || 0) + oaPeriodDebit,
      periodCredit: Number(row.PeriodCredit || 0) + oaPeriodCredit,
      periodTxnCount: Number(row.PeriodTxnCount || 0) + oaPeriodRows.length,
      lastTransactionDate,
    });
  } catch (err) {
    console.error("VENDOR LEDGER SUMMARY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// A Supplier/Contractor "standalone advance" or "excess payment beyond the
// invoice" (see generalLedger.js's postPaymentApproval isStandaloneAdvance
// branch, and newPayment.js's excess/auto-apply hooks) is deliberately
// posted against the pooled "Company On Account A/c" head, not the party's
// own — dbo.OnAccountLedger is the only per-party record of it existing at
// all until/unless it's later applied to an invoice via the manual On A/C
// Adjustment page (the ONE path that does post a real GL entry against the
// party's own head, via postOnAccountAdjustment). CRM's own on-account flow
// is different — crmLedger.js posts CrmOnAccountPayment/CrmPaymentReceipt
// straight against the customer's own head, so those already show up via
// GeneralLedgerEntry and don't need this merge. Scoped to Supplier/
// Contractor only for that reason.
const ON_ACCOUNT_PARTY_TYPES = ["Supplier", "Contractor"];

async function fetchOnAccountRows(pool, headId) {
  const result = await pool.request().input("Id", sql.Int, headId).query(`
    SELECT OAId, PartyId, TxnDate, TxnType, Amount, RefType, RefDocNo, Notes, CompanyId, ProjectId
    FROM dbo.OnAccountLedger
    WHERE PartyId = @Id AND PartyType IN ('${ON_ACCOUNT_PARTY_TYPES.join("','")}')
  `);
  return result.recordset;
}

// Same sign convention onAccountNet() uses (CREDIT adds, DEBIT subtracts):
// a CREDIT row becomes a Debit-side amount and a DEBIT row a Credit-side
// amount here, so merging these rows into the GL-sourced transaction list
// and summing Debit-Credit produces the same net either way.
function mapOnAccountRow(r) {
  const amount = Number(r.Amount) || 0;
  const isCredit = r.TxnType === "CREDIT";
  return {
    EntryId: `OA-${r.OAId}`,
    VoucherNo: r.RefDocNo || `OA-${r.OAId}`,
    VoucherDate: r.TxnDate,
    DebitAmount: isCredit ? amount : 0,
    CreditAmount: isCredit ? 0 : amount,
    Narration: r.Notes || (isCredit ? "Advance / excess payment (on account)" : "On-account balance applied"),
    SourceType: isCredit ? "OnAccountAdvance" : "OnAccountApplied",
    SourceId: r.OAId,
    CompanyId: r.CompanyId,
    ProjectId: r.ProjectId,
    CostCenterCode: null,
    CostCenterName: null,
    NewPaymentDocNo: null,
    ReceivedPaymentDocNo: null,
    JournalVoucherNo: null,
    FundTransferDocNo: null,
    ExpenseBookingDocNo: null,
    VendorInvoiceNo: null,
    VendorInvoiceDate: null,
    LoanDocNo: null,
  };
}

// ── GET /:headId/transactions — the ledger itself ───────────────────────────
// Every invoice (ExpenseBooking), loan (LoanPosting/LoanRepayment), payment
// (NewPayment/ReceivedPayment), journal voucher (JournalVoucher), and
// pooled on-account advance/application (dbo.OnAccountLedger) made against
// this party, in one running-balance list.
router.get("/:headId/transactions", requirePageRight("vendor-ledger", "view"), async (req, res) => {
  const headId = parseInt(req.params.headId, 10);
  if (!headId) return res.status(400).json({ error: "Invalid head id" });

  try {
    const pool = getPool();
    const head = await loadHead(pool, headId);
    if (!head) return res.status(404).json({ error: "Ledger head not found" });

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    // This route pulls every matching GL row for the head unconditionally
    // (no SQL-level TOP below) — `limit` only slices the already-fetched,
    // already-sorted array just before responding, so raising it costs
    // nothing extra in DB work. 100000 is effectively "no cap" for a single
    // party's ledger, closing the "export only got what was on screen" gap.
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 100000);

    const openingResult = await pool
      .request()
      .input("Id", sql.Int, headId)
      .input("From", sql.Date, from || null).query(`
      SELECT ${OPENING_ADJ_SQL}
           + ISNULL((
               SELECT SUM(g.DebitAmount) - SUM(g.CreditAmount)
               FROM dbo.GeneralLedgerEntry g
               WHERE g.LHeadId = @Id AND g.IsReversed = 0
                 AND g.SourceType NOT IN ('GRN', 'GRNPosting')
                 AND @From IS NOT NULL AND g.VoucherDate < @From
             ), 0) AS WindowOpening
      FROM dbo.AccountHeadMaster ahm
      WHERE ahm.LHeadId = @Id
    `);
    let windowOpening = Number(openingResult.recordset[0]?.WindowOpening || 0);

    const glResult = await pool
      .request()
      .input("Id", sql.Int, headId)
      .input("From", sql.Date, from || null)
      .input("To", sql.Date, to || null).query(`
      SELECT
        gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.DebitAmount, gle.CreditAmount,
        gle.Narration, gle.SourceType, gle.SourceId, gle.CompanyId, gle.ProjectId, gle.CostCenterId,
        cc.Code AS CostCenterCode, cc.Name AS CostCenterName,
        np.DocNo   AS NewPaymentDocNo,
        rp.RPDocNo AS ReceivedPaymentDocNo,
        jv.JVNo    AS JournalVoucherNo,
        ft.DocNo   AS FundTransferDocNo,
        eb.EDocNo  AS ExpenseBookingDocNo,
        eb.EVendorInvoiceNo   AS VendorInvoiceNo,
        eb.EVendorInvoiceDate AS VendorInvoiceDate,
        ls.LoanNo  AS LoanDocNo
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
      -- Both ExpenseBooking (auto-post-on-approval) AND InvoicePosting (the
      -- authoritative manual "Post to GL" action) share gle.SourceId = the
      -- same ExpenseBooking.Eid — matching only 'ExpenseBooking' here meant
      -- every InvoicePosting-sourced invoice fell through to the JV voucher
      -- number (t.VoucherNo, e.g. "GL-2026-00024") instead of its own real
      -- invoice doc number.
      LEFT JOIN dbo.ExpenseBooking eb
        ON gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND eb.Eid = gle.SourceId
      LEFT JOIN dbo.LoanSanction ls
        ON gle.SourceType = 'LoanPosting' AND ls.LoanId = gle.SourceId
      WHERE gle.LHeadId = @Id AND gle.IsReversed = 0
        AND gle.SourceType NOT IN ('GRN', 'GRNPosting')
        AND (@From IS NULL OR gle.VoucherDate >= @From)
        AND (@To IS NULL OR gle.VoucherDate <= @To)
    `);

    // dbo.OnAccountLedger has no IsReversed/window-scoped balance column —
    // pulled whole per party (a handful of rows at most) and split in JS
    // instead of a second parameterized date-range query.
    const allOaRows = await fetchOnAccountRows(pool, headId);
    if (from) {
      windowOpening = Math.round((windowOpening + onAccountNet(allOaRows, from)) * 100) / 100;
    }
    const oaRowsInWindow = allOaRows.filter((r) => {
      const d = new Date(r.TxnDate);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to)) return false;
      return true;
    });

    const merged = [...glResult.recordset, ...oaRowsInWindow.map(mapOnAccountRow)];
    merged.sort((a, b) => {
      const dt = new Date(a.VoucherDate).getTime() - new Date(b.VoucherDate).getTime();
      if (dt !== 0) return dt;
      // Stable tiebreak — GL EntryId is numeric, OnAccountLedger's synthetic
      // id is a string; a plain string compare keeps ties deterministic.
      return String(a.EntryId).localeCompare(String(b.EntryId));
    });

    let running = windowOpening;
    for (const row of merged) {
      running = Math.round((running + Number(row.DebitAmount) - Number(row.CreditAmount)) * 100) / 100;
      row.RunningBalance = running;
    }
    merged.reverse(); // newest first, matching the original ORDER BY ... DESC
    const transactions = merged.slice(0, limit);

    res.json({
      head,
      windowOpeningBalance: windowOpening,
      transactions,
    });
  } catch (err) {
    console.error("VENDOR LEDGER TRANSACTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /all-transactions — every party's transactions, unfiltered ─────────
// The report's default view before a specific party is searched/selected —
// every posting across every ledger head, newest first, so there's always
// something to look at rather than an empty "search first" placeholder. No
// running balance here (it's only meaningful scoped to one head), and a
// PartyName/PartyType column takes the place of the balance one.
router.get("/all-transactions", requirePageRight("vendor-ledger", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    // Unlike /:headId/transactions, this query does have a SQL-level TOP
    // below (it scans every party at once), so the ceiling stays bounded —
    // raised from 2000 to 10000 to cover realistic export sizes without an
    // unbounded whole-company scan. Narrowing by date range is still the
    // right move for anything larger than that.
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 10000);

    const result = await pool
      .request()
      .input("Limit", sql.Int, limit)
      .input("From", sql.Date, from || null)
      .input("To", sql.Date, to || null).query(`
      SELECT TOP (@Limit)
        gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.DebitAmount, gle.CreditAmount,
        gle.Narration, gle.SourceType, gle.SourceId, gle.CompanyId, gle.ProjectId, gle.CostCenterId,
        gle.LHeadId, ISNULL(ahm.DisplayName, ahm.LHeadName) AS PartyName, ahm.LHeadType AS PartyType,
        cc.Code AS CostCenterCode, cc.Name AS CostCenterName,
        np.DocNo   AS NewPaymentDocNo,
        rp.RPDocNo AS ReceivedPaymentDocNo,
        jv.JVNo    AS JournalVoucherNo,
        ft.DocNo   AS FundTransferDocNo,
        eb.EDocNo  AS ExpenseBookingDocNo,
        eb.EVendorInvoiceNo   AS VendorInvoiceNo,
        eb.EVendorInvoiceDate AS VendorInvoiceDate,
        ls.LoanNo  AS LoanDocNo
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = gle.LHeadId AND ahm.LHeadType = 'S'
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
      WHERE gle.IsReversed = 0
        AND gle.SourceType NOT IN ('GRN', 'GRNPosting')
        AND (@From IS NULL OR gle.VoucherDate >= @From)
        AND (@To IS NULL OR gle.VoucherDate <= @To)
    `);

    // Same OnAccountLedger merge as /:headId/transactions, just across every
    // Supplier/Contractor at once (no running balance here, so no per-party
    // "pre-window" split needed — just filter to the display window).
    const oaResult = await pool
      .request()
      .input("From", sql.Date, from || null)
      .input("To", sql.Date, to || null).query(`
      SELECT oal.OAId, oal.PartyId, oal.TxnDate, oal.TxnType, oal.Amount, oal.RefType, oal.RefDocNo, oal.Notes,
             oal.CompanyId, oal.ProjectId,
             ISNULL(ahm.DisplayName, ahm.LHeadName) AS PartyName, ahm.LHeadType AS PartyType
      FROM dbo.OnAccountLedger oal
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oal.PartyId AND ahm.LHeadType = 'S'
      WHERE oal.PartyType = 'Supplier'
        AND (@From IS NULL OR oal.TxnDate >= @From)
        AND (@To IS NULL OR oal.TxnDate <= @To)
    `);

    const merged = [
      ...result.recordset,
      ...oaResult.recordset.map((r) => ({
        ...mapOnAccountRow(r),
        LHeadId: r.PartyId,
        PartyName: r.PartyName,
        PartyType: r.PartyType,
      })),
    ];
    merged.sort((a, b) => {
      const dt = new Date(b.VoucherDate).getTime() - new Date(a.VoucherDate).getTime();
      if (dt !== 0) return dt;
      return String(b.EntryId).localeCompare(String(a.EntryId));
    });

    res.json({ transactions: merged.slice(0, limit) });
  } catch (err) {
    console.error("VENDOR LEDGER ALL-TRANSACTIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
