import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-agreement-workflow";

export interface AgreementWorkflowStep {
  stepField: string;
  status: string;
  doneDate?: string;
  notes?: string;
}

export async function fetchAgreementWorkflowOptions() {
  const res = await fetchWithAuth(`${BASE}/meta/options`);
  if (!res.ok) throw new Error("Failed to load options");
  return res.json().catch(() => ({}));
}

export async function fetchAgreementWorkflows(
  params?: Record<string, string>,
) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) throw new Error("Failed to fetch Agreement Workflows");
  return res.json().catch(() => ({}));
}

export async function createAgreementWorkflow(
  payload: Record<string, unknown>,
) {
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

export async function updateAgreementWorkflow(
  id: number,
  payload: Record<string, unknown>,
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

export async function updateWorkflowStep(
  id: number,
  step: AgreementWorkflowStep,
) {
  const res = await fetchWithAuth(`${BASE}/${id}/step`, {
    method: "PATCH",
    body: JSON.stringify(step),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update step");
  }
  return res.json().catch(() => ({}));
}

export async function deleteAgreementWorkflow(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
  return res.json().catch(() => ({}));
}