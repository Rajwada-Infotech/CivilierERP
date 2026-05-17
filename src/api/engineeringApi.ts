// src/api/engineeringApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/engineering";

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

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WDPOPrefillItem {
  itemDescription: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface WDPOPrefill {
  WDId: number;
  DocNo: string;
  CompanyId: number | null;
  CompanyName: string;
  ProjectId: number | null;
  ProjectName: string;
  SupplierId: number | null;
  SupplierName: string;
  WorkOrderId: number | null;
  WorkOrderNo: string | null;
  CertifiedAmount: number;
  DescriptionOfWork: string;
  Remarks: string | null;
  items: WDPOPrefillItem[];
}

// ── API ────────────────────────────────────────────────────────────────────────

export const getWDPOPrefill = (id: number | string) =>
  fetchWithAuth(`${BASE}/work-done/${id}/create-po-prefill`).then((r) =>
    handleResponse<WDPOPrefill>(r),
  );
