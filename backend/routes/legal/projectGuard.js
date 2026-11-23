"use strict";
// Project-level access for the Legal module: a user restricted to some projects (User / Role Project Access) sees and
// changes only lands and enquiries of those projects. Unrestricted users (no rows, admins) see everything — nothing
// changes until project access is set. A land or enquiry with no project is hidden from a restricted user.
const { getPool, sql } = require("../../db");
const { getProjectScope } = require("../../services/projectScope");

const allowed = (scope, projectId) => !scope || (projectId != null && scope.includes(Number(projectId)));

async function landProject(landId) {
  const r = (await getPool().request().input("L", sql.Int, landId).query("SELECT ProjectId FROM dbo.LegalLand WHERE LandId = @L")).recordset[0];
  return r ? { found: true, projectId: r.ProjectId } : { found: false };
}
async function enquiryProject(enquiryId) {
  const r = (await getPool().request().input("E", sql.Int, enquiryId).query("SELECT ProjectId FROM dbo.LegalLandEnquiry WHERE EnquiryId = @E")).recordset[0];
  return r ? { found: true, projectId: r.ProjectId } : { found: false };
}

/** true when this user may reach the land (unknown land ids pass — the route answers 404 itself). */
async function canLand(req, landId) {
  const scope = await getProjectScope(req.user);
  if (!scope || !landId) return true;
  const l = await landProject(landId);
  return !l.found || allowed(scope, l.projectId);
}
async function canEnquiry(req, enquiryId) {
  const scope = await getProjectScope(req.user);
  if (!scope || !enquiryId) return true;
  const e = await enquiryProject(enquiryId);
  return !e.found || allowed(scope, e.projectId);
}

/** router.param handler: refuses a land (or enquiry) of a project the user has no access to. */
const landParam = (kind = "land") => async (req, res, next, value) => {
  try {
    const id = Number.parseInt(value, 10);
    if (!Number.isInteger(id) || id <= 0) return next();
    const ok = kind === "enquiry" || (kind === "auto" && /^\/enquir(y|ies)\//.test(req.path)) ? await canEnquiry(req, id) : await canLand(req, id);
    return ok ? next() : res.status(403).json({ error: "This land belongs to a project you have no access to" });
  } catch (e) { return next(e); }
};

/** Keep only rows of the user's projects (rows carry ProjectId). */
async function filterRows(req, rows) {
  const scope = await getProjectScope(req.user);
  return scope ? rows.filter((r) => allowed(scope, r.ProjectId)) : rows;
}

/**
 * Limit a block of SQL (dashboard counters) to some projects: every read of a land table becomes a read of only the
 * lands of those projects (and of those lands' own records / enquiries). `project` is the picker ("all" | "none" | id);
 * `scope` the user's allowed project ids (null = unrestricted). Returns the SQL unchanged when nothing limits it.
 */
const LAND_CHILD = ["LegalLandRsRecord", "LegalLandLrRecord", "LegalLandTransaction", "LegalOwnershipRecord", "LegalOwnershipEvent", "LegalLandDocument",
  "LegalOpinion", "LegalPayment", "LegalLandLegalRecord", "LegalLandTax", "LegalCase", "LegalLandDeed", "LegalRegisteredDeed", "LegalPostRegTask",
  "LegalPaymentSchedule", "LegalWorkflowStepState", "LegalPropertyRestriction", "LegalDiligenceArea", "LegalInheritance", "LegalReview", "LegalRiskAssessment"];
function scopeSqlText(text, project, scope) {
  const conds = [];
  if (project === "none") conds.push("ProjectId IS NULL");
  else if (project && project !== "all" && Number(project) > 0) conds.push(`ProjectId = ${Number(project)}`);
  if (scope) conds.push(`ProjectId IN (${scope.map(Number).filter(Number.isInteger).join(",") || "-1"})`);
  if (!conds.length) return text;
  const where = conds.join(" AND ");
  const KW = /^(WHERE|ON|JOIN|LEFT|RIGHT|INNER|ORDER|GROUP|WITH|AS|UNION|OUTER|CROSS|SELECT|AND|OR)$/i;
  const wrap = (table, sub) => (m, alias) => {
    const a = alias && !KW.test(alias) ? alias : null;
    return `(${sub}) ${a ?? table}${alias && !a ? ` ${alias}` : ""}`;
  };
  let out = text;
  for (const t of LAND_CHILD) {
    out = out.replace(new RegExp(`dbo\\.${t}(?![A-Za-z])(?:\\s+(\\w+))?`, "g"), wrap(t, `SELECT * FROM dbo.${t} WHERE LandId IN (SELECT LandId FROM dbo.LegalLand WHERE ${where})`));
  }
  out = out.replace(/dbo\.LegalEnquiryOfficeSearch(?![A-Za-z])(?:\s+(\w+))?/g, wrap("LegalEnquiryOfficeSearch", `SELECT * FROM dbo.LegalEnquiryOfficeSearch WHERE EnquiryId IN (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE ${where})`));
  out = out.replace(/dbo\.LegalLandEnquiry(?![A-Za-z])(?:\s+(\w+))?/g, wrap("LegalLandEnquiry", `SELECT * FROM dbo.LegalLandEnquiry WHERE ${where}`));
  out = out.replace(/dbo\.LegalLand(?![A-Za-z])(?:\s+(\w+))?/g, wrap("LegalLand", `SELECT * FROM dbo.LegalLand WHERE ${where}`));
  return out;
}

module.exports = { canLand, canEnquiry, landParam, filterRows, getProjectScope, allowed, scopeSqlText };
