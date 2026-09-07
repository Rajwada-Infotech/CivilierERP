// RN port of src/api/grnApi.ts + src/pages/material/grnRemainingItems.ts
// (the latter is pure logic, copied verbatim — no React/DOM deps). GRN
// sits between Vehicle In/Out and Purchase Order in size/complexity; scope
// for mobile: list + single detail view (Details only) + create/edit
// covering BOTH ways to source a GRN's line items (a locked Vehicle In/Out
// lot, or an editable "remaining items on this PO" quick-fill) — this dual
// sourcing IS the core of what a GRN does, not an extra worth trimming.
// Deferred to web-only: the Posting tab (GL journal preview + auto-post —
// same call as Payment's mobile port not auto-posting to GL), the quality
// debit-note flow, DocumentChainPanel/LinkedExpenseBookings, Stock-Transfer
// sourcing, CSV import (a stub on web too)/export, and print.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/grns";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GRNItemLine {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string;
  rate: number;
  quantity: number;
  totalAmount: number;
  gstPct: number;
  gstAmount: number;
}

export function createEmptyGRNItem(): GRNItemLine {
  return { itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0, uom: "", rate: 0, quantity: 0, totalAmount: 0, gstPct: 0, gstAmount: 0 };
}

export interface GRNFormDataPayload {
  grnNo: string;
  grnDate: string;
  docDate?: string;
  supplierId: number;
  poId: number;
  vehicleInOutId?: number | null;
  grnItems: GRNItemLine[];
  status: string;
  remarks?: string;
  supplierName?: string;
  poNumber?: string;
  docNo?: string;
  finYear?: string | null;
  parentDocNo?: string | null;
  rootExBDocNo?: string | null;
  projectId?: number | null;
  godownId?: number | null;
}

export interface GRNRecord {
  GRNID: number;
  GRNNo: string;
  DocNo: string;
  GRNDate: string;
  DocDate?: string;
  SupplierID: number | null;
  SupplierName: string | null;
  POID: number | null;
  PONumber: string | null;
  POType?: string | null;
  VehicleInOutID: number | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  GodownID: number | null;
  Status: string;
  TotalAmount: number;
  POTotalAmount?: number | null;
  FinYear: string | null;
  Remarks: string | null;
  SourceTransferDocNo?: string | null;
  SourceMRDocNo?: string | null;
  GRNItems?: GRNItemLine[];
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function normalizePaginated<T>(payload: any): PaginatedResponse<T> {
  if (Array.isArray(payload)) return { data: payload, page: 1, limit: payload.length, total: payload.length, totalPages: 1 };
  return {
    data: normalizeArray<T>(payload), page: Number(payload?.page || 1), limit: Number(payload?.limit || payload?.data?.length || 0),
    total: Number(payload?.total || payload?.data?.length || 0), totalPages: Number(payload?.totalPages || 1),
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export const getGRNs = async (query: { page?: number; limit?: number; finYear?: string; status?: string } = {}): Promise<PaginatedResponse<GRNRecord>> => {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch GRNs"));
  return normalizePaginated<GRNRecord>(await res.json().catch(() => ({})));
};

export const getGRNById = async (id: number | string): Promise<GRNRecord> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch GRN"));
  return res.json().catch(() => ({}));
};

export const addGRN = async (data: GRNFormDataPayload) => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create GRN"));
  return res.json().catch(() => ({}));
};

export const updateGRN = async (id: number | string, data: GRNFormDataPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update GRN"));
  return res.json().catch(() => ({}));
};

export const deleteGRN = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete GRN"));
  return res.json().catch(() => ({}));
};

export interface DocNumberPreview { nextDocNo: string }

export const previewNextGRNNumber = async (parentDocNo?: string | null): Promise<DocNumberPreview> => {
  const qs = parentDocNo ? `?parentDocNo=${encodeURIComponent(parentDocNo)}` : "";
  const res = await fetchWithAuth(`${BASE}/next-number${qs}`);
  if (!res.ok) return { nextDocNo: "" };
  return res.json().catch(() => ({ nextDocNo: "" }));
};

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string }

export const getSuppliers = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/account-head?type=S").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((s) => ({ id: String(s.LHeadId), name: s.LHeadName ?? "" }));
};

export interface GrnPurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  DocNo?: string | null;
  RootExBDocNo?: string | null;
  SupplierID?: number;
  SupplierName?: string;
  CompanyId?: number;
  ProjectId?: number;
  Status?: string;
  POType?: "Normal" | "Direct" | "WO_PO";
  PODate?: string;
  TotalAmount?: number;
  SubtotalAmount?: number;
  POTotalReceived?: number;
  LineItems?: any[];
}

