import api from "./axios";
import type { PagePermission } from "@/contexts/types";

export type { PagePermission };

const BASE_URL = "/users";
const RIGHTS_BASE_URL = "/user-rights";

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

// Login intentionally uses raw fetch — no auth header needed and the axios
// instance's 401 interceptor would redirect before the response is read.
export const loginUser = async (email: string, password: string) => {
  const res = await fetch(`/api${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json();
};

export const getUsers = async (): Promise<User[]> => {
  const res = await api.get<User[]>(BASE_URL);
  return res.data;
};

export const addUser = async (user: {
  name: string;
  email: string;
  role: string;
  password: string;
}) => {
  const res = await api.post(BASE_URL, user);
  return res.data;
};

export const updateUser = async (id: number, user: Partial<User>) => {
  const res = await api.put(`${BASE_URL}/${id}`, user);
  return res.data;
};

export const deleteUser = async (id: number) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
};

export const getUsersForRights = async (): Promise<
  { id: number; name: string; role: string }[]
> => {
  const res = await api.get(`${RIGHTS_BASE_URL}/users`);
  return res.data;
};

export const getUserPermissions = async (
  userId: number,
): Promise<PagePermission[]> => {
  const res = await api.get(`${RIGHTS_BASE_URL}/${userId}`);
  return res.data.rightsJson || [];
};

export const saveUserPermissions = async (
  userId: number,
  permissions: PagePermission[],
): Promise<{ success: boolean; message: string }> => {
  const res = await api.put(`${RIGHTS_BASE_URL}/${userId}`, {
    rightsJson: permissions,
  });
  return res.data;
};

export const resetUserPassword = async (
  id: number,
  new_password: string,
): Promise<{ message: string }> => {
  const res = await api.patch(`${BASE_URL}/${id}/reset-password`, {
    new_password,
  });
  return res.data;
};

export default {
  loginUser,
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getUsersForRights,
  getUserPermissions,
  saveUserPermissions,
  resetUserPassword,
};