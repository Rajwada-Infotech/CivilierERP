/**
 * CRM reminders, set up in the database (CRM → Setup → Reminder Setup, migration 700).
 *
 * A rule (dbo.CrmReminderRule) picks a SITUATION below — what is still pending — a start (booking date, due date or
 * demand date) and an offset in days, how often it repeats and when it escalates. Its recipients
 * (CrmReminderRecipient: roles, users; plus the booking's salesperson) and its channels with their own wording
 * (CrmReminderChannel: Bell for staff; App, Portal, SMS, WhatsApp, Email for the customer) are rows too. Nothing about
 * who, when or what is said lives in code: only how each situation is recognised, which needs the system's own rules
 * (the money stages in crmOnAccountCoverage, the agreement status) and so cannot be typed in.
 *
 * Every hour the engine finds each active rule's pending records and sends what is due today. Every send is one row
 * in dbo.CrmReminderLog, claimed before sending (unique per rule, record, occurrence, stage, channel and recipient), so
 * a reminder is never sent twice. A record that is no longer pending has its open reminders cleared (ClearedAt), which
 * takes them off the customer portal. Paused bookings (CrmReminderPause) are skipped but stay pending. A rule's send
 * hours (migration 701) hold its sends until the hours open. The setup page can check a rule first (checkRule: what it
 * would send now, sending nothing) and send a failed reminder again (resendLog).
 *
 * What a situation is called, the dates and {fields} it offers, where a customer tap opens and the staff notification
 * type are rows of dbo.CrmReminderSituation (migration 702), read by loadSituations(); only pending() — how "still
 * pending" is recognised — lives here. Every message can carry {ReminderNo}: 1 for the first reminder, 2 for the next…
 */
const { getPool, sql } = require("../db");
const logger = require("../logger");
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { getMilestoneMoneyStages, milestoneDue } = require("./crmOnAccountCoverage");
const { emitNotification } = require("./notify");
const { sendToBookingCustomers, inr, day, BUSINESS_TZ } = require("./pushNotifications");
const { sendAutoCommunication } = require("./communicationTriggers");
const { SLA_PUSH } = require("./crmSlaEngine");

const INTERVAL_MS = 60 * 60 * 1000; // hourly, like the other CRM engines

// ── The situations a rule can pick ─────────────────────────────────────────────────────────────────────────────────
// Each: label and description (shown in the setup), the starts it allows, the {fields} its wording may use, the
// customer page a tap opens (portal / app), the staff notification type and reference, and pending(pool, rule, ctx)
// returning one row per record still pending: { bookingId, key, starts: { BookingDate, DueDate, DemandDate },
// refId, contact: { mobile, email, ownerId }, facts }.
const COMMON_FIELDS = ["CustomerName", "BookingNo", "Project", "Unit", "StartDate", "DaysSinceStart", "ReminderNo"];

// The live bookings of a rule's project (or every project), with what every message names.
const bookingsSql = (rule) => `
  SELECT b.Id AS BookingId, b.BookingNo, b.BookingDate, b.ProjectId, b.ProjectName, b.UnitNo, b.AssignedTo,
         a.ApplicantName, a.Mobile, a.Email
  FROM dbo.CrmBooking b
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  WHERE b.IsActive = 1 AND b.Status NOT IN ${DEAD_BOOKING_SQL}${rule.ProjectId ? " AND b.ProjectId = @pid" : ""}`;

const commonFacts = (b) => ({ CustomerName: b.ApplicantName, BookingNo: b.BookingNo, Project: b.ProjectName, Unit: b.UnitNo });
const contactOf = (b) => ({ mobile: b.Mobile || null, email: b.Email || null, ownerId: b.AssignedTo || null });

// A booking's milestones that still need money, by the one rule the portal and staff screens use. Cached per run.
async function stillToPay(pool, ctx, bookingId) {
  if (!ctx.stages.has(bookingId)) {
    const { milestones } = await getMilestoneMoneyStages(pool, bookingId);
    ctx.stages.set(bookingId, new Map(milestones.map((m) => [m.Id, { ...m, ...milestoneDue(m) }])));
  }
  return ctx.stages.get(bookingId);
}

