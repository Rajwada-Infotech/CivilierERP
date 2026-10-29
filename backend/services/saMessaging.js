/**
 * Sales Automation's use of the Communicator providers (Admin → Integrations).
 * Every message to a lead's customer is recorded as an Outbound activity on
 * the lead; a channel that isn't set up or is switched off sends nothing and
 * records nothing. Automatic sends never throw — they must not fail the
 * action that triggered them.
 */
const { sql } = require("../db");
const { send, PROVIDER_CHANNEL } = require("./messageProviders");
const templates = require("../constants/saMessages");

const LEAD_CHANNELS = Object.keys(PROVIDER_CHANNEL); // SMS, Email, WhatsApp — also SaLeadActivity types

async function loadLead(pool, leadId) {
  const r = await pool.request().input("id", sql.Int, leadId).query(
    "SELECT Id, LeadUid, CustomerName, Mobile, Email FROM dbo.SaLead WHERE Id = @id AND IsActive = 1",
  );
  return r.recordset[0] || null;
}

/**
 * Sends one message to a lead's customer over one channel ("SMS" | "WhatsApp" | "Email")
 * and records it on the lead. Resolves { ok, skipped?, error? }.
 */
async function messageLead(pool, leadId, channel, { subject, text }, actor = null) {
  if (!LEAD_CHANNELS.includes(channel)) return { ok: false, error: `Channel must be one of: ${LEAD_CHANNELS.join(", ")}` };
  const lead = await loadLead(pool, leadId);
  if (!lead) return { ok: false, error: "Lead not found" };
  const to = channel === "Email" ? lead.Email : lead.Mobile;
  if (!String(to || "").trim()) return { ok: false, skipped: true, error: `This lead has no ${channel === "Email" ? "email address" : "mobile number"}` };

  const sent = await send(PROVIDER_CHANNEL[channel], { to, subject, text });
  if (!sent.ok) return sent;

  await pool.request()
    .input("lid", sql.Int, leadId)
    .input("type", sql.NVarChar(30), channel)
    .input("summary", sql.NVarChar(sql.MAX), channel === "Email" && subject ? `${subject}\n\n${text}` : text)
    .input("cb", sql.Int, actor)
    .query(`
      INSERT INTO dbo.SaLeadActivity (LeadId, ActivityType, Direction, Outcome, Summary, CreatedBy)
      VALUES (@lid, @type, 'Outbound', 'Sent', @summary, @cb);
      UPDATE dbo.SaLead SET LastActivityAt = SYSDATETIME() WHERE Id = @lid;
    `);
  return { ok: true };
}

/** Sends a template on every channel that is set up and switched on. */
async function messageLeadAllChannels(pool, leadId, templateKey, extra, actor = null) {
  try {
    const lead = await loadLead(pool, leadId);
    if (!lead) return;
    const message = templates[templateKey](lead, extra);
    for (const channel of LEAD_CHANNELS) {
      const r = await messageLead(pool, leadId, channel, message, actor);
      if (!r.ok && !r.skipped) console.error(`[saMessaging] ${templateKey} ${channel} for lead ${leadId} failed: ${r.error}`);
    }
  } catch (e) {
    console.error(`[saMessaging] ${templateKey} for lead ${leadId} failed:`, e.message);
  }
}

/**
 * Emails the user a lead was just assigned to. Staff accounts hold an email
 * address but no mobile, so this goes by email only.
 */
async function alertAssigned(pool, leadId, userId) {
  if (!userId) return;
  try {
    const [lead, user] = await Promise.all([
      loadLead(pool, leadId),
      pool.request().input("uid", sql.Int, userId)
        .query("SELECT email FROM dbo.users WHERE id = @uid AND discontinue = 0")
        .then((r) => r.recordset[0]),
    ]);
    if (!lead || !user?.email) return;
    const r = await send(PROVIDER_CHANNEL.Email, { to: user.email, ...templates.leadAssigned(lead) });
    if (!r.ok && !r.skipped) console.error(`[saMessaging] assignment alert for lead ${leadId} to user ${userId} failed: ${r.error}`);
  } catch (e) {
    console.error(`[saMessaging] assignment alert for lead ${leadId} failed:`, e.message);
  }
}

/** alertAssigned for a list of { leadId, userId } — call after the assigning transaction commits. */
function alertAssignedMany(pool, assignments) {
  return assignments.reduce((p, a) => p.then(() => alertAssigned(pool, a.leadId, a.userId)), Promise.resolve());
}

const welcomeLead = (pool, leadId, actor) => messageLeadAllChannels(pool, leadId, "leadWelcome", null, actor);
const welcomeLeads = (pool, leadIds, actor) =>
  leadIds.reduce((p, id) => p.then(() => welcomeLead(pool, id, actor)), Promise.resolve());
const confirmSiteVisit = (pool, visit, actor) => messageLeadAllChannels(pool, visit.LeadId, "siteVisitBooked", visit, actor);

module.exports = { LEAD_CHANNELS, messageLead, messageLeadAllChannels, alertAssigned, alertAssignedMany, welcomeLead, welcomeLeads, confirmSiteVisit };
