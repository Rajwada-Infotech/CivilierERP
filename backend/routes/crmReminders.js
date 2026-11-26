// CRM Reminder Setup — the rules, their recipients and wording, the bookings being reminded (with each one's reminder
// number), the send log, day-wise counts, paused bookings and the change history (migrations 700 to 704). The engine that sends them is services/crmReminderEngine.js; everything it reads is edited here.
//
// Rules are never erased (their sends are history): a rule is switched off instead.

const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { loadSituations, situationList, SCHEMA_MIGRATIONS, runReminders, checkRule, resendLog, businessOffsetMinutes, businessDate, schemaReady } = require("../services/crmReminderEngine");
const { messagingStatus, PROVIDER_CHANNEL } = require("../services/messageProviders");
const { crmProjectGuards, projectPredicate, assertBookingAllowed, assertProjectAllowed } = require("../services/projectScope");

router.use(apiRateLimit);
// Project access: a rule by its project (every project = only users with no project limit), a pause and a log row by
// their booking's.
crmProjectGuards(router, {
  "/pauses": "SELECT b.ProjectId FROM dbo.CrmReminderPause p JOIN dbo.CrmBooking b ON b.Id = p.BookingId WHERE p.Id = @id",
  "/log": "SELECT b.ProjectId FROM dbo.CrmReminderLog l JOIN dbo.CrmBooking b ON b.Id = l.BookingId WHERE l.Id = @id",
  default: "SELECT ProjectId FROM dbo.CrmReminderRule WHERE Id = @id",
});
// A rule for every project reaches bookings outside a limited user's projects: only an unlimited user may save one.
function ruleProjectAllowed(req, res, projectId) {
  if (projectId == null && req.projectScope) { res.status(403).json({ error: "Choose one of your projects: a reminder for all projects needs access to every project." }); return false; }
  return assertProjectAllowed(req, res, projectId);
}

const PAGE = "crm-reminder-setup";
// A booking's own reminders (its reminder number, pausing and resuming) are also read and handled on its payment
// milestones page, where the salesperson works: Reminder Setup or Payment Milestones rights.
const BOOKING_PAGES = [PAGE, "crm-payments"];
const actorId = (req) => req.user?.userId ?? req.user?.id ?? null;
const CHANNELS = { Staff: ["Bell"], Customer: ["App", "Portal", "SMS", "WhatsApp", "Email"] };
const STAGES = ["Remind", "Escalate"];
const LIMITS = { offset: 3650, repeat: 365, max: 100, escalate: 3650 };

async function schemaProblem(pool) {
  return (await schemaReady(pool)) ? null : `Reminder tables are missing or out of date — run database migrations ${SCHEMA_MIGRATIONS}.`;
}
// Log times grouped into business days (the database clock may be UTC or local): @shift = business offset - DB offset.
const SHIFT_SQL = "DECLARE @shift INT = @biz - DATEDIFF(MINUTE, SYSUTCDATETIME(), SYSDATETIME());";
const bizDay = (col) => `CAST(DATEADD(MINUTE, @shift, ${col}) AS DATE)`;
const withBiz = (rq) => rq.input("biz", sql.Int, businessOffsetMinutes()).input("today", sql.Date, businessDate());
const fail = (res, e, what) => {
  console.error(`[crm-reminders] ${what}:`, e.message);
  res.status(500).json({ error: "An internal error occurred. Please try again later." });
};
const audit = async (db, { ruleId = null, bookingId = null, action, detail = null, snapshot = null, by = null }) =>
  db.request().input("rule", sql.Int, ruleId).input("booking", sql.Int, bookingId).input("action", sql.NVarChar(40), action)
    .input("detail", sql.NVarChar(500), detail).input("snapshot", sql.NVarChar(sql.MAX), snapshot ? JSON.stringify(snapshot) : null).input("by", sql.Int, by)
    .query("INSERT INTO dbo.CrmReminderAudit (RuleId, BookingId, Action, Detail, SnapshotJson, ChangedBy) VALUES (@rule, @booking, @action, @detail, @snapshot, @by)");

// Situations (label, dates, {fields}, where a tap opens) come from the database master through the engine's
// loadSituations — the one reader shared with the engine and the customer portal.

