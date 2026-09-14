import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/amendments";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export type AmendmentModule = "finance" | "material" | "engineering";

export interface AmendmentRecord {
  Id: number;
  AmendmentNo: string | null;
  RefDocType: string;
  RefDocLabel: string;
  RefDocId: number;
  RefDocNo: string | null;
  ProjectName: string | null;
  CompanyName: string | null;
  Description: string | null;
  AmendmentDate: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface AmendmentLineChange {
  Id: number;
  FieldName: string;
  FieldLabel: string | null;
  OldValue: string | null;
  NewValue: string | null;
  ChangedBy: string | null;
  ChangedAt: string;
}

export interface AmendmentDetail extends AmendmentRecord {
  changes: AmendmentLineChange[];
}

export async function getAmendments(module: AmendmentModule): Promise<AmendmentRecord[]> {
  const res = await fetchWithAuth(`${BASE}/${module}`);
  return handleResponse<AmendmentRecord[]>(res);
}

export async function getAmendmentDetail(id: number): Promise<AmendmentDetail> {
  const res = await fetchWithAuth(`${BASE}/detail/${id}`);
  return handleResponse<AmendmentDetail>(res);
}
