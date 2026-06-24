import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns per-action rights for a specific page key.
 *
 * Usage in a page component:
 *   const rights = usePageRights("purchase-orders");
 *   // rights.canView   → show the page
 *   // rights.canCreate → show "Add New" button
 *   // rights.canEdit   → show "Edit" button / enable form fields
 *   // rights.canDelete → show "Delete" button
 *   // rights.canPrint  → show "Print" button
 *   // rights.canExport → show "Export" button
 *
 * Privileged roles (super_admin, admin, dba) always get all rights = true.
 */
export function usePageRights(pageKey: string) {
  const { canDoAction, currentUser } = useAuth();

  // Privileged roles bypass all checks
  const privileged = ["super_admin", "admin", "dba"].includes(
    currentUser?.role ?? "",
  );

  const check = (action: string): boolean => {
    if (privileged) return true;
    return canDoAction(pageKey as any, action as any);
  };

  return {
    canView:   check("view"),
    canCreate: check("create"),
    canEdit:   check("edit"),
    canDelete: check("delete"),
    canPrint:  check("print"),
    canExport: check("export"),
    /** true if the user has at least one action on this page */
    hasAnyAccess: privileged || (currentUser?.pagePermissions ?? []).some(
      (p) => p.page === pageKey && p.actions.length > 0,
    ),
  };
}
