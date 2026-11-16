const { sql } = require("../db");

const { hasFullAccess, isSuperAdmin } = require("../middleware/role");
const { isApproverFor } = require("./approvalService");

// The "Marketing Head" switch in Approval Setup (decided 2026-11-10): who, besides the full-access roles, sees and
// manages every Sales Automation record (leads, tasks, commissions, reports, teams) and runs the CRM admin actions
// (change a booking's unit, escalate overdue milestones, run the SLA engine, see all service tickets). Set on the
// screen; migration 649 names the marketing_head role on it so the same people keep it.
const MARKETING_HEAD_MODULE = "marketing-head";
function actorId(req) {
  const id = req.user?.userId ?? req.user?.id;
  const numeric = Number(id);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// Worked out once per request (server.js, after sign-in), so every caller below stays a plain check.
async function attachMarketingHead(req, _res, next) {
  try {
    req.marketingHead = !!req.user && !hasFullAccess(req.user.role) && (await isApproverFor(MARKETING_HEAD_MODULE, actorId(req), req.user.role));
  } catch (e) {
    console.error("[saAccess] Marketing Head switch check failed:", e.message);
    req.marketingHead = false;
  }
  next();
}

function isSaAdmin(req) {
  return hasFullAccess(req.user?.role) || req.marketingHead === true;
}

// Deliberately narrower than isSaAdmin above — used for identity/contact
// fields (Mobile, AltMobile, Email) on a confirmed lead/application, where
// even admin/dba/marketing_head having free rein is the exact security gap
// being closed. Only the literal "super_admin" role, no aliases.
function isSuperAdminOnly(req) {
  return isSuperAdmin(req.user?.role);
}

function isSaTeamLead(req) {
  return normalizeRole(req.user?.role) === "sales_team_lead";
}

function isSalesPerson(req) {
  return normalizeRole(req.user?.role) === "sales_person";
}

function applyLeadScope(request, req, alias = "l") {
  if (isSaAdmin(req)) return "1=1";
  const id = actorId(req);
  if (!id) return "1=0";
  request.input("ActorUserId", sql.Int, id);
  if (isSaTeamLead(req)) {
    // Team lead sees all leads assigned to them OR any of their salespersons
    return `(${alias}.AssignedTeamLeadId = @ActorUserId OR ${alias}.AssignedSalespersonId IN (SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @ActorUserId AND IsActive = 1))`;
  }
  // Sales person sees only their own assigned leads
  return `${alias}.AssignedSalespersonId = @ActorUserId`;
}

// approvalService.transition() needs the actor's email (for ApprovalAuditLog),
// not their numeric id — mirrors the requireUserEmail() helper every other
// module wired into the shared Approval Inbox already defines locally.
function requireUserEmail(req, res) {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
}

module.exports = { MARKETING_HEAD_MODULE, attachMarketingHead, actorId, isSaAdmin, isSuperAdminOnly, isSaTeamLead, isSalesPerson, applyLeadScope, requireUserEmail };
