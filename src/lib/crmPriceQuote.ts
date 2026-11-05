// The price of a sale before its booking exists — unit value, GST, parking,
// extra charges, Grand Total and the payment schedule — worked out by the
// server with the same functions that price the real booking
// (backend/services/crmPriceQuote.js). The application screens show this
// instead of working the figures out themselves, so a quote and the booking it
// becomes can't disagree.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type PriceQuoteInput = {
  unitIds: (string | number)[];
  plotIds: (string | number)[];
  ratePerSqFt?: string | number | null;
  parkingBases?: number[];   // each slot's pre-tax charge
  extraAmounts?: number[];   // each extra charge's pre-tax amount
  paymentPlanId?: string | number | null;
  bookingAmount?: string | number | null;
  customerId?: string | number | null;
};

type Line = { base: number; gst: number; total: number };

export type PriceQuote = {
  areaSqFt: number;
  ratePerSqFt: number | null;
  unitValue: number;
  landValue: number;
  constructionValue: number;
  isLandSale: boolean;
  isGstExempt: boolean;
  hsnCode: string | null;
  gstRate: number;
  parking: Line[];
  parkingBase: number;
  parkingTotal: number;
  extraRate: number;
  extras: Line[];
  extraChargesTotal: number;
  extraWorkGstAmount: number;
  unitGstAmount: number;
  parkingGstAmount: number;
  unitParkingGstAmount: number;
  totalGstAmount: number;
  grandTotal: number;
  schedule: { no: number; name: string; pct: number | null; amount: number }[];
};

async function fetchPriceQuote(input: PriceQuoteInput): Promise<PriceQuote> {
  const r = await fetchWithAuth("/api/crm/applications/price-quote", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Couldn't work out the price");
  return data;
}

/** Pass null until a unit or plot is picked. Keeps the last figures while a new one loads. */
export function usePriceQuote(input: PriceQuoteInput | null) {
  const enabled = !!input && (input.unitIds.length > 0 || input.plotIds.length > 0);
  return useQuery({
    queryKey: ["crm-price-quote", input],
    queryFn: () => fetchPriceQuote(input as PriceQuoteInput),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Money to the paisa, the same rule as the server (backend/services/bookingUnits.js round2 / sumMoney).
 * Amounts arrive exact but are JS numbers, and adding or subtracting them leaves float dust: a balance that is
 * really nothing can read ₹0.0000001, so "outstanding > 0" shows "₹0.00 due" instead of "Fully collected".
 * Every money sum or difference a CRM screen works out goes through these.
 */
export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sumMoney = <T,>(rows: readonly T[] | null | undefined, pick: (r: T) => unknown = (x) => x) =>
  round2((rows || []).reduce((s, r) => s + (Number(pick(r)) || 0), 0));

/** Indian-format rupees, paise only when there are any. */
export function inr(n: number | null | undefined): string {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