// Milestones not yet paid in the table (a cheap first cut); stillToPay then decides by the money stages.
async function unpaidMilestones(pool, rule, onlyFirst) {
  const r = await pool.request().input("pid", sql.Int, rule.ProjectId || null).query(`
    SELECT x.*, m.Id AS MilestoneId, m.MilestoneNo, m.MilestoneName, m.DueDate,
           COALESCE(m.DemandRaisedOn, CAST(m.DemandRaisedAt AS DATE)) AS DemandDate
    FROM (${bookingsSql(rule)}) x
    JOIN dbo.CrmPaymentMilestone m ON m.BookingId = x.BookingId
    WHERE m.Status NOT IN (N'${CrmStatus.PAID}', N'Waived') AND m.AmountDue > ISNULL(m.AmountPaid, 0)
      ${onlyFirst ? `AND m.ExtraChargeId IS NULL AND m.ParkingAllotmentId IS NULL
        AND m.MilestoneNo = (SELECT MIN(f.MilestoneNo) FROM dbo.CrmPaymentMilestone f
                             WHERE f.BookingId = x.BookingId AND f.ExtraChargeId IS NULL AND f.ParkingAllotmentId IS NULL)` : ""}`);
  return r.recordset;
}

async function milestoneRows(pool, rule, ctx, onlyFirst) {
  const out = [];
  for (const m of await unpaidMilestones(pool, rule, onlyFirst)) {
    const st = (await stillToPay(pool, ctx, m.BookingId)).get(m.MilestoneId);
    // Paid or received (matched, held, with Finance or recorded) needs no reminder; part received asks only for the rest.
    if (!st || st.Covered || st.Verifying || !(st.ToPay > 0)) continue;
    out.push({
      bookingId: m.BookingId, key: `milestone:${m.MilestoneId}`, refId: m.MilestoneId, toPay: st.ToPay,
      starts: { BookingDate: m.BookingDate, DueDate: m.DueDate, DemandDate: m.DemandDate },
      contact: contactOf(m),
      facts: { ...commonFacts(m), Milestone: m.MilestoneName, Amount: inr(st.ToPay), DueDate: m.DueDate ? day(m.DueDate) : "" },
    });
  }
  return out;
}

// One reminder per booking for its payment milestones: those already due under the rule (start + offset reached) go
// in one message — their names, the total still to pay, the oldest due date — numbered from the oldest one. The key
// carries that oldest payment milestone, so when it is paid the next one starts its own count (Reminder 1 again)
// instead of colliding with numbers already sent. A booking with none due yet is still pending (its next one).
function oneReminderPerBooking(rows, rule, today) {
  const byBooking = new Map();
  for (const r of rows) {
    if (!r.starts[rule.StartFrom]) continue;
    byBooking.set(r.bookingId, [...(byBooking.get(r.bookingId) || []), r]);
  }
  const out = [];
  for (const [bookingId, list] of byBooking) {
    list.sort((a, b) => toDay(a.starts[rule.StartFrom]) - toDay(b.starts[rule.StartFrom]) || a.refId - b.refId);
    const due = list.filter((r) => daysBetween(r.starts[rule.StartFrom], today) - rule.OffsetDays >= 0);
    const group = due.length ? due : [list[0]];
    const first = group[0];
    const names = group.map((r) => r.facts.Milestone);
    out.push({
      bookingId, key: `milestones:${bookingId}:${first.refId}`, refId: first.refId, starts: first.starts, contact: first.contact,
      facts: {
        ...first.facts,
        Milestone: names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "),
        Amount: inr(group.reduce((n, r) => n + Number(r.toPay || 0), 0)),
        MilestoneCount: group.length,
      },
    });
  }
  return out;
}

