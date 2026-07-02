const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authenticateToken = require("../middleware/auth");
router.use(authenticateToken);
const { getPool, sql } = require("../db");

/**
 * GET /api/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD&companyId=&projectId=
 *
 * Returns account groups (tree) with all linked entities and their
 * debit / credit totals for the given date range.
 *
 * Reads straight off dbo.GeneralLedgerEntry — every approved GRN, Expense
 * Booking, Payment Made, and Received Payment posts a balanced double-entry
 * voucher there (see backend/services/generalLedger.js). This replaced the
 * old approach of re-deriving balances by scanning each source document
 * table per account type, which couldn't guarantee Dr = Cr and left GL
 * accounts permanently at zero.
 *
 * Ledger posting started 2026-06-28 — there is no historical backfill, so
 * opening balances before that date are 0 except for Banks, which keep their
 * manually-entered AccountHeadMaster.BankOpeningBalance as a true starting
 * cash balance (the ledger has no way to know that figure on its own).
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const now = new Date();
    const fyYear =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const from = req.query.from || `${fyYear}-04-01`;
    const to = req.query.to || `${fyYear + 1}-03-31`;
    const companyId = req.query.companyId
      ? parseInt(req.query.companyId, 10)
      : null;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;

    // ── 1. Account groups ────────────────────────────────────────────────────
    // Some existing rows have a stray leading "?" (a corrupted/garbled
    // character from an earlier import — SQL Server substitutes "?" for any
    // Unicode character it can't represent when text is inserted through a
    // non-Unicode (VARCHAR) literal/connection). Strip it here so the UI
    // shows a clean name regardless of what's stored.
    const groupsRes = await pool.request().query(`
      SELECT AGId,
             LTRIM(
               CASE WHEN LEFT(ISNULL(Name, CONCAT('Group-', AGId)), 1) = '?'
                    THEN SUBSTRING(ISNULL(Name, CONCAT('Group-', AGId)), 2, 4000)
                    ELSE ISNULL(Name, CONCAT('Group-', AGId))
               END
             ) AS Name,
             Code, ParentGroupId
      FROM dbo.AccountGroup
      ORDER BY Name
    `);

    if (!groupsRes.recordset.length) {
      return res.json({
        rows: [],
        summary: {
          totalDebit: 0,
          totalCredit: 0,
          openingDebit: 0,
          openingCredit: 0,
        },
        asOf: new Date().toISOString(),
        from,
        to,
      });
    }

    // ── 2. Entity-level totals (one row per AccountHeadMaster entry) ─────────
    // Type-agnostic now — the ledger doesn't care whether the head is a
    // Supplier, Contractor, Bank, Customer, or GL account, so one query
    // covers all five (the old version needed a 5-branch UNION ALL, one
    // bespoke set of rules per type, because it scanned source documents).
    const headsRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId).query(`
        SELECT
          ahm.LHeadId    AS id,
          ahm.LHeadName  AS name,
          ahm.LHeadType  AS [type],
          ahm.LBelongsTo AS groupId,

          ISNULL((
            SELECT SUM(gle.DebitAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.VoucherDate < @from
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          ), 0)
          -- Banks: add manually-entered opening cash balance on the debit (asset) side
          + CASE WHEN ahm.LHeadType = 'B' THEN ISNULL(ahm.BankOpeningBalance, 0) ELSE 0 END
            AS opening_debit,

          ISNULL((
            SELECT SUM(gle.CreditAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.VoucherDate < @from
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          ), 0) AS opening_credit,

          ISNULL((
            SELECT SUM(gle.DebitAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.VoucherDate BETWEEN @from AND @to
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          ), 0) AS txn_debit,

          ISNULL((
            SELECT SUM(gle.CreditAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.VoucherDate BETWEEN @from AND @to
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          ), 0) AS txn_credit

        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LBelongsTo IS NOT NULL
      `);

    const heads = headsRes.recordset;

    // ── 3. Build group map ───────────────────────────────────────────────────
    const TYPE_LABEL = {
      S: "Supplier",
      C: "Contractor",
      B: "Bank",
      A: "Customer",
      GL: "General Ledger",
    };

    const groupMap = new Map();
    for (const g of groupsRes.recordset) {
      // Normalise to numbers — SQL Server can return ParentGroupId as string
      const id = Number(g.AGId);
      const pid = g.ParentGroupId != null ? Number(g.ParentGroupId) : null;
      groupMap.set(id, {
        id,
        name: g.Name,
        code: g.Code || null,
        parentId: pid,
        isGroup: true,
        entities: [],
        children: [],
        opening: { debit: 0, credit: 0 },
        transactions: { debit: 0, credit: 0 },
        closing: { debit: 0, credit: 0 },
      });
    }

    // Attach entities to their group
    for (const h of heads) {
      const g = groupMap.get(Number(h.groupId));
      if (!g) continue;

      const od = Number(h.opening_debit || 0);
      const oc = Number(h.opening_credit || 0);
      const td = Number(h.txn_debit || 0);
      const tc = Number(h.txn_credit || 0);

      g.entities.push({
        id: h.id,
        name: h.name,
        type: h.type,
        typeLabel: TYPE_LABEL[h.type] || h.type,
        isGroup: false,
        children: [],
        opening: { debit: od, credit: oc },
        transactions: { debit: td, credit: tc },
        closing: { debit: od + td, credit: oc + tc },
      });

      g.opening.debit += od;
      g.opening.credit += oc;
      g.transactions.debit += td;
      g.transactions.credit += tc;
      g.closing.debit += od + td;
      g.closing.credit += oc + tc;
    }

    // ── 4. Build tree (attach child groups to parents) ───────────────────────
    const roots = [];
    for (const g of groupMap.values()) {
      if (g.parentId !== null && groupMap.has(g.parentId)) {
        groupMap.get(g.parentId).children.push(g);
      } else {
        roots.push(g);
      }
    }

    // Roll up child group totals into parent groups (post-order)
    function rollUp(node) {
      for (const child of node.children) {
        rollUp(child);
        node.opening.debit += child.opening.debit;
        node.opening.credit += child.opening.credit;
        node.transactions.debit += child.transactions.debit;
        node.transactions.credit += child.transactions.credit;
        node.closing.debit += child.closing.debit;
        node.closing.credit += child.closing.credit;
      }
    }
    roots.forEach(rollUp);

    // Convert to frontend shape (entities become leaf children)
    function toFrontend(node, level = 0) {
      return {
        id: node.id,
        name: node.name,
        code: node.code,
        level,
        isGroup: true,
        opening: node.opening,
        transactions: node.transactions,
        closing: node.closing,
        children: [
          ...node.entities.map((e) => ({ ...e, level: level + 1 })),
          ...node.children.map((c) => toFrontend(c, level + 1)),
        ],
      };
    }

    const rows = roots.map((r) => toFrontend(r, 0));

    // ── 5. Summary ───────────────────────────────────────────────────────────
    let totalDebit = 0,
      totalCredit = 0,
      openingDebit = 0,
      openingCredit = 0;
    for (const h of heads) {
      totalDebit += Number(h.txn_debit || 0);
      totalCredit += Number(h.txn_credit || 0);
      openingDebit += Number(h.opening_debit || 0);
      openingCredit += Number(h.opening_credit || 0);
    }

    res.json({
      rows,
      summary: { totalDebit, totalCredit, openingDebit, openingCredit },
      asOf: new Date().toISOString(),
      from,
      to,
    });
  } catch (err) {
    console.error("[trial-balance] error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trial-balance/:lheadId/transactions?from=&to=&companyId=&projectId=
 *
 * Drill-down — every GeneralLedgerEntry posted against one AccountHeadMaster
 * entity (ledger), within the same filter window as the main report. Entries
 * sourced from a Payment (SourceType = 'NewPayment') are enriched with the
 * payment's docNo/mode/expenseRef so the frontend can link straight through
 * to Finance → Payments → that receipt (Level 3 of the drill-down).
 */
