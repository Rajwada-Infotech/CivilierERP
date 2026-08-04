/**
 * auditLog.js
 * Shared helper — appends rows to dbo.CrmAuditLog.
 * Drop at: backend/utils/auditLog.js
 *
 * Previously wrote to dbo.FollowupAuditLog, which no longer exists (the
 * whole Followup module's schema was dropped — see migration
 * 262-drop-followup-module-tables.sql). Every call site (unitMaster.js) was
 * silently losing its audit trail ever since — the write failed on every
 * single call, but the try/catch below swallowed it without surfacing
 * anything. Repointed at dbo.CrmAuditLog (EntityType/EntityId/Field/
 * OldValue/NewValue/ChangedBy — no RecordNo/Action/StepName/Notes columns
 * there), so the public logAudit()/logDiff() signature below is unchanged
 * for every caller; only the destination table + column mapping changed.
 * Field is NOT NULL on CrmAuditLog, so a whole-record event with no single
 * field (e.g. "Created"/"Deleted") falls back to using the action/step name
 * as the Field value.
 */

const { getPool, sql } = require("../db");

/**
 * Log a single audit event.
 *
 * @param {object} opts
 * @param {string}  opts.module      Entity type, e.g. 'UnitMaster'
 * @param {number}  opts.recordId
 * @param {string}  [opts.recordNo]  Folded into Notes-equivalent context since CrmAuditLog has no RecordNo column
 * @param {string}  opts.action      'Created' | 'Updated' | 'StepUpdated' | 'Deleted'
 * @param {string}  [opts.fieldName]
 * @param {string}  [opts.oldValue]
 * @param {string}  [opts.newValue]
 * @param {string}  [opts.stepName]
 * @param {string}  [opts.notes]
 * @param {number}  opts.changedBy  Users.id — CrmAuditLog.ChangedBy is INT, not a name/email string
 */
async function logAudit(opts) {
  try {
    const field = opts.fieldName || opts.stepName || opts.action || "Record";
    const newValue = opts.newValue ?? opts.notes ?? opts.recordNo ?? opts.action ?? null;
    await getPool()
      .request()
      .input("EntityType", sql.NVarChar(50),     opts.module)
      .input("EntityId",   sql.Int,               opts.recordId)
      .input("Field",      sql.NVarChar(100),     field)
      .input("OldValue",   sql.NVarChar(sql.MAX), opts.oldValue ?? null)
      .input("NewValue",   sql.NVarChar(sql.MAX), newValue)
      .input("ChangedBy",  sql.Int,               opts.changedBy ?? null)
      .query(`
        INSERT INTO dbo.CrmAuditLog
          (EntityType, EntityId, Field, OldValue, NewValue, ChangedBy, ChangedAt)
        VALUES
          (@EntityType, @EntityId, @Field, @OldValue, @NewValue, @ChangedBy, SYSDATETIME())
      `);
  } catch (err) {
    // Never let audit failure crash the main request
    console.error("auditLog write error:", err?.message);
  }
}

/**
 * Diff two flat objects and return an array of { fieldName, oldValue, newValue }
 * for every key whose value changed. Pass skipFields to exclude internal columns.
 */
function diffObjects(oldObj, newObj, skipFields = []) {
  const skip = new Set(["UpdatedAt", "UpdatedBy", "CreatedAt", "CreatedBy", "IsDeleted", ...skipFields]);
  const keys = new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})]);
  const changes = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const o = String(oldObj?.[key] ?? "");
    const n = String(newObj?.[key] ?? "");
    if (o !== n) changes.push({ fieldName: key, oldValue: o || null, newValue: n || null });
  }
  return changes;
}

/**
 * Bulk-log field-level diffs (used by PUT/UPDATE handlers).
 */
async function logDiff(baseOpts, oldObj, newObj, skipFields = []) {
  const changes = diffObjects(oldObj, newObj, skipFields);
  if (changes.length === 0) return;
  // Fire all inserts in parallel — fire-and-forget
  await Promise.all(
    changes.map((c) =>
      logAudit({
        ...baseOpts,
        action: "Updated",
        fieldName: c.fieldName,
        oldValue: c.oldValue,
        newValue: c.newValue,
      }),
    ),
  );
}

module.exports = { logAudit, logDiff };