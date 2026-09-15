import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/grace-time-master";

export interface GraceTimeRow {
  GraceId: number;
  GraceName: string;
  GraceCode: string;
  TimeMinutes: number;
  ReasonRemarks: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface GraceTimePayload {
  GraceName: string;
  GraceCode: string;
  TimeMinutes: number;
  ReasonRemarks: string | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getGraceTimes = async (): Promise<GraceTimeRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addGraceTime = async (payload: GraceTimePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateGraceTime = async (id: number, payload: GraceTimePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteGraceTime = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
