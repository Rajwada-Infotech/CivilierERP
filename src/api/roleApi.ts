import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Types
export interface RoleRecord {
  RId: number;
  RName: string;
  RCode?: string;
  RDesc?: string;
  RCreatedBy: string;
  RCreatedAt: string;
  RUpdatedBy?: string;
  RUpdatedAt?: string;
  RApprovedBy?: string;
  RApprovedAt?: string;
}

// API Functions
export const getRoles = async (): Promise<RoleRecord[]> => {
  const res = await fetchWithAuth("/api/roles");
  if (!res.ok) {
    throw new Error("Failed to fetch roles");
  }
  return res.json();
};

export const addRole = async (data: { RName: string; RDesc?: string }): Promise<RoleRecord> => {
  const res = await fetchWithAuth("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create role");
  }
  return res.json();
};

export const updateRole = async (id: number, data: Partial<{ RName: string; RDesc: string }>): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`/api/roles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update role");
  }
  return res.json();
};

export const deleteRole = async (id: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`/api/roles/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Failed to delete role");
  }
  return res.json();
};

