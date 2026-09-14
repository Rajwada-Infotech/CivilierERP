// RN port of src/api/issuesApi.ts + the header/cart types and stock-validation
// logic inline in src/pages/material/Issues.tsx. Smallest transaction page in
// the Material module — no GST, no UOM conversion math, just a company→
// project→godown cascade feeding a stock-capped item cart. Scope trim vs.
// web: CSV import/export (a stub on web too) and print stay web-only; so do
// the several backend endpoints the web page itself never calls — stock/
// :itemId, next-number (uses the shared /api/document-type flow instead,
// same as materialRequestApi.ts), companies/fin-years (web sources these
// from /api/enterprises/options and FinYearContext instead), and the GRN/MR
// prefill + reference-list surface (no UI for it on web either). Kept: the
// godown-scoped stock cap per line (getStockForRow equivalent), the
// godown-change-resets-cart guard, and Draft/Rejected-only edit/delete
// gating (web relies on the server 400 alone; mobile pre-emptively hides
// the actions too since it's a nicer affordance and costs nothing extra).
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/material-issues";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IssueLineItem {
  ItemId: string;
  ItemName?: string;
  UOMCode: string;
  Quantity: number;
  Remarks?: string | null;
}

export interface MaterialIssue {
  IssueId: number;
  DocNo?: string;
  IssueNo?: string;
  Status: string;
  CompanyId?: number | null;
  CompanyName?: string | null;
  ProjectId?: number | null;
  ProjectName?: string | null;
  FinYearId?: number | null;
  FinYearName?: string | null;
  GodownId?: number | null;
  GodownName?: string | null;
  GodownCode?: string | null;
  Date: string;
  Reason: string;
  Remarks?: string | null;
  IssuedTo?: string | null;
  CostCenter?: string | null;
  ItemCount?: number;
  TotalQty?: number;
  CreatedAt?: string;
  items?: (IssueLineItem & { CurrentBalance?: number; ItemGroup?: string; UOMName?: string; UOMSymbol?: string })[];
}

export interface IssueListResponse {
  data: MaterialIssue[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateIssuePayload {
  CompanyId: number | null;
  ProjectId: number | null;
  FinYearId: number | null;
  Date: string;
  Reason: string;
  Remarks: string | null;
  GodownId: number | null;
  DocTypeId: number | null;
  IssuedTo: string | null;
  CostCenter: string | null;
  items: IssueLineItem[];
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export const getMaterialIssues = async (query: { page?: number; limit?: number; search?: string; status?: string } = {}): Promise<IssueListResponse> => {
  const { page = 1, limit = 15, search = "", status = "" } = query;
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) qs.set("search", search);
  if (status) qs.set("status", status);
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch Material Issues"));
  return res.json().catch(() => ({ data: [], page: 1, limit, total: 0, totalPages: 1 }));
};

export const getMaterialIssueById = async (id: number | string): Promise<MaterialIssue> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch Material Issue"));
  return res.json().catch(() => ({}));
};

export const createMaterialIssue = async (payload: CreateIssuePayload) => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create Material Issue"));
  return res.json().catch(() => ({}));
};

export const updateMaterialIssue = async (id: number | string, payload: CreateIssuePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update Material Issue"));
  return res.json().catch(() => ({}));
};

export const deleteMaterialIssue = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete Material Issue"));
  return res.json().catch(() => ({}));
};

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export interface ProjectOption extends NameOption { companyId: string | null }

export const getProjects = async (): Promise<ProjectOption[]> => {
  const raw = await fetchWithAuth(`${BASE}/projects`).then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.name ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
};

export interface GodownOption { id: number; name: string; code?: string | null; companyId: number | null; projectId: number | null; isMain?: boolean }

export const getGodowns = async (): Promise<GodownOption[]> => {
  const raw = await fetchWithAuth(`${BASE}/godowns`).then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((g) => ({
    id: g.id, name: g.name, code: g.code ?? null, companyId: g.companyId ?? null, projectId: g.projectId ?? null, isMain: !!g.isMain,
  }));
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

export interface IssueItemOption {
  M_Id: string;
  M_Name: string;
  M_Group?: string | null;
  AvailableStock?: number;
  DefaultUOM?: string;
}

export const getIssueItemOptions = async (godownId: string | number): Promise<IssueItemOption[]> => {
  const raw = await fetchWithAuth(`${BASE}/item-options?godownId=${godownId}`).then((r) => r.json().catch(() => []));
  return normalizeArray<IssueItemOption>(raw);
};

export interface IssueUomOption { UOMCode: string; UOMName: string; IsActive?: boolean | number }

export const getUomOptions = async (): Promise<IssueUomOption[]> => {
  const raw = await fetchWithAuth("/api/uom-master").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).filter((u) => u.IsActive === true || u.IsActive === 1);
};

export const getIssuedToOptions = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/account-head/options?type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id ?? c.LHeadId), name: c.label ?? c.LHeadName ?? "" }));
};

// ─── Doc-type numbering (same endpoints as other Material forms' ports) ────
export async function fetchDocTypes(module?: string): Promise<{ TypeOfDocId: number }[]> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  const res = await fetchWithAuth(`/api/document-type${qs}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchNextDocNumber(docTypeId: number, finYear?: string | null): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`/api/document-type/${docTypeId}/next-number${qs}`);
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data?.nextDocNo ?? data?.docNo ?? "";
}

// ─── UI constants ───────────────────────────────────────────────────────────

export const STATUS_COLOR: Record<string, string> = {
  Draft: "#64748b",
  Pending: "#d97706",
  Approved: "#059669",
  Rejected: "#dc2626",
};
