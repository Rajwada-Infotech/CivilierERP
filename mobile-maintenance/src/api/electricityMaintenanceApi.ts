// RN client for Electricity Maintenance. Add Meter Reading gets full
// depth — staff physically at the meter, entering the number is the
// on-site action. Tariff/provider config, bill generation/verification
// and reports stay read-only here or omitted; do those on web. Mirrors
// web's src/api/electricityMaintenanceApi.ts shapes (trimmed).
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}
async function mutate<T>(url: string, method: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json().catch(() => ({} as T));
}
function toQs(params: object): string {
  const p = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface MeterRow {
  Id: number;
  BookingId: number;
  BookingNo: string;
  CustomerName: string;
  UnitNo: string | null;
  BlockName: string | null;
  ProjectName: string | null;
  MeterBoxNumber: string | null;
  MeterNumber: string;
  ProviderName: string;
  BillingCycle: "Monthly" | "3 Monthly";
  Status: "Active" | "Inactive" | "Transferred" | "Disconnected";
  LatestPreviousReading: number | null;
  LatestCurrentReading: number | null;
  LatestUnitsConsumed: number | null;
  LatestBillStatus: string | null;
  HandoverStatus: "Not Handed Over" | "Handover Scheduled" | "Handover Completed";
  HandoverDate: string | null;
}

export interface NextReadingInfo {
  meterId: number;
  previousReading: number;
  periodFrom: string;
  periodTo: string;
  handoverStatus: "Not Handed Over" | "Handover Scheduled" | "Handover Completed";
  handoverDate: string | null;
}

export interface MeterReadingRow {
  Id: number;
  MeterId: number;
  BillingPeriodFrom: string;
  BillingPeriodTo: string;
  ReadingDate: string;
  PreviousReading: number;
  CurrentReading: number;
  UnitsConsumed: number;
  ReadingType: "Regular" | "Handover" | "Correction";
  IsSuperseded: boolean;
}

export interface DashboardSummary {
  totalMeters: number;
  readingPending: number;
  billsGenerated: number;
  currentAmount: number;
}

export interface MeterFilters {
  search?: string; providerId?: number | string; billingCycle?: string; status?: string;
  project?: string; tower?: string; handoverStatus?: string; billStatus?: string;
}

export const getMeters = (filters: MeterFilters = {}): Promise<MeterRow[]> =>
  getJson(`/api/electricity-maintenance/meters${toQs(filters)}`, "Failed to load meters");

export const getMeter = (id: number): Promise<MeterRow> =>
  getJson(`/api/electricity-maintenance/meters/${id}`, "Failed to load meter");

export const getNextReadingInfo = (meterId: number): Promise<NextReadingInfo> =>
  getJson(`/api/electricity-maintenance/meters/${meterId}/next-reading-info`, "Failed to load reading info");

export const getMeterReadings = (meterId: number): Promise<MeterReadingRow[]> =>
  getJson(`/api/electricity-maintenance/meters/${meterId}/readings`, "Failed to load reading history");

export const getElectricityDashboard = (): Promise<DashboardSummary> =>
  getJson("/api/electricity-maintenance/dashboard", "Failed to load dashboard");

// ── The headline action ─────────────────────────────────────────────────
export const recordReading = (meterId: number, payload: { currentReading: number; readingDate: string; readingType?: "Regular" | "Handover" }) =>
  mutate<{ id: number; unitsConsumed: number; periodFrom: string; periodTo: string; message: string }>(
    `/api/electricity-maintenance/meters/${meterId}/readings`, "POST", payload, "Failed to record reading",
  );
