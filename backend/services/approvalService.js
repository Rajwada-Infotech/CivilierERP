// ============================================================
// backend/services/approvalService.js
// Reusable workflow engine — plugs into any transaction module.
//
// State machines:
//
//   PurchaseOrders:
//     Draft/Issued → Pending → Approved
//                            ↘ Rejected → Issued
//
//   WorkOrders / Payments / ExpenseBooking:
//     Draft → Pending → Approved
//                     ↘ Rejected → Draft
//
//   GoodsReceiptNotes:
//     Partially Received → Fully Received → Approved
//                        ↘ Pending → Approved / Rejected → Partially Received
//
// Usage:
//   const { transition, guardEdit } = require("../services/approvalService");
// ============================================================

const { getPool, sql } = require("../db");

// ─── Table registry ───────────────────────────────────────────────────────────
const TABLE_REGISTRY = {
  "purchase-orders": { table: "PurchaseOrders",    pk: "PurchaseOrderID" },
  "work-orders":     { table: "WorkOrderHeader",   pk: "WorkOrderID"     },
  "payments":        { table: "NewPayment",        pk: "PPaymentID"      },
  "goods-receipt":   { table: "GoodsReceiptNotes", pk: "GRNId"           },
  "expense-booking": { table: "ExpenseBooking",    pk: "ExpenseID"       },
};

// ─── State machine ────────────────────────────────────────────────────────────
const TRANSITIONS = {
  // PurchaseOrders — "Issued" = created internally, needs approval (confirmed Option A)
  Draft:                ["Issued", "Pending"],
  Issued:               ["Pending"],
  Pending:              ["Approved", "Rejected"],
  Approved:             [],                          // Terminal
  Rejected:             ["Issued", "Draft"],         // Re-submit after rejection

  // GoodsReceiptNotes domain statuses
  "Partially Received": ["Fully Received", "Pending"],
  "Fully Received":     ["Approved"],
};

// ─── Terminal states — guardEdit blocks edits on these ───────────────────────
const TERMINAL_STATES = ["Approved", "Fully Received"];

// ─── Roles allowed to approve / reject ───────────────────────────────────────
const APPROVER_ROLES = ["admin", "super_admin", "dba"];

// ─── Core transition function ─────────────────────────────────────────────────
async function transition(moduleKey, recordId, newStatus, actor, actorRole = null, note = null) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) {
    throw new Error(`Unknown module: "${moduleKey}". Add it to TABLE_REGISTRY in approvalService.js`);
  }

  const { table, pk } = registry;
  const id = parseInt(recordId, 10);
  if (isNaN(id)) throw new Error("Invalid record ID");

  // Role check for approve/reject
  if (["Approved", "Rejected"].includes(newStatus)) {
    if (actorRole && !APPROVER_ROLES.includes(actorRole)) {
      throw new Error(`Role "${actorRole}" is not authorized to approve or reject records`);
    }
  }

  const pool = await getPool();

  // 1. Fetch current status
  const current = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT Status FROM dbo.${table} WHERE ${pk} = @id`);

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

  // 3. Build SET clause
  const req = pool.request().input("id", sql.Int, id);
  const setClauses = [`Status = '${newStatus}'`, `UpdatedAt = GETDATE()`];

  if (actor) {
    req.input("actor", sql.NVarChar(150), actor);
    setClauses.push(`UpdatedBy = @actor`);
  }

  if (newStatus === "Approved") {
    req.input("approvedBy", sql.NVarChar(150), actor || null);
    setClauses.push(`ApprovedBy = @approvedBy`, `ApprovedAt = GETDATE()`);
    setClauses.push(`RejectedBy = NULL`, `RejectedAt = NULL`, `RejectionNote = NULL`);
  }

  if (newStatus === "Rejected") {
    req.input("rejectedBy", sql.NVarChar(150), actor || null);
    setClauses.push(`RejectedBy = @rejectedBy`, `RejectedAt = GETDATE()`);
    if (note) {
      req.input("rejectionNote", sql.NVarChar(500), note);
      setClauses.push(`RejectionNote = @rejectionNote`);
    }
  }

  // Re-draft / re-issue after rejection — clear stale rejection fields
  if (["Draft", "Issued"].includes(newStatus)) {
    setClauses.push(`RejectedBy = NULL`, `RejectedAt = NULL`, `RejectionNote = NULL`);
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
// Add to every PUT/DELETE handler: await guardEdit("purchase-orders", req.params.id);
//
async function guardEdit(moduleKey, recordId) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) return;

  const { table, pk } = registry;
  const pool = await getPool();

  const result = await pool
    .request()
    .input("id", sql.Int, parseInt(recordId, 10))
    .query(`SELECT Status FROM dbo.${table} WHERE ${pk} = @id`);

  const status = result.recordset[0]?.Status;
  if (TERMINAL_STATES.includes(status)) {
    throw new Error(
      `This record is finalized (${status}) and cannot be edited. Contact an administrator.`
    );
  }
}

// ─── Helper: get full approval state of a record ──────────────────────────────
async function getStatus(moduleKey, recordId) {
  const registry = TABLE_REGISTRY[moduleKey];
  if (!registry) throw new Error(`Unknown module: "${moduleKey}"`);
  const { table, pk } = registry;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, parseInt(recordId, 10))
    .query(
      `SELECT Status, ApprovedBy, ApprovedAt, RejectedBy, RejectedAt, RejectionNote
       FROM dbo.${table} WHERE ${pk} = @id`
    );

  if (!result.recordset.length) throw new Error(`Record not found`);
  return result.recordset[0];
}

module.exports = { transition, guardEdit, getStatus, TABLE_REGISTRY, TERMINAL_STATES, APPROVER_ROLES };

