// Per-user project scoping (dbo.UserProjectAccess, migration 524).
//
//   getProjectScope(user) -> null       unrestricted (admin role, or no rows)
//                         -> number[]   the only project ids the user may see
//
// Opt-in by design: a user with no rows keeps seeing everything, so nobody is
// locked out on deploy. Document rows with a NULL project are hidden from a
// restricted user, since they can't be shown to sit inside the allowed set.

const { getPool, sql } = require("../db");

const UNRESTRICTED_ROLES = new Set(["super_admin", "sa", "dba", "admin"]);
const TTL_MS = 30_000;
const cache = new Map(); // userId -> { ids, at }

function invalidateProjectScope(userId) {
  if (userId == null) cache.clear();
  else cache.delete(String(userId));
}

async function getProjectScope(user) {
  if (!user) return null;
  const role = String(user.role || "").toLowerCase();
  if (UNRESTRICTED_ROLES.has(role)) return null;
  const userId = Number(user.userId ?? user.id);
  if (!Number.isFinite(userId)) return null;

  const key = String(userId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  let rows;
  try {
    rows = (
      await getPool()
        .request()
        .input("uid", sql.Int, userId)
        .query("SELECT ProjectId FROM dbo.UserProjectAccess WHERE UserId = @uid")
    ).recordset;
  } catch (err) {
    // Table not created yet (code deployed before `migrate.js up`): behave as
    // unrestricted rather than 500-ing every API call for every non-admin.
    if (err.number === 208) return null;
    throw err;
  }
  const ids = rows.length ? rows.map((x) => Number(x.ProjectId)) : null;
  cache.set(key, { ids, at: Date.now() });
  return ids;
}

// " AND col IN (1,2)" — ids are coerced to integers, so inlining is injection-safe.
// Empty string when unrestricted. NULL-project rows are excluded when restricted.
function projectPredicate(scope, column, prefix = "AND") {
  if (!scope) return "";
  const ids = scope.map(Number).filter(Number.isFinite);
  return ` ${prefix} ${column} IN (${ids.length ? ids.join(",") : "NULL"})`;
}

function projectAllowed(scope, projectId) {
  if (!scope) return true;
  const id = Number(projectId);
  return Number.isFinite(id) && scope.map(Number).includes(id);
}

// Express middleware: resolves the scope once per request onto req.projectScope
// (null = unrestricted). Mount it BEFORE cache() so cached lists are keyed per scope.
async function attachProjectScope(req, res, next) {
  try {
    req.projectScope = await getProjectScope(req.user);
    next();
  } catch (err) {
    console.error("[projectScope] failed to resolve scope:", err.message);
    res.status(500).json({ error: "Could not resolve project access" });
  }
}

// Guard for writes / by-id reads: sends 403 and returns false when the
// project is outside the user's scope.
function assertProjectAllowed(req, res, projectId) {
  if (projectId == null || projectId === "" || projectAllowed(req.projectScope, projectId)) return true;
  res.status(403).json({ error: "You don't have access to this project." });
  return false;
}

// router.param handler: runs `sqlText` (must SELECT a ProjectId given @id) and
// 403s when that project is outside the user's scope. Unknown ids fall through
// so the route's own 404 still applies.
function projectParamGuard(sqlText) {
  return async (req, res, next, value) => {
    if (!req.projectScope) return next();
    const id = parseInt(value, 10);
    if (!Number.isFinite(id)) return next();
    try {
      const r = await getPool().request().input("id", sql.Int, id).query(sqlText);
      if (r.recordset.length && !projectAllowed(req.projectScope, r.recordset[0].ProjectId)) {
        return res.status(403).json({ error: "You don't have access to this project." });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

// Civil Work DPR labour / progress / attendance rows hang off a
// ContractorAllocation, which carries the project.
async function assertAllocationAllowed(req, res, allocationId) {
  if (!req.projectScope) return true;
  const id = parseInt(allocationId, 10);
  if (!Number.isFinite(id)) return true;
  const r = await getPool().request().input("id", sql.Int, id)
    .query("SELECT ProjectId FROM dbo.ContractorAllocation WHERE AllocationId = @id");
  if (r.recordset.length && !projectAllowed(req.projectScope, r.recordset[0].ProjectId)) {
    res.status(403).json({ error: "You don't have access to this project." });
    return false;
  }
  return true;
}

const RUNG_PROJECT_SQL = `SELECT dm.ProjectId FROM dbo.DependencyMasterActivity dma
  JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId WHERE dma.Id = @id`;
const rungParamGuard = projectParamGuard(RUNG_PROJECT_SQL);
async function assertRungAllowed(req, res, rungId) {
  if (!req.projectScope) return true;
  const id = parseInt(rungId, 10);
  if (!Number.isFinite(id)) return true;
  const r = await getPool().request().input("id", sql.Int, id).query(RUNG_PROJECT_SQL);
  if (r.recordset.length && !projectAllowed(req.projectScope, r.recordset[0].ProjectId)) {
    res.status(403).json({ error: "You don't have access to this project." });
    return false;
  }
  return true;
}

module.exports = {
  rungParamGuard,
  assertRungAllowed,
  projectParamGuard,
  assertAllocationAllowed,
  getProjectScope,
  invalidateProjectScope,
  projectPredicate,
  projectAllowed,
  attachProjectScope,
  assertProjectAllowed,
};
