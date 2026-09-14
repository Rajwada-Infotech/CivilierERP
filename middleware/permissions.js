const { getPool, sql } = require("../db");
const { normalizeRole } = require("./role");

// ─── IN-PROCESS PERMISSION CACHE ─────────────────────────────────────────────
const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

const permissionCache = (() => {
  const store = new Map();

  function key(roleId, module, subModule) {
    return `${roleId}:${module}:${subModule}`;
  }

  async function get(roleId, module, subModule) {
    const k = key(roleId, module, subModule);
    const entry = store.get(k);
    if (entry && Date.now() - entry.fetchedAt < PERMISSION_CACHE_TTL_MS) {
      return entry.row;
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
    const result = await pool.request().input("UserId", sql.Int, Number(userId))
      .query(`
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

// ─── ACTION NAME NORMALIZATION ───────────────────────────────────────────────
// checkPermission() is meant to be called with the canonical "CanView" /
// "CanAdd" / "CanEdit" / "CanDelete" names (these are the literal RoleRights
// column names). Some route files (e.g. followupDemands.js, followupPayments.js)
// were written using a shorthand "read"/"write" vocabulary instead. Passing an
// unrecognized action string used to silently resolve to `undefined` in both
// `permission[action]` and `ACTION_TO_PAGE_ACTION[action]`, which always
// evaluates false — meaning those routes could NEVER be granted to anyone
// except SUPERUSER_ROLES, no matter what an admin set in Role Rights or the
// Permission Editor. This map normalizes known shorthand to the canonical
// names so that bug class can't silently recur. Prefer fixing call sites to
// use the canonical names directly; this is a safety net, not a license to
// keep using shorthand.
const ACTION_ALIASES = {
  read: "CanView",
  view: "CanView",
  write: "CanEdit",
  create: "CanAdd",
  add: "CanAdd",
  edit: "CanEdit",
  update: "CanEdit",
  delete: "CanDelete",
  remove: "CanDelete",
};

function normalizeAction(action) {
  if (ACTION_TO_PAGE_ACTION[action]) return action;
  return ACTION_ALIASES[action] || action;
}

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
  "salesautomation:socialmedia": ["sa-social-media"],
  "salesautomation:campaigns": ["sa-campaigns"],
  "salesautomation:ads": ["sa-ads"],
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
  const all = [...new Set([...mapped, sub, `${mod}-${sub}`])];
  return all;
}

async function getRolePagePermissions(roleId) {
  if (!roleId) return [];
  const pool = getPool();
  const result = await pool.request().input("RoleId", sql.Int, roleId).query(`
      SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval
      FROM dbo.RoleRights
      WHERE RoleId = @RoleId
    `);

  const byPage = new Map();
  for (const row of result.recordset) {
    const actions = [];
    if (row.CanView) actions.push("view");
    if (row.CanAdd) actions.push("create");
    if (row.CanEdit) actions.push("edit");
    if (row.CanDelete) actions.push("delete");
    if (row.CanPrint) actions.push("print");
    if (row.CanExport) actions.push("export");
    if (row.CanPostApproval) actions.push("post-approval");
    if (actions.length === 0) continue;

    for (const page of getCandidatePageKeys(row.Module, row.SubModule)) {
      const existing = byPage.get(page) ?? new Set();
      actions.forEach((a) => existing.add(a));
      byPage.set(page, existing);
    }
  }

  return Array.from(byPage.entries()).map(([page, actions]) => ({
    page,
    actions: Array.from(actions),
  }));
}

// A per-user override REPLACES the role's grant for any page it touches —
// it is not unioned with it. If it were a union, unchecking an action in
// Custom User-wise mode (MenuRights.tsx) could never actually revoke
// anything the user's role already grants, since the role's entry for that
// same page would keep re-adding it. Only pages the user has never
// customized (no entry at all in their own UserPageRightsJson) fall back to
// the role baseline — that's the "overrides add on top of the role" case
// (extending access beyond it); restricting below it now works too.
function mergePagePermissions(rolePerms, userPerms) {
  const byPage = new Map();
  for (const entry of rolePerms || []) {
    const page = String(entry?.page || "").toLowerCase();
    if (!page) continue;
    const actions = Array.isArray(entry?.actions) ? entry.actions : [];
    byPage.set(page, new Set(actions.map((a) => String(a).toLowerCase())));
  }
  for (const entry of userPerms || []) {
    const page = String(entry?.page || "").toLowerCase();
    if (!page) continue;
    const actions = Array.isArray(entry?.actions) ? entry.actions : [];
    // Full override, not union — even an empty actions list here means
    // "this user's access to this page is explicitly none", not "unset".
    byPage.set(page, new Set(actions.map((a) => String(a).toLowerCase())));
  }
  return Array.from(byPage.entries()).map(([page, actions]) => ({
    page,
    actions: Array.from(actions),
  }));
}

async function getEffectivePagePermissions(userId, roleId) {
  const [rolePerms, userPerms] = await Promise.all([
    getRolePagePermissions(roleId),
    userPermissionCache.get(userId),
  ]);
  return mergePagePermissions(rolePerms, userPerms);
}

/**
 * Effective (role + per-user merged) check for a single page/action pair —
 * used by guardEdit()'s "post-approval" bypass so routes can ask "can this
 * user edit an already-Approved record on this page?" without duplicating
 * getEffectivePagePermissions' merge-and-scan logic at every call site.
 */
async function userHasEffectivePageRight(userId, roleId, pageKey, action) {
  if (!userId || !pageKey) return false;
  const effective = await getEffectivePagePermissions(userId, roleId);
  const targetPage = String(pageKey).toLowerCase();
  const targetAction = String(action).toLowerCase();
  return effective.some((right) => {
    const page = String(right?.page || "").toLowerCase();
    if (page !== targetPage) return false;
    const actions = Array.isArray(right?.actions)
      ? right.actions.map((item) => String(item).toLowerCase())
      : [];
    return actions.includes(targetAction);
  });
}

async function userHasPermission(userId, module, subModule, action) {
  if (!userId) return false;
  const pageAction = ACTION_TO_PAGE_ACTION[normalizeAction(action)];
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


async function userHasPermissionByPage(userId, pageKey, action) {
  if (!userId || !pageKey) return false;
  const rights = await userPermissionCache.get(userId);
  if (!Array.isArray(rights) || rights.length === 0) return false;

  const targetPage = String(pageKey).toLowerCase();
  const targetAction = String(action).toLowerCase();

  return rights.some((right) => {
    const page = String(right && right.page || "").toLowerCase();
    if (page !== targetPage) return false;
    const actions = Array.isArray(right && right.actions)
      ? right.actions.map((item) => String(item).toLowerCase())
      : [];
    return actions.includes(targetAction);
  });
}
const checkPermission = (module, subModule, action = "CanView") => {
  return async (req, res, next) => {
    try {
      const roleId = req.user?.roleId;
      const role = normalizeRole(req.user?.role);
      const userId = req.user?.userId ?? req.user?.id;
      const normalizedAction = normalizeAction(action);

      if (!roleId) {
        return res
          .status(401)
          .json({ error: "Invalid token - missing roleId" });
      }

      // Super users bypass permission checks
      if (SUPERUSER_ROLES.has(role)) return next();

      const permission = await permissionCache.get(roleId, module, subModule);

      if (permission && Number(permission[normalizedAction]) === 1) {
        return next();
      }

      if (await userHasPermission(userId, module, subModule, normalizedAction)) {
        return next();
      }

      return res.status(403).json({ error: "Access denied" });
    } catch (err) {
      console.error("Permission check failed:", err);
      res.status(500).json({ error: "Permission check error" });
    }
  };
};

/**
 * Convenience wrapper for the 7 guardEdit()-gated routes: "can this request's
 * user edit an already-Approved record on pageKey?" SUPERUSER_ROLES always
 * can (consistent with them bypassing requirePageRight entirely); everyone
 * else needs the "post-approval" action granted via Menu Rights / Post
 * Approval Rights (role baseline merged with their own overrides).
 */
async function resolveAllowPostApproval(req, pageKey) {
  const role = (req.user?.role || "").toLowerCase();
  if (SUPERUSER_ROLES.has(role)) return true;
  const userId = req.user?.userId ?? req.user?.id;
  return userHasEffectivePageRight(userId, req.user?.roleId, pageKey, "post-approval");
}

module.exports = {
  checkPermission,
  permissionCache,
  userPermissionCache,
  getEffectivePagePermissions,
  userHasPermissionByPage,
  userHasEffectivePageRight,
  resolveAllowPostApproval,
  SUPERUSER_ROLES,
};