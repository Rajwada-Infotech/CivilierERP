// This app is Follow-Up-only, so "module access" collapses to a single
// check: can the user see the Follow-Up module. Mirrors the web app's
// hasModuleAccess("followup") (src/pages/Home.tsx) — privileged roles
// always pass, everyone else needs one of the follow-up page keys.
import { useMemo } from "react";
import { useAuth } from "@/auth/AuthContext";

export const PRIVILEGED_ROLES = ["super_admin", "admin", "dba"];

export const FOLLOWUP_PAGE_KEYS = [
  "followup-dashboard",
  "task-master",
  "followup-close-tasks",
  "followup-cancelled-tasks",
  "followup-task-transfer",
  "task-performance-report",
  "entry-type-doc-followup-report",
  "followup-department-master",
  "followup-tag-master",
  "followup-cancel-template-master",
];

export function useModuleAccess() {
  const { currentUser, canAccessPage } = useAuth();
  const role = currentUser?.role ?? "";
  const privileged = PRIVILEGED_ROLES.includes(role);

  const followup = useMemo(
    () => privileged || FOLLOWUP_PAGE_KEYS.some((pk) => canAccessPage(pk)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, privileged],
  );

  return { role, privileged, isAdmin: privileged, followup };
}
