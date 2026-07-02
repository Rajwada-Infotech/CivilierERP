import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-legal-milestones";

export interface LegalMilestoneStep {
  stepField: string; // e.g. "DocCollection"
  status: string;
  doneDate?: string;
  notes?: string;
  /**
   * Set to true to explicitly clear notes for this step.
   * When true, notes is ignored and the column is set to NULL.
   * This works around the COALESCE issue where sending notes: ""
   * would be treated as "no change" by the backend.
   */
  clearNotes?: boolean;
}

export interface LegalMilestoneOverallStatus {
  overallStatus: "In Progress" | "On Hold" | "Cancelled" | "Completed";
}

/** Structured error shape returned by the API */
interface ApiError {
  error: string;
  details?: unknown;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body: ApiError = await res.json();
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchLegalMilestonesOptions() {
  const res = await fetchWithAuth(`${BASE}/meta/options`);
  if (!res.ok) throw new Error(`Failed to load options: ${await parseError(res)}`);
  return res.json().catch(() => ({}));
}

export async function fetchLegalMilestones(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch Legal Milestones: ${await parseError(res)}`);
  return res.json().catch(() => ({}));
}

export async function createLegalMilestone(payload: Record<string, unknown>) {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json().catch(() => ({}));
}

/**
 * Full update of a legal milestone record (PUT).
 * Use this to change OverallStatus to "On Hold" or "Cancelled",
 * or to edit top-level fields like AgreementDate, Remarks, etc.
 */
export async function updateLegalMilestone(
  id: number,
  payload: Record<string, unknown>
) {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json().catch(() => ({}));
}

/**
 * Convenience wrapper — sets only the OverallStatus on a milestone.
 * Needed because the stepper only auto-advances status; manual "On Hold"
 * and "Cancelled" transitions must go through the PUT endpoint.
 */
export async function patchOverallStatus(
  id: number,
  overallStatus: LegalMilestoneOverallStatus["overallStatus"]
) {
  return updateLegalMilestone(id, { OverallStatus: overallStatus });
}

/**
 * Updates a single step's status, doneDate, and notes.
 *
 * To intentionally clear notes, pass clearNotes: true.
 * Passing notes: "" without clearNotes will NOT clear existing notes
 * (backend COALESCE preserves old value when receiving null/empty).
 */
export async function updateMilestoneStep(
  id: number,
  step: LegalMilestoneStep
) {
  const res = await fetchWithAuth(`${BASE}/${id}/step`, {
    method: "PATCH",
    body: JSON.stringify(step),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json().catch(() => ({}));
}

export async function deleteLegalMilestone(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete: ${await parseError(res)}`);
  return res.json().catch(() => ({}));
}