// ── Validation: one place for create and edit ───────────────────────────────────────────────────────────────────
const intOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
function readRule(b, situations) {
  const sit = situations[b.Situation];
  if (!String(b.Name || "").trim()) return { error: "Give the reminder a name." };
  if (!sit) return { error: "Choose what the reminder is about." };
  if (!sit.starts.includes(b.StartFrom)) return { error: `"${sit.label}" counts from ${sit.starts.join(" or ")}.` };
  const offset = Number(b.OffsetDays ?? 0);
  const repeat = intOrNull(b.RepeatEveryDays);
  const max = intOrNull(b.MaxTimes);
  const escalate = intOrNull(b.EscalateAfterDays);
  const projectId = intOrNull(b.ProjectId);
  const hour = (v) => { const t = String(v ?? "").trim(); return t === "" ? null : /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : undefined; };
  const sendFrom = hour(b.SendFrom), sendUntil = hour(b.SendUntil);
  if (sendFrom === undefined || sendUntil === undefined) return { error: "Send hours are times like 10:00, or blank for any time." };
  if (sendFrom != null && sendFrom === sendUntil) return { error: "Send hours From and Until can't be the same time." };
  if (!Number.isInteger(offset) || Math.abs(offset) > LIMITS.offset) return { error: `Days must be a whole number between -${LIMITS.offset} and ${LIMITS.offset}.` };
  if (repeat != null && !(Number.isInteger(repeat) && repeat >= 1 && repeat <= LIMITS.repeat)) return { error: `Repeat every must be 1 to ${LIMITS.repeat} days, or blank for once.` };
  if (max != null && !(Number.isInteger(max) && max >= 1 && max <= LIMITS.max)) return { error: `At most must be 1 to ${LIMITS.max} times, or blank.` };
  if (escalate != null && !(Number.isInteger(escalate) && escalate >= 0 && escalate <= LIMITS.escalate)) return { error: `Escalate after must be 0 to ${LIMITS.escalate} days, or blank.` };
  if (projectId != null && !Number.isInteger(projectId)) return { error: "Choose a project, or all projects." };

  const recipients = [];
  for (const x of Array.isArray(b.Recipients) ? b.Recipients : []) {
    const roleId = intOrNull(x.RoleId), userId = intOrNull(x.UserId);
    if (!STAGES.includes(x.Stage) || (roleId == null) === (userId == null)) return { error: "Each recipient is one role or one user, at the reminder or the escalation." };
    recipients.push({ Stage: x.Stage, RoleId: roleId, UserId: userId });
  }
  const channels = [];
  for (const c of Array.isArray(b.Channels) ? b.Channels : []) {
    if (!CHANNELS[c.Audience]?.includes(c.Channel)) return { error: `${c.Channel} is not a ${String(c.Audience || "").toLowerCase()} channel.` };
    if (channels.some((x) => x.Audience === c.Audience && x.Channel === c.Channel)) return { error: `${c.Channel} is listed twice.` };
    const title = String(c.Title || "").trim(), body = String(c.Body || "").trim();
    if (!body) return { error: `Write the ${c.Channel} message.` };
    if (title.length > 200 || body.length > 1000) return { error: `The ${c.Channel} title is at most 200 characters and the message 1000.` };
    // Only the fields this situation fills: anything else would be sent as typed.
    const unknown = [...`${title} ${body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((f) => !sit.fields.includes(f));
    if (unknown.length) return { error: `${c.Channel}: ${[...new Set(unknown)].map((f) => `{${f}}`).join(", ")} is not available for "${sit.label}". Available: ${sit.fields.map((f) => `{${f}}`).join(" ")}.` };
    const templateName = String(c.TemplateName || "").trim() || null, templateLanguage = String(c.TemplateLanguage || "").trim() || null;
    if (c.Channel === "WhatsApp" && templateName && !templateLanguage) return { error: "WhatsApp: give the template's language code as approved by the provider (e.g. en, en_US, hi)." };
    channels.push({ Audience: c.Audience, Channel: c.Channel, Title: title || null, Body: body, TemplateName: c.Channel === "WhatsApp" ? templateName : null,
      TemplateLanguage: c.Channel === "WhatsApp" ? templateLanguage : null, IsActive: c.IsActive === false || c.IsActive === 0 ? 0 : 1 });
  }
  const owner = b.NotifyBookingOwner ? 1 : 0;
  if (!channels.some((c) => c.IsActive)) return { error: "Switch on at least one channel." };
  if (channels.some((c) => c.Audience === "Staff" && c.IsActive) && !owner && !recipients.length) return { error: "The staff reminder needs someone to tell: a role, a user or the booking's salesperson." };
  if (recipients.some((r) => r.Stage === "Escalate") && escalate == null) return { error: "Set when to escalate, or remove the escalation recipients." };
  if (escalate != null && !recipients.some((r) => r.Stage === "Escalate")) return { error: "Choose who is told at the escalation." };
  return {
    rule: { Name: String(b.Name).trim().slice(0, 150), Situation: b.Situation, ProjectId: projectId, StartFrom: b.StartFrom, OffsetDays: offset,
      RepeatEveryDays: repeat, MaxTimes: max, EscalateAfterDays: escalate, NotifyBookingOwner: owner, SendFrom: sendFrom, SendUntil: sendUntil,
      Notes: String(b.Notes || "").trim().slice(0, 500) || null, IsActive: b.IsActive === false || b.IsActive === 0 ? 0 : 1 },
    recipients, channels,
  };
}

async function writeChildren(tx, ruleId, recipients, channels) {
  await tx.request().input("id", sql.Int, ruleId).query("DELETE FROM dbo.CrmReminderRecipient WHERE RuleId = @id; DELETE FROM dbo.CrmReminderChannel WHERE RuleId = @id;");
  for (const r of recipients) {
    await tx.request().input("id", sql.Int, ruleId).input("st", sql.NVarChar(10), r.Stage).input("role", sql.Int, r.RoleId).input("user", sql.Int, r.UserId)
      .query("INSERT INTO dbo.CrmReminderRecipient (RuleId, Stage, RoleId, UserId) VALUES (@id, @st, @role, @user)");
  }
  for (const c of channels) {
    await tx.request().input("id", sql.Int, ruleId).input("aud", sql.NVarChar(10), c.Audience).input("ch", sql.NVarChar(20), c.Channel)
      .input("t", sql.NVarChar(200), c.Title).input("b", sql.NVarChar(1000), c.Body).input("tn", sql.NVarChar(100), c.TemplateName)
      .input("tl", sql.NVarChar(20), c.TemplateLanguage).input("on", sql.Bit, c.IsActive)
      .query("INSERT INTO dbo.CrmReminderChannel (RuleId, Audience, Channel, Title, Body, TemplateName, TemplateLanguage, IsActive) VALUES (@id, @aud, @ch, @t, @b, @tn, @tl, @on)");
  }
}
const ruleInputs = (rq, r) => rq.input("name", sql.NVarChar(150), r.Name).input("sit", sql.NVarChar(50), r.Situation).input("pid", sql.Int, r.ProjectId)
  .input("start", sql.NVarChar(30), r.StartFrom).input("off", sql.Int, r.OffsetDays).input("rep", sql.Int, r.RepeatEveryDays).input("max", sql.Int, r.MaxTimes)
  .input("esc", sql.Int, r.EscalateAfterDays).input("own", sql.Bit, r.NotifyBookingOwner).input("notes", sql.NVarChar(500), r.Notes).input("on", sql.Bit, r.IsActive)
  .input("sfrom", sql.VarChar(5), r.SendFrom).input("suntil", sql.VarChar(5), r.SendUntil);

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
router.get("/situations", requirePageRight(PAGE, "view"), async (_req, res) => {
  // Whether SMS / WhatsApp / e-mail are set up in Communicator: a channel that isn't is logged as "Not sent".
  let ready = {};
  try {
    const status = await messagingStatus();
    ready = Object.fromEntries(Object.entries(PROVIDER_CHANNEL).map(([ch, key]) => {
      const st = status.find((x) => x.channel === key);
      return [ch, { ready: !!st?.ready, missing: st?.missing || [], saved: !!st?.saved, active: !!st?.active }];
    }));
  } catch (e) { console.error("[crm-reminders] messaging status:", e.message); }
  try {
    res.json({ situations: await situationList(getPool()), channels: CHANNELS, stages: STAGES, limits: LIMITS, ready });
  } catch (e) { fail(res, e, "GET /situations"); }
});

// Roles, active users and projects to choose from — all from the database.
router.get("/options", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [roles, users, projects] = await Promise.all([
      pool.request().query("SELECT r.RId AS id, r.RName AS name, (SELECT COUNT(*) FROM dbo.users u WHERE u.RoleId = r.RId AND ISNULL(u.discontinue, 0) = 0) AS users FROM dbo.Role r ORDER BY r.RName"),
      pool.request().query("SELECT u.id, u.name, r.RName AS role FROM dbo.users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId WHERE ISNULL(u.discontinue, 0) = 0 ORDER BY u.name"),
      pool.request().query(`SELECT id, name FROM dbo.enterprise WHERE business_type = 'P'${projectPredicate(req.projectScope, "id")} ORDER BY name`),
    ]);
    res.json({ roles: roles.recordset, users: users.recordset, projects: projects.recordset });
  } catch (e) { fail(res, e, "GET /options"); }
});

router.get("/rules", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const problem = await schemaProblem(pool);
    if (problem) return res.status(503).json({ error: problem });
    const situations = await loadSituations(pool);
    const [rules, recipients, channels, counts] = await Promise.all([
      pool.request().query(`SELECT r.*, CONVERT(VARCHAR(5), r.SendFromTime, 108) AS SendFrom, CONVERT(VARCHAR(5), r.SendUntilTime, 108) AS SendUntil, p.name AS ProjectName, cu.name AS CreatedByName, uu.name AS UpdatedByName
        FROM dbo.CrmReminderRule r LEFT JOIN dbo.enterprise p ON p.id = r.ProjectId
        LEFT JOIN dbo.users cu ON cu.id = r.CreatedBy LEFT JOIN dbo.users uu ON uu.id = r.UpdatedBy
        WHERE 1 = 1${projectPredicate(req.projectScope, "r.ProjectId")} ORDER BY r.IsActive DESC, r.Name`),
      pool.request().query(`SELECT x.*, ro.RName AS RoleName, u.name AS UserName,
          CASE WHEN x.RoleId IS NOT NULL THEN (SELECT COUNT(*) FROM dbo.users ru WHERE ru.RoleId = x.RoleId AND ISNULL(ru.discontinue, 0) = 0) END AS ActiveUsers,
          CASE WHEN x.UserId IS NOT NULL THEN CAST(CASE WHEN ISNULL(u.discontinue, 0) = 0 THEN 1 ELSE 0 END AS BIT) END AS UserActive
        FROM dbo.CrmReminderRecipient x
        JOIN dbo.CrmReminderRule r ON r.Id = x.RuleId
        LEFT JOIN dbo.Role ro ON ro.RId = x.RoleId LEFT JOIN dbo.users u ON u.id = x.UserId
        WHERE 1 = 1${projectPredicate(req.projectScope, "r.ProjectId")}`),
      pool.request().query(`SELECT x.* FROM dbo.CrmReminderChannel x
        JOIN dbo.CrmReminderRule r ON r.Id = x.RuleId
        WHERE 1 = 1${projectPredicate(req.projectScope, "r.ProjectId")}`),
      // Each rule's sends in the last 30 days and when it last sent.
      pool.request().query(`SELECT RuleId, COUNT(*) AS Sends30, SUM(CASE WHEN Status = N'Sent' THEN 1 ELSE 0 END) AS Sent30, MAX(SentAt) AS LastSentAt
        FROM dbo.CrmReminderLog WHERE SentAt >= DATEADD(DAY, -30, SYSDATETIME()) GROUP BY RuleId`),
    ]);
    const byRule = (rows, id) => rows.filter((x) => x.RuleId === id);
    res.json({
      rules: rules.recordset.map((r) => ({
        ...r, Recipients: byRule(recipients.recordset, r.Id), Channels: byRule(channels.recordset, r.Id),
        Activity: counts.recordset.find((c) => c.RuleId === r.Id) || { Sends30: 0, Sent30: 0, LastSentAt: null },
        SituationLabel: situations[r.Situation]?.label || r.Situation,
      })),
    });
  } catch (e) { fail(res, e, "GET /rules"); }
});

// A concise history for the plan card: never expose a rule outside the
// caller's project scope (the router's :id project guard runs first).
router.get("/rules/:id/history", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid reminder id" });
  try {
    const r = await getPool().request().input("id", sql.Int, id).query(`
      SELECT TOP 50 a.Id, a.Action, a.Detail, a.ChangedAt, u.name AS ChangedByName,
             CAST(CASE WHEN a.SnapshotJson IS NULL THEN 0 ELSE 1 END AS BIT) AS HasSnapshot
      FROM dbo.CrmReminderAudit a LEFT JOIN dbo.users u ON u.id = a.ChangedBy
      WHERE a.RuleId = @id ORDER BY a.ChangedAt DESC, a.Id DESC`);
    res.json({ rows: r.recordset });
  } catch (e) { fail(res, e, "GET /rules/:id/history"); }
});

// The bookings being reminded now (still pending, not cleared): per reminder and record, its reminder number so far,
// how many have gone out, when it started, the last send and whether one went today. Filter by reminder or search.
router.get("/live", requireAnyPageRight(BOOKING_PAGES, "view"), async (req, res) => {
  try {
    const q = req.query;
    const page = Math.max(1, parseInt(q.page, 10) || 1), size = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
    const rq = withBiz(getPool().request());
    const where = [`l.ClearedAt IS NULL${projectPredicate(req.projectScope, "b.ProjectId")}`];
    if (q.bookingId) { rq.input("bid", sql.Int, parseInt(q.bookingId, 10)); where.push("l.BookingId = @bid"); }
    if (q.ruleId) { rq.input("rule", sql.Int, parseInt(q.ruleId, 10)); where.push("l.RuleId = @rule"); }
    if (q.q) { rq.input("q", sql.NVarChar(100), `%${String(q.q).replace(/[\\%_[]/g, (c) => `\\${c}`)}%`); where.push("(b.BookingNo LIKE @q ESCAPE '\\' OR a.ApplicantName LIKE @q ESCAPE '\\')"); }
    rq.input("skip", sql.Int, (page - 1) * size).input("take", sql.Int, size);
    const r = await rq.query(`${SHIFT_SQL}
      SELECT l.RuleId, r.Name AS RuleName, l.BookingId, l.EntityKey, b.BookingNo, a.ApplicantName, b.ProjectName, b.UnitNo,
             MAX(CASE WHEN l.Stage = N'Remind' THEN l.Occurrence END) AS ReminderNo,
             COUNT(DISTINCT CASE WHEN l.Stage = N'Remind' AND l.Status = N'Sent' THEN l.Occurrence END) AS RemindersSent,
             SUM(CASE WHEN l.Status = N'Sent' THEN 1 ELSE 0 END) AS Deliveries,
             SUM(CASE WHEN l.Status IN (N'NotSent', N'Failed') THEN 1 ELSE 0 END) AS Problems,
             CAST(MAX(CASE WHEN l.Stage = N'Escalate' THEN 1 ELSE 0 END) AS BIT) AS Escalated,
             MIN(l.SentAt) AS FirstAt, MAX(l.SentAt) AS LastAt,
             CAST(MAX(CASE WHEN ${bizDay("l.SentAt")} = @today THEN 1 ELSE 0 END) AS BIT) AS SentToday,
             COUNT(*) OVER () AS Total
      FROM dbo.CrmReminderLog l
      JOIN dbo.CrmReminderRule r ON r.Id = l.RuleId
      JOIN dbo.CrmBooking b ON b.Id = l.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE ${where.join(" AND ")}
      GROUP BY l.RuleId, r.Name, l.BookingId, l.EntityKey, b.BookingNo, a.ApplicantName, b.ProjectName, b.UnitNo
      ORDER BY MAX(l.SentAt) DESC, l.BookingId DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`);
    res.json({ today: businessDate(), rows: r.recordset, total: r.recordset[0]?.Total || 0, page, pageSize: size });
  } catch (e) { fail(res, e, "GET /live"); }
});

// The send log: filter by rule, booking, status, channel and dates; newest first, paged.
router.get("/log", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const q = req.query;
    const page = Math.max(1, parseInt(q.page, 10) || 1), size = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
    const where = [`1 = 1${projectPredicate(req.projectScope, "b.ProjectId")}`];
    const rq = withBiz(pool.request());
    if (q.ruleId) { rq.input("rule", sql.Int, parseInt(q.ruleId, 10)); where.push("l.RuleId = @rule"); }
    if (q.bookingId) { rq.input("bid", sql.Int, parseInt(q.bookingId, 10)); where.push("l.BookingId = @bid"); }
    if (q.status) { rq.input("st", sql.NVarChar(10), String(q.status)); where.push("l.Status = @st"); }
    if (q.channel) { rq.input("ch", sql.NVarChar(20), String(q.channel)); where.push("l.Channel = @ch"); }
    if (q.from) { rq.input("from", sql.Date, q.from); where.push(`${bizDay("l.SentAt")} >= @from`); }
    if (q.to) { rq.input("to", sql.Date, q.to); where.push(`${bizDay("l.SentAt")} <= @to`); }
    if (q.q) { rq.input("q", sql.NVarChar(100), `%${String(q.q).replace(/[\\%_[]/g, (c) => `\\${c}`)}%`); where.push("(b.BookingNo LIKE @q ESCAPE '\\' OR a.ApplicantName LIKE @q ESCAPE '\\')"); }
    rq.input("skip", sql.Int, (page - 1) * size).input("take", sql.Int, size);
    const r = await rq.query(`${SHIFT_SQL}
      SELECT l.*, r.Name AS RuleName, b.BookingNo, a.ApplicantName, u.name AS UserName, COUNT(*) OVER () AS Total
      FROM dbo.CrmReminderLog l
      JOIN dbo.CrmReminderRule r ON r.Id = l.RuleId
      LEFT JOIN dbo.CrmBooking b ON b.Id = l.BookingId
      LEFT JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.users u ON l.Recipient = CONCAT('user:', u.id)
      WHERE ${where.join(" AND ")}
      ORDER BY l.SentAt DESC, l.Id DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`);
    res.json({ rows: r.recordset, total: r.recordset[0]?.Total || 0, page, pageSize: size });
  } catch (e) { fail(res, e, "GET /log"); }
});

// Day-wise counts: per day, rule and channel, how many were sent, not sent (no channel / contact) and failed.
router.get("/daily", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const r = await withBiz(getPool().request()).input("days", sql.Int, days).query(`${SHIFT_SQL}
      SELECT ${bizDay("l.SentAt")} AS Day, l.RuleId, r.Name AS RuleName, l.Audience, l.Channel,
             SUM(CASE WHEN l.Status = N'Sent' THEN 1 ELSE 0 END) AS Sent,
             SUM(CASE WHEN l.Status = N'NotSent' THEN 1 ELSE 0 END) AS NotSent,
             SUM(CASE WHEN l.Status IN (N'Failed', N'Pending') THEN 1 ELSE 0 END) AS Failed,
             COUNT(DISTINCT l.BookingId) AS Bookings
      FROM dbo.CrmReminderLog l JOIN dbo.CrmReminderRule r ON r.Id = l.RuleId
      LEFT JOIN dbo.CrmBooking b ON b.Id = l.BookingId
      WHERE ${bizDay("l.SentAt")} >= DATEADD(DAY, 1 - @days, @today)${projectPredicate(req.projectScope, "b.ProjectId")}
      GROUP BY ${bizDay("l.SentAt")}, l.RuleId, r.Name, l.Audience, l.Channel
      ORDER BY Day DESC, RuleName, l.Audience, l.Channel`);
    res.json({ days, today: businessDate(), rows: r.recordset });
  } catch (e) { fail(res, e, "GET /daily"); }
});

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────────────
router.post("/rules", requirePageRight(PAGE, "create"), async (req, res) => {
  let situations;
  try { situations = await loadSituations(getPool()); } catch (e) { return fail(res, e, "POST /rules situation metadata"); }
  const v = readRule(req.body || {}, situations);
  if (v.error) return res.status(400).json({ error: v.error });
  // A newly saved plan is intentionally off.  It must be previewed from its
  // saved form before the activation endpoint will turn it on.
  const requestedActive = !!v.rule.IsActive;
  v.rule.IsActive = 0;
  if (!ruleProjectAllowed(req, res, v.rule.ProjectId)) return;
  const pool = getPool();
  const tx = pool.transaction();
  try {
    await tx.begin();
    const r = await ruleInputs(tx.request(), v.rule).input("by", sql.Int, actorId(req)).query(`
      INSERT INTO dbo.CrmReminderRule (Name, Situation, ProjectId, StartFrom, OffsetDays, RepeatEveryDays, MaxTimes, EscalateAfterDays, NotifyBookingOwner,
        SendFromTime, SendUntilTime, Notes, IsActive, CreatedBy)
      OUTPUT INSERTED.Id VALUES (@name, @sit, @pid, @start, @off, @rep, @max, @esc, @own, CAST(@sfrom AS TIME(0)), CAST(@suntil AS TIME(0)), @notes, @on, @by)`);
    const id = r.recordset[0].Id;
    await writeChildren(tx, id, v.recipients, v.channels);
    await audit(tx, { ruleId: id, action: "Created", detail: "Saved inactive until previewed", snapshot: { ...v.rule, Recipients: v.recipients, Channels: v.channels }, by: actorId(req) });
    await tx.commit();
    res.status(201).json({ success: true, id, requiresPreview: requestedActive });
  } catch (e) { await tx.rollback().catch(() => {}); fail(res, e, "POST /rules"); }
});

router.put("/rules/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  let situations;
  try { situations = await loadSituations(getPool()); } catch (e) { return fail(res, e, "PUT /rules situation metadata"); }
  const v = readRule(req.body || {}, situations);
  if (v.error) return res.status(400).json({ error: v.error });
  // Editing invalidates an earlier preview.  Save safely off, then make the
  // operator inspect the current bookings/messages and activate explicitly.
  const requestedActive = !!v.rule.IsActive;
  v.rule.IsActive = 0;
  if (!ruleProjectAllowed(req, res, v.rule.ProjectId)) return;
  const pool = getPool();
  const tx = pool.transaction();
  try {
    await tx.begin();
    const r = await ruleInputs(tx.request(), v.rule).input("id", sql.Int, id).input("by", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmReminderRule SET Name = @name, Situation = @sit, ProjectId = @pid, StartFrom = @start, OffsetDays = @off,
        RepeatEveryDays = @rep, MaxTimes = @max, EscalateAfterDays = @esc, NotifyBookingOwner = @own,
        SendFromTime = CAST(@sfrom AS TIME(0)), SendUntilTime = CAST(@suntil AS TIME(0)), Notes = @notes, IsActive = @on,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id`);
    if (!r.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: "Reminder not found" }); }
    await writeChildren(tx, id, v.recipients, v.channels);
    await audit(tx, { ruleId: id, action: "Updated", detail: "Saved inactive; preview is required before activation", snapshot: { ...v.rule, Recipients: v.recipients, Channels: v.channels }, by: actorId(req) });
    await tx.commit();
    res.json({ success: true, requiresPreview: requestedActive });
  } catch (e) { await tx.rollback().catch(() => {}); fail(res, e, "PUT /rules/:id"); }
});

