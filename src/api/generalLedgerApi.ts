import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/general-ledger";

// ─── Response handler ─────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LedgerHead {
  LHeadId: number;
  LHeadName: string;
  LHeadCode: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
  LHeadType: string;
  isEdited: boolean | null;
  IsSystemGenerated: boolean;
  GroupName: string | null;
  ParentGroupId: number | null;
  ParentGroupName: string | null;
}

export interface LedgerPayload {
  LHeadName: string;
  LHeadCode?: string | null;
  LBelongsTo?: number | null;
  LHeadStatus?: boolean;
  IsSystemGenerated?: boolean;
}

export interface LedgerOption {
  id: number;
  label: string;
  code: string | null;
}

export interface PaginatedLedgers {
  data: LedgerHead[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── GET OPTIONS (for FK dropdowns elsewhere in the app) ─────────────────────
export const getLedgerOptions = async (): Promise<LedgerOption[]> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handleResponse<LedgerOption[]>(res);
};

// ─── GET ALL (paginated, with optional search + groupId filter) ───────────────
export const getLedgers = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  groupId?: string | number;
}): Promise<PaginatedLedgers> => {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 10),
  });
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.groupId) qs.set("groupId", String(params.groupId));

  const res = await fetchWithAuth(`${BASE}?${qs.toString()}`);
  const payload = await handleResponse<any>(res);

  // Backend may return a plain array (older behaviour) or a paginated envelope
  if (Array.isArray(payload)) {
    return {
      data: payload,
      page: 1,
      limit: payload.length,
      total: payload.length,
      totalPages: 1,
    };
  }
  return {
    data: Array.isArray(payload?.data) ? payload.data : [],
    page: Number(payload?.page ?? 1),
    limit: Number(payload?.limit ?? (params.limit ?? 10)),
    total: Number(payload?.total ?? payload?.data?.length ?? 0),
    totalPages: Number(payload?.totalPages ?? 1),
  };
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
export const getLedger = async (id: number): Promise<LedgerHead> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse<LedgerHead>(res);
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
export const addLedger = async (
  payload: LedgerPayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      LHeadName: payload.LHeadName.trim(),
      LHeadCode: payload.LHeadCode?.trim().toUpperCase() || null,
      LBelongsTo: payload.LBelongsTo ?? null,
      LHeadStatus: payload.LHeadStatus !== false,
      IsSystemGenerated: payload.IsSystemGenerated ?? false,
    }),
  });
  return handleResponse<{ message: string }>(res);
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateLedger = async (
  id: number,
  payload: LedgerPayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      LHeadName: payload.LHeadName.trim(),
      LHeadCode: payload.LHeadCode?.trim().toUpperCase() || null,
      LBelongsTo: payload.LBelongsTo ?? null,
      LHeadStatus: payload.LHeadStatus !== false,
    }),
  });
  return handleResponse<{ message: string }>(res);
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
export const deleteLedger = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
};
// ─── GET SYSTEM-GENERATED LEDGERS ─────────────────────────────────────────────
// Returns only ledger accounts marked IsSystemGenerated = 1.
// Used by the GRN Posting tab dropdowns.
export const getSystemGeneratedLedgers = async (): Promise<LedgerOption[]> => {
  const res = await fetchWithAuth(`${BASE}/system-generated`);
  return handleResponse<LedgerOption[]>(res);
};
