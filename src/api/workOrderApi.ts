import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/work-orders";

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
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateWorkOrder = async (
  id: number,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deleteWorkOrder = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};

// ── Bulk save (header + all activities + all materials in one shot) ────────────
// Use this for the Save button — sends the entire work order tree.

export interface MaterialPayload {
  Id?: number;
  ItemId?: string; // uniqueidentifier
  UOMId?: number;
  Quantity?: number;
  Rate?: number;
  Remarks?: string;
  CreatedBy?: number;
  UpdatedBy?: number;
}

export interface ActivityPayload {
  Id?: number;
  ActivityGroupId?: number;
  ActivityId?: number;
  UOMId?: number;
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
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Save failed");
  }
  return res.json();
};
