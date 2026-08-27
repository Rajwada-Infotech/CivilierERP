// RN port of src/api/vehicleInOutApi.ts (web) + the option-fetchers and
// PO-filtering logic inlined in src/pages/material/VehicleInOut.tsx. First
// Material-module API file in mobile — Vehicle In/Out is genuinely simpler
// than its name suggests: one record per vehicle "lot" carrying both an
// entry and (optional) exit timestamp, no weighbridge/weight capture, no
// separate gate-in/gate-out actions — see VehicleInOutFormModal.tsx.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/vehicle-in-out";

/** A single attachment (camera capture or file pick), stored as binary in the DB. */
export interface VehicleAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  /** GET this URL to stream the file (auth required, same as any other API call). */
  url: string;
}

export interface VehicleInOutLineItem {
  VehicleInOutItemID: number;
  POItemId: number;
  ItemId: string | null;
  ItemName: string | null;
  UomName: string | null;
  ReceivedQty: number;
}

/** A PO line item together with how much has already been received across
 *  all Vehicle In/Out lots (GET /po-items/:poId). */
export interface POItemRemaining {
  poItemId: number;
  itemId: string | null;
  itemName: string | null;
  itemCode: string | null;
  uomName: string | null;
  orderedQty: number;
  receivedSoFar: number;
  remainingQty: number;
}

export interface VehicleInOutRecord {
  VehicleInOutID: number;
  DocNo: string | null;
  DocDate: string;
  CompanyID: number | null;
  CompanyName: string | null;
  ProjectID: number | null;
  ProjectName: string | null;
  FinYear: string | null;
  SupplierID: number | null;
  SupplierName: string | null;
  POID: number | null;
  PONumber: string | null;
  VehicleNo: string;
  EntryTime: string;
  ExitTime: string | null;
  ChallanNo: string | null;
  AttachmentCount?: number;
  Attachments?: VehicleAttachment[];
  Items?: VehicleInOutLineItem[];
  Remarks: string | null;
  Status: string;
  CreatedAt: string;
}

export interface VehicleInOutPayload {
  docDate: string;
  companyId: number | null;
  projectId: number | null;
  finYear: string | null;
  supplierId: number | null;
  supplierName: string;
  poId: number | null;
  poNumber: string;
  vehicleNo: string;
  entryTime: string;
  exitTime: string | null;
  challanNo: string;
  attachmentIds: number[];
  remarks: string;
  items: { poItemId: number; receivedQty: number }[];
}

export interface VehicleInOutListResponse {
  data: VehicleInOutRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function getVehicleInOuts(params: {
  page?: number;
  limit?: number;
  finYear?: string;
  search?: string;
}): Promise<VehicleInOutListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.finYear) qs.set("finYear", params.finYear);
  if (params.search) qs.set("search", params.search);

  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to load Vehicle In/Out records"));
  return res.json().catch(() => ({}));
}

export async function getVehicleInOut(id: number): Promise<VehicleInOutRecord> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to load record"));
  return res.json().catch(() => ({}));
}

export async function getPOItemsRemaining(
  poId: number,
  excludeVehicleInOutId?: number,
): Promise<POItemRemaining[]> {
  const qs = excludeVehicleInOutId ? `?excludeVehicleInOutId=${excludeVehicleInOutId}` : "";
  const res = await fetchWithAuth(`${BASE}/po-items/${poId}${qs}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function previewNextVEHNumber(): Promise<{ nextDocNo: string }> {
  const res = await fetchWithAuth(`${BASE}/next-number`);
  if (!res.ok) return { nextDocNo: "" };
  return res.json().catch(() => ({ nextDocNo: "" }));
}

export async function createVehicleInOut(
  payload: VehicleInOutPayload,
): Promise<{ vehicleInOutId: number; docNo: string }> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create Vehicle In/Out"));
  return res.json().catch(() => ({}));
}

export async function updateVehicleInOut(id: number, payload: VehicleInOutPayload): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update Vehicle In/Out"));
}

export async function deleteVehicleInOut(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete Vehicle In/Out"));
}

// One picked/captured image ready to upload, in the shape RN's fetch/FormData expects.
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Upload one or more files (attachments or camera-capture photos) to be
 * stored as binary in dbo.VehicleInOutAttachments. Returns each attachment's
 * id + streamable url — these ids start out unlinked (VehicleInOutID = NULL)
 * — pass them in `attachmentIds` on create/update to attach them to a record.
 */
export async function uploadVehicleAttachments(
  files: PickedFile[],
): Promise<{ success: boolean; attachments: VehicleAttachment[]; ids: number[] }> {
  const form = new FormData();
  for (const file of files) {
    // RN's FormData accepts this {uri,name,type} shape in place of a Blob/File.
    form.append("file", file as unknown as Blob);
  }
  const res = await fetchWithAuth(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res, "Upload failed"));
  return res.json().catch(() => ({}));
}

export async function deleteVehicleAttachment(attachmentId: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/attachment/${attachmentId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to remove attachment"));
}

// ─── Option fetchers (Company/Project/Supplier/PO) ─────────────────────────

export const fetchCompanyOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchProjectOptions = async (): Promise<{ id: number; label: string; company_id?: number | null }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export interface SupplierOption {
  id: number;
  label: string;
  contactPerson?: string;
}

export const fetchSupplierOptions = async (): Promise<SupplierOption[]> => {
  const res = await fetchWithAuth("/api/account-head/options?type=S");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export interface PurchaseOrderOption {
  PurchaseOrderID: number;
  DocNo?: string;
  PurchaseOrderNo?: string;
  SupplierID: number | null;
  SupplierName: string | null;
  CompanyId: number | null;
  ProjectId: number | null;
  Status: string;
}

export const fetchPurchaseOrders = async (): Promise<PurchaseOrderOption[]> => {
  const res = await fetchWithAuth("/api/purchase-orders?limit=500");
  if (!res.ok) return [];
  const d = await res.json().catch(() => ({}));
  return Array.isArray(d) ? d : (d.data ?? []);
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
