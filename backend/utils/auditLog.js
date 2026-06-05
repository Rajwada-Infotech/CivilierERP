/**
 * auditLog.js
 * Shared helper — appends rows to dbo.FollowupAuditLog.
 * Drop at: backend/utils/auditLog.js
 */

const { getPool, sql } = require("../db");

/**
 * Log a single audit event.
 *
 * @param {object} opts
 * @param {string}  opts.module      'Booking' | 'LegalMilestone' | 'AgreementWorkflow' | 'SalesDeed'
 * @param {number}  opts.recordId
 * @param {string}  [opts.recordNo]
 * @param {string}  opts.action      'Created' | 'Updated' | 'StepUpdated' | 'Deleted'
 * @param {string}  [opts.fieldName]
 * @param {string}  [opts.oldValue]
 * @param {string}  [opts.newValue]
 * @param {string}  [opts.stepName]
 * @param {string}  [opts.notes]
 * @param {string}  opts.changedBy
 */
async function logAudit(opts) {
  try {
    await getPool()
      .request()
      .input("Module",    sql.NVarChar(50),       opts.module)
      .input("RecordId",  sql.Int,                 opts.recordId)
      .input("RecordNo",  sql.NVarChar(50),        opts.recordNo   ?? null)
      .input("Action",    sql.NVarChar(30),        opts.action)
      .input("FieldName", sql.NVarChar(100),       opts.fieldName  ?? null)
      .input("OldValue",  sql.NVarChar(sql.MAX),   opts.oldValue   ?? null)
      .input("NewValue",  sql.NVarChar(sql.MAX),   opts.newValue   ?? null)
      .input("StepName",  sql.NVarChar(100),       opts.stepName   ?? null)
      .input("Notes",     sql.NVarChar(sql.MAX),   opts.notes      ?? null)
      .input("ChangedBy", sql.NVarChar(100),       opts.changedBy)
      .query(`
        INSERT INTO dbo.FollowupAuditLog
          (Module, RecordId, RecordNo, Action, FieldName, OldValue, NewValue, StepName, Notes, ChangedBy, ChangedAt)
        VALUES
          (@Module, @RecordId, @RecordNo, @Action, @FieldName, @OldValue, @NewValue, @StepName, @Notes, @ChangedBy, SYSDATETIME())
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