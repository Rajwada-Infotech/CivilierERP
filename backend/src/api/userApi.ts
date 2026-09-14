import type { PagePermission } from "@/contexts/types";

export type { PagePermission };

const BASE_URL = "/api/users";
const RIGHTS_BASE_URL = "/api/user-rights";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  roleName?: string;
  RoleId?: number;
  created_datetime: string;
  discontinue: boolean;
  can_accept_tickets?: boolean;
  last_login?: string | null;
  tenant_id?: string | null;
  tenantId?: string | null;
}

// Login lives in authApi.ts (used by AuthContext); keep that as the canonical
// implementation so backend error messages are preserved consistently.

export const getUsers = async (): Promise<User[]> => {
  const res = await fetch(BASE_URL, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => ({}));
};

export const addUser = async (user: {
  name: string;
  email: string;
  role: string;
  password: string;
}) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Failed to add user");
  return res.json().catch(() => ({}));
};

export const updateUser = async (id: number, user: Partial<User>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Failed to update user");
  return res.json().catch(() => ({}));
};

export const deleteUser = async (id: number) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete user");
  return res.json().catch(() => ({}));
};

export const getUsersForRights = async (): Promise<
  { id: number; name: string; role: string }[]
> => {
  const res = await fetch(`${RIGHTS_BASE_URL}/users`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch users for rights");
  return res.json().catch(() => ({}));
};

export const getUserPermissions = async (
  userId: number,
): Promise<PagePermission[]> => {
  const res = await fetch(`${RIGHTS_BASE_URL}/${userId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch user permissions");
  const data = await res.json().catch(() => ({}));
  return data.rightsJson || [];
};

export const saveUserPermissions = async (
  userId: number,
  permissions: PagePermission[],
): Promise<{ success: boolean; message: string }> => {
  const res = await fetch(`${RIGHTS_BASE_URL}/${userId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ rightsJson: permissions }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to save permissions");
  }

  return res.json().catch(() => ({}));
};

export const resetUserPassword = async (
  id: number,
  new_password: string,
): Promise<{ message: string }> => {
  const res = await fetch(`${BASE_URL}/${id}/reset-password`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ new_password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to reset password");
  }
  return res.json().catch(() => ({}));
};

export default {
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
  resetUserPassword,
};
