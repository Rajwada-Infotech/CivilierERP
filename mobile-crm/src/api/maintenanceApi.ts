// RN client for the Maintenance Customer Directory. Mirrors the web app's
// src/api/maintenanceApi.ts shape (same backend route: /api/maintenance).
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

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

export const getMaintenanceDirectory = (search?: string): Promise<MaintenanceDirectoryRow[]> => {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return getJson(`/api/maintenance/directory${qs}`, "Failed to load customer directory");
};

export const getMaintenanceCustomer = (bookingId: number | string): Promise<MaintenanceDirectoryRow> =>
  getJson(`/api/maintenance/customers/${bookingId}`, "Failed to load customer");

export const getMaintenancePayments = (bookingId: number | string): Promise<unknown[]> =>
  getJson(`/api/maintenance/customers/${bookingId}/payments`, "Failed to load payment history");

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

export const getMaintenanceCharges = (bookingId: number | string): Promise<MaintenanceCustomerCharge[]> =>
  getJson(`/api/maintenance/customers/${bookingId}/charges`, "Failed to load charges");

export const addMaintenanceCharge = async (bookingId: number | string, chargeHeadId: number): Promise<void> => {
  const res = await fetchWithAuth(`/api/maintenance/customers/${bookingId}/charges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargeHeadId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to add charge");
  }
};

export const removeMaintenanceCharge = async (bookingId: number | string, chargeId: number): Promise<void> => {
  const res = await fetchWithAuth(`/api/maintenance/customers/${bookingId}/charges/${chargeId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to remove charge");
  }
};
