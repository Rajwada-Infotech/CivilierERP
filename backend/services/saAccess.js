function actorId(req) {
  const id = req.user?.userId ?? req.user?.id;
  const numeric = Number(id);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isSaAdmin(req) {
  const role = normalizeRole(req.user?.role);
  // marketing_head has admin-level access within Sales Automation
  return ["super_admin", "sa", "dba", "admin", "marketing_head"].includes(role);
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
  request.input("ActorUserId", id);
  if (isSaTeamLead(req)) {
    // Team lead sees all leads assigned to them OR any of their salespersons
    return `(${alias}.AssignedTeamLeadId = @ActorUserId OR ${alias}.AssignedSalespersonId IN (SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @ActorUserId AND IsActive = 1))`;
  }
  // Sales person sees only their own assigned leads
  return `${alias}.AssignedSalespersonId = @ActorUserId`;
}

module.exports = { actorId, isSaAdmin, isSaTeamLead, isSalesPerson, applyLeadScope };
