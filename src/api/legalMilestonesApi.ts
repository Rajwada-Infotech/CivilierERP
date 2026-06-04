import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-legal-milestones";

export interface LegalMilestoneStep {
  stepField: string; // e.g. "DocCollection"
  status: string;
  doneDate?: string;
  notes?: string;
}

export async function fetchLegalMilestonesOptions() {
  const res = await fetchWithAuth(`${BASE}/meta/options`);
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

export async function fetchLegalMilestones(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) throw new Error("Failed to fetch Legal Milestones");
  return res.json();
}

export async function createLegalMilestone(payload: Record<string, unknown>) {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to create");
  }
  return res.json();
}

export async function updateLegalMilestone(
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
  return res.json();
}

export async function updateMilestoneStep(
  id: number,
  step: LegalMilestoneStep
) {
  const res = await fetchWithAuth(`${BASE}/${id}/step`, {
    method: "PATCH",
    body: JSON.stringify(step),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update step");
  }
  return res.json();
}

export async function deleteLegalMilestone(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
  return res.json();
}