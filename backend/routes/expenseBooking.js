const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const { validateBody } = require("../middleware/validateRequest");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const {
  expenseBookingBodySchema,
  expenseBookingUpdateSchema,
  emiPaySchema,
  emiToggleSchema,
  expenseRejectSchema,
} = require("../validation/expenseBookingSchemas");

router.use(checkPermissionForMethod("Finance", "ExpenseBooking"));

// Helper: Require authenticated user email
const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeState(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Apply billing terms (EBillingTermsData or EDiscountData) to a gross amount.
 * Mirrors the frontend computeBreakdown logic for post-GST terms only
 * (GRN netAmount is already incl-GST, so all terms apply post-GST on top of it).
 * Returns the rounded net amount after applying all active terms.
 *
 * @param {number} grossAmount - incl-GST amount (grnGst.totals.netAmount)
 * @param {number} basicAmount - pre-GST taxable amount (grnGst.totals.taxableAmount)
 * @param {number} cgstRate - effective CGST %
 * @param {number} sgstRate - effective SGST %
 * @param {any} billingTermsRaw - EBillingTermsData (array or JSON string)
 * @param {any} discountRaw     - EDiscountData (object or JSON string) fallback
 */
function applyBillingTermsToAmount(
  grossAmount,
  basicAmount,
  cgstRate,
  sgstRate,
  billingTermsRaw,
  discountRaw,
) {
  const terms = parseJsonArray(billingTermsRaw);
  let activeTerms = terms.filter((t) => t.applicable);

  // Legacy single-discount fallback
  if (activeTerms.length === 0 && discountRaw) {
    try {
      const d =
        typeof discountRaw === "string" ? JSON.parse(discountRaw) : discountRaw;
      if (d && d.applicable) activeTerms = [d];
    } catch {
      /* ignore */
    }
  }

  if (activeTerms.length === 0) return Math.round(grossAmount);

  // Split terms into pre-GST and post-GST
  const preGstTerms = activeTerms.filter((t) => t.appliedOn !== "post-gst");
  const postGstTerms = activeTerms.filter((t) => t.appliedOn === "post-gst");

  // Apply pre-GST terms to basicAmount then recompute grossAmount
  let runningBase = toNumber(basicAmount);
  for (const t of preGstTerms) {
    const amt =
      t.type === "percentage"
        ? (runningBase * toNumber(t.value)) / 100
        : toNumber(t.value);
    if (t.deductionType === "Addition") {
      runningBase += amt;
    } else {
      runningBase = Math.max(0, runningBase - Math.min(amt, runningBase));
    }
  }
  const cgstAmt = (runningBase * toNumber(cgstRate)) / 100;
  const sgstAmt = (runningBase * toNumber(sgstRate)) / 100;
  let running = roundMoney(runningBase + cgstAmt + sgstAmt);

  // Apply post-GST terms on top of gross
  for (const t of postGstTerms) {
    const amt =
      t.type === "percentage"
        ? (running * toNumber(t.value)) / 100
        : toNumber(t.value);
    if (t.deductionType === "Addition") {
      running += amt;
    } else {
      running = Math.max(0, running - Math.min(amt, running));
    }
  }

  return Math.round(running);
}

async function buildGrnGstData(pool, grnId) {
  const headerResult = await pool.request().input("GRNID", sql.Int, grnId)
    .query(`
      SELECT
        grn.GRNID,
        grn.GRNNo,
        grn.DocNo,
        grn.GRNDate,
        grn.GRNItems,
        grn.SupplierID,
        grn.POID,
        supplier.LHeadName AS SupplierName,
        supplier.LGSTState AS VendorState,
        po.PurchaseOrderID,
        po.PurchaseOrderNo,
        po.POItems,
        po.HsnCode AS POHsnCode,
        po.GstRate AS POGstRate,
        po.GstType AS POGstType,
        po.Rate AS PORate,
        po.CompanyId,
        company.state AS CompanyState
      FROM dbo.GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster supplier ON supplier.LHeadId = grn.SupplierID
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
      LEFT JOIN dbo.enterprise company ON company.id = po.CompanyId
      WHERE grn.GRNID = @GRNID
    `);

  const header = headerResult.recordset[0];
  if (!header) return null;

  const grnItems = parseJsonArray(header.GRNItems);
  const poItems = parseJsonArray(header.POItems);
  const itemIds = [
    ...new Set(
      [...grnItems, ...poItems]
        .map((item) => item.itemId || item.ItemId)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const itemMasterMap = new Map();
  if (itemIds.length > 0) {
    const itemResult = await pool.request().query(`
      SELECT
        CONVERT(NVARCHAR(100), img.M_Id) AS ItemId,
        img.M_Name,
        img.M_HSN,
        h.HCGST,
        h.HSGST,
        h.HIGST
      FROM dbo.Item_Master_Group img
      LEFT JOIN dbo.HSN h ON h.HCode = img.M_HSN AND h.HStatus = 1
      WHERE CONVERT(NVARCHAR(100), img.M_Id) IN (${itemIds
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(",")})
    `);
    itemResult.recordset.forEach((row) => {
      itemMasterMap.set(String(row.ItemId), row);
    });
  }

  const poItemMap = new Map();
  poItems.forEach((item) => {
    const key = String(item.itemId || item.ItemId || item.itemName || "");
    if (key) poItemMap.set(key, item);
  });

  const vendorState = header.VendorState || "";
  const companyState = header.CompanyState || "";
  const isIntraState =
    !normalizeState(vendorState) ||
    !normalizeState(companyState) ||
    normalizeState(vendorState) === normalizeState(companyState);

  const lines = grnItems.map((item, index) => {
    const itemId = String(item.itemId || item.ItemId || "");
    const poItem =
      poItemMap.get(itemId) ||
      poItemMap.get(String(item.itemName || item.ItemName || "")) ||
      {};
    const master = itemMasterMap.get(itemId) || {};

    const receivedQty = toNumber(
      item.receivedQty ?? item.quantity ?? item.qty ?? item.Quantity,
    );
    const orderedQty = toNumber(
      item.orderedQty ?? poItem.quantity ?? poItem.Quantity,
    );
    const unitRate =
      toNumber(item.rate) ||
      toNumber(poItem.rate ?? poItem.Rate) ||
      toNumber(header.PORate);
    const hsnCode =
      item.hsnCode ||
      item.HsnCode ||
      poItem.hsnCode ||
      poItem.HsnCode ||
      master.M_HSN ||
      header.POHsnCode ||
      null;

    const configuredGst =
      toNumber(master.HIGST) ||
      toNumber(master.HCGST) + toNumber(master.HSGST) ||
      toNumber(poItem.tax) ||
      toNumber(header.POGstRate);
    const gstPercent = configuredGst;
    const inclusiveAmount =
      toNumber(item.totalAmountInclGST) ||
      toNumber(item.totalAmount) ||
      toNumber(item.amount) ||
      roundMoney(receivedQty * unitRate);
    const cgstRate = isIntraState ? gstPercent / 2 : 0;
    const sgstRate = isIntraState ? gstPercent / 2 : 0;
    const igstRate = isIntraState ? 0 : gstPercent;
    const totalGstRate = cgstRate + sgstRate + igstRate;
    const taxableAmount = roundMoney(
      totalGstRate > 0
        ? inclusiveAmount / (1 + totalGstRate / 100)
        : inclusiveAmount,
    );
    const cgstAmount = roundMoney((taxableAmount * cgstRate) / 100);
    const sgstAmount = roundMoney((taxableAmount * sgstRate) / 100);
    const igstAmount = roundMoney((taxableAmount * igstRate) / 100);
    const splitGstAmount = roundMoney(cgstAmount + sgstAmount + igstAmount);
    const netAmount = roundMoney(inclusiveAmount);
    const gstAmount = splitGstAmount;

    return {
      lineNo: index + 1,
      itemId: itemId || null,
      itemName:
        item.itemName || item.ItemName || master.M_Name || `Item ${index + 1}`,
      orderedQty,
      receivedQty,
      uom: item.uom || poItem.unit || poItem.UomName || "",
      unitRate,
      hsnCode,
      gstPercent,
      taxableAmount,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      gstAmount: roundMoney(cgstAmount + sgstAmount + igstAmount),
      netAmount: roundMoney(
        taxableAmount + cgstAmount + sgstAmount + igstAmount,
      ),
    };
  });

  const totals = lines.reduce(
    (sum, line) => ({
      taxableAmount: roundMoney(sum.taxableAmount + line.taxableAmount),
      cgstAmount: roundMoney(sum.cgstAmount + line.cgstAmount),
      sgstAmount: roundMoney(sum.sgstAmount + line.sgstAmount),
      igstAmount: roundMoney(sum.igstAmount + line.igstAmount),
      gstAmount: roundMoney(sum.gstAmount + line.gstAmount),
      netAmount: roundMoney(sum.netAmount + line.netAmount),
      receivedQty: roundMoney(sum.receivedQty + line.receivedQty),
    }),
    {
      taxableAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      gstAmount: 0,
      netAmount: 0,
      receivedQty: 0,
    },
  );

  const maxGstPercent = lines.reduce(
    (max, line) => Math.max(max, line.gstPercent || 0),
    0,
  );

  const effectiveCgstRate =
    totals.taxableAmount > 0
      ? roundMoney((totals.cgstAmount / totals.taxableAmount) * 100)
      : 0;
  const effectiveSgstRate =
    totals.taxableAmount > 0
      ? roundMoney((totals.sgstAmount / totals.taxableAmount) * 100)
      : 0;
  const effectiveIgstRate =
    totals.taxableAmount > 0
      ? roundMoney((totals.igstAmount / totals.taxableAmount) * 100)
      : 0;

  return {
    grnId: header.GRNID,
    grnNo: header.GRNNo || header.DocNo,
    poId: header.PurchaseOrderID,
    poNo: header.PurchaseOrderNo,
    supplierId: header.SupplierID,
    supplierName: header.SupplierName,
    companyId: header.CompanyId,
    vendorState,
    companyState,
    taxMode: isIntraState ? "cgst_sgst" : "igst",
    gstPercent: maxGstPercent,
    cgstRate: effectiveCgstRate,
    sgstRate: effectiveSgstRate,
    igstRate: effectiveIgstRate,
    totals,
    lines,
  };
}

async function handleChainStatus(req, res) {
  const { sourceType, sourceId } = req.query;
  const srcId = parseInt(sourceId, 10);

  if (!sourceType || !srcId || !Number.isFinite(srcId)) {
    return res
      .status(400)
      .json({ error: "sourceType and sourceId are required" });
  }

  try {
    const pool = getPool();

    const expResult = await pool
      .request()
      .input("ESourceType", sql.NVarChar(20), String(sourceType))
      .input("ESourceId", sql.Int, srcId).query(`
        SELECT
          eb.Eid,
          eb.EDocNo,
          eb.EStatus,
          eb.ENetAmount,
          eb.EAmount
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = @ESourceType AND eb.ESourceId = @ESourceId
        ORDER BY eb.Eid DESC
      `);

    const expenses = expResult.recordset;
    const expenseCount = expenses.length;
    const latestExpense = expenses[0] ?? null;

    if (expenseCount === 0) {
      return res.json({
        expenseCount: 0,
        latestExpenseDocNo: null,
        latestExpenseStatus: null,
        latestExpenseAmount: null,
        paymentCount: 0,
        latestPaymentAmount: null,
        isPaid: false,
      });
    }

    const expenseDocNos = expenses
      .map((e) => e.EDocNo)
      .filter(Boolean)
      .map((d) => `'${d.replace(/'/g, "''")}'`)
      .join(",");

    let paymentCount = 0;
    let latestPaymentAmount = null;
    let isPaid = false;

    if (expenseDocNos.length > 0) {
      const payResult = await pool.request().query(`
          SELECT COUNT(*) AS payCount,
                 SUM(PAmount) AS totalPaid
          FROM dbo.NewPayment
          WHERE PExpenseRef IN (${expenseDocNos})
        `);
      paymentCount = parseInt(payResult.recordset[0]?.payCount) || 0;
      latestPaymentAmount = payResult.recordset[0]?.totalPaid
        ? parseFloat(payResult.recordset[0].totalPaid)
        : null;
      isPaid = paymentCount > 0;
    }

    res.json({
      expenseCount,
      latestExpenseDocNo: latestExpense?.EDocNo ?? null,
      latestExpenseStatus: latestExpense?.EStatus ?? null,
      latestExpenseAmount:
        latestExpense?.ENetAmount ?? latestExpense?.EAmount ?? null,
      paymentCount,
      latestPaymentAmount,
      isPaid,
    });
  } catch (err) {
    console.error("Chain status error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /options ─────────────────────────────────────────────────────────────
router.get(
  "/options",
  cache("expense-booking-options", 120),
  async (req, res) => {
    try {
      const pool = getPool();
      const finYear = (req.query.finYear || "").toString().trim() || null;

      // Regular bookings: exclude EMI-enabled ones (they are paid via installments)
      // and exclude any already linked to an active DebitNote
      const bookingsResult = await pool
        .request()
        .input("FinYear", sql.NVarChar(20), finYear).query(`
        SELECT
          eb.Eid                          AS id,
          eb.Eid                          AS value,
          ISNULL(eb.EDocNo, CONCAT('Draft #', CAST(eb.Eid AS NVARCHAR))) AS docNo,
          COALESCE(proj.name, eb.EProjectName, '') AS projectName,
          ISNULL(eb.EName, '')            AS partyName,
          -- Supplier name: GRN -> account head name, PO/WO_PO/WORK_DONE -> EName (party), fallback -> EName
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ESourceId IS NOT NULL THEN ISNULL(ahm.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType IN ('PO','WO_PO','WORK_DONE') THEN ISNULL(eb.EName, '')
            ELSE ISNULL(eb.EName, '')
          END                             AS supplierName,
          -- For GRN-linked bookings use the live GRN total (incl. GST);
          -- it is always up-to-date whereas ENetAmount may be stale.
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn.TotalAmount IS NOT NULL AND grn.TotalAmount > 0
            THEN grn.TotalAmount
            ELSE ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))
          END                             AS amount,
          ISNULL(eb.ECompanyId, 0)        AS companyId,
          ISNULL(e.name, '')              AS companyName,
          ISNULL(eb.EFinYear, '')         AS financialYear,
          eb.EEmiPayment                  AS emiEnabled,
          CONCAT(
            ISNULL(eb.EDocNo, CONCAT('Draft #', CAST(eb.Eid AS NVARCHAR))),
            N' — ',
            COALESCE(proj.name, eb.EProjectName, ''),
            N' (₹',
            CAST(CAST(
              CASE
                WHEN eb.ESourceType = 'GRN' AND grn.TotalAmount IS NOT NULL AND grn.TotalAmount > 0
                THEN grn.TotalAmount
                ELSE ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))
              END
            AS BIGINT) AS NVARCHAR(20)),
            ')'
          ) AS label
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.enterprise e ON e.id = eb.ECompanyId
        LEFT JOIN dbo.enterprise proj ON proj.id = TRY_CAST(eb.EProjectName AS INT)
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
        WHERE
          (eb.EEmiPayment = 0 OR eb.EEmiPayment IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = eb.Eid AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
        ORDER BY eb.Eid DESC
      `);

      // EMI installments: only show Pending ones
      const emiResult = await pool
        .request()
        .input("FinYear", sql.NVarChar(20), finYear).query(`
        SELECT
          ei.Id                        AS id,
          ei.ExpenseBookingId          AS expenseBookingId,
          ei.InstallmentNo             AS installmentNo,
          ei.RefNumber                 AS refNumber,
          ei.DueDate                   AS dueDate,
          ei.Amount                    AS amount,
          ei.Status                    AS status,
          COALESCE(proj2.name, eb.EProjectName, '') AS projectName,
          ISNULL(eb.EName, '')         AS partyName,
          -- Supplier name: GRN -> account head name, PO/WO_PO/WORK_DONE -> EName, fallback -> EName
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ESourceId IS NOT NULL THEN ISNULL(ahm2.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType IN ('PO','WO_PO','WORK_DONE') THEN ISNULL(eb.EName, '')
            ELSE ISNULL(eb.EName, '')
          END                          AS supplierName,
          eb.ECompanyId                AS companyId,
          ISNULL(e2.name, '')          AS companyName,
          ISNULL(eb.EFinYear, '')      AS financialYear,
          eb.EDocNo                    AS parentDocNo,
          CONCAT(
            ISNULL(ei.RefNumber, CONCAT('EMI-', RIGHT('00' + CAST(ei.InstallmentNo AS VARCHAR), 2))),
            N' — ',
            COALESCE(proj2.name, eb.EProjectName, ''),
            N' (₹',
            CAST(CAST(ISNULL(ei.Amount,0) AS BIGINT) AS NVARCHAR(20)),
            N') — Installment #',
            CAST(ei.InstallmentNo AS NVARCHAR(10))
          ) AS label
        FROM dbo.EmiInstallments ei
        INNER JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
        LEFT JOIN dbo.enterprise e2 ON e2.id = eb.ECompanyId
        LEFT JOIN dbo.enterprise proj2 ON proj2.id = TRY_CAST(eb.EProjectName AS INT)
        LEFT JOIN dbo.GoodsReceiptNotes grn2
          ON eb.ESourceType = 'GRN' AND grn2.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ahm2 ON ahm2.LHeadId = grn2.SupplierID
        WHERE
          eb.EEmiPayment = 1
          AND ei.Status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = ei.Id AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
        ORDER BY ei.ExpenseBookingId DESC, ei.InstallmentNo ASC
      `);

      const bookingOptions = bookingsResult.recordset.map((r) => ({
        id: String(r.id),
        value: String(r.value),
        label: r.label,
        type: "booking",
        expenseBookingId: r.id,
        docNo: r.docNo,
        projectName: r.projectName,
        partyName: r.partyName || "",
        supplierName: r.supplierName || "",
        amount: parseFloat(r.amount) || 0,
        companyId: r.companyId || null,
        companyName: r.companyName || "",
        financialYear: r.financialYear || "",
      }));

      const emiOptions = emiResult.recordset.map((r) => ({
        id: `emi-${r.expenseBookingId}-${r.installmentNo}`,
        value: `emi-${r.expenseBookingId}-${r.installmentNo}`,
        label: r.label,
        type: "emi",
        expenseBookingId: r.expenseBookingId,
        installmentNo: r.installmentNo,
        refNumber: r.refNumber,
        dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
        docNo: r.refNumber || r.parentDocNo,
        projectName: r.projectName,
        partyName: r.partyName || "",
        supplierName: r.supplierName || "",
        amount: parseFloat(r.amount) || 0,
        companyId: r.companyId || null,
        companyName: r.companyName || "",
        financialYear: r.financialYear || "",
        status: r.status,
        parentDocNo: r.parentDocNo,
      }));

      res.json([...bookingOptions, ...emiOptions]);
    } catch (err) {
      console.error("Options error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── GET all (paginated) ──────────────────────────────────────────────────────
router.get("/", cache("expense-booking", 60), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    // Run status counts and paginated list in parallel
    const [countResult, result] = await Promise.all([
      pool.request().query(`
        SELECT
          eb.EStatus,
          COUNT(*) AS cnt,
          SUM(
            CASE
              WHEN eb.ESourceType = 'GRN' AND grn_cnt.TotalAmount IS NOT NULL AND grn_cnt.TotalAmount > 0
              THEN grn_cnt.TotalAmount
              ELSE ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))
            END
          ) AS totalAmount
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn_cnt
          ON eb.ESourceType = 'GRN' AND grn_cnt.GRNID = TRY_CAST(eb.ESourceId AS INT)
        WHERE ISNULL(eb.EStatus, '') != 'Draft'
          AND ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'
        GROUP BY eb.EStatus
      `),
      pool
        .request()
        .input("offset", sql.Int, offset)
        .input("limit", sql.Int, limit).query(`
        SELECT
          eb.Eid, eb.Eid AS id,
          eb.EProjectName, eb.EDocumentType, eb.EDocDate,
          eb.EAmount, eb.ENetAmount, eb.ECgstRate, eb.ESgstRate,
          eb.EDocNo, eb.EEmiPayment, eb.EInstallmentCount, eb.EEmiAmount,
          eb.EEmiStartDate, eb.EReminder, eb.ERemarks, eb.EStatus,
          eb.ECreatedAt, eb.EUpdatedAt, eb.ECompanyId, eb.EDocTypeId,
          eb.EFinYear, eb.ECreatedBy, eb.ESourceType, eb.ESourceId,
          eb.EName, eb.EBillingTermsData, eb.EDiscountData, eb.EEmiData,
          eb.EBillingTermId, eb.EBillingTermName,
          eb.ETCId, eb.ETCName, eb.ETCText,
          eb.EVendorInvoiceNo, eb.EVendorInvoiceDate,
          eb.EAdditionalCharges, eb.ECostCenter, eb.EGLAccount, eb.EWorkDoneRef,
          eb.EBillStatus, eb.ETotalPaid, eb.ERemainingAmount,
          CASE
            WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL THEN t.Prefix + N' — ' + t.Description
            WHEN t.Prefix IS NOT NULL THEN t.Prefix
            ELSE NULL
          END AS DocTypeName,
          ec.name  AS ECompanyName,
          -- Project: resolve from EProjectName if set, otherwise fall back to GRN -> PO -> Project
          ISNULL(ep.name, epo_proj.name) AS EProjectDisplayName,
          -- Source doc: use actual GRN document number when source is GRN
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn_list.GRNNo IS NOT NULL THEN grn_list.GRNNo
            ELSE NULL
          END AS sourceDocNo,
          -- Supplier name: from GRN supplier for GRN-linked, else from EName
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn_list.GRNID IS NOT NULL THEN grn_supp_list.LHeadName
            ELSE eb.EName
          END AS ESupplierName,
          -- Live GRN total (incl GST) for GRN-linked bookings; NULL otherwise.
          -- Frontend uses this as the authoritative Net Amt for GRN rows.
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn_list.TotalAmount IS NOT NULL AND grn_list.TotalAmount > 0
            THEN grn_list.TotalAmount
            ELSE NULL
          END AS EGrnTotalAmount,
          COUNT(*) OVER() AS _total
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.TypeOfDoc  t  ON t.TypeOfDocId = eb.EDocTypeId
        LEFT JOIN dbo.enterprise ec ON ec.id          = eb.ECompanyId
        CROSS APPLY (SELECT TRY_CAST(eb.EProjectName AS INT) AS _projId) _p
        LEFT JOIN dbo.enterprise ep ON ep.id = _p._projId
        -- GRN join for sourceDocNo and project fallback
        LEFT JOIN dbo.GoodsReceiptNotes grn_list
          ON eb.ESourceType = 'GRN' AND grn_list.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster grn_supp_list ON grn_supp_list.LHeadId = grn_list.SupplierID
        LEFT JOIN dbo.PurchaseOrders po_list ON grn_list.POID = po_list.PurchaseOrderID
        LEFT JOIN dbo.enterprise epo_proj ON epo_proj.id = po_list.ProjectId
        WHERE ISNULL(eb.EStatus, '') != 'Draft'
          AND ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'
        ORDER BY eb.Eid DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `),
    ]);

    const rows = result.recordset;
    const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;

    // Build status counts map from the summary query
    const statusCounts = {};
    let totalBookedAmount = 0;
    for (const row of countResult.recordset) {
      statusCounts[row.EStatus] = parseInt(row.cnt) || 0;
      totalBookedAmount += parseFloat(row.totalAmount) || 0;
    }

    res.json({
      data: rows.map(({ _total, ...r }) => r),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      statusCounts,
      totalBookedAmount: Math.round(totalBookedAmount * 100) / 100,
    });
  } catch (err) {
    console.error("List error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /source-ids — all booked (ESourceType, ESourceId) pairs ──────────────
// Used by the frontend to filter already-booked documents from pickers (PO, GRN,
// Work Done, etc.) regardless of pagination. Lightweight — returns only the two
// columns needed to build the exclusion sets.
router.get(
  "/source-ids",
  cache("expense-booking-source-ids", 60),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT ESourceType, ESourceId, Eid
        FROM dbo.ExpenseBooking
        WHERE EStatus != 'Deleted'
          AND EStatus != 'Draft'
          AND ESourceType IS NOT NULL
          AND ESourceId   IS NOT NULL

      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("source-ids error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── GET /:id ─────────────────────────────────────────────────────────────────
// GET /grn-gst-data?grnId=123
// Authoritative GRN billing calculation: received quantity x PO rate, with GST
// resolved from item HSN master and split by vendor/company state.
router.get("/grn-gst-data", async (req, res) => {
  const grnId = parseInt(req.query.grnId, 10);
  if (!Number.isFinite(grnId) || grnId <= 0) {
    return res.status(400).json({ error: "Valid grnId is required" });
  }

  try {
    const pool = getPool();
    const data = await buildGrnGstData(pool, grnId);
    if (!data) return res.status(404).json({ error: "GRN not found" });
    res.json(data);
  } catch (err) {
    console.error("GRN GST data error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/chain-status", handleChainStatus);

// ─── GET /by-source — all expense bookings for a given source (incl. split drafts) ──
router.get("/by-source", async (req, res) => {
  const { sourceType, sourceId } = req.query;
  if (!sourceType || !sourceId)
    return res
      .status(400)
      .json({ error: "sourceType and sourceId are required" });
  const sid = parseInt(sourceId, 10);
  if (!Number.isFinite(sid) || sid <= 0)
    return res.status(400).json({ error: "Invalid sourceId" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ESourceType", sql.NVarChar(50), String(sourceType))
      .input("ESourceId", sql.Int, sid).query(`
        SELECT
          eb.Eid,
          ISNULL(eb.EDocNo, CONCAT('Draft #', CAST(eb.Eid AS NVARCHAR))) AS EDocNo,
          eb.EStatus,
          ISNULL(eb.ENetAmount, eb.EAmount) AS ENetAmount,
          eb.ERemarks,
          eb.EDocDate,
          eb.EName
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = @ESourceType
          AND eb.ESourceId = @ESourceId
          AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
          AND ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'
        ORDER BY eb.Eid ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("by-source error:", err.message);
    res.status(500).json({ error: "Failed to fetch linked bookings" });
  }
});

router.get("/:id/can-delete", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    // ── 1. Debit Note guard ───────────────────────────────────────────────────
    const dnCheck = await pool.request().input("Eid", sql.Int, id).query(`
      SELECT COUNT(*) AS cnt FROM dbo.DebitNote WHERE bill_id = @Eid
    `);
    const linkedDebitNoteCount = Number(dnCheck.recordset[0]?.cnt) || 0;
    if (linkedDebitNoteCount > 0) {
      return res.json({
        deletable: false,
        reason:
          "This booking has linked Debit Notes. Please delete or unlink them first.",
        linkedDebitNoteCount,
      });
    }

    // ── 2. BRS cleared payment guard ─────────────────────────────────────────
    // Chain: ExpenseBooking.EDocNo → NewPayment.PExpenseRef → BankReconciliation.SourceID (IsMatched=1)
    const brsCheck = await pool.request().input("Eid", sql.Int, id).query(`
      SELECT
        np.PPaymentID,
        np.PPaymentName,
        np.PAmount,
        brc.BRSID,
        brc.IsMatched
      FROM dbo.ExpenseBooking eb
      JOIN dbo.NewPayment np
        ON np.PExpenseRef = eb.EDocNo
      JOIN dbo.BankReconciliation brc
        ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID AND brc.IsMatched = 1
      WHERE eb.Eid = @Eid
    `);

    if (brsCheck.recordset.length > 0) {
      const clearedPayments = brsCheck.recordset.map((r) => ({
        paymentId: r.PPaymentID,
        paymentName: r.PPaymentName,
        amount: r.PAmount,
        brsId: r.BRSID,
      }));
      return res.json({
        deletable: false,
        reason: "brs_cleared",
        clearedPayments,
      });
    }

    // ── 3. Uncollected payments (not yet in BRS but exist) ───────────────────
    const payCheck = await pool.request().input("Eid", sql.Int, id).query(`
      SELECT np.PPaymentID, np.PPaymentName, np.PAmount
      FROM dbo.ExpenseBooking eb
      JOIN dbo.NewPayment np ON np.PExpenseRef = eb.EDocNo
      WHERE eb.Eid = @Eid
    `);

    if (payCheck.recordset.length > 0) {
      const linkedPayments = payCheck.recordset.map((r) => ({
        paymentId: r.PPaymentID,
        paymentName: r.PPaymentName,
        amount: r.PAmount,
      }));
      return res.json({
        deletable: false,
        reason: "has_payments",
        linkedPayments,
      });
    }

    res.json({ deletable: true });
  } catch (err) {
    console.error("Can-delete check error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Eid", sql.Int, id).query(`
        SELECT eb.*,
               eb.Eid AS id,
               CASE
                 WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL THEN t.Prefix + ' — ' + t.Description
                 WHEN t.Prefix IS NOT NULL THEN t.Prefix
            ELSE NULL
          END AS DocTypeName,
          ec.name AS ECompanyName,
               COALESCE(ep.name, epo_proj2.name, epo_direct.name) AS EProjectDisplayName,
               CASE
                 WHEN eb.ESourceType = 'GRN' AND grn_det.GRNNo IS NOT NULL THEN grn_det.GRNNo
                 ELSE NULL
               END AS sourceDocNo,
               CASE
                 WHEN eb.ESourceType = 'GRN' AND grn_det.GRNID IS NOT NULL THEN grn_supp_det.LHeadName
                 ELSE eb.EName
               END AS ESupplierName,
               -- Live GRN total (incl. GST) so detail modal always shows current value
               CASE
                 WHEN eb.ESourceType = 'GRN' AND grn_det.TotalAmount IS NOT NULL AND grn_det.TotalAmount > 0
                 THEN grn_det.TotalAmount
                 ELSE NULL
               END AS EGrnTotalAmount,
               -- Pass through source info needed for fallback computation
               eb.ESourceType AS _ESourceType,
               eb.ESourceId   AS _ESourceId
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.TypeOfDoc  t  ON t.TypeOfDocId = eb.EDocTypeId
        LEFT JOIN dbo.enterprise ec ON ec.id = eb.ECompanyId
        CROSS APPLY (SELECT TRY_CAST(eb.EProjectName AS INT) AS _projId) _p
        LEFT JOIN dbo.enterprise ep ON ep.id = _p._projId
        LEFT JOIN dbo.GoodsReceiptNotes grn_det
          ON eb.ESourceType = 'GRN' AND grn_det.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.PurchaseOrders po_det ON grn_det.POID = po_det.PurchaseOrderID
        LEFT JOIN dbo.enterprise epo_proj2 ON epo_proj2.id = po_det.ProjectId
        LEFT JOIN dbo.PurchaseOrders po_direct
          ON eb.ESourceType = 'PO' AND po_direct.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.enterprise epo_direct ON epo_direct.id = po_direct.ProjectId
        LEFT JOIN dbo.AccountHeadMaster grn_supp_det ON grn_supp_det.LHeadId = grn_det.SupplierID
        WHERE eb.Eid = @Eid
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const row = result.recordset[0];

    // If EGrnTotalAmount is NULL (GRN.TotalAmount not populated for older records),
    // compute it from buildGrnGstData so the frontend always has an authoritative total.
    if (
      !row.EGrnTotalAmount &&
      row._ESourceType === "GRN" &&
      row._ESourceId
    ) {
      try {
        const grnId = parseInt(row._ESourceId, 10);
        if (Number.isFinite(grnId) && grnId > 0) {
          const grnData = await buildGrnGstData(pool, grnId);
          if (grnData && grnData.totals.netAmount > 0) {
            row.EGrnTotalAmount = grnData.totals.netAmount;
          }
        }
      } catch {
        /* non-fatal: frontend will fall back to standard breakdown */
      }
    }

    // Strip internal fields before sending
    delete row._ESourceType;
    delete row._ESourceId;

    res.json(row);
  } catch (err) {
    console.error("Get by id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/approval-trail ──────────────────────────────────────────────────
router.get("/:id/approval-trail", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const wfResult = await pool
      .request()
      .input("Module", sql.NVarChar(100), "expense-booking").query(`
        SELECT TOP 1 Id, Levels, Approvers
        FROM dbo.ApprovalWorkflows
        WHERE Module = @Module AND Status = 'Active'
        ORDER BY CreatedAt DESC
      `);

    const wf = wfResult.recordset[0];

    const logResult = await pool
      .request()
      .input("RecordId", sql.Int, id)
      .input("TableName", sql.NVarChar(100), "ExpenseBooking").query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, ActionAt, Note
        FROM dbo.ApprovalAuditLog
        WHERE RecordId = @RecordId AND TableName = @TableName
        ORDER BY Level ASC, ActionAt ASC
      `);

    const logs = logResult.recordset;

    const recResult = await pool
      .request()
      .input("Eid", sql.Int, id)
      .query("SELECT EStatus FROM dbo.ExpenseBooking WHERE Eid = @Eid");

    const currentStatus = recResult.recordset[0]?.EStatus ?? "Draft";

    if (!wf) {
      return res.json({
        steps: [],
        currentLevel: 0,
        fullyApproved: currentStatus === "Approved",
      });
    }

    const levels = wf.Levels || 1;
    const approverList = (wf.Approvers || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const steps = Array.from({ length: levels }, (_, i) => {
      const lvl = i + 1;
      const log = logs.find((l) => l.Level === lvl);
      return {
        level: lvl,
        role: log?.Role ?? approverList[i] ?? "Approver",
        approverEmail: log?.ApproverEmail ?? approverList[i] ?? null,
        status: log?.ActionStatus ?? "Pending",
        actionAt: log?.ActionAt ?? null,
        note: log?.Note ?? null,
      };
    });

    const approvedCount = steps.filter((s) => s.status === "Approved").length;
    const currentLevel =
      approvedCount + 1 > levels ? levels : approvedCount + 1;

    res.json({
      steps,
      currentLevel,
      fullyApproved: currentStatus === "Approved",
    });
  } catch (err) {
    console.error("Approval trail error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST Create ──────────────────────────────────────────────────────────────
router.post("/", validateBody(expenseBookingBodySchema), async (req, res) => {
  const {
    EName,
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount,
    ENetAmount,
    ECgstRate,
    ESgstRate,
    EDiscountData,
    EDocNo,
    EEmiPayment,
    EEmiData,
    EInstallmentCount,
    EEmiAmount,
    EEmiStartDate,
    EReminder,
    ERemarks,
    EStatus = "Draft",
    ECompanyId,
    EDocTypeId,
    EFinYear,
    ESourceType,
    ESourceId,
    EBillingTermId,
    EBillingTermName,
    EBillingTermsData,
    ETCId,
    ETCName,
    ETCText,
    EVendorInvoiceNo,
    EVendorInvoiceDate,
    EAdditionalCharges,
    ECostCenter,
    EGLAccount,
    EWorkDoneRef,
  } = req.body;

  const pool = getPool();
  const transaction = pool.transaction();

  let finalDocNo = EDocNo || null;
  let bookingAmount = EAmount;
  let bookingNetAmount = ENetAmount;
  let bookingCgstRate = ECgstRate;
  let bookingSgstRate = ESgstRate;

  try {
    await transaction.begin();

    if (ESourceType === "GRN") {
      const grnId = parseInt(ESourceId, 10);
      if (!Number.isFinite(grnId) || grnId <= 0) {
        await transaction.rollback();
        return res.status(400).json({ error: "GRN source is required." });
      }

      const grnGst = await buildGrnGstData(pool, grnId);
      if (!grnGst) {
        await transaction.rollback();
        return res.status(404).json({ error: "Linked GRN not found." });
      }
      if (!grnGst.totals.receivedQty || grnGst.totals.receivedQty <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: "Cannot book expense for a GRN with no received quantity.",
        });
      }

      bookingAmount = grnGst.totals.taxableAmount;
      bookingNetAmount = grnGst.totals.netAmount;
      bookingCgstRate = grnGst.cgstRate;
      bookingSgstRate = grnGst.sgstRate;
      // Apply billing terms on top of the GRN gross amount
      bookingNetAmount = applyBillingTermsToAmount(
        bookingNetAmount,
        bookingAmount,
        bookingCgstRate,
        bookingSgstRate,
        EBillingTermsData,
        EDiscountData,
      );
    }

    if (EDocTypeId) {
      const typeId = parseInt(EDocTypeId, 10);
      const finYear = (EFinYear || "").toString().trim();

      const typeResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId).query(`
          SELECT Prefix, FullPrefix, StartingDocNo
          FROM dbo.TypeOfDoc
          WHERE TypeOfDocId = @TypeOfDocId AND IsActive = 1
        `);

      const typeRow = typeResult.recordset[0];
      if (!typeRow) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ error: "Selected document type not found or inactive." });
      }

      const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
      const prefix = rawPrefix.replace(/\d+$/, "");
      const startFrom = typeRow.StartingDocNo ?? 1;

      // Count globally across ALL fin years — fin year is only a suffix
      const maxResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("Prefix", sql.NVarChar(100), prefix + "%").query(`
          SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
          FROM dbo.DocNumberSequence WITH (UPDLOCK, HOLDLOCK)
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
        `);

      // Also check ExpenseBooking across ALL fin years
      const ebMaxResult = await transaction
        .request()
        .input("EDocTypeId2", sql.Int, typeId)
        .input("Prefix2", sql.NVarChar(100), prefix + "%").query(`
          SELECT MAX(TRY_CAST(SUBSTRING(EDocNo, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
          FROM dbo.ExpenseBooking WITH (UPDLOCK, HOLDLOCK)
          WHERE EDocTypeId = @EDocTypeId2
            AND EDocNo LIKE @Prefix2
        `);

      const seqFromDNS = maxResult.recordset[0]?.MaxSeq ?? null;
      const seqFromEB = ebMaxResult.recordset[0]?.MaxSeq ?? null;
      const combinedMax = Math.max(seqFromDNS ?? 0, seqFromEB ?? 0);
      const maxSeq = combinedMax > 0 ? combinedMax : startFrom - 1;
      const nextSeq = Math.max(maxSeq + 1, startFrom);
      const padded = String(nextSeq).padStart(6, "0");

      finalDocNo = finYear
        ? `${prefix}${padded}/${finYear}`
        : `${prefix}${padded}`;

      // ── Doc number reservation ──────────────────────────────────────────────
      // Loop until we find a sequence slot we can safely claim.
      // Handles three cases:
      //   (a) Row doesn't exist          → INSERT fresh, done.
      //   (b) Row exists, RecordId NULL  → reserved by a previous failed attempt;
      //                                    claim it by updating IssuedBy, done.
      //   (c) Row exists, RecordId set   → already committed; bump seq and retry.
      // Using MERGE (upsert) inside the loop makes the operation idempotent and
      // avoids the UNIQUE KEY violation that happened when a prior rollback left
      // a ghost row with RecordId IS NULL.

      let seqCandidate = nextSeq;
      let reserved = false;
      const MAX_RETRIES = 20;

      for (let attempt = 0; attempt < MAX_RETRIES && !reserved; attempt++) {
        const candidatePadded = String(seqCandidate).padStart(6, "0");
        finalDocNo = finYear
          ? `${prefix}${candidatePadded}/${finYear}`
          : `${prefix}${candidatePadded}`;

        const existingSeq = await transaction
          .request()
          .input("DocNoCheck", sql.NVarChar(100), finalDocNo)
          .query(
            `SELECT RecordId FROM dbo.DocNumberSequence WHERE DocNo = @DocNoCheck`,
          );

        if (existingSeq.recordset.length === 0) {
          // (a) Free slot — insert fresh
          await transaction
            .request()
            .input("TypeOfDocId", sql.Int, typeId)
            .input("DocNo", sql.NVarChar(100), finalDocNo)
            .input("TableName", sql.NVarChar(100), "ExpenseBooking")
            .input("IssuedBy", sql.NVarChar(200), req.user?.email || null)
            .query(`
              INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
              VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
            `);
          reserved = true;
        } else if (!existingSeq.recordset[0]?.RecordId) {
          // (b) Ghost row from a previous rollback — claim it (no INSERT needed)
          await transaction
            .request()
            .input("DocNoCheck", sql.NVarChar(100), finalDocNo)
            .input("IssuedBy", sql.NVarChar(200), req.user?.email || null)
            .query(`
              UPDATE dbo.DocNumberSequence
              SET IssuedBy = @IssuedBy
              WHERE DocNo = @DocNoCheck AND RecordId IS NULL
            `);
          reserved = true;
        } else {
          // (c) Already committed to another record — try next number
          seqCandidate++;
        }
      }

      if (!reserved) {
        await transaction.rollback();
        return res.status(500).json({
          error: "Could not reserve a document number after multiple attempts.",
        });
      }
    }

    // Prepend ExB/ prefix to every expense booking doc number
    if (finalDocNo && !finalDocNo.startsWith("ExB/")) {
      finalDocNo = `ExB/${finalDocNo}`;
    }

    const insertResult = await transaction
      .request()
      .input("EName", sql.NVarChar(200), EName || null)
      .input("EProjectName", sql.NVarChar(150), EProjectName || null)
      .input("EDocumentType", sql.NVarChar(50), EDocumentType || null)
      .input("EDocDate", sql.Date, EDocDate || null)
      .input(
        "EAmount",
        sql.Decimal(18, 2),
        bookingAmount != null && bookingAmount !== ""
          ? Number(bookingAmount)
          : 0,
      )
      .input(
        "ENetAmount",
        sql.Decimal(18, 2),
        bookingNetAmount != null && bookingNetAmount !== ""
          ? Math.round(Number(bookingNetAmount) * 100) / 100
          : 0,
      )
      .input("ECgstRate", sql.Decimal(5, 2), bookingCgstRate ?? 0)
      .input("ESgstRate", sql.Decimal(5, 2), bookingSgstRate ?? 0)
      .input(
        "EDiscountData",
        sql.NVarChar(sql.MAX),
        EDiscountData
          ? typeof EDiscountData === "string"
            ? EDiscountData
            : JSON.stringify(EDiscountData)
          : null,
      )
      .input("EDocNo", sql.NVarChar(100), finalDocNo)
      .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
      .input(
        "EEmiData",
        sql.NVarChar(sql.MAX),
        EEmiData ? JSON.stringify(EEmiData) : null,
      )
      .input("EInstallmentCount", sql.Int, EInstallmentCount || null)
      .input("EEmiAmount", sql.Decimal(18, 2), EEmiAmount || null)
      .input("EEmiStartDate", sql.Date, EEmiStartDate || null)
      .input("EReminder", sql.Date, EReminder || null)
      .input("ERemarks", sql.NVarChar(300), ERemarks || null)
      .input("EStatus", sql.NVarChar(50), EStatus)
      .input("ECreatedAt", sql.DateTime2, new Date())
      .input("EUpdatedAt", sql.DateTime2, new Date())
      .input("ECreatedBy", sql.Int, req.user?.userId || null)
      .input("EApprovedBy", sql.Int, null)
      .input(
        "ECompanyId",
        sql.Int,
        ECompanyId ? parseInt(ECompanyId, 10) : null,
      )
      .input(
        "EDocTypeId",
        sql.Int,
        EDocTypeId ? parseInt(EDocTypeId, 10) : null,
      )
      .input("EFinYear", sql.NVarChar(20), EFinYear || null)
      .input("ESourceType", sql.NVarChar(20), ESourceType || null)
      .input("ESourceId", sql.Int, ESourceId ? parseInt(ESourceId, 10) : null)
      .input(
        "EBillingTermId",
        sql.Int,
        EBillingTermId ? parseInt(EBillingTermId, 10) : null,
      )
      .input("EBillingTermName", sql.NVarChar(200), EBillingTermName || null)
      .input(
        "EBillingTermsData",
        sql.NVarChar(sql.MAX),
        EBillingTermsData
          ? typeof EBillingTermsData === "string"
            ? EBillingTermsData
            : JSON.stringify(EBillingTermsData)
          : null,
      )
      .input("ETCId", sql.Int, ETCId ? parseInt(ETCId, 10) : null)
      .input("ETCName", sql.NVarChar(200), ETCName || null)
      .input("ETCText", sql.NVarChar(sql.MAX), ETCText || null)
      .input("EVendorInvoiceNo", sql.NVarChar(100), EVendorInvoiceNo || null)
      .input("EVendorInvoiceDate", sql.Date, EVendorInvoiceDate || null)
      .input(
        "EAdditionalCharges",
        sql.NVarChar(sql.MAX),
        EAdditionalCharges ? JSON.stringify(EAdditionalCharges) : null,
      )
      .input("ECostCenter", sql.NVarChar(200), ECostCenter || null)
      .input("EGLAccount", sql.NVarChar(200), EGLAccount || null)
      .input("EWorkDoneRef", sql.NVarChar(100), EWorkDoneRef || null).query(`
        INSERT INTO dbo.ExpenseBooking (
          EName, EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EDiscountData, EDocNo,
          EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy,
          ECompanyId, EDocTypeId, EFinYear,
          ESourceType, ESourceId,
          EBillingTermId, EBillingTermName, EBillingTermsData,
          ETCId, ETCName, ETCText,
          EVendorInvoiceNo, EVendorInvoiceDate, EAdditionalCharges,
          ECostCenter, EGLAccount, EWorkDoneRef
        ) VALUES (
          @EName, @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EDiscountData, @EDocNo,
          @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy,
          @ECompanyId, @EDocTypeId, @EFinYear,
          @ESourceType, @ESourceId,
          @EBillingTermId, @EBillingTermName, @EBillingTermsData,
          @ETCId, @ETCName, @ETCText,
          @EVendorInvoiceNo, @EVendorInvoiceDate, @EAdditionalCharges,
          @ECostCenter, @EGLAccount, @EWorkDoneRef
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    const newExpenseId = insertResult.recordset[0]?.NewId;

    if (finalDocNo && newExpenseId) {
      await transaction
        .request()
        .input("DocNo", sql.NVarChar(100), finalDocNo)
        .input("RecordId", sql.Int, parseInt(newExpenseId, 10)).query(`
          UPDATE dbo.DocNumberSequence
          SET RecordId = @RecordId
          WHERE DocNo = @DocNo AND TableName = 'ExpenseBooking'
        `);
    }

    await transaction.commit();

    if (EEmiPayment && EEmiData && newExpenseId) {
      let schedule = [];
      try {
        const parsed =
          typeof EEmiData === "string" ? JSON.parse(EEmiData) : EEmiData;
        schedule = parsed?.schedule ?? [];
      } catch (e) {
        console.warn("Failed to parse EMI data");
      }

      for (const row of schedule) {
        try {
          if (!row.dueDate) {
            console.warn(
              `EMI row ${row.installmentNo} skipped — missing dueDate`,
            );
            continue;
          }
          await pool
            .request()
            .input("ExpenseBookingId", sql.Int, newExpenseId)
            .input("InstallmentNo", sql.Int, row.installmentNo)
            .input("RefNumber", sql.NVarChar(200), row.refNumber || null)
            .input("DueDate", sql.Date, row.dueDate)
            .input("Amount", sql.Decimal(18, 2), row.amount || 0)
            .input("Status", sql.NVarChar(20), row.status || "Pending").query(`
              INSERT INTO dbo.EmiInstallments
              (ExpenseBookingId, InstallmentNo, RefNumber, DueDate, Amount, Status)
              VALUES (@ExpenseBookingId, @InstallmentNo, @RefNumber, @DueDate, @Amount, @Status)
            `);
        } catch (rowErr) {
          console.warn("EMI insert warning:", rowErr.message);
        }
      }
    }

    await bumpCacheVersion("expense-booking");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("expense-booking-source-ids");

    // Auto-submit: transition Draft → Pending immediately after creation.
    try {
      await transition(
        "expense-booking",
        parseInt(newExpenseId, 10),
        "Pending",
        req.user?.email,
        req.user?.role,
      );
    } catch (submitErr) {
      console.warn(
        "Expense Booking auto-submit failed (non-fatal):",
        submitErr.message,
      );
    }

    res.status(201).json({
      message: "Expense booked successfully",
      id: newExpenseId,
      docNo: finalDocNo,
      status: "Pending",
    });
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (rbErr) {
      console.error("Transaction rollback failed:", rbErr.message);
    }
    console.error("EXPENSE INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/emi-schedule ────────────────────────────────────────────────────
router.get("/:id/emi-schedule", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const result = await pool.request().input("ExpenseBookingId", sql.Int, id)
      .query(`
        SELECT * FROM dbo.EmiInstallments
        WHERE ExpenseBookingId = @ExpenseBookingId
        ORDER BY InstallmentNo ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT Pay EMI Installment ──────────────────────────────────────────────────
router.put(
  "/:id/emi-schedule/:no/pay",
  validateBody(emiPaySchema),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const no = parseInt(req.params.no, 10);
    const { paymentRef } = req.body;

    try {
      const userEmail = requireUserEmail(req, res);
      if (!userEmail) return;

      const pool = getPool();

      await pool
        .request()
        .input("ExpenseBookingId", sql.Int, id)
        .input("InstallmentNo", sql.Int, no)
        .input("PaymentRef", sql.NVarChar(200), paymentRef || null)
        .input("PaidAt", sql.DateTime2, new Date())
        .input("PaidBy", sql.NVarChar(200), userEmail).query(`
        UPDATE dbo.EmiInstallments
        SET Status = 'Paid', PaymentRef = @PaymentRef, PaidAt = @PaidAt, PaidBy = @PaidBy
        WHERE ExpenseBookingId = @ExpenseBookingId AND InstallmentNo = @InstallmentNo
      `);

      const schedRes = await pool
        .request()
        .input("ExpenseBookingId", sql.Int, id)
        .query(`SELECT InstallmentNo, DueDate, Amount, Status, RefNumber
              FROM dbo.EmiInstallments
              WHERE ExpenseBookingId = @ExpenseBookingId
              ORDER BY InstallmentNo`);

      const schedule = schedRes.recordset.map((r) => ({
        installmentNo: r.InstallmentNo,
        dueDate: r.DueDate?.toISOString?.().slice(0, 10) ?? r.DueDate,
        amount: parseFloat(r.Amount),
        status: r.Status,
        refNumber: r.RefNumber,
      }));

      const existing = await pool
        .request()
        .input("Eid", sql.Int, id)
        .query("SELECT EEmiData FROM dbo.ExpenseBooking WHERE Eid = @Eid");

      let emiData = {};
      try {
        emiData = JSON.parse(existing.recordset[0]?.EEmiData || "{}");
      } catch {}

      emiData.schedule = schedule;

      await pool
        .request()
        .input("Eid", sql.Int, id)
        .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(emiData))
        .query(
          "UPDATE dbo.ExpenseBooking SET EEmiData = @EEmiData WHERE Eid = @Eid",
        );

      await bumpCacheVersion("expense-booking");
      await bumpCacheVersion("expense-booking-options");
      await bumpCacheVersion("expense-booking-source-ids");
      res.json({ message: "Installment marked as paid" });
    } catch (err) {
      console.error("EMI pay error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── PUT Toggle EMI off ───────────────────────────────────────────────────────
router.put(
  "/:id/emi-toggle",
  validateBody(emiToggleSchema),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0)
      return res.status(400).json({ error: "Invalid id" });

    const { enabled, deleteUnpaid = true } = req.body;

    try {
      const userEmail = requireUserEmail(req, res);
      if (!userEmail) return;

      const pool = getPool();

      const stats = await pool.request().input("ExpenseBookingId", sql.Int, id)
        .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN Status = 'Paid' THEN 1 ELSE 0 END) AS paid,
          SUM(CASE WHEN Status = 'Paid' THEN Amount ELSE 0 END) AS paidAmount,
          SUM(CASE WHEN Status != 'Paid' THEN Amount ELSE 0 END) AS remainingAmount
        FROM dbo.EmiInstallments
        WHERE ExpenseBookingId = @ExpenseBookingId
      `);

      const { total, paid, paidAmount, remainingAmount } = stats.recordset[0];

      let lumpSumDocNo = null;
      let lumpSumId = null;

      if (!enabled) {
        if (deleteUnpaid) {
          await pool.request().input("ExpenseBookingId", sql.Int, id).query(`
            DELETE FROM dbo.EmiInstallments
            WHERE ExpenseBookingId = @ExpenseBookingId AND Status != 'Paid'
          `);
        }

        const existingRes = await pool.request().input("Eid", sql.Int, id)
          .query(`
          SELECT EEmiData, EDocNo, EName, EProjectName, EDocumentType, EDocDate,
                 ECgstRate, ESgstRate, ECompanyId, EDocTypeId, EFinYear,
                 ECreatedBy, ERemarks, EStatus
          FROM dbo.ExpenseBooking WHERE Eid = @Eid
        `);
        const parentRow = existingRes.recordset[0] || {};
        let emiData = {};
        try {
          emiData = JSON.parse(parentRow.EEmiData || "{}");
        } catch {}
        emiData.enabled = false;
        if (deleteUnpaid && Array.isArray(emiData.schedule)) {
          emiData.schedule = emiData.schedule.filter(
            (r) => r.status === "Paid",
          );
        }

        // If the booking was Approved, reset it to Draft so it re-enters
        // the approval workflow after the structural EMI change.
        const wasApproved = (parentRow.EStatus || "") === "Approved";

        await pool
          .request()
          .input("Eid", sql.Int, id)
          .input("EEmiPayment", sql.Bit, 0)
          .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(emiData))
          .input(
            "EStatus",
            sql.NVarChar(50),
            wasApproved ? "Draft" : parentRow.EStatus || "Draft",
          ).query(`
          UPDATE dbo.ExpenseBooking
          SET EEmiPayment = @EEmiPayment, EEmiData = @EEmiData, EStatus = @EStatus
          WHERE Eid = @Eid
        `);

        // If there is a remaining unpaid amount, create a new lump-sum booking
        // that represents the outstanding balance and link it back to the parent.
        const remainingAmt = parseFloat(remainingAmount) || 0;
        if (remainingAmt > 0) {
          const parentDocNo = parentRow.EDocNo || null;
          const lumpSumRemark = `Lump-sum balance from EMI booking${parentDocNo ? " " + parentDocNo : ""} (remaining after ${parseInt(paid) || 0} paid installment(s))`;

          const lumpInsert = await pool
            .request()
            .input(
              "EName",
              sql.NVarChar(200),
              parentRow.EName
                ? `${parentRow.EName} (Lump-sum balance)`
                : `Lump-sum balance from ${parentRow.EDocNo || `booking #${id}`}`,
            )
            .input(
              "EProjectName",
              sql.NVarChar(150),
              parentRow.EProjectName || null,
            )
            .input(
              "EDocumentType",
              sql.NVarChar(50),
              parentRow.EDocumentType || null,
            )
            .input("EDocDate", sql.Date, new Date())
            .input("EAmount", sql.Decimal(18, 2), remainingAmt)
            .input("ENetAmount", sql.Decimal(18, 2), remainingAmt)
            .input("ECgstRate", sql.Decimal(5, 2), 0)
            .input("ESgstRate", sql.Decimal(5, 2), 0)
            .input("EEmiPayment", sql.Bit, 0)
            .input("ERemarks", sql.NVarChar(300), lumpSumRemark)
            .input("EStatus", sql.NVarChar(50), "Draft")
            .input("ECompanyId", sql.Int, parentRow.ECompanyId || null)
            .input("EDocTypeId", sql.Int, parentRow.EDocTypeId || null)
            .input("EFinYear", sql.NVarChar(20), parentRow.EFinYear || null)
            .input("ECreatedBy", sql.Int, parentRow.ECreatedBy || null)
            .input("EParentEmiRef", sql.Int, id)
            .input("ECreatedAt", sql.DateTime2, new Date())
            .input("EUpdatedAt", sql.DateTime2, new Date()).query(`
            INSERT INTO dbo.ExpenseBooking (
              EName, EProjectName, EDocumentType, EDocDate,
              EAmount, ENetAmount, ECgstRate, ESgstRate,
              EEmiPayment, ERemarks, EStatus,
              ECompanyId, EDocTypeId, EFinYear, ECreatedBy,
              EParentEmiRef, ECreatedAt, EUpdatedAt
            ) VALUES (
              @EName, @EProjectName, @EDocumentType, @EDocDate,
              @EAmount, @ENetAmount, @ECgstRate, @ESgstRate,
              @EEmiPayment, @ERemarks, @EStatus,
              @ECompanyId, @EDocTypeId, @EFinYear, @ECreatedBy,
              @EParentEmiRef, @ECreatedAt, @EUpdatedAt
            );
            SELECT SCOPE_IDENTITY() AS NewId;
          `);

          lumpSumId = lumpInsert.recordset[0]?.NewId || null;

          // Try to auto-generate a doc number for the lump-sum booking using the
          // same doc type as the parent, if available.
          if (lumpSumId && parentRow.EDocTypeId) {
            try {
              const typeResult = await pool
                .request()
                .input("TypeOfDocId", sql.Int, parentRow.EDocTypeId).query(`
                SELECT Prefix, FullPrefix, StartingDocNo
                FROM dbo.TypeOfDoc WHERE TypeOfDocId = @TypeOfDocId AND IsActive = 1
              `);
              const typeRow = typeResult.recordset[0];
              if (typeRow) {
                const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
                const prefix = rawPrefix.replace(/\d+$/, "");
                const startFrom = typeRow.StartingDocNo ?? 1;
                const finYear = (parentRow.EFinYear || "").toString().trim();

                const maxResult = await pool
                  .request()
                  .input("TypeOfDocId", sql.Int, parentRow.EDocTypeId)
                  .input("Prefix", sql.NVarChar(100), prefix + "%").query(`
                  SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
                  FROM dbo.DocNumberSequence WHERE TypeOfDocId = @TypeOfDocId AND DocNo LIKE @Prefix
                `);
                const ebMaxResult = await pool
                  .request()
                  .input("EDocTypeId2", sql.Int, parentRow.EDocTypeId)
                  .input("Prefix2", sql.NVarChar(100), prefix + "%").query(`
                  SELECT MAX(TRY_CAST(SUBSTRING(EDocNo, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
                  FROM dbo.ExpenseBooking WHERE EDocTypeId = @EDocTypeId2 AND EDocNo LIKE @Prefix2
                `);

                const combined = Math.max(
                  maxResult.recordset[0]?.MaxSeq ?? 0,
                  ebMaxResult.recordset[0]?.MaxSeq ?? 0,
                );
                const maxSeq = combined > 0 ? combined : startFrom - 1;
                const nextSeq = Math.max(maxSeq + 1, startFrom);
                const padded = String(nextSeq).padStart(6, "0");
                lumpSumDocNo = finYear
                  ? `${prefix}${padded}/${finYear}`
                  : `${prefix}${padded}`;

                await pool
                  .request()
                  .input("TypeOfDocId", sql.Int, parentRow.EDocTypeId)
                  .input("DocNo", sql.NVarChar(100), lumpSumDocNo)
                  .input("TableName", sql.NVarChar(100), "ExpenseBooking")
                  .input("IssuedBy", sql.NVarChar(200), userEmail).query(`
                  INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
                  VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
                `);

                await pool
                  .request()
                  .input("Eid", sql.Int, lumpSumId)
                  .input("EDocNo", sql.NVarChar(100), lumpSumDocNo)
                  .input("RecordId", sql.Int, lumpSumId).query(`
                  UPDATE dbo.ExpenseBooking SET EDocNo = @EDocNo WHERE Eid = @Eid;
                  UPDATE dbo.DocNumberSequence SET RecordId = @RecordId WHERE DocNo = @EDocNo AND TableName = 'ExpenseBooking';
                `);
              }
            } catch (docErr) {
              console.warn(
                "Could not auto-assign doc number to lump-sum booking:",
                docErr.message,
              );
            }
          }

          // Write the lump-sum booking reference back onto the parent so
          // the UI can surface it as a "remaining balance" link.
          if (lumpSumId) {
            await pool
              .request()
              .input("Eid", sql.Int, id)
              .input("ELumpSumRef", sql.Int, lumpSumId)
              .query(
                "UPDATE dbo.ExpenseBooking SET ELumpSumRef = @ELumpSumRef WHERE Eid = @Eid",
              );
          }
        }
      } else {
        await pool
          .request()
          .input("Eid", sql.Int, id)
          .input("EEmiPayment", sql.Bit, 1)
          .query(
            "UPDATE dbo.ExpenseBooking SET EEmiPayment = @EEmiPayment WHERE Eid = @Eid",
          );
      }

      await bumpCacheVersion("expense-booking");
      await bumpCacheVersion("expense-booking-options");
      await bumpCacheVersion("expense-booking-source-ids");

      res.json({
        message: enabled ? "EMI re-enabled" : "EMI disabled",
        statusReset: !enabled && (lumpSumId !== null || true) ? true : false,
        stats: {
          total: parseInt(total) || 0,
          paid: parseInt(paid) || 0,
          paidAmount: parseFloat(paidAmount) || 0,
          remainingAmount: parseFloat(remainingAmount) || 0,
        },
        lumpSum: lumpSumId ? { id: lumpSumId, docNo: lumpSumDocNo } : null,
      });
    } catch (err) {
      console.error("EMI toggle error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── PUT Update ───────────────────────────────────────────────────────────────
router.put(
  "/:id",
  validateBody(expenseBookingUpdateSchema),
  async (req, res) => {
    const numericId = parseInt(req.params.id, 10);
    if (!Number.isFinite(numericId) || numericId <= 0)
      return res.status(400).json({ error: "Invalid record id" });

    try {
      await guardEdit("expense-booking", req.params.id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const {
      EName,
      EProjectName,
      EDocumentType,
      EDocDate,
      EAmount,
      ENetAmount,
      ECgstRate,
      ESgstRate,
      EDiscountData,
      EDocNo,
      EEmiPayment,
      EEmiData,
      EInstallmentCount,
      EEmiAmount,
      EEmiStartDate,
      EReminder,
      ERemarks,
      EStatus,
      ECompanyId,
      EDocTypeId,
      EFinYear,
      ESourceType,
      ESourceId,
      EBillingTermId,
      EBillingTermName,
      EBillingTermsData,
      ETCId,
      ETCName,
      ETCText,
      EVendorInvoiceNo,
      EVendorInvoiceDate,
      EAdditionalCharges,
      ECostCenter,
      EGLAccount,
      EWorkDoneRef,
    } = req.body;

    try {
      const pool = getPool();
      let bookingAmount = EAmount;
      let bookingNetAmount = ENetAmount;
      let bookingCgstRate = ECgstRate;
      let bookingSgstRate = ESgstRate;

      if (ESourceType === "GRN") {
        const grnId = parseInt(ESourceId, 10);
        if (!Number.isFinite(grnId) || grnId <= 0) {
          return res.status(400).json({ error: "GRN source is required." });
        }

        const grnGst = await buildGrnGstData(pool, grnId);
        if (!grnGst) {
          return res.status(404).json({ error: "Linked GRN not found." });
        }
        if (!grnGst.totals.receivedQty || grnGst.totals.receivedQty <= 0) {
          return res.status(400).json({
            error: "Cannot book expense for a GRN with no received quantity.",
          });
        }

        bookingAmount = grnGst.totals.taxableAmount;
        bookingNetAmount = grnGst.totals.netAmount;
        bookingCgstRate = grnGst.cgstRate;
        bookingSgstRate = grnGst.sgstRate;
        // Apply billing terms on top of the GRN gross amount
        bookingNetAmount = applyBillingTermsToAmount(
          bookingNetAmount,
          bookingAmount,
          bookingCgstRate,
          bookingSgstRate,
          EBillingTermsData,
          EDiscountData,
        );
      }

      const result = await pool
        .request()
        .input("Eid", sql.Int, numericId)
        .input("EName", sql.NVarChar(200), EName || null)
        .input("EProjectName", sql.NVarChar(150), EProjectName || null)
        .input("EDocumentType", sql.NVarChar(50), EDocumentType || null)
        .input("EDocDate", sql.Date, EDocDate || null)
        .input(
          "EAmount",
          sql.Decimal(18, 2),
          bookingAmount != null && bookingAmount !== ""
            ? Number(bookingAmount)
            : 0,
        )
        .input(
          "ENetAmount",
          sql.Decimal(18, 2),
          bookingNetAmount != null && bookingNetAmount !== ""
            ? Math.round(Number(bookingNetAmount) * 100) / 100
            : 0,
        )
        .input("ECgstRate", sql.Decimal(5, 2), bookingCgstRate ?? 0)
        .input("ESgstRate", sql.Decimal(5, 2), bookingSgstRate ?? 0)
        .input(
          "EDiscountData",
          sql.NVarChar(sql.MAX),
          EDiscountData
            ? typeof EDiscountData === "string"
              ? EDiscountData
              : JSON.stringify(EDiscountData)
            : null,
        )
        .input("EDocNo", sql.NVarChar(100), EDocNo || null)
        .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
        .input(
          "EEmiData",
          sql.NVarChar(sql.MAX),
          EEmiData ? JSON.stringify(EEmiData) : null,
        )
        .input("EInstallmentCount", sql.Int, EInstallmentCount || null)
        .input("EEmiAmount", sql.Decimal(18, 2), EEmiAmount || null)
        .input("EEmiStartDate", sql.Date, EEmiStartDate || null)
        .input("EReminder", sql.Date, EReminder || null)
        .input("ERemarks", sql.NVarChar(300), ERemarks || null)
        .input("EStatus", sql.NVarChar(50), EStatus || "Draft")
        .input("EUpdatedAt", sql.DateTime2, new Date())
        .input(
          "ECompanyId",
          sql.Int,
          ECompanyId ? parseInt(ECompanyId, 10) : null,
        )
        .input(
          "EDocTypeId",
          sql.Int,
          EDocTypeId ? parseInt(EDocTypeId, 10) : null,
        )
        .input("EFinYear", sql.NVarChar(20), EFinYear || null)
        .input("ESourceType", sql.NVarChar(20), ESourceType || null)
        .input("ESourceId", sql.Int, ESourceId ? parseInt(ESourceId, 10) : null)
        .input(
          "EBillingTermId",
          sql.Int,
          EBillingTermId ? parseInt(EBillingTermId, 10) : null,
        )
        .input("EBillingTermName", sql.NVarChar(200), EBillingTermName || null)
        .input(
          "EBillingTermsData",
          sql.NVarChar(sql.MAX),
          EBillingTermsData
            ? typeof EBillingTermsData === "string"
              ? EBillingTermsData
              : JSON.stringify(EBillingTermsData)
            : null,
        )
        .input("ETCId", sql.Int, ETCId ? parseInt(ETCId, 10) : null)
        .input("ETCName", sql.NVarChar(200), ETCName || null)
        .input("ETCText", sql.NVarChar(sql.MAX), ETCText || null)
        .input("EVendorInvoiceNo", sql.NVarChar(100), EVendorInvoiceNo || null)
        .input("EVendorInvoiceDate", sql.Date, EVendorInvoiceDate || null)
        .input(
          "EAdditionalCharges",
          sql.NVarChar(sql.MAX),
          EAdditionalCharges ? JSON.stringify(EAdditionalCharges) : null,
        )
        .input("ECostCenter", sql.NVarChar(200), ECostCenter || null)
        .input("EGLAccount", sql.NVarChar(200), EGLAccount || null)
        .input("EWorkDoneRef", sql.NVarChar(100), EWorkDoneRef || null).query(`
        UPDATE dbo.ExpenseBooking SET
          EName=@EName, EProjectName=@EProjectName, EDocumentType=@EDocumentType, EDocDate=@EDocDate,
          EAmount=@EAmount, ENetAmount=@ENetAmount, ECgstRate=@ECgstRate, ESgstRate=@ESgstRate,
          EDiscountData=@EDiscountData, EDocNo=@EDocNo, EEmiPayment=@EEmiPayment,
          EEmiData=@EEmiData, EInstallmentCount=@EInstallmentCount, EEmiAmount=@EEmiAmount,
          EEmiStartDate=@EEmiStartDate, EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId,
          EDocTypeId=@EDocTypeId, EFinYear=@EFinYear,
          ESourceType=@ESourceType, ESourceId=@ESourceId,
          EBillingTermId=@EBillingTermId, EBillingTermName=@EBillingTermName,
          EBillingTermsData=@EBillingTermsData,
          ETCId=@ETCId, ETCName=@ETCName, ETCText=@ETCText,
          EVendorInvoiceNo=@EVendorInvoiceNo, EVendorInvoiceDate=@EVendorInvoiceDate,
          EAdditionalCharges=@EAdditionalCharges,
          ECostCenter=@ECostCenter, EGLAccount=@EGLAccount, EWorkDoneRef=@EWorkDoneRef
        WHERE Eid = @Eid
      `);

      if (!result.rowsAffected?.[0]) {
        return res.status(404).json({ error: "Expense booking not found" });
      }

      // If EMI is being enabled and a schedule is provided, sync EmiInstallments.
      // Only insert rows that don't already exist (idempotent — safe to call on re-save).
      if (EEmiPayment && EEmiData) {
        let schedule = [];
        try {
          const parsed =
            typeof EEmiData === "string" ? JSON.parse(EEmiData) : EEmiData;
          schedule = parsed?.schedule ?? [];
        } catch (e) {
          console.warn("Failed to parse EMI data on update");
        }

        for (const row of schedule) {
          try {
            if (!row.dueDate) continue;
            // Check if this installment row already exists
            const exists = await pool
              .request()
              .input("ExpenseBookingId", sql.Int, numericId)
              .input("InstallmentNo", sql.Int, row.installmentNo).query(`
              SELECT 1 AS found FROM dbo.EmiInstallments
              WHERE ExpenseBookingId = @ExpenseBookingId AND InstallmentNo = @InstallmentNo
            `);
            if (exists.recordset.length > 0) continue; // already exists — skip

            await pool
              .request()
              .input("ExpenseBookingId", sql.Int, numericId)
              .input("InstallmentNo", sql.Int, row.installmentNo)
              .input("RefNumber", sql.NVarChar(200), row.refNumber || null)
              .input("DueDate", sql.Date, row.dueDate)
              .input("Amount", sql.Decimal(18, 2), row.amount || 0)
              .input("Status", sql.NVarChar(20), row.status || "Pending")
              .query(`
              INSERT INTO dbo.EmiInstallments
              (ExpenseBookingId, InstallmentNo, RefNumber, DueDate, Amount, Status)
              VALUES (@ExpenseBookingId, @InstallmentNo, @RefNumber, @DueDate, @Amount, @Status)
            `);
          } catch (rowErr) {
            console.warn("EMI insert warning on update:", rowErr.message);
          }
        }
      }

      await bumpCacheVersion("expense-booking");
      await bumpCacheVersion("expense-booking-options");
      await bumpCacheVersion("expense-booking-source-ids");
      res.json({ message: "Expense updated successfully" });
    } catch (err) {
      console.error("Update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0)
    return res.status(400).json({ error: "Invalid record id" });

  try {
    const pool = getPool();

    // ── 1. Debit Note guard ───────────────────────────────────────────────────
    const refCheck = await pool.request().input("Eid", sql.Int, numericId)
      .query(`
      SELECT COUNT(*) AS cnt FROM dbo.DebitNote WHERE bill_id = @Eid
    `);
    const linkedDebitNoteCount = Number(refCheck.recordset[0]?.cnt) || 0;
    if (linkedDebitNoteCount > 0) {
      const message =
        "This booking cannot be deleted because it has linked Debit Notes. Please delete or unlink them first.";
      return res
        .status(409)
        .json({ error: message, message, linkedDebitNoteCount });
    }

    // ── 2. BRS cleared payment guard ─────────────────────────────────────────
    const brsCheck = await pool.request().input("Eid", sql.Int, numericId)
      .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.ExpenseBooking eb
      JOIN dbo.NewPayment np
        ON np.PExpenseRef = eb.EDocNo
      JOIN dbo.BankReconciliation brc
        ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID AND brc.IsMatched = 1
      WHERE eb.Eid = @Eid
    `);
    if (Number(brsCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "brs_cleared",
        message:
          "This expense booking has payments that are cleared in BRS. Unclear and delete the payment record first.",
      });
    }

    // ── 3. Uncleared payment guard ────────────────────────────────────────────
    const payCheck = await pool.request().input("Eid", sql.Int, numericId)
      .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.ExpenseBooking eb
      JOIN dbo.NewPayment np ON np.PExpenseRef = eb.EDocNo
      WHERE eb.Eid = @Eid
    `);
    if (Number(payCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_payments",
        message:
          "This expense booking has linked payment records. Delete the payment records first.",
      });
    }

    await pool
      .request()
      .input("Eid", sql.Int, numericId)
      .query("DELETE FROM dbo.ExpenseBooking WHERE Eid = @Eid");

    await bumpCacheVersion("expense-booking");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("expense-booking-source-ids");
    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("Delete error:", err.message);
    if (err.number === 547 && String(err.message).includes("FK_DN_Bill")) {
      const message =
        "This booking cannot be deleted because it has linked Debit Notes. Please delete or unlink them first.";
      return res.status(409).json({ error: message, message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Approval Routes ──────────────────────────────────────────────────────────
router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "expense-booking",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("expense-booking");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("expense-booking-source-ids");
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition(
      "expense-booking",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("expense-booking");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("expense-booking-source-ids");
    res.json({ message: "Approved", ...result });
  } catch (err) {
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.put(
  "/:id/reject",
  validateBody(expenseRejectSchema),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { note } = req.body;
    try {
      const userEmail = requireUserEmail(req, res);
      if (!userEmail) return;
      const result = await transition(
        "expense-booking",
        id,
        "Rejected",
        userEmail,
        req.user?.role,
        note || null,
      );
      await bumpCacheVersion("expense-booking");
      await bumpCacheVersion("expense-booking-options");
      await bumpCacheVersion("expense-booking-source-ids");
      res.json({ message: "Rejected", ...result });
    } catch (err) {
      const status = err.message.includes("not authorized") ? 403 : 400;
      res.status(status).json({ error: err.message });
    }
  },
);

// ─── GET /chain-status ────────────────────────────────────────────────────────
// Used by PO / WO / GRN detail panels to show "Expense Booked ✓ / Paid ✓" badges.
// Query params: sourceType (PO | WO | GRN), sourceId (numeric DB id)
// ─── GET /:id/payment-summary ─────────────────────────────────────────────────
// Returns aggregated payment info for a single expense booking.
// Used by the traceability chain panel in the preview modal.
router.get("/:id/payment-summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const ebRes = await pool.request().input("Eid", sql.Int, id).query(`
        SELECT
          eb.Eid, eb.EDocNo, eb.EStatus, eb.EBillStatus,
          eb.ENetAmount, eb.EAmount, eb.ETotalPaid, eb.ERemainingAmount,
          eb.ESourceType, eb.ESourceId, eb.EWorkDoneRef,
          eb.EVendorInvoiceNo, eb.EVendorInvoiceDate,
          -- GRN info
          grn.GRNNo, grn.GRNID,
          -- PO info via GRN or direct
          po.PurchaseOrderNo, po.PurchaseOrderID,
          po.SourceMRDocNo
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.PurchaseOrders po
          ON (
            (eb.ESourceType = 'GRN' AND po.PurchaseOrderID = grn.POID)
            OR (eb.ESourceType IN ('PO','WO_PO','WORK_DONE') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT))
          )
        WHERE eb.Eid = @Eid
      `);

    if (!ebRes.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const eb = ebRes.recordset[0];
    const netAmount = parseFloat(eb.ENetAmount ?? eb.EAmount ?? 0) || 0;

    // Fetch approved payments against this booking
    const payRes = await pool
      .request()
      .input("PExpenseRef", sql.NVarChar(100), eb.EDocNo).query(`
        SELECT
          PPaymentID, DocNo, PDate, PMode, PAmount, Status,
          PPaymentName, PChequeNo, PNeftNumber, PUpiTransactionId
        FROM dbo.NewPayment
        WHERE PExpenseRef = @PExpenseRef
        ORDER BY PPaymentID ASC
      `);

    const payments = payRes.recordset.map((p) => ({
      id: p.PPaymentID,
      docNo: p.DocNo,
      date: p.PDate ? String(p.PDate).slice(0, 10) : null,
      mode: p.PMode,
      amount: parseFloat(p.PAmount) || 0,
      status: p.Status,
      ref: p.PChequeNo || p.PNeftNumber || p.PUpiTransactionId || null,
    }));

    const totalPaid = parseFloat(eb.ETotalPaid ?? 0) || 0;
    const remaining = parseFloat(eb.ERemainingAmount ?? netAmount) || 0;

    res.json({
      expenseId: eb.Eid,
      docNo: eb.EDocNo,
      status: eb.EStatus,
      billStatus:
        eb.EBillStatus || (payments.length === 0 ? "Payment Due" : null),
      netAmount,
      totalPaid,
      remaining,
      payments,
      chain: {
        mrDocNo: eb.SourceMRDocNo || null,
        workDoneRef: eb.EWorkDoneRef || null,
        poNo: eb.PurchaseOrderNo || null,
        poId: eb.PurchaseOrderID || null,
        grnNo: eb.GRNNo || null,
        grnId: eb.GRNID || null,
        expenseDocNo: eb.EDocNo,
        vendorInvoiceNo: eb.EVendorInvoiceNo || null,
        vendorInvoiceDate: eb.EVendorInvoiceDate
          ? String(eb.EVendorInvoiceDate).slice(0, 10)
          : null,
      },
    });
  } catch (err) {
    console.error("payment-summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/grns ────────────────────────────────────────────────────────────
// Returns GRNs linked to an expense booking.
// Two strategies:
//   1. If ESourceType = 'GRN', look up the single GRN by ESourceId.
//   2. Also check GoodsReceiptNotes where any payment references this booking's EDocNo
//      (belt-and-suspenders for older records that pre-date ESourceType tracking).
router.get("/:id/grns", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    // Step 1: fetch the expense booking to know its ESourceType / ESourceId / EDocNo
    const ebResult = await pool
      .request()
      .input("Eid", sql.Int, id)
      .query(
        "SELECT ESourceType, ESourceId, EDocNo FROM dbo.ExpenseBooking WHERE Eid = @Eid",
      );

    if (!ebResult.recordset.length)
      return res.status(404).json({ error: "Expense booking not found" });

    const { ESourceType, ESourceId, EDocNo } = ebResult.recordset[0];

    const grnIds = new Set();

    // Strategy 1: direct GRN source link
    if (ESourceType === "GRN" && ESourceId) {
      grnIds.add(parseInt(ESourceId, 10));
    }

    // Strategy 2: any GRN whose EDocNo matches expense's EDocNo (legacy)
    if (EDocNo) {
      const legacyResult = await pool
        .request()
        .input("EDocNo", sql.NVarChar(100), EDocNo)
        .query(`SELECT GRNID FROM dbo.GoodsReceiptNotes WHERE GRNNo = @EDocNo`);
      for (const row of legacyResult.recordset) {
        grnIds.add(row.GRNID);
      }
    }

    if (grnIds.size === 0) return res.json([]);

    // Fetch full GRN details for all matched IDs
    const idList = Array.from(grnIds).join(",");
    const grnResult = await pool.request().query(`
      SELECT
        grn.GRNID,
        grn.GRNNo,
        grn.GRNDate,
        grn.Status,
        grn.Remarks,
        p.PurchaseOrderNo AS PONumber,
        s.LHeadName       AS SupplierName,
        pr.name           AS ProjectName
      FROM dbo.GoodsReceiptNotes grn
      LEFT JOIN dbo.PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN dbo.enterprise pr ON pr.id = p.ProjectId
      WHERE grn.GRNID IN (${idList})
      ORDER BY grn.GRNID DESC
    `);

    res.json(grnResult.recordset);
  } catch (err) {
    console.error("Expense GRNs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;