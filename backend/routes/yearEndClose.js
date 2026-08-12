const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const authenticateToken = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(authenticateToken);
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { postVoucher } = require("../services/generalLedger");

const ROOT_IDS = { LIABILITIES: 1, ASSETS: 2, REVENUE: 3, EXPENSES: 4 };

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

const adminOnly = allowRoles("admin", "super_admin", "dba", "accounts_head");

router.get("/preview", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const fyId = req.query.financialYearId ? parseInt(req.query.financialYearId, 10) : null;
    
    if (!companyId || !fyId) {
      return res.status(400).json({ error: "companyId and financialYearId are required" });
    }

    const fyRes = await pool.request()
      .input("fyId", sql.Int, fyId)
      .query(`SELECT FId, FName, FStartDate, FEndDate, FStatus, FisLocked FROM dbo.FinYear WHERE FId = @fyId`);
    
    if (fyRes.recordset.length === 0) {
      return res.status(404).json({ error: "Financial year not found" });
    }
    
    const fy = fyRes.recordset[0];
    
    if (fy.FisLocked) {
      return res.status(400).json({ error: "already_closed" });
    }

    const from = fy.FStartDate;
    const to = fy.FEndDate;

    const groupMap = await loadGroups(pool);

    const headsRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId).query(`
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
          AND gle.CompanyId = @companyId
        GROUP BY ahm.LHeadId, ahm.LHeadName, ahm.LBelongsTo
      `);

    let totalIncome = 0;
    let totalExpenses = 0;
    const headsSummary = [];

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
        totalIncome += net;
        headsSummary.push({ groupName, headName: h.name, amount: net });
      } else if (root === ROOT_IDS.EXPENSES) {
        const net = Math.round((debit - credit) * 100) / 100;
        if (Math.abs(net) < 0.005) continue;
        totalExpenses += net;
        headsSummary.push({ groupName, headName: h.name, amount: net });
      }
    }

    totalIncome = Math.round(totalIncome * 100) / 100;
    totalExpenses = Math.round(totalExpenses * 100) / 100;
    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;

    res.json({
      fy: {
        id: fy.FId,
        name: fy.FName,
        startDate: fy.FStartDate,
        endDate: fy.FEndDate
      },
      companyId,
      totalIncome,
      totalExpenses,
      netProfit,
      isProfit: netProfit >= 0,
      headsSummary
    });
  } catch (err) {
    console.error("[GET /year-end-close/preview]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/carry-forward", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const { financialYearId, companyId } = req.body;
    
    if (!companyId || !financialYearId) {
      return res.status(400).json({ error: "companyId and financialYearId are required" });
    }

    const fyRes = await pool.request()
      .input("fyId", sql.Int, financialYearId)
      .query(`SELECT FId, FName, FStartDate, FEndDate, FStatus, FisLocked FROM dbo.FinYear WHERE FId = @fyId`);
    
    if (fyRes.recordset.length === 0) {
      return res.status(404).json({ error: "Financial year not found" });
    }
    
    const fy = fyRes.recordset[0];
    
    if (fy.FisLocked) {
      return res.status(400).json({ error: "already_closed" });
    }

    const checkYEC = await pool.request()
      .input("companyId", sql.Int, companyId)
      .input("fyId", sql.Int, financialYearId)
      .query(`SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType = 'YearEndClose' AND SourceId = @fyId AND CompanyId = @companyId`);
    
    if (checkYEC.recordset.length > 0) {
      return res.status(400).json({ error: "already_processed" });
    }

    const from = fy.FStartDate;
    const to = fy.FEndDate;

    const groupMap = await loadGroups(pool);

    const headsRes = await pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to)
      .input("companyId", sql.Int, companyId).query(`
        SELECT
          ahm.LHeadId AS id,
          ahm.LBelongsTo AS groupId,
          ISNULL(SUM(gle.DebitAmount), 0) AS debit,
          ISNULL(SUM(gle.CreditAmount), 0) AS credit
        FROM dbo.AccountHeadMaster ahm
        JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = ahm.LHeadId
        WHERE ahm.LBelongsTo IS NOT NULL AND gle.IsReversed = 0
          AND gle.VoucherDate BETWEEN @from AND @to
          AND gle.CompanyId = @companyId
        GROUP BY ahm.LHeadId, ahm.LBelongsTo
      `);

    let totalIncome = 0;
    let totalExpenses = 0;

    for (const h of headsRes.recordset) {
      const debit = Number(h.debit) || 0;
      const credit = Number(h.credit) || 0;
      const gid = Number(h.groupId);
      const root = rootOf(groupMap, gid);

      if (root === ROOT_IDS.REVENUE) {
        totalIncome += credit - debit;
      } else if (root === ROOT_IDS.EXPENSES) {
        totalExpenses += debit - credit;
      }
    }

    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;
    
    // Find or create Reserves & Surplus and Retained Earnings
    let rsGroupId = null;
    let reHeadId = null;
    let incSumHeadId = null;

    const rsRes = await pool.request().query(`SELECT AGId FROM dbo.AccountGroup WHERE Name = 'Reserves & Surplus' AND ParentGroupId = 1`);
    if (rsRes.recordset.length > 0) {
      rsGroupId = rsRes.recordset[0].AGId;
    } else {
      const insGrp = await pool.request().query(`INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedAt) OUTPUT inserted.AGId VALUES ('Reserves & Surplus', 'RS', 1, 1, GETDATE())`);
      rsGroupId = insGrp.recordset[0].AGId;
    }

    const reRes = await pool.request().input("groupId", sql.Int, rsGroupId).query(`SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Retained Earnings' AND LBelongsTo = @groupId`);
    if (reRes.recordset.length > 0) {
      reHeadId = reRes.recordset[0].LHeadId;
    } else {
      const insHead = await pool.request().input("groupId", sql.Int, rsGroupId).query(`INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadType, LBelongsTo, LHeadStatus) OUTPUT inserted.LHeadId VALUES ('Retained Earnings', 'GL', @groupId, 1)`);
      reHeadId = insHead.recordset[0].LHeadId;
    }
    
    const isRes = await pool.request().input("groupId", sql.Int, rsGroupId).query(`SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Income Summary' AND LBelongsTo = @groupId`);
    if (isRes.recordset.length > 0) {
      incSumHeadId = isRes.recordset[0].LHeadId;
    } else {
      const insHead = await pool.request().input("groupId", sql.Int, rsGroupId).query(`INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadType, LBelongsTo, LHeadStatus) OUTPUT inserted.LHeadId VALUES ('Income Summary', 'GL', @groupId, 1)`);
      incSumHeadId = insHead.recordset[0].LHeadId;
    }

    const voucherNo = `YEC-FY${fy.FName}-${companyId}`;
    
    if (Math.abs(netProfit) >= 0.01) {
      const legs = [];
      if (netProfit > 0) {
        legs.push({ lHeadId: incSumHeadId, debit: netProfit, credit: 0, narration: `Year End Closing — transfer P&L surplus to Retained Earnings` });
        legs.push({ lHeadId: reHeadId, debit: 0, credit: netProfit, narration: `Year End Closing — Net Profit FY ${fy.FName}` });
      } else {
        const loss = Math.abs(netProfit);
        legs.push({ lHeadId: reHeadId, debit: loss, credit: 0, narration: `Year End Closing — Net Loss FY ${fy.FName}` });
        legs.push({ lHeadId: incSumHeadId, debit: 0, credit: loss, narration: `Year End Closing — transfer P&L deficit to Retained Earnings` });
      }

      await postVoucher(pool, {
        voucherNo,
        voucherDate: fy.FEndDate,
        legs,
        sourceType: "YearEndClose",
        sourceId: fy.FId,
        companyId,
        createdBy: req.user?.email || req.user?.userId?.toString() || "system",
      });
    }
    
    await pool.request().input("fyId", sql.Int, financialYearId).query(`UPDATE dbo.FinYear SET FisLocked = 1 WHERE FId = @fyId`);

    res.json({ success: true, netProfit, voucherNo, locked: true });
  } catch (err) {
    console.error("[POST /year-end-close/carry-forward]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/history", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const histRes = await pool.request()
      .input("companyId", sql.Int, companyId)
      .query(`
        SELECT 
          gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.SourceId,
          ahm.LHeadName, gle.DebitAmount, gle.CreditAmount
        FROM dbo.GeneralLedgerEntry gle
        JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = gle.LHeadId
        WHERE gle.CompanyId = @companyId AND gle.SourceType = 'YearEndClose'
        ORDER BY gle.VoucherDate DESC, gle.VoucherNo, gle.EntryId
      `);
      
    const grouped = {};
    for (const row of histRes.recordset) {
      if (!grouped[row.VoucherNo]) {
        grouped[row.VoucherNo] = {
          voucherNo: row.VoucherNo,
          voucherDate: row.VoucherDate,
          fyId: row.SourceId,
          details: []
        };
      }
      grouped[row.VoucherNo].details.push({
        headName: row.LHeadName,
        debit: row.DebitAmount,
        credit: row.CreditAmount
      });
    }

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("[GET /year-end-close/history]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
