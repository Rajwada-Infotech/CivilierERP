const { sql } = require("../db");

/**
 * Records one CRUD event against dbo.AuditTrail — who did what, to which
 * record, and when. `details` is stored as JSON so callers can pass
 * whatever shape fits (a field-by-field diff for updates, a snapshot for
 * deletes, etc.).
 */
async function logAudit(pool, { entityType, entityId, entityName, action, userId, userName, details }) {
  await pool
    .request()
    .input("EntityType", sql.NVarChar(50), entityType)
    .input("EntityId", sql.Int, entityId)
    .input("EntityName", sql.NVarChar(200), entityName || null)
    .input("Action", sql.NVarChar(10), action)
    .input("UserId", sql.Int, userId)
    .input("UserName", sql.NVarChar(200), userName || null)
    .input("Details", sql.NVarChar(sql.MAX), details ? JSON.stringify(details) : null)
    .query(`
      INSERT INTO dbo.AuditTrail (EntityType, EntityId, EntityName, Action, UserId, UserName, Details, CreatedAt)
      VALUES (@EntityType, @EntityId, @EntityName, @Action, @UserId, @UserName, @Details, SYSUTCDATETIME())
    `);
}

module.exports = { logAudit };
