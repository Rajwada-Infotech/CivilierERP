import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/work-location-master";

export interface WorkLocationRow {
  LocationId: number;
  LocationName: string;
  LocationCode: string;
  Latitude: number;
  Longitude: number;
  Address: string | null;
  RadiusMeters: number;
  IsActive: boolean;
}

export interface WorkLocationPayload {
  LocationName: string;
  LocationCode: string;
  Latitude: number | string;
  Longitude: number | string;
  Address: string | null;
  RadiusMeters: number;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getWorkLocations = async (): Promise<WorkLocationRow[]> => handle(await fetchWithAuth(BASE));
export const addWorkLocation = async (p: WorkLocationPayload) => handle<{ message: string }>(await fetchWithAuth(BASE, json("POST", p)));
export const updateWorkLocation = async (id: number, p: WorkLocationPayload) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}`, json("PUT", p)));
export const deleteWorkLocation = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }));
