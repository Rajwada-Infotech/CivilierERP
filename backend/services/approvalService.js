// ============================================================
// backend/services/approvalService.js
// ============================================================

const { getPool, sql } = require("../db");

// ─── Table registry ───────────────────────────────────────────────────────────
const TABLE_REGISTRY = {
  "purchase-orders": {
    table:         "PurchaseOrders",
    pk:            "PurchaseOrderID",
    statusCol:     "Status",
    updatedByCol:  "UpdatedBy",
    updatedAtCol:  "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "work-orders": {
    table:         "WorkOrderHeader",
    pk:            "Id",
    statusCol:     "Status",
    updatedByCol:  "UpdatedBy",
    updatedAtCol:  "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "payments": {
    table:         "NewPayment",
    pk:            "PPaymentID",
    statusCol:     "Status",
    updatedByCol:  "PUpdatedBy",
    updatedAtCol:  null,           // NewPayment has no UpdatedAt column
    approvedByCol: "PApprovedBy",
    approvedAtCol: null,           // no separate ApprovedAt — use Status timestamp
    rejectedByCol: null,
    rejectedAtCol: null,
    rejectNoteCol: null,
  },
  "goods-receipt": {
    table:         "GoodsReceiptNotes",
    pk:            "GRNID",
    statusCol:     "Status",
    updatedByCol:  "UpdatedBy",
    updatedAtCol:  "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "expense-booking": {
    table:         "ExpenseBooking",
    pk:            "Eid",
    statusCol:     "EStatus",
    updatedByCol:  null,
    updatedAtCol:  "EUpdatedAt",
    approvedByCol: "EApprovedBy",
    approvedAtCol: null,
    rejectedByCol: null,
    rejectedAtCol: null,
    rejectNoteCol: null,
  },
};

// ─── State machine ────────────────────────────────────────────────────────────
const TRANSITIONS = {
  Draft:                ["Issued", "Pending"],
  Issued:               ["Pending"],
  Pending:              ["Approved", "Rejected"],
  Approved:             [],
  Rejected:             ["Issued", "Draft"],
  "Partially Received": ["Fully Received", "Pending"],
  "Fully Received":     ["Approved"],
};

const TERMINAL_STATES  = ["Approved", "Fully Received"];
const APPROVER_ROLES   = ["admin", "super_admin", "dba"];

