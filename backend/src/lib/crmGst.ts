// Shared, frontend-side mirror of backend/services/crmGst.js — used ONLY to
// render live "what will this cost including GST" previews before a
// CrmBooking exists (Application wizard) or before an add/edit request is
// actually submitted (Parking & Extra Work tab). The real, authoritative
// calculation always happens server-side in crmGst.js; this exists purely so
// staff aren't flying blind until they hit Save. Rates are fetched live from
// dbo.HSN via GET /api/hsn — never hardcoded — so if the HSN Master rate
// changes, this preview changes with it automatically.
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const UNIT_PARKING_GST_THRESHOLD = 4500000; // Rs. 45,00,000
export const AFFORDABLE_HSN_CODE = "9954AFH";
export const OTHER_RESIDENTIAL_HSN_CODE = "9954OTH";
export const EXTRA_WORK_HSN_CODE = "9954EXW";

export type GstRates = {
  affordableRate: number; // % for Unit+Parking <= threshold
  otherRate: number;      // % for Unit+Parking > threshold
  extraWorkRate: number;  // % for Extra Work, always
};

function rateFromHsnRow(row: any): number {
  if (!row) return 0;
  const cgst = Number(row.HCGST || 0);
  const sgst = Number(row.HSGST || 0);
  return cgst + sgst > 0 ? cgst + sgst : Number(row.HIGST || 0);
}

async function fetchGstRates(): Promise<GstRates> {
  const r = await fetchWithAuth("/api/hsn");
  const rows = r.ok ? await r.json() : [];
  const byCode = (code: string) => (rows as any[]).find((h) => h.HCode === code && h.HStatus);
  return {
    affordableRate: rateFromHsnRow(byCode(AFFORDABLE_HSN_CODE)),
    otherRate: rateFromHsnRow(byCode(OTHER_RESIDENTIAL_HSN_CODE)),
    extraWorkRate: rateFromHsnRow(byCode(EXTRA_WORK_HSN_CODE)),
  };
}

// One shared query everywhere this is needed — cached, so adding this to
// five different steps of the same wizard doesn't mean five separate
// fetches of the HSN table.
export function useGstRates() {
  return useQuery({ queryKey: ["crm-gst-rates"], queryFn: fetchGstRates, staleTime: 5 * 60_000 });
}

export type UnitParkingGstResult = {
  hsnCode: string;
  rate: number;
  base: number;            // Unit + Parking, pre-tax (combined, decides the bracket)
  unitBase: number;
  unitGstAmount: number;
  unitTotal: number;       // unitBase + unitGstAmount
  parkingBase: number;
  parkingGstAmount: number;
  parkingTotal: number;    // parkingBase + parkingGstAmount
  gstAmount: number;       // unitGstAmount + parkingGstAmount (combined)
  total: number;           // base + gstAmount — matches GrandTotal's Unit+Parking share
};

// Same bracket rule AND same split as crmGst.js's recalculateBookingGst:
// Unit + Parking (pre-tax) <= Rs. 45L -> affordable rate, otherwise -> other-
// residential rate — but Unit and Parking each get GST added on their OWN
// base, not just a single blended figure, since that's what actually
// determines GrandTotal server-side (Unit's GST is genuinely part of what's
// owed, not a display-only number).
export function computeUnitParkingGst(unitValue: number, parkingBase: number, rates: GstRates): UnitParkingGstResult {
  const unitBase = Number(unitValue) || 0;
  const pBase = Number(parkingBase) || 0;
  const base = unitBase + pBase;
  const isAffordable = base <= UNIT_PARKING_GST_THRESHOLD;
  const rate = isAffordable ? rates.affordableRate : rates.otherRate;
  const unitGstAmount = Math.round(unitBase * rate) / 100;
  const parkingGstAmount = Math.round(pBase * rate) / 100;
  const gstAmount = Math.round((unitGstAmount + parkingGstAmount) * 100) / 100;
  return {
    hsnCode: isAffordable ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE,
    rate, base,
    unitBase, unitGstAmount, unitTotal: Math.round((unitBase + unitGstAmount) * 100) / 100,
    parkingBase: pBase, parkingGstAmount, parkingTotal: Math.round((pBase + parkingGstAmount) * 100) / 100,
    gstAmount, total: Math.round((base + gstAmount) * 100) / 100,
  };
}

export type ExtraWorkGstResult = { rate: number; base: number; gstAmount: number; total: number };

export function computeExtraWorkGst(amount: number, rates: GstRates): ExtraWorkGstResult {
  const base = Number(amount) || 0;
  const gstAmount = Math.round(base * rates.extraWorkRate) / 100;
  return { rate: rates.extraWorkRate, base, gstAmount, total: Math.round((base + gstAmount) * 100) / 100 };
}

export function fmtInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}
