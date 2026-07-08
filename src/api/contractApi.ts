import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/contract";

export interface ContractListItem {
  ContractId: number;
  DocNo: string | null;
  DocDate: string | null;
  ContractDate: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  FinYear: string | null;
  ContactPerson: string | null;
  NatureOfContract: string | null;
  ContractAmount: number | null;
  ContractStartDate: string | null;
  ContractEndDate: string | null;
  Status: string;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface ContractDetail extends ContractListItem {
  Reason: string | null;
  Attachments: string | null;
  TermsAndConditions: string | null;
  Remarks: string | null;
}

export interface ContractPayload {
  docTypeId: number;
  docDate?: string;
  contractDate?: string;
  companyId?: number | null;
  projectId?: number | null;
  finYear?: string;
  contactPerson?: string;
  reason?: string;
  natureOfContract?: string;
  contractAmount?: number | null;
  contractStartDate?: string;
  contractEndDate?: string;
  attachments?: Attachment[];
  termsAndConditions?: string;
  remarks?: string;
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getContracts = async (params?: {
  companyId?: number;
  projectId?: number;
  finYear?: string;
  status?: string;
  search?: string;
}): Promise<ContractListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.finYear) qs.set("finYear", params.finYear);
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch contracts");
  return res.json();
};

export const getContract = async (id: number): Promise<ContractDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch contract");
  return res.json();
};

export interface ContractOption {
  id: number;
  label: string;
  ContractAmount: number | null;
}

// Dropdown source for Received Payment / New Payment / Sale Invoice /
// Expense Booking forms — lets a payment/invoice/expense reference a
// contract so the backend can record an advance or auto-allocate against
// it (see backend/services/contractLedger.js).
export const getContractOptions = async (params?: {
  companyId?: number;
  projectId?: number;
}): Promise<ContractOption[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  const res = await fetchWithAuth(`${BASE}/options${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch contract options");
  return res.json();
};

export interface ContractLedgerEntry {
  LedgerId: number;
  TxnType: "Advance" | "Adjustment" | "Refund";
  Amount: number;
  SourceType: string;
  SourceId: number;
  SourceDocNo: string | null;
  Remarks: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface ContractSummary {
  ContractValue: number;
  TotalAdvance: number;
  TotalAllocated: number;
  UnallocatedBalance: number;
  TotalDocumented: number;
  RemainingContractValue: number;
  OverBilled: boolean;
}

// The transparency surface: every advance/adjustment ever applied against
// a contract, plus the live derived balance summary.
export const getContractLedger = async (
  id: number,
): Promise<{ summary: ContractSummary; ledger: ContractLedgerEntry[] }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/ledger`);
  if (!res.ok) await handleError(res, "Failed to fetch contract ledger");
  return res.json();
};

export const getContactPersons = async (): Promise<string[]> => {
  const res = await fetchWithAuth(`${BASE}/contact-persons`);
  if (!res.ok) await handleError(res, "Failed to fetch contact persons");
  return res.json();
};

export const createContract = async (data: ContractPayload): Promise<{ contractId: number; docNo: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create contract");
  return res.json();
};

export const updateContract = async (id: number, data: Partial<ContractPayload> & { status?: string }): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update contract");
};

export const deleteContract = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete contract");
};