// ─── Core transition ──────────────────────────────────────────────────────────
async function transition(moduleKey, recordId, newStatus, actor, actorRole = null, note = null) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) {
    throw new Error(`Unknown module: "${moduleKey}". Add it to TABLE_REGISTRY in approvalService.js`);
  }

  const { table, pk, statusCol, updatedByCol, updatedAtCol,
          approvedByCol, approvedAtCol,
          rejectedByCol, rejectedAtCol, rejectNoteCol } = registry;

  const id = parseInt(recordId, 10);
  if (isNaN(id)) throw new Error("Invalid record ID");

  if (["Approved", "Rejected"].includes(newStatus)) {
    if (actorRole && !APPROVER_ROLES.includes(actorRole)) {
      throw new Error(`Role "${actorRole}" is not authorized to approve or reject records`);
    }
  }

  const pool = getPool(); // synchronous — no await

  // 1. Fetch current status
  const current = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${statusCol} AS Status FROM dbo.${table} WHERE ${pk} = @id`);

  if (!current.recordset.length) {
    throw new Error(`Record ${id} not found in ${table}`);
  }

  const currentStatus = current.recordset[0].Status;

  // 2. Validate transition
  const allowed = TRANSITIONS[currentStatus];
  if (!allowed) {
    throw new Error(
      `Status "${currentStatus}" is not in the state machine. ` +
      `Add it to TRANSITIONS in approvalService.js`
    );
  }
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Cannot transition from "${currentStatus}" to "${newStatus}". ` +
      `Allowed: ${allowed.length ? allowed.join(", ") : "none (terminal state)"}`
    );
  }

  // 3. Build SET clause dynamically per table's actual columns
  const req = pool.request().input("id", sql.Int, id);
  const setClauses = [`${statusCol} = '${newStatus}'`];

  if (updatedAtCol) {
    setClauses.push(`${updatedAtCol} = GETDATE()`);
  }

  if (updatedByCol && actor) {
    req.input("actor", sql.NVarChar(150), actor);
    setClauses.push(`${updatedByCol} = @actor`);
  }

  if (newStatus === "Approved") {
    if (approvedByCol) {
      req.input("approvedBy", sql.NVarChar(150), actor || null);
      setClauses.push(`${approvedByCol} = @approvedBy`);
    }
    if (approvedAtCol) {
      setClauses.push(`${approvedAtCol} = GETDATE()`);
    }
    // Clear rejection fields if they exist
    if (rejectedByCol) setClauses.push(`${rejectedByCol} = NULL`);
    if (rejectedAtCol) setClauses.push(`${rejectedAtCol} = NULL`);
    if (rejectNoteCol) setClauses.push(`${rejectNoteCol} = NULL`);
  }

  if (newStatus === "Rejected") {
    if (rejectedByCol) {
      req.input("rejectedBy", sql.NVarChar(150), actor || null);
      setClauses.push(`${rejectedByCol} = @rejectedBy`);
    }
    if (rejectedAtCol) {
      setClauses.push(`${rejectedAtCol} = GETDATE()`);
    }
    if (rejectNoteCol && note) {
      req.input("rejectionNote", sql.NVarChar(500), note);
      setClauses.push(`${rejectNoteCol} = @rejectionNote`);
    }
  }

  if (["Draft", "Issued"].includes(newStatus)) {
    if (rejectedByCol) setClauses.push(`${rejectedByCol} = NULL`);
    if (rejectedAtCol) setClauses.push(`${rejectedAtCol} = NULL`);
    if (rejectNoteCol) setClauses.push(`${rejectNoteCol} = NULL`);
  }

  // 4. Execute
  await req.query(`
    UPDATE dbo.${table}
    SET ${setClauses.join(", ")}
    WHERE ${pk} = @id
  `);

  return {
    success:   true,
    module:    moduleKey,
    recordId:  id,
    from:      currentStatus,
    to:        newStatus,
    actor,
    timestamp: new Date().toISOString(),
  };
}

// ─── Guard: block edits on terminal records ───────────────────────────────────
async function guardEdit(moduleKey, recordId) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) return;

  const { table, pk, statusCol } = registry;
  const pool = getPool();

  const result = await pool
    .request()
    .input("id", sql.Int, parseInt(recordId, 10))
    .query(`SELECT ${statusCol} AS Status FROM dbo.${table} WHERE ${pk} = @id`);

  const status = result.recordset[0]?.Status;
  if (TERMINAL_STATES.includes(status)) {
    throw new Error(
      `This record is finalized (${status}) and cannot be edited. Contact an administrator.`
    );
  }
}

// ─── Get full approval state ──────────────────────────────────────────────────
async function getStatus(moduleKey, recordId) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) throw new Error(`Unknown module: "${moduleKey}"`);

  const { table, pk, statusCol, approvedByCol, approvedAtCol,
          rejectedByCol, rejectedAtCol, rejectNoteCol } = registry;

  const selectCols = [
    `${statusCol} AS Status`,
    approvedByCol ? `${approvedByCol} AS ApprovedBy` : `NULL AS ApprovedBy`,
    approvedAtCol ? `${approvedAtCol} AS ApprovedAt` : `NULL AS ApprovedAt`,
    rejectedByCol ? `${rejectedByCol} AS RejectedBy` : `NULL AS RejectedBy`,
    rejectedAtCol ? `${rejectedAtCol} AS RejectedAt` : `NULL AS RejectedAt`,
    rejectNoteCol ? `${rejectNoteCol} AS RejectionNote` : `NULL AS RejectionNote`,
  ].join(", ");

  const pool = getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, parseInt(recordId, 10))
    .query(`SELECT ${selectCols} FROM dbo.${table} WHERE ${pk} = @id`);

  if (!result.recordset.length) throw new Error("Record not found");
  return result.recordset[0];
}

module.exports = { transition, guardEdit, getStatus, TABLE_REGISTRY, TERMINAL_STATES, APPROVER_ROLES };
