// Straight-line depreciation estimate — identical math to the web app's
// FixedAssetRecord.calcDepreciation() (time-since-purchase × annual rate,
// capped at cost). Used for list KPIs and the form's live preview; the
// authoritative monthly figures come from the backend posting plan.
export interface DepCalc {
  years: number;
  annualDep: number;
  totalDep: number;
  bookValue: number;
}

export function calcDepreciation(
  purchaseCost: number,
  rate: number | null | undefined,
  purchaseDate: string | null | undefined,
): DepCalc | null {
  if (!purchaseCost || !rate || !purchaseDate) return null;
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / msPerYear);
  const annualDep = purchaseCost * (rate / 100);
  const totalDep = Math.min(purchaseCost, annualDep * years);
  const bookValue = Math.max(0, purchaseCost - totalDep);
  return { years: parseFloat(years.toFixed(2)), annualDep, totalDep, bookValue };
}

export function bookValueOf(
  cost: number,
  rate: number | null | undefined,
  purchaseDate: string | null | undefined,
): number {
  const dc = calcDepreciation(cost, rate, purchaseDate);
  return dc ? dc.bookValue : cost || 0;
}
