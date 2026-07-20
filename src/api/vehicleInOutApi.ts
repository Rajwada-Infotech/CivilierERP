// src/api/vehicleInOutApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/vehicle-in-out";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single attachment (camera capture or file pick), stored as binary in the DB. */
export interface VehicleAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  /** GET this URL to stream the file (auth required, same as any other API call). */
  url: string;
}

/** One line item as saved on this Vehicle In/Out record (GET /:id and GET /:id/items). */
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
  /** Present on list rows instead of the full Attachments array (cheaper query). */
  AttachmentCount?: number;
  /** Present on the single-record GET /:id response. */
  Attachments?: VehicleAttachment[];
  /** Present on the single-record GET /:id response. */
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
  /** Ids of attachments uploaded via uploadVehicleAttachments() during this
   *  session, still unlinked — the backend attaches them to this record on
   *  save. Already-linked attachments on an existing record don't need to
   *  be resent here. */
  attachmentIds: number[];
  remarks: string;
  /** Quantity received against each PO line item in THIS lot — validated
   *  server-side against what's left to receive on the PO before saving. */
  items: { poItemId: number; receivedQty: number }[];
}

export interface VehicleInOutListResponse {
  data: VehicleInOutRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── API functions ─────────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => ({}));
}

export async function getVehicleInOut(id: number): Promise<VehicleInOutRecord> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => ({}));
}

/**
 * PO line items with how much of each has already been received across
 * all Vehicle In/Out lots, and how much is left. Pass excludeVehicleInOutId
 * when editing an existing record so its own already-saved quantities
 * don't count against its own remaining allowance.
 */
export async function getPOItemsRemaining(
  poId: number,
  excludeVehicleInOutId?: number,
): Promise<POItemRemaining[]> {
  const qs = excludeVehicleInOutId
    ? `?excludeVehicleInOutId=${excludeVehicleInOutId}`
    : "";
  const res = await fetchWithAuth(`${BASE}/po-items/${poId}${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => []);
}

/** One PO with goods still outstanding after partial Vehicle In/Out lots
 *  (GET /pending-summary) — backs the "Pending Vehicle In/Out" widget. */
export interface PendingVehicleInOutSummary {
  poId: number;
  poNumber: string | null;
  supplierName: string | null;
  companyId: number | null;
  projectId: number | null;
  totalOrdered: number;
  totalReceived: number;
  pendingQty: number;
  /** Most recent Vehicle In/Out lot already logged against this PO, if any. */
  lastVehicleInOutId: number | null;
  lastVehicleInOutDocNo: string | null;
  lastVehicleNo: string | null;
}

export async function getPendingVehicleSummary(): Promise<
  PendingVehicleInOutSummary[]
> {
  const res = await fetchWithAuth(`${BASE}/pending-summary`);
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => []);
}

export async function previewNextVEHNumber(): Promise<{ nextDocNo: string }> {
  const res = await fetchWithAuth(`${BASE}/next-number`);
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => ({}));
}

export async function createVehicleInOut(
  payload: VehicleInOutPayload,
): Promise<{ vehicleInOutId: number; docNo: string }> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Failed to create Vehicle In/Out");
  }
  return res.json().catch(() => ({}));
}

export async function updateVehicleInOut(
  id: number,
  payload: VehicleInOutPayload,
): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Failed to update Vehicle In/Out");
  }
}

export async function deleteVehicleInOut(id: number): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Failed to delete Vehicle In/Out");
  }
}

/**
 * Upload one or more files (attachments or camera-capture blobs) to be
 * stored as binary in dbo.VehicleInOutAttachments. Returns each attachment's
 * id + streamable url. These ids start out unlinked (VehicleInOutID = NULL)
 * — pass them in `attachmentIds` on create/update to attach them to a record.
 */
export async function uploadVehicleAttachments(
  files: File[],
): Promise<{
  success: boolean;
  attachments: VehicleAttachment[];
  ids: number[];
}> {
  const token = localStorage.getItem("token") ?? "";
  const form = new FormData();
  for (const file of files) form.append("file", file);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json().catch(() => ({}));
}

/** Remove a single attachment — e.g. user un-attaches a photo before saving. */
export async function deleteVehicleAttachment(
  attachmentId: number,
): Promise<void> {
  const res = await fetch(`${BASE}/attachment/${attachmentId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Failed to remove attachment");
  }
}
