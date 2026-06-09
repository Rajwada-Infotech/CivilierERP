// backend/services/approvalService.js
// Multi-level approval workflow engine.
// Reads the active workflow for a module, enforces level progression,
// writes to ApprovalAuditLog, and updates the record status.

const { getPool, sql } = require("../db");

// Map module slug → { table, pkCol, statusCol }
const MODULE_MAP = {
  "expense-booking": {
    table: "dbo.ExpenseBooking",
    pk: "Eid",
    status: "EStatus",
  },
  "purchase-orders": {
    table: "dbo.PurchaseOrders",
    pk: "PurchaseOrderID",
    status: "Status",
  },
  "work-orders": { table: "dbo.WorkOrderHeader", pk: "Id", status: "Status" },
  boq: { table: "dbo.BOQ", pk: "BoqID", status: "Status" },
  "work-done": { table: "dbo.WorkDone", pk: "ID", status: "Status" },
  grn: { table: "dbo.GoodsReceiptNotes", pk: "GRNID", status: "Status" },
  "goods-receipt": {
    table: "dbo.GoodsReceiptNotes",
    pk: "GRNID",
    status: "Status",
  },
  payments: { table: "dbo.NewPayment", pk: "PPaymentID", status: "Status" },
  "material-requests": {
    table: "dbo.MaterialRequests",
    pk: "MRId",
    status: "Status",
  },
  "material-issues": {
    table: "dbo.MaterialIssues",
    pk: "IssueId",
    status: "Status",
  },
};

const MODULE_DOC_LINKS = {
  "expense-booking": "Expense Booking",
  "purchase-orders": "Purchase Order",
  "work-orders": "Work Order",
  boq: "BOQ",
  "work-done": "Work Done",
  grn: "GRN",
  "goods-receipt": "GRN",
  payments: "Payment",
};

const APPROVER_ROLES = ["admin", "super_admin", "dba"];

