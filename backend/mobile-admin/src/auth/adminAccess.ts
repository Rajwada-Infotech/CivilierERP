// This app is admin-only (unlike mobile/, which is multi-module) — there's
// no module list to gate, just a single role check. Mirrors the "admin"
// entry in mobile/src/navigation/moduleAccess.ts (privileged && !isDba),
// since DBA gets its own separate console, not this app.
import { useAuth } from "@/auth/AuthContext";

export const ADMIN_ROLES = ["super_admin", "admin"];

export function useIsAdmin(): boolean {
  const { currentUser } = useAuth();
  return ADMIN_ROLES.includes(currentUser?.role ?? "");
}
