const { getEffectivePagePermissions } = require("./permissions");

// Pages the marketing_head role can fully administer.
// Uses prefix-matching for all SA pages plus explicit Sales page keys.
const MARKETING_HEAD_SA_PREFIX  = "sa-";
const MARKETING_HEAD_CRM_PREFIX = "crm-";
const MARKETING_HEAD_SALES_PAGES = new Set(["sale-order", "sale-invoice", "sales-payment"]);

function isMarketingHeadAllowed(pageKey) {
  return pageKey.startsWith(MARKETING_HEAD_SA_PREFIX)
    || pageKey.startsWith(MARKETING_HEAD_CRM_PREFIX)
    || MARKETING_HEAD_SALES_PAGES.has(pageKey);
}

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

      // marketing_head: full admin access scoped to Sales Automation + Sales pages only
      if (role === "marketing_head" && isMarketingHeadAllowed(String(pageKey).toLowerCase())) {
        return next();
      }

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

/**
 * Same check as requirePageRight, but passes if the user has the given
 * action on ANY of several page keys — for endpoints genuinely shared by
 * more than one page (e.g. removing a parking allotment is reachable both
 * from a booking's own detail view and from the standalone Parking Booking
 * page, and a user might only hold rights on one of the two pages).
 */
function requireAnyPageRight(pageKeys, action) {
  return async (req, res, next) => {
    try {
      const role = (req.user?.role || "").toLowerCase();
      const SUPERUSER_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);
      if (SUPERUSER_ROLES.has(role)) return next();

      if (role === "marketing_head" && pageKeys.some((k) => isMarketingHeadAllowed(String(k).toLowerCase()))) {
        return next();
      }

      const userId = req.user?.userId ?? req.user?.id;
      const roleId = req.user?.roleId;
      if (!userId) {
        return res.status(401).json({ error: "Invalid token - missing user id" });
      }

      const targetAction = String(action).toLowerCase();
      const targetPages = new Set(pageKeys.map((k) => String(k).toLowerCase()));

      const effective = await getEffectivePagePermissions(userId, roleId);
      const allowed = effective.some((right) => {
        const page = String(right?.page || "").toLowerCase();
        if (!targetPages.has(page)) return false;
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
      console.error("requireAnyPageRight check failed:", err);
      return res.status(500).json({ error: "Permission check error" });
    }
  };
}

module.exports = { requirePageRight, requireAnyPageRight };