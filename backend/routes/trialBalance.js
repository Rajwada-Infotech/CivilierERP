const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authenticateToken = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(authenticateToken);
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { resolveItemGlHeads } = require("../services/itemGlHead");
const { parseGRNItems } = require("../services/grnPosting");

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
    const enterpriseId = req.query.enterpriseId
      ? parseInt(req.query.enterpriseId, 10)
      : null;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;
    const costCenterId = req.query.costCenterId
      ? parseInt(req.query.costCenterId, 10)
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
      .input("enterpriseId", sql.Int, enterpriseId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
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
              -- 'OnAccountAdjustment' is the real GL leg posted when a
              -- pooled on-account advance is applied to an invoice — it
              -- always pairs with a dbo.OnAccountLedger DEBIT row for the
              -- same amount, both excluded here the same way
              -- vendorLedger.js's fetchOnAccountRows and this route's own
              -- per-account drill-down (below) already exclude them. Left
              -- in here before, this main report could double-count that
              -- wash pair for any Supplier/Contractor with an applied
              -- advance.
              AND gle.SourceType <> 'OnAccountAdjustment'
              AND gle.VoucherDate < @from
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0)
          -- Banks: add manually-entered opening cash balance on the debit (asset) side
          + CASE WHEN ahm.LHeadType = 'B' THEN ISNULL(ahm.BankOpeningBalance, 0) ELSE 0 END
            AS opening_debit,

          ISNULL((
            SELECT SUM(gle.CreditAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.SourceType <> 'OnAccountAdjustment'
              AND gle.VoucherDate < @from
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0) AS opening_credit,

          ISNULL((
            SELECT SUM(gle.DebitAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.SourceType <> 'OnAccountAdjustment'
              AND gle.VoucherDate BETWEEN @from AND @to
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0) AS txn_debit,

          ISNULL((
            SELECT SUM(gle.CreditAmount)
            FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId
              AND gle.IsReversed = 0
              AND gle.SourceType <> 'OnAccountAdjustment'
              AND gle.VoucherDate BETWEEN @from AND @to
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0) AS txn_credit

        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LBelongsTo IS NOT NULL
      `);

    const heads = headsRes.recordset;

    // Live per-head on-account advance (dbo.OnAccountLedger CREDIT rows —
    // a standalone advance/excess payment pooled against "Company On
    // Account A/c", not yet applied to any invoice), split into the same
    // opening/txn windows as the GL amounts above. Replaces the old
    // AccountHeadMaster.OnAccountBalance flat cached-column addition,
    // which (a) could go stale and (b) was added to the CREDIT side —
    // backwards: paying an advance reduces what's owed, so per
    // vendorLedger.js's mapOnAccountRow (the verified-correct reference)
    // it belongs on DEBIT. Both bugs together meant this report's own
    // numbers for a Supplier/Contractor with on-account activity could
    // diverge sharply from that same head's Vendor Ledger closing balance
    // — the exact class of bug already fixed for Vendor Ledger and
    // Balance Sheet. Never posts a GeneralLedgerEntry leg on its own (the
    // payment-approval flow that creates it only ever writes
    // OnAccountLedger), and scoped to Supplier/Contractor only — the CRM
    // customer-side on-account flow already posts a real GL voucher, so
    // including PartyType 'Customer' here would double-count.
    const onAccountRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("enterpriseId", sql.Int, enterpriseId)
      .input("projectId", sql.Int, projectId)
      .query(`
        SELECT PartyId,
          SUM(CASE WHEN TxnDate < @from THEN Amount ELSE 0 END) AS openingAdvance,
          SUM(CASE WHEN TxnDate >= @from AND TxnDate <= @to THEN Amount ELSE 0 END) AS txnAdvance
        FROM dbo.OnAccountLedger
        WHERE PartyType IN ('Supplier', 'Contractor') AND TxnType = 'CREDIT'
          AND TxnDate <= @to
          AND (@companyId IS NULL OR CompanyId = @companyId)
          AND (@enterpriseId IS NULL OR CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
          AND (@projectId IS NULL OR ProjectId = @projectId)
        GROUP BY PartyId
      `);
    const onAccountByHead = new Map(
      onAccountRes.recordset.map((r) => [
        Number(r.PartyId),
        { opening: Number(r.openingAdvance) || 0, txn: Number(r.txnAdvance) || 0 },
      ]),
    );

    // ── 3. Build group map ───────────────────────────────────────────────────
    // LHeadType 'C' is still overloaded for one remaining source:
    // projectMaster.js's ensureProjectLedgerHeads() mints a 'C' head for a
    // project's own "customer" side of its auto-created trading pair
    // (crmLedger.js's ensureCrmCustomerLedgerHead() used to do the same for
    // CRM customers, but now correctly mints LHeadType='A' — see migration
    // 224). The two 'C' meanings are told apart by which side of the
    // balance sheet their AccountGroup falls under: Customer heads are
    // classified under SUNDRY DEBTORS/TRADE RECEIVABLES (AGId 65/64,
    // asset side); Contractor heads are not. See isReceivablesGroup() below.
    const TYPE_LABEL = {
      S: "Supplier",
      C: "Contractor",
      B: "Bank",
      A: "Customer",
      GL: "General Ledger",
    };
    const RECEIVABLES_GROUP_IDS = new Set([64, 65]); // TRADE RECEIVABLES, SUNDRY DEBTORS

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

    // Walk a group's ancestor chain to see if it falls under Trade
    // Receivables / Sundry Debtors — used to correctly label 'C' heads that
    // are actually Customers rather than Contractors (see comment above).
    function isReceivablesGroup(groupId) {
      let cur = groupMap.get(Number(groupId));
      let hops = 0;
      while (cur && hops < 10) {
        if (RECEIVABLES_GROUP_IDS.has(cur.id)) return true;
        cur = cur.parentId != null ? groupMap.get(cur.parentId) : null;
        hops++;
      }
      return false;
    }

    // Attach entities to their group
    for (const h of heads) {
      const g = groupMap.get(Number(h.groupId));
      if (!g) continue;

      const onAccount = onAccountByHead.get(Number(h.id));
      const od = Number(h.opening_debit || 0) + (onAccount?.opening || 0);
      const oc = Number(h.opening_credit || 0);
      const td = Number(h.txn_debit || 0) + (onAccount?.txn || 0);
      const tc = Number(h.txn_credit || 0);

      const typeLabel =
        h.type === "C" && isReceivablesGroup(h.groupId)
          ? "Customer"
          : TYPE_LABEL[h.type] || h.type;

      g.entities.push({
        id: h.id,
        name: h.name,
        type: h.type,
        typeLabel,
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
      const onAccount = onAccountByHead.get(Number(h.id));
      totalDebit += Number(h.txn_debit || 0) + (onAccount?.txn || 0);
      totalCredit += Number(h.txn_credit || 0);
      openingDebit += Number(h.opening_debit || 0) + (onAccount?.opening || 0);
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
    const enterpriseId = req.query.enterpriseId
      ? parseInt(req.query.enterpriseId, 10)
      : null;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;
    const costCenterId = req.query.costCenterId
      ? parseInt(req.query.costCenterId, 10)
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
      .input("enterpriseId", sql.Int, enterpriseId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          gle.EntryId,
          gle.VoucherNo,
          CONVERT(varchar(10), gle.VoucherDate, 23) AS VoucherDate,
          gle.DebitAmount,
          gle.CreditAmount,
          gle.Narration,
          gle.SourceType,
          gle.SourceId,
          gle.CostCenterId,
          cc.Code AS CostCenterCode,
          cc.Name AS CostCenterName,

          -- Direct Fixed-Asset linkage (migration 404)
          gle.AssetId,
          gle.FinYear    AS GLFinYear,
          gle.FAItemCode AS GLFAItemCode,
          fa.AssetCode   AS FAAssetCode,
          fa.AssetName   AS FAAssetName,

          -- NewPayment
          np.PPaymentID,
          np.DocNo        AS NPDocNo,
          np.PMode        AS NPMode,
          np.Status       AS NPStatus,

          -- ReceivedPayment
          rp.RPPaymentID  AS RPID,
          rp.RPDocNo      AS RPDocNo,
          rp.RPMode       AS RPMode,

          -- ExpenseBooking (direct EB entry, e.g. GRN-linked)
          eb.Eid          AS EBId,
          eb.EDocNo       AS EBDocNo,
          eb.EVendorInvoiceNo,
          eb.ESourceType  AS EBSourceType,
          eb.ESourceId    AS EBSourceId,

          -- GRN (direct GRN entry)
          grn.GRNID,
          ISNULL(grn.DocNo, grn.GRNNo) AS GRNDocNo,

          -- JournalVoucher
          jv.JVID,
          jv.JVNo         AS JVDocNo,

          -- CrmPaymentReceipt (milestone payment received)
          cpr.Id           AS CrmReceiptId,
          cpr.ReceiptNo    AS CrmReceiptNo,
          cpr.PaymentMode  AS CrmReceiptMode,
          cpm.BookingId    AS CrmReceiptBookingId,

          -- CrmOnAccountPayment (advance deposit)
          coa.Id           AS CrmOnAccountId,
          coa.ReceiptNo    AS CrmOnAccountNo,
          coa.PaymentMode  AS CrmOnAccountMode,
          coa.BookingId    AS CrmOnAccountBookingId,

          -- CrmBrokerPayment (brokerage payout)
          cbp.Id           AS CrmBrokerPaymentId,
          cbp.PaymentMode  AS CrmBrokerPaymentMode,
          cbm.BookingId    AS CrmBrokerPaymentBookingId,

          -- CrmCancellation (refund on cancellation)
          ccx.Id           AS CrmCancellationId,
          ccx.CancellationNo AS CrmCancellationNo,
          ccx.RefundMode   AS CrmCancellationMode,
          ccx.BookingId    AS CrmCancellationBookingId

        FROM dbo.GeneralLedgerEntry gle

        LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = gle.CostCenterId
        LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = gle.AssetId
        LEFT JOIN dbo.NewPayment np
          ON gle.SourceType = 'NewPayment' AND np.PPaymentID = gle.SourceId
        LEFT JOIN dbo.ReceivedPayment rp
          ON gle.SourceType = 'ReceivedPayment' AND rp.RPPaymentID = gle.SourceId
        LEFT JOIN dbo.ExpenseBooking eb
          ON gle.SourceType = 'ExpenseBooking' AND eb.Eid = gle.SourceId
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON gle.SourceType = 'GRN' AND grn.GRNID = gle.SourceId
        LEFT JOIN dbo.JournalVoucher jv
          ON gle.SourceType = 'JournalVoucher' AND jv.JVID = gle.SourceId
        LEFT JOIN dbo.CrmPaymentReceipt cpr
          ON gle.SourceType = 'CrmPaymentReceipt' AND cpr.Id = gle.SourceId
        LEFT JOIN dbo.CrmPaymentMilestone cpm
          ON cpm.Id = cpr.MilestoneId
        LEFT JOIN dbo.CrmOnAccountPayment coa
          ON gle.SourceType = 'CrmOnAccountPayment' AND coa.Id = gle.SourceId
        LEFT JOIN dbo.CrmBrokerPayment cbp
          ON gle.SourceType = 'CrmBrokerPayment' AND cbp.Id = gle.SourceId
        LEFT JOIN dbo.CrmBrokerageMaster cbm
          ON cbm.Id = cbp.BrokerageId
        LEFT JOIN dbo.CrmCancellation ccx
          ON gle.SourceType = 'CrmCancellation' AND ccx.Id = gle.SourceId

        WHERE gle.LHeadId = @LHeadId
          AND gle.IsReversed = 0
          -- 'OnAccountAdjustment' is the real GL leg postOnAccountAdjustment
          -- writes when a pooled on-account advance is applied to an
          -- invoice — it always lands on the same date, for the same
          -- amount, as a paired OnAccountLedger DEBIT row (directOnAccount
          -- below, now CREDIT-only for the same reason). Showing both is a
          -- wash that inflates this list's Total Debit/Credit without
          -- changing any balance — see vendorLedger.js's fetchOnAccountRows
          -- for the report where this was first reported and fixed.
          AND gle.SourceType <> 'OnAccountAdjustment'
          AND gle.VoucherDate >= @from AND gle.VoucherDate <= @to
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
        ORDER BY gle.VoucherDate DESC, gle.EntryId DESC
      `);

    const glRows = entriesRes.recordset;

    // Item-level breakdown for GRN-sourced legs — this GL head's own leg is
    // a bucketed total (e.g. "Fixed Assets A/c" debited ₹X for however many
    // Fixed Asset items in the GRN shared that account), so a reviewer
    // drilling into the head can't see which items actually made it up.
    // Recompute each item's own base/GST amount (same resolution as
    // services/grnPosting.js) and attach only the items whose resolved GL
    // head is THIS head, split by whether the leg is the base-goods debit
    // or the GST-offset credit — mirrors the item-by-item table already
    // shown on a GRN's own Posting tab, just scoped to one account here.
    const grnItemBreakdownByEntryId = new Map();
    const grnSourceIds = [...new Set(
      glRows.filter((r) => r.SourceType === "GRN" || r.SourceType === "GRNPosting").map((r) => r.SourceId)
    )];
    if (grnSourceIds.length > 0) {
      const purchaseRes = await pool.request().query(
        `SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1 AND LHeadName='Purchase A/c'`,
      );
      const purchaseId = purchaseRes.recordset[0]?.LHeadId ?? null;

      const grnReq = pool.request();
      const grnPh = grnSourceIds.map((id, i) => { grnReq.input(`gid${i}`, sql.Int, id); return `@gid${i}`; }).join(",");
      const grnItemsRes = await grnReq.query(
        `SELECT GRNID, GRNItems FROM dbo.GoodsReceiptNotes WHERE GRNID IN (${grnPh})`,
      );

      for (const grnRow of grnItemsRes.recordset) {
        let items = [];
        try { items = parseGRNItems(grnRow.GRNItems); } catch { items = []; }
        if (!items.length) continue;

        const itemIds = items.map((it) => String(it.itemId || it.ItemId || "").trim()).filter(Boolean);
        const itemGlMap = await resolveItemGlHeads(pool, sql, itemIds);

        const baseForHead = [];
        const gstForHead = [];
        for (const it of items) {
          const itemId = String(it.itemId || it.ItemId || "").trim();
          const master = itemGlMap.get(itemId) || { glHeadId: null, cgstRate: 0, sgstRate: 0 };
          const resolvedHeadId = master.glHeadId || purchaseId;
          if (resolvedHeadId !== lheadId) continue;

          const itemName = it.itemName || it.ItemName || it.description || it.Description || null;
          if (!itemName) continue;
          const baseAmount = Number(it.totalAmount) > 0
            ? Number(it.totalAmount)
            : Number(it.rate || it.Rate || 0) * Number(it.quantity || it.Quantity || it.receivedQty || it.ReceivedQty || 0);
          const lineGstPct = Number(it.gstPct ?? it.GstPct ?? NaN);
          const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate + master.sgstRate);
          const gstAmount = baseAmount * (totalGSTRate / 100);

          if (baseAmount > 0) baseForHead.push({ itemName, amount: Math.round(baseAmount * 100) / 100 });
          if (gstAmount > 0) gstForHead.push({ itemName, amount: Math.round(gstAmount * 100) / 100 });
        }

        grnItemBreakdownByEntryId.set(grnRow.GRNID, { base: baseForHead, gst: gstForHead });
      }
    }

    // Track which EB ids are already in the GL (approved → posted to supplier)
    // so we don't show them twice in the pending-EB query below.
    const postedEBIds = new Set(
      glRows.filter((r) => r.SourceType === "ExpenseBooking").map((r) => r.SourceId)
    );

    const head = headRes.recordset[0];
    const isSupplierOrContractor = head.type === "S" || head.type === "C";

    // ── Direct GRN + EB queries (only meaningful for supplier/contractor heads) ──
    let directGRNs = [];
    let directEBs = [];

    if (isSupplierOrContractor) {
      // GRNs for this supplier in the period — always shown as reference
      // regardless of whether a GL entry exists (GRN posts to provision accounts,
      // never directly to the supplier leg, so there is no GL-side duplicate here).
      const grnsRes = await pool
        .request()
        .input("LHeadId", sql.Int, lheadId)
        .input("from", sql.Date, from)
        .input("to", sql.Date, to)
        .query(`
          SELECT grn.GRNID,
                 ISNULL(grn.DocNo, grn.GRNNo)              AS docNo,
                 CONVERT(varchar(10), grn.GRNDate, 23)      AS grnDate,
                 grn.TotalAmount,
                 ISNULL(grn.Status, 'Unknown')              AS grnStatus,
                 po.PurchaseOrderNo                         AS poNo
          FROM dbo.GoodsReceiptNotes grn
          LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
          WHERE grn.SupplierID = @LHeadId
            AND grn.GRNDate >= @from AND grn.GRNDate <= @to
          ORDER BY grn.GRNDate DESC
        `);

      directGRNs = grnsRes.recordset.map((r) => ({
        entryId: null,
        voucherNo: r.docNo,
        date: r.grnDate,
        debit: 0,
        credit: Number(r.TotalAmount) || 0,
        narration: `GRN — goods received${r.poNo ? ` (PO ${r.poNo})` : ""}`,
        sourceType: "GRN",
        sourceId: r.GRNID,
        docNo: r.docNo,
        mode: null,
        invoiceNo: r.poNo || null,
        sourceRef: { id: r.GRNID, docNo: r.docNo, type: "GRN" },
        payment: null,
        status: r.grnStatus,
      }));

      // ExpenseBookings for this supplier that are NOT already posted to GL
      // (approved EBs are already in the GL entries above).
      const ebsRes = await pool
        .request()
        .input("LHeadId", sql.Int, lheadId)
        .input("from", sql.Date, from)
        .input("to", sql.Date, to)
        .query(`
          SELECT eb.Eid,
                 eb.EDocNo,
                 CONVERT(varchar(10), eb.EDocDate, 23)       AS ebDate,
                 ISNULL(eb.ENetAmount, eb.EAmount)           AS amount,
                 ISNULL(eb.EStatus, 'Pending')               AS ebStatus,
                 eb.ESourceType,
                 eb.ESourceId,
                 eb.EVendorInvoiceNo,
                 ISNULL(grn.DocNo, grn.GRNNo)               AS linkedGRNNo
          FROM dbo.ExpenseBooking eb
          LEFT JOIN dbo.GoodsReceiptNotes grn
            ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
          LEFT JOIN dbo.PurchaseOrders po
            ON eb.ESourceType IN ('PO','WO_PO') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
          WHERE (
              (eb.ESourceType = 'GRN' AND grn.SupplierID = @LHeadId)
              OR (eb.ESourceType IN ('PO','WO_PO') AND po.SupplierID = @LHeadId)
              OR EXISTS (
                SELECT 1 FROM dbo.AccountHeadMaster ahm
                WHERE ahm.LHeadId = @LHeadId AND ahm.LHeadName = eb.EName
              )
            )
            AND eb.EDocDate >= @from AND eb.EDocDate <= @to
          ORDER BY eb.EDocDate DESC
        `);

      directEBs = ebsRes.recordset
        .filter((r) => !postedEBIds.has(r.Eid))
        .map((r) => ({
          entryId: null,
          voucherNo: r.EDocNo,
          date: r.ebDate,
          debit: 0,
          credit: Number(r.amount) || 0,
          narration: `Expense Booking${r.linkedGRNNo ? ` — GRN ${r.linkedGRNNo}` : ""}`,
          sourceType: "ExpenseBooking",
          sourceId: r.Eid,
          docNo: r.EDocNo,
          mode: null,
          invoiceNo: r.EVendorInvoiceNo || null,
          sourceRef: { id: r.Eid, docNo: r.EDocNo, type: "ExpenseBooking", subType: r.ESourceType, subId: r.ESourceId },
          payment: null,
          status: r.ebStatus,
        }));
    }

    // On Account advances/adjustments (dbo.OnAccountLedger) — the entity's
    // opening/closing balance above already folds AccountHeadMaster.
    // OnAccountBalance straight in (see GET / above), but that balance is
    // never backed by a GeneralLedgerEntry row (newPayment.js's excess-
    // payment flow only ever writes OnAccountLedger, not the GL) — so
    // without this, a party whose balance is entirely on-account credit
    // showed a real balance up top but "No transactions found" here.
    let directOnAccount = [];
    if (isSupplierOrContractor) {
      const partyType = head.type === "S" ? "Supplier" : "Contractor";
      const oaRes = await pool
        .request()
        .input("PartyId", sql.Int, lheadId)
        .input("PartyType", sql.NVarChar(20), partyType)
        .input("from", sql.Date, from)
        .input("to", sql.Date, to)
        .query(`
          SELECT OAId, TxnDate, TxnType, Amount, RefType, RefDocNo, Notes
          FROM dbo.OnAccountLedger
          WHERE PartyId = @PartyId AND PartyType = @PartyType
            AND TxnType = 'CREDIT'
            AND TxnDate >= @from AND TxnDate <= @to
          ORDER BY TxnDate DESC
        `);

      // Only CREDIT (the advance itself) is ever shown — its paired DEBIT
      // ("applied to invoice") row and the matching real OnAccountAdjustment
      // GL leg excluded above always net to zero together; see the WHERE
      // clause comment on the main GL query for why both are hidden.
      //
      // Despite TxnType='CREDIT' being the column value, the advance itself
      // is a DEBIT-side contribution to the party's own ledger (paying an
      // advance reduces what's owed, it doesn't increase it) — see
      // vendorLedger.js's mapOnAccountRow, the verified-correct reference:
      // TxnType='CREDIT' rows map to DebitAmount there. This was flipped
      // here initially, which would have shown a Supplier/Contractor's
      // advance on the wrong side of their own Trial Balance drill-down.
      directOnAccount = oaRes.recordset.map((r) => ({
        entryId: null,
        voucherNo: r.RefDocNo,
        date: r.TxnDate ? new Date(r.TxnDate).toISOString().slice(0, 10) : null,
        debit: Number(r.Amount) || 0,
        credit: 0,
        narration: r.Notes || `On Account advance${r.RefType ? ` — ${r.RefType}` : ""}`,
        sourceType: "OnAccountLedger",
        sourceId: null,
        docNo: r.RefDocNo,
        mode: null,
        invoiceNo: null,
        sourceRef: null,
        payment: null,
        status: "posted",
      }));
    }

    // Map GL entries
    const glTransactions = glRows.map((r) => {
      let docNo = r.VoucherNo || null;
      let mode = null;
      let invoiceNo = r.EVendorInvoiceNo || null;
      let sourceRef = null;

      const st = (r.SourceType || "").toLowerCase();

      let items = null;
      if (r.SourceType === "GRN" || r.SourceType === "GRNPosting") {
        const breakdown = grnItemBreakdownByEntryId.get(r.SourceId);
        if (breakdown) {
          const list = Number(r.DebitAmount) > 0 ? breakdown.base : breakdown.gst;
          if (list && list.length > 0) items = list;
        }
      }

      if (st === "newpayment" && r.PPaymentID) {
        docNo = r.NPDocNo || docNo;
        mode = r.NPMode;
        sourceRef = { id: r.PPaymentID, docNo: r.NPDocNo, type: "NewPayment" };
      } else if (st === "receivedpayment" && r.RPID) {
        docNo = r.RPDocNo || docNo;
        mode = r.RPMode;
        sourceRef = { id: r.RPID, docNo: r.RPDocNo, type: "ReceivedPayment" };
      } else if (st === "expensebooking" && r.EBId) {
        docNo = r.EBDocNo || docNo;
        sourceRef = { id: r.EBId, docNo: r.EBDocNo, type: "ExpenseBooking", subType: r.EBSourceType, subId: r.EBSourceId };
      } else if (st === "grn" && r.GRNID) {
        docNo = r.GRNDocNo || docNo;
        sourceRef = { id: r.GRNID, docNo: r.GRNDocNo, type: "GRN" };
      } else if (st === "journalvoucher" && r.JVID) {
        docNo = r.JVDocNo || docNo;
        sourceRef = { id: r.JVID, docNo: r.JVDocNo, type: "JournalVoucher" };
      } else if (st === "crmpaymentreceipt" && r.CrmReceiptId) {
        docNo = r.CrmReceiptNo || docNo;
        mode = r.CrmReceiptMode;
        sourceRef = { id: r.CrmReceiptId, docNo: r.CrmReceiptNo, type: "CrmPaymentReceipt", bookingId: r.CrmReceiptBookingId };
      } else if (st === "crmonaccountpayment" && r.CrmOnAccountId) {
        docNo = r.CrmOnAccountNo || docNo;
        mode = r.CrmOnAccountMode;
        sourceRef = { id: r.CrmOnAccountId, docNo: r.CrmOnAccountNo, type: "CrmOnAccountPayment", bookingId: r.CrmOnAccountBookingId };
      } else if (st === "crmbrokerpayment" && r.CrmBrokerPaymentId) {
        mode = r.CrmBrokerPaymentMode;
        sourceRef = { id: r.CrmBrokerPaymentId, docNo, type: "CrmBrokerPayment", bookingId: r.CrmBrokerPaymentBookingId };
      } else if (st === "crmcancellation" && r.CrmCancellationId) {
        docNo = r.CrmCancellationNo || docNo;
        mode = r.CrmCancellationMode;
        sourceRef = { id: r.CrmCancellationId, docNo: r.CrmCancellationNo, type: "CrmCancellation", bookingId: r.CrmCancellationBookingId };
      }

      return {
        entryId: r.EntryId,
        voucherNo: r.VoucherNo,
        date: r.VoucherDate || null,
        debit: Number(r.DebitAmount) || 0,
        credit: Number(r.CreditAmount) || 0,
        narration: r.Narration,
        sourceType: r.SourceType,
        sourceId: r.SourceId,
        docNo,
        mode,
        invoiceNo,
        sourceRef,
        status: "posted",
        costCenter: r.CostCenterId
          ? { id: r.CostCenterId, code: r.CostCenterCode, name: r.CostCenterName }
          : null,
        // Direct Fixed-Asset reference carried on the GL row (migration 404)
        fixedAsset: r.AssetId
          ? {
              assetId: r.AssetId,
              assetCode: r.FAAssetCode || null,
              assetName: r.FAAssetName || null,
              faItemCode: r.GLFAItemCode || null,
              finYear: r.GLFinYear || null,
            }
          : null,
        payment: r.PPaymentID
          ? { id: r.PPaymentID, docNo: r.NPDocNo, mode: r.NPMode, status: r.NPStatus }
          : null,
        items,
      };
    });

    // Merge GL entries with direct source-doc entries, sorted by date descending
    const transactions = [...glTransactions, ...directGRNs, ...directEBs, ...directOnAccount].sort(
      (a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      }
    );

    res.json({ entity: head, from, to, transactions });
  } catch (err) {
    console.error("[trial-balance] transactions error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trial-balance/cost-centre/:costCenterId/transactions?from=&to=&companyId=&projectId=
 *
 * Individual GL entries tagged to one Cost Centre, across every account —
 * i.e. the actual PO/GRN/Invoice postings that carry this cost centre,
 * shown as their own debit/credit rows rather than netted into an account
 * group total. This is a different view from the main account tree: that
 * one answers "what does this account's balance look like", this one
 * answers "what did this cost centre actually cost, and against what".
 */
router.get("/cost-centre/:costCenterId/transactions", async (req, res) => {
  const costCenterId = parseInt(req.params.costCenterId, 10);
  if (!Number.isFinite(costCenterId)) {
    return res.status(400).json({ error: "Invalid cost centre id" });
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
    const enterpriseId = req.query.enterpriseId
      ? parseInt(req.query.enterpriseId, 10)
      : null;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;

    const ccRes = await pool
      .request()
      .input("Id", sql.Int, costCenterId)
      .query(
        `SELECT CostCenterId AS id, Code AS code, Name AS name FROM dbo.CostCenter WHERE CostCenterId = @Id`,
      );
    if (!ccRes.recordset.length) {
      return res.status(404).json({ error: "Cost centre not found" });
    }

    const entriesRes = await pool
      .request()
      .input("CostCenterId", sql.Int, costCenterId)
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("enterpriseId", sql.Int, enterpriseId)
      .input("projectId", sql.Int, projectId).query(`
        SELECT
          gle.EntryId,
          gle.VoucherNo,
          CONVERT(varchar(10), gle.VoucherDate, 23) AS VoucherDate,
          gle.DebitAmount,
          gle.CreditAmount,
          gle.Narration,
          gle.SourceType,
          gle.SourceId,
          ahm.LHeadId,
          ahm.LHeadName,
          ahm.LHeadType,

          -- GRN-linked postings — the PO this GRN was raised against
          grn.GRNID,
          ISNULL(grn.DocNo, grn.GRNNo) AS GRNDocNo,
          po1.PurchaseOrderNo AS GRNPoNo,

          -- Invoice-linked postings — resolve the PO via the invoice's own
          -- GRN/PO source (mirrors the account-level drill-down above)
          eb.Eid AS EBId,
          eb.EDocNo AS EBDocNo,
          eb.ESourceType AS EBSourceType,
          eb.ESourceId AS EBSourceId,
          ebGrn.DocNo AS EBGrnDocNo,
          po2.PurchaseOrderNo AS EBPoNo

        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = gle.LHeadId
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON gle.SourceType IN ('GRN', 'GRNPosting') AND grn.GRNID = gle.SourceId
        LEFT JOIN dbo.PurchaseOrders po1 ON po1.PurchaseOrderID = grn.POID
        LEFT JOIN dbo.ExpenseBooking eb
          ON gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND eb.Eid = gle.SourceId
        LEFT JOIN dbo.GoodsReceiptNotes ebGrn
          ON eb.ESourceType = 'GRN' AND ebGrn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.PurchaseOrders po2
          ON (eb.ESourceType = 'PO' AND po2.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT))
          OR (eb.ESourceType = 'GRN' AND po2.PurchaseOrderID = ebGrn.POID)

        WHERE gle.CostCenterId = @CostCenterId
          AND gle.IsReversed = 0
          AND gle.VoucherDate >= @from AND gle.VoucherDate <= @to
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@enterpriseId IS NULL OR gle.CompanyId IN (SELECT id FROM dbo.enterprise WHERE enterprise_id = @enterpriseId))
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
        ORDER BY gle.VoucherDate DESC, gle.EntryId DESC
      `);

    const transactions = entriesRes.recordset.map((r) => {
      const poNo = r.GRNPoNo || r.EBPoNo || null;
      const docNo = r.GRNDocNo || r.EBDocNo || r.VoucherNo;
      return {
        entryId: r.EntryId,
        voucherNo: r.VoucherNo,
        date: r.VoucherDate,
        debit: Number(r.DebitAmount) || 0,
        credit: Number(r.CreditAmount) || 0,
        narration: r.Narration,
        sourceType: r.SourceType,
        sourceId: r.SourceId,
        account: { id: r.LHeadId, name: r.LHeadName, type: r.LHeadType },
        docNo,
        poNo,
      };
    });

    const totals = transactions.reduce(
      (acc, t) => ({ debit: acc.debit + t.debit, credit: acc.credit + t.credit }),
      { debit: 0, credit: 0 },
    );

    res.json({ costCenter: ccRes.recordset[0], from, to, transactions, totals });
  } catch (err) {
    console.error("[trial-balance] cost-centre transactions error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