// Restore an audited configuration. Restoring never turns delivery back on:
// the restored plan must pass through the current live preview gate first.
router.post("/rules/:id/restore/:auditId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id), auditId = parseId(req.params.auditId);
  if (id === null || auditId === null) return res.status(400).json({ error: "Invalid reminder or history entry" });
  const pool = getPool();
  let tx = null;
  try {
    const row = (await pool.request().input("rule", sql.Int, id).input("audit", sql.BigInt, auditId)
      .query("SELECT SnapshotJson FROM dbo.CrmReminderAudit WHERE Id = @audit AND RuleId = @rule")).recordset[0];
    if (!row?.SnapshotJson) return res.status(404).json({ error: "That history entry has no restorable reminder plan." });
    let snapshot;
    try { snapshot = JSON.parse(row.SnapshotJson); } catch { return res.status(409).json({ error: "That saved history entry is not valid JSON." }); }
    const v = readRule(snapshot, await loadSituations(pool));
    if (v.error) return res.status(409).json({ error: `That saved plan can no longer be restored: ${v.error}` });
    v.rule.IsActive = 0;
    if (!ruleProjectAllowed(req, res, v.rule.ProjectId)) return;
    tx = pool.transaction();
    await tx.begin();
    const updated = await ruleInputs(tx.request(), v.rule).input("id", sql.Int, id).input("by", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmReminderRule SET Name = @name, Situation = @sit, ProjectId = @pid, StartFrom = @start, OffsetDays = @off,
        RepeatEveryDays = @rep, MaxTimes = @max, EscalateAfterDays = @esc, NotifyBookingOwner = @own,
        SendFromTime = CAST(@sfrom AS TIME(0)), SendUntilTime = CAST(@suntil AS TIME(0)), Notes = @notes, IsActive = 0,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    if (!updated.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: "Reminder not found" }); }
    await writeChildren(tx, id, v.recipients, v.channels);
    await audit(tx, { ruleId: id, action: "Restored", detail: `Restored audit entry #${auditId}; saved inactive pending preview`, snapshot: { ...v.rule, Recipients: v.recipients, Channels: v.channels }, by: actorId(req) });
    await tx.commit();
    res.json({ success: true, requiresPreview: true });
  } catch (e) { if (tx) await tx.rollback().catch(() => {}); fail(res, e, "POST /rules/:id/restore/:auditId"); }
});

