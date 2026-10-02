// Pricing and apportionment for a booking that carries several units.
//
// THE RULE, as specified: when a buyer takes 2-3 plots together the sale is
// "calculated as a single unit" — the combined area is the basis and one rate
// applies to it, rather than each plot being priced independently and summed.
// Plots are different sizes, so combined area is a real sum, not size x count.
//
// APPORTIONMENT IS NOT REDUNDANT WITH THE TOTAL. Registration happens per plot:
// each has its own survey / sub-division number, its own conveyance deed and its
// own stamp duty. So the single consideration has to be split back across the
// plots and STORED, or someone recomputes it by hand at every registration and
// eventually gets it wrong. The same split is what a partial cancellation
// (a buyer returning one plot of three) works from.
//
// PER-PLOT OVERRIDES are supported but off by default. A line whose own
// RatePerSqFt is set is priced on its own area instead of joining the pooled
// combined-area calculation, and PremiumAmount (corner, park-facing, road width)
// is added to that line alone. Both are NULL in the normal case, so the plain
// "one rate on combined area" behaviour needs no configuration — and adopting
// premiums later needs no schema change and no restatement of past bookings.

// Money is rounded to paise. Compare and store at 2dp so an apportionment can
// be reconciled against the booking total exactly.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v) => (v == null || v === "" ? null : Number(v));

/**
 * Split `total` across `weights` proportionally, guaranteeing the parts sum to
 * `total` exactly at 2dp.
 *
 * Proportional shares almost never divide cleanly, so the residual paise are
 * given to the LAST entry rather than being dropped. Dropping them is what makes
 * a set of deed values fail to add up to the agreement value — a discrepancy a
 * sub-registrar will query.
 *
 * Zero or absent weights fall back to an equal split, so a booking whose plots
 * have no recorded area still produces a usable, exact split instead of NaN.
 */
function apportion(total, weights) {
  const amount = round2(total || 0);
  const w = weights.map((x) => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  if (!w.length) return [];

  const sum = w.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? w : w.map(() => 1);
  const effectiveSum = sum > 0 ? sum : w.length;

  const parts = effective.map((x) => round2((amount * x) / effectiveSum));
  // Hand the rounding residual to the last line so the parts reconcile exactly.
  const allocated = parts.slice(0, -1).reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = round2(amount - allocated);
  return parts;
}

/**
 * Price a booking from its unit lines.
 *
 * @param {Array} lines  [{ unitId, areaSqFt, ratePerSqFt?, premiumAmount? }]
 * @param {number} ratePerSqFt  booking-level rate, applied to the COMBINED area
 *                              of every line that has no rate of its own.
 * @returns {{combinedArea, pooledArea, baseValue, premiumTotal, total, lines}}
 *          `lines` carries allocatedValue per unit, summing exactly to `total`.
 */
function priceBooking({ lines = [], ratePerSqFt = null } = {}) {
  const rate = num(ratePerSqFt);

  const prepared = lines.map((l) => {
    const area = num(l.areaSqFt) ?? 0;
    const ownRate = num(l.ratePerSqFt);
    const premium = num(l.premiumAmount) ?? 0;
    return { ...l, area, ownRate, premium, pooled: ownRate == null };
  });

  const combinedArea = round2(prepared.reduce((a, l) => a + l.area, 0));
  const pooledLines = prepared.filter((l) => l.pooled);
  const pooledArea = round2(pooledLines.reduce((a, l) => a + l.area, 0));

  // The "single unit" calculation: one rate against the combined pooled area.
  const pooledValue = rate != null ? round2(pooledArea * rate) : 0;
  // Independently-rated lines price on their own area.
  const ownValue = round2(
    prepared.filter((l) => !l.pooled).reduce((a, l) => a + l.area * l.ownRate, 0),
  );
  const premiumTotal = round2(prepared.reduce((a, l) => a + l.premium, 0));
  const baseValue = round2(pooledValue + ownValue);
  const total = round2(baseValue + premiumTotal);

  // Pooled lines split the pooled value by area; independently-rated lines keep
  // their own. Premiums attach to the line that earned them, never spread.
  const pooledShares = apportion(pooledValue, pooledLines.map((l) => l.area));
  let i = 0;
  const pricedLines = prepared.map((l) => {
    const share = l.pooled ? pooledShares[i++] : round2(l.area * l.ownRate);
    return {
      unitId: l.unitId,
      areaSqFt: l.area,
      ratePerSqFt: l.ownRate,
      premiumAmount: round2(l.premium),
      allocatedValue: round2(share + l.premium),
    };
  });

  return { combinedArea, pooledArea, baseValue, premiumTotal, total, lines: pricedLines };
}

/**
 * Apportion an ALREADY-AGREED consideration across lines — the negotiated case,
 * where the parties settled on a lump sum rather than a rate. Pro-rata by area,
 * reconciling exactly to `totalConsideration`.
 */
function allocateConsideration({ lines = [], totalConsideration = 0 } = {}) {
  const parts = apportion(totalConsideration, lines.map((l) => num(l.areaSqFt) ?? 0));
  return lines.map((l, i) => ({
    unitId: l.unitId,
    areaSqFt: num(l.areaSqFt) ?? 0,
    allocatedValue: parts[i],
  }));
}

module.exports = { apportion, priceBooking, allocateConsideration, round2 };
