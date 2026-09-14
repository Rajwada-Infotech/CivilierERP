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