const SITUATIONS = {
  bookingPayment: {
    label: "Booking payment not received",
    description: "The booking's first payment milestone is still to pay. Stops once it is paid or the payment is being verified.",
    starts: ["BookingDate"],
    fields: [...COMMON_FIELDS, "Milestone", "Amount", "DueDate"],
    customerScreen: "CustomerPayments", portalTarget: "payments",
    notifyType: "crm_reminder_booking_payment", refType: "crm_payment",
    pending: (pool, rule, ctx) => milestoneRows(pool, rule, ctx, true),
  },
  instalmentDue: {
    label: "Payment milestone due or overdue",
    description: "A booking's payment milestones with money still to pay, in one reminder per booking: their names and total, counted from the oldest one's due date or demand date (a negative offset reminds before). Stops once they are paid or the money is received.",
    starts: ["DueDate", "DemandDate"],
    fields: [...COMMON_FIELDS, "Milestone", "Amount", "DueDate", "MilestoneCount"],
    customerScreen: "CustomerPayments", portalTarget: "payments",
    notifyType: "sla_payment_overdue", refType: "crm_payment",
    pending: async (pool, rule, ctx) => oneReminderPerBooking(await milestoneRows(pool, rule, ctx, false), rule, ctx.today),
  },
  agreementPending: {
    label: "Agreement not signed",
    description: "The booking has no executed or registered agreement yet. Stops once the agreement is executed.",
    starts: ["BookingDate"],
    fields: [...COMMON_FIELDS],
    customerScreen: "CustomerDocuments", portalTarget: "documents",
    notifyType: "crm_reminder_agreement", refType: "crm_booking",
    async pending(pool, rule) {
      const r = await pool.request().input("pid", sql.Int, rule.ProjectId || null).query(`
        SELECT x.* FROM (${bookingsSql(rule)}) x
        WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmAgreement g WHERE g.BookingId = x.BookingId
                          AND g.Status IN (N'${CrmStatus.EXECUTED}', N'${CrmStatus.REGISTERED}'))`);
      return r.recordset.map((b) => ({
        bookingId: b.BookingId, key: `booking:${b.BookingId}`, refId: b.BookingId,
        starts: { BookingDate: b.BookingDate }, contact: contactOf(b), facts: commonFacts(b),
      }));
    },
  },
};

/**
 * The situations on offer: the database master (CrmReminderSituation, migration 702) over the code above. A situation
 * is offered only when it is active in the master and its pending() check exists here. Before migration 702 the code's
 * own description is used.
 */
async function loadSituations(pool) {
  let rows = null;
  try {
    const r = await pool.request().query(`
      IF OBJECT_ID('dbo.CrmReminderSituation') IS NOT NULL
        SELECT Situation, Label, Description, StartsJson, FieldsJson, CustomerScreen, PortalTarget, NotifyType, RefType
        FROM dbo.CrmReminderSituation WHERE IsActive = 1 ORDER BY SortOrder, Label`);
    rows = r.recordset || null;
  } catch (e) { logger.warn({ event: "CRM_REMINDER_SITUATIONS_READ_FAILED", err: e.message }, "Reminder situations read from code"); }
  if (!rows) return Object.fromEntries(Object.entries(SITUATIONS).map(([key, x]) => [key, { key, ...x }]));
  const out = {};
  for (const x of rows) {
    const code = SITUATIONS[x.Situation];
    if (!code) continue; // a master row without a check in code can't be evaluated
    let starts, fields;
    try { starts = JSON.parse(x.StartsJson); fields = JSON.parse(x.FieldsJson); } catch { continue; }
    out[x.Situation] = {
      ...code, key: x.Situation, label: x.Label, description: x.Description, starts, fields,
      customerScreen: x.CustomerScreen || code.customerScreen, portalTarget: x.PortalTarget || code.portalTarget,
      notifyType: x.NotifyType, refType: x.RefType,
    };
  }
  return out;
}

// ── Wording ──────────────────────────────────────────────────────────────────────────────────────────────────────
const FIELD = /\{(\w+)\}/g;
const render = (text, facts) => String(text || "").replace(FIELD, (all, k) => (facts[k] != null && facts[k] !== "" ? String(facts[k]) : all));
const templateParams = (text, facts) => [...String(text || "").matchAll(FIELD)].map((m) => facts[m[1]] ?? "");

