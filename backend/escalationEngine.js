/**
 * escalationEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs on a schedule (default: every hour) and flags overdue records across
 * all 4 followup modules by setting step status to "Blocked" where:
 *   - The step's DueDate has passed (< today)
 *   - The step is still "Pending" or "In Progress"
 *   - The overall record is not Completed / Cancelled / On Hold
 *
 * Also writes a row to dbo.FollowupAuditLog for every escalation so the
 * per-record history drawer shows it.
 *
 * Usage in server.js:
 *   const { startEscalationEngine } = require("./escalationEngine");
 *   startEscalationEngine();          // call once after DB is ready
 */

"use strict";

const { getPool, sql } = require("./db");
const { logAudit } = require("./utils/auditLog");
const logger = require("./logger");

// ── Configuration ────────────────────────────────────────────────────────────

const INTERVAL_MS = 60 * 60 * 1000; // run every hour
const SYSTEM_USER = "EscalationEngine";

const REQUIRED_TABLES = [
  {
    table: "FollowupLegalMilestones",
    migration: "095-create-followup-legal-milestones.sql",
  },
  {
    table: "FollowupAgreementWorkflows",
    migration: "108-create-followup-agreement-workflows.sql",
  },
  {
    table: "FollowupSalesDeeds",
    migration: "066-followup-salesdeed-table.sql",
  },
  { table: "FollowupBookings", migration: "080-create-followup-bookings.sql" },
  { table: "FollowupAuditLog", migration: "107-create-followup-audit-log.sql" },
];

// ── Legal Milestone steps ────────────────────────────────────────────────────

const LM_STEPS = [
  "DocCollection",
  "LegalReview",
  "Drafting",
  "InternalApproval",
  "DocShared",
  "MutualAgreement",
  "DirectorMeeting",
  "FinalExecution",
];

// ── Agreement Workflow steps ─────────────────────────────────────────────────