router.patch("/rules/:id/active", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const enabling = !!req.body?.IsActive;
    const pool = getPool();
    if (enabling) {
      const current = await pool.request().input("id", sql.Int, id).query("SELECT CreatedAt, UpdatedAt, LastPreviewedAt FROM dbo.CrmReminderRule WHERE Id = @id");
      if (!current.recordset.length) return res.status(404).json({ error: "Reminder not found" });
      const rule = current.recordset[0];
      const changedAt = rule.UpdatedAt || rule.CreatedAt;
      if (!rule.LastPreviewedAt || new Date(rule.LastPreviewedAt) < new Date(changedAt)) {
        return res.status(409).json({ error: "Check this saved reminder first. Review its live booking and message preview, then switch it on." });
      }
    }
    // Activation is not a configuration change: do not invalidate the preview
    // timestamp merely by turning the same saved plan off/on.
    const r = await pool.request().input("id", sql.Int, id).input("on", sql.Bit, enabling ? 1 : 0).input("by", sql.Int, actorId(req))
      .query("UPDATE dbo.CrmReminderRule SET IsActive = @on, UpdatedBy = @by WHERE Id = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Reminder not found" });
    await audit(pool, { ruleId: id, action: enabling ? "Enabled" : "Disabled", detail: enabling ? "Enabled after saved-plan preview" : "Switched off", by: actorId(req) });
    res.json({ success: true });
  } catch (e) { fail(res, e, "PATCH /rules/:id/active"); }
});

