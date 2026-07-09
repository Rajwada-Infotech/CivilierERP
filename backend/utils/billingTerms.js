"use strict";

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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Apply billing terms to a GST-inclusive gross amount.
 * Mirrors the logic in expenseBooking.js — shared so the OA route and
 * backfill scripts don't need to duplicate it.
 *
 * @param {number} grossAmount      - incl-GST amount (e.g. grn.TotalAmount)
 * @param {number} basicAmount      - pre-GST taxable base (EAmount)
 * @param {number} cgstRate         - effective CGST %
 * @param {number} sgstRate         - effective SGST %
 * @param {any}    billingTermsRaw  - EBillingTermsData (array or JSON string)
 * @param {any}    discountRaw      - EDiscountData fallback
 * @returns {number} rounded net payable after billing terms
 */
function applyBillingTermsToAmount(grossAmount, basicAmount, cgstRate, sgstRate, billingTermsRaw, discountRaw) {
  const terms = parseJsonArray(billingTermsRaw);
  let activeTerms = terms.filter((t) => t.applicable);

  if (activeTerms.length === 0 && discountRaw) {
    try {
      const d = typeof discountRaw === "string" ? JSON.parse(discountRaw) : discountRaw;
      if (d && d.applicable) activeTerms = [d];
    } catch { /* ignore */ }
  }

  if (activeTerms.length === 0) return Math.round(grossAmount);

  const preGstTerms  = activeTerms.filter((t) => t.appliedOn !== "post-gst");
  const postGstTerms = activeTerms.filter((t) => t.appliedOn === "post-gst");

  let running;
  if (preGstTerms.length === 0) {
    running = roundMoney(toNumber(grossAmount));
  } else {
    let runningBase = toNumber(basicAmount);
    for (const t of preGstTerms) {
      const amt = t.type === "percentage"
        ? (runningBase * toNumber(t.value)) / 100
        : toNumber(t.value);
      if (t.deductionType === "Addition") runningBase += amt;
      else runningBase = Math.max(0, runningBase - Math.min(amt, runningBase));
    }
    const cgstAmt = (runningBase * toNumber(cgstRate)) / 100;
    const sgstAmt = (runningBase * toNumber(sgstRate)) / 100;
    running = roundMoney(runningBase + cgstAmt + sgstAmt);
  }

  for (const t of postGstTerms) {
    const amt = t.type === "percentage"
      ? (running * toNumber(t.value)) / 100
      : toNumber(t.value);
    if (t.deductionType === "Addition") running += amt;
    else running = Math.max(0, running - Math.min(amt, running));
  }

  return Math.round(running);
}

module.exports = { applyBillingTermsToAmount };
