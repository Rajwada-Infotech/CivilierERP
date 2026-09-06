const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, getRecordStatus } = require("../services/approvalService");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");
const { requirePageRight } = require("../middleware/requirePageRight");
const { validateBody } = require("../middleware/validateRequest");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const {
  expenseBookingBodySchema,
  expenseBookingUpdateSchema,
  emiPaySchema,
  emiToggleSchema,
  expenseRejectSchema,
} = require("../validation/expenseBookingSchemas");
const {
  normalizeAllocations,
  sumAllocations,
  replaceAllocations,
  getAllocations,
  getAllocationsForMany,
} = require("../services/expenseHeadAllocation");
const { expenseBookingSupplierSql } = require("../utils/expenseBookingSupplier");
const { buildDirectExpenseBooking } = require("../services/directExpenseBooking");
const { computeMultiGRNInvoice } = require("../services/invoiceLinking");
const { syncBillStatus } = require("../utils/syncBillStatus");
const { downstreamOfExpenseBooking } = require("../utils/materialChainGuard");

// Defends against a corrupted EEmiData blob perpetuating itself. A legit EMI
// config's own keys are always named fields (enabled, installmentCount, ...)
// — never a numeric string like "0". A "0" key means this JSON was, at some
// point, produced by spreading a STRING instead of an object (JS spreads a
// string into {"0":"c","1":"h",...}), which then got parsed-merged-and-saved
// right back through one of this route's own read-modify-write paths
// (EMI-pay, EMI-toggle), re-corrupting it every cycle. Every JSON.parse of a
// stored EEmiData value in this file goes through here so a corrupted blob
// gets its real fields recovered (they're usually still sitting after the
// garbage keys, since the write paths only ever add/overwrite named fields)
// and the garbage keys dropped, instead of being merged forward again.
function sanitizeEmiJson(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Object.prototype.hasOwnProperty.call(parsed, "0")) {
    const { enabled, installmentCount, emiAmount, startDate, schedule } = parsed;
    return {
      enabled: !!enabled,
      installmentCount: installmentCount || 0,
      emiAmount: emiAmount || 0,
      startDate: startDate || "",
      schedule: Array.isArray(schedule) ? schedule : [],
    };
  }
  return parsed;
}

// Base/GST for a single GRN's item lines.
async function computeSingleGrnBaseTax(pool, grnId) {
  const itemsRes = await pool.request().input("GRNID", sql.Int, grnId)
    .query(`SELECT GRNNo, GRNDate, GRNItems FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID`);
  const row = itemsRes.recordset[0];
  const rawItems = JSON.parse(row?.GRNItems || "[]");
  const received = rawItems.filter((it) => Number(it.receivedQty||it.ReceivedQty||0)>0||Number(it.quantity||it.Quantity||0)>0||Number(it.totalAmount||0)>0);
  let tBase = 0, tGST = 0;
  if (received.length) {
    const itemIds = received.map((it)=>String(it.itemId||it.ItemId||"").trim()).filter(Boolean);
    let masterMap = {};
    if (itemIds.length) {
      const mReq = pool.request();
      const ph = itemIds.map((id,i)=>{ mReq.input(`iid${i}`,sql.NVarChar(100),id); return `@iid${i}`; }).join(",");
      const mRes = await mReq.query(`SELECT CONVERT(NVARCHAR(100),M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100),M_Id) IN (${ph})`);
      for (const r of mRes.recordset) masterMap[r.M_Id]={cgstRate:parseFloat(r.M_CGST)||0,sgstRate:parseFloat(r.M_SGST)||0};
    }
    for (const it of received) {
      const itemId = String(it.itemId||it.ItemId||"");
      const qty = Number(it.receivedQty||it.ReceivedQty||0);
      const rate = Number(it.rate||it.Rate||0);
      const base = Number(it.totalAmount)>0 ? Number(it.totalAmount) : rate*Number(it.quantity||it.Quantity||qty||0);
      const master = masterMap[itemId]||{cgstRate:0,sgstRate:0};
      const lineGstPct = Number(it.gstPct??it.GstPct??NaN);
      const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate+master.sgstRate);
      tBase += base;
      tGST += base*(totalGSTRate/100);
    }
  }
  const baseAmount = Math.round(tBase*100)/100;
  const taxAmount = Math.round(tGST*100)/100;
  return {
    grnId,
    docNo: row?.GRNNo ?? null,
    date: row?.GRNDate ?? null,
    baseAmount,
    taxAmount,
    totalAmount: Math.round((baseAmount+taxAmount)*100)/100,
  };
}

// Sums base/GST across every GRN in `grnIds` — used for invoice-posting
// totals on GRN-linked bookings. A multi-GRN combined invoice (see
// backend/services/invoiceLinking.js) has several GRNs merged into it;
// summing only the primary one silently understates the posted amount.
// Also returns the per-GRN breakdown (doc no, date, amounts) so a combined
// invoice's posting tab can show what each individual GRN contributed.
async function computeGrnBaseTax(pool, grnIds) {
  const perGrn = [];
  for (const grnId of grnIds) {
    perGrn.push(await computeSingleGrnBaseTax(pool, grnId));
  }
  const baseAmount = Math.round(perGrn.reduce((s, g) => s + g.baseAmount, 0) * 100) / 100;
  const taxAmount = Math.round(perGrn.reduce((s, g) => s + g.taxAmount, 0) * 100) / 100;
  return {
    baseAmount,
    taxAmount,
    totalAmount: Math.round((baseAmount+taxAmount)*100)/100,
    perGrn,
  };
}

// Cost-centre-wise base/GST breakdown for a SINGLE GRN's item lines —
// mirrors computeSingleGrnBaseTax's per-item math but groups by each item's
// own Cost Centre (migration 365) instead of summing into one flat total.
// Used both by the multi-GRN summary breakdown below and by post-to-gl to
// split each GRN's PGRN-reversal/GST-Credit legs per cost centre.
async function computeSingleGrnCostCentreBuckets(pool, grnId) {
  const grnRes = await pool.request().input("GRNID", sql.Int, grnId)
    .query(`SELECT GRNItems, POID FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID`);
  const row = grnRes.recordset[0];
  if (!row) return [];
  const rawItems = JSON.parse(row.GRNItems || "[]");
  const received = rawItems.filter((it) => Number(it.receivedQty||it.ReceivedQty||0)>0||Number(it.quantity||it.Quantity||0)>0||Number(it.totalAmount||0)>0);
  if (!received.length) return [];

  const itemIds = received.map((it)=>String(it.itemId||it.ItemId||"").trim()).filter(Boolean);
  let masterMap = {}, ccMap = {};
  if (itemIds.length) {
    const mReq = pool.request();
    const ph = itemIds.map((id,i)=>{ mReq.input(`iid${i}`,sql.NVarChar(100),id); return `@iid${i}`; }).join(",");
    const mRes = await mReq.query(`SELECT CONVERT(NVARCHAR(100),M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100),M_Id) IN (${ph})`);
    for (const r of mRes.recordset) masterMap[r.M_Id]={cgstRate:parseFloat(r.M_CGST)||0,sgstRate:parseFloat(r.M_SGST)||0};

    if (row.POID) {
      const ccReq = pool.request().input("POID", sql.Int, row.POID);
      const ph2 = itemIds.map((id,i)=>{ ccReq.input(`ccid${i}`,sql.NVarChar(100),id); return `@ccid${i}`; }).join(",");
      const ccRes = await ccReq.query(`
        SELECT CONVERT(NVARCHAR(100), poi.ItemId) AS ItemId, poi.CostCenterId, cc.Name AS CostCenterName, cc.Code AS CostCenterCode
        FROM dbo.PurchaseOrderItems poi
        LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = poi.CostCenterId
        WHERE poi.PurchaseOrderID = @POID AND CONVERT(NVARCHAR(100), poi.ItemId) IN (${ph2})
      `);
      for (const r of ccRes.recordset) {
        ccMap[r.ItemId] = r.CostCenterId ? { id: r.CostCenterId, name: r.CostCenterName, code: r.CostCenterCode } : null;
      }
    }
  }

  const buckets = new Map();
  for (const it of received) {
    const itemId = String(it.itemId||it.ItemId||"");
    const qty = Number(it.receivedQty||it.ReceivedQty||0);
    const rate = Number(it.rate||it.Rate||0);
    const base = Number(it.totalAmount)>0 ? Number(it.totalAmount) : rate*Number(it.quantity||it.Quantity||qty||0);
    const master = masterMap[itemId]||{cgstRate:0,sgstRate:0};
    const lineGstPct = Number(it.gstPct??it.GstPct??NaN);
    const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate+master.sgstRate);
    const gst = base*(totalGSTRate/100);

    const costCentre = ccMap[itemId] ?? null;
    const key = costCentre?.id ?? "unassigned";
    const bucket = buckets.get(key) ?? { costCentre, base: 0, gst: 0 };
    bucket.base += base;
    bucket.gst += gst;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((b) => ({
    costCentre: b.costCentre,
    baseAmount: Math.round(b.base * 100) / 100,
    gstAmount: Math.round(b.gst * 100) / 100,
  }));
}

