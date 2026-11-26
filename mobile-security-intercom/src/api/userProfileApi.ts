// RN port of src/api/userProfileApi.ts: the signed-in user's own profile, name, password, photo, sign-in preference
// and recent activity — the same /api/user-profile endpoints the web's profile pages use.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/user-profile";

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  RoleId?: number;
  avatar_url: string | null;
  ShowLoginReminders?: boolean | number;
  roleName: string | null;
  created_datetime: string | null;
  discontinue: boolean | number | null;
}

export interface ActivityRow {
  CreatedAt: string;
  EventType?: string | null;
  ActionType?: string | null;
  Resource?: string | null;
}

async function fail(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error(body?.error ?? fallback);
}

export async function getUserProfile(id: number): Promise<UserProfile> {
  const res = await fetchWithAuth(`${BASE}/${id}/profile`);
  if (!res.ok) return fail(res, "Could not load your profile");
  return res.json();
}

export async function updateUserProfile(id: number, data: { name: string }) {
  const res = await fetchWithAuth(`${BASE}/${id}/profile`, { method: "PATCH", body: JSON.stringify(data) });
  if (!res.ok) return fail(res, "Could not update your profile");
  return res.json().catch(() => ({}));
}

export async function updateUserPreferences(id: number, data: { showLoginReminders: boolean }) {
  const res = await fetchWithAuth(`${BASE}/${id}/preferences`, { method: "PATCH", body: JSON.stringify(data) });
  if (!res.ok) return fail(res, "Could not save the preference");
  return res.json().catch(() => ({}));
}

export async function changePassword(id: number, current_password: string, new_password: string) {
  const res = await fetchWithAuth(`${BASE}/${id}/change-password`, { method: "POST", body: JSON.stringify({ current_password, new_password }) });
  if (!res.ok) return fail(res, "Password change failed");
  return res.json().catch(() => ({}));
}

export async function getUserActivity(id: number, limit = 30): Promise<ActivityRow[]> {
  const res = await fetchWithAuth(`${BASE}/${id}/activity?limit=${limit}`);
  if (!res.ok) return fail(res, "Could not load your activity");
  const raw = await res.json().catch(() => []);
  return Array.isArray(raw) ? raw : raw?.data ?? [];
}

/** A data: URI (JPEG / PNG / WebP / GIF, under ~400 KB). The web also sends a small list thumbnail made in the browser;
 * the server treats that as optional, so the phone sends the picture alone. */
export async function uploadAvatar(id: number, dataUri: string) {
  const res = await fetchWithAuth(`${BASE}/${id}/upload-avatar`, { method: "POST", body: JSON.stringify({ avatar: dataUri }) });
  if (!res.ok) return fail(res, "Could not upload the photo");
  return res.json().catch(() => ({}));
}

export async function removeAvatar(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}/avatar`, { method: "DELETE" });
  if (!res.ok) return fail(res, "Could not remove the photo");
  return res.json().catch(() => ({}));
}
