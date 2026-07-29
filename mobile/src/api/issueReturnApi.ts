// RN port of src/pages/material/IssueReturn.tsx's inline API calls — web has
// no dedicated src/api/issueReturnApi.ts, everything is fetched ad hoc in
// the page component; factored into a real module here, following the
// issuesApi.ts/receivedPaymentApi.ts convention. Thinner than Material
// Issue's api surface: no godown/item-master/UOM master fetches on web —
// a return's line items (name, qty, UOM symbol) come embedded from the
// source Issue's own items, not from a separate item picker.
//
// Two known web-side gaps, replicated as-is for parity (not "fixed" here,
// since fixing needs backend changes beyond a pure port):
//  1. The per-line "max returnable qty" cap is the ORIGINAL issued
//     quantity, not issued-minus-already-returned — nothing stops a user
//     from over-returning against one Issue across multiple Return docs.
//  2. GodownId exists in the schema/payload and is written to the stock
//     ledger on approve, but the web form has no Godown field at all, so
//     it's always sent as null. Not added here either.
//
// Also unlike Material Issue, this module has its own self-contained
// submit/approve/reject actions (PUT .../:id/submit|approve|reject) — it
// does NOT feed the generic ApprovalStatusChain/approval-workflows engine
// at all (confirmed absent from the web page), so no "IssueReturns" entry
// exists in mobile's ApprovalTable union, and none is needed.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/material-issue-returns";

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

export interface IssueReturnLineItem {
  origIssueItemId: number | null;
  M_Id: string;
  ItemName: string;
  Quantity: number;
  UOMSymbol: string;
  maxQty?: number;
}

export interface IssueReturn {
  ReturnId: number;
  DocNo: string;
  ReturnDate: string;
  Status: string;
  IssueId?: number | null;
  IssueDocNo: string | null;
  Reason: string | null;
  Remarks?: string | null;
  CompanyId?: number | null;
  CompanyName: string | null;
  ProjectId?: number | null;
  ProjectName: string | null;
  CreatedAt: string;
  items?: IssueReturnLineItem[];
}

export interface CreateIssueReturnPayload {
  ReturnDate: string;
  IssueId: string;
  CompanyId: string;
  ProjectId: string;
  Reason: string;
  Remarks: string;
  items: IssueReturnLineItem[];
}

// ─── CRUD (no server pagination — web filters the full list client-side) ──

export const getIssueReturns = async (query: { companyId?: string; projectId?: string; status?: string } = {}): Promise<IssueReturn[]> => {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch Issue Returns"));
  return normalizeArray<IssueReturn>(await res.json().catch(() => []));
};

export const getIssueReturnById = async (id: number | string): Promise<IssueReturn> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch Issue Return"));
  return res.json().catch(() => ({}));
};

export const createIssueReturn = async (payload: CreateIssueReturnPayload) => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create Issue Return"));
  return res.json().catch(() => ({}));
};

export const updateIssueReturn = async (id: number | string, payload: CreateIssueReturnPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update Issue Return"));
  return res.json().catch(() => ({}));
};

export const deleteIssueReturn = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete Issue Return"));
  return res.json().catch(() => ({}));
};

export const submitIssueReturn = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/submit`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to submit Issue Return"));
  return res.json().catch(() => ({}));
};

export const approveIssueReturn = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to approve Issue Return"));
  return res.json().catch(() => ({}));
};

export const rejectIssueReturn = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reject`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to reject Issue Return"));
  return res.json().catch(() => ({}));
};

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string; companyId: string | null }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "", companyId: null }));
};

export const getProjects = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
};

export interface SourceIssueOption { IssueId: number; DocNo: string; IssueDate: string }

/** Only Approved Material Issues are eligible as a return source (server-enforced). */
export const getSourceIssues = async (companyId?: string, projectId?: string): Promise<SourceIssueOption[]> => {
  const qs = new URLSearchParams();
  if (companyId) qs.set("companyId", companyId);
  if (projectId) qs.set("projectId", projectId);
  const raw = await fetchWithAuth(`${BASE}/issues?${qs}`).then((r) => r.json().catch(() => []));
  return normalizeArray<SourceIssueOption>(raw);
};

export const getSourceIssueItems = async (issueId: number | string): Promise<IssueReturnLineItem[]> => {
  const raw = await fetchWithAuth(`${BASE}/issues/${issueId}/items`).then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((it) => ({
    origIssueItemId: it.ItemId ?? null, M_Id: it.M_Id, ItemName: it.ItemName, Quantity: it.Quantity, UOMSymbol: it.UOMSymbol ?? "", maxQty: Number(it.Quantity) || 0,
  }));
};

export const STATUS_COLOR: Record<string, string> = {
  Draft: "#64748b",
  Pending: "#d97706",
  Approved: "#059669",
  Rejected: "#dc2626",
};
