// End-to-end test of CRM Reminder Setup: the real routes, engine and SQL on the DEVELOPMENT database, inside one
// transaction that is rolled back. Phones and SMS / WhatsApp / e-mail are replaced by recorders, so no customer is
// ever messaged.   node scripts/e2eReminders.js
const path = require("path");
process.chdir(path.join(__dirname, ".."));
// Recorders, put in place before anything that sends is loaded (the engine and communicationTriggers keep references).
const sentPush = [], sentText = [];
const push = require("../services/pushNotifications");
push.sendToBookingCustomers = async (bookingId, message) => { sentPush.push({ bookingId, message }); return { sent: 1, failed: 0 }; };
const providers = require("../services/messageProviders");
providers.send = async (channel, message) => { sentText.push({ channel, ...message }); return { ok: true, id: "e2e" }; };

const { openHarness } = require("./e2eHarness");
const COUNT = `SELECT (SELECT COUNT(*) FROM dbo.CrmReminderRule) R, (SELECT COUNT(*) FROM dbo.CrmReminderLog) L,
  (SELECT COUNT(*) FROM dbo.CrmReminderPause) P, (SELECT COUNT(*) FROM dbo.CrmCommunicationLog) C`;
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

(async () => {
  const h = await openHarness({ mounts: { "/r": "crmReminders" }, count: COUNT });
  const { call, q, check, expectCall, section } = h;
  const previewAndEnable = async (id) => {
    const preview = await call("POST", "/r/check", { ruleId: id, authorize: true });
    if (preview.status !== 200) return preview;
    return call("PATCH", `/r/rules/${id}/active`, { IsActive: true });
  };
  const engine = require("../services/crmReminderEngine");
  try {
    const me = (await q("SELECT TOP 1 id FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY id"))[0].id;
    h.setActor({ userId: me, id: me });

    section("What the setup offers");
    const sit = (await call("GET", "/r/situations")).json;
    check("Three situations, each with its starts and fields", sit.situations.length === 3 && sit.situations.every((s) => s.starts.length && s.fields.includes("CustomerName")));
    const opts = (await call("GET", "/r/options")).json;
    check("Roles, users and projects come from the database", opts.roles.length > 0 && opts.users.length > 0 && Array.isArray(opts.projects));
    const rules0 = (await call("GET", "/r/rules")).json.rules;
    check("The two starting rules are there (on or off, as set on the page)", rules0.some((r) => r.Situation === "instalmentDue") && rules0.some((r) => r.Situation === "bookingPayment"));

    section("Rules are checked before they are saved");
    const base = { Name: "E2E agreement", Situation: "agreementPending", StartFrom: "BookingDate", OffsetDays: 0, RepeatEveryDays: 5, MaxTimes: 2,
      NotifyBookingOwner: true, IsActive: true, Recipients: [{ Stage: "Remind", UserId: me }],
      Channels: [{ Audience: "Staff", Channel: "Bell", Title: "Agreement pending", Body: "{CustomerName} · {BookingNo} — no agreement {DaysSinceStart} days after booking." },
        { Audience: "Customer", Channel: "Portal", Title: "Your agreement", Body: "{Project} {Unit}: please complete your agreement." },
        { Audience: "Customer", Channel: "App", Title: "Your agreement", Body: "{Project} {Unit}: please complete your agreement." },
        { Audience: "Customer", Channel: "SMS", Body: "Dear {CustomerName}, your agreement for {BookingNo} is pending." }] };
    expectCall("A name is needed", await call("POST", "/r/rules", { ...base, Name: " " }), 400, "name");
    expectCall("The start must suit the situation", await call("POST", "/r/rules", { ...base, StartFrom: "DueDate" }), 400, "counts from");
    expectCall("A field the situation doesn't fill is refused", await call("POST", "/r/rules", { ...base, Channels: [{ Audience: "Customer", Channel: "SMS", Body: "Pay {Amount}" }] }), 400, "{Amount}");
    expectCall("A staff reminder needs someone to tell", await call("POST", "/r/rules", { ...base, NotifyBookingOwner: false, Recipients: [] }), 400, "someone to tell");
    expectCall("A customer channel can't be Bell", await call("POST", "/r/rules", { ...base, Channels: [{ Audience: "Customer", Channel: "Bell", Body: "x" }] }), 400, "not a customer channel");
    expectCall("A WhatsApp template needs its language", await call("POST", "/r/rules", { ...base, Channels: [{ Audience: "Customer", Channel: "WhatsApp", Body: "x", TemplateName: "pay_reminder" }] }), 400, "language");
    expectCall("Escalation needs a day and someone", await call("POST", "/r/rules", { ...base, Recipients: [...base.Recipients, { Stage: "Escalate", UserId: me }] }), 400, "when to escalate");
    expectCall("At least one channel on", await call("POST", "/r/rules", { ...base, Channels: [{ ...base.Channels[0], IsActive: false }] }), 400, "at least one channel");

    section("Save and read back");
    // The escalation goes to a role that has active users on this database (the Director role, if it has any).
    const director = opts.roles.find((r) => /director/i.test(r.name) && opts.users.some((u) => u.role === r.name));
    const created = await call("POST", "/r/rules", { ...base, EscalateAfterDays: 10, Recipients: [...base.Recipients, ...(director ? [{ Stage: "Escalate", RoleId: director.id }] : [{ Stage: "Escalate", UserId: me }])] });
    check("Created", created.status === 201, `${created.status} ${created.json?.error}`);
    const ruleId = created.json.id;
    const saved = (await call("GET", "/r/rules")).json.rules.find((r) => r.Id === ruleId);
    check("Its channels and recipients are stored", saved.Channels.length === 4 && saved.Recipients.length === 2 && saved.SituationLabel === "Agreement not signed");
    expectCall("A new plan cannot be enabled before preview", await call("PATCH", `/r/rules/${ruleId}/active`, { IsActive: true }), 409, "Check");
    expectCall("Preview then enable the saved plan", await previewAndEnable(ruleId), 200);
    const auditTrail = await call("GET", `/r/rules/${ruleId}/history`);
    check("The plan change history records create, preview and enable", auditTrail.status === 200 && ["Created", "Previewed", "Enabled"].every((a) => auditTrail.json.rows.some((x) => x.Action === a)), JSON.stringify(auditTrail.json?.rows));
    const createdAudit = auditTrail.json.rows.find((x) => x.Action === "Created");
    const restored = await call("POST", `/r/rules/${ruleId}/restore/${createdAudit.Id}`);
    const restoredRule = (await call("GET", "/r/rules")).json.rules.find((r) => r.Id === ruleId);
    check("Restore returns the saved plan safely switched off", restored.status === 200 && !restoredRule.IsActive, `${restored.status} ${JSON.stringify(restored.json)}`);
    expectCall("A restored plan is previewed before it is enabled", await previewAndEnable(ruleId), 200);

    section("The engine sends what is due, once");
    const pending = await engine.SITUATIONS.agreementPending.pending(h.request ? { request: h.request } : null, { ProjectId: null }, { stages: new Map() });
    check("Bookings without an executed agreement are pending", pending.length > 0, "no such booking on dev");
    const target = pending[0];
    const start = new Date(target.starts.BookingDate);
    const logOf = async (extra = "") => q(`SELECT * FROM dbo.CrmReminderLog WHERE RuleId = ${ruleId} AND BookingId = ${target.bookingId} ${extra}`);
    await engine.runReminders({ today: addDays(start, 3), ruleId });
    let log = await logOf();
    check("Day 3: the first reminder went to staff, the portal, the app and SMS", ["Bell", "Portal", "App", "SMS"].every((c) => log.some((l) => l.Channel === c && l.Occurrence === 1 && l.Status === "Sent")), JSON.stringify(log.map((l) => [l.Channel, l.Status, l.Detail])));
    const sms = sentText.find((m) => m.channel === "sms" && m.text.includes(target.facts.BookingNo));
    check("The SMS carries the wording with the fields filled", sms && !/\{\w+\}/.test(sms.text) && sms.text.includes(target.facts.CustomerName || ""), sms?.text);
    check("Customer messages are logged on the booking's timeline", (await q(`SELECT COUNT(*) N FROM dbo.CrmCommunicationLog WHERE BookingId = ${target.bookingId} AND Summary LIKE N'Reminder: E2E agreement%'`))[0].N >= 1);
    const n1 = log.length;
    await engine.runReminders({ today: addDays(start, 3), ruleId });
    await engine.runReminders({ today: addDays(start, 4), ruleId });
    check("Running again the same cycle sends nothing more", (await logOf()).length === n1);
    await engine.runReminders({ today: addDays(start, 5), ruleId });
    log = await logOf();
    check("Day 5: the second reminder", log.some((l) => l.Occurrence === 2 && l.Stage === "Remind"));
    const n2 = log.length;
    await engine.runReminders({ today: addDays(start, 10), ruleId });
    log = await logOf();
    check("Day 10: no third reminder (at most 2)", !log.some((l) => l.Occurrence === 3));
    check("Day 10: the escalation went to staff only", log.some((l) => l.Stage === "Escalate") && log.filter((l) => l.Stage === "Escalate").every((l) => l.Audience === "Staff"), `${log.length - n2} new`);

    section("Send hours, check first, send again");
    check("The setup says which message channels are set up", ["SMS", "WhatsApp", "Email"].every((c) => typeof sit.ready?.[c]?.ready === "boolean"), JSON.stringify(sit.ready));
    expectCall("Send hours must be times", await call("POST", "/r/rules", { ...base, SendFrom: "25:00" }), 400, "Send hours");
    expectCall("Send hours can't start and end together", await call("POST", "/r/rules", { ...base, SendFrom: "10:00", SendUntil: "10:00" }), 400, "same time");
    const hrs = await call("POST", "/r/rules", { ...base, Name: "E2E hours", RepeatEveryDays: 1, MaxTimes: null, SendFrom: "10:00", SendUntil: "19:00" });
    check("Saved with send hours", hrs.status === 201, `${hrs.status} ${hrs.json?.error}`);
    const hrsId = hrs.json.id;
    const hrsRule = (await call("GET", "/r/rules")).json.rules.find((r) => r.Id === hrsId);
    check("Send hours read back", hrsRule.SendFrom === "10:00" && hrsRule.SendUntil === "19:00", `${hrsRule.SendFrom}-${hrsRule.SendUntil}`);
    const hrsLog = async () => (await q(`SELECT COUNT(*) N FROM dbo.CrmReminderLog WHERE RuleId = ${hrsId}`))[0].N;
    const viaRoute = await call("POST", "/r/check", { ruleId: hrsId });
    check("Check (saved rule) answers and sends nothing", viaRoute.status === 200 && Number.isInteger(viaRoute.json.toSend) && (await hrsLog()) === 0, JSON.stringify(viaRoute.json).slice(0, 200));
    expectCall("A plain check (the plan card) does not unlock switching on", await call("PATCH", `/r/rules/${hrsId}/active`, { IsActive: true }), 409, "Check");
    check("…and writes no history", !(await q(`SELECT 1 x FROM dbo.CrmReminderAudit WHERE RuleId = ${hrsId} AND Action = N'Previewed'`)).length);
    expectCall("The switch-on check authorizes it", await previewAndEnable(hrsId), 200);
    const typed = await call("POST", "/r/check", { ...base, Name: "Typed, not saved" });
    check("Check (as typed in the dialog) answers and saves nothing", typed.status === 200 && Number.isInteger(typed.json.pending), JSON.stringify(typed.json).slice(0, 200));
    // Times of day in India: 02:00 UTC = 07:30 (before the hours), 06:00 UTC = 11:30 (inside).
    const at = (d, utc) => new Date(`${addDays(start, d).toISOString().slice(0, 10)}T${utc}:00Z`);
    const early = await engine.runReminders({ today: at(3, "02:00"), ruleId: hrsId });
    check("Before the send hours nothing goes out", (await hrsLog()) === 0 && early[0]?.outsideHours === true, JSON.stringify(early));
    const [ruleRow] = await q(`SELECT * FROM dbo.CrmReminderRule WHERE Id = ${hrsId}`);
    const rcp = await q(`SELECT * FROM dbo.CrmReminderRecipient WHERE RuleId = ${hrsId}`);
    const chs = await q(`SELECT * FROM dbo.CrmReminderChannel WHERE RuleId = ${hrsId}`);
    const plan = await engine.checkRule(ruleRow, rcp, chs, { today: at(3, "06:00") });
    check("Check shows what will go and its wording", plan.toSend > 0 && plan.withinHours && plan.samples.every((x) => !/\{\w+\}/.test(x.body)), JSON.stringify(plan).slice(0, 300));
    await engine.runReminders({ today: at(3, "06:00"), ruleId: hrsId });
    check("Inside the hours the run sends exactly what the check counted", (await hrsLog()) === plan.toSend, `${await hrsLog()} vs ${plan.toSend}`);
    const plan2 = await engine.checkRule(ruleRow, rcp, chs, { today: at(3, "06:00") });
    check("Checked again: nothing more to send, all already sent", plan2.toSend === 0 && plan2.alreadySent === plan.toSend);

    const [smsRow] = await q(`SELECT TOP 1 Id FROM dbo.CrmReminderLog WHERE RuleId = ${hrsId} AND Channel = N'SMS' ORDER BY Id`);
    expectCall("A sent reminder can't be sent again", await call("POST", `/r/log/${smsRow.Id}/resend`), 400, "failed or not-sent");
    await q(`UPDATE dbo.CrmReminderLog SET Status = N'Failed', Detail = N'E2E provider down' WHERE Id = ${smsRow.Id}`);
    const textsBefore = sentText.length;
    const resent = await call("POST", `/r/log/${smsRow.Id}/resend`);
    const [afterResend] = await q(`SELECT Status, Attempts, Detail FROM dbo.CrmReminderLog WHERE Id = ${smsRow.Id}`);
    check("Send again: a failed SMS goes out and is counted as a second attempt", resent.status === 200 && afterResend.Status === "Sent" && afterResend.Attempts === 2 && !afterResend.Detail && sentText.length === textsBefore + 1, JSON.stringify({ resent: resent.json, afterResend }));

    await q(`UPDATE dbo.CrmReminderLog SET Status = N'Pending', SentAt = DATEADD(HOUR, -3, SYSDATETIME()) WHERE Id = ${smsRow.Id}`);
    await engine.runReminders({ today: at(3, "02:00"), ruleId: hrsId });
    check("A send interrupted mid-way is marked failed (so it can be sent again)", (await q(`SELECT Status FROM dbo.CrmReminderLog WHERE Id = ${smsRow.Id}`))[0].Status === "Failed");
    await q(`UPDATE dbo.CrmReminderLog SET SentAt = SYSDATETIME() WHERE RuleId = ${hrsId}`);
    const today = (await call("GET", "/r/daily?days=1")).json;
    check("Day-wise counts are by the business day", today.today && today.rows.some((r) => r.RuleId === hrsId && String(r.Day).slice(0, 10) === today.today), JSON.stringify({ t: today.today, d: today.rows.filter((r) => r.RuleId === hrsId).map((r) => r.Day) }));
    expectCall("Switch the hours rule off", await call("PATCH", `/r/rules/${hrsId}/active`, { IsActive: false }), 200);

    section("Pause, resolve and switch off");
    const paused = await call("POST", "/r/pauses", { BookingId: target.bookingId, Reason: "E2E: payment arrangement" });
    check("Pause the booking", paused.status === 201, `${paused.status} ${paused.json?.error}`);
    expectCall("A pause needs a reason", await call("POST", "/r/pauses", { BookingId: target.bookingId }), 400, "why");
    const again = await call("POST", "/r/rules", { ...base, Name: "E2E daily", RepeatEveryDays: 1, MaxTimes: null });
    expectCall("Preview then enable the daily plan", await previewAndEnable(again.json.id), 200);
    await engine.runReminders({ today: addDays(start, 20), ruleId: again.json.id });
    check("A paused booking gets nothing", !(await q(`SELECT 1 x FROM dbo.CrmReminderLog WHERE RuleId = ${again.json.id} AND BookingId = ${target.bookingId}`)).length);
    expectCall("End the pause", await call("PUT", `/r/pauses/${paused.json.id}/end`), 200);
    expectCall("Ending it twice is refused", await call("PUT", `/r/pauses/${paused.json.id}/end`), 400);
    await engine.runReminders({ today: addDays(start, 20), ruleId: again.json.id });
    check("Resumed, it is reminded", (await q(`SELECT 1 x FROM dbo.CrmReminderLog WHERE RuleId = ${again.json.id} AND BookingId = ${target.bookingId}`)).length > 0);

    await q(`INSERT INTO dbo.CrmAgreement (AgreementNo, BookingId, Status, CreatedAt) VALUES (N'E2E-AG', ${target.bookingId}, N'Executed', SYSDATETIME())`);
    await engine.runReminders({ today: addDays(start, 21), ruleId });
    check("Once the agreement is executed, its open reminders are cleared", (await logOf("AND ClearedAt IS NULL")).length === 0);

    expectCall("Switch the rule off", await call("PATCH", `/r/rules/${again.json.id}/active`, { IsActive: false }), 200);
    const before = (await q(`SELECT COUNT(*) N FROM dbo.CrmReminderLog WHERE RuleId = ${again.json.id}`))[0].N;
    await engine.runReminders({ today: addDays(start, 30) });
    check("A rule that is off sends nothing", (await q(`SELECT COUNT(*) N FROM dbo.CrmReminderLog WHERE RuleId = ${again.json.id}`))[0].N === before);

    section("The booking reminder: from 7 days after booking, every day, numbered");
    // A ZZTEST booking whose first instalment is made to need money (inside the rolled-back transaction).
    const [zz] = await q(`SELECT TOP 1 b.Id, b.BookingNo, b.BookingDate,
        (SELECT TOP 1 m.Id FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND m.ExtraChargeId IS NULL AND m.ParkingAllotmentId IS NULL ORDER BY m.MilestoneNo) AS FirstId
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE a.ApplicantName LIKE N'ZZTEST%' AND b.IsActive = 1 AND b.Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}
        AND EXISTS (SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id)
      ORDER BY b.Id DESC`);
    check("A ZZTEST booking to test with", !!zz?.FirstId, "no live ZZTEST booking with instalments on dev");
    await q(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue + 100000000, Status = N'Pending' WHERE Id = ${zz.FirstId}`);
    const directorRole = opts.roles.find((r) => /director/i.test(r.name));
    const other = opts.users.find((u) => u.id !== me) || { id: me };
    const mainBody = { Name: "E2E booking 7 days", Situation: "bookingPayment", StartFrom: "BookingDate", OffsetDays: 7, RepeatEveryDays: 1, MaxTimes: null,
      NotifyBookingOwner: false, IsActive: true,
      Recipients: [...(directorRole ? [{ Stage: "Remind", RoleId: directorRole.id }] : []), { Stage: "Remind", UserId: me }, { Stage: "Remind", UserId: other.id }],
      Channels: [{ Audience: "Staff", Channel: "Bell", Title: "Booking payment pending", Body: "Reminder {ReminderNo}: {CustomerName} · {BookingNo} — {Amount} not received {DaysSinceStart} days after booking." },
        { Audience: "Customer", Channel: "App", Title: "Your booking payment is pending", Body: "{Amount} for {Project} {Unit} ({BookingNo}) is still to be paid." },
        { Audience: "Customer", Channel: "Portal", Title: "Your booking payment is pending", Body: "{Amount} for {Project} {Unit} ({BookingNo}) is still to be paid." }] };
    const main = await call("POST", "/r/rules", mainBody);
    check("The booking plan is saved, off until checked", main.status === 201 && main.json.requiresPreview === true, `${main.status} ${main.json?.error}`);
    const mainId = main.json.id;
    expectCall("Checked, then switched on", await previewAndEnable(mainId), 200);
    const mainLog = async (extra = "") => q(`SELECT * FROM dbo.CrmReminderLog WHERE RuleId = ${mainId} AND BookingId = ${zz.Id} ${extra} ORDER BY Id`);
    const bDay = (n) => { const d = addDays(zz.BookingDate, n); d.setUTCHours(6, 0, 0, 0); return d; }; // 11:30 in India
    await engine.runReminders({ today: bDay(6), ruleId: mainId });
    check("Day 6 after booking: nothing yet", (await mainLog()).length === 0);
    await engine.runReminders({ today: bDay(7), ruleId: mainId });
    let ml = await mainLog();
    const staffIds = new Set(ml.filter((l) => l.Channel === "Bell").map((l) => l.Recipient));
    check("Day 7: Reminder 1 to the chosen users (and the Director role's users)", ml.every((l) => l.Occurrence === 1) && staffIds.has(`user:${me}`) && staffIds.has(`user:${other.id}`), JSON.stringify([...staffIds]));
    check("Day 7: the customer gets it in the app and the portal", ["App", "Portal"].every((c) => ml.some((l) => l.Channel === c && l.Audience === "Customer" && l.Occurrence === 1)));
    check("The staff message carries its number", ml.filter((l) => l.Channel === "Bell").every((l) => l.Body.startsWith("Reminder 1:")), ml[0]?.Body);
    await engine.runReminders({ today: bDay(7), ruleId: mainId });
    check("Day 7 again: not sent twice", (await mainLog()).length === ml.length);
    await engine.runReminders({ today: bDay(8), ruleId: mainId });
    await engine.runReminders({ today: bDay(9), ruleId: mainId });
    ml = await mainLog();
    check("Days 8 and 9: Reminder 2 and Reminder 3, one a day", ml.some((l) => l.Occurrence === 2) && ml.some((l) => l.Occurrence === 3) && !ml.some((l) => l.Occurrence > 3)
      && ml.filter((l) => l.Channel === "Bell" && l.Occurrence === 3).every((l) => l.Body.startsWith("Reminder 3:")));
    await q(`UPDATE dbo.CrmReminderLog SET SentAt = SYSDATETIME() WHERE RuleId = ${mainId} AND Occurrence = 3`);
    const live = (await call("GET", `/r/live?ruleId=${mainId}`)).json;
    const row = live.rows?.find((x) => x.BookingId === zz.Id);
    check("Bookings being reminded: its reminder number (3), all 3 counted, sent today", row && row.ReminderNo === 3 && row.RemindersSent === 3 && row.SentToday === true, JSON.stringify(row));
    const own = (await call("GET", `/r/live?bookingId=${zz.Id}`)).json.rows || [];
    check("On the booking's payments page: only its own reminders, with the number", own.length > 0 && own.every((x) => x.BookingId === zz.Id) && own.some((x) => x.RuleId === mainId && x.ReminderNo === 3));
    const bp2 = await call("POST", "/r/pauses", { BookingId: zz.Id, Reason: "E2E: paused from the booking" });
    const ownPauses = (await call("GET", `/r/pauses?bookingId=${zz.Id}`)).json.rows || [];
    check("Paused from the booking, and its pause is listed there", bp2.status === 201 && ownPauses.length > 0 && ownPauses.every((p) => p.BookingId === zz.Id) && ownPauses.some((p) => p.IsLive));
    await engine.runReminders({ today: bDay(10), ruleId: mainId });
    check("While paused: no Reminder 4", !(await mainLog("AND Occurrence = 4")).length);
    expectCall("Resume from the booking", await call("PUT", `/r/pauses/${bp2.json.id}/end`), 200);
    check("Resuming is in the history", (await q(`SELECT COUNT(*) N FROM dbo.CrmReminderAudit WHERE BookingId = ${zz.Id} AND Action = N'Resumed'`))[0].N > 0);
    const dailyMain = (await call("GET", "/r/daily?days=400")).json.rows.filter((r) => r.RuleId === mainId);
    check("Day by day counts every reminder", dailyMain.reduce((a, r) => a + r.Sent, 0) === ml.filter((l) => l.Status === "Sent").length, JSON.stringify(dailyMain));
    await q(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue - 100000000 WHERE Id = ${zz.FirstId}`);
    await engine.runReminders({ today: bDay(10), ruleId: mainId });
    check("Paid (back to as it was): no Reminder 4, and its reminders are cleared", !(await mainLog("AND Occurrence = 4")).length && !(await mainLog("AND ClearedAt IS NULL")).length);
    check("…and it leaves the list", !((await call("GET", `/r/live?ruleId=${mainId}`)).json.rows || []).some((x) => x.BookingId === zz.Id));

    section("Payment milestones overdue: one reminder per booking");
    const ms = await q(`SELECT TOP 3 Id, MilestoneNo, MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = ${zz.Id} AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL ORDER BY MilestoneNo, Id`);
    const isoDay = (n) => addDays(zz.BookingDate, n).toISOString().slice(0, 10);
    // The first two overdue and unpaid (due 10 and 20 days after booking), the third due far ahead.
    await q(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue + 100000000, Status = N'Pending', DueDate = '${isoDay(10)}' WHERE Id = ${ms[0].Id}`);
    await q(`UPDATE dbo.CrmPaymentMilestone SET Status = N'Pending', DueDate = '${isoDay(20)}' WHERE Id = ${ms[1].Id}`);
    await q(`UPDATE dbo.CrmPaymentMilestone SET Status = N'Pending', DueDate = '${isoDay(400)}' WHERE Id = ${ms[2].Id}`);
    const od = await call("POST", "/r/rules", { Name: "E2E overdue per booking", Situation: "instalmentDue", StartFrom: "DueDate", OffsetDays: 1, RepeatEveryDays: 1,
      NotifyBookingOwner: false, IsActive: true, Recipients: [{ Stage: "Remind", UserId: me }],
      Channels: [{ Audience: "Staff", Channel: "Bell", Title: "Payment Overdue", Body: "Reminder {ReminderNo}: {BookingNo} — {Milestone} overdue ({Amount} pending, {MilestoneCount})" }] });
    check("Saved", od.status === 201, `${od.status} ${od.json?.error}`);
    expectCall("Checked and switched on", await previewAndEnable(od.json.id), 200);
    const odLog = async (extra = "") => q(`SELECT * FROM dbo.CrmReminderLog WHERE RuleId = ${od.json.id} AND BookingId = ${zz.Id} ${extra} ORDER BY Id`);
    await engine.runReminders({ today: bDay(30), ruleId: od.json.id });
    let ol = await odLog();
    check("Two payment milestones overdue: ONE bell for the booking, naming both", ol.length === 1 && ol[0].Body.includes(ms[0].MilestoneName) && ol[0].Body.includes(ms[1].MilestoneName) && /, 2\)$/.test(ol[0].Body), JSON.stringify(ol.map((l) => l.Body)));
    check("…numbered from the oldest (due day 10, reminded from day 11: day 30 = Reminder 20)", ol[0].Occurrence === 20 && ol[0].Body.startsWith("Reminder 20:"), ol[0]?.Body);
    check("…not the one due far ahead", !ol[0].Body.includes(ms[2].MilestoneName) || ms[2].MilestoneName === ms[0].MilestoneName || ms[2].MilestoneName === ms[1].MilestoneName);
    await engine.runReminders({ today: bDay(30), ruleId: od.json.id });
    check("Same day again: nothing more", (await odLog()).length === 1);
    await q(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue - 100000000 WHERE Id = ${ms[0].Id}`);
    await engine.runReminders({ today: bDay(31), ruleId: od.json.id });
    ol = await odLog();
    const next = ol.filter((l) => l.EntityKey === `milestones:${zz.Id}:${ms[1].Id}`);
    check("The oldest paid: the next one counts on its own (due day 20 → day 31 = Reminder 11), the old one cleared",
      next.length === 1 && next[0].Occurrence === 11 && ol.filter((l) => l.EntityKey !== next[0].EntityKey).every((l) => l.ClearedAt), JSON.stringify(ol.map((l) => [l.EntityKey, l.Occurrence, !!l.ClearedAt])));

    section("Saved changes need a fresh check before going live");
    expectCall("Edit the live plan", await call("PUT", `/r/rules/${mainId}`, { ...mainBody, RepeatEveryDays: 2 }), 200);
    check("After an edit it is off until checked again", (await q(`SELECT IsActive FROM dbo.CrmReminderRule WHERE Id = ${mainId}`))[0].IsActive === false);
    expectCall("Switching on without a new check is refused", await call("PATCH", `/r/rules/${mainId}/active`, { IsActive: true }), 409, "Check");
    const hist = (await call("GET", `/r/rules/${mainId}/history`)).json.rows || [];
    check("The history records create, check, switch-on and edit", ["Created", "Previewed", "Enabled", "Updated"].every((a) => hist.some((x) => x.Action === a)), JSON.stringify(hist.map((x) => x.Action)));

    section("Payments read the money stages");
    const bp = await engine.SITUATIONS.bookingPayment.pending({ request: h.request }, { ProjectId: null }, { stages: new Map() });
    const ok = [];
    for (const r of bp.slice(0, 10)) {
      const { milestones } = await require("../services/crmOnAccountCoverage").getMilestoneMoneyStages({ request: h.request }, r.bookingId);
      const m = milestones.find((x) => `milestone:${x.Id}` === r.key);
      const due = require("../services/crmOnAccountCoverage").milestoneDue(m);
      ok.push(!due.Covered && !due.Verifying && due.Outstanding > 0);
    }
    check("Every booking-payment reminder is for money still to pay", ok.every(Boolean), JSON.stringify(ok));

    section("Day-wise counts and the log");
    const daily = (await call("GET", "/r/daily?days=400")).json;
    check("Counts per day, rule and channel", daily.rows.some((r) => r.RuleId === ruleId && r.Sent > 0));
    const logPage = (await call("GET", `/r/log?ruleId=${ruleId}&pageSize=5`)).json;
    check("The send log pages with a total", logPage.rows.length <= 5 && logPage.total >= logPage.rows.length && logPage.rows[0].RuleName === "E2E agreement");
    expectCall("An unknown rule", await call("PUT", "/r/rules/999999", base), 404);
  } catch (e) {
    check("Script ran to the end", false, e.stack);
  }
  await h.finish();
})().catch((e) => { console.error("Stopped:", e.stack); process.exit(1); });
