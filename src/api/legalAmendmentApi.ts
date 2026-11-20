import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Amendments to a registered land (backend/routes/legal/landAmendment.js).
const BASE = "/api/legal/amendments";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Request failed");
  return body as T;
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export interface AmendField { field: string; label: string; kind: "text" | "number" | "select"; max?: number; options?: string[] }
export type SectionKey = "rs" | "lr" | "owner" | "document" | "clearance" | "mutation";
export interface AmendCol { name: string; label: string; kind: "text" | "number" | "date" | "select" | "file" | "doctype"; max?: number; options?: string[]; required: boolean }
export interface AmendSection { title: string; ops: ("add" | "edit" | "remove" | "file")[]; cols: AmendCol[] }
export interface AmendChange { section?: "land" | SectionKey; op?: "add" | "edit" | "remove" | "file"; id?: number | string | null; field?: string; label: string; from: unknown; to: unknown }
export type CurrentRows = Record<SectionKey, (Record<string, unknown> & { id: number | string })[]>;
export interface Amendment {
  AmendmentId: number; LandId: number; LandCode: string; LandName: string; AmendmentNo: number; AmendType: string; Reason: string;
  ReferenceNo: string | null; Status: "Pending" | "Approved" | "Rejected" | "Withdrawn"; changes: AmendChange[];
  RequestedBy: number | null; RequestedByName: string | null; RequestedAt: string; DecidedByName: string | null; DecidedAt: string | null;
  DecisionRemarks: string | null; VersionNo: number | null;
}

export const getAmendFields = async () =>
  handle<{ fields: AmendField[]; types: string[]; sections: Record<SectionKey, AmendSection>; docTypes: { id: number; name: string }[] }>(await fetchWithAuth(`${BASE}/fields`));
export const getPendingAmendments = async (qs = "") => handle<{ items: Amendment[]; canApprove: boolean; userId: number | null; total?: number; page?: number; pageSize?: number }>(await fetchWithAuth(`${BASE}/pending${qs ? `?${qs}` : ""}`));
export const getLandAmendments = async (landId: number) =>
  handle<{ items: Amendment[]; canApprove: boolean; locked: boolean; userId: number | null; current: CurrentRows | null; land: Record<string, unknown> | null }>(await fetchWithAuth(`${BASE}/land/${landId}`));
export const requestAmendment = async (landId: number, body: { type: string; reason: string; referenceNo?: string; changes: unknown[] }) =>
  handle<{ id: number; message: string }>(await fetchWithAuth(`${BASE}/land/${landId}`, post(body)));
export const approveAmendment = async (id: number, remarks: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/approve`, post({ remarks })));
export const rejectAmendment = async (id: number, remarks: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/reject`, post({ remarks })));
export const withdrawAmendment = async (id: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/withdraw`, post({})));
