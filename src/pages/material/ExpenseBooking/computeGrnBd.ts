import type { DiscountConfig, GRNItemLine, PriceBreakdown } from "./types";

export interface GrnBdBreakdown {
  items: GRNItemLine[];
  totals: {
    totalBase: number;
    totalCGST: number;
    totalSGST: number;
    totalGST: number;
    totalInclGST: number;
  };
}

/**
 * GRN-linked expense booking price breakdown: base = qty*rate, real
 * CGST/SGST from the GRN's own GST breakdown, active billing terms applied
 * correctly:
 *   - Before GST terms: adjust base first, then recompute GST proportionally
 *     on the adjusted base
 *   - After GST terms:  compute GST on the (adjusted) base, then apply the
 *     term on the gross
 */
export function computeGrnBd(
  basicAmount: number,
  billingTerms: DiscountConfig[],
  gstBreakdown: GrnBdBreakdown | null,
): PriceBreakdown {
  const base = basicAmount;
  const origCGST = gstBreakdown?.totals.totalCGST ?? 0;
  const origSGST = gstBreakdown?.totals.totalSGST ?? 0;
  const origBase = gstBreakdown?.totals.totalBase ?? base;
  const rawGross =
    gstBreakdown?.totals.totalInclGST ?? base + origCGST + origSGST;

  // Derive effective GST rates from GRN item totals (weighted average)
  const effectiveCGSTRate = origBase > 0 ? (origCGST / origBase) * 100 : 0;
  const effectiveSGSTRate = origBase > 0 ? (origSGST / origBase) * 100 : 0;

  const activeTerms = (billingTerms ?? [])
    .filter((t) => t.applicable)
    .map((t) => ({
      ...t,
      termType: (t.deductionType ?? "Deduction") as "Addition" | "Deduction",
    }));
  const preTerms = activeTerms.filter((t) => t.appliedOn !== "post-gst");
  const postTerms = activeTerms.filter((t) => t.appliedOn === "post-gst");

  // Step 1: Apply pre-GST terms to get taxable base
  let runningBase = base;
  for (const t of preTerms) {
    const amt =
      t.type === "percentage"
        ? (runningBase * (t.value ?? 0)) / 100
        : (t.value ?? 0);
    if (t.termType === "Addition") runningBase += amt;
    else runningBase = Math.max(0, runningBase - amt);
  }
  const taxable = Math.round(runningBase * 100) / 100;

  // Step 2: Recompute GST on the adjusted taxable base (proportional rates from GRN items)
  const adjCGST =
    preTerms.length > 0
      ? Math.round(((taxable * effectiveCGSTRate) / 100) * 100) / 100
      : origCGST;
  const adjSGST =
    preTerms.length > 0
      ? Math.round(((taxable * effectiveSGSTRate) / 100) * 100) / 100
      : origSGST;
  const effectiveGross =
    preTerms.length > 0
      ? Math.round((taxable + adjCGST + adjSGST) * 100) / 100
      : rawGross;

  // Step 3: Apply post-GST terms on the gross
  let running = effectiveGross;
  for (const t of postTerms) {
    const amt =
      t.type === "percentage"
        ? (running * (t.value ?? 0)) / 100
        : (t.value ?? 0);
    if (t.termType === "Addition") running += amt;
    else running = Math.max(0, running - amt);
  }
  const net = Math.round(running * 100) / 100;

  return {
    basicAmount: base,
    discountAmount: effectiveGross - net,
    taxableAmount: taxable,
    cgstAmount: adjCGST,
    sgstAmount: adjSGST,
    igstAmount: 0,
    grossAmount: effectiveGross,
    roundOff: 0,
    netAmount: net,
    preGstTerms: preTerms,
    postGstTerms: postTerms,
  };
}
