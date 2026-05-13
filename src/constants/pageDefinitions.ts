// src/constants/pageDefinitions.ts
//
// PAGE_DEFINITIONS, PageKey, PageAction, PagePermission, PageDefinition
// are all canonical in src/contexts/auth.utils.ts — re-exported here for
// backwards-compatible imports.
export {
  PAGE_DEFINITIONS,
  type PageKey,
  type PageAction,
  type PagePermission,
} from "@/contexts/auth.utils";

// Path-prefix strings used by TopNavbar to detect admin routes.
// Not duplicated in auth.utils (which uses page keys, not paths).
export const ADMIN_PATHS = [
  "/masters/named-entry-type",
  "/masters/type-of-doc",
  "/admin/masters/role-master",
  "/admin/masters/menu-types",
] as const;