// Runs every active rule now (or one), as the hourly run would. Sends whatever is due.
router.post("/run", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const ruleId = req.body?.ruleId ? parseId(String(req.body.ruleId)) : null;
    if (req.body?.ruleId && ruleId === null) return res.status(400).json({ error: "Invalid reminder id" });
    // A project-scoped user must never start the all-project scheduler.  For a
    // single rule, confirm its project before handing it to the engine.
    if (req.projectScope && ruleId == null) return res.status(403).json({ error: "Choose one of your project's reminders to run." });
    if (ruleId != null) {
      const found = await getPool().request().input("id", sql.Int, ruleId)
        .query("SELECT ProjectId FROM dbo.CrmReminderRule WHERE Id = @id");
      if (!found.recordset.length) return res.status(404).json({ error: "Reminder not found" });
      if (req.projectScope && !assertProjectAllowed(req, res, found.recordset[0].ProjectId)) return;
    }
    res.json({ success: true, summary: await runReminders({ ruleId }) });
  } catch (e) { fail(res, e, "POST /run"); }
});

// Check first: what a rule would send if it ran now — saved ({ ruleId }) or as typed in the dialog (the rule body,
// with Id when editing so sends already made are not counted). Sends and logs nothing.
router.post("/check", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const problem = await schemaProblem(pool);
    if (problem) return res.status(503).json({ error: problem });
    let rule, recipients, channels, savedRuleId = null;
    if (req.body?.ruleId != null) {
      const id = parseId(String(req.body.ruleId));
      if (id === null) return res.status(400).json({ error: "Invalid reminder id" });
      const [r, rc, ch] = await Promise.all([
        pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmReminderRule WHERE Id = @id"),
        pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmReminderRecipient WHERE RuleId = @id"),
        pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmReminderChannel WHERE RuleId = @id"),
      ]);
      rule = r.recordset[0];
      if (!rule) return res.status(404).json({ error: "Reminder not found" });
      if (req.projectScope && !assertProjectAllowed(req, res, rule.ProjectId)) return;
      recipients = rc.recordset; channels = ch.recordset;
      savedRuleId = id;
    } else {
      const v = readRule(req.body || {}, await loadSituations(pool));
      if (v.error) return res.status(400).json({ error: v.error });
      if (!ruleProjectAllowed(req, res, v.rule.ProjectId)) return;
      const id = req.body?.Id != null && req.body.Id !== "" ? parseId(String(req.body.Id)) : null;
      rule = { ...v.rule, Id: id, SendFromTime: v.rule.SendFrom, SendUntilTime: v.rule.SendUntil };
      recipients = v.recipients; channels = v.channels;
    }
    let preview;
    try { preview = await checkRule(rule, recipients, channels); }
    catch (e) { if (e.status === 400) return res.status(400).json({ error: e.message }); throw e; }
    // Only the switch-on check of the saved rule ({ ruleId, authorize: true }) authorizes activation and is recorded.
    // A typed/unsaved preview, or the plan card's status line, only reads.
    const authorize = savedRuleId != null && req.body?.authorize === true;
    if (authorize) await pool.request().input("id", sql.Int, savedRuleId)
      .query("UPDATE dbo.CrmReminderRule SET LastPreviewedAt = SYSDATETIME() WHERE Id = @id");
    if (authorize) await audit(pool, { ruleId: savedRuleId, action: "Previewed", detail: `${preview.toSend} delivery(s) currently due`, by: actorId(req) });
    res.json(preview);
  } catch (e) { fail(res, e, "POST /check"); }
});

