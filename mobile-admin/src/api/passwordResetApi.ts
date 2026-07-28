// RN port of the fetch logic in src/pages/admin/security/PasswordReset.tsx
// (web) — reuses GET /api/users and PATCH /api/users/:id/reset-password,
// same as src/api/userApi.ts's getUsers/resetUserPassword.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface ResetUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export const getUsers = async (): Promise<ResetUser[]> => {
  const res = await fetchWithAuth("/api/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  const raw = await res.json().catch(() => []);
  return (Array.isArray(raw) ? raw : []).map((u: any) => ({
    id: String(u.id),
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: !u.discontinue,
  }));
};

export const resetUserPassword = async (id: number, newPassword: string): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`/api/users/${id}/reset-password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to reset password");
  return data;
};
