import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/shift-master";

export interface ShiftRow {
  ShiftId: number;
  ShiftName: string;
  ShiftCode: string;
  InTime: string;
  OutTime: string;
  WeekOff: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface ShiftPayload {
  ShiftName: string;
  ShiftCode: string;
  InTime: string;
  OutTime: string;
  WeekOff: string | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getShifts = async (): Promise<ShiftRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addShift = async (payload: ShiftPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateShift = async (id: number, payload: ShiftPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteShift = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
