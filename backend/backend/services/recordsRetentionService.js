"use strict";

/**
 * backend/services/recordsRetentionService.js
 *
 * Records module retention: when a source document is deleted, its
 * attachments should still be visible/recoverable for a 7-day grace
 * period, then be purged automatically — instead of either disappearing
 * instantly or (the bug this fixes) lingering forever.
 *
 * Currently only Contract needs this: Contract's DELETE route
 * (backend/routes/contract.js) is a SOFT delete (Status='Deleted',
 * UpdatedAt bumped) that never touched the Attachments JSON column, so
 * recordsRoutes.js's fetchContractAttachments kept surfacing a deleted
 * contract's files indefinitely — that's the reported bug. Clearing
 * Attachments 7 days after the soft-delete both fixes that (the SELECT in
 * fetchContractAttachments already filters `Attachments IS NOT NULL`, so
 * nulling it removes the contract from Records with no other code change)
 * and gives a grace window to recover from an accidental delete first.
 *
 * Ticket/VehicleInOut/GRN attachments aren't wired into this yet — those
 * tables hard-delete their parent row outright rather than soft-deleting
 * with a Status+timestamp to key a grace period off, so extending this
 * pattern to them needs a schema change (a Status/DeletedAt column) on
 * each, not just another query here. Left as follow-up.
 */

const logger = require("../logger");
const { getPool, sql } = require("../db");

const GRACE_DAYS = 7;

async function purgeExpiredContractAttachments(pool) {
  const result = await pool.request().input("graceDays", sql.Int, GRACE_DAYS).query(`
    UPDATE dbo.Contract
    SET Attachments = NULL
    OUTPUT DELETED.ContractId
    WHERE Status = 'Deleted'
      AND Attachments IS NOT NULL
      AND Attachments <> ''
      AND UpdatedAt < DATEADD(day, -@graceDays, SYSDATETIME())
  `);
  return result.recordset.length;
}

async function runRecordsRetentionJob(options = {}) {
  const pool = options.pool || getPool();
  try {
    const purged = await purgeExpiredContractAttachments(pool);
    if (purged > 0) {
      logger.info(
        { event: "RECORDS_RETENTION_PURGED", purged },
        `Purged attachments for ${purged} contract(s) deleted more than ${GRACE_DAYS} days ago`,
      );
    }
    return { purged };
  } catch (err) {
    logger.error(
      { event: "RECORDS_RETENTION_ERROR", err },
      "runRecordsRetentionJob failed",
    );
    throw err;
  }
}

module.exports = { runRecordsRetentionJob, GRACE_DAYS };
