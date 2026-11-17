import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/maintenance";

export interface MaintenanceDirectoryRow {
  Id: number;
  BookingNo: string;
  BookingDate: string | null;
  TotalValue: number | null;
  Status: string;
  CustomerName: string | null;
  ContactNumber: string | null;
  Email: string | null;
  UnitNo: string | null;
  BlockName: string | null;
  ProjectName: string | null;
  CompanyName: string | null;
  HandoverDate: string | null;
}

export interface MaintenanceCustomerCharge {
  Id: number;
  BookingId: number;
  ChargeHeadId: number;
  ChargeHeadName: string;
  BaseAmount: number;
  TaxPct: number;
  TaxAmount: number;
  TotalAmount: number;
  Status: boolean;
  CreatedAt: string | null;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

export const getMaintenanceDirectory = (search?: string): Promise<MaintenanceDirectoryRow[]> => {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return fetchWithAuth(`${BASE}/directory${qs}`).then((r) => r.json().catch(() => []));
};

export const getMaintenanceCustomer = async (bookingId: string | number): Promise<MaintenanceDirectoryRow> => {
  const res = await fetchWithAuth(`${BASE}/customers/${bookingId}`);
  if (!res.ok) throw await readError(res, "Failed to load customer");
  return res.json();
};

export const getMaintenanceCharges = (bookingId: string | number): Promise<MaintenanceCustomerCharge[]> =>
  fetchWithAuth(`${BASE}/customers/${bookingId}/charges`).then((r) => r.json().catch(() => []));

export const getMaintenancePayments = (bookingId: string | number): Promise<unknown[]> =>
  fetchWithAuth(`${BASE}/customers/${bookingId}/payments`).then((r) => r.json().catch(() => []));

export const addMaintenanceCharge = async (bookingId: string | number, chargeHeadId: number) => {
  const res = await fetchWithAuth(`${BASE}/customers/${bookingId}/charges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargeHeadId }),
  });
  if (!res.ok) throw await readError(res, "Failed to add charge");
  return res.json().catch(() => ({}));
};

export const removeMaintenanceCharge = async (bookingId: string | number, chargeId: number) => {
  const res = await fetchWithAuth(`${BASE}/customers/${bookingId}/charges/${chargeId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await readError(res, "Failed to remove charge");
  return res.json().catch(() => ({}));
};

// ── Key Custodian ─────────────────────────────────────────────────────────────

export interface KeyCustodianUnitRow {
  UnitId: number;
  UnitName: string;
  BlockId: number;
  BlockName: string;
  ProjectId: number;
  ProjectName: string | null;
  BookingId: number | null;
  BookingNo: string | null;
  ApplicantName: string | null;
  CustodianName: string | null;
  CustodianType: string | null;
  HandedOverOn: string | null;
}

export interface KeyCustodianRecord {
  CustodianType: string;
  CustodianName: string;
  CustodianPhone: string | null;
  KeyCount: number | null;
  KeyTagNo: string | null;
  HandedOverOn: string | null;
  HandedOverBy: string | null;
  Remarks: string | null;
  UpdatedBy?: string | null;
  UpdatedAt?: string | null;
  CreatedBy?: string | null;
  CreatedAt?: string | null;
}

export interface KeyCustodianUnitDetail {
  unit: { UnitId: number; UnitName: string; BlockId: number; BlockName: string; ProjectId: number; ProjectName: string | null; BookingId: number | null };
  booking: {
    Id: number; BookingNo: string; BookingDate: string | null; ConfirmedAt: string | null; ConfirmedBy: string | null;
    Status: string | null; WorkflowStage: string | null; FloorName: string | null; UnitType: string | null;
    CarpetAreaSqFt: number | null; BuiltUpAreaSqFt: number | null; SuperBuiltUpAreaSqFt: number | null; AreaSqFt: number | null;
    TotalValue: number | null; GrandTotal: number | null; CompanyName: string | null;
    ApplicationNo: string | null; ApplicantName: string; Mobile: string | null; AltMobile: string | null; Email: string | null;
  } | null;
  coApplicants: { Name: string; Relation: string | null; Mobile: string | null; Email: string | null }[];
  parking: { ParkingSlotNo: string | null; Quantity: number; ParkingType: string | null }[];
  handover: { Status: string; ScheduledDate: string | null; ActualHandoverDate: string | null; KeyHandoverByName: string | null } | null;
  handedOver: boolean;
  custodian: KeyCustodianRecord | null;
  custodianTypes: string[];
}

const KC = "/api/maintenance-key-custodian";

async function kcJson<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `${what}: ${res.status}`);
  return body as T;
}

export const getKeyCustodianUnits = async (): Promise<KeyCustodianUnitRow[]> =>
  kcJson<KeyCustodianUnitRow[]>(await fetchWithAuth(`${KC}/units`), "Failed to load units");

export const getKeyCustodianUnit = async (unitId: number): Promise<KeyCustodianUnitDetail> =>
  kcJson<KeyCustodianUnitDetail>(await fetchWithAuth(`${KC}/units/${unitId}`), "Failed to load the unit");

export const saveKeyCustodian = async (unitId: number, record: KeyCustodianRecord): Promise<void> => {
  await kcJson(await fetchWithAuth(`${KC}/units/${unitId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  }), "Failed to save");
};
