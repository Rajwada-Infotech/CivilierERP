/**
 * Generic CRM audit trail — compares old/new field values and writes a row
 * per changed field to dbo.CrmAuditLog. Mirrors the SaLeadAudit pattern used
 * in saLeads.js, generalized across every CRM entity (Application, Booking,
 * Agreement, Noc, SalesDeed, Handover, ...).
 */
const { sql } = require("../db");

async function logCrmAudit(pool, entityType, entityId, changedBy, fields) {
  for (const f of fields) {
    const safeOldValue = String(f.oldVal ?? "").slice(0, 4000);
    const safeNewValue = String(f.newVal ?? "").slice(0, 4000);
    if (safeOldValue === safeNewValue) continue;
    await pool.request()
      .input("EntityType", sql.NVarChar(30),   entityType)
      .input("EntityId",   sql.Int,            entityId)
      .input("Field",      sql.NVarChar(50),   f.field)
      .input("OldValue",   sql.NVarChar(4000), safeOldValue || null)
      .input("NewValue",   sql.NVarChar(4000), safeNewValue || null)
      .input("ChangedBy",  sql.Int,            changedBy)
      .query(`
        INSERT INTO dbo.CrmAuditLog (EntityType, EntityId, Field, OldValue, NewValue, ChangedBy)
        VALUES (@EntityType, @EntityId, @Field, @OldValue, @NewValue, @ChangedBy)
      `);
  }
}

module.exports = { logCrmAudit };
