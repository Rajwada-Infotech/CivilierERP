// Per-user and per-role project scoping (dbo.UserProjectAccess, migration 524;
// dbo.RoleProjectAccess, migration 534).
//
//   getProjectScope(user) -> null       unrestricted (admin role, or no rows)
//                         -> number[]   the only project ids the user may see
//
// Resolution: the user's own list if they have one, else their role's list,
// else unrestricted (a personal list overrides the role's, like page rights).
//
// Opt-in by design: a user or role with no rows keeps seeing everything, so
// nobody is locked out on deploy. Document rows with a NULL project are hidden from a
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
  // No personal list: fall back to the role's. A missing role table (code
  // deployed before migration 534) just means "no role restriction".
  const roleId = Number(user.roleId);
  if (!rows.length && Number.isFinite(roleId)) {
    try {
      rows = (
        await getPool()
          .request()
          .input("rid", sql.Int, roleId)
          .query("SELECT ProjectId FROM dbo.RoleProjectAccess WHERE RoleId = @rid")
      ).recordset;
    } catch (err) {
      if (err.number !== 208) throw err;
    }
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

// Expense bookings keep their project as text in EProjectName: the numeric
// enterprise id for most rows, the literal project name for some. This
// resolves either form to the project id (NULL if it matches nothing).
const ebProjectIdSql = (alias = "eb") =>
  `COALESCE(TRY_CAST(${alias}.EProjectName AS INT),
     (SELECT TOP 1 pj.id FROM dbo.enterprise pj WHERE pj.business_type = 'P' AND pj.name = ${alias}.EProjectName))`;

function ebProjectPredicate(scope, alias = "eb", prefix = "AND") {
  return projectPredicate(scope, ebProjectIdSql(alias), prefix);
}

// Same, plus the fallback the Expense Register uses: a GRN-sourced booking
// with no project of its own takes its GRN's PO project.
const ebResolvedProjectSql = (alias = "eb") => `COALESCE(
  TRY_CAST(${alias}.EProjectName AS INT),
  (SELECT TOP 1 pj.id FROM dbo.enterprise pj WHERE pj.business_type = 'P' AND pj.name = ${alias}.EProjectName),
  (SELECT TOP 1 pg.ProjectId FROM dbo.GoodsReceiptNotes gg
     JOIN dbo.PurchaseOrders pg ON pg.PurchaseOrderID = gg.POID
    WHERE ${alias}.ESourceType = 'GRN' AND gg.GRNID = TRY_CAST(${alias}.ESourceId AS INT)))`;

// A payment's project: its invoice's, else its own PProject text (id or name).
const paymentProjectSql = (alias = "np") => `COALESCE(
  (SELECT TOP 1 ${ebResolvedProjectSql("pe")} FROM dbo.ExpenseBooking pe WHERE pe.EDocNo = ${alias}.PExpenseRef),
  TRY_CAST(${alias}.PProject AS INT),
  (SELECT TOP 1 pj2.id FROM dbo.enterprise pj2 WHERE pj2.business_type = 'P' AND pj2.name = ${alias}.PProject))`;

// For a create/update body that carries a project as text (an id, or a name):
// a restricted user must name a project they can see. A body with no project
// is refused too, since the saved row would be invisible to them afterwards.
async function assertProjectRawAllowed(req, res, rawProject) {
  if (!req.projectScope) return true;
  const raw = rawProject == null ? "" : String(rawProject).trim();
  let id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (id == null && raw) {
    const r = await getPool().request().input("n", sql.NVarChar(255), raw)
      .query("SELECT TOP 1 id FROM dbo.enterprise WHERE business_type = 'P' AND name = @n");
    id = r.recordset[0]?.id ?? null;
  }
  if (id == null || !projectAllowed(req.projectScope, id)) {
    res.status(403).json({ error: "Choose a project you have access to." });
    return false;
  }
  return true;
}

// A godown belongs to a project (Godowns.ProjectID). Company-level godowns with
// no project are not reachable by a restricted user.
async function assertGodownAllowed(req, res, godownId) {
  if (!req.projectScope || godownId == null || godownId === "") return true;
  const id = parseInt(godownId, 10);
  if (!Number.isFinite(id)) return true;
  const r = await getPool().request().input("g", sql.Int, id)
    .query("SELECT ProjectID FROM dbo.Godowns WHERE GodownID = @g");
  if (r.recordset.length && projectAllowed(req.projectScope, r.recordset[0].ProjectID)) return true;
  res.status(403).json({ error: "You don't have access to this godown's project." });
  return false;
}

// ── CRM ──────────────────────────────────────────────────────────────────────
// Every CRM record hangs off a booking or an application, which carry the
// project. crmProjectGuards(router, idSql) wires the standard :bookingId and
// :applicationId guards and, for :id, either one SQL text or a map of
// { "/path-prefix/": sql, default: sql } when :id means different records on
// different routes. Each SQL must SELECT ProjectId given @id.
const CRM_BOOKING_PROJECT_SQL = "SELECT ProjectId FROM dbo.CrmBooking WHERE Id = @id";
const CRM_APPLICATION_PROJECT_SQL = "SELECT ProjectId FROM dbo.CrmApplication WHERE Id = @id";

// The project of a row linked to a booking (and optionally an application).
function crmViaBookingSql(table, { withApplication = false, bookingCol = "BookingId" } = {}) {
  return withApplication
    ? `SELECT COALESCE(b.ProjectId, a.ProjectId) AS ProjectId FROM dbo.${table} x
       LEFT JOIN dbo.CrmBooking b ON b.Id = x.${bookingCol} LEFT JOIN dbo.CrmApplication a ON a.Id = x.ApplicationId WHERE x.Id = @id`
    : `SELECT b.ProjectId FROM dbo.${table} x JOIN dbo.CrmBooking b ON b.Id = x.${bookingCol} WHERE x.Id = @id`;
}

function crmProjectGuards(router, idSql = null) {
  router.param("bookingId", projectParamGuard(CRM_BOOKING_PROJECT_SQL));
  router.param("applicationId", projectParamGuard(CRM_APPLICATION_PROJECT_SQL));
  if (!idSql) return;
  if (typeof idSql === "string") { router.param("id", projectParamGuard(idSql)); return; }
  const guards = Object.fromEntries(Object.entries(idSql).map(([k, v]) => [k, projectParamGuard(v)]));
  router.param("id", (req, res, next, value) => {
    const key = Object.keys(guards).find((p) => p !== "default" && req.path.startsWith(p));
    return (guards[key] || guards.default || ((_q, _s, n) => n()))(req, res, next, value);
  });
}

// Setup / plot / villa routers address a project through many inputs — a
// project, block, floor, plot, unit or villa-type id in the path, query or
// body. One guard for all of them: each id given is resolved to its project
// and a restricted user is refused anything outside their projects.
const SCOPE_SQL = {
  project: null,
  block: "SELECT ProjectId FROM dbo.BlockMaster WHERE Id = @id",
  floor: "SELECT ProjectId FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id",
  plot: "SELECT ProjectId FROM dbo.PlotMaster WHERE Id = @id",
  unit: "SELECT ProjectId FROM dbo.UnitMaster WHERE Id = @id",
  villaType: "SELECT ProjectId FROM dbo.VillaTypeMaster WHERE Id = @id",
};
async function projectsOf(kind, ids) {
  const list = [...new Set(ids.map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (!list.length) return [];
  if (kind === "project") return list;
  const out = [];
  for (const id of list) {
    const r = await getPool().request().input("id", sql.Int, id).query(SCOPE_SQL[kind]);
    if (r.recordset.length) out.push(r.recordset[0].ProjectId);
  }
  return out;
}
async function refuseOutOfScope(req, res, kind, ids) {
  for (const pid of await projectsOf(kind, ids)) {
    if (!projectAllowed(req.projectScope, pid)) { res.status(403).json({ error: "You don't have access to this project." }); return true; }
  }
  return false;
}
/**
 * Wires the guard onto a router:
 *   params: route param name -> kind, e.g. { projectId: "project", blockId: "block" }
 *   idPaths: for a generic ":id", [path prefix, kind] pairs, first match wins
 *            (e.g. [["/blocks", "block"], ["/floors", "floor"]]); unmatched = no check
 * plus every project / block / floor / plot / unit / villa-type id in the
 * query or body.
 */
function setupScopeGuard(router, { params = {}, idPaths = [] } = {}) {
  const BODY = { ProjectId: "project", projectId: "project", BlockId: "block", blockId: "block",
    FloorId: "floor", PlotId: "plot", PlotIds: "plot", UnitId: "unit", VillaTypeId: "villaType" };
  const wrap = (pick) => async (req, res, next, value) => {
    if (!req.projectScope) return next(); // unrestricted user
    try {
      const kind = pick(req);
      if (kind && await refuseOutOfScope(req, res, kind, [value])) return;
      next();
    } catch (err) { res.status(500).json({ error: err.message }); }
  };
  for (const [name, kind] of Object.entries(params)) router.param(name, wrap(() => kind));
  if (idPaths.length) router.param("id", wrap((req) => idPaths.find(([prefix]) => req.path.startsWith(prefix))?.[1] || null));
  router.use(async (req, res, next) => {
    if (!req.projectScope) return next();
    try {
      for (const src of [req.query || {}, req.body || {}]) {
        for (const [field, kind] of Object.entries(BODY)) {
          const v = src[field];
          if (v == null || v === "") continue;
          if (await refuseOutOfScope(req, res, kind, Array.isArray(v) ? v : [v])) return;
        }
      }
      next();
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}
// A customer can span projects: a restricted user may open one only when at
// least one of the customer's applications is inside their projects.
async function crmCustomerGuard(req, res, next, value) {
  if (!req.projectScope) return next();
  const id = parseInt(value, 10);
  if (!Number.isFinite(id)) return next();
  try {
    const r = await getPool().request().input("id", sql.Int, id).query(
      `SELECT TOP 1 1 AS x FROM dbo.CrmApplication a WHERE a.CustomerId = @id ${projectPredicate(req.projectScope, "a.ProjectId")}`);
    if (!r.recordset.length) {
      const exists = await getPool().request().input("id", sql.Int, id).query("SELECT TOP 1 1 AS x FROM dbo.CrmApplication WHERE CustomerId = @id");
      if (exists.recordset.length) return res.status(403).json({ error: "You don't have access to this customer's projects." });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  setupScopeGuard,
  crmProjectGuards,
  crmViaBookingSql,
  crmCustomerGuard,
  assertGodownAllowed,
  ebResolvedProjectSql,
  paymentProjectSql,
  assertProjectRawAllowed,
  ebProjectIdSql,
  ebProjectPredicate,
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
