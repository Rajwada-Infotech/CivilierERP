// ─────────────────────────────────────────────────────────────
// middleware/role.js
//
// Root-cause fix: the JWT encodes the role string exactly as it
// comes from the DB (e.g. "Branch Manager", "Super Admin").
// The old middleware did a strict includes() check against the
// allowed list, so any role string that didn't match char-for-char
// silently returned 403 — causing all dashboard 404/empty states.
//
// Fix: normalise both the token role AND the allowed list to
// lowercase before comparing, and map common human-readable names
// to their canonical slugs.
// ─────────────────────────────────────────────────────────────

const ROLE_ALIASES = {
  // super_admin
  "super admin": "super_admin",
  superadmin: "super_admin",
  "super administrator": "super_admin",
  sa: "super_admin",

  // admin
  admin: "admin",
  administrator: "admin",
  "system admin": "admin",
  "system administrator": "admin",

  // dba
  dba: "dba",
  "db admin": "dba",
  "db administrator": "dba",
  "database admin": "dba",
  "database administrator": "dba",
  db_admin: "dba",

  // branch-level roles — all map to branch_manager
  "branch manager": "branch_manager",
  "branch admin": "branch_manager",
  branch_manager: "branch_manager",

  // finance (general "finance" keyword → accounts_head, same bucket)
  finance: "accounts_head",
  finance_manager: "accounts_head",

  // material / store
  "store manager": "store_manager",
  "material manager": "store_manager",
  store_manager: "store_manager",

  // engineering
  engineer: "engineer",
  "site engineer": "engineer",
  "field engineer": "engineer",

  // customer
  customer: "customer",
  "customer demo": "customer",
  client: "customer",
  "end user": "customer",
  "portal user": "customer",

  // marketing head of department
  marketing_head: "marketing_head",
  "marketing head": "marketing_head",
  "marketing head of department": "marketing_head",
  "marketing department head": "marketing_head",
  "marketing hod": "marketing_head",
  mhd: "marketing_head",

  // sales roles
  sales_team_lead: "sales_team_lead",
  "sales team lead": "sales_team_lead",
  "sales team leader": "sales_team_lead",
  sales_person: "sales_person",
  "sales person": "sales_person",
  salesperson: "sales_person",

  // legal team
  legal_head: "legal_head",
  "legal head": "legal_head",
  "legal head of department": "legal_head",
  "legal hod": "legal_head",
  legal_person: "legal_person",
  "legal person": "legal_person",
  "legal person 1": "legal_person",
  "legal executive": "legal_person",

  // accounts head
  accounts_head: "accounts_head",
  "accounts head": "accounts_head",
  "account's head": "accounts_head",
  "accounts hod": "accounts_head",
  accountant: "accounts_head",
  "finance manager": "accounts_head",

  // general user
  user: "user",
  employee: "user",
  staff: "user",
  "standard user": "user",
};

function normalizeRole(raw) {
  if (!raw || typeof raw !== "string") return "user";
  const key = raw.trim().toLowerCase();
  return ROLE_ALIASES[key] ?? key; // unknown roles keep their lowercase slug
}

/**
 * Usage in routes:
 *   router.get("/", allowRoles("admin", "super_admin", "branch_manager"), ...)
 *
 * Roles are compared after normalisation so DB strings like
 * "Branch Manager" or "branch manager" all match "branch_manager".
 */
module.exports = (...allowedRoles) => {
  const normalised = allowedRoles.map((r) => r.toLowerCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorised" });
    }

    // The JWT already encodes the normalised role from users.js login,
    // but we normalise again here as a safety net in case old tokens
    // still carry the raw DB string.
    const userRole = normalizeRole(req.user.role);

    if (!normalised.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
};

module.exports.normalizeRole = normalizeRole;
