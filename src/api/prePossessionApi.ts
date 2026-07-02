import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-pre-possession";

export async function fetchPrePossessionOptions() {
  const res = await fetchWithAuth(`${BASE}/meta/options`);
  if (!res.ok) throw new Error("Failed to load options");
  return res.json().catch(() => ({}));
}

export async function fetchPrePossessions(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) throw new Error("Failed to fetch Pre-Possession records");
  return res.json().catch(() => ({}));
}

export async function createPrePossession(payload: Record<string, unknown>) {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to create");
  }
  return res.json().catch(() => ({}));
}

export async function updatePrePossession(
  id: number,
  payload: Record<string, unknown>
) {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update");
  }
  return res.json().catch(() => ({}));
}

export async function deletePrePossession(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
  return res.json().catch(() => ({}));
}