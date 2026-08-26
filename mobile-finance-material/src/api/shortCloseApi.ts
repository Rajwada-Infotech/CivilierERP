// RN port of src/api/shortCloseApi.ts — near-verbatim, the web file is
// already minimal (two endpoints, no CRUD). Short Close itself has no
// create/edit/detail views on web at all: it's a single search-select-
// confirm bulk action screen (search "Partial" POs/MRs, tick some, flip
// their Status to "Short Closed" with an optional remarks note). No
// approval workflow, no ledger writes, no reopen/reverse endpoint — it's
// a direct, irreversible, permission-gated status mutation. Company/
// Project/Fin-Year fetchers below use the generic endpoints already
// established across other mobile ports (issuesApi.ts, grnApi.ts) rather
// than web's page-specific reuse of materialRequestApi's own routes.
import { fetchWithAuth } from "@/services/fetchWithAuth";

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

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

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
  return fetchWithAuth(`/api/short-close/search?${qs.toString()}`).then((r) => handle<ShortCloseCandidate[]>(r));
};

export const processShortClose = (body: { docType: ShortCloseDocType; ids: number[]; remarks?: string }) =>
  fetchWithAuth("/api/short-close/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => handle<ShortCloseProcessResponse>(r));

// ─── Master data ────────────────────────────────────────────────────────────

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

export interface NameOption { id: string; name: string; companyId: string | null }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "", companyId: null }));
};

export const getProjects = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
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