// ── Business time ────────────────────────────────────────────────────────────────────────────────────────────────
// Dates as calendar days in the business's time zone, so "7 days after" never shifts by the time of the run.
const zoneParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date(d)).map((p) => [p.type, p.value]));
const toDay = (d) => { const p = zoneParts(d); return Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`); };
const daysBetween = (from, to) => Math.round((toDay(to) - toDay(from)) / 86400000);
/** Today (or d) as the business calendar date, YYYY-MM-DD. */
const businessDate = (d = new Date()) => { const p = zoneParts(d); return `${p.year}-${p.month}-${p.day}`; };
const minuteOfDay = (d) => { const p = zoneParts(d); return Number(p.hour) * 60 + Number(p.minute); };
/** The business zone's offset from UTC in minutes (to group log times into business days in SQL). */
function businessOffsetMinutes(d = new Date()) {
  const p = zoneParts(d);
  const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return Math.round((wall - Math.floor(new Date(d).getTime() / 60000) * 60000) / 60000);
}

// A rule's send hours (TIME columns, business time). NULL on a side = open on that side; From later than Until wraps
// past midnight.
const timeMinutes = (t) => {
  if (t == null || t === "") return null;
  if (t instanceof Date) return t.getUTCHours() * 60 + t.getUTCMinutes(); // mssql reads TIME as a 1970-01-01 UTC Date
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (min) => (min == null ? null : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
function withinHours(rule, now) {
  const from = timeMinutes(rule.SendFromTime), until = timeMinutes(rule.SendUntilTime), m = minuteOfDay(now);
  if (from == null && until == null) return true;
  if (from == null) return m < until;
  if (until == null) return m >= from;
  return from <= until ? m >= from && m < until : m >= from || m < until;
}

// ── Who and how ──────────────────────────────────────────────────────────────────────────────────────────────────
// The staff a rule tells at a stage: every active user of its roles, its chosen users, and (at the reminder) the
// booking's salesperson when the rule says so.
async function staffFor(pool, rule, recipients, stage, ownerId, ctx) {
  const cacheKey = `${rule.Id ?? "new"}:${stage}`;
  if (!ctx.staff.has(cacheKey)) {
    const list = recipients.filter((x) => x.Stage === stage);
    const roles = list.filter((x) => x.RoleId != null).map((x) => x.RoleId);
    const users = list.filter((x) => x.UserId != null).map((x) => x.UserId);
    let ids = [];
    if (list.length) {
      const r = await pool.request().input("roles", sql.NVarChar(sql.MAX), JSON.stringify(roles)).input("users", sql.NVarChar(sql.MAX), JSON.stringify(users)).query(`
        SELECT DISTINCT u.id FROM dbo.users u
        WHERE ISNULL(u.discontinue, 0) = 0
          AND (u.RoleId IN (SELECT CAST(value AS INT) FROM OPENJSON(@roles)) OR u.id IN (SELECT CAST(value AS INT) FROM OPENJSON(@users)))`);
      ids = r.recordset.map((x) => x.id);
    }
    ctx.staff.set(cacheKey, ids);
  }
  const ids = new Set(ctx.staff.get(cacheKey));
  if (stage === "Remind" && rule.NotifyBookingOwner && ownerId) ids.add(ownerId);
  return [...ids];
}

// Every send a record needs at one stage: one per staff member for a staff channel, one per customer channel (an
// escalation goes to staff only). The recipient is where it goes: user:<id>, the mobile, the e-mail, or booking:<id>
// for the app and the portal.
async function sendsFor(pool, rule, recipients, channels, row, occurrence, stage, facts, ctx) {
  const out = [];
  for (const ch of channels) {
    const base = {
      bookingId: row.bookingId, key: row.key, occurrence, stage, audience: ch.Audience, channel: ch.Channel,
      title: render(ch.Title, facts) || null, body: render(ch.Body, facts), facts, template: ch,
    };
    if (ch.Audience === "Staff") {
      for (const userId of await staffFor(pool, rule, recipients, stage, row.contact.ownerId, ctx)) out.push({ ...base, recipient: `user:${userId}` });
    } else if (stage === "Remind") {
      const to = ch.Channel === "Email" ? row.contact.email : ["SMS", "WhatsApp"].includes(ch.Channel) ? row.contact.mobile : null;
      out.push({ ...base, recipient: to || `booking:${row.bookingId}` });
    }
  }
  return out;
}

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Claims the log row first: if this exact send is already logged (an earlier run, or a run at the same moment), it is
// not sent again.
async function claim(pool, ruleId, e) {
  try {
    const r = await pool.request()
      .input("rule", sql.Int, ruleId).input("bid", sql.Int, e.bookingId).input("key", sql.NVarChar(60), e.key)
      .input("occ", sql.Int, e.occurrence).input("stage", sql.NVarChar(10), e.stage).input("aud", sql.NVarChar(10), e.audience)
      .input("ch", sql.NVarChar(20), e.channel).input("to", sql.NVarChar(200), String(e.recipient).slice(0, 200))
      .input("title", sql.NVarChar(200), e.title ? String(e.title).slice(0, 200) : null).input("body", sql.NVarChar(1000), String(e.body || "").slice(0, 1000))
      .query(`INSERT INTO dbo.CrmReminderLog (RuleId, BookingId, EntityKey, Occurrence, Stage, Audience, Channel, Recipient, Title, Body, Status)
              OUTPUT INSERTED.Id VALUES (@rule, @bid, @key, @occ, @stage, @aud, @ch, @to, @title, @body, N'Pending')`);
    return r.recordset[0].Id;
  } catch (err) {
    if (/UNIQUE|duplicate/i.test(err.message)) return null;
    throw err;
  }
}
async function settle(pool, logId, result, again = false) {
  await pool.request().input("id", sql.BigInt, logId).input("st", sql.NVarChar(10), result.status)
    .input("d", sql.NVarChar(300), result.detail ? String(result.detail).slice(0, 300) : null)
    .query(`UPDATE dbo.CrmReminderLog SET Status = @st, Detail = @d${again ? ", Attempts = Attempts + 1" : ""} WHERE Id = @id`);
}

// Sends one reminder through its channel; returns { status: Sent | NotSent | Failed, detail }. Used by the run and by
// "Send again" (from the log row: the wording and where it went are stored there).
async function sendOne(pool, rule, sit, e) {
  const subject = e.title || rule.Name;
  if (e.audience === "Staff") {
    const userId = Number(String(e.recipient).split(":")[1]);
    // The reference is the booking: a tap opens its payments (crm_payment) or the booking (crm_booking).
    await emitNotification(pool, userId, sit.notifyType, subject, e.body, e.bookingId, sit.refType, SLA_PUSH);
    return { status: "Sent" };
  }
  if (e.channel === "Portal") return { status: "Sent" };
  if (e.channel === "App") {
    const r = await sendToBookingCustomers(e.bookingId, { title: subject, body: e.body, data: { type: "portal", event: "reminder", screen: sit.customerScreen } });
    return r.sent > 0 ? { status: "Sent" } : { status: "NotSent", detail: "No phone signed in to the customer's app" };
  }
  const to = String(e.recipient).startsWith("booking:") ? null : e.recipient;
  const ch = e.template || {};
  const template = e.channel === "WhatsApp" && ch.TemplateName ? { name: ch.TemplateName, language: ch.TemplateLanguage, params: templateParams(ch.Body, e.facts || {}) } : null;
  const r = await sendAutoCommunication(pool, {
    bookingId: e.bookingId, channel: e.channel, subject, summary: `Reminder: ${rule.Name}`, content: e.body,
    toMobile: e.channel === "Email" ? null : to, toEmail: e.channel === "Email" ? to : null, template,
  });
  return r.ok ? { status: "Sent" } : { status: r.skipped ? "NotSent" : "Failed", detail: r.error };
}

// ── Planning: what a rule would send today ──────────────────────────────────────────────────────────────────────
// One plan for the run (which sends it) and the setup page's check (which only counts it).
async function planRule(pool, sit, rule, recipients, channels, { today, ctx, paused }) {
  const rows = await sit.pending(pool, rule, ctx);
  const plan = [];
  let due = 0;
  for (const row of rows) {
    const start = row.starts[rule.StartFrom];
    if (!start || paused(row.bookingId, rule.Id)) continue;
    const days = daysBetween(start, today);
    const since = days - rule.OffsetDays;
    // The occurrence today falls in (1st on the first day, 2nd after one repeat ...) — the reminder's number. Each is
    // logged once, so it is sent on its day, or once later if that day was missed (the server was down), never twice.
    const occurrence = since < 0 ? 0 : rule.RepeatEveryDays ? Math.floor(since / rule.RepeatEveryDays) + 1 : 1;
    const capped = rule.MaxTimes ? Math.min(occurrence, rule.MaxTimes) : occurrence;
    const facts = { ...row.facts, StartDate: day(start), DaysSinceStart: days, ReminderNo: capped };
    let isDue = false;
    if (occurrence > 0 && (!rule.MaxTimes || occurrence <= rule.MaxTimes)) {
      isDue = true;
      plan.push(...await sendsFor(pool, rule, recipients, channels, row, occurrence, "Remind", facts, ctx));
    }
    if (rule.EscalateAfterDays != null && days >= rule.EscalateAfterDays) {
      isDue = true;
      plan.push(...await sendsFor(pool, rule, recipients, channels, row, 0, "Escalate", facts, ctx));
    }
    if (isDue) due++;
  }
  return { rows, plan, due };
}

async function loadPauses(pool, today) {
  const pauses = (await pool.request().input("d", sql.Date, new Date(toDay(today))).query(`
    SELECT BookingId, RuleId FROM dbo.CrmReminderPause
    WHERE EndedAt IS NULL AND (PausedUntil IS NULL OR PausedUntil >= @d)`)).recordset;
  return (bookingId, rid) => pauses.some((p) => p.BookingId === bookingId && (p.RuleId == null || p.RuleId === rid));
}
const newCtx = (today) => ({ today, stages: new Map(), staff: new Map() });
const sendKey = (e) => [e.key, e.occurrence, e.stage, e.channel, String(e.recipient).slice(0, 200)].join("|");

/** The reminder migrations (700 to 704) applied: the engine stays quiet and the page explains until they are. */
const SCHEMA_MIGRATIONS = "700 to 704";
async function schemaReady(pool) {
  const s = (await pool.request().query(`SELECT OBJECT_ID('dbo.CrmReminderRule') AS R, OBJECT_ID('dbo.CrmReminderRecipient') AS RC,
    OBJECT_ID('dbo.CrmReminderChannel') AS C, OBJECT_ID('dbo.CrmReminderLog') AS L, OBJECT_ID('dbo.CrmReminderPause') AS P,
    COL_LENGTH('dbo.CrmReminderRule', 'SendFromTime') AS H, COL_LENGTH('dbo.CrmReminderLog', 'Attempts') AS A,
    OBJECT_ID('dbo.CrmReminderSituation') AS S, COL_LENGTH('dbo.CrmReminderRule', 'LastPreviewedAt') AS V, OBJECT_ID('dbo.CrmReminderAudit') AS AU`)).recordset[0];
  return !!(s?.R && s.RC && s.C && s.L && s.P && s.H && s.A && s.S && s.V && s.AU);
}

/**
 * The setup page's check: what a rule (saved, or as typed in the dialog) would send if it ran now — counts by channel,
 * the bookings and a few examples with their wording — without sending or logging anything.
 */
async function checkRule(rule, recipients, channels, { today = new Date(), sampleSize = 10 } = {}) {
  const pool = getPool();
  const sit = (await loadSituations(pool))[rule.Situation];
  if (!sit) throw Object.assign(new Error("This reminder's situation is not available."), { status: 400 });
  const ctx = newCtx(today);
  const paused = await loadPauses(pool, today);
  const active = channels.filter((c) => c.IsActive !== false && c.IsActive !== 0);
  const { rows, plan, due } = await planRule(pool, sit, rule, recipients, active, { today, ctx, paused });
  let fresh = plan;
  if (rule.Id && plan.length) {
    const logged = (await pool.request().input("rule", sql.Int, rule.Id).input("keys", sql.NVarChar(sql.MAX), JSON.stringify([...new Set(plan.map((e) => e.key))])).query(`
      SELECT EntityKey AS [key], Occurrence AS occurrence, Stage AS stage, Channel AS channel, Recipient AS recipient
      FROM dbo.CrmReminderLog WHERE RuleId = @rule AND EntityKey IN (SELECT value FROM OPENJSON(@keys))`)).recordset;
    const done = new Set(logged.map(sendKey));
    fresh = plan.filter((e) => !done.has(sendKey(e)));
  }
  const byChannel = {};
  for (const e of fresh) { const k = `${e.audience}:${e.channel}`; byChannel[k] = (byChannel[k] || 0) + 1; }
  return {
    pending: rows.length, due, toSend: fresh.length, alreadySent: plan.length - fresh.length,
    bookings: new Set(fresh.map((e) => e.bookingId)).size, byChannel,
    samples: fresh.slice(0, sampleSize).map((e) => ({
      bookingNo: e.facts.BookingNo, customer: e.facts.CustomerName, stage: e.stage, occurrence: e.occurrence,
      audience: e.audience, channel: e.channel, recipient: e.recipient, title: e.title, body: e.body,
    })),
    withinHours: withinHours(rule, today), hours: { from: hhmm(timeMinutes(rule.SendFromTime)), until: hhmm(timeMinutes(rule.SendUntilTime)) },
  };
}

// ── One run ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function runReminders({ today = new Date(), ruleId = null } = {}) {
  const pool = getPool();
  // Deployments can restart between the code release and the migrations. In that window this optional scheduler must
  // remain quiet; the setup route gives the administrator the actionable migration message instead.
  if (!(await schemaReady(pool))) return [];
  // A send claimed but never settled (the server stopped mid-send) is marked failed, so "Send again" can retry it.
  await pool.request().input("mins", sql.Int, Math.ceil(INTERVAL_MS / 60000)).query(`
    UPDATE dbo.CrmReminderLog SET Status = N'Failed', Detail = N'Stopped before it was sent (the server restarted).'
    WHERE Status = N'Pending' AND SentAt < DATEADD(MINUTE, -@mins, SYSDATETIME())`);
  const rules = (await pool.request().input("id", sql.Int, ruleId).query(
    `SELECT * FROM dbo.CrmReminderRule WHERE IsActive = 1${ruleId ? " AND Id = @id" : ""}`)).recordset;
  const paused = await loadPauses(pool, today);
  const situations = await loadSituations(pool);
  const ctx = newCtx(today);
  const summary = [];

  for (const rule of rules) {
    const sit = situations[rule.Situation];
    if (!sit || !sit.starts.includes(rule.StartFrom)) {
      logger.warn({ event: "CRM_REMINDER_RULE_INVALID", ruleId: rule.Id, situation: rule.Situation, startFrom: rule.StartFrom }, "Reminder rule skipped");
      summary.push({ ruleId: rule.Id, rule: rule.Name, error: "Its reminder type is not available." });
      continue;
    }
    try {
      summary.push(await runRule(pool, rule, sit, { today, ctx, paused }));
    } catch (err) {
      // One rule's failure (bad data, a query error) is logged and the other rules still run.
      logger.error({ event: "CRM_REMINDER_RULE_FAILED", ruleId: rule.Id, err: err.message }, "Reminder rule failed");
      summary.push({ ruleId: rule.Id, rule: rule.Name, error: err.message });
    }
  }
  return summary;
}

/** One rule's run: plan, send what is due (inside its hours), clear what is resolved. */
async function runRule(pool, rule, sit, { today, ctx, paused }) {
  const [channels, recipients] = await Promise.all([
    pool.request().input("rule", sql.Int, rule.Id).query("SELECT * FROM dbo.CrmReminderChannel WHERE RuleId = @rule AND IsActive = 1"),
    pool.request().input("rule", sql.Int, rule.Id).query("SELECT * FROM dbo.CrmReminderRecipient WHERE RuleId = @rule"),
  ]);
  const { rows, plan, due } = await planRule(pool, sit, rule, recipients.recordset, channels.recordset, { today, ctx, paused });
  // Outside the rule's send hours nothing goes out; the next run inside the hours sends it (the log keeps it once).
  const open = withinHours(rule, today);
  let sent = 0;
  if (open) {
    for (const e of plan) {
      const id = await claim(pool, rule.Id, e);
      if (!id) continue;
      let result;
      try { result = await sendOne(pool, rule, sit, e); } catch (err) { result = { status: "Failed", detail: err.message }; }
      await settle(pool, id, result);
      if (result.status === "Sent") sent++;
    }
  }
  // Resolved records: their open reminders are cleared (the portal stops showing them).
  await pool.request().input("rule", sql.Int, rule.Id).input("keys", sql.NVarChar(sql.MAX), JSON.stringify(rows.map((r) => r.key))).query(`
    UPDATE dbo.CrmReminderLog SET ClearedAt = SYSDATETIME()
    WHERE RuleId = @rule AND ClearedAt IS NULL AND EntityKey NOT IN (SELECT value FROM OPENJSON(@keys))`);
  return { ruleId: rule.Id, rule: rule.Name, pending: rows.length, due, sent, outsideHours: !open };
}

/**
 * "Send again" for one failed or not-sent reminder from the setup page's log — only while its matter is still open
 * (not cleared). Uses the stored wording and recipient.
 */
async function resendLog(logId) {
  const pool = getPool();
  const r = await pool.request().input("id", sql.BigInt, logId).query(`
    SELECT l.*, r.Name AS RuleName, r.Situation FROM dbo.CrmReminderLog l JOIN dbo.CrmReminderRule r ON r.Id = l.RuleId WHERE l.Id = @id`);
  const l = r.recordset[0];
  if (!l) return { status: 404, error: "Reminder not found" };
  if (!["Failed", "NotSent"].includes(l.Status)) return { status: 400, error: "Only a failed or not-sent reminder can be sent again." };
  if (l.ClearedAt) return { status: 400, error: "The matter was resolved since, so this reminder is no longer needed." };
  const sit = (await loadSituations(pool))[l.Situation];
  if (!sit) return { status: 400, error: "This reminder's situation is no longer available." };
  if (l.Channel === "WhatsApp") {
    const t = (await pool.request().input("rule", sql.Int, l.RuleId).query(
      "SELECT TemplateName FROM dbo.CrmReminderChannel WHERE RuleId = @rule AND Channel = N'WhatsApp'")).recordset[0];
    // A template's values come from the record at send time, which the log doesn't keep.
    if (t?.TemplateName) return { status: 400, error: "A WhatsApp template reminder can't be sent again from the log." };
  }
  const e = { bookingId: l.BookingId, key: l.EntityKey, audience: l.Audience, channel: l.Channel, recipient: l.Recipient, title: l.Title, body: l.Body };
  let result;
  try { result = await sendOne(pool, { Name: l.RuleName }, sit, e); } catch (err) { result = { status: "Failed", detail: err.message }; }
  await settle(pool, logId, result, true);
  return { result };
}

let timer = null;
let running = false;
function startCrmReminderEngine() {
  const run = () => {
    if (running) return; // the previous hourly run is still going
    running = true;
    runReminders()
      .finally(() => { running = false; })
      .then((s) => { const sent = s.reduce((a, r) => a + (r.sent || 0), 0); const failed = s.filter((r) => r.error);
        if (failed.length) logger.warn({ event: "CRM_REMINDER_RULES_FAILED", failed }, "Some reminder rules failed"); if (sent) logger.info({ event: "CRM_REMINDERS_SENT", sent, summary: s }, "CRM reminders sent"); })
      .catch((e) => logger.error({ event: "CRM_REMINDERS_RUN_FAILED", err: e.message }, "CRM reminder run failed"));
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}
function stopCrmReminderEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** What the setup page offers: each situation's label, description, starts and {fields} (from the master). */
async function situationList(pool = getPool()) {
  return Object.values(await loadSituations(pool)).map((x) => ({ key: x.key, label: x.label, description: x.description, starts: x.starts, fields: x.fields }));
}

module.exports = {
  SITUATIONS, loadSituations, situationList, SCHEMA_MIGRATIONS, runReminders, checkRule, resendLog, startCrmReminderEngine, stopCrmReminderEngine,
  render, withinHours, businessOffsetMinutes, businessDate, schemaReady,
};
