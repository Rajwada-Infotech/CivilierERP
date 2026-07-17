// backend/services/approvalService.js
// Multi-level approval workflow engine.
// Reads the active workflow for a module, enforces level progression,
// writes to ApprovalAuditLog, and updates the record status.

const { getPool, sql } = require("../db");
const {
  postGRNApproval,
  postExpenseBookingApproval,
  postPaymentApproval,
  postJournalVoucherApproval,
} = require("./generalLedger");

// Module slug → general ledger poster, called once a record reaches full
// approval (last workflow level). Modules not listed here don't post to the
// ledger (e.g. material requests/issues have no financial impact).
const GL_POSTERS = {
  "goods-receipt": postGRNApproval,
  grn: postGRNApproval,
  "expense-booking": postExpenseBookingApproval,
  payments: postPaymentApproval,
  "journal-voucher": postJournalVoucherApproval,
};

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
  "sale-orders": {
    table: "dbo.SaleOrders",
    pk: "SaleOrderID",
    status: "Status",
  },
  "vehicle-in-out": {
    table: "dbo.VehicleInOut",
    pk: "VehicleInOutID",
    status: "Status",
  },
  "journal-voucher": {
    table: "dbo.JournalVoucher",
    pk: "JVID",
    status: "Status",
  },
  "inter-company-transfer": {
    table: "dbo.InterCompanyTransfer",
    pk: "ICTId",
    status: "Status",
  },
  "crm-applications": { table: "dbo.CrmApplication", pk: "Id", status: "Status" },
  "crm-bookings": { table: "dbo.CrmBooking", pk: "Id", status: "Status" },
  // The "approval" on a CrmAgreement is specifically the senior sign-off gate
  // (SeniorApprovalStatus) — the document's own lifecycle (Draft/Executed/
  // Registered/Cancelled) is a separate column and not part of this workflow.
  "crm-agreements": { table: "dbo.CrmAgreement", pk: "Id", status: "SeniorApprovalStatus" },
  // A second, independent gate on the same table: once both sides' proposed
  // dates match, DateApprovalStatus goes to 'Pending' (set directly by
  // crmWorkflowGuards.js's maybeResolveAgreementDate, not via this engine's
  // own "submit" step — the trigger is a system event, not a user action)
  // and needs its own sign-off before AgreementDate is written.
  // CAVEAT: getApprovedLevelCount() below scopes purely by (TableName,
  // RecordId) — there's no Module column on ApprovalAuditLog — so this
  // gate's level count is NOT isolated from crm-agreements' own Senior
  // Approval history on the same CrmAgreement row. Harmless today because
  // this workflow is single-level (nextLevel >= totalLevels(1) is always
  // true, so any authorized approval fully unlocks it regardless of the
  // exact count) — but if this ever becomes genuinely multi-level, give
  // ApprovalAuditLog a Module column and filter by it first.
  "crm-agreement-date": { table: "dbo.CrmAgreement", pk: "Id", status: "DateApprovalStatus" },
  "crm-brokerage": { table: "dbo.CrmBrokerageMaster", pk: "Id", status: "Status" },
  "crm-cancellations": { table: "dbo.CrmCancellation", pk: "Id", status: "Status" },
  "crm-noc": { table: "dbo.CrmNoc", pk: "Id", status: "Status" },
  contracts: { table: "dbo.Contract", pk: "ContractId", status: "Status" },
  // Same ApprovalAuditLog caveat as crm-agreement-date above: no Module
  // column, so this shares level-count history with any other gate on
  // CrmSalesDeed — harmless since this is single-level too.
  "crm-sales-deed-director": { table: "dbo.CrmSalesDeed", pk: "Id", status: "DirectorApprovalStatus" },
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
  "journal-voucher": "Journal Voucher",
  "inter-company-transfer": "Inter-Company Transfer",
};

const APPROVER_ROLES = ["admin", "super_admin", "dba"];

