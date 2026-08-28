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
 * pageKey should match the kebab-case keys defined in the backend's
 * ROLE_RIGHTS_PAGE_MAP (roles.js) and/or the DB-driven page-definitions
 * table — these are now the single real source of truth. PageKey is `string`,
 * so a typo here won't be caught at compile time; double check the key
 * against roles.js or /api/page-definitions if a page seems to always deny.
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
    return canDoAction(pageKey, action as any);
  };

  return {
    canView:   check("view"),
    canCreate: check("create"),
    canEdit:   check("edit"),
    canDelete: check("delete"),
    canPrint:  check("print"),
    canExport: check("export"),
    /** Guards destructive, hard-to-undo actions distinct from plain delete
     *  (e.g. Fixed Asset Record's "Delete & Reverse GRN") — only granted
     *  where a page explicitly seeds 'reverse' into its PageDefinitions
     *  Actions list. */
    canReverse: check("reverse"),
    /** true if the user has at least one action on this page */
    hasAnyAccess: privileged || (currentUser?.pagePermissions ?? []).some(
      (p) => p.page === pageKey && p.actions.length > 0,
    ),
  };
}