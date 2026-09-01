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
          ahm.LHeadCode AS code,
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
    // Reserves & Surplus yet. We split this into prior years and current year.
    const asOfDate = new Date(asOf);
    const fyStartYear = asOfDate.getMonth() >= 3 ? asOfDate.getFullYear() : asOfDate.getFullYear() - 1;
    const fyStart = fyStartYear + "-04-01";

    const plResPrior = await pool
      .request()
      .input("fyStart", sql.Date, fyStart)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          ahm.LBelongsTo AS groupId,
          ISNULL(SUM(gle.DebitAmount), 0) AS debit,
          ISNULL(SUM(gle.CreditAmount), 0) AS credit
        FROM dbo.AccountHeadMaster ahm
        JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId
        WHERE ahm.LBelongsTo IS NOT NULL AND ahm.LHeadStatus = 1 AND gle.IsReversed = 0
          AND gle.VoucherDate < @fyStart
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
        GROUP BY ahm.LBelongsTo
      `);

    const plResCurrent = await pool
      .request()
      .input("asOf", sql.Date, asOf)
      .input("fyStart", sql.Date, fyStart)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("costCenterId", sql.Int, costCenterId).query(`
        SELECT
          ahm.LBelongsTo AS groupId,
          ISNULL(SUM(gle.DebitAmount), 0) AS debit,
          ISNULL(SUM(gle.CreditAmount), 0) AS credit
        FROM dbo.AccountHeadMaster ahm
        JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId
        WHERE ahm.LBelongsTo IS NOT NULL AND ahm.LHeadStatus = 1 AND gle.IsReversed = 0
          AND gle.VoucherDate >= @fyStart AND gle.VoucherDate <= @asOf
          AND (@companyId IS NULL OR gle.CompanyId = @companyId)
          AND (@projectId IS NULL OR gle.ProjectId = @projectId)
          AND (@costCenterId IS NULL OR gle.CostCenterId = @costCenterId)
        GROUP BY ahm.LBelongsTo
      `);

    const calcNet = (recordset) => {
      let income = 0;
      let expense = 0;
      for (const r of recordset) {
        const root = rootOf(groupMap, r.groupId);
        if (root === ROOT_IDS.REVENUE) income += Number(r.credit) - Number(r.debit);
        if (root === ROOT_IDS.EXPENSES) expense += Number(r.debit) - Number(r.credit);
      }
      return Math.round((income - expense) * 100) / 100;
    };

    const netProfitPrior = calcNet(plResPrior.recordset);
    const netProfitCurrent = calcNet(plResCurrent.recordset);
    const netProfit = Math.round((netProfitPrior + netProfitCurrent) * 100) / 100;

    const liabilityGroups = new Map(); // groupId -> { name, heads: [] }
    const assetGroups = new Map();

    const pushHead = (bucket, groupId, groupName, head) => {
      if (!bucket.has(groupId)) bucket.set(groupId, { groupId, groupName, heads: [], total: 0 });
      const g = bucket.get(groupId);
      g.heads.push(head);
      g.total = Math.round((g.total + head.amount) * 100) / 100;
    };

    let incomeSummaryBalance = 0;

    for (const h of headsRes.recordset) {
      const debit = Number(h.debit) || 0;
      const credit = Number(h.credit) || 0;
      const net = Math.round((debit - credit) * 100) / 100;
      if (Math.abs(net) < 0.005) continue; // zero-balance heads add no signal

      const gid = Number(h.groupId);
      const grp = groupMap.get(gid);
      let groupName = grp ? grp.name : `Group-${gid}`;
      let root = rootOf(groupMap, gid);

      // If it's the Income Summary system head used for Year-End Close, capture
      // its balance to offset the synthetic P&L prior years calculation, and skip rendering.
      if (h.code === "INCOME-SUMMARY") {
        // As a liability head, a debit balance (net > 0) means it was debited 
        // to transfer profit TO Retained Earnings. So its true liability balance is -net.
        incomeSummaryBalance = -net;
        continue;
      }

      if (root == null && gid !== LOANS_GROUP_ID) continue; // orphan/unmapped, skip
      if (gid === LOANS_GROUP_ID) {
        // Per-head sign classification (see file header comment). Relabel
        // the group name too — "LOANS AND ADVANCES" alone doesn't match
        // isCurrentAsset/isCurrentLiability below, so these heads used to
        // fall through to Non-Current. A per-company inter-company loan
        // (LOAN-C-<id> heads) is a short-term intercompany balance, not a
        // long-term investment/borrowing, so it belongs in Current — and
        // "Receivable"/"Payable" are exactly the keywords those regexes
        // already look for, so relabeling is enough without touching them.
        root = net > 0 ? ROOT_IDS.ASSETS : ROOT_IDS.LIABILITIES;
        groupName = net > 0 ? "Loan Receivable" : "Loan Payable";
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

    // Adjust prior years profit by the amount already transferred to Retained Earnings
    const adjustedNetProfitPrior = Math.round((netProfitPrior + incomeSummaryBalance) * 100) / 100;

    if (Math.abs(adjustedNetProfitPrior) > 0.005 || Math.abs(netProfitCurrent) > 0.005) {
      const bucket = liabilityGroups.get("PL") || { groupId: "PL", groupName: "Profit & Loss A/c", heads: [], total: 0 };
      if (Math.abs(adjustedNetProfitPrior) > 0.005) {
        bucket.heads.push({ id: null, name: "Retained Earnings (Prior Years)", amount: adjustedNetProfitPrior });
        bucket.total = Math.round((bucket.total + adjustedNetProfitPrior) * 100) / 100;
      }
      if (Math.abs(netProfitCurrent) > 0.005) {
        bucket.heads.push({ id: null, name: "Net Profit (Current Period)", amount: netProfitCurrent });
        bucket.total = Math.round((bucket.total + netProfitCurrent) * 100) / 100;
      }
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

    const { companyName, entityType } = await resolveCompanyType(pool, companyId);

    // ── Schedule III classification heuristics (case-insensitive group name) ──
    // A "long-term" / "non-current" prefix overrides current-keyword matches
    // so that "Long-term Provisions" stays non-current even though it contains
    // "provision". Similarly "Loans & Advances (Given)" stays non-current
    // unless explicitly tagged "Short" or "Current".
    const isLongTerm = (name) =>
      /long.?term|non.?current/i.test(name);
    const isCurrentAsset = (name) =>
      !isLongTerm(name) &&
      /cash|bank|receivable|inventory|stock|(?<!\blong.?term\b.*)advance|prepaid|current|debtor/i.test(name);
    const isInventory = (name) =>
      /inventory|stock|wip|work in progress/i.test(name);
    const isEquity = (name) =>
      /share.?capital|reserves?\b|surplus|equity|profit.*loss|capital.?account|partner.*capital|proprietor/i.test(name);
    const isCurrentLiability = (name) =>
      !isLongTerm(name) && !isEquity(name) &&
      /payable|creditor|current|short.?term|overdraft|(?<!\blong.?term\b.*)provision/i.test(name);

    let totalCurrentAssets = 0;
    let totalNonCurrentAssets = 0;
    let totalInventories = 0;
    for (const g of assets) {
      if (isCurrentAsset(g.groupName)) {
        totalCurrentAssets = Math.round((totalCurrentAssets + g.total) * 100) / 100;
        if (isInventory(g.groupName)) {
          totalInventories = Math.round((totalInventories + g.total) * 100) / 100;
        }
      } else {
        totalNonCurrentAssets = Math.round((totalNonCurrentAssets + g.total) * 100) / 100;
      }
    }

    // Separate liabilities into Equity / Non-Current Liabilities / Current
    // Liabilities — critical for correct ratio computation. Previously,
    // totalEquity was computed as (totalAssets - totalLiabilities) which is
    // always ~0 when balanced because totalLiabilities already includes
    // equity groups. Now we sum equity groups directly.
    let totalEquity = 0;
    let totalCurrentLiabilities = 0;
    let totalNonCurrentLiabilities = 0;
    for (const g of liabilities) {
      if (isEquity(g.groupName)) {
        totalEquity = Math.round((totalEquity + g.total) * 100) / 100;
      } else if (isCurrentLiability(g.groupName)) {
        totalCurrentLiabilities = Math.round((totalCurrentLiabilities + g.total) * 100) / 100;
      } else {
        totalNonCurrentLiabilities = Math.round((totalNonCurrentLiabilities + g.total) * 100) / 100;
      }
    }

    // ── Financial ratios ──────────────────────────────────────────────────────
    const safeDiv = (n, d) => (Math.abs(d) < 0.005 ? null : Math.round((n / d) * 10000) / 10000);
    // Debt = Total Liabilities (all groups) minus Equity (shareholders' funds).
    // This gives the actual borrowed/owed capital for ratio purposes.
    const totalDebt = Math.round((totalLiabilities - totalEquity) * 100) / 100;
    const currentRatio = safeDiv(totalCurrentAssets, totalCurrentLiabilities);
    const quickRatio   = safeDiv(totalCurrentAssets - totalInventories, totalCurrentLiabilities);
    const workingCapital = Math.round((totalCurrentAssets - totalCurrentLiabilities) * 100) / 100;
    const debtToEquity = safeDiv(totalDebt, totalEquity);

    res.json({
      asOf,
      companyName,
      entityType,
      liabilities,
      assets,
      totals: { liabilities: totalLiabilities, assets: totalAssets },
      balanced: Math.abs(totalLiabilities - totalAssets) < 0.5,
      netProfit,
      ratios: {
        currentRatio,
        quickRatio,
        workingCapital,
        debtToEquity,
        totalCurrentAssets,
        totalNonCurrentAssets,
        totalCurrentLiabilities,
        totalNonCurrentLiabilities,
        totalEquity,
      },
    });
  } catch (err) {
    console.error("[GET /financial-statements/balance-sheet]", err);
    res.status(500).json({ error: err.message });
  }
});

// Company types that are body-corporates governed by Schedule III of the
// Companies Act, 2013 (Division II format: Revenue from Operations / Other
// Income → Total Income; a fixed set of expense lines → Total Expenses;
// Profit Before Tax; Tax Expense; Profit After Tax). LLPs voluntarily follow
// the same structured presentation in practice even though they're taxed
// like a partnership. Everything else (Partnership, Proprietorship, or no
// company selected/unknown type) gets the classic Trading & Profit and Loss
// Account format instead — a partnership firm's P&L never carries a "Tax
// Expense" line inside the account itself (provision for tax and partner
// appropriation happen in a separate P&L Appropriation Account this ledger
// has no data model for), so forcing Schedule III labels on it would be
// actively wrong, not just cosmetically different.
const SCHEDULE_III_TYPES = new Set(["Private Limited", "Public Limited", "OPC", "Section 8", "LLP"]);

// dbo.AccountGroup ids directly under EXPENSES (root 4) / REVENUE (root 3) —
// this chart of accounts was already seeded along Schedule III lines, so
// classification is a direct id lookup, not a name-keyword guess.
const SCH3_REVENUE_OPS = 15;
const SCH3_OTHER_INCOME = new Set([16, 17]); // 17 = system-generated income
const SCH3_EXPENSE_SECTIONS = [
  { key: "projectExpenses", label: "Project & Construction Expenses", groupIds: [18, 19] },
  { key: "costOfMaterials", label: "Cost of Materials Consumed", groupIds: [21] },
  { key: "purchaseStockInTrade", label: "Purchase of Stock-in-Trade", groupIds: [22] },
  { key: "stockChanges", label: "Changes in Inventories of Stock-in-Trade", groupIds: [23] },
  { key: "employeeBenefits", label: "Employee Benefits Expense", groupIds: [24] },
  { key: "financeCosts", label: "Finance Costs", groupIds: [25] },
  { key: "depreciation", label: "Depreciation and Amortization Expense", groupIds: [26] },
  { key: "otherExpenses", label: "Other Expenses", groupIds: [27, 42, 20] },
  { key: "exceptionalItems", label: "Exceptional Items", groupIds: [28] },
  { key: "extraordinaryItems", label: "Extraordinary Items", groupIds: [29] },
];
const SCH3_TAX_GROUP = 30; // Tax Expense (Current Tax 43 / Deferred Tax 44 underneath)

async function resolveCompanyType(pool, companyId) {
  if (!companyId) return { companyName: null, entityType: null };
  const r = await pool
    .request()
    .input("id", sql.Int, companyId)
    .query("SELECT name, entity_type FROM dbo.enterprise WHERE id = @id AND business_type = 'C'");
  const row = r.recordset[0];
  return { companyName: row?.name || null, entityType: row?.entity_type || null };
}

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
    const { companyName, entityType } = await resolveCompanyType(pool, companyId);
    // No single company selected → default to the structured Schedule III
    // view, the more broadly useful default across a multi-company org.
    const presentation = !entityType || SCHEDULE_III_TYPES.has(entityType) ? "structured" : "classic";

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
        WHERE ahm.LBelongsTo IS NOT NULL AND ahm.LHeadStatus = 1 AND gle.IsReversed = 0
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

    // Walk a group's ancestor chain and return the nearest ancestor id that
    // is itself a direct child of the EXPENSES/REVENUE root — i.e. the
    // Schedule-III bucket id (18–30) a leaf group like "Indirect Expenses"
    // (42, parented under 27 Other Expenses) rolls up into.
    function scheduleBucketOf(groupId) {
      let cur = groupMap.get(Number(groupId));
      let hops = 0;
      while (cur && hops < 20) {
        if (cur.parentId === ROOT_IDS.REVENUE || cur.parentId === ROOT_IDS.EXPENSES) return cur.id;
        if (cur.parentId == null) return null;
        cur = groupMap.get(cur.parentId);
        hops++;
      }
      return null;
    }

    const revenueOps = { heads: [], total: 0 };
    const otherIncome = { heads: [], total: 0 };
    const expenseSections = SCH3_EXPENSE_SECTIONS.map((s) => ({ ...s, heads: [], total: 0 }));
    const taxExpense = { heads: [], total: 0 };

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

        if (presentation === "structured") {
          const bucket = scheduleBucketOf(gid);
          const target = bucket === SCH3_REVENUE_OPS ? revenueOps : otherIncome;
          target.heads.push({ id: h.id, name: h.name, amount: net });
          target.total = Math.round((target.total + net) * 100) / 100;
        }
      } else if (root === ROOT_IDS.EXPENSES) {
        const net = Math.round((debit - credit) * 100) / 100;
        if (Math.abs(net) < 0.005) continue;
        pushHead(expenseGroups, gid, groupName, { id: h.id, name: h.name, amount: net });

        if (presentation === "structured") {
          const bucket = scheduleBucketOf(gid);
          if (bucket === SCH3_TAX_GROUP) {
            taxExpense.heads.push({ id: h.id, name: h.name, amount: net });
            taxExpense.total = Math.round((taxExpense.total + net) * 100) / 100;
          } else {
            const section = expenseSections.find((s) => s.groupIds.includes(bucket));
            // Unmatched groups fall to "Other Expenses" (not "Extraordinary Items")
            const fallback = expenseSections.find((s) => s.key === "otherExpenses");
            const target = section || fallback || expenseSections[expenseSections.length - 1];
            target.heads.push({ id: h.id, name: h.name, amount: net });
            target.total = Math.round((target.total + net) * 100) / 100;
          }
        }
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

    let statement = null;
    if (presentation === "structured") {
      const nonZeroSections = expenseSections.filter((s) => Math.abs(s.total) > 0.005);
      const totalRevenue = Math.round((revenueOps.total + otherIncome.total) * 100) / 100;
      const totalExpensesExclTax = Math.round(
        nonZeroSections.reduce((s, sec) => s + sec.total, 0) * 100,
      ) / 100;
      const profitBeforeTax = Math.round((totalRevenue - totalExpensesExclTax) * 100) / 100;
      const profitAfterTax = Math.round((profitBeforeTax - taxExpense.total) * 100) / 100;

      // Helper: sum section totals by key
      const secTotal = (...keys) =>
        Math.round(
          nonZeroSections
            .filter((s) => keys.includes(s.key))
            .reduce((sum, s) => sum + s.total, 0) * 100,
        ) / 100;

      // Gross Profit: Revenue from Ops minus direct production/project costs.
      // For construction/real-estate: projectExpenses + costOfMaterials + stockChanges + purchaseStockInTrade
      const directCosts = secTotal(
        "projectExpenses",
        "costOfMaterials",
        "purchaseStockInTrade",
        "stockChanges",
      );
      const grossProfit = Math.round((revenueOps.total - directCosts) * 100) / 100;

      // EBITDA: PBT + Finance Costs + Depreciation & Amortisation
      const financeCostsTotal = secTotal("financeCosts");
      const depreciationTotal = secTotal("depreciation");
      const ebitda = Math.round((profitBeforeTax + financeCostsTotal + depreciationTotal) * 100) / 100;

      // Profit Before Exceptional Items: PBT + Exceptional Items (add back the exceptional/extraordinary)
      const exceptionalTotal = secTotal("exceptionalItems", "extraordinaryItems");
      const profitBeforeExceptional = Math.round((profitBeforeTax + exceptionalTotal) * 100) / 100;

      statement = {
        revenueFromOperations: revenueOps,
        otherIncome,
        totalRevenue,
        expenseSections: nonZeroSections,
        totalExpensesExclTax,
        grossProfit,
        ebitda,
        profitBeforeExceptional,
        profitBeforeTax,
        taxExpense,
        profitAfterTax,
        // Breakdown helpers for the frontend KPI bar
        directCosts,
        financeCostsTotal,
        depreciationTotal,
        exceptionalTotal,
      };
    }

    res.json({
      from,
      to,
      companyName,
      entityType,
      presentation,
      income,
      expenses,
      totals: { income: totalIncome, expenses: totalExpenses, netProfit },
      statement,
    });
  } catch (err) {
    console.error("[GET /financial-statements/profit-loss]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
