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
    try {
      err = await res.json();
    } catch {
      /* ignore */
    }
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
    try {
      err = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(err.error || `PUT failed: ${res.status}`);
  }
  return res.json();
};

export const deleteWorkOrder = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    let err: Record<string, string> = {};
    try {
      err = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(err.error || `DELETE failed: ${res.status}`);
  }
  return res.json();
};

// ── Dropdown data fetchers ────────────────────────────────────────────────────
// Companies: enterprise WHERE business_type = 'C'
export const fetchCompanies = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = safeArray<{ id: number; label: string }>(await res.json());
    return data.map((r) => ({ id: r.id, name: r.label ?? "" }));
  } catch (err) {
    console.error("[workOrderApi] fetchCompanies failed:", err);
    return [];
  }
};

// Projects: enterprise WHERE business_type = 'P'
export const fetchProjects = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = safeArray<{ id: number; label: string }>(await res.json());
    return data.map((r) => ({ id: r.id, name: r.label ?? "" }));
  } catch (err) {
    console.error("[workOrderApi] fetchProjects failed:", err);
    return [];
  }
};

// Contractors: AccountHeadMaster WHERE LHeadType = 'C'
export const fetchContractors = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const res = await fetchWithAuth("/api/account-head/options?type=C");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = safeArray<{ id: number; label: string }>(await res.json());
    return data.map((r) => ({ id: r.id, name: r.label ?? "" }));
  } catch (err) {
    console.error("[workOrderApi] fetchContractors failed:", err);
    return [];
  }
};

// Suppliers: AccountHeadMaster WHERE LHeadType = 'S'
export const fetchSuppliers = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const res = await fetchWithAuth("/api/account-head/options?type=S");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = safeArray<{ id: number; label: string }>(await res.json());
    return data.map((r) => ({ id: r.id, name: r.label ?? "" }));
  } catch (err) {
    console.error("[workOrderApi] fetchSuppliers failed:", err);
    return [];
  }
};

// Uses /api/activity-master directly (same source as ActivityMaster page)
// Filters client-side to avoid stale/duplicate meta routes.
const _fetchAllActivities = async () => {
  const res = await fetchWithAuth("/api/activity-master");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return safeArray<{
    id: number;
    activity_name: string;
    activity_type: number | null;
    group_id: number | null;
    is_active: boolean | null;
  }>(await res.json());
};

export const fetchActivityGroups = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const all = await _fetchAllActivities();
    return all
      .filter((r) => r.activity_type === 0 && r.is_active !== false)
      .map((r) => ({ id: r.id, name: r.activity_name }));
  } catch (err) {
    console.error("[workOrderApi] fetchActivityGroups failed:", err);
    return [];
  }
};

export const fetchActivities = async (
  groupId?: number,
): Promise<{ id: number; name: string; groupId: number | null }[]> => {
  try {
    const all = await _fetchAllActivities();
    return all
      .filter(
        (r) =>
          r.activity_type === 1 &&
          r.is_active !== false &&
          (groupId == null || r.group_id === groupId),
      )
      .map((r) => ({ id: r.id, name: r.activity_name, groupId: r.group_id }));
  } catch (err) {
    console.error("[workOrderApi] fetchActivities failed:", err);
    return [];
  }
};

/**
 * Items from Item_Master_Group — used for the Material Name dropdown.
 * id is a UUID string (uniqueidentifier), name is M_Name.
 * gstRate is resolved from HSN Master server-side.
 */
export interface WOItemOption {
  id: string;
  name: string;
  gstRate: number;
  hsnCode: string | null;
  uomName: string | null;
}

export const fetchItems = async (): Promise<WOItemOption[]> => {
  try {
    // Use /api/item-master directly (same source as ItemMaster page)
    const res = await fetchWithAuth("/api/item-master");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = safeArray<{
      M_Id: string;
      M_Name: string;
      M_HSN: string | null;
      M_CGST: number | null;
      M_IGST: number | null;
      M_SGST: number | null;
      M_UOM: string | null;
      Parent_Id: string | null;
      M_IdentityCode: number | null;
    }>(await res.json());
    return rows
      .filter((r) => r.Parent_Id != null || r.M_IdentityCode === 1)
      .map((r) => ({
        id: String(r.M_Id),
        name: r.M_Name,
        hsnCode: r.M_HSN || null,
        // GST: prefer IGST if set, else CGST+SGST
        gstRate:
          (r.M_IGST ?? 0) > 0
            ? Number(r.M_IGST)
            : Number(r.M_CGST ?? 0) + Number(r.M_SGST ?? 0),
        // UOM: M_UOM stores UOMCode — resolved to id/name at point-of-use via uomOptions
        uomId: null,
        uomName: r.M_UOM || null,
      }));
  } catch (err) {
    console.error("[workOrderApi] fetchItems failed:", err);
    return [];
  }
};

// ── Bulk save ─────────────────────────────────────────────────────────────────

export interface MaterialPayload {
  Id?: number;
  /** UUID string — uniqueidentifier FK to Item_Master_Group.M_Id */
  ItemId?: string;
  UOMId?: number | null;
  Quantity?: number;
  Rate?: number;
  /** GST rate % auto-filled from HSN Master via the item */
  GSTRate?: number;
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
    SupplierId?: number;
    TotalAmount?: number;
    Remarks?: string;
    TermsAndConditions?: string;
    DocTypeId?: number | string | null;
    DocNo?: string | null;
    UpdatedBy?: number;
    // GST is now per-material (GSTRate on each material line), not at header level
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
    try {
      err = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(err.error || `Save failed: ${res.status}`);
  }
  return res.json();
};
