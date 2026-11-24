// Which of the app's three interfaces the signed-in user gets. Decided from the role's NAME (the login returns it
// lower-cased, e.g. "security super admin"), never from a role id: ids differ between databases.
import { useAuth } from "@/auth/AuthContext";

export type SecurityView = "guard" | "admin" | "customer";

/** "Security Super Admin", "security-super-admin" and "security_super_admin" all read the same. */
const canonical = (role: string) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const ADMIN_ROLES = new Set(["security_super_admin", "security_admin", "super_admin", "admin"]);
const GUARD_ROLES = new Set(["guard", "security_guard", "security"]);
const CUSTOMER_ROLES = new Set(["customer", "resident"]);

export function securityViewOf(role: string): SecurityView | null {
  const r = canonical(role);
  if (ADMIN_ROLES.has(r)) return "admin";
  if (GUARD_ROLES.has(r)) return "guard";
  if (CUSTOMER_ROLES.has(r)) return "customer";
  return null;
}

export const VIEW_LABEL: Record<SecurityView, string> = {
  guard: "Guard",
  admin: "Security Admin",
  customer: "Resident",
};

export function useSecurityView() {
  const { currentUser } = useAuth();
  const role = currentUser?.role ?? "";
  // A resident signed in with the customer portal is always the resident view. A staff login never is: residents
  // sign in with the customer portal, so a staff account with a customer role gets no interface here.
  if (currentUser?.kind === "customer") return { role, view: "customer" as const };
  const view = securityViewOf(role);
  return { role, view: view === "customer" ? null : view };
}