export const getPurchaseOrders = async (): Promise<GrnPurchaseOrder[]> => {
  const raw = await fetchWithAuth("/api/purchase-orders?limit=500").then((r) => r.json().catch(() => []));
  return normalizeArray<GrnPurchaseOrder>(raw);
};

export const getPurchaseOrderById = async (id: number | string): Promise<GrnPurchaseOrder> =>
  fetchWithAuth(`/api/purchase-orders/${id}`).then((r) => r.json().catch(() => ({})));

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export interface ProjectOption extends NameOption { companyId: string | null }

export const getProjects = async (): Promise<ProjectOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
};

export interface GodownOption { id: number; name: string; projectId: number | null }

export const getGodowns = async (): Promise<GodownOption[]> => {
  const raw = await fetchWithAuth("/api/godowns").then((r) => r.json().catch(() => ({})));
  return normalizeArray<any>(raw).map((g) => ({ id: g.GodownID, name: g.GodownName, projectId: g.ProjectID ?? null }));
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => (r.FStatus === 1 || r.FStatus === true) && !r.FLocked)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

// ─── PO ↔ Vehicle In/Out ↔ GRN linkage ──────────────────────────────────────

/** POs with at least one Vehicle In/Out logged — goods can't be receipted
 *  before a vehicle's actually brought them in. */
export const getPoIdsWithVio = async (): Promise<Set<number>> => {
  const res = await fetchWithAuth("/api/vehicle-in-out/po-ids-with-vio");
  if (!res.ok) return new Set();
  const d = await res.json().catch(() => []);
  return new Set(Array.isArray(d) ? d.map(Number) : []);
};

export interface PendingVehicleInOut {
  VehicleInOutID: number;
  DocNo: string;
  DocDate: string;
  VehicleNo?: string;
}

/** Vehicle In/Out lots for a PO that don't already have a GRN raised against them. */
export const getPendingVehicleInOutsForPO = async (poId: number | string): Promise<PendingVehicleInOut[]> => {
  const res = await fetchWithAuth(`/api/vehicle-in-out/po/${poId}/pending-grn`);
  if (!res.ok) return [];
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? d : [];
};

export interface VehicleInOutEnrichedItem {
  ItemId: string;
  ItemName: string;
  VehicleQty: number;
  UomName: string;
  Rate: number;
  TaxPct: number;
}

/** A specific Vehicle In/Out lot's items, enriched with the PO's rate/GST —
 *  becomes the (locked) GRN line items when that lot is picked. */
export const getVehicleInOutItemsEnriched = async (vehicleInOutId: number | string): Promise<VehicleInOutEnrichedItem[]> => {
  const res = await fetchWithAuth(`/api/vehicle-in-out/${vehicleInOutId}/items-enriched`);
  if (!res.ok) return [];
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? d : [];
};

// ─── Remaining-PO-items logic (grnRemainingItems.ts port, verbatim) ─────────

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export interface RemainingPOItem {
  itemId: string; itemName: string; orderedQty: number; receivedQty: number; remainingQty: number; uom: string; rate: number; gstPct: number;
}

export function computeRemainingPOItems(po: any): RemainingPOItem[] {
  const lineItems = po?.LineItems ?? [];
  return (Array.isArray(lineItems) ? lineItems : [])
    .map((li: any): RemainingPOItem => {
      const orderedQty = Number(li.Quantity ?? 0);
      const receivedQty = Number(li.ReceivedQty ?? 0);
      const remainingQty = Math.max(round3(orderedQty - receivedQty), 0);
      return {
        itemId: String(li.ItemId ?? li.Id ?? ""), itemName: li.ItemName ?? li.Description ?? "",
        orderedQty, receivedQty, remainingQty, uom: li.UomName ?? li.UomId ?? "",
        rate: Number(li.Rate ?? 0), gstPct: Number(li.TaxPct ?? 0),
      };
    })
    .filter((it) => it.orderedQty > 0);
}

export function hasRemainingItems(items: RemainingPOItem[]): boolean {
  return items.some((it) => it.remainingQty > 1e-6);
}

export function countRemainingItems(items: RemainingPOItem[]): number {
  return items.filter((it) => it.remainingQty > 1e-6).length;
}

export function buildGRNLineItemsFromRemaining(items: RemainingPOItem[]): GRNItemLine[] {
  return items
    .filter((it) => it.remainingQty > 1e-6)
    .map((it) => {
      const totalAmount = it.rate * it.remainingQty;
      return {
        itemId: it.itemId, itemName: it.itemName, orderedQty: it.orderedQty, receivedQty: it.remainingQty,
        remainingQty: 0, uom: it.uom, rate: it.rate, quantity: it.remainingQty, totalAmount,
        gstPct: it.gstPct, gstAmount: totalAmount * (it.gstPct / 100),
      };
    });
}
