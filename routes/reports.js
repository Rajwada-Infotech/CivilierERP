const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const sql = require("mssql");
const { cache } = require("../middleware/cache");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const toNumber = (value) => Number(value || 0);

router.use(checkPermissionForMethod("Finance", "Reports"));

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

// ── GET /api/reports/invoice-register ────────────────────────────────────────
// Returns a paginated invoice register built from ExpenseBooking + linked data.
// Columns: Company, Project, Supplier, Amount (Net Payable), Tax (from HSN),
//          Method of Payment, Taxable Amt (Base Amt), Fin Year, Ref Doc,
//          Date, Document Number.
//
// Query params:
//   companyId   – filter by ECompanyId
//   finYearId   – filter by FinYear.FId  (resolves to EFinYear label)
//   finYear     – filter by EFinYear label directly (e.g. "2024-25")
//   dateFrom    – YYYY-MM-DD  (applied to EDocDate)
//   dateTo      – YYYY-MM-DD
//   page        – default 1
//   limit       – default 50, max 200
router.get("/invoice-register", async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "50", 10), 1),
      200,
    );
    const offset = (page - 1) * limit;

    const { companyId, finYearId, finYear, dateFrom, dateTo } = req.query;

    // Resolve finYear label from FId when finYearId is given
    let finYearLabel = finYear ? String(finYear).trim() : null;
    if (finYearId && !finYearLabel) {
      const fyRes = await pool
        .request()
        .input("FId", sql.Int, parseInt(finYearId, 10))
        .query("SELECT FName FROM dbo.FinYear WHERE FId = @FId");
      if (fyRes.recordset.length) finYearLabel = fyRes.recordset[0].FName;
    }

    // Build WHERE clauses
    const whereParts = [
      "ISNULL(eb.EStatus, '') NOT IN ('Draft')",
      "ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'",
    ];
    const request = pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit);

    if (companyId) {
      whereParts.push("eb.ECompanyId = @CompanyId");
      request.input("CompanyId", sql.Int, parseInt(companyId, 10));
    }
    if (finYearLabel) {
      whereParts.push("eb.EFinYear = @FinYear");
      request.input("FinYear", sql.NVarChar(20), finYearLabel);
    }
    if (dateFrom) {
      whereParts.push("CAST(eb.EDocDate AS DATE) >= @DateFrom");
      request.input("DateFrom", sql.Date, dateFrom);
    }
    if (dateTo) {
      whereParts.push("CAST(eb.EDocDate AS DATE) <= @DateTo");
      request.input("DateTo", sql.Date, dateTo);
    }

    const whereSQL = "WHERE " + whereParts.join(" AND ");

    const result = await request.query(`
      SELECT
        -- ── Identity ────────────────────────────────────────────────────────
        eb.Eid,
        eb.EDocNo                                        AS DocumentNumber,
        CONVERT(VARCHAR(10), eb.EDocDate, 23)            AS DocDate,
        eb.EFinYear                                      AS FinYear,

        -- ── Company ─────────────────────────────────────────────────────────
        ISNULL(ec.name, '')                              AS Company,

        -- ── Project ─────────────────────────────────────────────────────────
        ISNULL(ep.name, eb.EProjectName)                AS Project,

        -- ── Supplier (GRN → account head; others → EName) ───────────────────
        CASE
          WHEN eb.ESourceType = 'GRN' AND grn.GRNID IS NOT NULL
            THEN ISNULL(ahm.LHeadName, ISNULL(eb.EName, ''))
          ELSE ISNULL(eb.EName, '')
        END                                              AS Supplier,

        -- ── Amounts ─────────────────────────────────────────────────────────
        -- Taxable (base) amount = EAmount which is pre-GST gross
        ISNULL(eb.EAmount, 0)                           AS TaxableAmount,

        -- Net payable = ENetAmount (post billing-terms) or fall back to EAmount
        ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))   AS NetPayable,

        -- Tax = Net Payable − Taxable Amount (derived; capped at ≥ 0)
        -- For GRN bookings with a live GRN total we still use stored rates
        -- so tax is always: netPayable - taxableAmount (they already include GST)
        CASE
          WHEN ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))
             > ISNULL(eb.EAmount, 0)
          THEN ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))
             - ISNULL(eb.EAmount, 0)
          ELSE 0
        END                                              AS TaxAmount,

        -- GST rates stored on the booking (for context / export)
        ISNULL(eb.ECgstRate, 0)                         AS CgstRate,
        ISNULL(eb.ESgstRate, 0)                         AS SgstRate,

        -- ── Ref Doc type ────────────────────────────────────────────────────
        -- Map ESourceType → Ref Doc label requested by product
        CASE eb.ESourceType
          WHEN 'PO'        THEN 'PO'
          WHEN 'WO_PO'     THEN 'WO_PO'
          WHEN 'GRN'       THEN 'PO'          -- GRN is always downstream of a PO
          WHEN 'WORK_DONE' THEN 'WO'
          ELSE ISNULL(NULLIF(LTRIM(RTRIM(eb.EDocumentType)), ''), 'Other Expenses')
        END                                              AS RefDoc,

        -- Raw type for transparency
        eb.ESourceType                                   AS SourceType,
        eb.EDocumentType                                 AS DocumentType,

        -- ── Method of Payment ────────────────────────────────────────────────
        -- Latest approved payment's PMode against this booking's EDocNo
        ISNULL(
          (SELECT TOP 1 np.PMode
           FROM dbo.NewPayment np
           WHERE np.PExpenseRef = eb.EDocNo
             AND np.Status IN ('Approved', 'Cleared', 'Paid')
           ORDER BY np.PPaymentID DESC),
          (SELECT TOP 1 np2.PMode
           FROM dbo.NewPayment np2
           WHERE np2.PExpenseRef = eb.EDocNo
           ORDER BY np2.PPaymentID DESC)
        )                                                AS MethodOfPayment,

        COUNT(*) OVER()                                  AS _total
      FROM dbo.ExpenseBooking eb
      LEFT JOIN dbo.enterprise  ec  ON ec.id = eb.ECompanyId
      CROSS APPLY (SELECT TRY_CAST(eb.EProjectName AS INT) AS _projId) _p
      LEFT JOIN dbo.enterprise  ep  ON ep.id = _p._projId
      LEFT JOIN dbo.GoodsReceiptNotes grn
        ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
      ${whereSQL}
      ORDER BY eb.Eid DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = result.recordset;
    const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;

    const data = rows.map(({ _total, ...r }) => ({
      DocumentNumber: r.DocumentNumber ?? null,
      Date: r.DocDate ?? null,
      FinYear: r.FinYear ?? null,
      Company: r.Company,
      Project: r.Project ?? null,
      Supplier: r.Supplier,
      TaxableAmount: parseFloat(r.TaxableAmount) || 0,
      TaxAmount: parseFloat(r.TaxAmount) || 0,
      NetPayable: parseFloat(r.NetPayable) || 0,
      CgstRate: parseFloat(r.CgstRate) || 0,
      SgstRate: parseFloat(r.SgstRate) || 0,
      RefDoc: r.RefDoc,
      SourceType: r.SourceType ?? null,
      DocumentType: r.DocumentType ?? null,
      MethodOfPayment: r.MethodOfPayment ?? null,
    }));

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("Invoice register error:", err.message);
    return res.status(500).json({ error: "Failed to load invoice register" });
  }
});

// ── GET /api/reports/tds ──────────────────────────────────────────────────────
// TDS deduction register (migration 304) — every NewPayment row that
// actually withheld TDS (TDSAmount > 0), invoice-linked or direct. This is
// the real "TDS deducted" event: an invoice's own TDSId is only a
// snapshot/tag until a payment against it actually posts the deduction.
//
// Query params:
//   companyId  – filter by the payment's PCompany
//   finYearId  – filter by FinYear.FId (resolves to date range on PDate)
//   dateFrom   – YYYY-MM-DD (applied to PDate)
//   dateTo     – YYYY-MM-DD
//   page       – default 1
//   limit      – default 50, max 200
router.get("/tds", async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 200);
    const offset = (page - 1) * limit;

    const { companyId, finYearId, dateFrom, dateTo } = req.query;

    let fyStart = null, fyEnd = null;
    if (finYearId) {
      const fy = await pool.request().input("FId", sql.Int, parseInt(finYearId, 10))
        .query("SELECT FStartDate, FEndDate FROM dbo.FinYear WHERE FId = @FId");
      if (fy.recordset.length) {
        fyStart = fy.recordset[0].FStartDate;
        fyEnd = fy.recordset[0].FEndDate;
      }
    }

    const whereParts = ["ISNULL(np.TDSAmount, 0) > 0"];
    const request = pool.request().input("offset", sql.Int, offset).input("limit", sql.Int, limit);

    if (companyId) {
      whereParts.push("TRY_CAST(np.PCompany AS INT) = @CompanyId");
      request.input("CompanyId", sql.Int, parseInt(companyId, 10));
    }
    if (dateFrom) {
      whereParts.push("CAST(np.PDate AS DATE) >= @DateFrom");
      request.input("DateFrom", sql.Date, dateFrom);
    } else if (fyStart) {
      whereParts.push("CAST(np.PDate AS DATE) >= @FYStart");
      request.input("FYStart", sql.Date, fyStart);
    }
    if (dateTo) {
      whereParts.push("CAST(np.PDate AS DATE) <= @DateTo");
      request.input("DateTo", sql.Date, dateTo);
    } else if (fyEnd) {
      whereParts.push("CAST(np.PDate AS DATE) <= @FYEnd");
      request.input("FYEnd", sql.Date, fyEnd);
    }

    const whereSQL = "WHERE " + whereParts.join(" AND ");

    const result = await request.query(`
      SELECT
        np.PPaymentID,
        np.DocNo,
        CONVERT(VARCHAR(10), np.PDate, 23)                  AS PayDate,
        ISNULL(pfy.FName, '')                                AS FinYear,
        ISNULL(ec.name, np.PCompany)                         AS Company,
        -- Party: linked invoice's resolved supplier, else the direct party.
        COALESCE(
          CASE
            WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadName
            WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadName
            ELSE grn2_sup.LHeadName
          END,
          party_head.LHeadName
        )                                                    AS PartyName,
        CASE WHEN np.PExpenseRef IS NOT NULL AND np.PExpenseRef <> '' AND np.ContractId IS NULL
             THEN 'Invoice' ELSE 'Direct' END                AS PaymentType,
        np.PExpenseRef                                       AS InvoiceRef,
        np.TDSNature,
        np.TDSName,
        ISNULL(np.TDSPercentage, 0)                          AS TDSPercentage,
        ISNULL(np.PAmount, 0)                                AS GrossAmount,
        ISNULL(np.TDSAmount, 0)                              AS TDSAmount,
        ISNULL(np.PAmount, 0) - ISNULL(np.TDSAmount, 0)      AS NetPaid,
        COUNT(*) OVER()                                      AS _total
      FROM dbo.NewPayment np
      LEFT JOIN dbo.FinYear pfy ON pfy.FId = np.PFinYearId
      LEFT JOIN dbo.enterprise ec ON ec.id = TRY_CAST(np.PCompany AS INT) AND ec.business_type = 'C'
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      LEFT JOIN dbo.GoodsReceiptNotes grn_eb ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.AccountHeadMaster grn_sup ON grn_sup.LHeadId = grn_eb.SupplierID
      LEFT JOIN dbo.PurchaseOrders po ON eb.ESourceType = 'PO' AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.AccountHeadMaster po_sup ON po_sup.LHeadId = po.SupplierID
      LEFT JOIN dbo.GoodsReceiptNotes grn2 ON eb.ESourceType NOT IN ('GRN','PO') AND grn2.POID = po.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster grn2_sup ON grn2_sup.LHeadId = grn2.SupplierID
      LEFT JOIN dbo.AccountHeadMaster party_head ON party_head.LHeadId = np.PPartyId
      ${whereSQL}
      ORDER BY np.PDate DESC, np.PPaymentID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = result.recordset;
    const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;

    const data = rows.map(({ _total, ...r }) => ({
      PPaymentID: r.PPaymentID,
      DocNo: r.DocNo,
      PayDate: r.PayDate,
      FinYear: r.FinYear || null,
      Company: r.Company,
      PartyName: r.PartyName || null,
      PaymentType: r.PaymentType,
      InvoiceRef: r.InvoiceRef || null,
      TDSNature: r.TDSNature || null,
      TDSName: r.TDSName || null,
      TDSPercentage: parseFloat(r.TDSPercentage) || 0,
      GrossAmount: parseFloat(r.GrossAmount) || 0,
      TDSAmount: parseFloat(r.TDSAmount) || 0,
      NetPaid: parseFloat(r.NetPaid) || 0,
    }));

    // Fresh request for the grand-total row (same filters, whole result
    // set — not just this page) rather than reusing `request`, which
    // already has offset/limit bound to this page.
    const totalsRequest = pool.request();
    if (companyId) totalsRequest.input("CompanyId", sql.Int, parseInt(companyId, 10));
    if (dateFrom) totalsRequest.input("DateFrom", sql.Date, dateFrom);
    else if (fyStart) totalsRequest.input("FYStart", sql.Date, fyStart);
    if (dateTo) totalsRequest.input("DateTo", sql.Date, dateTo);
    else if (fyEnd) totalsRequest.input("FYEnd", sql.Date, fyEnd);
    const totalsRes = await totalsRequest.query(
      `SELECT ISNULL(SUM(np.TDSAmount), 0) AS TotalTDS, ISNULL(SUM(np.PAmount), 0) AS TotalGross FROM dbo.NewPayment np ${whereSQL}`,
    );

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      totals: {
        tdsAmount: parseFloat(totalsRes.recordset?.[0]?.TotalTDS) || 0,
        grossAmount: parseFloat(totalsRes.recordset?.[0]?.TotalGross) || 0,
      },
    });
  } catch (err) {
    console.error("TDS report error:", err.message);
    return res.status(500).json({ error: "Failed to load TDS report" });
  }
});

module.exports = router;