// Cost-centre-wise base/GST breakdown across every GRN feeding an invoice —
// mirrors computeSingleGrnBaseTax's per-item math but groups by each item's
// own Cost Centre (migration 365: lives on the PO's line item, not the PO
// header, since one PO/GRN can mix e.g. a fixed-asset item with a
// consumption item) instead of summing into one flat total. Used so a
// GRN-linked invoice's Posting tab can show the same cost-centre-wise money
// breakdown as the GRN it was raised from.
async function computeGrnCostCentreBreakdown(pool, grnIds) {
  const buckets = new Map(); // key: CostCenterId ?? "unassigned" -> { costCentre, base, gst }
  for (const grnId of grnIds) {
    const grnBuckets = await computeSingleGrnCostCentreBuckets(pool, grnId);
    for (const b of grnBuckets) {
      const key = b.costCentre?.id ?? "unassigned";
      const bucket = buckets.get(key) ?? { costCentre: b.costCentre, base: 0, gst: 0 };
      bucket.base += b.baseAmount;
      bucket.gst += b.gstAmount;
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()]
    .filter((b) => Math.round(b.base * 100) / 100 > 0)
    .map((b) => ({
      costCentre: b.costCentre,
      baseAmount: Math.round(b.base * 100) / 100,
      gstAmount: Math.round(b.gst * 100) / 100,
      totalAmount: Math.round((b.base + b.gst) * 100) / 100,
    }));
}

// Resolves every GRN id feeding an invoice — the primary eb.ESourceId, plus
// every id in eb.ELinkedGrnIds for a multi-GRN combined invoice.
function resolveGrnIds(eb) {
  if (eb.ELinkedGrnIds) {
    try {
      const ids = JSON.parse(eb.ELinkedGrnIds);
      if (Array.isArray(ids) && ids.length) return ids.map((id) => parseInt(id, 10)).filter(Boolean);
    } catch { /* fall through to primary-only */ }
  }
  const primary = parseInt(eb.ESourceId, 10);
  return primary ? [primary] : [];
}

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

  // Apply pre-GST terms to basicAmount then recompute grossAmount.
  // If there are no pre-GST terms, use the passed grossAmount directly as the
  // post-GST base — this avoids re-deriving gross from basicAmount which may be
  // stale (e.g. EAmount stored before a GRN amendment).
  let running;
  if (preGstTerms.length === 0) {
    running = roundMoney(toNumber(grossAmount));
  } else {
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
    running = roundMoney(runningBase + cgstAmt + sgstAmt);
  }

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
    const itemReq = pool.request();
    const itemParams = itemIds.map((id, i) => { itemReq.input(`iid${i}`, sql.NVarChar(100), String(id)); return `@iid${i}`; });
    const itemResult = await itemReq.query(`
      SELECT
        CONVERT(NVARCHAR(100), img.M_Id) AS ItemId,
        img.M_Name,
        img.M_HSN,
        h.HCGST,
        h.HSGST,
        h.HIGST
      FROM dbo.Item_Master_Group img
      LEFT JOIN dbo.HSN h ON h.HCode = img.M_HSN AND h.HStatus = 1
      WHERE CONVERT(NVARCHAR(100), img.M_Id) IN (${itemParams.join(",")})
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

    const docNoList = expenses.map((e) => e.EDocNo).filter(Boolean);

    let paymentCount = 0;
    let latestPaymentAmount = null;
    let isPaid = false;

    if (docNoList.length > 0) {
      const payReq = pool.request();
      const paramList = docNoList.map((d, i) => {
        payReq.input(`dn${i}`, sql.NVarChar(100), d);
        return `@dn${i}`;
      });
      const payResult = await payReq.query(`
          SELECT COUNT(*) AS payCount,
                 SUM(PAmount) AS totalPaid
          FROM dbo.NewPayment
          WHERE PExpenseRef IN (${paramList.join(",")})
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
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const finYear = (req.query.finYear || "").toString().trim() || null;
    // When "Pay Remaining" navigates to a payment that's already marked Paid,
    // include that specific invoice regardless of EBillStatus so the form can pre-fill.
    const includeRef = (req.query.includeRef || "").toString().trim() || null;
    // When navigating from On A/C Adjustment, filter invoices to the selected party only.
    const partyId = parseInt(req.query.partyId || "", 10) || null;

    // Regular bookings: exclude EMI-enabled ones (they are paid via installments)
    // and exclude any already linked to an active DebitNote
    const bookingsResult = await pool
      .request()
      .input("FinYear", sql.NVarChar(20), finYear)
      .input("IncludeRef", sql.NVarChar(100), includeRef)
      .input("PartyId", sql.Int, partyId).query(`
        SELECT
          eb.Eid                          AS id,
          eb.Eid                          AS value,
          ISNULL(eb.EDocNo, CONCAT('Draft #', CAST(eb.Eid AS NVARCHAR))) AS docNo,
          COALESCE(proj.name, eb.EProjectName, '') AS projectName,
          ISNULL(eb.EName, '')            AS partyName,
          -- Supplier name: GRN -> GRN's supplier; PO/WO_PO -> the PO's own
          -- SupplierID; WORK_DONE -> the WorkDone's contractor. Direct/manual
          -- (TOD etc.) bookings resolve via ExpenseBooking.LHeadId — the
          -- supplier chosen directly on the booking form. EName (the
          -- booking/item label) is only ever a last-resort fallback — it
          -- must never stand in for an actual supplier/contractor.
          CASE
            WHEN eb.ESourceType = 'GRN'      AND eb.ESourceId IS NOT NULL THEN ISNULL(ahm.LHeadName,        ISNULL(eb.EName, ''))
            WHEN eb.ESourceType IN ('PO','WO_PO')                          THEN ISNULL(po_supp_opt.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType = 'WORK_DONE'                              THEN ISNULL(wd_supp_opt.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType = 'WO'                                     THEN ISNULL(wo_supp_opt.LHeadName, ISNULL(eb.EName, ''))
            -- direct_supp_opt covers current bookings (LHeadId set on save);
            -- party_opt is a fallback for older bookings saved before that
            -- fix, matched via the On A/C Adjustment @PartyId scope.
            ELSE ISNULL(direct_supp_opt.LHeadName, ISNULL(party_opt.LHeadName, ISNULL(eb.EName, '')))
          END                             AS supplierName,
          -- Party/supplier LHeadId behind supplierName above — lets the
          -- frontend auto-select the Payee/Party dropdown on invoice pick.
          CASE
            WHEN eb.ESourceType = 'GRN'      AND eb.ESourceId IS NOT NULL THEN ahm.LHeadId
            WHEN eb.ESourceType IN ('PO','WO_PO')                          THEN po_supp_opt.LHeadId
            WHEN eb.ESourceType = 'WORK_DONE'                              THEN wd_supp_opt.LHeadId
            WHEN eb.ESourceType = 'WO'                                     THEN wo_supp_opt.LHeadId
            ELSE eb.LHeadId
          END                             AS supplierId,
          -- Trust the stored net amount, which already has GST AND billing
          -- terms applied at booking time (see applyBillingTermsToAmount).
          -- grn.TotalAmount is GST-inclusive but NEVER includes billing
          -- terms — preferring it here used to silently understate/overstate
          -- the invoice amount for every billing-terms-adjusted booking.
          ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0)) AS amount,
          -- TDS withheld at source (0 when not applicable) — the picker
          -- and payment form both need this to show "what's actually
          -- payable" (amount − TDS) instead of the gross invoice amount.
          ISNULL(eb.TDSAmount, 0)         AS tdsAmount,
          ISNULL(eb.ECompanyId, 0)        AS companyId,
          ISNULL(e.name, '')              AS companyName,
          ISNULL(eb.EFinYear, '')         AS financialYear,
          eb.EEmiPayment                  AS emiEnabled,
          ISNULL(eb.EBillStatus, 'Payment Due') AS billStatus,
          ISNULL(eb.ETotalPaid, 0)        AS totalPaid,
          ISNULL(eb.ERemainingAmount, ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0)))
                                          AS remainingAmount,
          -- No amount baked in here — the frontend already derives the
          -- TDS-net payable figure once from amount/tdsAmount and renders
          -- it itself; duplicating that math into this string invited it
          -- to drift out of sync (as the gross-amount version here did).
          CONCAT(
            ISNULL(eb.EDocNo, CONCAT('Draft #', CAST(eb.Eid AS NVARCHAR))),
            N' — ',
            COALESCE(proj.name, eb.EProjectName, '')
          ) AS label
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.enterprise e ON e.id = eb.ECompanyId
        LEFT JOIN dbo.enterprise proj ON proj.id = TRY_CAST(eb.EProjectName AS INT)
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders po_supp_opt_po
          ON eb.ESourceType IN ('PO','WO_PO') AND po_supp_opt_po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster po_supp_opt ON po_supp_opt.LHeadId = po_supp_opt_po.SupplierID
        LEFT JOIN dbo.WorkDone wd_supp_opt_wd
          ON eb.ESourceType = 'WORK_DONE' AND wd_supp_opt_wd.ID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster wd_supp_opt ON wd_supp_opt.LHeadId = wd_supp_opt_wd.SupplierId
        LEFT JOIN dbo.WorkOrderHeader wo_supp_opt_wo
          ON eb.ESourceType = 'WO' AND wo_supp_opt_wo.Id = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster wo_supp_opt
          ON wo_supp_opt.LHeadId = COALESCE(wo_supp_opt_wo.SupplierId, wo_supp_opt_wo.ContractorId)
        LEFT JOIN dbo.AccountHeadMaster direct_supp_opt ON direct_supp_opt.LHeadId = eb.LHeadId
        LEFT JOIN dbo.AccountHeadMaster party_opt ON party_opt.LHeadId = @PartyId
        WHERE
          (eb.EEmiPayment = 0 OR eb.EEmiPayment IS NULL)
          AND eb.EStatus = 'Approved'
          AND (
            ISNULL(eb.EBillStatus, '') <> 'Paid'
            OR (@IncludeRef IS NOT NULL AND eb.EDocNo = @IncludeRef)
          )
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = eb.Eid AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
          AND (@PartyId IS NULL OR (
            (eb.ESourceType = 'GRN'       AND ahm.LHeadId        = @PartyId)
            OR (eb.ESourceType IN ('PO','WO_PO') AND po_supp_opt.LHeadId = @PartyId)
            OR (eb.ESourceType = 'WORK_DONE'     AND wd_supp_opt.LHeadId = @PartyId)
            OR (eb.ESourceType = 'WO'            AND wo_supp_opt.LHeadId = @PartyId)
            OR eb.LHeadId = @PartyId
            -- Payment-history link: direct/manual invoices (TOD etc.) have no
            -- supplier column, so treat an invoice as belonging to @PartyId when
            -- that party has previously paid against it (OnAccountLedger -> the
            -- payment's PExpenseRef). This is the linkage the On A/C Adjustment
            -- flow relies on.
            OR EXISTS (
              SELECT 1
              FROM dbo.OnAccountLedger oal
              JOIN dbo.NewPayment np_hist ON np_hist.DocNo = oal.RefDocNo
              WHERE oal.PartyId = @PartyId
                AND np_hist.PExpenseRef = eb.EDocNo
            )
            OR EXISTS (
              SELECT 1 FROM dbo.NewPayment np
              WHERE np.PExpenseRef = eb.EDocNo
                AND np.PPartyId    = @PartyId
                AND np.Status      = 'Approved'
            )
          ))
        ORDER BY eb.Eid DESC
      `);

    // EMI installments: only show Pending ones
    const emiResult = await pool
      .request()
      .input("FinYear", sql.NVarChar(20), finYear)
      .input("PartyId", sql.Int, partyId).query(`
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
          -- Supplier name: see bookingsResult above — PO/WO_PO/WORK_DONE
          -- resolve via their own supplier/contractor reference, not EName.
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ESourceId IS NOT NULL THEN ISNULL(ahm2.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType IN ('PO','WO_PO') THEN ISNULL(po_supp_emi.LHeadName, ISNULL(eb.EName, ''))
            WHEN eb.ESourceType = 'WORK_DONE' THEN ISNULL(wd_supp_emi.LHeadName, ISNULL(eb.EName, ''))
            ELSE ISNULL(direct_supp_emi.LHeadName, ISNULL(eb.EName, ''))
          END                          AS supplierName,
          -- Party/supplier LHeadId behind supplierName above — lets the
          -- frontend auto-select the Payee/Party dropdown on invoice pick.
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ESourceId IS NOT NULL THEN ahm2.LHeadId
            WHEN eb.ESourceType IN ('PO','WO_PO') THEN po_supp_emi.LHeadId
            WHEN eb.ESourceType = 'WORK_DONE' THEN wd_supp_emi.LHeadId
            ELSE eb.LHeadId
          END                          AS supplierId,
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
        LEFT JOIN dbo.PurchaseOrders po_supp_emi_po
          ON eb.ESourceType IN ('PO','WO_PO') AND po_supp_emi_po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster po_supp_emi ON po_supp_emi.LHeadId = po_supp_emi_po.SupplierID
        LEFT JOIN dbo.WorkDone wd_supp_emi_wd
          ON eb.ESourceType = 'WORK_DONE' AND wd_supp_emi_wd.ID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster wd_supp_emi ON wd_supp_emi.LHeadId = wd_supp_emi_wd.SupplierId
        LEFT JOIN dbo.AccountHeadMaster direct_supp_emi ON direct_supp_emi.LHeadId = eb.LHeadId
        WHERE
          eb.EEmiPayment = 1
          AND eb.EStatus = 'Approved'
          AND ei.Status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = ei.Id AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
          AND (@PartyId IS NULL OR (
            (eb.ESourceType = 'GRN' AND ahm2.LHeadId = @PartyId)
            OR (eb.ESourceType IN ('PO','WO_PO') AND po_supp_emi.LHeadId = @PartyId)
            OR (eb.ESourceType = 'WORK_DONE' AND wd_supp_emi.LHeadId = @PartyId)
            OR EXISTS (
              SELECT 1
              FROM dbo.OnAccountLedger oal
              JOIN dbo.NewPayment np_hist ON np_hist.DocNo = oal.RefDocNo
              WHERE oal.PartyId = @PartyId
                AND np_hist.PExpenseRef = eb.EDocNo
            )
          ))
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
      partyId: r.supplierId || null,
      amount: parseFloat(r.amount) || 0,
      tdsAmount: parseFloat(r.tdsAmount) || 0,
      totalPaid: parseFloat(r.totalPaid) || 0,
      remainingAmount: parseFloat(r.remainingAmount) || 0,
      billStatus: r.billStatus || "",
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
      partyId: r.supplierId || null,
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
});

// Cached flag — avoid sys.columns hit on every request
let _ebHasPaymentTermId = null;
async function ebHasPaymentTermId(pool) {
  if (_ebHasPaymentTermId !== null) return _ebHasPaymentTermId;
  const r = await pool.request()
    .input("T", sql.NVarChar(128), "ExpenseBooking")
    .input("C", sql.NVarChar(128), "PaymentTermId")
    .query("SELECT 1 AS f FROM sys.columns WHERE object_id=OBJECT_ID(@T) AND name=@C");
  _ebHasPaymentTermId = !!r.recordset[0];
  return _ebHasPaymentTermId;
}

// Cached flag for EDirectItemsData column (added in migration for direct-expense line items)
let _ebHasDirectItemsData = null;
async function ebHasDirectItemsData(pool) {
  if (_ebHasDirectItemsData !== null) return _ebHasDirectItemsData;
  const r = await pool.request()
    .input("T", sql.NVarChar(128), "ExpenseBooking")
    .input("C", sql.NVarChar(128), "EDirectItemsData")
    .query("SELECT 1 AS f FROM sys.columns WHERE object_id=OBJECT_ID(@T) AND name=@C");
  _ebHasDirectItemsData = !!r.recordset[0];
  return _ebHasDirectItemsData;
}

// ─── GET all (paginated) ──────────────────────────────────────────────────────
router.get("/", cache("expense-booking", 60), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    // List-view filters — Fin Year and a Document Date range. Status counts
    // (below) intentionally stay unfiltered (global) since they feed the
    // top status chips, not the table.
    const finYear = (req.query.finYear || "").toString().trim() || null;
    const dateFrom = (req.query.from || "").toString().trim() || null;
    const dateTo = (req.query.to || "").toString().trim() || null;
    const companyId = req.query.companyId
      ? parseInt(req.query.companyId, 10) || null
      : null;
    const projectName = (req.query.projectName || "").toString().trim() || null;
    const docNo = (req.query.docNo || "").toString().trim() || null;
    const supplierId = req.query.supplierId ? parseInt(req.query.supplierId, 10) : null;

    const hasPaymentTermId = await ebHasPaymentTermId(pool);
    const hasDirectItemsCol = await ebHasDirectItemsData(pool);
    const ebSupplierList = expenseBookingSupplierSql("eb", "lsup");

    // Run status counts and paginated list in parallel
    const [countResult, result] = await Promise.all([
      pool.request().query(`
        SELECT
          eb.EStatus,
          COUNT(*) AS cnt,
          SUM(ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0))) AS totalAmount
        FROM dbo.ExpenseBooking eb
        WHERE ISNULL(eb.EStatus, '') != 'Draft'
          AND ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'
        GROUP BY eb.EStatus
      `),
      pool
        .request()
        .input("offset", sql.Int, offset)
        .input("limit", sql.Int, limit)
        .input("FinYear", sql.NVarChar(20), finYear)
        .input("DateFrom", sql.Date, dateFrom)
        .input("DateTo", sql.Date, dateTo)
        .input("CompanyId", sql.Int, companyId)
        .input("ProjectName", sql.NVarChar(255), projectName)
        .input("DocNo", sql.NVarChar(100), docNo ? `%${docNo}%` : null)
        .input("SupplierId", sql.Int, supplierId).query(`
        SELECT
          eb.Eid, eb.Eid AS id,
          eb.EProjectName, eb.EDocumentType, eb.EDocDate,
          eb.EAmount, eb.ENetAmount, eb.ECgstRate, eb.ESgstRate,
          eb.EIgstRate, eb.EPaymentType, eb.EPartialAmount,
          eb.EDocNo, eb.EEmiPayment, eb.EInstallmentCount, eb.EEmiAmount,
          eb.EEmiStartDate, eb.EReminder, eb.ERemarks, eb.EStatus,
          eb.ECreatedAt, eb.EUpdatedAt, eb.ECompanyId, eb.EDocTypeId,
          eb.EFinYear, eb.ECreatedBy, eb.ESourceType, eb.ESourceId,
          eb.ELinkedGrnIds,
          eb.EName, eb.EBillingTermsData, eb.EDiscountData, eb.EEmiData,
          eb.EBillingTermId, eb.EBillingTermName,
          eb.ETCId, eb.ETCName, eb.ETCText,
          eb.EVendorInvoiceNo, eb.EVendorInvoiceDate,
          eb.EAdditionalCharges, eb.ECostCenter, eb.EGLAccount, eb.EGLAccountId, eb.EWorkDoneRef,
          eb.TDSId, eb.TDSNature, eb.TDSName, eb.TDSPercentage, eb.TDSAmount,
          gl.LHeadName AS EGLAccountName, gl.LHeadCode AS EGLAccountCode,
          glGroup.Name AS EGLAccountGroupName, glParentGroup.Name AS EGLAccountParentGroupName,
          ${hasPaymentTermId ? "eb.PaymentTermId," : "CAST(NULL AS INT) AS PaymentTermId,"}
          ${hasDirectItemsCol ? "eb.EDirectItemsData," : "CAST(NULL AS NVARCHAR(MAX)) AS EDirectItemsData,"}
          eb.EBillStatus, eb.ETotalPaid, eb.ERemainingAmount,
          -- Sum of On Account adjustments applied to this invoice (see
          -- routes/onAccount.js's POST /apply-adjustment) — already folded
          -- into ETotalPaid, this exposes just the OA-sourced portion so the
          -- list can badge "Adjusted" distinctly from a real cash payment.
          ISNULL(oaAdj.AdjustedAmount, 0) AS EOnAccountAdjusted,
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
            WHEN eb.ESourceType IN ('PO','WO_PO') AND po_direct.DocNo IS NOT NULL THEN po_direct.DocNo
            WHEN eb.ESourceType = 'WORK_DONE' AND wd_direct.DocNo IS NOT NULL THEN wd_direct.DocNo
            ELSE NULL
          END AS sourceDocNo,
          -- For GRN rows: also expose the parent PO DocNo so the Doc column
          -- can show both PO and GRN without a second API call.
          CASE
            WHEN eb.ESourceType = 'GRN' AND po_list.DocNo IS NOT NULL THEN po_list.DocNo
            ELSE NULL
          END AS linkedPODocNo,
          -- Supplier name/id: resolved via the shared expenseBookingSupplierSql
          -- helper (GRN/PO/WO_PO/WORK_DONE/WO -> source doc's supplier;
          -- direct/manual bookings -> eb.LHeadId). EName is only ever the
          -- last-resort fallback baked into the helper's expression — never
          -- the supplier itself.
          ${ebSupplierList.nameExpr} AS ESupplierName,
          ${ebSupplierList.idExpr} AS ESupplierId,
          ${ebSupplierList.gstRegisteredExpr} AS ESupplierGstRegistered,
          -- Live GRN total (incl GST) for GRN-linked bookings; NULL otherwise.
          -- Frontend uses this as the authoritative Net Amt for GRN rows.
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ELinkedGrnIds IS NULL AND grn_list.TotalAmount IS NOT NULL AND grn_list.TotalAmount > 0
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
        LEFT JOIN dbo.PurchaseOrders po_list ON grn_list.POID = po_list.PurchaseOrderID
        LEFT JOIN dbo.enterprise epo_proj ON epo_proj.id = po_list.ProjectId
        -- Direct PO / WO_PO source link
        LEFT JOIN dbo.PurchaseOrders po_direct
          ON eb.ESourceType IN ('PO','WO_PO') AND po_direct.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
        -- Direct Work Done source link
        LEFT JOIN dbo.WorkDone wd_direct
          ON eb.ESourceType = 'WORK_DONE' AND wd_direct.ID = TRY_CAST(eb.ESourceId AS INT)
        -- GL Account chosen on the booking (General Ledger master) — pulled
        -- in with its immediate group + parent group so the list/preview can
        -- show the nested chart-of-accounts path without a second call.
        LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = eb.EGLAccountId
        LEFT JOIN dbo.AccountGroup glGroup ON glGroup.AGId = gl.LBelongsTo
        LEFT JOIN dbo.AccountGroup glParentGroup ON glParentGroup.AGId = glGroup.ParentGroupId
        LEFT JOIN (
          SELECT RefDocNo, SUM(Amount) AS AdjustedAmount
          FROM dbo.OnAccountLedger
          WHERE TxnType = 'DEBIT' AND RefType = 'Invoice'
          GROUP BY RefDocNo
        ) oaAdj ON oaAdj.RefDocNo = eb.EDocNo
        ${ebSupplierList.joins}
        WHERE ISNULL(eb.EStatus, '') != 'Draft'
          AND ISNULL(eb.ERemarks, '') NOT LIKE 'Auto-created for remaining items from GRN%'
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
          AND (@DateFrom IS NULL OR eb.EDocDate >= @DateFrom)
          AND (@DateTo IS NULL OR eb.EDocDate <= @DateTo)
          AND (@CompanyId IS NULL OR eb.ECompanyId = @CompanyId)
          -- EProjectName is a misnomer — it stores the enterprise ID as text,
          -- not the name (see ExpenseBooking/helpers.ts). The frontend filter
          -- sends the project's actual name, so this has to match against the
          -- already-joined ep.name, not the raw id column.
          AND (@ProjectName IS NULL OR ep.name = @ProjectName)
          AND (@DocNo IS NULL OR eb.EDocNo LIKE @DocNo)
          AND (@SupplierId IS NULL OR (${ebSupplierList.idExpr}) = @SupplierId)
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

    // Direct/DINV bookings record their Expense Head(s) via the multi-head
    // ExpenseHeadAllocation table (migration 303), not the legacy single
    // EGLAccountId column — this list route never attached that data before,
    // so every row's "Expense Head" always came back empty even for bookings
    // that do have one. Batch-fetched (one query for the whole page) rather
    // than per-row to avoid an N+1.
    const allocMap = await getAllocationsForMany(pool, sql, "ExpenseBooking", rows.map((r) => r.Eid));
    const rowsWithExpenseHead = rows.map((r) => ({
      ...r,
      EExpenseHeadNames: (allocMap.get(r.Eid) || []).map((a) => a.lHeadName).join(", ") || null,
    }));

    res.json({
      data: rowsWithExpenseHead.map(({ _total, ...r }) => r),
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
      // One-and-done: any non-Deleted booking (including Draft — e.g. one whose
      // auto-submit-to-Pending transition failed) still counts as "invoiced"
      // and must keep the source document out of the picker. Only a hard
      // delete of the booking reopens the source.
      const result = await pool.request().query(`
        SELECT ESourceType, ESourceId, Eid, ELinkedGrnIds
        FROM dbo.ExpenseBooking
        WHERE EStatus != 'Deleted'
          AND ESourceType IS NOT NULL
          AND ESourceId   IS NOT NULL

      `);
      // Multi-GRN combined invoices only store the primary GRN as
      // ESourceId — expand ELinkedGrnIds so every GRN that went into the
      // combine (not just the first) gets excluded from future pickers.
      const rows = result.recordset.flatMap((r) => {
        if (r.ESourceType !== "GRN" || !r.ELinkedGrnIds) return [r];
        try {
          const ids = JSON.parse(r.ELinkedGrnIds);
          if (Array.isArray(ids) && ids.length > 0) {
            return ids.map((id) => ({
              ESourceType: "GRN",
              ESourceId: id,
              Eid: r.Eid,
            }));
          }
        } catch {
          /* fall through to the single row below */
        }
        return [r];
      });
      res.json(rows);
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

// ─── GET /tds-eligibility — live TDS gating for the invoice form ─────────────
// Called as the user fills in supplier + company + amount, before the
// booking is ever saved, purely to decide whether to show the TDS dropdown
// and what the running cumulative figure is. Read-only — never persists
// anything or requires a TDSId.
router.get("/tds-eligibility", async (req, res) => {
  const supplierId = parseInt(req.query.supplierId, 10);
  const companyId = parseInt(req.query.companyId, 10);
  const amount = parseFloat(req.query.amount) || 0;
  const date = req.query.date ? String(req.query.date) : null;
  if (!supplierId || !companyId) {
    return res.status(400).json({ error: "supplierId and companyId are required" });
  }
  try {
    const pool = getPool();
    const { resolveFinYearId, resolveThresholdStatus, SINGLE_BILL_THRESHOLD, YEARLY_CUMULATIVE_THRESHOLD } = require("../services/tds");

    const supRes = await pool.request().input("Id", sql.Int, supplierId)
      .query("SELECT IsTdsApplicable, ISNULL(TdsLimitApplicable, 1) AS TdsLimitApplicable FROM dbo.AccountHeadMaster WHERE LHeadId = @Id");
    const tdsApplicable = !!supRes.recordset[0]?.IsTdsApplicable;
    const tdsLimitApplicable = !!supRes.recordset[0]?.TdsLimitApplicable;

    if (!tdsApplicable) {
      return res.json({ tdsApplicable: false, thresholdMet: false, cumulativeAmount: 0, singleBillThreshold: SINGLE_BILL_THRESHOLD, yearlyThreshold: YEARLY_CUMULATIVE_THRESHOLD });
    }

    const finYearId = await resolveFinYearId(pool, sql, date || new Date());
    const { thresholdMet, cumulativeAmount } = await resolveThresholdStatus(pool, sql, {
      tdsLimitApplicable, billAmount: amount, partyHeadId: supplierId, companyId, finYearId,
    });

    res.json({ tdsApplicable: true, thresholdMet, cumulativeAmount, singleBillThreshold: SINGLE_BILL_THRESHOLD, yearlyThreshold: YEARLY_CUMULATIVE_THRESHOLD });
  } catch (err) {
    console.error("TDS eligibility error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
          AND ISNULL(eb.EStatus, '') <> 'Deleted'
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

    // ── 0. EMI guard ──────────────────────────────────────────────────────────
    // EMI-enabled bookings cannot be deleted at all — deleting one would both
    // orphan its EmiInstallments schedule and silently reopen the source
    // document (GRN/PO/Work Done) for re-invoicing, breaking one-and-done.
    const emiCheck = await pool.request().input("Eid", sql.Int, id).query(`
      SELECT EEmiPayment FROM dbo.ExpenseBooking WHERE Eid = @Eid
    `);
    if (emiCheck.recordset[0]?.EEmiPayment) {
      return res.json({
        deletable: false,
        reason:
          "This is an EMI booking and cannot be deleted. EMI entries are permanent once created.",
      });
    }

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

// ─── GET /emi-reminders — all pending EMI installments (for reminder bell) ────
router.get("/emi-reminders", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        ei.Id              AS id,
        ei.ExpenseBookingId AS expenseBookingId,
        ei.InstallmentNo   AS installmentNo,
        ei.RefNumber       AS refNumber,
        ei.DueDate         AS dueDate,
        ei.Amount          AS amount,
        ei.Status          AS status,
        eb.EDocNo          AS parentDocNo,
        COALESCE(proj.name, eb.EProjectName, '') AS projectName,
        ISNULL(eb.EName, '') AS partyName,
        eb.EInstallmentCount AS totalInstallments
      FROM dbo.EmiInstallments ei
      INNER JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
      LEFT JOIN dbo.enterprise proj ON proj.id = TRY_CAST(eb.EProjectName AS INT)
      WHERE ei.Status = 'Pending'
        AND eb.EStatus = 'Approved'
        AND eb.EEmiPayment = 1
      ORDER BY ei.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("EMI reminders error:", err);
    res.status(500).json({ error: "Failed to fetch EMI reminders" });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const ebSupplierDet = expenseBookingSupplierSql("eb", "dsup");
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
               -- Supplier name/id: resolved via the shared expenseBookingSupplierSql
               -- helper (GRN/PO/WO_PO/WORK_DONE/WO -> source doc's supplier;
               -- direct/manual bookings -> eb.LHeadId). EName is only ever the
               -- last-resort fallback baked into the helper's expression.
               ${ebSupplierDet.nameExpr} AS ESupplierName,
               ${ebSupplierDet.idExpr} AS ESupplierId,
               ${ebSupplierDet.gstRegisteredExpr} AS ESupplierGstRegistered,
               -- Live GRN total (incl. GST) so detail modal always shows current value
               CASE
                 WHEN eb.ESourceType = 'GRN' AND eb.ELinkedGrnIds IS NULL AND grn_det.TotalAmount IS NOT NULL AND grn_det.TotalAmount > 0
                 THEN grn_det.TotalAmount
                 ELSE NULL
               END AS EGrnTotalAmount,
               -- Pass through source info needed for fallback computation
               eb.ESourceType AS _ESourceType,
               eb.ESourceId   AS _ESourceId,
               -- GL Account chosen on the booking (General Ledger master) —
               -- immediate group id is included so the frontend can walk the
               -- full parent chain (arbitrary depth) via /api/account-group.
               gl.LHeadName AS EGLAccountName,
               gl.LHeadCode AS EGLAccountCode,
               gl.LBelongsTo AS EGLAccountGroupId
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
          ON eb.ESourceType IN ('PO','WO_PO') AND po_direct.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.enterprise epo_direct ON epo_direct.id = po_direct.ProjectId
        LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = eb.EGLAccountId
        ${ebSupplierDet.joins}
        WHERE eb.Eid = @Eid
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });

    // Destructure to separate the internal _ESourceType/_ESourceId aliases
    // from the rest. mssql recordset rows can be non-configurable so we must
    // not mutate them in-place (delete/assignment throws in strict contexts).
    const { _ESourceType, _ESourceId, ...row } = result.recordset[0];

    // Multi-GRN combined invoices (see backend/services/invoiceLinking.js)
    // have no single source GRN to recompute a "live" total from — ESourceId
    // is only the primary/first of several linked GRNs. Recomputing from it
    // alone previously overwrote the correct combined ENetAmount with just
    // that one GRN's total, silently understating the invoice. For these,
    // always trust the stored ENetAmount (already correctly summed across
    // every linked GRN at booking time) and skip the live recompute below.
    const isMultiGRN = !!row.ELinkedGrnIds;

    // If EGrnTotalAmount is NULL (grn.TotalAmount not populated for older records),
    // compute the authoritative total from buildGrnGstData (item qty x PO rate + GST).
    let EGrnTotalAmount = row.EGrnTotalAmount ?? null;
    if (!EGrnTotalAmount && !isMultiGRN && _ESourceType === "GRN" && _ESourceId) {
      try {
        const grnId = parseInt(String(_ESourceId), 10);
        if (Number.isFinite(grnId) && grnId > 0) {
          const grnData = await buildGrnGstData(pool, grnId);
          if (grnData && grnData.totals.netAmount > 0) {
            EGrnTotalAmount = grnData.totals.netAmount;
          }
        }
      } catch {
        /* non-fatal: frontend will fall back to standard breakdown */
      }
    }

    // For GRN-linked bookings, recompute ENetAmount live from the GRN total + billing terms.
    // The stored ENetAmount may be stale if the GRN was amended after the booking was created.
    let liveENetAmount = row.ENetAmount;
    if (
      !isMultiGRN &&
      _ESourceType === "GRN" &&
      EGrnTotalAmount != null &&
      parseFloat(EGrnTotalAmount) > 0
    ) {
      liveENetAmount = applyBillingTermsToAmount(
        parseFloat(EGrnTotalAmount),
        parseFloat(row.EAmount ?? 0),
        parseFloat(row.ECgstRate ?? 0),
        parseFloat(row.ESgstRate ?? 0),
        row.EBillingTermsData,
        row.EDiscountData,
      );
    }

    const expenseHeadAllocations = await getAllocations(pool, sql, "ExpenseBooking", id);

    res.json({ ...row, EGrnTotalAmount, ENetAmount: liveENetAmount, EExpenseHeadAllocations: expenseHeadAllocations });
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
// ─── Internal creation function (GRN-sourced bookings only) ──────────────────
// Extracted/scoped from POST / so other server-side callers (the
// Inter-Company Stock Transfer orchestrator) can create a real, fully-
// validated GRN-sourced Expense Booking in-process without duplicating this
// validation/numbering/insert logic or making an HTTP self-call. Unlike the
// other internal-function extractions this session, this one is
// deliberately narrower than the full POST / handler: that handler also
// branches on PO/WO_PO/WORK_DONE/standalone sources and EMI scheduling,
// none of which the orchestrator ever needs (it always books against a
// GRN). Reproduces the GRN branch and shared insert/doc-numbering logic
// verbatim; the general POST / route is unchanged and still handles every
// source type. Thrown errors carry a `.status` for the HTTP code to use.
async function createExpenseBookingInternal(pool, payload, userEmail, userId) {
  const {
    EName,
    EProjectName,
    EDocumentType,
    EDocDate,
    EDiscountData,
    EDocNo,
    ERemarks,
    EStatus = "Draft",
    ECompanyId,
    EDocTypeId,
    EFinYear,
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
    EGLAccountId,
    PaymentTermId,
  } = payload;
  const ESourceType = "GRN";
  const EEmiPayment = false;
  const EEmiData = null;
  const EInstallmentCount = null;
  const EEmiAmount = null;
  const EEmiStartDate = null;
  const EReminder = null;
  const EWorkDoneRef = null;

  if (!EDocumentType) {
    const err = new Error("EDocumentType is required.");
    err.status = 400;
    throw err;
  }
  if (!EDocDate) {
    const err = new Error("EDocDate is required.");
    err.status = 400;
    throw err;
  }
  if (!ECompanyId) {
    const err = new Error("ECompanyId is required.");
    err.status = 400;
    throw err;
  }

  const hasPayTermCol = await ebHasPaymentTermId(pool);
  const hasDirectItemsCol = await ebHasDirectItemsData(pool);
  const transaction = pool.transaction();

  let finalDocNo = EDocNo || null;
  let bookingAmount;
  let bookingNetAmount;
  let bookingCgstRate;
  let bookingSgstRate;

  try {
    await transaction.begin();

    {
      const grnId = parseInt(ESourceId, 10);
      if (!Number.isFinite(grnId) || grnId <= 0) {
        const err = new Error("GRN source is required.");
        err.status = 400;
        throw err;
      }

      const grnGst = await buildGrnGstData(pool, grnId);
      if (!grnGst) {
        const err = new Error("Linked GRN not found.");
        err.status = 404;
        throw err;
      }

      // Enforce: an expense can only be booked against an Approved GRN.
      const grnStatusResult = await transaction
        .request()
        .input("GRNID", sql.Int, grnId)
        .query("SELECT Status FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID");
      const grnStatus = grnStatusResult.recordset[0]?.Status;
      if (grnStatus !== "Approved") {
        const err = new Error(
          `Cannot book expense: GRN is "${grnStatus}". Only Approved GRNs can be used for expense booking.`,
        );
        err.status = 400;
        throw err;
      }

      // Enforce: only one active expense booking per GRN, ever — one-and-done.
      // If the previous booking was deleted (hard-deleted), no row remains, so
      // this check passes and a fresh booking is allowed. A Draft booking
      // (e.g. one whose auto-submit-to-Pending transition failed) still
      // counts — it must be deleted, not silently bypassed, before rebooking.
      const dupCheck = await transaction
        .request()
        .input("DupGRNId", sql.Int, grnId).query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.ExpenseBooking
          WHERE ESourceType = 'GRN'
            AND ESourceId = @DupGRNId
            AND ISNULL(EStatus, '') <> 'Deleted'
        `);
      if (Number(dupCheck.recordset[0]?.cnt) > 0) {
        const err = new Error(
          "An expense booking already exists for this GRN. Delete the existing booking before creating a new one.",
        );
        err.status = 409;
        throw err;
      }

      if (!grnGst.totals.receivedQty || grnGst.totals.receivedQty <= 0) {
        const err = new Error(
          "Cannot book expense for a GRN with no received quantity.",
        );
        err.status = 400;
        throw err;
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
        const err = new Error("Selected document type not found or inactive.");
        err.status = 400;
        throw err;
      }

      const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
      const prefix = rawPrefix.replace(/\d+$/, "");
      const startFrom = typeRow.StartingDocNo ?? 1;

      // Scope the MAX-sequence lookup to this specific fin year — each fin
      // year gets its own counter starting back at startFrom (e.g. "01"),
      // instead of numbering continuing across fin-year boundaries. The
      // fin year is always the DocNo's trailing "/<finYear>" suffix, so
      // matching on that suffix needs no schema change. Doc types with no
      // fin year at all keep the old global-count behaviour.
      const scopedPrefixPattern = finYear ? `${prefix}%/${finYear}` : `${prefix}%`;

      // The serial is extracted as "however many digits immediately follow
      // the prefix", NOT a fixed-width substring — a fixed length (the old
      // SUBSTRING(..., 6) here) silently drops any row whose actual digit
      // count differs (e.g. a 5-digit number grabs a trailing "/" and
      // TRY_CAST returns NULL), which understates the true max and can
      // reset the sequence back to the starting number. PATINDEX finds the
      // first non-digit character (the appended "/" sentinel guarantees a
      // match even with no suffix) so this works for any padding width.
      const maxResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("PrefixLen", sql.Int, prefix.length)
        .input("Prefix", sql.NVarChar(100), scopedPrefixPattern).query(`
          SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
          FROM dbo.DocNumberSequence WITH (UPDLOCK, HOLDLOCK)
          CROSS APPLY (SELECT SUBSTRING(DocNo, @PrefixLen + 1, 30) AS afterPrefix) a
          CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
        `);

      // Also check ExpenseBooking, scoped to the same fin year
      const ebMaxResult = await transaction
        .request()
        .input("EDocTypeId2", sql.Int, typeId)
        .input("Prefix2Len", sql.Int, prefix.length)
        .input("Prefix2", sql.NVarChar(100), scopedPrefixPattern).query(`
          SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
          FROM dbo.ExpenseBooking WITH (UPDLOCK, HOLDLOCK)
          CROSS APPLY (SELECT SUBSTRING(EDocNo, @Prefix2Len + 1, 30) AS afterPrefix) a
          CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
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
      //   (a) Row doesn't exist          → INSERT fresh, done.
      //   (b) Row exists, RecordId NULL  → reserved by a previous failed attempt;
      //                                    claim it by updating IssuedBy, done.
      //   (c) Row exists, RecordId set   → already committed; bump seq and retry.
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
          await transaction
            .request()
            .input("TypeOfDocId", sql.Int, typeId)
            .input("DocNo", sql.NVarChar(100), finalDocNo)
            .input("TableName", sql.NVarChar(100), "ExpenseBooking")
            .input("IssuedBy", sql.NVarChar(200), userEmail || null)
            .query(`
              INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
              VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
            `);
          reserved = true;
        } else if (!existingSeq.recordset[0]?.RecordId) {
          await transaction
            .request()
            .input("DocNoCheck", sql.NVarChar(100), finalDocNo)
            .input("IssuedBy", sql.NVarChar(200), userEmail || null)
            .query(`
              UPDATE dbo.DocNumberSequence
              SET IssuedBy = @IssuedBy
              WHERE DocNo = @DocNoCheck AND RecordId IS NULL
            `);
          reserved = true;
        } else {
          seqCandidate++;
        }
      }

      if (!reserved) {
        const err = new Error(
          "Could not reserve a document number after multiple attempts.",
        );
        err.status = 500;
        throw err;
      }
    }

    // The doc-number reservation loop above INSERTed/claimed its row in
    // DocNumberSequence keyed by the un-prefixed value — keep that exact
    // string for the RecordId back-patch below. Prepending "ExB/" onto
    // `finalDocNo` for display/storage on ExpenseBooking.EDocNo used to
    // also change what the back-patch searched for, so the UPDATE never
    // matched any row, RecordId stayed NULL forever, and every subsequent
    // booking's reservation loop treated the row as an abandoned ghost
    // reservation and reclaimed the SAME number instead of incrementing.
    const reservedDocNo = finalDocNo;

    // Prepend ExB/ prefix to every expense booking doc number
    if (finalDocNo && !finalDocNo.startsWith("ExB/")) {
      finalDocNo = `ExB/${finalDocNo}`;
    }

    const insertReq = transaction
      .request()
      .input("EName", sql.NVarChar(200), EName || null)
      .input("EProjectName", sql.NVarChar(150), EProjectName || null)
      .input("EDocumentType", sql.NVarChar(50), EDocumentType)
      .input("EDocDate", sql.Date, EDocDate)
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
      .input("ECreatedBy", sql.Int, userId || null)
      .input("EApprovedBy", sql.Int, null)
      .input("ECompanyId", sql.Int, parseInt(ECompanyId, 10))
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
      .input("EGLAccountId", sql.Int, EGLAccountId ? parseInt(EGLAccountId, 10) : null)
      .input("EWorkDoneRef", sql.NVarChar(100), EWorkDoneRef || null);

    if (hasPayTermCol) insertReq.input("PaymentTermId", sql.Int, PaymentTermId ? parseInt(PaymentTermId, 10) : null);
    if (hasDirectItemsCol) insertReq.input("EDirectItemsData", sql.NVarChar(sql.MAX), null);

    const insertResult = await insertReq.query(`
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
          ECostCenter, EGLAccount, EGLAccountId, EWorkDoneRef
          ${hasPayTermCol ? ", PaymentTermId" : ""}
          ${hasDirectItemsCol ? ", EDirectItemsData" : ""}
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
          @ECostCenter, @EGLAccount, @EGLAccountId, @EWorkDoneRef
          ${hasPayTermCol ? ", @PaymentTermId" : ""}
          ${hasDirectItemsCol ? ", @EDirectItemsData" : ""}
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    const newExpenseId = insertResult.recordset[0]?.NewId;

    if (reservedDocNo && newExpenseId) {
      await transaction
        .request()
        .input("DocNo", sql.NVarChar(100), reservedDocNo)
        .input("RecordId", sql.Int, parseInt(newExpenseId, 10)).query(`
          UPDATE dbo.DocNumberSequence
          SET RecordId = @RecordId
          WHERE DocNo = @DocNo AND TableName = 'ExpenseBooking'
        `);
    }

    await transaction.commit();

    return { id: newExpenseId, docNo: finalDocNo };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (rbErr) {
      console.error("Transaction rollback failed:", rbErr.message);
    }
    throw err;
  }
}

router.post("/", requirePageRight("expense-booking", "create"), validateBody(expenseBookingBodySchema), async (req, res) => {
  const {
    EName,
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount: EAmountBody,
    ENetAmount: ENetAmountBody,
    ECgstRate: ECgstRateBody,
    ESgstRate: ESgstRateBody,
    EIgstRate: EIgstRateBody,
    EPaymentType,
    EPartialAmount,
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
    // Multiple GRNs raised against the same PO, combined into one
    // total-amount invoice — see backend/services/invoiceLinking.js.
    // Undefined/empty/single-element means "book against ESourceId as
    // usual", exactly like before this existed.
    linkedGrnIds,
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
    EGLAccountId,
    EWorkDoneRef,
    PaymentTermId,
    EDirectItemsData,
    // Contract Master (Migration 177) — see services/contractLedger.js
    ContractId,
    LHeadId,
    EExpenseHeadAllocations,
    TDSId,
  } = req.body;

  // EDocumentType, EDocDate and ECompanyId are NOT NULL columns with no
  // fallback default in the INSERT below — omitting any of them used to
  // reach the database and crash with a raw, unhandled SQL "Cannot insert
  // the value NULL" 500 (leaking internal table/column names) instead of a
  // clean validation error. Caught live: creating a booking without one of
  // them 500'd instead of 400'ing. EProjectName itself is no longer in
  // this list — the column was widened to nullable (migration 347) since
  // a project isn't always known at booking time.
  if (!EDocumentType) {
    return res.status(400).json({ error: "EDocumentType is required." });
  }
  if (!EDocDate) {
    return res.status(400).json({ error: "EDocDate is required." });
  }
  if (!ECompanyId) {
    return res.status(400).json({ error: "ECompanyId is required." });
  }

  const pool = getPool();
  const hasPayTermCol = await ebHasPaymentTermId(pool);
  const hasDirectItemsCol = await ebHasDirectItemsData(pool);
  const transaction = pool.transaction();

  let finalDocNo = EDocNo || null;
  let bookingAmount;
  let bookingNetAmount;
  let bookingCgstRate;
  let bookingSgstRate;
  let bookingIgstRate;
  let resolvedSourceId = ESourceId;
  const grnIdsToLink = Array.isArray(linkedGrnIds)
    ? linkedGrnIds
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    : [];

  try {
    await transaction.begin();

    if (ESourceType === "GRN" && grnIdsToLink.length > 1) {
      // ── Multi-GRN combined invoice ──────────────────────────────────────
      // Several GRNs raised against the same PO, booked as one invoice.
      // Validation (same PO, all Approved, none already booked) lives in
      // computeMultiGRNInvoice; amounts still come from the client (which
      // computed them from the same aggregate via the frontend's sibling
      // logic), matching how PO/WORK_DONE-sourced bookings already trust
      // EAmountBody — bookingAmount stays unset here so it falls through
      // to buildDirectExpenseBooking below.
      let agg;
      try {
        agg = await computeMultiGRNInvoice(transaction, grnIdsToLink);
      } catch (err) {
        await transaction.rollback();
        return res.status(err.status || 400).json({ error: err.message });
      }
      resolvedSourceId = agg.primaryGrnId;
    } else if (ESourceType === "GRN") {
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

      // Enforce: an expense can only be booked against an Approved GRN.
      const grnStatusResult = await transaction
        .request()
        .input("GRNID", sql.Int, grnId)
        .query("SELECT Status FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID");
      const grnStatus = grnStatusResult.recordset[0]?.Status;
      if (grnStatus !== "Approved") {
        await transaction.rollback();
        return res.status(400).json({
          error: `Cannot book expense: GRN is "${grnStatus}". Only Approved GRNs can be used for expense booking.`,
        });
      }

      // Enforce: only one active expense booking per GRN, ever — one-and-done.
      // If the previous booking was deleted (hard-deleted), no row remains, so
      // this check passes and a fresh booking is allowed. A Draft booking
      // (e.g. one whose auto-submit-to-Pending transition failed) still
      // counts — it must be deleted, not silently bypassed, before rebooking.
      const dupCheck = await transaction
        .request()
        .input("DupGRNId", sql.Int, grnId).query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.ExpenseBooking
          WHERE ESourceType = 'GRN'
            AND ESourceId = @DupGRNId
            AND ISNULL(EStatus, '') <> 'Deleted'
        `);
      if (Number(dupCheck.recordset[0]?.cnt) > 0) {
        await transaction.rollback();
        return res.status(409).json({
          error:
            "An expense booking already exists for this GRN. Delete the existing booking before creating a new one.",
        });
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
      bookingIgstRate = 0;
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

    if (ESourceType === "PO" || ESourceType === "WO_PO") {
      const poId = parseInt(ESourceId, 10);
      if (!Number.isFinite(poId) || poId <= 0) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ error: "Purchase Order source is required." });
      }

      // Enforce: an expense can only be booked against an Approved
      // (or already partially-fulfilled / Received) Purchase Order.
      const poStatusResult = await transaction
        .request()
        .input("POID", sql.Int, poId)
        .query(
          "SELECT Status FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID",
        );
      const poStatus = poStatusResult.recordset[0]?.Status;
      if (!poStatus) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ error: "Linked Purchase Order not found." });
      }
      if (poStatus !== "Approved" && poStatus !== "Received") {
        await transaction.rollback();
        return res.status(400).json({
          error: `Cannot book expense: Purchase Order is "${poStatus}". Only Approved Purchase Orders can be used for expense booking.`,
        });
      }

      // Enforce: only one active expense booking per PO, ever — one-and-done.
      const poDupCheck = await transaction
        .request()
        .input("DupPOId", sql.Int, poId)
        .input("DupPOSourceType", sql.NVarChar(20), ESourceType).query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.ExpenseBooking
          WHERE ESourceType = @DupPOSourceType
            AND ESourceId = @DupPOId
            AND ISNULL(EStatus, '') <> 'Deleted'
        `);
      if (Number(poDupCheck.recordset[0]?.cnt) > 0) {
        await transaction.rollback();
        return res.status(409).json({
          error:
            "An expense booking already exists for this Purchase Order. Delete the existing booking before creating a new one.",
        });
      }
    }

    if (ESourceType === "WORK_DONE") {
      const workDoneId = parseInt(ESourceId, 10);
      if (!Number.isFinite(workDoneId) || workDoneId <= 0) {
        await transaction.rollback();
        return res.status(400).json({ error: "Work Done source is required." });
      }

      // Enforce: an expense can only be booked against an Approved
      // Work Done certificate.
      const wdStatusResult = await transaction
        .request()
        .input("WDID", sql.BigInt, workDoneId)
        .query("SELECT Status FROM dbo.WorkDone WHERE ID = @WDID");
      const wdStatus = wdStatusResult.recordset[0]?.Status;
      if (!wdStatus) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ error: "Linked Work Done entry not found." });
      }
      if (wdStatus !== "Approved") {
        await transaction.rollback();
        return res.status(400).json({
          error: `Cannot book expense: Work Done is "${wdStatus}". Only Approved Work Done entries can be used for expense booking.`,
        });
      }

      // Enforce: only one active expense booking per Work Done entry, ever — one-and-done.
      const wdDupCheck = await transaction
        .request()
        .input("DupWDId", sql.BigInt, workDoneId).query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.ExpenseBooking
          WHERE ESourceType = 'WORK_DONE'
            AND ESourceId = @DupWDId
            AND ISNULL(EStatus, '') <> 'Deleted'
        `);
      if (Number(wdDupCheck.recordset[0]?.cnt) > 0) {
        await transaction.rollback();
        return res.status(409).json({
          error:
            "An expense booking already exists for this Work Done entry. Delete the existing booking before creating a new one.",
        });
      }
    }

    // For direct invoices (TOD or no linked source), amounts and the
    // supplier link come from the request body — see buildDirectExpenseBooking.
    const isDirectBooking = bookingAmount == null;
    if (isDirectBooking) {
      const direct = buildDirectExpenseBooking({
        EAmount: EAmountBody,
        ENetAmount: ENetAmountBody,
        ECgstRate: ECgstRateBody,
        ESgstRate: ESgstRateBody,
        EIgstRate: EIgstRateBody,
        EPaymentType,
        EPartialAmount,
        LHeadId,
      });
      bookingAmount = direct.bookingAmount;
      bookingNetAmount = direct.bookingNetAmount;
      bookingCgstRate = direct.bookingCgstRate;
      bookingSgstRate = direct.bookingSgstRate;
      bookingIgstRate = direct.bookingIgstRate;
    }

    // Multi Expense Head tagging — only meaningful for a direct booking
    // (GRN/PO/WO_PO/WORK_DONE-sourced bookings still post to the system
    // Purchase ledger, unaffected). When provided, replaces the single
    // EGLAccountId dropdown: each row is its own future Dr leg, and
    // together they must add up to exactly what's owed to the supplier
    // (bookingNetAmount) since that's the Cr side of the same voucher.
    const expenseHeadAllocations = isDirectBooking ? normalizeAllocations(EExpenseHeadAllocations) : [];
    if (expenseHeadAllocations.length > 0) {
      const allocSum = sumAllocations(expenseHeadAllocations);
      const target = Math.round((Number(bookingNetAmount) || 0) * 100) / 100;
      if (Math.abs(allocSum - target) > 0.5) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Expense Head amounts (₹${allocSum.toFixed(2)}) must add up to the invoice total (₹${target.toFixed(2)}).`,
        });
      }
    }

    let isDinvDocType = false;
    if (EDocTypeId) {
      const typeId = parseInt(EDocTypeId, 10);
      const finYear = (EFinYear || "").toString().trim();

      const typeResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId).query(`
          SELECT Prefix, FullPrefix, StartingDocNo, DocNoPrefix
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

      // Direct Expense Booking (DINV) numbers are meant to stand on their
      // own — DocNoPrefix already reads "DINV", so stacking the generic
      // "INV/" module prefix on top ("INV/DINV000001/...") was redundant.
      isDinvDocType = typeRow.DocNoPrefix === "DINV";

      const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
      const prefix = rawPrefix.replace(/\d+$/, "");
      const startFrom = typeRow.StartingDocNo ?? 1;

      // Scope the MAX-sequence lookup to this specific fin year — each fin
      // year gets its own counter starting back at startFrom (e.g. "01"),
      // instead of numbering continuing across fin-year boundaries. The
      // fin year is always the DocNo's trailing "/<finYear>" suffix, so
      // matching on that suffix needs no schema change. Doc types with no
      // fin year at all keep the old global-count behaviour.
      const scopedPrefixPattern = finYear ? `${prefix}%/${finYear}` : `${prefix}%`;

      // The serial is extracted as "however many digits immediately follow
      // the prefix", NOT a fixed-width substring — a fixed length (the old
      // SUBSTRING(..., 6) here) silently drops any row whose actual digit
      // count differs (e.g. a 5-digit number grabs a trailing "/" and
      // TRY_CAST returns NULL), which understates the true max and can
      // reset the sequence back to the starting number. PATINDEX finds the
      // first non-digit character (the appended "/" sentinel guarantees a
      // match even with no suffix) so this works for any padding width.
      const maxResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("PrefixLen", sql.Int, prefix.length)
        .input("Prefix", sql.NVarChar(100), scopedPrefixPattern).query(`
          SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
          FROM dbo.DocNumberSequence WITH (UPDLOCK, HOLDLOCK)
          CROSS APPLY (SELECT SUBSTRING(DocNo, @PrefixLen + 1, 30) AS afterPrefix) a
          CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
        `);

      // Also check ExpenseBooking, scoped to the same fin year
      const ebMaxResult = await transaction
        .request()
        .input("EDocTypeId2", sql.Int, typeId)
        .input("Prefix2Len", sql.Int, prefix.length)
        .input("Prefix2", sql.NVarChar(100), scopedPrefixPattern).query(`
          SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
          FROM dbo.ExpenseBooking WITH (UPDLOCK, HOLDLOCK)
          CROSS APPLY (SELECT SUBSTRING(EDocNo, @Prefix2Len + 1, 30) AS afterPrefix) a
          CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
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

    // The doc-number reservation loop above INSERTed/claimed its row in
    // DocNumberSequence keyed by the un-prefixed value — keep that exact
    // string for the RecordId back-patch below. Prepending "INV/" onto
    // `finalDocNo` for display/storage on ExpenseBooking.EDocNo used to
    // also change what the back-patch searched for, so the UPDATE never
    // matched any row, RecordId stayed NULL forever, and every subsequent
    // booking's reservation loop treated the row as an abandoned ghost
    // reservation and reclaimed the SAME number instead of incrementing —
    // e.g. every Direct Expense Booking (DINV) landing on INV/DINV000001.
    const reservedDocNo = finalDocNo;

    // Prepend INV/ prefix to every expense booking doc number — except
    // Direct Expense Bookings (DINV), which already carry their own
    // distinct prefix and don't need the generic "INV/" stacked on top.
    if (finalDocNo && !isDinvDocType && !finalDocNo.startsWith("INV/")) {
      finalDocNo = `INV/${finalDocNo}`;
    }

    // TDS (migration 304) — never mandatory at invoice-creation time (the
    // spec only enforces TDS at payment time, per Section 17); if the form
    // sent a TDSId (because the supplier was already known to be
    // TDS-eligible), validate it's Active and snapshot the calculation
    // against EAmount — the pre-GST taxable base, matching how the payment
    // side (once it exists) will inherit this exact snapshot rather than
    // re-deriving it.
    let tdsSnapshot = { TDSId: null, TDSNature: null, TDSName: null, TDSPercentage: null, TDSAmount: 0 };
    if (TDSId) {
      const { calculateTds } = require("../services/tds");
      const tdsRow = await transaction.request().input("TDSId", sql.Int, parseInt(TDSId, 10))
        .query("SELECT TDSId, Nature, Name, Percentage, Status FROM dbo.TDSMaster WHERE TDSId = @TDSId");
      const tds = tdsRow.recordset[0];
      if (!tds || !tds.Status) {
        await transaction.rollback();
        return res.status(400).json({ error: "Selected TDS is not a valid, active TDS record." });
      }
      tdsSnapshot = {
        TDSId: tds.TDSId,
        TDSNature: tds.Nature,
        TDSName: tds.Name,
        TDSPercentage: tds.Percentage,
        TDSAmount: calculateTds(bookingAmount, tds.Percentage),
      };
    }

    const insertReq = transaction
      .request()
      .input("EName", sql.NVarChar(200), EName || null)
      .input("EProjectName", sql.NVarChar(150), EProjectName || null)
      .input("EDocumentType", sql.NVarChar(50), EDocumentType)
      .input("EDocDate", sql.Date, EDocDate)
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
      .input("EIgstRate", sql.Decimal(5, 2), bookingIgstRate ?? 0)
      .input("EPaymentType", sql.NVarChar(20), EPaymentType === "partial" ? "partial" : "full")
      .input("EPartialAmount", sql.Decimal(18, 2), EPartialAmount != null ? Number(EPartialAmount) : null)
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
      .input("ECompanyId", sql.Int, parseInt(ECompanyId, 10))
      .input(
        "EDocTypeId",
        sql.Int,
        EDocTypeId ? parseInt(EDocTypeId, 10) : null,
      )
      .input("EFinYear", sql.NVarChar(20), EFinYear || null)
      .input("ESourceType", sql.NVarChar(20), ESourceType || null)
      .input("ESourceId", sql.Int, resolvedSourceId ? parseInt(resolvedSourceId, 10) : null)
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
      .input("EGLAccountId", sql.Int, EGLAccountId ? parseInt(EGLAccountId, 10) : null)
      .input("EWorkDoneRef", sql.NVarChar(100), EWorkDoneRef || null)
      .input("ContractId", sql.Int, ContractId ? parseInt(ContractId, 10) : null)
      .input("LHeadId", sql.Int, LHeadId ? parseInt(LHeadId, 10) : null)
      .input("TDSId", sql.Int, tdsSnapshot.TDSId)
      .input("TDSNature", sql.NVarChar(200), tdsSnapshot.TDSNature)
      .input("TDSName", sql.NVarChar(200), tdsSnapshot.TDSName)
      .input("TDSPercentage", sql.Decimal(5, 2), tdsSnapshot.TDSPercentage)
      .input("TDSAmount", sql.Decimal(18, 2), tdsSnapshot.TDSAmount);


    if (hasPayTermCol) insertReq.input("PaymentTermId", sql.Int, PaymentTermId ? parseInt(PaymentTermId, 10) : null);
    if (hasDirectItemsCol) insertReq.input("EDirectItemsData", sql.NVarChar(sql.MAX), EDirectItemsData || null);

    const insertResult = await insertReq.query(`
        INSERT INTO dbo.ExpenseBooking (
          EName, EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EIgstRate, EPaymentType, EPartialAmount, EDiscountData, EDocNo,
          EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy,
          ECompanyId, EDocTypeId, EFinYear,
          ESourceType, ESourceId,
          EBillingTermId, EBillingTermName, EBillingTermsData,
          ETCId, ETCName, ETCText,
          EVendorInvoiceNo, EVendorInvoiceDate, EAdditionalCharges,
          ECostCenter, EGLAccount, EGLAccountId, EWorkDoneRef, ContractId, LHeadId,
          TDSId, TDSNature, TDSName, TDSPercentage, TDSAmount
          ${hasPayTermCol ? ", PaymentTermId" : ""}
          ${hasDirectItemsCol ? ", EDirectItemsData" : ""}
        ) VALUES (
          @EName, @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EIgstRate, @EPaymentType, @EPartialAmount, @EDiscountData, @EDocNo,
          @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy,
          @ECompanyId, @EDocTypeId, @EFinYear,
          @ESourceType, @ESourceId,
          @EBillingTermId, @EBillingTermName, @EBillingTermsData,
          @ETCId, @ETCName, @ETCText,
          @EVendorInvoiceNo, @EVendorInvoiceDate, @EAdditionalCharges,
          @ECostCenter, @EGLAccount, @EGLAccountId, @EWorkDoneRef, @ContractId, @LHeadId,
          @TDSId, @TDSNature, @TDSName, @TDSPercentage, @TDSAmount
          ${hasPayTermCol ? ", @PaymentTermId" : ""}
          ${hasDirectItemsCol ? ", @EDirectItemsData" : ""}
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    const newExpenseId = insertResult.recordset[0]?.NewId;

    if (reservedDocNo && newExpenseId) {
      await transaction
        .request()
        .input("DocNo", sql.NVarChar(100), reservedDocNo)
        .input("RecordId", sql.Int, parseInt(newExpenseId, 10)).query(`
          UPDATE dbo.DocNumberSequence
          SET RecordId = @RecordId
          WHERE DocNo = @DocNo AND TableName = 'ExpenseBooking'
        `);
    }

    if (grnIdsToLink.length > 1 && newExpenseId) {
      await transaction
        .request()
        .input("EId", sql.Int, parseInt(newExpenseId, 10))
        .input("ELinkedGrnIds", sql.NVarChar(sql.MAX), JSON.stringify(grnIdsToLink))
        .query(
          "UPDATE dbo.ExpenseBooking SET ELinkedGrnIds = @ELinkedGrnIds WHERE EId = @EId",
        );
    }

    if (expenseHeadAllocations.length > 0 && newExpenseId) {
      await replaceAllocations(
        () => transaction.request(),
        sql,
        "ExpenseBooking",
        parseInt(newExpenseId, 10),
        expenseHeadAllocations,
      );
    }

    await transaction.commit();

    // ── Contract Master: auto-allocate (FIFO) any available advance ─────────
    // Mirror of saleInvoices.js's receivable-side logic: a real, system-
    // generated NewPayment (routed through the existing Dummy Bank
    // convention) is created so the booking's bill status is recomputed by
    // the SAME syncBillStatus() every real vendor payment already uses —
    // never a second, parallel "how much has this booking been paid"
    // calculation that could silently drift from the real one.
    if (ContractId && newExpenseId) {
      const { autoAllocateFIFO } = require("../services/contractLedger");
      const settleAmount = parseFloat(bookingNetAmount ?? bookingAmount) || 0;
      const allocation = await autoAllocateFIFO(pool, {
        contractId: parseInt(ContractId, 10),
        sourceType: "ExpenseBooking",
        sourceId: newExpenseId,
        sourceDocNo: finalDocNo,
        documentAmount: settleAmount,
        createdBy: req.user?.email || req.user?.name,
      });

      if (allocation.allocatedAmount > 0) {
        const dummyBank = await pool.request().query(
          "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
        );
        if (dummyBank.recordset.length) {
          const syntheticDocNo = `CONTRACT-ADJ-${newExpenseId}`;
          await pool
            .request()
            .input("PPaymentName", sql.VarChar, `Contract Advance (${finalDocNo})`)
            .input("PMode", sql.VarChar, "Cash")
            .input("PAmount", sql.Decimal(18, 2), allocation.allocatedAmount)
            .input("PDocType", sql.VarChar, "Contract Adjustment")
            .input("PDate", sql.Date, new Date())
            .input("PBankID", sql.Int, dummyBank.recordset[0].LHeadId)
            .input("PBankName", sql.VarChar, dummyBank.recordset[0].LHeadName)
            .input("PProject", sql.VarChar, EProjectName)
            .input("PCompany", sql.VarChar, "")
            .input("PExpenseRef", sql.NVarChar(100), finalDocNo)
            .input("DocNo", sql.NVarChar(100), syntheticDocNo)
            .input("ContractId", sql.Int, parseInt(ContractId, 10))
            .input("PCreatedAt", sql.DateTime, new Date())
            .input("PCreatedBy", sql.NVarChar(100), req.user?.email || req.user?.name)
            .input("Status", sql.NVarChar(20), "Approved").query(`
              INSERT INTO dbo.NewPayment
                (PPaymentName, PMode, PAmount, PDocType, PDate, PBankID, PBankName,
                 PProject, PCompany, PExpenseRef, DocNo, ContractId,
                 PCreatedAt, PCreatedBy, Status)
              VALUES
                (@PPaymentName, @PMode, @PAmount, @PDocType, @PDate, @PBankID, @PBankName,
                 @PProject, @PCompany, @PExpenseRef, @DocNo, @ContractId,
                 @PCreatedAt, @PCreatedBy, @Status)
            `);
          const { syncBillStatus } = require("./newPayment");
          await syncBillStatus(pool, sql, finalDocNo);
        }
      }
    }

    if (EEmiPayment && EEmiData && newExpenseId) {
      const parsed = sanitizeEmiJson(EEmiData);
      const schedule = parsed?.schedule ?? [];

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
  requirePageRight("expense-booking", "edit"),
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

      const emiData = sanitizeEmiJson(existing.recordset[0]?.EEmiData) || {};

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
  requirePageRight("expense-booking", "edit"),
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
        const emiData = sanitizeEmiJson(parentRow.EEmiData) || {};
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

                // Scope to this fin year — see the matching comment on the
                // main create-path MAX lookups above for why (each fin year
                // gets its own counter, restarting at startFrom).
                const scopedPrefixPattern = finYear ? `${prefix}%/${finYear}` : `${prefix}%`;

                // See the matching comment on the main create-path MAX
                // lookups above — fixed-width SUBSTRING(...,6) silently
                // drops rows whose digit count differs and can reset the
                // sequence. PATINDEX-based extraction works for any width.
                const maxResult = await pool
                  .request()
                  .input("TypeOfDocId", sql.Int, parentRow.EDocTypeId)
                  .input("PrefixLen", sql.Int, prefix.length)
                  .input("Prefix", sql.NVarChar(100), scopedPrefixPattern).query(`
                  SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
                  FROM dbo.DocNumberSequence
                  CROSS APPLY (SELECT SUBSTRING(DocNo, @PrefixLen + 1, 30) AS afterPrefix) a
                  CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
                  WHERE TypeOfDocId = @TypeOfDocId AND DocNo LIKE @Prefix
                `);
                const ebMaxResult = await pool
                  .request()
                  .input("EDocTypeId2", sql.Int, parentRow.EDocTypeId)
                  .input("Prefix2Len", sql.Int, prefix.length)
                  .input("Prefix2", sql.NVarChar(100), scopedPrefixPattern).query(`
                  SELECT MAX(TRY_CAST(LEFT(t.remainder, PATINDEX('%[^0-9]%', t.remainder + '/') - 1) AS INT)) AS MaxSeq
                  FROM dbo.ExpenseBooking
                  CROSS APPLY (SELECT SUBSTRING(EDocNo, @Prefix2Len + 1, 30) AS afterPrefix) a
                  CROSS APPLY (SELECT CASE WHEN PATINDEX('%[0-9]%', a.afterPrefix) = 0 THEN ''
                                    ELSE SUBSTRING(a.afterPrefix, PATINDEX('%[0-9]%', a.afterPrefix), 30) END AS remainder) t
                  WHERE EDocTypeId = @EDocTypeId2 AND EDocNo LIKE @Prefix2
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
  requirePageRight("expense-booking", "edit"),
  validateBody(expenseBookingUpdateSchema),
  async (req, res) => {
    const numericId = parseInt(req.params.id, 10);
    if (!Number.isFinite(numericId) || numericId <= 0)
      return res.status(400).json({ error: "Invalid record id" });

    let wasApproved = false;
    let beforeSnapshot = null;
    try {
      // A Pending record is freely editable — it hasn't been approved yet,
      // so there's nothing for an edit to conflict with. Only an Approved
      // record's edits need to be tracked, which is what the amendment log
      // below is for; Pending never reaches that path.
      const currentStatus = await getRecordStatus("expense-booking", numericId);
      wasApproved = currentStatus === "Approved";
      if (wasApproved) {
        beforeSnapshot = await snapshotRow(getPool(), "dbo.ExpenseBooking", "Eid", numericId);
      }

      // Chain guard: a Payment already recorded against this invoice must
      // be deleted first — editing amounts after payment would silently
      // drift the invoice out of sync with what was already paid.
      const blockedBy = await downstreamOfExpenseBooking(getPool(), numericId);
      if (blockedBy) {
        return res.status(409).json({
          error: `Cannot edit: this expense booking has ${blockedBy}. Delete them first, then edit the invoice.`,
        });
      }
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
      EIgstRate,
      EPaymentType,
      EPartialAmount,
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
      EGLAccountId,
      EWorkDoneRef,
      PaymentTermId: PaymentTermIdPut,
      EDirectItemsData: EDirectItemsDataPut,
      LHeadId,
      TDSId,
    } = req.body;

    // Same NOT NULL columns as POST / — this UPDATE overwrites them
    // unconditionally (not a COALESCE-style partial update), so omitting any
    // of them here would null out the existing value and crash the same way
    // the create path did before the fix above. EProjectName is exempt —
    // nullable since migration 347, a project isn't always known/applicable.
    if (!EDocumentType) {
      return res.status(400).json({ error: "EDocumentType is required." });
    }
    if (!EDocDate) {
      return res.status(400).json({ error: "EDocDate is required." });
    }
    if (!ECompanyId) {
      return res.status(400).json({ error: "ECompanyId is required." });
    }

    try {
      const pool = getPool();
      const hasPayTermColPut = await ebHasPaymentTermId(pool);
      const hasDirectItemsColPut = await ebHasDirectItemsData(pool);

      // Default to a direct/manual booking's own amounts + supplier link;
      // the GRN branch below overrides amounts/GST (never IGST — GRN
      // bookings are always CGST/SGST) with the live GRN totals instead.
      const direct = buildDirectExpenseBooking({
        EAmount,
        ENetAmount,
        ECgstRate,
        ESgstRate,
        EIgstRate,
        EPaymentType,
        EPartialAmount,
        LHeadId,
      });
      let bookingAmount = direct.bookingAmount;
      let bookingNetAmount = direct.bookingNetAmount;
      let bookingCgstRate = direct.bookingCgstRate;
      let bookingSgstRate = direct.bookingSgstRate;
      let bookingIgstRate = direct.bookingIgstRate;

      // Multi Expense Head tagging — see the matching comment on POST /.
      // Validated up front (before the UPDATE runs) since this route isn't
      // transaction-wrapped — a bad allocation sum should never leave a
      // half-applied edit.
      const isDirectBookingPut = ESourceType !== "GRN";
      const expenseHeadAllocationsPut = isDirectBookingPut
        ? normalizeAllocations(req.body.EExpenseHeadAllocations)
        : [];
      if (expenseHeadAllocationsPut.length > 0) {
        const allocSum = sumAllocations(expenseHeadAllocationsPut);
        const target = Math.round((Number(bookingNetAmount) || 0) * 100) / 100;
        if (Math.abs(allocSum - target) > 0.5) {
          return res.status(400).json({
            error: `Expense Head amounts (₹${allocSum.toFixed(2)}) must add up to the invoice total (₹${target.toFixed(2)}).`,
          });
        }
      }

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
        bookingIgstRate = 0;
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

      // TDS (migration 304) — see matching comment on POST /. Re-validated
      // and recomputed against the (possibly just-recomputed) bookingAmount
      // on every save, same discipline as create.
      let tdsSnapshotPut = { TDSId: null, TDSNature: null, TDSName: null, TDSPercentage: null, TDSAmount: 0 };
      if (TDSId) {
        const { calculateTds } = require("../services/tds");
        const tdsRowPut = await pool.request().input("TDSId", sql.Int, parseInt(TDSId, 10))
          .query("SELECT TDSId, Nature, Name, Percentage, Status FROM dbo.TDSMaster WHERE TDSId = @TDSId");
        const tdsPut = tdsRowPut.recordset[0];
        if (!tdsPut || !tdsPut.Status) {
          return res.status(400).json({ error: "Selected TDS is not a valid, active TDS record." });
        }
        tdsSnapshotPut = {
          TDSId: tdsPut.TDSId,
          TDSNature: tdsPut.Nature,
          TDSName: tdsPut.Name,
          TDSPercentage: tdsPut.Percentage,
          TDSAmount: calculateTds(bookingAmount, tdsPut.Percentage),
        };
      }

      const putReq = pool
        .request()
        .input("Eid", sql.Int, numericId)
        .input("EName", sql.NVarChar(200), EName || null)
        .input("EProjectName", sql.NVarChar(150), EProjectName || null)
        .input("EDocumentType", sql.NVarChar(50), EDocumentType)
        .input("EDocDate", sql.Date, EDocDate)
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
        .input("EIgstRate", sql.Decimal(5, 2), bookingIgstRate ?? 0)
        .input("EPaymentType", sql.NVarChar(20), EPaymentType === "partial" ? "partial" : "full")
        .input("EPartialAmount", sql.Decimal(18, 2), EPartialAmount != null ? Number(EPartialAmount) : null)
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
        .input("ECompanyId", sql.Int, parseInt(ECompanyId, 10))
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
        .input("EGLAccountId", sql.Int, EGLAccountId ? parseInt(EGLAccountId, 10) : null)
        .input("EWorkDoneRef", sql.NVarChar(100), EWorkDoneRef || null)
        .input("LHeadId", sql.Int, LHeadId ? parseInt(LHeadId, 10) : null)
        .input("TDSId", sql.Int, tdsSnapshotPut.TDSId)
        .input("TDSNature", sql.NVarChar(200), tdsSnapshotPut.TDSNature)
        .input("TDSName", sql.NVarChar(200), tdsSnapshotPut.TDSName)
        .input("TDSPercentage", sql.Decimal(5, 2), tdsSnapshotPut.TDSPercentage)
        .input("TDSAmount", sql.Decimal(18, 2), tdsSnapshotPut.TDSAmount);

      if (hasPayTermColPut) putReq.input("PaymentTermIdPut", sql.Int, PaymentTermIdPut ? parseInt(PaymentTermIdPut, 10) : null);
      if (hasDirectItemsColPut) putReq.input("EDirectItemsDataPut", sql.NVarChar(sql.MAX), EDirectItemsDataPut || null);

      const result = await putReq.query(`
        UPDATE dbo.ExpenseBooking SET
          EName=@EName, EProjectName=@EProjectName, EDocumentType=@EDocumentType, EDocDate=@EDocDate,
          EAmount=@EAmount, ENetAmount=@ENetAmount, ECgstRate=@ECgstRate, ESgstRate=@ESgstRate,
          EIgstRate=@EIgstRate, EPaymentType=@EPaymentType, EPartialAmount=@EPartialAmount,
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
          ECostCenter=@ECostCenter, EGLAccount=@EGLAccount, EGLAccountId=@EGLAccountId, EWorkDoneRef=@EWorkDoneRef,
          LHeadId=@LHeadId,
          TDSId=@TDSId, TDSNature=@TDSNature, TDSName=@TDSName, TDSPercentage=@TDSPercentage, TDSAmount=@TDSAmount
          ${hasPayTermColPut ? ", PaymentTermId=@PaymentTermIdPut" : ""}
          ${hasDirectItemsColPut ? ", EDirectItemsData=@EDirectItemsDataPut" : ""}
        WHERE Eid = @Eid
      `);

      if (!result.rowsAffected?.[0]) {
        return res.status(404).json({ error: "Expense booking not found" });
      }

      // Multi Expense Head tagging — always replace wholesale on save. If
      // the booking is no longer "direct" (switched to a GRN/PO source) or
      // simply has no allocations this time, this clears out any stale
      // rows from a previous edit rather than leaving them dangling.
      await replaceAllocations(() => pool.request(), sql, "ExpenseBooking", numericId, expenseHeadAllocationsPut);

      // If EMI is being enabled and a schedule is provided, sync EmiInstallments.
      // Only insert rows that don't already exist (idempotent — safe to call on re-save).
      if (EEmiPayment && EEmiData) {
        const parsed = sanitizeEmiJson(EEmiData);
        const schedule = parsed?.schedule ?? [];

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

      if (wasApproved && beforeSnapshot) {
        try {
          const afterSnapshot = await snapshotRow(pool, "dbo.ExpenseBooking", "Eid", numericId);
          // EProjectName is a misnomer — it actually stores the enterprise
          // ID as text (see ExpenseBooking/helpers.ts), resolved to a real
          // name via a JOIN everywhere else this booking is displayed. The
          // Amendment log's "Project" field needs the same resolution,
          // otherwise it shows the raw id (e.g. "1023") instead of the
          // project's actual name.
          const rawProjectId = afterSnapshot?.EProjectName || beforeSnapshot.EProjectName;
          let projectName = rawProjectId;
          if (rawProjectId) {
            const projRes = await pool.request().input("pid", sql.NVarChar(50), rawProjectId)
              .query("SELECT name FROM dbo.enterprise WHERE id = TRY_CAST(@pid AS INT)");
            if (projRes.recordset.length) projectName = projRes.recordset[0].name;
          }
          await recordAmendment({
            refDocType: "expense-booking",
            refDocId: numericId,
            refDocNo: afterSnapshot?.EDocNo || beforeSnapshot.EDocNo,
            projectName,
            companyName: null,
            changedBy: req.user?.email || req.user?.name || null,
            before: beforeSnapshot,
            after: afterSnapshot,
          });
        } catch (logErr) {
          console.error("Amendment log error (expense-booking):", logErr.message);
        }
      }

      res.json({ message: "Expense updated successfully" });
    } catch (err) {
      console.error("Update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("expense-booking", "delete"), async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0)
    return res.status(400).json({ error: "Invalid record id" });

  try {
    const pool = getPool();

    // ── 0. EMI guard ──────────────────────────────────────────────────────────
    // EMI-enabled bookings are permanent — deleting one would orphan its
    // EmiInstallments schedule and silently reopen the source document for
    // re-invoicing, breaking the one-and-done policy.
    const emiCheck = await pool.request().input("Eid", sql.Int, numericId).query(`
      SELECT EEmiPayment FROM dbo.ExpenseBooking WHERE Eid = @Eid
    `);
    if (emiCheck.recordset[0]?.EEmiPayment) {
      const message =
        "This is an EMI booking and cannot be deleted. EMI entries are permanent once created.";
      return res.status(409).json({ error: message, message });
    }

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

    // Reverse whatever GL this invoice posted at approval (SourceType
    // 'ExpenseBooking', SourceId = Eid — see generalLedger.js's
    // postExpenseBookingApproval) before hard-deleting it. Previously
    // skipped, so a deleted invoice's GeneralLedgerEntry rows survived with
    // IsReversed=0 forever — Vendor Ledger Report and every other report
    // reading off that table kept counting an invoice that no longer
    // existed. Same fix already applied to loanSanction.js's DELETE.
    const { reversePostingBySource } = require("../services/generalLedger");
    await reversePostingBySource(pool, "ExpenseBooking", numericId);

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
router.put("/:id/submit", requirePageRight("expense-booking", "edit"), async (req, res) => {
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

router.put("/:id/approve", requirePageRight("expense-booking", "edit"), async (req, res) => {
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

    // Initialize EBillStatus/ETotalPaid/ERemainingAmount the moment the
    // invoice is approved — previously these only got set the first time a
    // payment/adjustment touched the invoice, so a freshly-approved invoice
    // with no payments yet had EBillStatus=NULL and showed as "Unknown" in
    // pickers (e.g. the On Account Adjustment invoice list) instead of
    // "Payment Due".
    try {
      const pool = getPool();
      const docRes = await pool.request().input("Eid", sql.Int, id)
        .query("SELECT EDocNo FROM dbo.ExpenseBooking WHERE Eid = @Eid");
      const docNo = docRes.recordset[0]?.EDocNo;
      if (docNo) await syncBillStatus(pool, sql, docNo);
    } catch (syncErr) {
      console.warn("syncBillStatus on invoice approve failed (non-fatal):", syncErr.message);
    }

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
  requirePageRight("expense-booking", "edit"),
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
          eb.TDSId, eb.TDSNature, eb.TDSName, eb.TDSPercentage, eb.TDSAmount,
          -- GRN info
          grn.GRNNo, grn.GRNID, grn.TotalAmount AS GrnTotalAmount,
          -- PO info via GRN or direct
          po.PurchaseOrderNo, po.PurchaseOrderID,
          po.SourceMRDocNo, po.SupplierID,
          -- Supplier (vendor) master, resolved via the PO
          ahm.LHeadId       AS SupplierLHeadId,
          ahm.LHeadName     AS SupplierName,
          ahm.LHeadCode     AS SupplierCode,
          ahm.LHeadAddress  AS SupplierAddress,
          ahm.LHeadPhone    AS SupplierPhone,
          ahm.LHeadEmail    AS SupplierEmail,
          ahm.LGST          AS SupplierGST,
          ahm.LHeadPan      AS SupplierPAN
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.PurchaseOrders po
          ON (
            (eb.ESourceType = 'GRN' AND po.PurchaseOrderID = grn.POID)
            OR (eb.ESourceType IN ('PO','WO_PO','WORK_DONE') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT))
          )
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = po.SupplierID
        WHERE eb.Eid = @Eid
      `);

    if (!ebRes.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const eb = ebRes.recordset[0];
    // ENetAmount is the finalized net payable (base + GST + billing terms adjustments).
    // Never use GrnTotalAmount — it is the pre-tax GRN base, not the net payable.
    const netAmount = parseFloat(eb.ENetAmount ?? 0) > 0
      ? parseFloat(eb.ENetAmount)
      : parseFloat(eb.EAmount ?? 0) || 0;
    // TDS is deducted at source, not paid to the supplier through NewPayment —
    // so the amount actually still owed in cash is netAmount minus whatever
    // TDS was withheld, not netAmount itself. GST/netAmount math is untouched
    // above; this only affects what counts as "payable in cash" below.
    const tdsAmount = parseFloat(eb.TDSAmount ?? 0) || 0;
    const payableAfterTds = Math.max(0, Math.round((netAmount - tdsAmount) * 100) / 100);

    // Fetch approved payments against this booking, joining BRS to detect bounced cheques
    const payRes = await pool
      .request()
      .input("PExpenseRef", sql.NVarChar(100), eb.EDocNo).query(`
        SELECT
          np.PPaymentID, np.DocNo, np.PDate, np.PMode, np.PAmount, np.Status,
          np.PPaymentName, np.PChequeNo, np.PNeftNumber, np.PUpiTransactionId,
          ISNULL(np.BounceCharge, 0) AS BounceCharge,
          ISNULL(br.IsBounced, 0) AS IsBounced
        FROM dbo.NewPayment np
        LEFT JOIN dbo.BankReconciliation br
          ON br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
        WHERE np.PExpenseRef = @PExpenseRef
        ORDER BY np.PPaymentID ASC
      `);

    const payments = payRes.recordset.map((p) => ({
      id: p.PPaymentID,
      docNo: p.DocNo,
      date: p.PDate ? String(p.PDate).slice(0, 10) : null,
      mode: p.PMode,
      amount: parseFloat(p.PAmount) || 0,
      bounceCharge: parseFloat(p.BounceCharge) || 0,
      status: p.Status,
      isBounced: !!p.IsBounced,
      ref: p.PChequeNo || p.PNeftNumber || p.PUpiTransactionId || null,
    }));

    // Compute totalPaid live: only Approved, non-bounced payments count.
    // Bounce charges are paid to the bank, not the supplier — exclude them from
    // the invoice-clearing amount so remaining balance stays correct.
    const totalPaid = payments
      .filter((p) => p.status === 'Approved' && !p.isBounced)
      .reduce((sum, p) => sum + p.amount - p.bounceCharge, 0);
    // Remaining is measured against what's actually still payable in cash
    // (net of TDS already withheld), not the gross invoice net amount —
    // otherwise a fully-settled TDS bill shows a phantom "remaining" equal
    // to the TDS amount forever.
    const remaining = Math.max(0, Math.round((payableAfterTds - totalPaid) * 100) / 100);

    res.json({
      expenseId: eb.Eid,
      docNo: eb.EDocNo,
      status: eb.EStatus,
      billStatus:
        eb.EBillStatus || (payments.length === 0 ? "Payment Due" : null),
      netAmount,
      tdsAmount,
      payableAfterTds,
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
      supplier: eb.SupplierLHeadId
        ? {
            id: eb.SupplierLHeadId,
            name: eb.SupplierName || null,
            code: eb.SupplierCode || null,
            address: eb.SupplierAddress || null,
            phone: eb.SupplierPhone || null,
            email: eb.SupplierEmail || null,
            gst: eb.SupplierGST || null,
            pan: eb.SupplierPAN || null,
          }
        : null,
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

// ── Invoice Posting: preview ────────────────────────────────────────────────
router.get("/:id/posting", async (req, res) => {
  const ebId = parseInt(req.params.id, 10);
  if (!ebId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();

    const ebSupplierPost = expenseBookingSupplierSql("eb", "postprev");
    const ebRes = await pool.request().input("Eid", sql.Int, ebId).query(`
      SELECT eb.Eid, eb.EDocNo, eb.ENetAmount, eb.EAmount, eb.ESourceType, eb.ESourceId,
             eb.ELinkedGrnIds, eb.EGLAccountId, eb.TDSAmount, eb.TDSId,
             eb.ECgstRate, eb.ESgstRate, eb.EIgstRate,
             eb.ECompanyId AS CompanyId, TRY_CAST(eb.EProjectName AS INT) AS ProjectId,
             eb.EName AS SupplierName,
             ${ebSupplierPost.idExpr} AS ResolvedSupplierId,
             ${ebSupplierPost.nameExpr} AS ResolvedSupplierName,
             gl.LHeadName AS EGLAccountName,
             tm.GLHeadId AS TdsNatureGLHeadId, tm.Nature AS TdsNature
      FROM dbo.ExpenseBooking eb
      LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = eb.EGLAccountId
      LEFT JOIN dbo.TDSMaster tm ON tm.TDSId = eb.TDSId
      ${ebSupplierPost.joins}
      WHERE eb.Eid = @Eid
    `);
    if (!ebRes.recordset.length) return res.status(404).json({ error: "Not found" });
    const eb = ebRes.recordset[0];
    const tdsAmount = Math.max(0, Math.round((parseFloat(eb.TDSAmount) || 0) * 100) / 100);

    // Determine if GRN-linked
    const isGrnLinked = eb.ESourceType === "GRN" && eb.ESourceId;
    let baseAmount = 0, taxAmount = 0, totalAmount = 0, perGrn = null, costCentreBreakdown = [];

    if (isGrnLinked) {
      const grnIds = resolveGrnIds(eb);
      ({ baseAmount, taxAmount, totalAmount, perGrn } = await computeGrnBaseTax(pool, grnIds));
      costCentreBreakdown = await computeGrnCostCentreBreakdown(pool, grnIds);
    } else {
      // Direct (non-GRN) booking: back-derive base/tax from the invoice's
      // own GST rates against the GST-inclusive ENetAmount — MUST exactly
      // match the same formula in POST /:id/post-to-gl below, otherwise
      // this preview shows a different split than what actually gets
      // posted. (Previously used EAmount directly, which could drift from
      // the rate-derived base after billing-term adjustments.)
      totalAmount = parseFloat(eb.ENetAmount || eb.EAmount || 0);
      const directRatePct = (parseFloat(eb.ECgstRate) || 0) + (parseFloat(eb.ESgstRate) || 0) + (parseFloat(eb.EIgstRate) || 0);
      baseAmount = directRatePct > 0 ? totalAmount / (1 + directRatePct / 100) : totalAmount;
      taxAmount = Math.max(0, Math.round((totalAmount - baseAmount) * 100) / 100);
    }

    // System ledgers (Purchase, PGRN) plus the invoice's own resolved
    // supplier — "Supplier / Creditor A/c" is that specific vendor's own
    // AccountHeadMaster row, not a shared system-generated placeholder
    // (there isn't one; every vendor has their own ledger). The row label
    // stays the generic "Supplier / Creditor A/c" — only the underlying
    // LHeadId points at the specific vendor, which is what actually
    // determines which account the posting lands in.
    const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
    const leds = ledRes.recordset;
    const find = (fn) => { const r = leds.find(fn); return r ? { id: r.LHeadId, label: r.LHeadName } : null; };
    const accounts = {
      // For direct (non-GRN) bookings, the invoice's own chosen GL Account
      // (General Ledger master) takes the debit leg instead of the generic
      // system "Purchase A/c" ledger, when one has been selected on the form.
      purchase:  eb.EGLAccountId
        ? { id: eb.EGLAccountId, label: eb.EGLAccountName || "GL Account" }
        : find((l)=>l.LHeadName.toLowerCase().includes("purchase")),
      pgrn:      find((l)=>l.LHeadName.toLowerCase().includes("pending")),
      supplier:  eb.ResolvedSupplierId
        ? { id: eb.ResolvedSupplierId, label: eb.ResolvedSupplierName ? `Supplier/Creditor Payable — ${eb.ResolvedSupplierName}` : "Supplier/Creditor Payable" }
        : null,
      // Confirmed input tax credit, recognized once the invoice matches the
      // GRN — distinct from Provisional Credit Available (the GRN-stage
      // provisional estimate, left untouched at invoice time).
      gstCredit: find((l)=>l.LHeadName.toLowerCase().includes("gst credit")),
      // TDS withheld from the supplier — a separate liability leg, not
      // part of what's owed to the vendor. Mirrors POST /:id/post-to-gl.
      tdsPayable: find((l)=>l.LHeadName.toLowerCase().includes("tds payable")),
      // Distinct GL head per TDS Nature (194C/194J/...) that gets debited
      // for the TDS amount, separate from the Expense Head itself.
      tdsNature: eb.TdsNatureGLHeadId ? { id: eb.TdsNatureGLHeadId, label: `TDS ${eb.TdsNature || ""} A/c`.trim() } : null,
    };

    // Check if already posted
    const postedRes = await pool.request().input("SrcId", sql.Int, ebId)
      .query(`SELECT TOP 1 EntryId, VoucherNo FROM dbo.GeneralLedgerEntry WHERE SourceType='InvoicePosting' AND SourceId=@SrcId AND IsReversed=0`);
    const isPosted = postedRes.recordset.length > 0;

    // Multi Expense Head tagging (migration 303) — for a direct booking
    // this is now the primary source of the debit-side breakdown; the
    // single accounts.purchase resolved above stays as the fallback for
    // any booking that hasn't been re-saved under the new structure yet.
    const expenseHeadAllocations = isGrnLinked ? [] : await getAllocations(pool, sql, "ExpenseBooking", ebId);

    res.json({
      isGrnLinked: !!isGrnLinked,
      baseAmount, taxAmount, totalAmount, tdsAmount,
      // Per-GRN breakdown (doc no, date, amounts) — only meaningfully
      // multi-row for a combined invoice; a single-GRN invoice still gets
      // a 1-row array so the frontend can render one consistent shape.
      grnBreakdown: perGrn,
      costCentreBreakdown,
      supplierName: eb.SupplierName,
      accounts,
      expenseHeadAllocations,
      isPosted,
      jvNo: isPosted ? postedRes.recordset[0].VoucherNo : null,
      jvId: isPosted ? postedRes.recordset[0].EntryId : null,
    });
  } catch (err) {
    console.error("Invoice posting preview error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Invoice Posting: post to GL ─────────────────────────────────────────────
router.post("/:id/post-to-gl", async (req, res) => {
  const ebId = parseInt(req.params.id, 10);
  if (!ebId) return res.status(400).json({ error: "Invalid id" });
  const userEmail = req.user?.email || req.user?.upn || "system";
  try {
    const pool = getPool();
    const { lockNextDocNumber, resolveDocTypeId } = require("../utils/docNumberLock");
    const { postVoucher } = require("../services/generalLedger");

    const ebSupplierPost2 = expenseBookingSupplierSql("eb", "postgl");
    const ebRes = await pool.request().input("Eid", sql.Int, ebId).query(`
      SELECT eb.Eid, eb.EDocNo, eb.EDocDate, eb.ENetAmount, eb.EAmount, eb.ESourceType, eb.ESourceId,
             eb.ELinkedGrnIds, eb.EGLAccountId, eb.TDSAmount, eb.TDSId,
             eb.ECgstRate, eb.ESgstRate, eb.EIgstRate,
             eb.ECompanyId AS CompanyId, TRY_CAST(eb.EProjectName AS INT) AS ProjectId,
             ${ebSupplierPost2.idExpr} AS ResolvedSupplierId,
             ${ebSupplierPost2.nameExpr} AS ResolvedSupplierName,
             tm.GLHeadId AS TdsNatureGLHeadId, tm.Nature AS TdsNature
      FROM dbo.ExpenseBooking eb
      LEFT JOIN dbo.TDSMaster tm ON tm.TDSId = eb.TDSId
      ${ebSupplierPost2.joins}
      WHERE eb.Eid = @Eid
    `);
    if (!ebRes.recordset.length) return res.status(404).json({ error: "Not found" });
    const eb = ebRes.recordset[0];
    // TDS is withheld from the supplier, not paid out — it's a separate
    // liability to the tax authority, not part of what's owed to the
    // vendor. Previously the Supplier/Creditor leg was credited the FULL
    // invoice amount with no TDS Payable leg at all, silently overstating
    // the vendor's payable and never recording the TDS liability.
    const tdsAmount = Math.max(0, Math.round((parseFloat(eb.TDSAmount) || 0) * 100) / 100);

    // Check already posted
    const alreadyPosted = await pool.request().input("SrcId", sql.Int, ebId)
      .query(`SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType='InvoicePosting' AND SourceId=@SrcId AND IsReversed=0`);
    if (alreadyPosted.recordset.length) return res.status(409).json({ error: "This invoice has already been posted to GL." });

    // This route (SourceType='InvoicePosting') is the authoritative posting
    // path for an invoice — postExpenseBookingApproval (SourceType=
    // 'ExpenseBooking', fires automatically on approval) independently
    // guards against re-entry the same way, but neither ever checked for
    // the OTHER's posting, so an approved-then-manually-posted invoice got
    // double-credited to the vendor under two different accounting
    // treatments (see migration 409's cleanup of the historical cases).
    // Reverse any stale ExpenseBooking posting for this invoice before
    // superseding it here, so InvoicePosting always wins going forward.
    const { reversePostingBySource } = require("../services/generalLedger");
    await reversePostingBySource(pool, "ExpenseBooking", ebId);

    const isGrnLinked = eb.ESourceType === "GRN" && eb.ESourceId;
    let baseAmount = 0, taxAmount = 0, totalAmount = 0;

    let perGrn = null;
    if (isGrnLinked) {
      ({ baseAmount, taxAmount, totalAmount, perGrn } = await computeGrnBaseTax(pool, resolveGrnIds(eb)));
    } else {
      totalAmount = parseFloat(eb.ENetAmount||eb.EAmount||0);
      // Direct (TOD) bookings don't store a separate tax-amount column —
      // only the GST-inclusive ENetAmount and the rates that produced it —
      // so back-derive base/tax from the rates, same tolerance-of-rounding
      // spirit as the GRN path above. Used below to split each Expense
      // Head row's GST-inclusive amount into a base leg + a combined GST
      // Credit Available leg, instead of debiting the whole inclusive
      // amount straight to the Expense Head (which silently ate the ITC).
      const directRatePct = (parseFloat(eb.ECgstRate) || 0) + (parseFloat(eb.ESgstRate) || 0) + (parseFloat(eb.EIgstRate) || 0);
      baseAmount = directRatePct > 0 ? totalAmount / (1 + directRatePct / 100) : totalAmount;
      taxAmount = totalAmount - baseAmount;
    }

    // Cost Centre for the posted GL legs — ExpenseBooking only stores a text
    // label (ECostCenter), not an FK, so resolve the actual id from the
    // source PO: via the linked GRN's own parent PO, or directly if this
    // invoice was booked straight off a PO.
    let costCenterId = null;
    if (eb.ESourceType === "GRN" && eb.ESourceId) {
      const ccRes = await pool.request().input("GrnId", sql.Int, parseInt(eb.ESourceId, 10)).query(`
        SELECT po.CostCenterId FROM dbo.GoodsReceiptNotes grn
        JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
        WHERE grn.GRNID = @GrnId
      `);
      costCenterId = ccRes.recordset[0]?.CostCenterId ?? null;
    } else if (eb.ESourceType === "PO" && eb.ESourceId) {
      const ccRes = await pool.request().input("PoId", sql.Int, parseInt(eb.ESourceId, 10)).query(
        `SELECT CostCenterId FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PoId`,
      );
      costCenterId = ccRes.recordset[0]?.CostCenterId ?? null;
    }

    if (totalAmount <= 0) return res.status(400).json({ error: "No amount to post." });

    const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
    const leds = ledRes.recordset;
    const findId = (fn) => leds.find(fn)?.LHeadId;
    const purchaseId  = findId((l)=>l.LHeadName.toLowerCase().includes("purchase"));
    const pgrnId      = findId((l)=>l.LHeadName.toLowerCase().includes("pending"));
    const gstCreditId = findId((l)=>l.LHeadName.toLowerCase().includes("gst credit"));
    const tdsPayableId = findId((l)=>l.LHeadName.toLowerCase().includes("tds payable"));
    // "Supplier / Creditor A/c" is the invoice's own resolved supplier —
    // that specific vendor's own AccountHeadMaster row. There's no shared
    // system-generated GL placeholder for this (every vendor has their own
    // ledger), which is why searching IsSystemGenerated=1 rows for it
    // always failed with "Supplier/Creditor system ledger not configured."
    const supplierId = eb.ResolvedSupplierId;
    const supplierLabel = eb.ResolvedSupplierName ? `Supplier/Creditor Payable — ${eb.ResolvedSupplierName}` : "Supplier/Creditor Payable";
    // Multi Expense Head tagging (migration 303) — a direct booking's
    // amount can now be split across several heads instead of one. When
    // present, these ARE the debit legs; debitLedgerId (the old single
    // EGLAccountId/Purchase fallback) is only used when there are none —
    // an older booking saved before this feature, or one where the user
    // never tagged anything.
    const expenseHeadAllocations = isGrnLinked ? [] : await getAllocations(pool, sql, "ExpenseBooking", ebId);
    const debitLedgerId = !isGrnLinked && eb.EGLAccountId ? eb.EGLAccountId : purchaseId;
    if (!supplierId) return res.status(422).json({ error: "Could not resolve this invoice's supplier account." });
    if (isGrnLinked && !pgrnId) return res.status(422).json({ error: "Provision for Pending GRN system ledger not configured." });
    if (isGrnLinked && taxAmount > 0 && !gstCreditId) return res.status(422).json({ error: "GST Credit Available system ledger not configured." });
    if (!isGrnLinked && taxAmount > 0.5 && !gstCreditId) return res.status(422).json({ error: "GST Credit Available system ledger not configured." });
    if (tdsAmount > 0.5 && !tdsPayableId) return res.status(422).json({ error: "TDS Payable system ledger not configured." });
    const tdsNatureId = eb.TdsNatureGLHeadId;
    if (tdsAmount > 0.5 && !tdsNatureId) {
      return res.status(422).json({ error: `TDS Nature system ledger not configured for ${eb.TdsNature || "the selected TDS"} — link a GL head in TDS Master.` });
    }
    // Explicit posting structure (per spec):
    //   Dr Expense Head(s)   (total - TDS)
    //   Cr Supplier/Creditor (total - TDS)
    //   Dr TDS Nature A/c     TDS amount   — a distinct GL head per TDS
    //                                        Nature (194C/194J/...), NOT
    //                                        lumped into the Expense Head
    //   Cr TDS Payable A/c    TDS amount
    // Both sides still sum to totalAmount either way (TDS just moves
    // between the Expense Head and its own Nature account on the debit
    // side), so relocating it here doesn't change the voucher's balance.
    const tdsNatureLeg = tdsAmount > 0
      ? [{ LHeadId: tdsNatureId, DebitAmount: tdsAmount, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — TDS ${eb.TdsNature || ""} A/c`.trim() }]
      : [];
    // Supplier is credited net of TDS; the withheld amount is a separate
    // liability leg, not part of what's owed to the vendor.
    const creditLegs = (fullAmount, narrationSuffix = "") => {
      const tdsShare = fullAmount >= totalAmount - 0.5 ? tdsAmount : Math.round((fullAmount / totalAmount) * tdsAmount * 100) / 100;
      const supplierShare = Math.round((fullAmount - tdsShare) * 100) / 100;
      return [
        { LHeadId: supplierId, DebitAmount: 0, CreditAmount: supplierShare, Narration: `Invoice Posting: ${eb.EDocNo} — ${supplierLabel}${narrationSuffix}` },
        ...(tdsShare > 0
          ? [{ LHeadId: tdsPayableId, DebitAmount: 0, CreditAmount: tdsShare, Narration: `Invoice Posting: ${eb.EDocNo} — TDS Payable A/c${narrationSuffix}` }]
          : []),
      ];
    };
    // A direct (TOD) booking must always debit a real Expense Head — the
    // Purchase A/C fallback below is reserved for PO/WO/WO_PO-sourced
    // invoices (where there's no per-invoice head to pick from). The
    // frontend already requires at least one Expense Head row before save,
    // this is the server-side backstop against posting an older/legacy
    // booking that predates that requirement straight to Purchase A/C.
    if (!isGrnLinked && eb.ESourceType === "TOD" && expenseHeadAllocations.length === 0) {
      return res.status(422).json({ error: "This invoice has no Expense Head tagged — edit it and add at least one before posting." });
    }
    if (!isGrnLinked && expenseHeadAllocations.length === 0 && !debitLedgerId) return res.status(422).json({ error: "Purchase system ledger not configured." });
    if (!isGrnLinked && expenseHeadAllocations.length > 0) {
      const allocSum = Math.round(expenseHeadAllocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
      if (Math.abs(allocSum - totalAmount) > 0.5) {
        return res.status(422).json({
          error: `Expense Head amounts (₹${allocSum.toFixed(2)}) no longer add up to the invoice total (₹${totalAmount.toFixed(2)}) — re-save the invoice before posting.`,
        });
      }
    }

    // GRN-linked: base clears the GRN provision; tax is recognized as
    // confirmed ITC (GST Credit Available) now that an actual invoice
    // exists — previously the whole GST-inclusive total was debited to
    // PGRN alone. A combined invoice (multiple GRNs) posts one set of
    // legs PER GRN — each dated in its own narration — rather than one
    // lumped set, so the journal entry itself carries a full per-GRN
    // audit trail instead of only the summary "Combined" total.
    const fmtGrnDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
    // Same per-group TDS share math creditLegs uses, applied to the debit
    // side (Expense Head / Purchase / PGRN) instead of the credit side —
    // TDS moves off the expense-side account into its own Nature account,
    // it doesn't touch the GST Credit Available leg either way.
    const tdsShareOf = (fullAmount) =>
      tdsAmount <= 0 ? 0 : fullAmount >= totalAmount - 0.5 ? tdsAmount : Math.round((fullAmount / totalAmount) * tdsAmount * 100) / 100;

    const grnGroups = perGrn && perGrn.length > 1 ? perGrn : [{ grnId: isGrnLinked ? parseInt(eb.ESourceId, 10) : null, docNo: eb.EDocNo, date: null, baseAmount, taxAmount, totalAmount }];
    // Cost-centre buckets per GRN group — Cost Centre now lives on the PO's
    // own line item (migration 365), not the PO header, since one GRN can
    // mix e.g. a fixed-asset item with a consumption item. Splitting the
    // PGRN-reversal/GST-Credit legs per bucket (instead of one flat pair
    // per GRN) is what makes this invoice's Posting tab breakdown true to
    // what's actually posted in GL — mirrors the same split already done
    // for the GRN's own post-to-gl route.
    const grnGroupBuckets = isGrnLinked
      ? await Promise.all(grnGroups.map((g) => g.grnId ? computeSingleGrnCostCentreBuckets(pool, g.grnId) : []))
      : [];

    const lines = isGrnLinked
      ? [
          ...grnGroups.flatMap((g, gi) => {
            const gTdsShare = tdsShareOf(g.totalAmount);
            const suffix = ` — ${g.docNo}${g.date ? ` (${fmtGrnDate(g.date)})` : ""}`;
            const buckets = grnGroupBuckets[gi] && grnGroupBuckets[gi].length > 0
              ? grnGroupBuckets[gi]
              : [{ costCentre: null, baseAmount: g.baseAmount, gstAmount: g.taxAmount }];
            // TDS is deducted off the GRN group's total base, proportionally
            // across its cost-centre buckets by each bucket's own share of
            // that base — same spirit as tdsShareOf, just one level deeper.
            return buckets.flatMap((b) => {
              const bTdsShare = g.baseAmount > 0 ? Math.round((b.baseAmount / g.baseAmount) * gTdsShare * 100) / 100 : 0;
              const ccSuffix = b.costCentre?.name ? ` [${b.costCentre.name}]` : "";
              return [
                { LHeadId: pgrnId, DebitAmount: Math.round((b.baseAmount - bTdsShare) * 100) / 100, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — Provision for Pending GRN (reversal)${ccSuffix}${suffix}`, CostCenterId: b.costCentre?.id ?? null },
                ...(b.gstAmount > 0
                  ? [{ LHeadId: gstCreditId, DebitAmount: b.gstAmount, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — GST Credit Available${ccSuffix}${suffix}`, CostCenterId: b.costCentre?.id ?? null }]
                  : []),
              ];
            });
          }),
          ...grnGroups.flatMap((g) => creditLegs(g.totalAmount, ` — ${g.docNo}${g.date ? ` (${fmtGrnDate(g.date)})` : ""}`)),
          ...tdsNatureLeg,
        ]
      : expenseHeadAllocations.length > 0
        ? (() => {
            // Each row's amount is GST-inclusive (it's required to sum to
            // ENetAmount — see ExpenseHeadAllocationEditor). Scale every row
            // by the invoice's own (base - TDS)/total ratio to get its
            // net debit, and post ONE combined GST Credit Available leg for
            // the tax, plus ONE combined TDS Nature leg for the TDS —
            // rather than debiting the full inclusive amount to the
            // Expense Head, which silently absorbed both into the expense.
            const netRatio = totalAmount > 0 ? (baseAmount - tdsAmount) / totalAmount : 1;
            const headLegs = expenseHeadAllocations.map((a) => ({
              LHeadId: a.lHeadId,
              DebitAmount: Math.round(a.amount * netRatio * 100) / 100,
              CreditAmount: 0,
              Narration: `Invoice Posting: ${eb.EDocNo} — ${a.lHeadName}`,
            }));
            // Any rounding leftover from per-row scaling goes to the GST
            // leg (not silently dropped) so the voucher still balances to
            // the paisa against Supplier Payable below.
            const headNetSum = headLegs.reduce((s, l) => s + l.DebitAmount, 0);
            const gstLegAmount = Math.round((totalAmount - tdsAmount - headNetSum) * 100) / 100;
            return [
              ...headLegs,
              ...(gstLegAmount > 0
                ? [{ LHeadId: gstCreditId, DebitAmount: gstLegAmount, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — GST Credit Available` }]
                : []),
              ...tdsNatureLeg,
              ...creditLegs(totalAmount),
            ];
          })()
        : [
            // PO / WO / WO_PO-linked invoices, and TOD invoices with no
            // Expense Heads tagged, land here. baseAmount/taxAmount were
            // already back-derived from ECgstRate/ESgstRate/EIgstRate above
            // (same as the Expense Head branch) — split the single
            // Purchase/GL leg the same way instead of folding the ITC (and
            // now TDS) into it, so every non-GRN posting recognizes GST
            // Credit Available and TDS Nature consistently regardless of
            // source type. Tax leg is the remainder (totalAmount - TDS -
            // roundedBase), not independently rounded, so all legs always
            // sum exactly to totalAmount.
            ...(() => {
              const baseLeg = Math.round((baseAmount - tdsAmount) * 100) / 100;
              const taxLeg = Math.round((totalAmount - tdsAmount - baseLeg) * 100) / 100;
              return [
                { LHeadId: debitLedgerId, DebitAmount: baseLeg, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — ${eb.EGLAccountId ? "GL Account" : "Purchase"}` },
                ...(taxLeg > 0
                  ? [{ LHeadId: gstCreditId, DebitAmount: taxLeg, CreditAmount: 0, Narration: `Invoice Posting: ${eb.EDocNo} — GST Credit Available` }]
                  : []),
              ];
            })(),
            ...tdsNatureLeg,
            ...creditLegs(totalAmount),
          ];

    // Voucher number only — GL posting is independent of the Journal
    // Voucher module. This used to ALSO insert a dbo.JournalVoucher header +
    // JournalVoucherLines row mirroring these exact legs, which meant every
    // invoice posting silently created a second, duplicate-looking JV that
    // (a) cluttered the Journal Voucher list with system-generated rows
    // indistinguishable from real user-entered ones, and (b) would have
    // double-posted the same accounting event a second time under
    // SourceType='JournalVoucher' if anything ever approved/posted it (a
    // GL-backfill script found exactly this). dbo.GeneralLedgerEntry below
    // (SourceType='InvoicePosting') is the single, independent source of
    // truth. The voucher number now comes from its own "GL" TypeOfDoc
    // (migration 312) instead of borrowing "JV" — this was never a real
    // Journal Voucher, so it shouldn't read like one ("JV-2026-00012").
    // Uniqueness is tracked directly against GeneralLedgerEntry.VoucherNo,
    // the actual table these numbers live in.
    const dtId = await resolveDocTypeId(pool, sql, "GL").catch(() => null);
    const finalDocNo = dtId
      ? await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "GeneralLedgerEntry",
          docNoColumn: "VoucherNo",
          issuedBy: userEmail,
        }).catch(() => null)
      : null;

    await postVoucher(pool, {
      voucherNo: finalDocNo || `GL-EXB${ebId}`,
      // The invoice's own document date, not the date it happened to get
      // posted to GL — an invoice dated 8 June logged/posted on 10 Aug must
      // still show 8 June in the ledger and Trial Balance, not the posting
      // date.
      voucherDate: eb.EDocDate,
      sourceType: "InvoicePosting",
      sourceId: ebId,
      companyId: eb.CompanyId ?? null,
      projectId: eb.ProjectId ?? null,
      costCenterId,
      createdBy: userEmail,
      legs: lines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration, costCenterId: l.CostCenterId ?? null })),
    });

    res.json({ jvNo: finalDocNo, message: "Posted successfully." });
  } catch (err) {
    console.error("Invoice post-to-gl error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.createExpenseBookingInternal = createExpenseBookingInternal;
