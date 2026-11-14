// VAT / GST on a fixed asset's purchase (FixedAssetRecord.TaxType / TaxPct / TaxAmount, migration 668).
//
// GST replaced VAT (and CST, excise, service tax) in India on 1 July 2017. So the purchase date decides the tax:
//   before 2017-07-01 → VAT. It couldn't be claimed back, so it is part of the asset's cost and is depreciated.
//   on/after          → GST. Claimed as input tax credit, so it is recorded but kept out of the cost.
// Mirrored on the web in src/pages/fixedAsset/record/config.ts (faTax) — keep the two in step.

const GST_START = "2017-07-01";

const ymd = (d) => {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// 'VAT' | 'GST' | null (no date → can't tell)
const taxTypeFor = (date) => {
  const d = ymd(date);
  return d ? (d < GST_START ? "VAT" : "GST") : null;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// base: cost before tax. pct: tax rate. → { taxType, taxPct, taxAmount, cost } where cost is what goes in
// PurchaseCost (base + VAT, or base alone under GST). pct null/blank → no tax recorded, cost = base.
function assetTax({ base, pct, date }) {
  const taxType = taxTypeFor(date);
  const b = round2(base);
  const p = pct === null || pct === undefined || pct === "" ? null : Math.max(0, Number(pct) || 0);
  if (p == null) return { taxType, taxPct: null, taxAmount: null, cost: b };
  const taxAmount = round2((b * p) / 100);
  return { taxType, taxPct: p, taxAmount, cost: taxType === "VAT" ? round2(b + taxAmount) : b };
}

module.exports = { GST_START, taxTypeFor, assetTax };
