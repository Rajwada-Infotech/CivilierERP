// RN client for Electricity Maintenance — full parity with web's
// src/api/electricityMaintenanceApi.ts: readings, bill preview/generate/
// verify/add-to-customer-bill/cancel, reading correction, reports, audit
// log. Provider/Tariff master CRUD stays out of scope here, same as web's
// own ElectricityMaintenance.tsx (those live on Meter Reading Master, a
// separate admin screen — meters themselves are read-only, pre-seeded
// there too).
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

const BASE = "/api/electricity-maintenance";

export interface ElectricityProvider {
  Id: number;
  Name: string;
  Code: string | null;
  State: string | null;
  BillingMethod: string | null;
  Status: "Active" | "Inactive";
  Remarks: string | null;
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
  LatestBillStatus: BillStatus | null;
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

export interface BillPreview {
  meterId: number;
  periodFrom: string;
  periodTo: string;
  customerName: string;
  unitNo: string | null;
  blockName: string | null;
  projectName: string | null;
  meterNumber: string;
  providerName: string;
  previousReading: number;
  currentReading: number;
  totalUnits: number;
  handoverStatus: string;
  handoverDate: string | null;
  handoverReading: number | null;
  rajwadaUnits: number;
  postHandoverUnits: number;
  tariffName: string;
  energyCharge: number;
  fixedCharge: number;
  otherCharge: number;
  totalAmount: number;
}

export type BillStatus = "PendingVerification" | "Verified" | "AddedToCustomerBill" | "Cancelled" | "Revised";

export interface ElectricityBillRow {
  Id: number;
  MeterId: number;
  BookingId: number;
  BookingNo: string;
  CustomerName: string;
  UnitNo: string | null;
  BlockName: string | null;
  ProjectName: string | null;
  MeterNumber: string;
  ProviderName: string;
  BillingPeriodFrom: string;
  BillingPeriodTo: string;
  TotalUnits: number;
  HandoverDate: string | null;
  HandoverReading: number | null;
  RajwadaUnits: number;
  PostHandoverUnits: number;
  EnergyCharge: number;
  FixedCharge: number;
  OtherCharge: number;
  TotalAmount: number;
  BillStatus: BillStatus;
  VerifiedBy: string | null;
  VerifiedAt: string | null;
  MaintenanceBillId: number | null;
  CancelReason: string | null;
  CreatedAt: string;
}

export interface DashboardSummary {
  totalMeters: number;
  readingPending: number;
  billsGenerated: number;
  currentAmount: number;
}

export interface MonthlyReport {
  totalMeters: number;
  readingsCompleted: number;
  totalUnitsConsumed: number;
  rajwadaSupplyUnits: number;
  postHandoverUnits: number;
  totalElectricityAmount: number;
}

export interface ProviderWiseReportRow {
  ProviderName: string;
  MeterCount: number;
  TotalUnits: number;
  TotalAmount: number;
}

export interface AuditLogRow {
  Id: number;
  Action: string;
  MeterId: number | null;
  ReadingId: number | null;
  BillId: number | null;
  BookingId: number | null;
  OldValue: string | null;
  NewValue: string | null;
  PerformedBy: string | null;
  PerformedAt: string;
  Remarks: string | null;
}

export interface MeterFilters {
  search?: string; providerId?: number | string; billingCycle?: string; status?: string;
  project?: string; tower?: string; handoverStatus?: string; billStatus?: string;
}

// ── Providers (read-only here — filter option list only) ──────────────────
export const getElectricityProviders = (): Promise<ElectricityProvider[]> =>
  getJson(`${BASE}/providers`, "Failed to load providers");

// ── Meters ───────────────────────────────────────────────────────────────
export const getMeters = (filters: MeterFilters = {}): Promise<MeterRow[]> =>
  getJson(`${BASE}/meters${toQs(filters)}`, "Failed to load meters");
export const getMeter = (id: number): Promise<MeterRow> =>
  getJson(`${BASE}/meters/${id}`, "Failed to load meter");
export const getNextReadingInfo = (meterId: number): Promise<NextReadingInfo> =>
  getJson(`${BASE}/meters/${meterId}/next-reading-info`, "Failed to load reading info");

// ── Readings ─────────────────────────────────────────────────────────────
export const getMeterReadings = (meterId: number): Promise<MeterReadingRow[]> =>
  getJson(`${BASE}/meters/${meterId}/readings`, "Failed to load reading history");
export const recordReading = (meterId: number, payload: { currentReading: number; readingDate: string; readingType?: "Regular" | "Handover" }) =>
  mutate<{ id: number; unitsConsumed: number; periodFrom: string; periodTo: string; message: string }>(
    `${BASE}/meters/${meterId}/readings`, "POST", payload, "Failed to record reading",
  );
export const correctReading = (readingId: number, payload: { correctedCurrentReading: number; reason: string; approvedBy: string }) =>
  mutate<{ id: number; message: string }>(`${BASE}/readings/${readingId}/correct`, "PUT", payload, "Failed to correct reading");

// ── Bills ────────────────────────────────────────────────────────────────
export const previewBill = (meterId: number, periodFrom: string, periodTo: string): Promise<BillPreview> =>
  getJson(`${BASE}/bills/preview${toQs({ meterId, periodFrom, periodTo })}`, "Failed to preview bill");
export const generateBill = (payload: { meterId: number; periodFrom: string; periodTo: string }) =>
  mutate<{ id: number; message: string; totalAmount: number }>(`${BASE}/bills`, "POST", payload, "Failed to generate bill");
export interface BillFilters { meterId?: number; bookingId?: number; providerId?: number; billStatus?: string; dateFrom?: string; dateTo?: string }
export const getElectricityBills = (filters: BillFilters = {}): Promise<ElectricityBillRow[]> =>
  getJson(`${BASE}/bills${toQs(filters)}`, "Failed to load bills");
export const getElectricityBill = (id: number): Promise<ElectricityBillRow> =>
  getJson(`${BASE}/bills/${id}`, "Failed to load bill");
export const verifyBill = (id: number) => mutate<{ message: string }>(`${BASE}/bills/${id}/verify`, "POST", {}, "Failed to verify bill");
export const addBillToCustomerBill = (id: number, maintenanceBillId: number) =>
  mutate<{ message: string }>(`${BASE}/bills/${id}/add-to-customer-bill`, "POST", { maintenanceBillId }, "Failed to add to customer bill");
export const cancelBill = (id: number, reason: string) =>
  mutate<{ message: string }>(`${BASE}/bills/${id}/cancel`, "POST", { reason }, "Failed to cancel bill");

// ── Dashboard & Reports ──────────────────────────────────────────────────
export const getElectricityDashboard = (): Promise<DashboardSummary> =>
  getJson(`${BASE}/dashboard`, "Failed to load dashboard");
export const getMonthlyReport = (dateFrom?: string, dateTo?: string): Promise<MonthlyReport> =>
  getJson(`${BASE}/reports/monthly${toQs({ dateFrom, dateTo })}`, "Failed to load report");
export const getProviderWiseReport = (dateFrom?: string, dateTo?: string): Promise<ProviderWiseReportRow[]> =>
  getJson(`${BASE}/reports/provider-wise${toQs({ dateFrom, dateTo })}`, "Failed to load report");
export const getCustomerWiseReport = (dateFrom?: string, dateTo?: string): Promise<ElectricityBillRow[]> =>
  getJson(`${BASE}/reports/customer-wise${toQs({ dateFrom, dateTo })}`, "Failed to load report");

// ── Audit ────────────────────────────────────────────────────────────────
export const getElectricityAuditLog = (filters: { meterId?: number; billId?: number; readingId?: number } = {}): Promise<AuditLogRow[]> =>
  getJson(`${BASE}/audit-log${toQs(filters)}`, "Failed to load audit log");