// Send a failed or not-sent reminder again (from the log).
router.post("/log/:id/resend", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const out = await resendLog(id);
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, ...out.result });
  } catch (e) { fail(res, e, "POST /log/:id/resend"); }
});

// ── Paused bookings ──────────────────────────────────────────────────────────────────────────────────────────────
router.get("/pauses", requireAnyPageRight(BOOKING_PAGES, "view"), async (req, res) => {
  try {
    const bookingId = req.query.bookingId ? parseInt(req.query.bookingId, 10) : null;
    const r = await withBiz(getPool().request()).input("bid", sql.Int, Number.isInteger(bookingId) ? bookingId : null).query(`
      SELECT p.*, b.BookingNo, a.ApplicantName, r.Name AS RuleName, pu.name AS PausedByName, eu.name AS EndedByName,
             CAST(CASE WHEN p.EndedAt IS NULL AND (p.PausedUntil IS NULL OR p.PausedUntil >= @today) THEN 1 ELSE 0 END AS BIT) AS IsLive
      FROM dbo.CrmReminderPause p
      JOIN dbo.CrmBooking b ON b.Id = p.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmReminderRule r ON r.Id = p.RuleId
      LEFT JOIN dbo.users pu ON pu.id = p.PausedBy LEFT JOIN dbo.users eu ON eu.id = p.EndedBy
      WHERE (@bid IS NULL OR p.BookingId = @bid)${projectPredicate(req.projectScope, "b.ProjectId")}
      ORDER BY IsLive DESC, p.PausedAt DESC`);
    res.json({ rows: r.recordset });
  } catch (e) { fail(res, e, "GET /pauses"); }
});

