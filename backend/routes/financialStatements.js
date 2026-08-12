const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authenticateToken = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(authenticateToken);
router.use(apiRateLimit);
const { getPool, sql } = require("../db");

// ─────────────────────────────────────────────────────────────────────────────
// Balance Sheet + Profit & Loss — read the same dbo.GeneralLedgerEntry ledger
// Trial Balance does (see routes/trialBalance.js), but rolled up under the
// four Schedule-III root AccountGroups (LIABILITIES / ASSETS / REVENUE /
// EXPENSES) instead of the flat account-group tree, and presented as the
// classic two-column statement (Liabilities | Assets, Expenditure | Income)
// matching a standard CA-prepared financial statement.
//
// One root group, LOANS AND ADVANCES (AGId 79), is intentionally parentless —
// it houses both loan-given (asset) and loan-taken (liability) heads under
// one umbrella, same convention the existing ad-hoc "Loan - <Company>" heads
// already use. Since the group itself doesn't say which side a given head
// belongs to, it's classified per-head by the sign of its own closing
// balance: net debit → Assets ("Loans & Advances (Given)"), net credit →
// Liabilities ("Loans & Advances (Taken)") — standard treatment for a
// netting/umbrella loan group.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_IDS = { LIABILITIES: 1, ASSETS: 2, REVENUE: 3, EXPENSES: 4 };
const LOANS_GROUP_ID = 79;

async function loadGroups(pool) {
  const res = await pool.request().query(`
    SELECT AGId,
           LTRIM(
             CASE WHEN LEFT(ISNULL(Name, CONCAT('Group-', AGId)), 1) = '?'
                  THEN SUBSTRING(ISNULL(Name, CONCAT('Group-', AGId)), 2, 4000)
                  ELSE ISNULL(Name, CONCAT('Group-', AGId))
             END
           ) AS Name,
           Code, ParentGroupId
    FROM dbo.AccountGroup
  `);
  const map = new Map();
  for (const g of res.recordset) {
    const id = Number(g.AGId);
    map.set(id, {
      id,
      name: g.Name,
      code: g.Code || null,
      parentId: g.ParentGroupId != null ? Number(g.ParentGroupId) : null,
    });
  }
  return map;
}

// Walk a group's ancestor chain to find which of the four Schedule-III roots
// it falls under. Returns null for the orphan LOANS_GROUP_ID (or an
// unresolvable/dangling chain) — callers handle that case per-head.
function rootOf(groupMap, groupId) {
  let cur = groupMap.get(Number(groupId));
  let hops = 0;
  while (cur && hops < 20) {
    if (Object.values(ROOT_IDS).includes(cur.id)) return cur.id;
    if (cur.parentId == null) return null;
    cur = groupMap.get(cur.parentId);
    hops++;
  }
  return null;
}

