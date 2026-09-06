"use strict";

// backend/services/fixedAssetMaintenancePosting.js
//
// Posting rules for FA Maintenance & Repair (routes/fixedAssetMaintenance.js).
//
//   Dr  Direct / Indirect Repair Expense A/c            (taxable amount)
//   Dr  GST Credit Available  (input GST credit ledger)  (GST amount)
//   Cr  <Vendor ledger>                                  (taxable + GST)
//
// Everything is configuration-driven, nothing hard-coded:
//   - expense head        <- RepairExpenseType (Direct / Indirect)  [migration 392]
//   - vendor ledger       <- the selected Vendor's AccountHeadMaster row
//   - GST rate            <- FixedAssetRecord.RepairType (SAC code, set on the
//                            Fixed Asset Depreciation Tag) -> dbo.HSN row
//   - input GST ledger    <- "GST Credit Available" (code GSTCA) [migration 237]
//
// Company/Project are carried onto every GeneralLedgerEntry leg so Trial
// Balance / Schedule III stay scoped correctly.

const { sql } = require("../db");
const { postVoucher, hasPosting, reversePostingBySource } = require("./generalLedger");

const SOURCE_TYPE = "FAMaintenance";

// The ERP's standard repair expense heads (dev migrations 394-396):
//   Direct   -> "Direct Repair Expense A/c"   (Construction Expenses)
//   Indirect -> "Indirect Repair Expense A/c" (Indirect Expenses)
const EXPENSE_HEAD_BY_TYPE = {
  Direct: "Direct Repair Expense A/c",
  Indirect: "Indirect Repair Expense A/c",
};

// The ERP's confirmed input-tax-credit ledger (migration 237). Same account
// expenseBooking.js debits for input GST on an invoice.
const INPUT_GST_HEAD_NAME = "GST Credit Available";

function cfgErr(message) {
  const err = new Error(message);
  err.code = "CONFIG_MISSING";
  return err;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Resolve a GL expense head id by name (seeded by migration 392). */
async function resolveExpenseHead(pool, repairExpenseType) {
  const name = EXPENSE_HEAD_BY_TYPE[repairExpenseType];
  if (!name) throw cfgErr(`Unknown Repair Expense Type "${repairExpenseType}"`);
  const r = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @Name AND LHeadType = 'GL'`);
  const id = r.recordset[0]?.LHeadId ?? null;
  if (!id) throw cfgErr(`Repair Expense Account "${name}" is not configured in the Chart of Accounts.`);
  return { lHeadId: id, name };
}

// A repair bill is payable to an external party only — Supplier, Contractor,
// or a Bank for a direct payment. GL heads (Accumulated Depreciation A/c,
// Purchase A/c, GST / share-capital control accounts, …) are never a payee;
// routes/fixedAssetMaintenance.js's /vendors picker filters to the same set.
const VENDOR_HEAD_TYPES = ["S", "C", "CN", "B"];

/** Resolve the vendor's own ledger head — must be a Supplier/Contractor/Bank
 * head, never a GL control account. */
async function resolveVendorHead(pool, vendorId) {
  const r = await pool
    .request()
    .input("Id", sql.Int, vendorId)
    .query(`
      SELECT LHeadId, LHeadType, ISNULL(DisplayName, LHeadName) AS Name
      FROM dbo.AccountHeadMaster
      WHERE LHeadId = @Id AND ISNULL(LHeadStatus, 1) = 1
    `);
  const row = r.recordset[0];
  if (!row) throw cfgErr("Vendor Account is not configured: the selected Vendor has no active ledger account.");
  if (!VENDOR_HEAD_TYPES.includes(row.LHeadType)) {
    throw cfgErr(`"${row.Name}" is a ${row.LHeadType} ledger account and cannot be used as a Vendor — pick a Supplier, Contractor or Bank.`);
  }
  return { lHeadId: row.LHeadId, name: row.Name };
}

/** Resolve the input-GST-credit ledger ("GST Credit Available", migration 237). */
async function resolveInputGstHead(pool) {
  const r = await pool
    .request()
    .input("Name", sql.NVarChar(200), INPUT_GST_HEAD_NAME)
    .query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @Name AND LHeadType = 'GL'`);
  const id = r.recordset[0]?.LHeadId ?? null;
  if (!id) throw cfgErr(`Input GST Account ("${INPUT_GST_HEAD_NAME}") is not configured. Run migration 237.`);
  return { lHeadId: id, name: INPUT_GST_HEAD_NAME };
}

/**
 * Resolve the GST configuration for a maintenance record via its Fixed Asset:
 *   FA record -> RepairType (SAC code) -> dbo.HSN row -> rate %.
 * Throws CONFIG_MISSING when the SAC code or its rate is not configured.
 * Returns { sacCode, ratePct, cgst, sgst, igst, hsnDescription }.
 */
