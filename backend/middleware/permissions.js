const { getPool, sql } = require("../db");

// ─── IN-PROCESS PERMISSION CACHE ─────────────────────────────────────────────
// RoleRights rows are static config — they only change when an admin edits
// them via MenuRights/PostApprovalRights. Caching them in-process eliminates
// a ~100-200 ms SQL Server round-trip on EVERY authenticated request that uses
// checkPermission (user-activity, approval-inbox, etc.).
//
// TTL: 5 minutes. Short enough that a rights change is effective within one
// polling cycle, long enough to absorb all normal traffic load.
// On POST/PUT to RoleRights, call permissionCache.invalidateRole(roleId) so
// the change is visible immediately without waiting for TTL expiry.

const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

const permissionCache = (() => {
  // key: `${roleId}:${module}:${subModule}` → { row, fetchedAt }
  const store = new Map();

  function key(roleId, module, subModule) {
    return `${roleId}:${module}:${subModule}`;
  }

  async function get(roleId, module, subModule) {
    const k = key(roleId, module, subModule);
    const entry = store.get(k);
    if (entry && Date.now() - entry.fetchedAt < PERMISSION_CACHE_TTL_MS) {
      return entry.row; // null means "no permission row" — still cached
    }

    const pool = getPool();
    const result = await pool
      .request()
      .input("RoleId", sql.Int, roleId)
      .input("Module", sql.VarChar, module)
      .input("SubModule", sql.VarChar, subModule).query(`
        SELECT CanView, CanAdd, CanEdit, CanDelete
        FROM RoleRights
        WHERE RoleId = @RoleId
          AND Module = @Module
          AND SubModule = @SubModule
      `);

    const row = result.recordset[0] ?? null;
    store.set(k, { row, fetchedAt: Date.now() });
    return row;
  }

  // Call after any write to RoleRights for this role so the next request
  // re-fetches rather than serving stale cached permissions.
  function invalidateRole(roleId) {
    for (const k of store.keys()) {
      if (k.startsWith(`${roleId}:`)) store.delete(k);
    }
  }

  function invalidateAll() {
    store.clear();
  }

  return { get, invalidateRole, invalidateAll };
})();

// Roles that always have full access — no RoleRights row needed.
const SUPERUSER_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);

const checkPermission = (module, subModule, action = "CanView") => {
  return async (req, res, next) => {
    try {
      const roleId = req.user?.roleId;
      const role = req.user?.role;

      if (!roleId) {
        return res
          .status(401)
          .json({ error: "Invalid token - missing roleId" });
      }

      // super_admin / dba / admin bypass RoleRights entirely — they always
      // have full access. Without this, the Activity Browser (and any other
      // checkPermission-gated route) returns 403 for privileged users who
      // don't have an explicit RoleRights row, silently emptying the page.
      if (SUPERUSER_ROLES.has(role)) return next();

      if (process.env.DEBUG === "true") {
        console.log("CHECK PERMISSION:", {
          roleId,
          role,
          module,
          subModule,
          action,
        });
      }

      const permission = await permissionCache.get(roleId, module, subModule);

      if (!permission) {
        console.log("[DENIED] No permission row found");
        return res.status(403).json({ error: "Access denied (no permission)" });
      }

      if (Number(permission[action]) !== 1) {
        console.log("[DENIED] Action not allowed:", action);
        return res
          .status(403)
          .json({ error: "Access denied (action blocked)" });
      }

      next();
    } catch (err) {
      console.error("Permission check failed:", err);
      res.status(500).json({ error: "Permission check error" });
    }
  };
};

module.exports = { checkPermission, permissionCache };