// ── GET /balance-sheet?asOf=&companyId=&projectId=&costCenterId= ───────────
router.get("/balance-sheet", async (req, res) => {
  try {
    const pool = getPool();
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const costCenterId = req.query.costCenterId ? parseInt(req.query.costCenterId, 10) : null;

    const groupMap = await loadGroups(pool);

    const headsRes = await pool
      .request()
      .input("asOf", sql.Date, asOf)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          ahm.LHeadId AS id,
          ahm.LHeadName AS name,
          ahm.LHeadType AS [type],
          ahm.LBelongsTo AS groupId,
          ISNULL((
            SELECT SUM(gle.DebitAmount) FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0
              AND gle.VoucherDate <= @asOf
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0)
          + CASE WHEN ahm.LHeadType = 'B' THEN ISNULL(ahm.BankOpeningBalance, 0) ELSE 0 END
            AS debit,
          ISNULL((
            SELECT SUM(gle.CreditAmount) FROM dbo.GeneralLedgerEntry gle
            WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0
              AND gle.VoucherDate <= @asOf
              AND (@companyId IS NULL OR gle.CompanyId = @companyId)
              AND (@projectId IS NULL OR gle.ProjectId = @projectId)
              AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
          ), 0)
          + CASE WHEN ahm.LHeadType IN ('S', 'C') THEN ISNULL(ahm.OnAccountBalance, 0) ELSE 0 END
            AS credit
        FROM dbo.AccountHeadMaster ahm
        WHERE ahm.LBelongsTo IS NOT NULL AND ahm.LHeadStatus = 1
      `);

    // Net P&L (income - expenses, life-to-date through asOf) rolls into
    // Liabilities as "Profit & Loss A/c" — same as any statutory Balance
    // Sheet, since the ledger has no year-end closing/transfer entry to
    // Reserves & Surplus yet.
    const plRes = await pool
      .request()
      .input("asOf", sql.Date, asOf)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          ahm.LBelongsTo AS groupId,
          ISNULL(SUM(gle.DebitAmount), 0) AS debit,
          ISNULL(SUM(gle.CreditAmount), 0) AS credit
        FROM dbo.AccountHeadMaster ahm
        JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId
        WHERE ahm.LBelongsTo IS NOT NULL AND gle.IsReversed = 0
          AND gle.VoucherDate <= @asOf
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
        GROUP BY ahm.LBelongsTo
      `);

    let totalIncome = 0;
    let totalExpense = 0;
    for (const r of plRes.recordset) {
      const root = rootOf(groupMap, r.groupId);
      if (root === ROOT_IDS.REVENUE) totalIncome += Number(r.credit) - Number(r.debit);
      if (root === ROOT_IDS.EXPENSES) totalExpense += Number(r.debit) - Number(r.credit);
    }
    const netProfit = Math.round((totalIncome - totalExpense) * 100) / 100;

    const liabilityGroups = new Map(); // groupId -> { name, heads: [] }
    const assetGroups = new Map();

    const pushHead = (bucket, groupId, groupName, head) => {
      if (!bucket.has(groupId)) bucket.set(groupId, { groupId, groupName, heads: [], total: 0 });
      const g = bucket.get(groupId);
      g.heads.push(head);
      g.total = Math.round((g.total + head.amount) * 100) / 100;
    };

    for (const h of headsRes.recordset) {
      const debit = Number(h.debit) || 0;
      const credit = Number(h.credit) || 0;
      const net = Math.round((debit - credit) * 100) / 100;
      if (Math.abs(net) < 0.005) continue; // zero-balance heads add no signal

      const gid = Number(h.groupId);
      const grp = groupMap.get(gid);
      const groupName = grp ? grp.name : `Group-${gid}`;
      let root = rootOf(groupMap, gid);

      if (root == null && gid !== LOANS_GROUP_ID) continue; // orphan/unmapped, skip
      if (gid === LOANS_GROUP_ID) {
        // Per-head sign classification (see file header comment).
        root = net > 0 ? ROOT_IDS.ASSETS : ROOT_IDS.LIABILITIES;
      }

      if (root === ROOT_IDS.ASSETS) {
        // Asset head: positive (debit) balance is normal. A credit balance
        // on an asset head still reports under Assets, shown as a negative
        // figure, rather than silently flipping sides.
        pushHead(assetGroups, gid, groupName, { id: h.id, name: h.name, amount: net });
      } else if (root === ROOT_IDS.LIABILITIES) {
        pushHead(liabilityGroups, gid, groupName, { id: h.id, name: h.name, amount: -net });
      }
      // REVENUE/EXPENSES heads never carry a Balance Sheet closing balance in
      // this schema (they're period accounts, folded into netProfit above).
    }

    if (Math.abs(netProfit) > 0.005) {
      const bucket = liabilityGroups.get("PL") || { groupId: "PL", groupName: "Profit & Loss A/c", heads: [], total: 0 };
      bucket.heads.push({ id: null, name: "Profit & Loss A/c (life-to-date)", amount: netProfit });
      bucket.total = Math.round((bucket.total + netProfit) * 100) / 100;
      liabilityGroups.set("PL", bucket);
    }

    const toRows = (m) =>
      Array.from(m.values())
        .filter((g) => Math.abs(g.total) > 0.005)
        .sort((a, b) => a.groupName.localeCompare(b.groupName));

    const liabilities = toRows(liabilityGroups);
    const assets = toRows(assetGroups);
    const totalLiabilities = Math.round(liabilities.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const totalAssets = Math.round(assets.reduce((s, g) => s + g.total, 0) * 100) / 100;

    res.json({
      asOf,
      liabilities,
      assets,
      totals: { liabilities: totalLiabilities, assets: totalAssets },
      balanced: Math.abs(totalLiabilities - totalAssets) < 0.5,
    });
  } catch (err) {
    console.error("[GET /financial-statements/balance-sheet]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /profit-loss?from=&to=&companyId=&projectId=&costCenterId= ─────────
router.get("/profit-loss", async (req, res) => {
  try {
    const pool = getPool();
    const now = new Date();
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const from = req.query.from || `${fyYear}-04-01`;
    const to = req.query.to || `${fyYear + 1}-03-31`;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const costCenterId = req.query.costCenterId ? parseInt(req.query.costCenterId, 10) : null;

    const groupMap = await loadGroups(pool);

    const headsRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          ahm.LHeadId AS id,
          ahm.LHeadName AS name,
          ahm.LBelongsTo AS groupId,
          ISNULL(SUM(gle.DebitAmount), 0) AS debit,
          ISNULL(SUM(gle.CreditAmount), 0) AS credit
        FROM dbo.AccountHeadMaster ahm
        JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId
        WHERE ahm.LBelongsTo IS NOT NULL AND gle.IsReversed = 0
          AND gle.VoucherDate BETWEEN @from AND @to
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
        GROUP BY ahm.LHeadId, ahm.LHeadName, ahm.LBelongsTo
      `);

    const incomeGroups = new Map();
    const expenseGroups = new Map();
    const pushHead = (bucket, groupId, groupName, head) => {
      if (!bucket.has(groupId)) bucket.set(groupId, { groupId, groupName, heads: [], total: 0 });
      const g = bucket.get(groupId);
      g.heads.push(head);
      g.total = Math.round((g.total + head.amount) * 100) / 100;
    };

    for (const h of headsRes.recordset) {
      const debit = Number(h.debit) || 0;
      const credit = Number(h.credit) || 0;
      const gid = Number(h.groupId);
      const grp = groupMap.get(gid);
      const groupName = grp ? grp.name : `Group-${gid}`;
      const root = rootOf(groupMap, gid);

      if (root === ROOT_IDS.REVENUE) {
        const net = Math.round((credit - debit) * 100) / 100;
        if (Math.abs(net) < 0.005) continue;
        pushHead(incomeGroups, gid, groupName, { id: h.id, name: h.name, amount: net });
      } else if (root === ROOT_IDS.EXPENSES) {
        const net = Math.round((debit - credit) * 100) / 100;
        if (Math.abs(net) < 0.005) continue;
        pushHead(expenseGroups, gid, groupName, { id: h.id, name: h.name, amount: net });
      }
    }

    const toRows = (m) =>
      Array.from(m.values())
        .filter((g) => Math.abs(g.total) > 0.005)
        .sort((a, b) => a.groupName.localeCompare(b.groupName));

    const income = toRows(incomeGroups);
    const expenses = toRows(expenseGroups);
    const totalIncome = Math.round(income.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const totalExpenses = Math.round(expenses.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;

    res.json({
      from,
      to,
      income,
      expenses,
      totals: { income: totalIncome, expenses: totalExpenses, netProfit },
    });
  } catch (err) {
    console.error("[GET /financial-statements/profit-loss]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
