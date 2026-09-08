// RN client for Maintenance Bills — read-only here (list + detail). Bill
// creation stays on web (charge-head picking / ledger-sheet building isn't
// an on-site action). Mirrors web's src/api/maintenanceBillApi.ts shapes.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
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