async function validateApprovalModuleMap(log = console) {
  const pool = getPool();
  const missing = [];
  const tableCheck = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TypeOfDoc', N'U') IS NULL THEN 0 ELSE 1 END AS existsFlag
  `);

  if (!tableCheck.recordset[0]?.existsFlag) {
    log.warn(
      { event: "APPROVAL_MODULE_VALIDATION_SKIPPED", table: "dbo.TypeOfDoc" },
      "Approval module startup validation skipped because TypeOfDoc is missing",
    );
    return missing;
  }

  for (const [module, linkLabel] of Object.entries(MODULE_DOC_LINKS)) {
    const result = await pool
      .request()
      .input("LinkLabel", sql.NVarChar(100), `%${linkLabel}%`).query(`
        SELECT TOP 1 TypeOfDocId
        FROM dbo.TypeOfDoc
        WHERE IsActive = 1
          AND links_to LIKE @LinkLabel
      `);

    if (!result.recordset.length) {
      missing.push({ module, expectedLink: linkLabel });
    }
  }

  if (missing.length > 0) {
    log.warn(
      { event: "APPROVAL_MODULE_DOC_TYPE_MISSING", missing },
      "Approval modules are registered without matching active TypeOfDoc links",
    );
  }

  return missing;
}

/**
 * Fetch the active workflow for a module.
 * Returns null if none configured.
 */
async function getWorkflow(module) {
  const pool = getPool();
  const result = await pool.request().input("Module", sql.NVarChar(100), module)
    .query(`
      SELECT TOP 1 Id, Levels
      FROM dbo.ApprovalWorkflows
      WHERE Module = @Module AND Status = 'Active'
      ORDER BY CreatedAt DESC
    `);
  return result.recordset[0] ?? null;
}

/**
 * Fetch the current status of a record.
 */
async function getRecordStatus(module, id) {
  const map = MODULE_MAP[module];
  if (!map) throw new Error(`Unknown module: ${module}`);

  const pool = getPool();
  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(
      `SELECT ${map.status} AS status FROM ${map.table} WHERE ${map.pk} = @Id`,
    );

  const row = result.recordset[0];
  if (!row) throw new Error(`Record ${id} not found in ${module}`);
  return row.status;
}

/**
 * Update record status.
 */
async function setRecordStatus(module, id, newStatus, pool) {
  const map = MODULE_MAP[module];
  const p = pool ?? getPool();
  await p
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.NVarChar(50), newStatus)
    .query(
      `UPDATE ${map.table} SET ${map.status} = @Status WHERE ${map.pk} = @Id`,
    );
}

/**
 * Write an audit log entry.
 */
async function writeAuditLog(
  tableName,
  recordId,
  level,
  role,
  approverEmail,
  actionStatus,
  note,
) {
  const pool = getPool();
  await pool
    .request()
    .input("TableName", sql.NVarChar(100), tableName)
    .input("RecordId", sql.Int, recordId)
    .input("Level", sql.Int, level)
    .input("Role", sql.NVarChar(100), role || null)
    .input("ApproverEmail", sql.NVarChar(200), approverEmail || null)
    .input("ActionStatus", sql.NVarChar(50), actionStatus)
    .input("Note", sql.NVarChar(500), note || null).query(`
      INSERT INTO dbo.ApprovalAuditLog
        (TableName, RecordId, Level, Role, ApproverEmail, ActionStatus, Note, ActionAt)
      VALUES
        (@TableName, @RecordId, @Level, @Role, @ApproverEmail, @ActionStatus, @Note, SYSDATETIME())
    `);
}

/**
 * Fetch how many levels have been approved so far for a record.
 */
async function getApprovedLevelCount(tableName, recordId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input("TableName", sql.NVarChar(100), tableName)
    .input("RecordId", sql.Int, recordId).query(`
      SELECT MAX(Level) AS maxApprovedLevel
      FROM dbo.ApprovalAuditLog
      WHERE TableName = @TableName AND RecordId = @RecordId AND ActionStatus = 'Approved'
    `);
  return result.recordset[0]?.maxApprovedLevel ?? 0;
}

/**
 * Guard: prevent editing records that are Pending or fully Approved.
 */
async function guardEdit(module, id) {
  const status = await getRecordStatus(module, parseInt(id, 10));
  if (status === "Pending") {
    throw new Error(
      "Cannot edit a record that is pending approval. Reject it first.",
    );
  }
  if (status === "Approved") {
    throw new Error("Cannot edit an approved record.");
  }
}

/**
 * Transition a record to a new status.
 * Handles multi-level workflows:
 *  - Draft → Pending   (submit)
 *  - Pending → Approved or Rejected  (per workflow level)
 *
 * @param {string} module
 * @param {number} id
 * @param {string} targetStatus  "Pending" | "Approved" | "Rejected"
 * @param {string} userEmail
 * @param {string} userRole
 * @param {string|null} note
 */
async function transition(
  module,
  id,
  targetStatus,
  userEmail,
  userRole,
  note = null,
) {
  const map = MODULE_MAP[module];
  if (!map) throw new Error(`Unknown module: ${module}`);

  const currentStatus = await getRecordStatus(module, id);
  const tableName = map.table.replace("dbo.", "");

  // ── Submit: Draft/Rejected → Pending ──────────────────────────────────────
  if (targetStatus === "Pending") {
    if (!["Draft", "Rejected"].includes(currentStatus)) {
      throw new Error(`Cannot submit from status "${currentStatus}"`);
    }
    await setRecordStatus(module, id, "Pending");
    await writeAuditLog(tableName, id, 0, userRole, userEmail, "Pending", note);
    return { newStatus: "Pending" };
  }

  // ── Approve / Reject — only for authorised roles ──────────────────────────
  if (!APPROVER_ROLES.includes((userRole || "").toLowerCase())) {
    throw new Error("You are not authorized to approve or reject records.");
  }

  if (currentStatus !== "Pending") {
    throw new Error(
      `Cannot ${targetStatus.toLowerCase()} from status "${currentStatus}"`,
    );
  }

  if (targetStatus === "Rejected") {
    await setRecordStatus(module, id, "Rejected");
    await writeAuditLog(
      tableName,
      id,
      0,
      userRole,
      userEmail,
      "Rejected",
      note,
    );
    return { newStatus: "Rejected" };
  }

  if (targetStatus === "Approved") {
    const workflow = await getWorkflow(module);
    const totalLevels = workflow?.Levels ?? 1;

    const approvedSoFar = await getApprovedLevelCount(tableName, id);
    const nextLevel = approvedSoFar + 1;

    // Write this level's approval
    await writeAuditLog(
      tableName,
      id,
      nextLevel,
      userRole,
      userEmail,
      "Approved",
      note,
    );

    if (nextLevel >= totalLevels) {
      // All levels done — fully approved
      await setRecordStatus(module, id, "Approved");
      return { newStatus: "Approved", level: nextLevel, totalLevels };
    } else {
      // More levels required — stays Pending
      return {
        newStatus: "Pending",
        level: nextLevel,
        totalLevels,
        remainingLevels: totalLevels - nextLevel,
      };
    }
  }

  throw new Error(`Unknown target status: ${targetStatus}`);
}

module.exports = {
  transition,
  guardEdit,
  getWorkflow,
  getRecordStatus,
  validateApprovalModuleMap,
};
