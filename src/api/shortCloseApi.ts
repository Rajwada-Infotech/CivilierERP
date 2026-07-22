import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type ShortCloseDocType = "PO" | "MR";

export interface ShortCloseCandidate {
  docType: ShortCloseDocType;
  docId: number;
  docNo: string;
  docDate: string | null;
  party: string | null;
  status: string;
  finYearId: number | null;
  companyId: number | null;
  projectId: number | null;
  totalQty: number;
  completedQty: number;
  pendingQty: number;
  updatedAt: string | null;
}

export interface ShortCloseResult {
  docId: number;
  ok: boolean;
  docNo?: string;
  reason?: string;
}

export interface ShortCloseProcessResponse {
  message: string;
  results: ShortCloseResult[];
  succeeded: number;
  failedCount: number;
}

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
};

export const searchShortCloseCandidates = (params: {
  docType: ShortCloseDocType;
  finYearId?: string | number | null;
  companyId?: string | number | null;
  projectId?: string | number | null;
}) => {
  const qs = new URLSearchParams({ docType: params.docType });
  if (params.finYearId) qs.set("finYearId", String(params.finYearId));
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  return fetchWithAuth(`/api/short-close/search?${qs.toString()}`).then((r) =>
    handle<ShortCloseCandidate[]>(r),
  );
};

export const processShortClose = (body: {
  docType: ShortCloseDocType;
  ids: number[];
  remarks?: string;
}) =>
  fetchWithAuth("/api/short-close/process", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => handle<ShortCloseProcessResponse>(r));
