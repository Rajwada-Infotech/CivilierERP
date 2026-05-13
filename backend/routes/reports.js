const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const sql = require("mssql");
const { cache } = require("../middleware/cache");
const toNumber = (value) => Number(value || 0);

function buildDateWhere(
  mode,
  dateFrom,
  dateTo,
  finYearStart,
  finYearEnd,
  tableAlias,
) {
  const col = tableAlias ? `${tableAlias}.` : "";
  if (mode === "single" && dateFrom) {
    return {
      clause: `AND CAST(${col}%%COL%% AS DATE) = @DateFrom`,
      params: { DateFrom: dateFrom },
    };
  }
  if (mode === "range" && dateFrom && dateTo) {
    return {
      clause: `AND CAST(${col}%%COL%% AS DATE) BETWEEN @DateFrom AND @DateTo`,
      params: { DateFrom: dateFrom, DateTo: dateTo },
    };
  }
  if (mode === "finYear" && finYearStart && finYearEnd) {
    return {
      clause: `AND CAST(${col}%%COL%% AS DATE) BETWEEN @FYStart AND @FYEnd`,
      params: { FYStart: finYearStart, FYEnd: finYearEnd },
    };
  }
  if (mode === "day" && dateFrom) {
    return {
      clause: `AND CAST(${col}%%COL%% AS DATE) = @DateFrom`,
      params: { DateFrom: dateFrom },
    };
  }
  if (mode === "month" && dateFrom) {
    // dateFrom is YYYY-MM
    const [yr, mo] = dateFrom.split("-");
    const start = `${yr}-${mo}-01`;
    const end = new Date(parseInt(yr), parseInt(mo), 0)
      .toISOString()
      .slice(0, 10);
    return {
      clause: `AND CAST(${col}%%COL%% AS DATE) BETWEEN @DateFrom AND @DateTo`,
      params: { DateFrom: start, DateTo: end },
    };
  }
  return { clause: "", params: {} };
}

function buildLastSixMonths(paymentRows, expenseRows) {
  // Key by "YYYY-MM" to avoid timezone-shift issues with DATEFROMPARTS dates
  const paymentMap = new Map(
    paymentRows.map((row) => {
      const d = new Date(row.BucketDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return [key, toNumber(row.IncomeAmount)];
    }),
  );
  const expenseMap = new Map(
    expenseRows.map((row) => {
      const d = new Date(row.BucketDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return [key, toNumber(row.ExpenseAmount)];
    }),
  );
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      month: date.toLocaleDateString("en-IN", {
        month: "short",
        year: "2-digit",
      }),
      income: paymentMap.get(key) || 0,
      expense: expenseMap.get(key) || 0,
    };
  });
}

