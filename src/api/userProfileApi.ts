const BASE = "/api/user-profile";

export const getUserProfile = async (id: number) => {
  const res = await fetch(`${BASE}/${id}/profile`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
};

export const updateUserProfile = async (id: number, data: { name: string }) => {
  const res = await fetch(`${BASE}/${id}/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json();
};

export const changePassword = async (
  id: number,
  current_password: string,
  new_password: string,
) => {
  const res = await fetch(`${BASE}/${id}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Password change failed");
  }
  return res.json();
};

export const getUserPermissions = async (id: number) => {
  const res = await fetch(`${BASE}/${id}/permissions`);
  if (!res.ok) throw new Error("Failed to fetch permissions");
  return res.json();
};

export const getUserActivity = async (id: number, limit = 50) => {
  const res = await fetch(`${BASE}/${id}/activity?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json();
};