router.get("/:lheadId/transactions", async (req, res) => {
  const lheadId = parseInt(req.params.lheadId, 10);
  if (!Number.isFinite(lheadId)) {
    return res.status(400).json({ error: "Invalid ledger id" });
  }

  try {
    const pool = getPool();

    const now = new Date();
    const fyYear =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const from = req.query.from || `${fyYear}-04-01`;
    const to = req.query.to || `${fyYear + 1}-03-31`;
    const companyId = req.query.companyId
      ? parseInt(req.query.companyId, 10)
      : null;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;

    const headRes = await pool
      .request()
      .input("LHeadId", sql.Int, lheadId)
      .query(
        `SELECT LHeadId AS id, LHeadName AS name, LHeadType AS [type] FROM dbo.AccountHeadMaster WHERE LHeadId = @LHeadId`,
      );
    if (!headRes.recordset.length) {
      return res.status(404).json({ error: "Ledger entity not found" });
    }

    const entriesRes = await pool
      .request()
      .input("LHeadId", sql.Int, lheadId)
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId).query(`
        SELECT
          gle.EntryId, gle.VoucherNo, gle.VoucherDate,
          gle.DebitAmount, gle.CreditAmount, gle.Narration,
          gle.SourceType, gle.SourceId,
          np.PPaymentID, np.DocNo AS PaymentDocNo, np.PMode AS PaymentMode,
          np.PExpenseRef, np.Status AS PaymentStatus,
          eb.EVendorInvoiceNo
        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.NewPayment np
          ON gle.SourceType = 'NewPayment' AND np.PPaymentID = gle.SourceId
        LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
        WHERE gle.LHeadId = @LHeadId
          AND gle.IsReversed = 0
          AND gle.VoucherDate >= @from AND gle.VoucherDate <= @to
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
        ORDER BY gle.VoucherDate DESC, gle.EntryId DESC
      `);

    const transactions = entriesRes.recordset.map((r) => ({
      entryId: r.EntryId,
      voucherNo: r.VoucherNo,
      date: r.VoucherDate ? String(r.VoucherDate).slice(0, 10) : null,
      debit: Number(r.DebitAmount) || 0,
      credit: Number(r.CreditAmount) || 0,
      narration: r.Narration,
      sourceType: r.SourceType,
      sourceId: r.SourceId,
      invoiceNo: r.EVendorInvoiceNo || null,
      payment: r.PPaymentID
        ? {
            id: r.PPaymentID,
            docNo: r.PaymentDocNo,
            mode: r.PaymentMode,
            status: r.PaymentStatus,
          }
        : null,
    }));

    res.json({ entity: headRes.recordset[0], from, to, transactions });
  } catch (err) {
    console.error("[trial-balance] transactions error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
