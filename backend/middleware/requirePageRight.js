const { userHasPermissionByPage } = require("./permissions");

/**
 * Authorization middleware keyed directly on the `page` slug stored in
 * dbo.UserPageRightsJson (e.g. "financial-year-master", "item-master").
 *
 * Why this exists instead of reusing checkPermission(Module, SubModule, action):
 * RoleRights is empty in production (0 rows) — checkPermission's primary
 * lookup path always misses and falls through to userHasPermission(), which
 * matches against page keys derived from Module/SubModule via
 * getCandidatePageKeys(). That indirection is unnecessary risk for new
 * routes: it's easy to pick a Module/SubModule pair that doesn't resolve to
 * the real page key, which would silently 403 everyone non-superuser.
 * This middleware skips the indirection and checks the page key directly.
 *
 * action: one of "view" | "create" | "edit" | "delete" | "print" | "export"
 * (matches the literal strings stored in RightsJson actions arrays).
 */
function requirePageRight(pageKey, action) {
  return async (req, res, next) => {
    try {
      const role = (req.user?.role || "").toLowerCase();
      const SUPERUSER_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);
      if (SUPERUSER_ROLES.has(role)) return next();

      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Invalid token - missing user id" });
      }

      const allowed = await userHasPermissionByPage(userId, pageKey, action);
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
