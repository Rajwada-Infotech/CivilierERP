// RN client for Charge Head master — read-only here, just the active-list
// count DashboardScreen needs (mirrors web's src/api/chargeHeadApi.ts
// getActiveChargeHeads; creation/edit stays on web, same rule as this
// module's other masters).
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface ChargeHeadRow {
  Id: number;
  Name: string;
  Rate: number;
  TaxPct: number;
  Status: boolean;
}

export const getActiveChargeHeads = async (): Promise<ChargeHeadRow[]> => {
  const res = await fetchWithAuth("/api/charge-head");
  const rows: ChargeHeadRow[] = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows : []).filter((r) => r.Status !== false);
};
