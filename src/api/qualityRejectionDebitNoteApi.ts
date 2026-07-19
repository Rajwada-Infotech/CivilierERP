// src/api/qualityRejectionDebitNoteApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/quality-debit-note";

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface QualityDebitNote {
  DebitNoteId: number;
  DocNo: string;
  DebitDate: string;
  VehicleInOutID: number | null;
  VehicleInOutItemID: number | null;
  GRNID: number | null;
  GRNItemIndex: number | null;
  POItemId: number | null;
  POID: number | null;
  ItemId: string | null;
  ItemName: string | null;
  UomName: string | null;
  CompanyID: number | null;
  ProjectID: number | null;
  SupplierID: number;
  SupplierName: string | null;
  ReceivedQty: number;
  RejectedQty: number;
  PercentBad: number;
  Rate: number;
  Amount: number;
  Reason: string | null;
  Status: "Issued" | "Cancelled";
  VehicleInOutDocNo?: string | null;
  PONumber?: string | null;
  VehicleNo?: string | null;
  GRNDocNo?: string | null;
  GRNNo?: string | null;
  CompanyName?: string | null;
  ProjectName?: string | null;
}

export type CreateQualityDebitNotePayload = {
  rejectedQty: number;
  rate?: number;
  reason?: string;
} & (
  | { vehicleInOutItemId: number; grnId?: never; grnItemIndex?: never }
  | { grnId: number; grnItemIndex: number; vehicleInOutItemId?: never }
);

export const createQualityDebitNote = (payload: CreateQualityDebitNotePayload) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) =>
    handleResponse<{ debitNoteId: number; docNo: string; percentBad: number; amount: number }>(r),
  );

export const getQualityDebitNotes = (params?: {
  vehicleInOutId?: number | string;
  grnId?: number | string;
  companyId?: number | string;
  projectId?: number | string;
  supplierId?: number | string;
  status?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.vehicleInOutId) qs.set("vehicleInOutId", String(params.vehicleInOutId));
  if (params?.grnId) qs.set("grnId", String(params.grnId));
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.supplierId) qs.set("supplierId", String(params.supplierId));
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs}` : "";
  return fetchWithAuth(`${BASE}${suffix}`).then((r) =>
    handleResponse<{ data: QualityDebitNote[] }>(r),
  );
};

export const cancelQualityDebitNote = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/cancel`, { method: "PUT" }).then((r) =>
    handleResponse<{ success: boolean }>(r),
  );
