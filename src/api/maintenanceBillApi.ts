import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/maintenance-bills";

export interface MaintenanceBillListRow {
  Id: number;
  BillNo: string;
  BillDate: string | null;
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
  ChargeHeadId: number;
  ChargeHeadName: string;
  HsnId: number | null;
  HsnCode: string | null;
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

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

export const getMaintenanceBills = (filters: BillFilters = {}): Promise<MaintenanceBillListRow[]> => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchWithAuth(`${BASE}${suffix}`).then((r) => r.json().catch(() => []));
};

export const getMaintenanceBill = async (id: number | string): Promise<MaintenanceBillDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw await readError(res, "Failed to load bill");
  return res.json();
};

export const createMaintenanceBill = async (bookingId: number, chargeHeadIds: number[]) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, chargeHeadIds }),
  });
  if (!res.ok) throw await readError(res, "Failed to create bill");
  return res.json();
};

export const updateMaintenanceBill = async (id: number | string, chargeHeadIds: number[]) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargeHeadIds }),
  });
  if (!res.ok) throw await readError(res, "Failed to update bill");
  return res.json();
};

export const cancelMaintenanceBill = async (id: number | string, reason?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw await readError(res, "Failed to cancel bill");
  return res.json();
};
