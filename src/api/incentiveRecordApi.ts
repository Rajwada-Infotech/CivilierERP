import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/incentive-record";

export type IncentiveType = "Performance" | "Sales" | "Festival" | "Referral" | "Retention" | "Other";
export type IncentiveStatus = "Pending" | "Approved" | "Rejected" | "Paid";

export interface IncentiveRow {
  IncentiveId: number;
  DocumentNo: string;
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  IncentiveType: IncentiveType;
  IncentiveDate: string;
  Amount: number;
  Remarks: string | null;
  Status: IncentiveStatus;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface IncentivePayload {
  EmployeeId: number;
  IncentiveType: IncentiveType;
  IncentiveDate: string;
  Amount: number;
  Remarks?: string | null;
  Status?: IncentiveStatus;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getIncentiveRecords = async (): Promise<IncentiveRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addIncentiveRecord = async (payload: IncentivePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; documentNo: string }>(res);
};

export const updateIncentiveRecord = async (id: number, payload: IncentivePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteIncentiveRecord = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