router.get("/", cache("reports", 60), async (req, res) => {
  try {
    const {
      companyId,
      mode, // "single"|"range"|"finYear"|"day"|"month"
      dateFrom,
      dateTo,
      finYearId,
    } = req.query;

    const pool = getPool();

    // Resolve fin year dates if finYearId provided
    let finYearStart = null,
      finYearEnd = null,
      finYearLabel = null;
    if (finYearId) {
      const fyRes = await pool
        .request()
        .input("FId", sql.Int, parseInt(finYearId, 10))
        .query(
          "SELECT FName, FStartDate, FEndDate FROM dbo.FinYear WHERE FId = @FId",
        );
      if (fyRes.recordset.length) {
        finYearStart =
          fyRes.recordset[0].FStartDate?.toISOString?.()?.slice(0, 10) || null;
        finYearEnd =
          fyRes.recordset[0].FEndDate?.toISOString?.()?.slice(0, 10) || null;
        finYearLabel = fyRes.recordset[0].FName;
      }
    }

    const dateFilter = buildDateWhere(
      mode,
      dateFrom,
      dateTo,
      finYearStart,
      finYearEnd,
      "",
    );

    // Build company filter
    const compWhere = companyId ? "AND ECompanyId = @CompanyId" : "";
    const compWhereP = companyId
      ? "AND PCompany = (SELECT name FROM dbo.enterprise WHERE id = @CompanyId)"
      : "";

    function applyParams(req2, params) {
      if (params.DateFrom) req2.input("DateFrom", sql.Date, params.DateFrom);
      if (params.DateTo) req2.input("DateTo", sql.Date, params.DateTo);
      if (params.FYStart) req2.input("FYStart", sql.Date, params.FYStart);
      if (params.FYEnd) req2.input("FYEnd", sql.Date, params.FYEnd);
      if (companyId) req2.input("CompanyId", sql.Int, parseInt(companyId, 10));
      return req2;
    }

    const expDateClause = dateFilter.clause.replace("%%COL%%", "EDocDate");
    const payDateClause = dateFilter.clause.replace("%%COL%%", "PDate");

    const [
      paymentSummaryResult,
      expenseSummaryResult,
      paymentTrendResult,
      expenseTrendResult,
      expenseCategoryResult,
      topPartiesResult,
    ] = await Promise.all([
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT COUNT(*) AS TotalPayments, ISNULL(SUM(PAmount),0) AS TotalIncome
        FROM dbo.NewPayment WHERE 1=1 ${payDateClause} ${compWhereP}
      `),
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT COUNT(*) AS TotalExpenses, ISNULL(SUM(EAmount),0) AS TotalExpenseAmount
        FROM dbo.ExpenseBooking WHERE 1=1 ${expDateClause} ${compWhere}
      `),
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT DATEFROMPARTS(YEAR(PDate),MONTH(PDate),1) AS BucketDate,
               ISNULL(SUM(PAmount),0) AS IncomeAmount
        FROM dbo.NewPayment
        WHERE PDate >= DATEADD(MONTH,-5,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
        ${compWhereP}
        GROUP BY DATEFROMPARTS(YEAR(PDate),MONTH(PDate),1)
        ORDER BY BucketDate ASC
      `),
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT DATEFROMPARTS(YEAR(EDocDate),MONTH(EDocDate),1) AS BucketDate,
               ISNULL(SUM(EAmount),0) AS ExpenseAmount
        FROM dbo.ExpenseBooking
        WHERE EDocDate >= DATEADD(MONTH,-5,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
        ${compWhere}
        GROUP BY DATEFROMPARTS(YEAR(EDocDate),MONTH(EDocDate),1)
        ORDER BY BucketDate ASC
      `),
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT TOP 4
          ISNULL(NULLIF(LTRIM(RTRIM(EDocumentType)),''),'Unclassified') AS CategoryName,
          ISNULL(SUM(EAmount),0) AS TotalAmount
        FROM dbo.ExpenseBooking
        WHERE 1=1 ${expDateClause} ${compWhere}
        GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(EDocumentType)),''),'Unclassified')
        ORDER BY TotalAmount DESC
      `),
      applyParams(pool.request(), dateFilter.params).query(`
        SELECT TOP 4
          ISNULL(NULLIF(LTRIM(RTRIM(PPaymentName)),''),'Unknown Party') AS PartyName,
          COUNT(*) AS TransactionCount,
          ISNULL(SUM(PAmount),0) AS TotalAmount
        FROM dbo.NewPayment
        WHERE 1=1 ${payDateClause} ${compWhereP}
        GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(PPaymentName)),''),'Unknown Party')
        ORDER BY TotalAmount DESC
      `),
    ]);

    const paymentSummary = paymentSummaryResult.recordset[0] || {};
    const expenseSummary = expenseSummaryResult.recordset[0] || {};
    const monthlyData = buildLastSixMonths(
      paymentTrendResult.recordset,
      expenseTrendResult.recordset,
    );

    let runningBalance = 0;
    const cashFlowData = monthlyData.map((row) => {
      runningBalance += row.income - row.expense;
      return { month: row.month, balance: runningBalance };
    });

    const totalIncome = toNumber(paymentSummary.TotalIncome);
    const totalExpense = toNumber(expenseSummary.TotalExpenseAmount);

    return res.json({
      generatedAt: new Date().toISOString(),
      filters: {
        companyId: companyId || null,
        mode: mode || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        finYearLabel,
      },
      summary: {
        totalIncome,
        totalExpenses: totalExpense,
        netProfit: totalIncome - totalExpense,
        transactionCount:
          toNumber(paymentSummary.TotalPayments) +
          toNumber(expenseSummary.TotalExpenses),
      },
      charts: {
        monthly: monthlyData,
        categories: expenseCategoryResult.recordset.map((row, i) => ({
          name: row.CategoryName,
          value: toNumber(row.TotalAmount),
          color: [
            "hsl(142 71% 45%)",
            "hsl(0 72% 51%)",
            "hsl(201 96% 32%)",
            "hsl(220 70% 50%)",
          ][i % 4],
        })),
        cashFlow: cashFlowData,
      },
      topParties: topPartiesResult.recordset.map((row) => ({
        name: row.PartyName,
        txns: toNumber(row.TransactionCount),
        total: toNumber(row.TotalAmount),
      })),
    });
  } catch (error) {
    console.error("Reports dashboard error:", error.message);
    return res.status(500).json({ error: "Failed to load reports dashboard" });
  }
});

// GET /api/reports/companies — companies for filter dropdown
router.get("/companies", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query(
        "SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND (discontinue IS NULL OR discontinue = 0) ORDER BY name",
      );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
