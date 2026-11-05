// Direct port of src/hooks/usePageRights.ts (web) — identical contract, so
// a screen gated by pageKey behaves the same on mobile and web.
import { useAuth } from "@/auth/AuthContext";
import { PRIVILEGED_ROLES } from "@/auth/permissions";

export function usePageRights(pageKey: string) {
  const { canDoAction, currentUser } = useAuth();

  const privileged = PRIVILEGED_ROLES.includes((currentUser?.role ?? "user") as never);

  const check = (action: string): boolean => {
    if (privileged) return true;
    return canDoAction(pageKey, action as never);
  };

  return {
    canView: check("view"),
    canCreate: check("create"),
    canEdit: check("edit"),
    canDelete: check("delete"),
    canPrint: check("print"),
    canExport: check("export"),
    hasAnyAccess:
      privileged ||
      (currentUser?.pagePermissions ?? []).some(
        (p) => p.page === pageKey && p.actions.length > 0,
      ),
  };
}
