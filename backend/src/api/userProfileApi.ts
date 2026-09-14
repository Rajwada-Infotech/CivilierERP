import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/user-profile";

export const getUserProfile = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/profile`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json().catch(() => ({}));
};

export const updateUserProfile = async (id: number, data: { name: string }) => {
  const res = await fetchWithAuth(`${BASE}/${id}/profile`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json().catch(() => ({}));
};

export const updateUserPreferences = async (
  id: number,
  data: { showLoginReminders: boolean },
) => {
  const res = await fetchWithAuth(`${BASE}/${id}/preferences`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update preferences");
  return res.json().catch(() => ({}));
};

export const changePassword = async (
  id: number,
  current_password: string,
  new_password: string,
) => {
  const res = await fetchWithAuth(`${BASE}/${id}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Password change failed");
  }
  return res.json().catch(() => ({}));
};

export const getUserPermissions = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/permissions`);
  if (!res.ok) throw new Error("Failed to fetch permissions");
  return res.json().catch(() => ({}));
};

export const getUserActivity = async (id: number, limit = 50) => {
  const res = await fetchWithAuth(`${BASE}/${id}/activity?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json().catch(() => ({}));
};

export const uploadAvatar = async (id: number, dataUri: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/upload-avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatar: dataUri }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to upload avatar");
  }
  return res.json().catch(() => ({}));
};

export const removeAvatar = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/avatar`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove avatar");
  return res.json().catch(() => ({}));
};
