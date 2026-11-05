/**
 * Day-before reminder for Sales Automation site visits. Runs hourly (like
 * fixedAssetFollowupReminders.js): every Scheduled visit whose date is
 * tomorrow gets one reminder to the customer on every Communicator channel
 * that is set up and switched on. SaSiteVisit.ReminderSentFor records the date
 * reminded, so a visit is reminded once — and again if it is moved.
 */
const { getPool, sql } = require("../db");
const { messageLeadAllChannels } = require("./saMessaging");
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly

async function runSiteVisitReminderCheck() {
  const pool = getPool();
  const due = await pool.request().query(`
    SELECT v.Id, v.LeadId, v.ProjectName, v.PreferredDate, v.PreferredTime, v.PickupRequired
    FROM dbo.SaSiteVisit v
    WHERE v.IsActive = 1
      AND v.Status = 'Scheduled'
      AND v.PreferredDate = DATEADD(DAY, 1, CAST(SYSDATETIME() AS DATE))
      AND (v.ReminderSentFor IS NULL OR v.ReminderSentFor <> v.PreferredDate)
  `);

  for (const visit of due.recordset) {
    // Mark first: a provider outage must not turn into an hourly resend.
    await pool.request()
      .input("id", sql.Int, visit.Id)
      .input("d", sql.Date, visit.PreferredDate)
      .query("UPDATE dbo.SaSiteVisit SET ReminderSentFor = @d WHERE Id = @id");
    await messageLeadAllChannels(pool, visit.LeadId, "siteVisitReminder", visit);
  }
  return { reminded: due.recordset.length };
}

let timer = null;
function startSiteVisitReminderEngine() {
  const run = () => {
    runSiteVisitReminderCheck()
      .then((s) => {
        if (s.reminded) logger.info({ event: "SA_SITE_VISIT_REMINDER_DONE", ...s }, "Site visit reminders sent");
      })
      .catch((e) => logger.error({ event: "SA_SITE_VISIT_REMINDER_FAILED", err: e.message }, "Site visit reminder check failed"));
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}
function stopSiteVisitReminderEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runSiteVisitReminderCheck, startSiteVisitReminderEngine, stopSiteVisitReminderEngine };
