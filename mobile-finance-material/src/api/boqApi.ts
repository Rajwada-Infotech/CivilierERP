// Bills of Quantities (Engineering), read-only on the phone: the register, and one BOQ with its items and activities
// (for the invoice-style PDF). Same endpoints as the web page (src/pages/engineering/BOQ.tsx).
import { fetchWithAuth } from "@/services/fetchWithAuth";
import type { BoqPdfRecord } from "@/utils/boqPdf";

export interface BoqListItem {
  BoqID: number;
  BoqNo: string | null;
  DocNo: string | null;
  BoqDate: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  Description: string | null;
  TotalAmount: number | null;
  Status: string | null;
  CreatedBy: string | null;
}

export type BoqDetail = BoqListItem & BoqPdfRecord;

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data as T;
}

/** Every BOQ the caller can see, newest first (the server sends at most 100 a page). */
export async function getBoqs(): Promise<BoqListItem[]> {
  const out: BoqListItem[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await json<{ data: BoqListItem[]; totalPages: number }>(await fetchWithAuth(`/api/boq?page=${page}&limit=100`));
    out.push(...(r.data ?? []));
    if (page >= (r.totalPages || 1)) break;
  }
  return out;
}

export async function getBoq(id: number): Promise<BoqDetail> {
  return json<BoqDetail>(await fetchWithAuth(`/api/boq/${id}`));
}
