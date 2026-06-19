const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, validate: false }));
const { getPool, sql } = require("../db");

/**
 * GET /api/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns account groups (tree) with all linked entities and their
 * debit / credit totals for the given date range.
 *
 * Column mapping (verified against live routes):
 *   AccountHeadMaster: LHeadId, LHeadName, LHeadType (S/C/B/A/GL), LBelongsTo→AGId, BankOpeningBalance
 *   ExpenseBooking   : EDocDate, ECreatedAt, ENetAmount/EAmount, EName, ESourceType, ESourceId
 *   NewPayment       : PDate, PAmount, PBankID→LHeadId(B), PExpenseRef, Status
 *   PurchaseOrders   : PODate, TotalAmount, SupplierID→LHeadId(S), Status
 *   ReceivedPayment  : RPDocDate, RPAmount, RPDepositBankId→LHeadId(B), RPReceivedFrom, RPStatus
 *   GoodsReceiptNotes: GRNId, SupplierID→LHeadId(S)
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
    const groupsRes = await pool.request().query(`
      SELECT AGId, ISNULL(Name, CONCAT('Group-', AGId)) AS Name,
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
    const headsRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId).query(`
        /* ── Suppliers (S) ──────────────────────────────────────────────────
           credit = approved PurchaseOrders
           debit  = approved NewPayments linked via ExpenseBooking → GRN      */
        SELECT
          ahm.LHeadId   AS id,
          ahm.LHeadName AS name,
          ahm.LHeadType AS [type],
          ahm.LBelongsTo AS groupId,

          ISNULL((
            SELECT SUM(np.PAmount)
            FROM dbo.NewPayment np
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            JOIN dbo.GoodsReceiptNotes grn
              ON grn.GRNId = eb.ESourceId AND eb.ESourceType = 'GRN'
            WHERE grn.SupplierID = ahm.LHeadId
              AND np.Status IN ('Approved','Completed')
              AND CAST(np.PDate AS DATE) < @from
              AND (@companyId IS NULL OR np.PCompanyId = @companyId)
              AND (@projectId IS NULL OR np.PProjectId = @projectId)
          ), 0) AS opening_debit,

          ISNULL((
            SELECT SUM(po.TotalAmount)
            FROM dbo.PurchaseOrders po
            WHERE po.SupplierID = ahm.LHeadId
              AND po.Status IN ('Approved','Completed')
              AND CAST(po.PODate AS DATE) < @from
              AND (@companyId IS NULL OR po.CompanyId = @companyId)
              AND (@projectId IS NULL OR po.ProjectId = @projectId)
          ), 0) AS opening_credit,

          ISNULL((
            SELECT SUM(np.PAmount)
            FROM dbo.NewPayment np
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            JOIN dbo.GoodsReceiptNotes grn
              ON grn.GRNId = eb.ESourceId AND eb.ESourceType = 'GRN'
            WHERE grn.SupplierID = ahm.LHeadId
              AND np.Status IN ('Approved','Completed')
              AND CAST(np.PDate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR np.PCompanyId = @companyId)
              AND (@projectId IS NULL OR np.PProjectId = @projectId)
          ), 0) AS txn_debit,

          ISNULL((
            SELECT SUM(po.TotalAmount)
            FROM dbo.PurchaseOrders po
            WHERE po.SupplierID = ahm.LHeadId
              AND po.Status IN ('Approved','Completed')
              AND CAST(po.PODate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR po.CompanyId = @companyId)
              AND (@projectId IS NULL OR po.ProjectId = @projectId)
          ), 0) AS txn_credit

        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LHeadType = 'S' AND ahm.LBelongsTo IS NOT NULL

        UNION ALL

        /* ── Contractors (C) ────────────────────────────────────────────────
           credit = ExpenseBooking (WO / WORK_DONE type) matched by EName
           debit  = NewPayments against those expense bookings              */
        SELECT
          ahm.LHeadId, ahm.LHeadName, ahm.LHeadType, ahm.LBelongsTo,

          ISNULL((
            SELECT SUM(np.PAmount)
            FROM dbo.NewPayment np
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            WHERE eb.EName = ahm.LHeadName
              AND eb.ESourceType IN ('WO_PO','WORK_DONE','PO')
              AND np.Status IN ('Approved','Completed')
              AND CAST(np.PDate AS DATE) < @from
              AND (@companyId IS NULL OR np.PCompanyId = @companyId)
              AND (@projectId IS NULL OR np.PProjectId = @projectId)
          ), 0),

          ISNULL((
            SELECT SUM(ISNULL(eb.ENetAmount, eb.EAmount))
            FROM dbo.ExpenseBooking eb
            WHERE eb.EName = ahm.LHeadName
              AND eb.ESourceType IN ('WO_PO','WORK_DONE','PO')
              AND CAST(eb.ECreatedAt AS DATE) < @from
              AND (@companyId IS NULL OR eb.ECompanyId = @companyId)
              AND (@projectId IS NULL OR eb.EProjectId = @projectId)
          ), 0),

          ISNULL((
            SELECT SUM(np.PAmount)
            FROM dbo.NewPayment np
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            WHERE eb.EName = ahm.LHeadName
              AND eb.ESourceType IN ('WO_PO','WORK_DONE','PO')
              AND np.Status IN ('Approved','Completed')
              AND CAST(np.PDate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR np.PCompanyId = @companyId)
              AND (@projectId IS NULL OR np.PProjectId = @projectId)
          ), 0),

          ISNULL((
            SELECT SUM(ISNULL(eb.ENetAmount, eb.EAmount))
            FROM dbo.ExpenseBooking eb
            WHERE eb.EName = ahm.LHeadName
              AND eb.ESourceType IN ('WO_PO','WORK_DONE','PO')
              AND CAST(eb.ECreatedAt AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR eb.ECompanyId = @companyId)
              AND (@projectId IS NULL OR eb.EProjectId = @projectId)
          ), 0)

        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LHeadType = 'C' AND ahm.LBelongsTo IS NOT NULL

        UNION ALL

        /* ── Banks (B) ──────────────────────────────────────────────────────
           Banks live in AccountHeadMaster (LHeadType='B').
           PBankID in NewPayment = LHeadId. RPDepositBankId in ReceivedPayment = LHeadId.
           opening credit = BankOpeningBalance column on AccountHeadMaster     */
        SELECT
          ahm.LHeadId, ahm.LHeadName, ahm.LHeadType, ahm.LBelongsTo,

          0 AS opening_debit,

          ISNULL(ahm.BankOpeningBalance, 0) AS opening_credit,

          ISNULL((
            SELECT SUM(np.PAmount)
            FROM dbo.NewPayment np
            WHERE np.PBankID = ahm.LHeadId
              AND np.Status IN ('Approved','Completed')
              AND CAST(np.PDate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR np.PCompanyId = @companyId)
              AND (@projectId IS NULL OR np.PProjectId = @projectId)
          ), 0) AS txn_debit,

          ISNULL((
            SELECT SUM(rp.RPAmount)
            FROM dbo.ReceivedPayment rp
            WHERE rp.RPDepositBankId = ahm.LHeadId
              AND rp.RPStatus IN ('Approved','Completed')
              AND CAST(rp.RPDocDate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR rp.RPCompanyId = @companyId)
              AND (@projectId IS NULL OR rp.RPProjectId = @projectId)
          ), 0) AS txn_credit

        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LHeadType = 'B' AND ahm.LBelongsTo IS NOT NULL

        UNION ALL

        /* ── Customers (A) ──────────────────────────────────────────────────
           credit = ReceivedPayments (rent / sale receipts)                */
        SELECT
          ahm.LHeadId, ahm.LHeadName, ahm.LHeadType, ahm.LBelongsTo,
          0, 0, 0,
          ISNULL((
            SELECT SUM(rp.RPAmount)
            FROM dbo.ReceivedPayment rp
            WHERE (rp.RPReceivedFrom = ahm.LHeadName
                OR rp.RPCustomerName = ahm.LHeadName)
              AND rp.RPStatus IN ('Approved','Completed')
              AND CAST(rp.RPDocDate AS DATE) BETWEEN @from AND @to
              AND (@companyId IS NULL OR rp.RPCompanyId = @companyId)
              AND (@projectId IS NULL OR rp.RPProjectId = @projectId)
          ), 0)
        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LHeadType = 'A' AND ahm.LBelongsTo IS NOT NULL

        UNION ALL

        /* ── General Ledger (GL) — no automatic transaction source yet ─────*/
        SELECT
          ahm.LHeadId, ahm.LHeadName, ahm.LHeadType, ahm.LBelongsTo,
          0, 0, 0, 0
        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LHeadType = 'GL' AND ahm.LBelongsTo IS NOT NULL
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

module.exports = router;
