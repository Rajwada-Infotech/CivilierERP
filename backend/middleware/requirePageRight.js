const { getEffectivePagePermissions } = require("./permissions");

/**
 * Authorization middleware keyed directly on the `page` slug stored in
 * dbo.UserPageRightsJson (e.g. "financial-year-master", "item-master") and,
 * as of this version, also on role-level defaults in dbo.RoleRights.
 *
 * History: this used to call userHasPermissionByPage(), which only checked
 * the per-user row in UserPageRightsJson. RoleRights was empty in
 * production at the time, so role-level defaults were a dead path anyway —
 * every new user got NULL rights and required a manual per-user grant via
 * Menu Rights (or SSMS) before they could access anything, even pages their
 * role should logically always have.
 *
 * RoleRights is now seeded for role-level baselines (see migration 123),
 * and getEffectivePagePermissions(userId, roleId) merges role-level rights
 * with any per-user overrides/additions in UserPageRightsJson. A user with
 * no per-user row at all now still gets whatever their role grants.
 *
 * action: one of "view" | "create" | "edit" | "delete" | "print" | "export"
 * (matches the literal strings stored in RightsJson actions arrays, and the
 * same strings produced by getRolePagePermissions() from RoleRights columns).
 */
function requirePageRight(pageKey, action) {
  return async (req, res, next) => {
    try {
      const role = (req.user?.role || "").toLowerCase();
      const SUPERUSER_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);
      if (SUPERUSER_ROLES.has(role)) return next();

      const userId = req.user?.userId ?? req.user?.id;
      const roleId = req.user?.roleId;
      if (!userId) {
        return res.status(401).json({ error: "Invalid token - missing user id" });
      }

      const targetPage = String(pageKey).toLowerCase();
      const targetAction = String(action).toLowerCase();

      const effective = await getEffectivePagePermissions(userId, roleId);
      const allowed = effective.some((right) => {
        const page = String(right?.page || "").toLowerCase();
        if (page !== targetPage) return false;
        const actions = Array.isArray(right?.actions)
          ? right.actions.map((item) => String(item).toLowerCase())
          : [];
        return actions.includes(targetAction);
      });

      if (!allowed) {
        return res.status(403).json({ error: "Access denied" });
      }
      return next();
    } catch (err) {
      console.error("requirePageRight check failed:", err);
      return res.status(500).json({ error: "Permission check error" });
    }
  };
}

module.exports = { requirePageRight };