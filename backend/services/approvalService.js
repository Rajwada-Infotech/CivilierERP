const { getPool, sql } = require("../db");

const TABLE_REGISTRY = {
  "purchase-orders": {
    table: "PurchaseOrders",
    pk: "PurchaseOrderID",
    statusCol: "Status",
    updatedByCol: "UpdatedBy",
    updatedAtCol: "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "work-orders": {
    table: "WorkOrderHeader",
    pk: "Id",
    statusCol: "Status",
    updatedByCol: "UpdatedBy",
    updatedAtCol: "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  payments: {
    table: "NewPayment",
    pk: "PPaymentID",
    statusCol: "Status",
    updatedByCol: "UpdatedBy",
    updatedAtCol: "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "goods-receipt": {
    table: "GoodsReceiptNotes",
    pk: "GRNID",
    statusCol: "Status",
    updatedByCol: "UpdatedBy",
    updatedAtCol: "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
  "expense-booking": {
    table: "ExpenseBooking",
    pk: "Eid",
    statusCol: "EStatus",
    updatedByCol: "UpdatedBy",
    updatedAtCol: "UpdatedAt",
    approvedByCol: "ApprovedBy",
    approvedAtCol: "ApprovedAt",
    rejectedByCol: "RejectedBy",
    rejectedAtCol: "RejectedAt",
    rejectNoteCol: "RejectionNote",
  },
};

// ─── State machine ────────────────────────────────────────────────────────────
const TRANSITIONS = {
  Draft: ["Issued", "Pending"],
  Issued: ["Pending"],
  Pending: ["Approved", "Rejected"],
  Approved: [],
  Rejected: ["Issued", "Draft"],
  "Partially Received": ["Fully Received", "Pending"],
  "Fully Received": ["Approved"],
};

const TERMINAL_STATES = ["Approved", "Fully Received"];
const APPROVER_ROLES = ["admin", "super_admin", "dba"];

// ─── Core transition ──────────────────────────────────────────────────────────
async function transition(
  moduleKey,
  recordId,
  newStatus,
  actor,
  actorRole = null,
  note = null,
) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) throw new Error(`Unknown module: "${moduleKey}"`);

  const {
    table,
    pk,
    statusCol,
    updatedByCol,
    updatedAtCol,
    approvedByCol,
    approvedAtCol,
    rejectedByCol,
    rejectedAtCol,
    rejectNoteCol,
  } = registry;

  const id = parseInt(recordId, 10);
  if (isNaN(id)) throw new Error("Invalid record ID");

  if (["Approved", "Rejected"].includes(newStatus)) {
    if (actorRole && !APPROVER_ROLES.includes(actorRole)) {
      throw new Error(
        `Role "${actorRole}" is not authorized to approve or reject`,
      );
    }
  }

  const pool = getPool();

  // 1. Fetch current status
  const current = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${statusCol} AS Status FROM dbo.${table} WHERE ${pk} = @id`);

  if (!current.recordset.length)
    throw new Error(`Record ${id} not found in ${table}`);

  const currentStatus = current.recordset[0].Status;

  // 2. Validate transition
  const allowed = TRANSITIONS[currentStatus];
  if (!allowed)
    throw new Error(`Status "${currentStatus}" not in state machine`);
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Cannot transition "${currentStatus}" → "${newStatus}". Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  // 3. Build SET clause
  const req = pool.request().input("id", sql.Int, id);
  const set = [`${statusCol} = '${newStatus}'`];

  if (updatedAtCol) set.push(`${updatedAtCol} = GETDATE()`);
  if (updatedByCol && actor) {
    req.input("actor", sql.NVarChar(150), actor);
    set.push(`${updatedByCol} = @actor`);
  }

  if (newStatus === "Approved") {
    req.input("approvedBy", sql.NVarChar(150), actor || null);
    set.push(`${approvedByCol} = @approvedBy`);
    set.push(`${approvedAtCol} = GETDATE()`);
    set.push(`${rejectedByCol} = NULL`);
    set.push(`${rejectedAtCol} = NULL`);
    set.push(`${rejectNoteCol} = NULL`);
  }

  if (newStatus === "Rejected") {
    req.input("rejectedBy", sql.NVarChar(150), actor || null);
    set.push(`${rejectedByCol} = @rejectedBy`);
    set.push(`${rejectedAtCol} = GETDATE()`);
    if (note) {
      req.input("rejectionNote", sql.NVarChar(500), note);
      set.push(`${rejectNoteCol} = @rejectionNote`);
    }
  }

  if (["Draft", "Issued"].includes(newStatus)) {
    set.push(`${rejectedByCol} = NULL`);
    set.push(`${rejectedAtCol} = NULL`);
    set.push(`${rejectNoteCol} = NULL`);
  }

  // 4. Execute
  await req.query(
    `UPDATE dbo.${table} SET ${set.join(", ")} WHERE ${pk} = @id`,
  );

  return {
    success: true,
    module: moduleKey,
    recordId: id,
    from: currentStatus,
    to: newStatus,
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
      `This record is finalized (${status}) and cannot be edited.`,
    );
  }
}

// ─── Get full approval state ──────────────────────────────────────────────────
async function getStatus(moduleKey, recordId) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) throw new Error(`Unknown module: "${moduleKey}"`);
  const {
    table,
    pk,
    statusCol,
    approvedByCol,
    approvedAtCol,
    rejectedByCol,
    rejectedAtCol,
    rejectNoteCol,
  } = registry;
  const pool = getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, parseInt(recordId, 10)).query(`
    SELECT
      ${statusCol}     AS Status,
      ${approvedByCol} AS ApprovedBy,
      ${approvedAtCol} AS ApprovedAt,
      ${rejectedByCol} AS RejectedBy,
      ${rejectedAtCol} AS RejectedAt,
      ${rejectNoteCol} AS RejectionNote
    FROM dbo.${table} WHERE ${pk} = @id
  `);
  if (!result.recordset.length) throw new Error("Record not found");
  return result.recordset[0];
}

module.exports = {
  transition,
  guardEdit,
  getStatus,
  TABLE_REGISTRY,
  TERMINAL_STATES,
  APPROVER_ROLES,
};
