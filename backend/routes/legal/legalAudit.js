"use strict";

// Legal audit trail: who did what to which record, with the values before and after.
// Writing it never fails the action itself — a failed write is logged instead.

const { sql } = require("../../db");

const json = (v) => (v == null ? null : JSON.stringify(v));

async function writeAudit(conn, req, { action, entityType, entityId, landId = null, oldValue = null, newValue = null, remarks = null }) {
  try {
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
      .query(`INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, OldValue, NewValue, Remarks, IpAddress)
              VALUES (@UserId, @Action, @EntityType, @EntityId, @LandId, @OldValue, @NewValue, @Remarks, @IpAddress)`);
  } catch (e) {
    console.error("[legal-audit]", action, entityType, entityId, e.message);
  }
}

/**
 * SQL for the next running number of a table's code column: PREFIX-YYYY-00001.
 * Locks the range so two saves at once cannot take the same number (the unique key backs it up).
 */
const nextCodeSql = (table, column, prefixParam) => `(${prefixParam} + RIGHT('00000' + CAST(ISNULL((
    SELECT MAX(TRY_CAST(RIGHT(${column}, 5) AS INT)) FROM dbo.${table} WITH (UPDLOCK, HOLDLOCK)
    WHERE ${column} LIKE ${prefixParam} + '%'), 0) + 1 AS VARCHAR(10)), 5))`;

const codePrefix = (auto) => `${auto}-${new Date().getFullYear()}-`;

module.exports = { writeAudit, nextCodeSql, codePrefix };
