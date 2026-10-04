import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/holiday-master";

export interface HolidayRow {
  HolidayId: number;
  HolidayName: string;
  HolidayDate: string;
  FinYearId: number | null;
  FinYearName: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface HolidayPayload {
  HolidayName: string;
  HolidayDate: string;
  FinYearId: number | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getHolidays = async (): Promise<HolidayRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addHoliday = async (payload: HolidayPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateHoliday = async (id: number, payload: HolidayPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteHoliday = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
