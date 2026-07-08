/**
 * Shared notification helper — inserts into dbo.SaNotification and emits
 * a socket event to the target user's personal room. Used across Sales
 * Automation and CRM modules so every workflow (lead assignment, overdue
 * payment, handover ready, service ticket assigned, etc.) surfaces the
 * same way in the notification bell.
 */
const { sql } = require("../db");
const { getIo } = require("../socket");

async function emitNotification(pool, userId, type, title, body, refId, refType) {
  if (!userId) return;
  try {
    const result = await pool.request()
      .input("UserId",  sql.Int,           userId)
      .input("Type",    sql.NVarChar(50),  type)
      .input("Title",   sql.NVarChar(200), title)
      .input("Body",    sql.NVarChar(500), body || null)
      .input("RefId",   sql.Int,           refId || null)
      .input("RefType", sql.NVarChar(50),  refType || (refId ? "lead" : null))
      .query(`
        INSERT INTO dbo.SaNotification (UserId, Type, Title, Body, RefId, RefType)
        OUTPUT INSERTED.Id, INSERTED.UserId, INSERTED.Type, INSERTED.Title,
               INSERTED.Body, INSERTED.RefId, INSERTED.RefType, INSERTED.IsRead, INSERTED.CreatedAt
        VALUES (@UserId, @Type, @Title, @Body, @RefId, @RefType)
      `);
    const notif = result.recordset[0];
    try {
      getIo().to(`user:${userId}`).emit("sa:notification", {
        id: notif.Id,
        userId: notif.UserId,
        type: notif.Type,
        title: notif.Title,
        body: notif.Body,
        refId: notif.RefId,
        refType: notif.RefType,
        isRead: false,
        createdAt: notif.CreatedAt,
      });
    } catch { /* socket may not be initialised in tests */ }
  } catch (e) {
    console.error("[notify] emitNotification error:", e.message);
  }
}

module.exports = { emitNotification };
