import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/work-orders";

// ── Shared safe-array helper ──────────────────────────────────────────────────
// Handles: plain array, { data: [] }, { recordset: [] }, or any non-array shape
function safeArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

// ── Header CRUD ──────────────────────────────────────────────────────────────

export const getWorkOrders = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const getWorkOrder = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const createWorkOrder = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let err: Record<string, string> = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw new Error(err.error || `POST failed: ${res.status}`);
  }
  return res.json();
};

export const updateWorkOrder = async (
  id: number,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let err: Record<string, string> = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw new Error(err.error || `PUT failed: ${res.status}`);
  }
  return res.json();
};

export const deleteWorkOrder = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    let err: Record<string, string> = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw new Error(err.error || `DELETE failed: ${res.status}`);
  }
  return res.json();
};

// ── Dropdown data fetchers ────────────────────────────────────────────────────

/**
 * Companies: enterprise rows where business_type = 'C'
 * Backend: GET /api/work-orders/meta/companies
 */
export const fetchCompanies = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/companies`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return safeArray<{ id: number; name: string }>(raw);
  } catch (err) {
    console.error("[workOrderApi] fetchCompanies failed:", err);
    return [];
  }
};

/**
 * Projects: enterprise rows where business_type = 'P'
 * Backend: GET /api/work-orders/meta/projects
 */
export const fetchProjects = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/projects`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return safeArray<{ id: number; name: string }>(raw);
  } catch (err) {
    console.error("[workOrderApi] fetchProjects failed:", err);
    return [];
  }
};

/**
 * Contractors: AccountHeadMaster rows where LHeadType = 'C'
 * Backend: GET /api/work-orders/meta/contractors
 */
export const fetchContractors = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/contractors`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return safeArray<{ id: number; name: string }>(raw);
  } catch (err) {
    console.error("[workOrderApi] fetchContractors failed:", err);
    return [];
  }
};

/**
 * Activity groups: ActivityMaster rows where activity_type = 0
 * Backend: GET /api/work-orders/meta/activity-groups
 */
export const fetchActivityGroups = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/activity-groups`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return safeArray<{ id: number; name: string }>(raw);
  } catch (err) {
    console.error("[workOrderApi] fetchActivityGroups failed:", err);
    return [];
  }
};

/**
 * Activities: ActivityMaster rows where activity_type = 1.
 * Optionally filtered by groupId (belongsTo in ActivityMaster).
 * Backend: GET /api/work-orders/meta/activities?groupId=<id>
 */
export const fetchActivities = async (
  groupId?: number,
): Promise<{ id: number; name: string; groupId: number | string }[]> => {
  try {
    const url = groupId
      ? `${BASE_URL}/meta/activities?groupId=${groupId}`
      : `${BASE_URL}/meta/activities`;
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return safeArray<{ id: number; name: string; groupId: number }>(raw);
  } catch (err) {
    console.error("[workOrderApi] fetchActivities failed:", err);
    return [];
  }
};

// ── Bulk save (header + all activities + all materials in one shot) ────────────

export interface MaterialPayload {
  Id?: number;
  ItemId?: string;
  UOMId?: number;
  Quantity?: number;
  Rate?: number;
  Remarks?: string;
  CreatedBy?: number;
  UpdatedBy?: number;
}

export interface ActivityPayload {
  Id?: number;
  ActivityGroupId?: number | null;
  ActivityId?: number | null;
  UOMId?: number | null;
  Rate?: number;
  Area?: number;
  LabourAmount?: number;
  MaterialAmount?: number;
  GrandTotal?: number;
  Remarks?: string;
  materials: MaterialPayload[];
}

export interface WorkOrderFullPayload {
  header: {
    CompanyId?: number;
    ProjectId?: number;
    DocumentNumber?: string;
    DocumentDate?: string;
    ContractorId?: number;
    TotalAmount?: number;
    Remarks?: string;
    TermsAndConditions?: string;
    UpdatedBy?: number;
  };
  activities: ActivityPayload[];
}

export const saveFullWorkOrder = async (
  id: number,
  payload: WorkOrderFullPayload,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}/save-full`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let err: Record<string, string> = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw new Error(err.error || `Save failed: ${res.status}`);
  }
  return res.json();
};  // workOrder.ts