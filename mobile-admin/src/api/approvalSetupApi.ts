// RN port of src/pages/admin/ApprovalSetup.tsx's fetch/type logic (web) —
// same endpoint (/api/approval-workflows), same ApprovalWorkflow/Level
// shape. getUsers is a trimmed port of src/api/userApi.ts (just the list
// fetch this screen needs — no create/update/delete user management here).
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

export const getUsers = async (): Promise<User[]> => {
  const res = await fetchWithAuth("/api/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => []);
};

export interface ApprovalLevel {
  id: number;
  label: string;
  userIds: number[];
  /** Role names (Role.RName) whose holders may approve at this step, besides the people named in userIds. Must be sent
   * back on save: leaving it out used to drop a step's roles whenever a rule was edited on the phone. */
  roles?: string[];
  /** "any" (default): the step is done when one assigned person approves. "all": every assigned person must approve. */
  mode?: "any" | "all";
}

export interface ApprovalWorkflow {
  id: number;
  name: string;
  type: "sequential" | "any" | "parallel";
  modules: string[];
  levels: ApprovalLevel[];
  active: boolean;
  description?: string;
  createdAt?: string;
}

const APPROVAL_API = "/api/approval-workflows";

export async function fetchWorkflows(): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(APPROVAL_API);
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json().catch(() => []);
}

export async function saveWorkflow(body: Omit<ApprovalWorkflow, "id" | "createdAt">, id?: number) {
  const method = id ? "PUT" : "POST";
  const url = id ? `${APPROVAL_API}/${id}` : APPROVAL_API;
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
  return res.json().catch(() => ({}));
}

export async function toggleWorkflow(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}/toggle`, { method: "PATCH" });
  if (!res.ok) throw new Error("Toggle failed");
}

export async function deleteWorkflow(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

/** Role Master's role names, for "everyone with these roles" on a step (web: getRolesList). */
export async function getRoleNames(): Promise<string[]> {
  const res = await fetchWithAuth("/api/roles/list");
  if (!res.ok) throw new Error("Failed to fetch roles");
  const rows = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map((r: { RName?: string }) => r.RName)
    .filter((n: unknown): n is string => !!n)
    .sort((a: string, b: string) => a.localeCompare(b));
}
