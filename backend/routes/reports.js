const express = require("express");

const router = express.Router();

const { getPool } = require("../db");
const { redisGet, redisSet } = require("../redis");

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = "reports:dashboard";

const toNumber = (value) => Number(value || 0);

function buildLastSixMonths(paymentRows, expenseRows) {
  const paymentMap = new Map(
    paymentRows.map((row) => [
      new Date(row.BucketDate).toISOString().slice(0, 10),
      toNumber(row.IncomeAmount),
    ]),
  );
  const expenseMap = new Map(
    expenseRows.map((row) => [
      new Date(row.BucketDate).toISOString().slice(0, 10),
      toNumber(row.ExpenseAmount),
    ]),
  );

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));

    const isoDate = date.toISOString().slice(0, 10);

    return {
      month: date.toLocaleDateString("en-IN", {
        month: "short",
      }),
      income: paymentMap.get(isoDate) || 0,
      expense: expenseMap.get(isoDate) || 0,
    };
  });
}

router.get("/", async (req, res) => {
  try {
    try {
      const cached = await redisGet(CACHE_KEY);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (cacheReadError) {
      console.warn("Reports cache read failed:", cacheReadError.message);
    }

    const pool = getPool();

    const [
      paymentSummaryResult,
      expenseSummaryResult,
      paymentTrendResult,
      expenseTrendResult,
      expenseCategoryResult,
      topPartiesResult,
    ] = await Promise.all([
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalPayments,
          ISNULL(SUM(PAmount), 0) AS TotalIncome
        FROM dbo.NewPayment
      `),

      pool.request().query(`
        SELECT
          COUNT(*) AS TotalExpenses,
          ISNULL(SUM(EAmount), 0) AS TotalExpenseAmount
        FROM dbo.ExpenseBooking
      `),

      pool.request().query(`
        SELECT
          DATEFROMPARTS(YEAR(PDate), MONTH(PDate), 1) AS BucketDate,
          ISNULL(SUM(PAmount), 0) AS IncomeAmount
        FROM dbo.NewPayment
        WHERE PDate >= DATEADD(MONTH, -5, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
        GROUP BY DATEFROMPARTS(YEAR(PDate), MONTH(PDate), 1)
        ORDER BY BucketDate ASC
      `),

      pool.request().query(`
        SELECT
          DATEFROMPARTS(YEAR(EDocDate), MONTH(EDocDate), 1) AS BucketDate,
          ISNULL(SUM(EAmount), 0) AS ExpenseAmount
        FROM dbo.ExpenseBooking
        WHERE EDocDate >= DATEADD(MONTH, -5, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
        GROUP BY DATEFROMPARTS(YEAR(EDocDate), MONTH(EDocDate), 1)
        ORDER BY BucketDate ASC
      `),

      pool.request().query(`
        SELECT TOP 4
          ISNULL(NULLIF(LTRIM(RTRIM(EDocumentType)), ''), 'Unclassified') AS CategoryName,
          ISNULL(SUM(EAmount), 0) AS TotalAmount
        FROM dbo.ExpenseBooking
        GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(EDocumentType)), ''), 'Unclassified')
        ORDER BY TotalAmount DESC, CategoryName ASC
      `),

      pool.request().query(`
        SELECT TOP 4
          ISNULL(NULLIF(LTRIM(RTRIM(PPaymentName)), ''), 'Unknown Party') AS PartyName,
          COUNT(*) AS TransactionCount,
          ISNULL(SUM(PAmount), 0) AS TotalAmount
        FROM dbo.NewPayment
        GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(PPaymentName)), ''), 'Unknown Party')
        ORDER BY TotalAmount DESC, PartyName ASC
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
      return {
        month: row.month,
        balance: runningBalance,
      };
    });

    const totalIncome = toNumber(paymentSummary.TotalIncome);
    const totalExpense = toNumber(expenseSummary.TotalExpenseAmount);
    const totalPayments = toNumber(paymentSummary.TotalPayments);
    const totalExpenses = toNumber(expenseSummary.TotalExpenses);

    const response = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalIncome,
        totalExpenses: totalExpense,
        netProfit: totalIncome - totalExpense,
        transactionCount: totalPayments + totalExpenses,
      },
      charts: {
        monthly: monthlyData,
        categories: expenseCategoryResult.recordset.map((row, index) => ({
          name: row.CategoryName,
          value: toNumber(row.TotalAmount),
          color: [
            "hsl(142 71% 45%)",
            "hsl(0 72% 51%)",
            "hsl(201 96% 32%)",
            "hsl(220 70% 50%)",
          ][index % 4],
        })),
        cashFlow: cashFlowData,
      },
      topParties: topPartiesResult.recordset.map((row) => ({
        name: row.PartyName,
        txns: toNumber(row.TransactionCount),
        total: toNumber(row.TotalAmount),
      })),
      meta: {
        cacheTTL: CACHE_TTL_SECONDS,
      },
    };

    try {
      await redisSet(CACHE_KEY, JSON.stringify(response), CACHE_TTL_SECONDS);
    } catch (cacheWriteError) {
      console.warn("Reports cache write failed:", cacheWriteError.message);
    }

    return res.json(response);
  } catch (error) {
    console.error("Reports dashboard error:", error.message);
    return res.status(500).json({
      error: "Failed to load reports dashboard",
    });
  }
});

module.exports = router;