// Live bookings to pause, by booking no. or customer name.
router.get("/bookings", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const r = await getPool().request().input("q", sql.NVarChar(100), `%${q.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`).query(`
      SELECT TOP 20 b.Id, b.BookingNo, a.ApplicantName, b.ProjectName, b.UnitNo
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.IsActive = 1 AND b.Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}
        AND (b.BookingNo LIKE @q ESCAPE '\\' OR a.ApplicantName LIKE @q ESCAPE '\\')${projectPredicate(req.projectScope, "b.ProjectId")}
      ORDER BY b.BookingDate DESC`);
    res.json({ rows: r.recordset });
  } catch (e) { fail(res, e, "GET /bookings"); }
});

router.post("/pauses", requireAnyPageRight(BOOKING_PAGES, "edit"), async (req, res) => {
  const b = req.body || {};
  const bookingId = parseId(String(b.BookingId ?? ""));
  const ruleId = b.RuleId ? parseId(String(b.RuleId)) : null;
  const reason = String(b.Reason || "").trim();
  if (bookingId === null) return res.status(400).json({ error: "Choose the booking." });
  if (!reason) return res.status(400).json({ error: "Say why the reminders are paused." });
  if (b.PausedUntil && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.PausedUntil))) return res.status(400).json({ error: "Invalid date" });
  try {
    if (!(await assertBookingAllowed(req, res, bookingId))) return;
    // A rule-specific pause must belong to the same project as the booking
    // (or be a deliberately all-project rule).  Otherwise a stale/selectable
    // rule id could make a pause that will never affect the booking.
    if (ruleId != null) {
      const owner = await getPool().request().input("rule", sql.Int, ruleId).input("booking", sql.Int, bookingId).query(`
        SELECT r.Id FROM dbo.CrmReminderRule r
        JOIN dbo.CrmBooking b ON b.Id = @booking
        WHERE r.Id = @rule AND (r.ProjectId IS NULL OR r.ProjectId = b.ProjectId)`);
      if (!owner.recordset.length) return res.status(400).json({ error: "Choose a reminder for this booking's project." });
    }
    const r = await getPool().request().input("bid", sql.Int, bookingId).input("rule", sql.Int, ruleId).input("why", sql.NVarChar(500), reason.slice(0, 500))
      .input("until", sql.Date, b.PausedUntil || null).input("by", sql.Int, actorId(req))
      .query(`INSERT INTO dbo.CrmReminderPause (BookingId, RuleId, Reason, PausedUntil, PausedBy) OUTPUT INSERTED.Id
              SELECT @bid, @rule, @why, @until, @by WHERE EXISTS (SELECT 1 FROM dbo.CrmBooking WHERE Id = @bid)`);
    if (!r.recordset.length) return res.status(404).json({ error: "Booking not found" });
    await audit(getPool(), { ruleId, bookingId, action: "Paused", detail: reason.slice(0, 500), by: actorId(req) });
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) { fail(res, e, "POST /pauses"); }
});

router.put("/pauses/:id/end", requireAnyPageRight(BOOKING_PAGES, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("id", sql.Int, id).input("by", sql.Int, actorId(req))
      .query("UPDATE dbo.CrmReminderPause SET EndedAt = SYSDATETIME(), EndedBy = @by OUTPUT INSERTED.BookingId, INSERTED.RuleId WHERE Id = @id AND EndedAt IS NULL");
    if (!r.recordset.length) return res.status(400).json({ error: "This pause has already ended." });
    await audit(getPool(), { ruleId: r.recordset[0].RuleId, bookingId: r.recordset[0].BookingId, action: "Resumed", by: actorId(req) });
    res.json({ success: true });
  } catch (e) { fail(res, e, "PUT /pauses/:id/end"); }
});

module.exports = router;