const AW_STEPS = [
  "Drafting",
  "InternalReview",
  "CustomerSharing",
  "CustomerApproval",
  "Execution",
  "Registration",
  "Archival",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function assertRequiredSchema() {
  const request = getPool().request();
  REQUIRED_TABLES.forEach(({ table }, index) => {
    request.input(`Table${index}`, sql.NVarChar(128), table);
  });

  const result = await request.query(`
    SELECT t.name
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo'
      AND t.name IN (${REQUIRED_TABLES.map((_, index) => `@Table${index}`).join(", ")})
  `);

  const existing = new Set(result.recordset.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter(({ table }) => !existing.has(table));
  if (missing.length === 0) return;

  const details = missing
    .map(({ table, migration }) => `dbo.${table} (${migration})`)
    .join(", ");

  throw new Error(
    `Escalation schema is incomplete; missing ${details}. ` +
      "Point DB_SERVER/DB_NAME at a fully restored CivilierERP database, or restore the base schema and run `cd backend && npm run migrate`.",
  );
}

// ── Legal Milestones escalation ───────────────────────────────────────────────

async function escalateLegalMilestones() {
  const pool = getPool();
  const todayStr = today();
  let totalBlocked = 0;

  // Fetch all active records with their due dates and step statuses
  const rows = await pool.request().query(`
    SELECT
      Id, MilestoneNo, OverallStatus,
      ${LM_STEPS.map((s) => `${s}Due, ${s}Status`).join(", ")}
    FROM dbo.FollowupLegalMilestones
    WHERE IsDeleted = 0
      AND OverallStatus NOT IN ('Completed', 'Cancelled')
  `);

  for (const row of rows.recordset) {
    const setClauses = [];
    const blockedSteps = [];

    for (const s of LM_STEPS) {
      const due = row[`${s}Due`];
      const status = row[`${s}Status`];
      if (
        due &&
        due.toISOString().slice(0, 10) < todayStr &&
        status !== null &&
        !["Completed", "Blocked", "Waived"].includes(status)
      ) {
        setClauses.push(`${s}Status = 'Blocked'`);
        blockedSteps.push(s);
      }
    }

    if (setClauses.length === 0) continue;

    await pool.request().input("Id", sql.Int, row.Id).query(`
        UPDATE dbo.FollowupLegalMilestones
        SET ${setClauses.join(", ")}, UpdatedBy = '${SYSTEM_USER}', UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    logAudit({
      module: "LegalMilestone",
      recordId: row.Id,
      recordNo: row.MilestoneNo,
      action: "Escalated",
      changedBy: SYSTEM_USER,
      changes: blockedSteps.map((s) => ({
        field: `${s}Status`,
        oldValue: row[`${s}Status`],
        newValue: "Blocked",
      })),
    });

    totalBlocked += blockedSteps.length;
  }

  return totalBlocked;
}

// ── Agreement Workflow escalation ─────────────────────────────────────────────

async function escalateAgreementWorkflows() {
  const pool = getPool();
  const todayStr = today();
  let totalBlocked = 0;

  const rows = await pool.request().query(`
    SELECT
      Id, WorkflowNo, OverallStatus,
      ${AW_STEPS.map((s) => `${s}Due, ${s}Status`).join(", ")}
    FROM dbo.FollowupAgreementWorkflows
    WHERE IsDeleted = 0
      AND OverallStatus NOT IN ('Completed', 'Cancelled')
  `);

  for (const row of rows.recordset) {
    const setClauses = [];
    const blockedSteps = [];

    for (const s of AW_STEPS) {
      const due = row[`${s}Due`];
      const status = row[`${s}Status`];
      if (
        due &&
        due.toISOString().slice(0, 10) < todayStr &&
        status !== null &&
        !["Completed", "Blocked", "Waived"].includes(status)
      ) {
        setClauses.push(`${s}Status = 'Blocked'`);
        blockedSteps.push(s);
      }
    }

    if (setClauses.length === 0) continue;

    await pool.request().input("Id", sql.Int, row.Id).query(`
        UPDATE dbo.FollowupAgreementWorkflows
        SET ${setClauses.join(", ")}, UpdatedBy = '${SYSTEM_USER}', UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    logAudit({
      module: "AgreementWorkflow",
      recordId: row.Id,
      recordNo: row.WorkflowNo,
      action: "Escalated",
      changedBy: SYSTEM_USER,
      changes: blockedSteps.map((s) => ({
        field: `${s}Status`,
        oldValue: row[`${s}Status`],
        newValue: "Blocked",
      })),
    });

    totalBlocked += blockedSteps.length;
  }

  return totalBlocked;
}

// ── Sales Deed escalation ─────────────────────────────────────────────────────
// Sales Deed has no steps — flag the record itself as overdue when:
//   Status = 'Draft' and DeedDate has passed, OR
//   Status = 'Executed' and RegistrationDate has passed

async function escalateSalesDeeds() {
  const pool = getPool();
  const todayStr = today();

  // Draft deeds past their DeedDate
  const draftResult = await pool.request().input("Today", sql.Date, todayStr)
    .query(`
      UPDATE dbo.FollowupSalesDeeds
      SET Status = 'Overdue', UpdatedBy = '${SYSTEM_USER}', UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Id, INSERTED.DeedNo
      WHERE IsDeleted = 0
        AND Status = 'Draft'
        AND DeedDate IS NOT NULL
        AND DeedDate < @Today
    `);

  for (const r of draftResult.recordset) {
    logAudit({
      module: "SalesDeed",
      recordId: r.Id,
      recordNo: r.DeedNo,
      action: "Escalated",
      changedBy: SYSTEM_USER,
      changes: [{ field: "Status", oldValue: "Draft", newValue: "Overdue" }],
    });
  }

  // Executed deeds past their RegistrationDate
  const execResult = await pool.request().input("Today", sql.Date, todayStr)
    .query(`
      UPDATE dbo.FollowupSalesDeeds
      SET Status = 'Overdue', UpdatedBy = '${SYSTEM_USER}', UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Id, INSERTED.DeedNo
      WHERE IsDeleted = 0
        AND Status = 'Executed'
        AND RegistrationDate IS NOT NULL
        AND RegistrationDate < @Today
    `);

  for (const r of execResult.recordset) {
    logAudit({
      module: "SalesDeed",
      recordId: r.Id,
      recordNo: r.DeedNo,
      action: "Escalated",
      changedBy: SYSTEM_USER,
      changes: [{ field: "Status", oldValue: "Executed", newValue: "Overdue" }],
    });
  }

  return draftResult.recordset.length + execResult.recordset.length;
}

// ── Bookings escalation ───────────────────────────────────────────────────────
// A Pending booking is stale if it was created > 30 days ago with no update.
// Flag it by setting Status = 'Stale'.

async function escalateBookings() {
  const pool = getPool();

  const result = await pool.request().query(`
    UPDATE dbo.FollowupBookings
    SET Status = 'Stale', UpdatedBy = '${SYSTEM_USER}', UpdatedAt = SYSDATETIME()
    OUTPUT INSERTED.Id, INSERTED.BookingNo
    WHERE IsDeleted = 0
      AND Status = 'Pending'
      AND DATEDIFF(day, BookingDate, SYSDATETIME()) > 30
  `);

  for (const r of result.recordset) {
    logAudit({
      module: "Booking",
      recordId: r.Id,
      recordNo: r.BookingNo,
      action: "Escalated",
      changedBy: SYSTEM_USER,
      changes: [{ field: "Status", oldValue: "Pending", newValue: "Stale" }],
    });
  }

  return result.recordset.length;
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runEscalation() {
  const start = Date.now();

  try {
    await assertRequiredSchema();

    await Promise.all([
      escalateLegalMilestones(),
      escalateAgreementWorkflows(),
      escalateSalesDeeds(),
      escalateBookings(),
    ]);

    const elapsed = Date.now() - start;
    logger.info({ event: "ESCALATION_RUN_DONE", elapsedMs: elapsed }, "Escalation run complete");
  } catch (err) {
    logger.error({ event: "ESCALATION_RUN_FAILED", err: err.message }, "Escalation run failed");
    // Re-throw so callers (the manual POST /api/followup-escalation/run
    // endpoint, in particular) see the real failure instead of this
    // function quietly resolving and the route reporting success: true.
    // The scheduled calls below catch this themselves so a transient
    // failure here never crashes the process.
    throw err;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

function startEscalationEngine() {
  // Run immediately on startup, then on interval. runEscalation() now
  // rethrows on failure (see above) so the manual /run endpoint can surface
  // real errors — these two background call sites need their own catch so
  // a failure here doesn't become an unhandled promise rejection.
  runEscalation().catch(() => {});
  setInterval(() => {
    runEscalation().catch(() => {});
  }, INTERVAL_MS);
  logger.info({ event: "ESCALATION_ENGINE_STARTED", intervalMinutes: INTERVAL_MS / 1000 / 60 }, "Escalation engine started");
}

module.exports = { startEscalationEngine, runEscalation, assertRequiredSchema };