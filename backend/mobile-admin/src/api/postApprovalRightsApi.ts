// RN port of the fetch logic in src/pages/admin/PostApprovalRights.tsx and
// its dependencies (src/api/userApi.ts's rights slice, src/api/roleApi.ts's
// rights slice) — same endpoints, same contracts, trimmed to just what this
// screen needs.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface PageDef {
  key: string;
  label: string;
  group: string;
  module: string;
  actions: string[];
}

export interface PagePermission {
  page: string;
  actions: string[];
}

export const POST_APPROVAL_ACTION = "post-approval";

export const fetchPageDefinitions = async (): Promise<PageDef[]> => {
  const res = await fetchWithAuth("/api/page-definitions");
  if (!res.ok) throw new Error("Failed to load page definitions");
  const json = await res.json().catch(() => ({}));
  return json.data ?? [];
};

export const getUsersForRights = async (): Promise<{ id: number; name: string; role: string }[]> => {
  const res = await fetchWithAuth("/api/user-rights/users");
  if (!res.ok) throw new Error("Failed to fetch users for rights");
  return res.json().catch(() => []);
};

export const getUserPermissions = async (userId: number): Promise<PagePermission[]> => {
  const res = await fetchWithAuth(`/api/user-rights/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch user permissions");
  const data = await res.json().catch(() => ({}));
  return data.rightsJson || [];
};

export const saveUserPermissions = async (userId: number, permissions: PagePermission[]) => {
  const res = await fetchWithAuth(`/api/user-rights/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rightsJson: permissions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save permissions");
  }
  return res.json().catch(() => ({}));
};

export const getRolesList = async (): Promise<{ RId: number; RName: string }[]> => {
  const res = await fetchWithAuth("/api/roles/list");
  if (!res.ok) throw new Error("Failed to fetch roles list");
  return res.json().catch(() => []);
};

export const getRolePermissions = async (roleId: number): Promise<PagePermission[]> => {
  const res = await fetchWithAuth(`/api/roles/${roleId}/rights`);
  if (!res.ok) throw new Error("Failed to fetch role permissions");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

export const saveRolePermissions = async (roleId: number, permissions: PagePermission[]) => {
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
