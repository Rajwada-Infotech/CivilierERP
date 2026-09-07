// RN port of src/api/qualityRejectionDebitNoteApi.ts — read-only surface
// only, matching how DebitNoteMaster.tsx itself shows these records: no
// create/cancel UI here. They're raised elsewhere (a GRN/Vehicle In/Out
// "Received Items" quality-check action, RaiseDebitNoteModal.tsx on web),
// not from this page, so only the list-fetch is ported.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/quality-debit-note";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export interface QualityDebitNote {
  DebitNoteId: number;
  DocNo: string;
  DebitDate: string;
  VehicleInOutID: number | null;
  GRNID: number | null;
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
  GRNDocNo?: string | null;
  GRNNo?: string | null;
  CompanyName?: string | null;
  ProjectName?: string | null;
}

export const getQualityDebitNotes = async (params: {
  companyId?: string | number; projectId?: string | number; supplierId?: string | number; status?: string;
} = {}): Promise<QualityDebitNote[]> => {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  if (params.supplierId) qs.set("supplierId", String(params.supplierId));
  if (params.status) qs.set("status", params.status);
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch quality rejection debit notes"));
  const body = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(body) ? body : (body?.data ?? []);
};
