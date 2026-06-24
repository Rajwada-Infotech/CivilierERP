const { getPool, sql } = require("../db");
const { normalizeRole } = require("./role");

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

const userPermissionCache = (() => {
  const store = new Map();

  async function get(userId) {
    const key = String(userId);
    const entry = store.get(key);
    if (entry && Date.now() - entry.fetchedAt < PERMISSION_CACHE_TTL_MS) {
      return entry.rights;
    }

    const pool = getPool();
    const result = await pool
      .request()
      .input("UserId", sql.Int, Number(userId)).query(`
        SELECT RightsJson
        FROM dbo.UserPageRightsJson
        WHERE UserId = @UserId AND IsActive = 1
      `);

    let rights = [];
    try {
      rights = JSON.parse(result.recordset[0]?.RightsJson || "[]");
    } catch {
      rights = [];
    }

    store.set(key, { rights, fetchedAt: Date.now() });
    return rights;
  }

  function invalidateUser(userId) {
    store.delete(String(userId));
  }

  function invalidateAll() {
    store.clear();
  }

  return { get, invalidateUser, invalidateAll };
})();

const ACTION_TO_PAGE_ACTION = {
  CanView: "view",
  CanAdd: "create",
  CanEdit: "edit",
  CanDelete: "delete",
};

const PERMISSION_PAGE_KEYS = {
  "admin:documenttype": ["document-type", "typeofdoc"],
  "engineering:boq": ["boq"],
  "engineering:dashboard": ["engineering-dashboard"],
  "engineering:workdone": ["engineering-dashboard", "work-done"],
  "engineering:workorders": ["work-order", "engineering-work-order"],
  "finance:brs": ["brs"],
  "finance:dashboard": ["finance-dashboard"],
  "finance:expensebooking": ["expense-booking"],
  "finance:payments": ["new-payment", "payments"],
  "finance:receivedpayments": ["received-payment"],
  "finance:reports": ["reports"],
  "finance:transactions": ["transactions"],
  "followup:agreements": ["followup-agreements"],
  "followup:applicants": ["followup-applicants", "followup-applications"],
  "followup:bookings": ["followup-bookings"],
  "followup:constructionupdates": ["followup-construction-updates"],
  "followup:handover": ["followup-handover"],
  "followup:noc": ["followup-noc"],
  "followup:salesdeed": ["followup-sales-deed"],
  "followup:unitselections": ["followup-unit-selections"],
  "material:grn": ["grn-master", "grns"],
  "material:purchaseorders": ["purchase-orders"],
  "rights:menu": ["menu-rights", "admin_menu_rights"],
  "rights:rolemaster": ["roles"],
  "user control:manage users": ["users"],
  "useractivity:list": ["user-activity", "activity-browser"],
  "users:list": ["users"],
};

function compact(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function kebab(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function getCandidatePageKeys(module, subModule) {
  const key = `${compact(module)}:${compact(subModule)}`;
  const mapped = PERMISSION_PAGE_KEYS[key] || [];
  const sub = kebab(subModule);
  const mod = kebab(module);
  return [...new Set([...mapped, sub, `${mod}-${sub}`])];
}

async function userHasPermission(userId, module, subModule, action) {
  if (!userId) return false;

  const pageAction = ACTION_TO_PAGE_ACTION[action];
  if (!pageAction) return false;

  const rights = await userPermissionCache.get(userId);
  if (!Array.isArray(rights) || rights.length === 0) return false;

  const candidates = new Set(
    getCandidatePageKeys(module, subModule).map((page) =>
      String(page).toLowerCase(),
    ),
  );

  return rights.some((right) => {
    const page = String(right?.page || "").toLowerCase();
    const actions = Array.isArray(right?.actions)
      ? right.actions.map((item) => String(item).toLowerCase())
      : [];
    return candidates.has(page) && actions.includes(pageAction);
  });
}

const checkPermission = (module, subModule, action = "CanView") => {
  return async (req, res, next) => {
    try {
      const roleId = req.user?.roleId;
      const role = normalizeRole(req.user?.role);
      const userId = req.user?.userId ?? req.user?.id;

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

      // Check user-level rights first (UserPageRightsJson) — these are the
      // granular per-user permissions set via MenuRights and are the single
      // source of truth for non-privileged users.
      if (userId && await userHasPermission(userId, module, subModule, action)) {
        return next();
      }

      // Fall back to role-level rights (RoleRights) only when no user-level
      // row exists for this user. This prevents a denying RoleRights row from
      // silently overriding user-level grants set in MenuRights.
      const permission = await permissionCache.get(roleId, module, subModule);

      if (permission && Number(permission[action]) === 1) {
        return next();
      }

      if (!permission) {
        console.log("[DENIED] No permission row found", {
          roleId,
          module,
          subModule,
          userId,
        });
        return res.status(403).json({ error: "Access denied (no permission)" });
      }

      console.log("[DENIED] Action not allowed:", {
        roleId,
        module,
        subModule,
        action,
        userId,
      });
      return res.status(403).json({ error: "Access denied (action blocked)" });
    } catch (err) {
      console.error("Permission check failed:", err);
      res.status(500).json({ error: "Permission check error" });
    }
  };
};

module.exports = { checkPermission, permissionCache, userPermissionCache };
