import { fetchWithAuth } from "@/lib/fetchWithAuth";

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

export interface ElectricityTariffSlab {
  Id?: number;
  SlabFrom: number;
  SlabTo: number | null;
  RatePerUnit: number;
}

export interface ElectricityTariff {
  Id: number;
  ProviderId: number;
  ProviderName: string;
  TariffName: string;
  EffectiveFrom: string;
  EffectiveTo: string | null;
  BillingCycle: "Monthly" | "3 Monthly";
  FixedCharge: number;
  MinimumCharge: number;
  AdditionalCharge: number;
  Status: "Active" | "Inactive";
  SlabCount?: number;
  slabs?: ElectricityTariffSlab[];
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
  ProviderId: number;
  ProviderName: string;
  ConnectionType: string | null;
  MeterType: string | null;
  BillingCycle: "Monthly" | "3 Monthly";
  OpeningReading: number;
  OpeningReadingDate: string | null;
  MeterInstallationDate: string | null;
  Status: "Active" | "Inactive" | "Transferred" | "Disconnected";
  Remarks: string | null;
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
  IsHandoverReading: boolean;
  IsSuperseded: boolean;
  EnteredBy: string | null;
  CorrectionReason: string | null;
  CorrectionApprovedBy: string | null;
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

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}
async function getJson<T>(path: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`);
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}
async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}
async function putJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}
function qs(params: object): string {
  const p = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Providers ────────────────────────────────────────────────────────────
export const getElectricityProviders = () => getJson<ElectricityProvider[]>("/providers", "Failed to load providers");
export const createElectricityProvider = (payload: { name: string; code?: string; state?: string; billingMethod?: string; remarks?: string }) =>
  postJson<{ id: number; message: string }>("/providers", payload, "Failed to create provider");
export const updateElectricityProvider = (id: number, payload: { name: string; code?: string; state?: string; billingMethod?: string; status?: string; remarks?: string }) =>
  putJson<{ message: string }>(`/providers/${id}`, payload, "Failed to update provider");

// ── Tariffs ──────────────────────────────────────────────────────────────
export const getElectricityTariffs = () => getJson<ElectricityTariff[]>("/tariffs", "Failed to load tariffs");
export const getElectricityTariff = (id: number) => getJson<ElectricityTariff>(`/tariffs/${id}`, "Failed to load tariff");
export interface TariffPayload {
  providerId: number; tariffName: string; effectiveFrom: string; effectiveTo?: string | null;
  billingCycle: string; fixedCharge?: number; minimumCharge?: number; additionalCharge?: number; status?: string;
  slabs: { slabFrom: number; slabTo: number | null; ratePerUnit: number }[];
}
export const createElectricityTariff = (payload: TariffPayload) => postJson<{ id: number; message: string }>("/tariffs", payload, "Failed to create tariff");
export const updateElectricityTariff = (id: number, payload: TariffPayload) => putJson<{ message: string }>(`/tariffs/${id}`, payload, "Failed to update tariff");

// ── Meters ───────────────────────────────────────────────────────────────
export interface MeterFilters { search?: string; providerId?: number | string; billingCycle?: string; status?: string; project?: string; tower?: string }
export const getMeters = (filters: MeterFilters = {}) => getJson<MeterRow[]>(`/meters${qs(filters)}`, "Failed to load meters");
export const getMeter = (id: number) => getJson<MeterRow>(`/meters/${id}`, "Failed to load meter");
export interface MeterPayload {
  bookingId: number; meterBoxNumber?: string; meterNumber: string; providerId: number;
  connectionType?: string; meterType?: string; billingCycle?: string;
  openingReading?: number; openingReadingDate?: string; meterInstallationDate?: string; remarks?: string;
}
export const createMeter = (payload: MeterPayload) => postJson<{ id: number; message: string }>("/meters", payload, "Failed to create meter");
export const updateMeter = (id: number, payload: { meterBoxNumber?: string; providerId: number; connectionType?: string; meterType?: string; billingCycle?: string; status?: string; remarks?: string }) =>
  putJson<{ message: string }>(`/meters/${id}`, payload, "Failed to update meter");
export const getNextReadingInfo = (meterId: number) => getJson<NextReadingInfo>(`/meters/${meterId}/next-reading-info`, "Failed to load reading info");

// ── Readings ─────────────────────────────────────────────────────────────
export const getMeterReadings = (meterId: number) => getJson<MeterReadingRow[]>(`/meters/${meterId}/readings`, "Failed to load reading history");
export const recordReading = (meterId: number, payload: { currentReading: number; readingDate: string; readingType?: "Regular" | "Handover" }) =>
  postJson<{ id: number; unitsConsumed: number; periodFrom: string; periodTo: string; message: string }>(`/meters/${meterId}/readings`, payload, "Failed to record reading");
export const correctReading = (readingId: number, payload: { correctedCurrentReading: number; reason: string; approvedBy: string }) =>
  putJson<{ id: number; message: string }>(`/readings/${readingId}/correct`, payload, "Failed to correct reading");

// ── Bills ────────────────────────────────────────────────────────────────
export const previewBill = (meterId: number, periodFrom: string, periodTo: string) =>
  getJson<BillPreview>(`/bills/preview${qs({ meterId, periodFrom, periodTo })}`, "Failed to preview bill");
export const generateBill = (payload: { meterId: number; periodFrom: string; periodTo: string }) =>
  postJson<{ id: number; message: string; totalAmount: number }>("/bills", payload, "Failed to generate bill");
export interface BillFilters { meterId?: number; bookingId?: number; providerId?: number; billStatus?: string; dateFrom?: string; dateTo?: string }
export const getElectricityBills = (filters: BillFilters = {}) => getJson<ElectricityBillRow[]>(`/bills${qs(filters)}`, "Failed to load bills");
export const getElectricityBill = (id: number) => getJson<ElectricityBillRow>(`/bills/${id}`, "Failed to load bill");
export const verifyBill = (id: number) => postJson<{ message: string }>(`/bills/${id}/verify`, {}, "Failed to verify bill");
export const addBillToCustomerBill = (id: number, maintenanceBillId: number) =>
  postJson<{ message: string }>(`/bills/${id}/add-to-customer-bill`, { maintenanceBillId }, "Failed to add to customer bill");
export const cancelBill = (id: number, reason: string) => postJson<{ message: string }>(`/bills/${id}/cancel`, { reason }, "Failed to cancel bill");

// ── Dashboard & Reports ──────────────────────────────────────────────────
export const getElectricityDashboard = () => getJson<DashboardSummary>("/dashboard", "Failed to load dashboard");
export const getMonthlyReport = (dateFrom?: string, dateTo?: string) => getJson<MonthlyReport>(`/reports/monthly${qs({ dateFrom, dateTo })}`, "Failed to load report");
export const getProviderWiseReport = (dateFrom?: string, dateTo?: string) => getJson<ProviderWiseReportRow[]>(`/reports/provider-wise${qs({ dateFrom, dateTo })}`, "Failed to load report");
export const getCustomerWiseReport = (dateFrom?: string, dateTo?: string) => getJson<ElectricityBillRow[]>(`/reports/customer-wise${qs({ dateFrom, dateTo })}`, "Failed to load report");

// ── Audit ────────────────────────────────────────────────────────────────
export const getElectricityAuditLog = (filters: { meterId?: number; billId?: number; readingId?: number }) =>
  getJson<AuditLogRow[]>(`/audit-log${qs(filters)}`, "Failed to load audit log");
