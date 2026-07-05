import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { PagePermission } from "@/contexts/types";

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

// Lightweight list for dropdowns — any authenticated user can call this.
// Uses /api/roles/list which only checks for a valid token (no admin rights needed).
export const getRolesList = async (): Promise<
  Pick<RoleRecord, "RId" | "RName">[]
> => {
  const res = await fetchWithAuth("/api/roles/list");
  if (!res.ok) {
    throw new Error("Failed to fetch roles list");
  }
  return res.json().catch(() => ({}));
};

// Full role records — requires admin (Rights > Menu > CanView). Use in Role Master only.
export const getRoles = async (): Promise<RoleRecord[]> => {
  const res = await fetchWithAuth("/api/roles");
  if (!res.ok) {
    throw new Error("Failed to fetch roles");
  }
  return res.json().catch(() => ({}));
};

export const addRole = async (data: {
  RName: string;
  RDesc?: string;
}): Promise<RoleRecord> => {
  const res = await fetchWithAuth("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create role");
  }
  return res.json().catch(() => ({}));
};

export const updateRole = async (
  id: number,
  data: Partial<{ RName: string; RDesc: string }>,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`/api/roles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update role");
  }
  return res.json().catch(() => ({}));
};

export const deleteRole = async (id: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`/api/roles/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Failed to delete role");
  }
  return res.json().catch(() => ({}));
};

// Role-wise page permissions — the baseline every user with this role
// inherits, merged live with any of their own per-user overrides
// (see backend getEffectivePagePermissions). Editing this affects every
// user holding the role immediately, not just future assignments.
export const getRolePermissions = async (
  roleId: number,
): Promise<PagePermission[]> => {
  const res = await fetchWithAuth(`/api/roles/${roleId}/rights`);
  if (!res.ok) throw new Error("Failed to fetch role permissions");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

export const saveRolePermissions = async (
  roleId: number,
  permissions: PagePermission[],
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`/api/roles/${roleId}/rights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePermissions: permissions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save role permissions");
  }
  return res.json().catch(() => ({}));
};
