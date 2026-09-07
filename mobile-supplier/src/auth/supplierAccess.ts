// This app is supplier-only — mirrors the backend's own gate
// (backend/server.js mounts /api/supplier-portal behind
// authenticateToken + role("supplier")), so a non-supplier account that
// somehow logs in here gets a plain access-denied state instead of
// hitting endpoints it will just get 403'd on.
import { useAuth } from "@/auth/AuthContext";

export function useIsSupplier(): boolean {
  const { currentUser } = useAuth();
  return currentUser?.role === "supplier";
}
