import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/overtime-record";

export type OvertimeStatus = "Pending" | "Approved" | "Rejected";

export interface OvertimeRow {
  OvertimeId: number;
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  OvertimeDate: string;
  Hours: number;
  RateMultiplier: number;
  Remarks: string | null;
  Status: OvertimeStatus;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface OvertimePayload {
  EmployeeId: number;
  OvertimeDate: string;
  Hours: number;
  RateMultiplier?: number;
  Remarks?: string | null;
  Status?: OvertimeStatus;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getOvertimeRecords = async (): Promise<OvertimeRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addOvertimeRecord = async (payload: OvertimePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateOvertimeRecord = async (id: number, payload: OvertimePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteOvertimeRecord = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
