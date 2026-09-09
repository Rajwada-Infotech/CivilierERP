// RN client for Maintenance Bills — mirrors web's src/api/maintenanceBillApi.ts
// shapes and endpoints, create/edit/cancel included.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error((body as { error?: string; message?: string } | null)?.error || (body as { message?: string } | null)?.message || fallback);
}

export interface MaintenanceBillListRow {
  Id: number;
  BillNo: string;
  BillDate: string | null;
  DueDate: string | null;
  PeriodFrom: string | null;
  PeriodTo: string | null;
  Notes: string | null;
  Subtotal: number;
  TotalTax: number;
  GrandTotal: number;
  Status: "Active" | "Cancelled";
  CancelReason: string | null;
  CreatedAt: string | null;
  CustomerName: string | null;
  UnitNo: string | null;
  BlockName: string | null;
  BookingId: number;
  BookingNo: string;
}

export interface MaintenanceBillItem {
  Id: number;
  ChargeHeadId: number | null;
  ChargeHeadName: string;
  Rate: number;
  TaxPct: number;
  TaxAmount: number;
  TotalAmount: number;
}

export interface MaintenanceBillDetail extends MaintenanceBillListRow {
  items: MaintenanceBillItem[];
  CompanyName: string | null;
  CompanyAddress: string | null;
  CompanyAddressLine2: string | null;
  CompanyCity: string | null;
  CompanyState: string | null;
  CompanyPincode: string | null;
  CompanyGstNo: string | null;
}

export interface BillFilters {
  search?: string;
  bookingId?: number | string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const getMaintenanceBills = (filters: BillFilters = {}): Promise<MaintenanceBillListRow[]> => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.set(k, String(v)); });
  const s = qs.toString();
  return getJson(`/api/maintenance-bills${s ? `?${s}` : ""}`, "Failed to load maintenance bills");
};

export const getMaintenanceBill = (id: number | string): Promise<MaintenanceBillDetail> =>
  getJson(`/api/maintenance-bills/${id}`, "Failed to load bill");

export interface BillExtras {
  dueDate?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  notes?: string | null;
}

export const createMaintenanceBill = async (
  bookingId: number,
  chargeHeadIds: number[],
  extras: BillExtras = {},
) => {
  const res = await fetchWithAuth("/api/maintenance-bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, chargeHeadIds, ...extras }),
  });
  if (!res.ok) throw await readError(res, "Failed to create bill");
  return res.json();
};

export const updateMaintenanceBill = async (
  id: number | string,
  chargeHeadIds: number[],
  extras: BillExtras = {},
) => {
  const res = await fetchWithAuth(`/api/maintenance-bills/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargeHeadIds, ...extras }),
  });
  if (!res.ok) throw await readError(res, "Failed to update bill");
  return res.json();
};

export const cancelMaintenanceBill = async (id: number | string, reason?: string) => {
  const res = await fetchWithAuth(`/api/maintenance-bills/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw await readError(res, "Failed to cancel bill");
  return res.json();
};
