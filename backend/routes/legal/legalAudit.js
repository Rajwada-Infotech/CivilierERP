"use strict";

// Legal audit trail: who did what to which record, with the values before and after.
// Writing it never fails the action itself — a failed write is logged instead.

const { sql } = require("../../db");

const json = (v) => (v == null ? null : JSON.stringify(v));

// Migration 651 adds the user's role and a document reference; checked until present.
let auditExtra = false;
async function hasAuditExtra(conn) {
  if (!auditExtra) auditExtra = !!(await conn.request().query("SELECT COL_LENGTH('dbo.LegalRecordAudit', 'UserRole') AS c")).recordset[0].c;
  return auditExtra;
}

async function writeAudit(conn, req, { action, entityType, entityId, landId = null, oldValue = null, newValue = null, remarks = null, documentRef = null }) {
  try {
    const extra = await hasAuditExtra(conn);
    await conn.request()
      .input("UserId", sql.Int, req.user?.userId || null)
      .input("Action", sql.NVarChar(60), action)
      .input("EntityType", sql.NVarChar(60), entityType)
      .input("EntityId", sql.Int, entityId ?? null)
      .input("LandId", sql.Int, landId ?? null)
      .input("OldValue", sql.NVarChar(sql.MAX), json(oldValue))
      .input("NewValue", sql.NVarChar(sql.MAX), json(newValue))
      .input("Remarks", sql.NVarChar(1000), remarks)
      .input("IpAddress", sql.NVarChar(64), String(req.ip || "").slice(0, 64) || null)
      .input("Role", sql.NVarChar(60), String(req.user?.role || "").slice(0, 60) || null)
      .input("DocRef", sql.NVarChar(200), documentRef ? String(documentRef).slice(0, 200) : null)
      .query(extra
        ? `INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, OldValue, NewValue, Remarks, IpAddress, UserRole, DocumentRef)
           VALUES (@UserId, @Action, @EntityType, @EntityId, @LandId, @OldValue, @NewValue, @Remarks, @IpAddress, @Role, @DocRef)`
        : `INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, OldValue, NewValue, Remarks, IpAddress)
           VALUES (@UserId, @Action, @EntityType, @EntityId, @LandId, @OldValue, @NewValue, @Remarks, @IpAddress)`);
    // A change to a land that is already verified (in Deed Process) flags it for re-verification (migration 645).
    if (landId && !DEED_ACTIONS.has(action)) {
      await conn.request().input("LandId", sql.Int, landId).input("UserId", sql.Int, req.user?.userId || null).query(`
        IF COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') IS NOT NULL
          EXEC sp_executesql N'UPDATE dbo.LegalLand SET DeedChangedAt = SYSUTCDATETIME(), DeedChangedBy = @U WHERE LandId = @L AND WorkflowStatus = N''Deed Process''',
            N'@L INT, @U INT', @L = @LandId, @U = @UserId;`);
    }
  } catch (e) {
    console.error("[legal-audit]", action, entityType, entityId, e.message);
  }
}

// Deed Process's own actions do not count as a change to the land's data.
const DEED_ACTIONS = new Set(["Land verified — sent to Deed Process", "Deed timeline changed", "Deed completed", "Deed reopened",
  "Deed copy uploaded", "Deed copy removed", "Deed changes re-verified",
  "Deed L1 approved", "Deed L1 rejected", "Deed L1 on hold", "Deed L2 approved", "Deed L2 rejected", "Deed L2 on hold", "Registry search recorded", "Due diligence checked", "Risk assessed", "Legal review updated", "Court case cleared", "Government site data saved", "Post-registration task updated", "Post-registration tasks created", "Registry search edited", "Registry search deleted", "Applied for deed registration", "Deed registered"]);

/**
 * SQL for the next running number of a table's code column: PREFIX-YYYY-00001.
 * Locks the range so two saves at once cannot take the same number (the unique key backs it up).
 */
const nextCodeSql = (table, column, prefixParam) => `(${prefixParam} + RIGHT('00000' + CAST(ISNULL((
    SELECT MAX(TRY_CAST(RIGHT(${column}, 5) AS INT)) FROM dbo.${table} WITH (UPDLOCK, HOLDLOCK)
    WHERE ${column} LIKE ${prefixParam} + '%'), 0) + 1 AS VARCHAR(10)), 5))`;

const codePrefix = (auto) => `${auto}-${new Date().getFullYear()}-`;

module.exports = { writeAudit, nextCodeSql, codePrefix };
