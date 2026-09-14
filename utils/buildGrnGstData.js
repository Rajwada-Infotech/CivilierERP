"use strict";

const { sql } = require("../db");

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function normalizeState(value) {
  return String(value || "").trim().toLowerCase();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute GST breakdown for a GRN from its line items and PO rates.
 * Returns { totals: { taxableAmount, cgstAmount, sgstAmount, netAmount, ... }, cgstRate, sgstRate, ... }
 * or null if the GRN doesn't exist.
 *
 * Extracted from expenseBooking.js so it can be used by onAccount.js and backfill scripts.
 */
async function buildGrnGstData(pool, grnId) {
  const headerResult = await pool.request().input("GRNID", sql.Int, grnId)
    .query(`
      SELECT
        grn.GRNID, grn.GRNNo, grn.DocNo, grn.GRNDate, grn.GRNItems, grn.SupplierID, grn.POID,
        supplier.LHeadName AS SupplierName, supplier.LGSTState AS VendorState,
        po.PurchaseOrderID, po.PurchaseOrderNo, po.POItems,
        po.HsnCode AS POHsnCode, po.GstRate AS POGstRate, po.GstType AS POGstType,
        po.Rate AS PORate, po.CompanyId, company.state AS CompanyState
      FROM dbo.GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster supplier ON supplier.LHeadId = grn.SupplierID
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
      LEFT JOIN dbo.enterprise company ON company.id = po.CompanyId
      WHERE grn.GRNID = @GRNID
    `);

  const header = headerResult.recordset[0];
  if (!header) return null;

  const grnItems = parseJsonArray(header.GRNItems);
  const poItems  = parseJsonArray(header.POItems);
  const itemIds  = [
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
      SELECT CONVERT(NVARCHAR(100), img.M_Id) AS ItemId, img.M_Name, img.M_HSN,
             h.HCGST, h.HSGST, h.HIGST
      FROM dbo.Item_Master_Group img
      LEFT JOIN dbo.HSN h ON h.HCode = img.M_HSN AND h.HStatus = 1
      WHERE CONVERT(NVARCHAR(100), img.M_Id) IN (${itemParams.join(",")})
    `);
    itemResult.recordset.forEach((row) => itemMasterMap.set(String(row.ItemId), row));
  }

  const poItemMap = new Map();
  poItems.forEach((item) => {
    const key = String(item.itemId || item.ItemId || item.itemName || "");
    if (key) poItemMap.set(key, item);
  });

  const vendorState   = header.VendorState  || "";
  const companyState  = header.CompanyState || "";
  const isIntraState  =
    !normalizeState(vendorState) ||
    !normalizeState(companyState) ||
    normalizeState(vendorState) === normalizeState(companyState);

  const lines = grnItems.map((item, index) => {
    const itemId  = String(item.itemId || item.ItemId || "");
    const poItem  = poItemMap.get(itemId) || poItemMap.get(String(item.itemName || item.ItemName || "")) || {};
    const master  = itemMasterMap.get(itemId) || {};

    const receivedQty = toNumber(item.receivedQty ?? item.quantity ?? item.qty ?? item.Quantity);
    const unitRate    = toNumber(item.rate) || toNumber(poItem.rate ?? poItem.Rate) || toNumber(header.PORate);

    // baseAmount: use stored totalAmount as the pre-GST base (mirrors gst-breakdown endpoint in grns.js)
    const baseAmount = toNumber(item.totalAmount) > 0
      ? toNumber(item.totalAmount)
      : roundMoney(receivedQty * unitRate);

    // GST rate from item.gstPct (same source as gst-breakdown endpoint), fall back to master or PO
    const lineGstPct = Number(item.gstPct ?? item.GstPct ?? NaN);
    const masterGstPct = toNumber(master.HCGST) + toNumber(master.HSGST) ||
                         toNumber(master.HIGST) || toNumber(poItem.tax) || toNumber(header.POGstRate);
    const gstPercent   = Number.isFinite(lineGstPct) ? lineGstPct : masterGstPct;
    const masterCgstShare = (masterGstPct > 0 && toNumber(master.HCGST)) ? toNumber(master.HCGST) / masterGstPct : 0.5;
    const masterSgstShare = 1 - masterCgstShare;

    const cgstRate    = isIntraState ? gstPercent * masterCgstShare : 0;
    const sgstRate    = isIntraState ? gstPercent * masterSgstShare : 0;
    const igstRate    = isIntraState ? 0 : gstPercent;

    const gstAmount   = roundMoney(baseAmount * (gstPercent / 100));
    const cgstAmount  = roundMoney(gstAmount * masterCgstShare);
    const sgstAmount  = roundMoney(gstAmount * masterSgstShare);
    const igstAmount  = roundMoney(baseAmount * (igstRate / 100));
    const taxableAmount = baseAmount;  // base IS the taxable amount in this model

    return {
      lineNo: index + 1,
      itemId: itemId || null,
      itemName: item.itemName || item.ItemName || master.M_Name || `Item ${index + 1}`,
      receivedQty, unitRate, gstPercent, taxableAmount,
      cgstRate, sgstRate, igstRate, cgstAmount, sgstAmount, igstAmount,
      gstAmount: roundMoney(cgstAmount + sgstAmount + igstAmount),
      netAmount: roundMoney(taxableAmount + cgstAmount + sgstAmount + igstAmount),
    };
  });

  const totals = lines.reduce(
    (sum, line) => ({
      taxableAmount: roundMoney(sum.taxableAmount + line.taxableAmount),
      cgstAmount:    roundMoney(sum.cgstAmount    + line.cgstAmount),
      sgstAmount:    roundMoney(sum.sgstAmount    + line.sgstAmount),
      igstAmount:    roundMoney(sum.igstAmount    + line.igstAmount),
      gstAmount:     roundMoney(sum.gstAmount     + line.gstAmount),
      netAmount:     roundMoney(sum.netAmount     + line.netAmount),
      receivedQty:   roundMoney(sum.receivedQty   + line.receivedQty),
    }),
    { taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, gstAmount: 0, netAmount: 0, receivedQty: 0 },
  );

  const effectiveCgstRate = totals.taxableAmount > 0 ? roundMoney((totals.cgstAmount / totals.taxableAmount) * 100) : 0;
  const effectiveSgstRate = totals.taxableAmount > 0 ? roundMoney((totals.sgstAmount / totals.taxableAmount) * 100) : 0;
  const effectiveIgstRate = totals.taxableAmount > 0 ? roundMoney((totals.igstAmount / totals.taxableAmount) * 100) : 0;
  const maxGstPercent     = lines.reduce((max, l) => Math.max(max, l.gstPercent || 0), 0);

  return {
    grnId: header.GRNID, grnNo: header.GRNNo || header.DocNo,
    poId: header.PurchaseOrderID, poNo: header.PurchaseOrderNo,
    supplierId: header.SupplierID, supplierName: header.SupplierName,
    companyId: header.CompanyId, vendorState, companyState,
    taxMode: isIntraState ? "cgst_sgst" : "igst",
    gstPercent: maxGstPercent,
    cgstRate: effectiveCgstRate, sgstRate: effectiveSgstRate, igstRate: effectiveIgstRate,
    totals, lines,
  };
}

module.exports = { buildGrnGstData };
