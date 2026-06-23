// src/api/vehicleInOutApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/vehicle-in-out";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

// ── Types ─────────────────────────────────────────────────────────────────────

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
  AttachmentPath: string | null;
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
  attachmentPath: string | null;
  remarks: string;
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
  return res.json();
}

export async function getVehicleInOut(id: number): Promise<VehicleInOutRecord> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function previewNextVEHNumber(): Promise<{ nextDocNo: string }> {
  const res = await fetchWithAuth(`${BASE}/next-number`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
  return res.json();
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

/** Upload a file (attachment or camera photo) and return its server path. */
export async function uploadVehicleAttachment(
  file: File,
): Promise<{ path: string; originalName: string; size: number }> {
  const token = localStorage.getItem("token") ?? "";
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}
