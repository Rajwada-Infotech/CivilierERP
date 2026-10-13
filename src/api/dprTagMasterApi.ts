import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dpr-tag-master";

export interface DprTag {
  id: number;
  tagName: string;
  isActive: boolean;
  activityCount: number;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getDprTags = () => fetchWithAuth(BASE).then((r) => handle<DprTag[]>(r));

export const createDprTag = (tagName: string) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagName }),
  }).then((r) => handle<{ id: number; message: string }>(r));

export const updateDprTag = (id: number, data: { tagName: string; isActive: boolean }) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => handle<{ message: string }>(r));

export const deleteDprTag = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handle<{ message: string }>(r));
