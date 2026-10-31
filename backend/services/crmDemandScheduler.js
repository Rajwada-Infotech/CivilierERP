/**
 * CRM demands are raised when a milestone falls due — on its DueDate — not when
 * money arrives or the previous milestone is paid. Runs hourly (like
 * saSiteVisitReminders.js): every active booking's unpaid milestone whose
 * DueDate has come and whose demand is still Pending gets its demand raised
 * through the one shared raiseDemandForMilestone (crmPayments.js). Money paid
 * before a demand stays On Account; once a fully-funded booking has a new
 * demand, the usual sweep adjusts it.
 *
 * A booking still at Data Review is skipped until it has been verified, and a
 * milestone with no DueDate is left for staff to raise by hand.
 */
const { getPool, sql } = require("../db");
const { STAGE_REVIEW } = require("./crmBookingStageService");
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly

async function runDueDemandCheck() {
  // Lazy: crmPayments.js is a route module that itself loads many services.
  const { raiseDemandForMilestone, autoApplyOnAccountIfFullyFunded } = require("../routes/crmPayments");
  const pool = getPool();
  const due = await pool.request().input("review", sql.NVarChar(40), STAGE_REVIEW).query(`
    SELECT m.Id, m.BookingId, m.DueDate
    FROM dbo.CrmPaymentMilestone m
    JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    WHERE b.IsActive = 1
      AND b.Status NOT IN ${DEAD_BOOKING_SQL}
      AND ISNULL(b.WorkflowStage, @review) <> @review
      AND m.Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      AND m.DemandStatus = '${CrmStatus.PENDING}'
      AND m.AmountDue > ISNULL(m.AmountPaid, 0)
      AND m.DueDate IS NOT NULL
      AND m.DueDate <= CAST(SYSDATETIME() AS DATE)
    ORDER BY m.BookingId, m.MilestoneNo
  `);

  let raised = 0;
  const bookings = new Set();
  for (const m of due.recordset) {
    try {
      await raiseDemandForMilestone(pool, m.Id, `Auto-raised — milestone due on ${new Date(m.DueDate).toISOString().slice(0, 10)}`);
      raised++;
      bookings.add(m.BookingId);
    } catch (e) {
      logger.error({ event: "CRM_DEMAND_AUTO_RAISE_FAILED", milestoneId: m.Id, err: e.message }, "Due demand could not be raised");
    }
  }
  for (const bookingId of bookings) await autoApplyOnAccountIfFullyFunded(pool, bookingId, null, "system");
  return { raised };
}

let timer = null;
function startDueDemandEngine() {
  const run = () => {
    runDueDemandCheck()
      .then((s) => {
        if (s.raised) logger.info({ event: "CRM_DEMAND_AUTO_RAISE_DONE", ...s }, "Due demands raised");
      })
      .catch((e) => logger.error({ event: "CRM_DEMAND_AUTO_RAISE_RUN_FAILED", err: e.message }, "Due demand check failed"));
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}
function stopDueDemandEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runDueDemandCheck, startDueDemandEngine, stopDueDemandEngine };
