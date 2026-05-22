const allowRoles = require("./role");

function hasTicketAcceptFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

module.exports = function canAcceptTickets(req, res, next) {
  const actor = req.user;
  if (!actor) return res.status(401).json({ error: "Unauthorised" });

  const role = allowRoles.normalizeRole(actor.role);
  const isPrivileged = ["admin", "super_admin", "dba"].includes(role);

  if (isPrivileged || hasTicketAcceptFlag(actor.can_accept_tickets)) {
    return next();
  }

  return res.status(403).json({ error: "Not permitted to accept tickets" });
};
