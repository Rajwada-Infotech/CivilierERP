import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/leave-record";

export type LeaveType = "Casual" | "Sick" | "Earned" | "Unpaid";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";

export interface LeaveRow {
  LeaveId: number;
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  LeaveType: LeaveType;
  FromDate: string;
  ToDate: string;
  TotalDays: number;
  Reason: string | null;
  Status: LeaveStatus;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface LeavePayload {
  EmployeeId: number;
  LeaveType: LeaveType;
  FromDate: string;
  ToDate: string;
  Reason?: string | null;
  Status?: LeaveStatus;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getLeaveRecords = async (): Promise<LeaveRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addLeaveRecord = async (payload: LeavePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateLeaveRecord = async (id: number, payload: LeavePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteLeaveRecord = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
