function actorId(req) {
  const id = req.user?.userId ?? req.user?.id;
  const numeric = Number(id);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isSaAdmin(req) {
  const role = normalizeRole(req.user?.role);
  return ["super_admin", "sa", "dba", "admin"].includes(role);
}

function scopedLeadPredicate(alias = "l") {
  return `(
    ${alias}.AssignedTeamLeadId = @ActorUserId
    OR ${alias}.AssignedSalespersonId = @ActorUserId
    OR ${alias}.CreatedBy = @ActorUserId
  )`;
}

function addActorInput(request, req) {
  const id = actorId(req);
  if (id) request.input("ActorUserId", id);
  return id;
}

function applyLeadScope(request, req, alias = "l") {
  if (isSaAdmin(req)) return "1=1";
  const id = addActorInput(request, req);
  if (!id) return "1=0";
  return scopedLeadPredicate(alias);
}

module.exports = {
  actorId,
  isSaAdmin,
  normalizeRole,
  applyLeadScope,
  addActorInput,
  scopedLeadPredicate,
};
