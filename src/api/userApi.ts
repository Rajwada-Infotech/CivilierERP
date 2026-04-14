const BASE_URL = "/api/users";
const RIGHTS_BASE_URL = "/api/user-rights";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

// ======================
// TYPES
// ======================
export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_datetime: string;
  discontinue: boolean;
}

export interface PagePermission {
  page: string;
  actions: ("view" | "create" | "edit" | "delete" | "print" | "export")[];
}

// ======================
// AUTH & USER MANAGEMENT
// ======================
export const loginUser = async (email: string, password: string) => {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json(); // returns { success, token, user }
};

export const getUsers = async (): Promise<User[]> => {
  const res = await fetch(BASE_URL, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
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
  return res.json();
};

export const updateUser = async (id: number, user: Partial<User>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Failed to update user");
  return res.json();
};

export const deleteUser = async (id: number) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete user");
  return res.json();
};

// ======================
// MENU RIGHTS / PERMISSIONS (New)
// ======================

/**
 * Get non-admin users for Menu Rights dropdown
 */
export const getUsersForRights = async (): Promise<
  { id: number; name: string; role: string }[]
> => {
  const res = await fetch(`${RIGHTS_BASE_URL}/users`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch users for rights");
  return res.json();
};

/**
 * Get user permissions from dbo.UserPageRightsJson
 */
export const getUserPermissions = async (
  userId: number,
): Promise<PagePermission[]> => {
  const res = await fetch(`${RIGHTS_BASE_URL}/${userId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch user permissions");
  const data = await res.json();
  return data.rightsJson || [];
};

/**
 * Save permissions to dbo.UserPageRightsJson
 */
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

  return res.json();
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
};
