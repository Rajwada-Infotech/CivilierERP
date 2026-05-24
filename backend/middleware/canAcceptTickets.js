const allowRoles = require("./role");
const { getPool, sql } = require("../db");

function hasTicketAcceptFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

module.exports = async function canAcceptTickets(req, res, next) {
  const actor = req.user;
  if (!actor) return res.status(401).json({ error: "Unauthorised" });

  const role = allowRoles.normalizeRole(actor.role);
  const isPrivileged = ["admin", "super_admin", "dba"].includes(role);

  if (isPrivileged || hasTicketAcceptFlag(actor.can_accept_tickets)) {
    return next();
  }

  try {
    const userId = actor.userId ?? actor.id;
    if (!userId) {
      return res.status(403).json({ error: "Not permitted to accept tickets" });
    }

    const result = await getPool()
      .request()
      .input("id", sql.Int, userId)
      .query(`
        SELECT ISNULL(can_accept_tickets, 0) AS can_accept_tickets
        FROM dbo.users
        WHERE id = @id
      `);

    if (hasTicketAcceptFlag(result.recordset[0]?.can_accept_tickets)) {
      return next();
    }
  } catch (err) {
    console.error("[canAcceptTickets] Failed to check user flag:", err.message);
  }

  return res.status(403).json({ error: "Not permitted to accept tickets" });
};
