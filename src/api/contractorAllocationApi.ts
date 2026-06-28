import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/contractor-allocation";

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

export interface ContractorOption {
  id: number;
  name: string;
  code: string | null;
  contactPerson: string | null;
  phone: string | null;
}

export interface ContractorAllocation {
  id: number;
  contractorId: number;
  contractorName: string | null;
  contractorCode: string | null;
  contractorPhone: string | null;
  projectId: number | null;
  projectName: string | null;
  activityId: number;
  activityName: string | null;
  workDescription: string | null;
  allocationDate: string | null;
  startDate: string | null;
  expectedCompletionDate: string | null;
  currentStatus: string | null;
  allocatedBy: string | null;
  siteLocation: string | null;
  remarks: string | null;
  isAcknowledged: boolean;
  isNew: boolean;
  engineerName: string | null;
  approvalDate: string | null;
  approvalStatus: "Pending" | "Approved" | "Rejected";
  approvalRemarks: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface ContractorAllocationPayload {
  contractorId: number;
  projectId?: number | null;
  activityId: number;
  workDescription?: string | null;
  allocationDate?: string | null;
  startDate?: string | null;
  expectedCompletionDate?: string | null;
  currentStatus?: string | null;
  siteLocation?: string | null;
  remarks?: string | null;
}

export interface ApprovalPayload {
  engineerName: string;
  approvalStatus: "Approved" | "Rejected";
  approvalRemarks?: string | null;
}

// — No manual contractor creation: this list is sourced straight from
// AccountHeadMaster (LHeadType='C') by the backend.
export const getContractorOptions = async (): Promise<ContractorOption[]> => {
  const res = await fetchWithAuth(`${BASE}/contractors`);
  return handleResponse<ContractorOption[]>(res);
};

export const getContractorAllocations = async (): Promise<ContractorAllocation[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<ContractorAllocation[]>(res);
};

export const addContractorAllocation = async (
  payload: ContractorAllocationPayload,
): Promise<{ success: boolean; id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const updateContractorAllocation = async (
  id: number,
  payload: ContractorAllocationPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const acknowledgeAllocation = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/acknowledge`, { method: "PUT" });
  return handleResponse(res);
};

export const approveAllocation = async (
  id: number,
  payload: ApprovalPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const deleteContractorAllocation = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