async function resolveGstConfig(pool, assetId) {
  const faRes = await pool.request().input("AssetId", sql.Int, assetId).query(`
    SELECT fa.AssetId, fa.FAItemCode, fa.RepairType AS SacCode
    FROM dbo.FixedAssetRecord fa
    WHERE fa.AssetId = @AssetId
  `);
  const fa = faRes.recordset[0];
  if (!fa) throw cfgErr("The selected FA Item Code no longer exists.");
  const sacCode = (fa.SacCode || "").trim();
  if (!sacCode) {
    throw cfgErr("SAC Code is not configured for the selected FA Item Code. Set it on the Fixed Asset Depreciation Tag.");
  }

  const hsnRes = await pool.request().input("Sac", sql.VarChar(50), sacCode).query(`
    SELECT TOP 1 HCode, HShortDescription, HDescription, HCGST, HSGST, HIGST
    FROM dbo.HSN
    WHERE HCode = @Sac AND ISNULL(HIsSAC, 0) = 1 AND ISNULL(HStatus, 1) = 1
    ORDER BY HId DESC
  `);
  const hsn = hsnRes.recordset[0];
  if (!hsn) {
    throw cfgErr(`SAC Code "${sacCode}" is not present as an active SAC entry in the HSN master (Material → Setup → HSN).`);
  }
  const cgst = hsn.HCGST == null ? null : Number(hsn.HCGST);
  const sgst = hsn.HSGST == null ? null : Number(hsn.HSGST);
  const igst = hsn.HIGST == null ? null : Number(hsn.HIGST);
  if (cgst == null && sgst == null && igst == null) {
    throw cfgErr(`Applicable GST rate is not configured for SAC Code "${sacCode}" in the HSN master.`);
  }
  // Intra-state (CGST+SGST) is the norm for repair/labour services; fall back
  // to IGST when only that is set on the HSN row. Either way the % total is
  // the same figure the HSN master carries.
  const intra = (cgst || 0) + (sgst || 0);
  const ratePct = intra > 0 ? intra : (igst || 0);
  return {
    sacCode,
    ratePct,
    cgst: cgst || 0,
    sgst: sgst || 0,
    igst: igst || 0,
    hsnDescription: hsn.HShortDescription || hsn.HDescription || null,
  };
}

/**
 * Build the balanced posting plan for a maintenance record (no DB writes).
 * Returns { voucherNo, isPosted, legs, entries, gst:{...} }.
 * Throws with err.code === "CONFIG_MISSING" when a required piece of
 * accounting/tax configuration is missing.
 */
async function buildPostingPlan(pool, record) {
  const taxable = round2(record.Amount);
  const expense = await resolveExpenseHead(pool, record.RepairExpenseType);
  const vendor = await resolveVendorHead(pool, record.VendorId);
  const gstCfg = await resolveGstConfig(pool, record.AssetId);
  const inputGst = await resolveInputGstHead(pool);

  const gstAmount = round2(taxable * gstCfg.ratePct / 100);
  const total = round2(taxable + gstAmount);

  const voucherNo = String(record.DocNo).slice(0, 50);
  const ref = record.FAItemCode || "asset";

  const legs = [
    { lHeadId: expense.lHeadId, debit: taxable, narration: `${voucherNo} — ${record.RepairExpenseType} repair/maintenance of ${ref}` },
    { lHeadId: inputGst.lHeadId, debit: gstAmount, narration: `${voucherNo} — input GST @ ${gstCfg.ratePct}% (SAC ${gstCfg.sacCode})` },
    { lHeadId: vendor.lHeadId, credit: total, narration: `${voucherNo} — payable to ${vendor.name} (incl. GST)` },
  ];

  const entries = [
    { account: expense.name, debit: taxable, credit: 0 },
    { account: inputGst.name, debit: gstAmount, credit: 0 },
    { account: vendor.name, debit: 0, credit: total },
  ];

  return {
    voucherNo,
    isPosted: await hasPosting(pool, SOURCE_TYPE, record.MaintenanceId),
    legs,
    entries,
    gst: {
      sacCode: gstCfg.sacCode,
      sacDescription: gstCfg.hsnDescription,
      ratePct: gstCfg.ratePct,
      cgst: gstCfg.cgst,
      sgst: gstCfg.sgst,
      igst: gstCfg.igst,
      taxableAmount: taxable,
      gstAmount,
      totalAmount: total,
    },
  };
}

/** Post the maintenance voucher to the GL. Idempotent via hasPosting(). */
async function postMaintenance(pool, record, userEmail) {
  if (await hasPosting(pool, SOURCE_TYPE, record.MaintenanceId)) {
    return { posted: true, voucherNo: String(record.DocNo).slice(0, 50), reason: "already posted (idempotent)" };
  }
  const plan = await buildPostingPlan(pool, record);
  await postVoucher(pool, {
    voucherNo: plan.voucherNo,
    voucherDate: record.DocDate,
    legs: plan.legs,
    sourceType: SOURCE_TYPE,
    sourceId: record.MaintenanceId,
    companyId: record.CompanyId,
    projectId: record.ProjectId,
    createdBy: userEmail,
  });
  return { posted: true, voucherNo: plan.voucherNo, gst: plan.gst };
}

/** Reverse a maintenance voucher (flips IsReversed — audit rows are kept). */
async function reverseMaintenancePosting(pool, maintenanceId) {
  await reversePostingBySource(pool, SOURCE_TYPE, maintenanceId);
}

module.exports = {
  SOURCE_TYPE,
  EXPENSE_HEAD_BY_TYPE,
  INPUT_GST_HEAD_NAME,
  resolveGstConfig,
  buildPostingPlan,
  postMaintenance,
  reverseMaintenancePosting,
};
