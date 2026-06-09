import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  ApprovalLevel,
  ApprovalWorkflow,
} from "@/pages/admin/ApprovalSetup";

const BASE = "/api/approval-workflows";

export type { ApprovalWorkflow, ApprovalLevel };

export async function getApprovalWorkflows(): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error("Failed to fetch approval workflows");
  return res.json();
}

export async function getApprovalWorkflowsByModule(
  module: string,
): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(
    `${BASE}?module=${encodeURIComponent(module)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch workflows for module");
  return res.json();
}

export async function createApprovalWorkflow(
  data: Omit<ApprovalWorkflow, "id" | "createdAt">,
): Promise<ApprovalWorkflow> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Create failed");
  return res.json();
}

export async function updateApprovalWorkflow(
  id: number,
  data: Partial<Omit<ApprovalWorkflow, "id" | "createdAt">>,
): Promise<ApprovalWorkflow> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Update failed");
  return res.json();
}

export async function toggleApprovalWorkflow(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}/toggle`, { method: "PATCH" });
  if (!res.ok) throw new Error("Toggle failed");
}

export async function deleteApprovalWorkflow(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}