// Modules where approve/reject is restricted to a tighter role set than the
// system default (e.g. Journal Voucher forcefully corrects account-head
// mismatches, and Inter-Company Transfer fires an entire auto-generated
// document chain on approval — both are gated to super_admin only, unlike
// every other module where admin/dba can also approve).
//
// Every CRM module is gated to admin/super_admin/marketing_head specifically —
// marketing_head runs Sales/CRM approvals day-to-day, and dba is deliberately
// excluded here (unlike the system default) since a DBA has no business
// context to approve a customer-facing agreement, application, or refund.
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
const MODULE_APPROVER_ROLE_OVERRIDES = {
  "journal-voucher": ["super_admin"],
  "inter-company-transfer": ["super_admin"],
  "crm-applications": CRM_APPROVER_ROLES,
  "crm-bookings": CRM_APPROVER_ROLES,
  // legal_head added specifically here (not to CRM_APPROVER_ROLES generally) —
  // this is the "SENIOR LOGIN IN LEGAL TEAM" approval gate from the workflow
  // spec. legal_head can approve an Agreement's legal paperwork but has no
  // approve rights on bookings/brokerage/cancellations/NOC — those stay
  // admin/super_admin/marketing_head only.
  "crm-agreements": [...CRM_APPROVER_ROLES, "legal_head"],
  // Explicitly narrower than the other CRM modules — super_admin only, per
  // instruction, "for now"; reassignable later purely via LevelsData same
  // as every other module here, no code change needed when that happens.
  "crm-agreement-date": ["super_admin"],
  // No dedicated "director" role exists yet — hardcoded to super_admin
  // only "for now", same reasoning as crm-agreement-date above.
  "crm-sales-deed-director": ["super_admin"],
  "crm-brokerage": CRM_APPROVER_ROLES,
  "crm-cancellations": CRM_APPROVER_ROLES,
  "crm-noc": CRM_APPROVER_ROLES,
};

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

// Map route-slug (used by transition()/getWorkflow() callers) → the
// workflowId stored in ApprovalWorkflows.modules JSON array by the
// Approval Setup UI (src/pages/admin/ApprovalSetup.tsx MODULE_OPTIONS)
// and read back by the /api/approval-workflows/trail endpoint.
const WORKFLOW_ID_MAP = {
  "expense-booking": "Expenses",
  "purchase-orders": "PurchaseOrders",
  "work-orders": "WorkOrderHeader",
  boq: "BOQ",
  "work-done": "WorkDone",
  grn: "GRN",
  "goods-receipt": "GRN",
  payments: "NewPayment",
  "material-requests": "MaterialRequests",
  "material-issues": "MaterialIssues",
  "sale-orders": "SaleOrder",
  "vehicle-in-out": "VehicleInOut",
  "journal-voucher": "JournalVoucher",
  "inter-company-transfer": "InterCompanyTransfer",
  contracts: "Contract",
};

/**
 * Fetch the active workflow for a module.
 * Returns null if none configured.
 */
async function getWorkflow(module) {
  const pool = getPool();
  const workflowId = WORKFLOW_ID_MAP[module] || module;
  const result = await pool
    .request()
    .input("WorkflowId", sql.NVarChar(100), workflowId).query(`
      SELECT TOP 1 Id, LevelsData AS LevelsJson
      FROM dbo.ApprovalWorkflows
      WHERE active = 1
        AND modules LIKE '%"' + @WorkflowId + '"%'
      ORDER BY CreatedAt DESC
    `);
  const row = result.recordset[0];
  if (!row) return null;

  let levels = [];
  try {
    levels = row.LevelsJson ? JSON.parse(row.LevelsJson) : [];
  } catch {
    levels = [];
  }
  const levelDefs = Array.isArray(levels) ? levels : [];
  return {
    Id: row.Id,
    Levels: levelDefs.length || Number(levels) || 1,
    // Per-level definitions, e.g. [{ id, label, roles?: string[], userIds?: number[] }].
    // Both fields are optional per level — a level with neither is treated as
    // open to anyone who already passed the module's coarse role gate above.
    // This lets modules like CRM Agreements start with a single super_admin-only
    // level and grow into a real named hierarchy purely via data (Approval
    // Setup UI), with no code change needed to add levels or name approvers.
    LevelDefs: levelDefs,
  };
}

/**
 * Fetch the current status of a record.
 */
