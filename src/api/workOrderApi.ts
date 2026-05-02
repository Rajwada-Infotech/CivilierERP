import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/work-orders";

// ── Shared safe-array helper ──────────────────────────────────────────────────
function safeArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

// ── Header CRUD ───────────────────────────────────────────────────────────────

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

export const updateWorkOrder = async (id: number, data: Record<string, unknown>) => {
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

export const fetchCompanies = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/companies`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: number; name: string }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchCompanies failed:", err); return []; }
};

export const fetchProjects = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/projects`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: number; name: string }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchProjects failed:", err); return []; }
};

export const fetchContractors = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/contractors`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: number; name: string }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchContractors failed:", err); return []; }
};

export const fetchActivityGroups = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/activity-groups`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: number; name: string }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchActivityGroups failed:", err); return []; }
};

export const fetchActivities = async (
  groupId?: number,
): Promise<{ id: number; name: string; groupId: number | string }[]> => {
  try {
    const url = groupId
      ? `${BASE_URL}/meta/activities?groupId=${groupId}`
      : `${BASE_URL}/meta/activities`;
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: number; name: string; groupId: number }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchActivities failed:", err); return []; }
};

/**
 * Items from Item_Master_Group — used for the Material Name dropdown.
 * id is a UUID string (uniqueidentifier), name is M_Name.
 */
export const fetchItems = async (): Promise<{ id: string; name: string }[]> => {
  try {
    const res = await fetchWithAuth(`${BASE_URL}/meta/items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return safeArray<{ id: string; name: string }>(await res.json());
  } catch (err) { console.error("[workOrderApi] fetchItems failed:", err); return []; }
};

// ── Bulk save ─────────────────────────────────────────────────────────────────

export interface MaterialPayload {
  Id?: number;
  /** UUID string — uniqueidentifier FK to Item_Master_Group.M_Id */
  ItemId?: string;
  UOMId?: number | null;
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
    DocTypeId?: number | string | null;
    DocNo?: string | null;
    UpdatedBy?: number;
    /** GST configuration stored as JSON in WorkOrderHeader.GST column */
    GST?: {
      applicable: boolean;
      type: "none" | "cgst_sgst" | "igst";
      rate: number;
    } | null;
  };
  activities: ActivityPayload[];
}

export const saveFullWorkOrder = async (id: number, payload: WorkOrderFullPayload) => {
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
};