async function getRecordStatus(
  module,
  id,
  executor = null,
  { lock = false } = {},
) {
  const map = MODULE_MAP[module];
  if (!map) throw new Error(`Unknown module: ${module}`);

  const exec = executor || getPool();
  // UPDLOCK + HOLDLOCK: when called inside the transition() transaction this
  // takes an update lock on the record row and holds it until commit, so two
  // concurrent approve/submit calls on the same record serialize instead of
  // both reading "Pending" and both proceeding (double-approve / double-post).
  const lockHint = lock ? "WITH (UPDLOCK, HOLDLOCK)" : "";
  const result = await exec
    .request()
    .input("Id", sql.Int, id)
    .query(
      `SELECT ${map.status} AS status FROM ${map.table} ${lockHint} WHERE ${map.pk} = @Id`,
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
  executor = null,
) {
  const exec = executor || getPool();
  await exec
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
async function getApprovedLevelCount(tableName, recordId, executor = null) {
  const exec = executor || getPool();
  const result = await exec
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
 *
 * @param {string} module
 * @param {number} id
 * @param {{ allowPostApproval?: boolean }} [opts] - When true, the Approved
 *   block is skipped (caller has verified a "post-approval" right for this
 *   page — see userHasEffectivePageRight in middleware/permissions.js). The
 *   Pending block always applies regardless — a document mid-approval must
 *   still be rejected first, that's a workflow decision, not a raw edit
 *   permission.
 */
async function guardEdit(module, id, { allowPostApproval = false } = {}) {
  const status = await getRecordStatus(module, parseInt(id, 10));
  if (status === "Pending") {
    throw new Error(
      "Cannot edit a record that is pending approval. Reject it first.",
    );
  }
  if (status === "Approved" && !allowPostApproval) {
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
/**
 * Record the outcome of a GL posting attempt into dbo.GLPostingLog so that
 * approved-but-unposted documents are findable (see migration 154). Best
 * effort: never allowed to break the approval flow, but a skip/failure is
 * always surfaced on the console as well. Degrades gracefully if the log
 * table doesn't exist yet (older DB / test env).
 */
async function recordGLPosting(module, recordId, outcome, approverEmail) {
  let status;
  let reason;
  if (!outcome) {
    status = "skipped";
    reason = "poster returned no outcome";
  } else if (outcome.failed) {
    status = "failed";
    reason = outcome.reason;
  } else if (outcome.none) {
    status = "none";
    reason = outcome.reason;
  } else if (outcome.posted) {
    status = "posted";
    reason = outcome.reason || null;
  } else {
    status = "skipped";
    reason = outcome.reason || "unknown";
  }

  if (status === "skipped" || status === "failed") {
    console.error(
      `[generalLedger] ${status} for ${module} #${recordId}: ${reason}`,
    );
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Module", sql.NVarChar(50), module)
      .input("RecordId", sql.Int, recordId)
      .input("Outcome", sql.NVarChar(20), status)
      .input(
        "Reason",
        sql.NVarChar(500),
        reason ? String(reason).slice(0, 500) : null,
      )
      .input("ApproverEmail", sql.NVarChar(200), approverEmail || null).query(`
        INSERT INTO dbo.GLPostingLog (Module, RecordId, Outcome, Reason, ApproverEmail)
        VALUES (@Module, @RecordId, @Outcome, @Reason, @ApproverEmail)
      `);
  } catch (logErr) {
    console.error(
      `[generalLedger] could not record posting outcome for ${module} #${recordId}:`,
      logErr.message,
    );
  }
}

async function transition(
  module,
  id,
  targetStatus,
  userEmail,
  userRole,
  note = null,
  userId = null,
) {
  const map = MODULE_MAP[module];
  if (!map) throw new Error(`Unknown module: ${module}`);

  const tableName = map.table.replace("dbo.", "");

  // ── Authorisation gate (cheap check before opening a transaction) ─────────
  const isApproveOrReject =
    targetStatus === "Approved" || targetStatus === "Rejected";
  const allowedApproverRoles = MODULE_APPROVER_ROLE_OVERRIDES[module] || APPROVER_ROLES;
  if (
    isApproveOrReject &&
    !allowedApproverRoles.includes((userRole || "").toLowerCase())
  ) {
    const authErr = new Error("You are not authorized to approve or reject records.");
    authErr.status = 403;
    throw authErr;
  }

  // ── Status change + audit write happen atomically under a row lock ────────
  // Reading status, validating the transition, updating status, and writing
  // the audit entry must be one unit: otherwise two concurrent approvers both
  // see "Pending" and both proceed (double-approve, double GL post). The row
  // lock (UPDLOCK/HOLDLOCK in getRecordStatus) serialises them.
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  let result;
  let fullyApproved = false;
  await tx.begin();
  try {
    const currentStatus = await getRecordStatus(module, id, tx, { lock: true });

    if (targetStatus === "Pending") {
      if (!["Draft", "Rejected"].includes(currentStatus)) {
        throw new Error(`Cannot submit from status "${currentStatus}"`);
      }
      await setRecordStatus(module, id, "Pending", tx);
      await writeAuditLog(
        tableName,
        id,
        0,
        userRole,
        userEmail,
        "Pending",
        note,
        tx,
      );
      result = { newStatus: "Pending" };
    } else if (targetStatus === "Rejected") {
      if (currentStatus !== "Pending") {
        throw new Error(`Cannot reject from status "${currentStatus}"`);
      }
      await setRecordStatus(module, id, "Rejected", tx);
      await writeAuditLog(
        tableName,
        id,
        0,
        userRole,
        userEmail,
        "Rejected",
        note,
        tx,
      );
      result = { newStatus: "Rejected" };
    } else if (targetStatus === "Approved") {
      if (currentStatus !== "Pending") {
        throw new Error(`Cannot approve from status "${currentStatus}"`);
      }
      const workflow = await getWorkflow(module);
      const totalLevels = workflow?.Levels ?? 1;
      const approvedSoFar = await getApprovedLevelCount(tableName, id, tx);
      const nextLevel = approvedSoFar + 1;

      // -- Per-level gate --
      // The coarse role check above only confirms the user is *some* kind of
      // approver for this module. If this specific level names roles and/or
      // specific users, narrow to that -- this is what lets a workflow grow
      // into a real hierarchy (different approver per level) purely by
      // editing ApprovalWorkflows.LevelsData, with no code change.
      // A level with neither `roles` nor `userIds` set falls through to the
      // module-wide coarse check only (today's existing behaviour), so this
      // is fully backward compatible with workflows that don't use it yet.
      const levelDef = workflow?.LevelDefs?.[nextLevel - 1];
      if (levelDef) {
        const roleOk =
          !Array.isArray(levelDef.roles) || levelDef.roles.length === 0 ||
          levelDef.roles.map((r) => String(r).toLowerCase()).includes((userRole || "").toLowerCase());
        // userIds is only enforced when the caller actually passed a userId --
        // callers that don't pass one (older call sites) skip this check
        // rather than being denied, so this can't regress any existing module.
        const userOk =
          !Array.isArray(levelDef.userIds) || levelDef.userIds.length === 0 ||
          userId == null || levelDef.userIds.includes(userId);
        if (!roleOk || !userOk) {
          const levelErr = new Error(
            `You are not authorized to approve level ${nextLevel}${levelDef.label ? ` (${levelDef.label})` : ""} of this workflow.`,
          );
          levelErr.status = 403;
          throw levelErr;
        }
      }

      await writeAuditLog(
        tableName,
        id,
        nextLevel,
        userRole,
        userEmail,
        "Approved",
        note,
        tx,
      );

      if (nextLevel >= totalLevels) {
        await setRecordStatus(module, id, "Approved", tx);
        fullyApproved = true;
        result = { newStatus: "Approved", level: nextLevel, totalLevels };
      } else {
        result = {
          newStatus: "Pending",
          level: nextLevel,
          totalLevels,
          remainingLevels: totalLevels - nextLevel,
        };
      }
    } else {
      throw new Error(`Unknown target status: ${targetStatus}`);
    }

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* rollback best-effort — original error is what propagates */
    }
    throw err;
  }

  // ── Ledger posting — intentionally AFTER the status commit ────────────────
  // Posting must never block or roll back the approval (postVoucher has its
  // own transaction). But unlike before, every attempt is now recorded in
  // dbo.GLPostingLog, so a document that ends up Approved without a matching
  // ledger entry is discoverable instead of silently lost.
  if (fullyApproved) {
    const poster = GL_POSTERS[module];
    if (!poster) {
      await recordGLPosting(
        module,
        id,
        { none: true, reason: "no GL poster for module" },
        userEmail,
      );
    } else {
      try {
        const outcome = await poster(getPool(), id, userEmail);
        await recordGLPosting(module, id, outcome, userEmail);
      } catch (glErr) {
        await recordGLPosting(
          module,
          id,
          { failed: true, reason: glErr.message },
          userEmail,
        );
      }
    }
  }

  return result;
}

module.exports = {
  transition,
  guardEdit,
  getWorkflow,
  getApprovedLevelCount,
  getRecordStatus,
  validateApprovalModuleMap,
  recordGLPosting,
  writeAuditLog,
};
