"use strict";

/**
 * The Civilier Security app's visitor approval: a guard asks a flat whether to let a visitor in; the flat's residents
 * approve or deny; the first decision settles it.
 *
 *   createVisitorRequest   guard -> request at the guard's current gate, for a flat with active residents. The phone sets
 *                          ClientRequestId, so a request queued offline and sent again is stored once.
 *   decideVisitorRequest   a resident approves / denies. Every decision is kept (with device); only the first settles.
 *   markNoResponse         the guard closes a request nobody answered.
 *   sweepVisitorRequests   every 15 s: after ESCALATE_S with no answer the other residents are told; after EXPIRE_S the
 *                          request ends as NO_RESPONSE and an UNANSWERED alert is raised.
 * Residents are told by push on their Security app (customer-portal sign-in); the guard is told over the socket
 * (room user:<id>, event "security:visitor") and by push.
 */
const { sql } = require("../db");
const logger = require("../logger");
const { sendToTokens, sendToUsers, isExpoPushToken } = require("./pushNotifications");
const { VISITOR_SELECT, guardAssignmentNow } = require("./securityDashboard");
const { toCustomers } = require("./securitySocket");

const APP_KEY = "security-intercom";
const ESCALATE_S = 60;
const EXPIRE_S = 180;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const flatOf = (block, flat) => (block ? `${block}-${flat}` : flat);

/** The photo from the phone (base64, optionally a data: URL): JPEG or PNG only, by its bytes, at most 3 MB. */
function decodePhoto(raw) {
  if (raw == null || raw === "") return null;
  const b64 = String(raw).replace(/^data:image\/[a-z]+;base64,/i, "");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw fail(400, "The photo couldn't be read.");
  if (buf.length > MAX_PHOTO_BYTES) throw fail(400, "The photo is too large (3 MB at most).");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { data: buf, type: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { data: buf, type: "image/png" };
  throw fail(400, "The photo must be a JPEG or PNG.");
}

async function residentsOf(pool, projectId, block, flatNo) {
  return (
    await pool.request().input("p", sql.Int, projectId).input("b", sql.NVarChar(50), block || "").input("f", sql.NVarChar(50), flatNo).query(`
      SELECT r.ResidentId, r.CustomerId, r.IsPrimary, c.CustomerName AS name, c.Mobile AS mobile
      FROM dbo.SecurityResident r LEFT JOIN dbo.CrmCustomer c ON c.Id = r.CustomerId
      WHERE r.ProjectId = @p AND r.Block = @b AND r.FlatNo = @f AND r.IsActive = 1
      ORDER BY r.IsPrimary DESC, c.CustomerName`)
  ).recordset;
}

/** Who is told first: the primary residents when the flat also has members (they are told on escalation); else all. */
function firstWave(residents) {
  const primary = residents.filter((r) => r.IsPrimary);
  return primary.length && primary.length < residents.length ? primary : residents;
}

/** Push to these customers' phones signed in to the Security app. Best-effort, never throws. */
async function pushResidents(pool, customerIds, message) {
  try {
    const ids = [...new Set(customerIds.map(Number).filter(Number.isInteger))];
    if (!ids.length) return;
    // Ids are integers (checked above), so inlining them is injection-safe.
    const r = await pool.request().input("app", sql.NVarChar(50), APP_KEY).query(`
      SELECT DISTINCT t.Token FROM dbo.PushDeviceToken t JOIN dbo.CrmCustomerPortalUser pu ON pu.Id = t.PortalUserId
      WHERE pu.IsActive = 1 AND t.AppKey = @app AND pu.CustomerId IN (${ids.join(",")})`);
    await sendToTokens(r.recordset.map((x) => x.Token).filter(isExpoPushToken), message);
  } catch (err) {
    logger.warn({ err: err.message }, "[security] resident push failed");
  }
}

/** The guard's screen updates at once (socket), and their phone is told if the app is in the background (push). */
function tellGuard(guardUserId, payload, push) {
  try {
    const { getIo } = require("../socket");
    getIo()?.to(`user:${guardUserId}`).emit("security:visitor", payload);
  } catch {
    /* no socket server (tests, scripts) */
  }
  if (push) void sendToUsers([guardUserId], { ...push, data: { type: "security-visitor", requestId: payload.requestId } }, { apps: [APP_KEY] });
}

const visitorPush = (row, lead) => ({
  title: `${lead} at ${row.gateName}`,
  body: `${row.visitorName || "A visitor"} · ${row.reason} for flat ${flatOf(row.block, row.flat)}. Tap to approve or deny.`,
  data: { type: "security-visitor", requestId: row.id },
});

async function loadRequest(pool, requestId) {
  return (await pool.request().input("top", sql.Int, 1).input("id", sql.Int, requestId).query(`${VISITOR_SELECT} WHERE r.RequestId = @id`)).recordset[0] || null;
}

async function createVisitorRequest(pool, guardUserId, body = {}) {
  const clientRequestId = clean(body.clientRequestId, 36);
  if (!UUID_RE.test(clientRequestId)) throw fail(400, "Missing request id. Update the app.");

  const existing = (
    await pool.request().input("c", sql.UniqueIdentifier, clientRequestId).query(`SELECT RequestId, GuardUserId FROM dbo.SecurityVisitorRequest WHERE ClientRequestId = @c`)
  ).recordset[0];
  if (existing) {
    if (existing.GuardUserId !== guardUserId) throw fail(409, "That request id is already used.");
    return { created: false, request: await loadRequest(pool, existing.RequestId) };
  }

  const cur = await guardAssignmentNow(pool, guardUserId);
  if (!cur) throw fail(409, "You have no gate assignment today. Ask your supervisor to assign you to a gate.");
  const phone = clean(body.visitorPhone, 20).replace(/[^\d+]/g, "");
  const photo = decodePhoto(body.photoBase64);

  // A guest pass (code typed, or the guest picked from today's list): the flat and the visitor come from the pass, and
  // the request is approved at once on the resident's behalf.
  const passCode = clean(body.passCode, 6).replace(/\D/g, "");
  const wantsPass = !!passCode || !!body.passId;
  const pass = wantsPass ? await usablePass(pool, cur.projectId, { code: passCode || null, id: Number(body.passId) || null }) : null;
  if (wantsPass && !pass) throw fail(409, "That pass isn't valid now (wrong code, expired, cancelled or used up).");

  const block = pass ? pass.Block : clean(body.block, 50);
  const flatNo = pass ? pass.FlatNo : clean(body.flatNo, 50);
  const reason = pass ? clean(body.reason, 200) || "Guest (pass)" : clean(body.reason, 200);
  if (!flatNo) throw fail(400, "Choose the flat.");
  if (!reason) throw fail(400, "Choose or type the reason for the visit.");

  const residents = await residentsOf(pool, cur.projectId, block, flatNo);
  if (!residents.length) throw fail(409, `No resident is registered for flat ${flatOf(block, flatNo)}. Call the flat or the office.`);

  let requestId;
  const tx = pool.transaction();
  await tx.begin();
  try {
    if (pass) {
      const used = await tx.request().input("id", sql.Int, pass.PassId).query(`
        UPDATE dbo.SecurityGuestPass SET Uses = Uses + 1
        WHERE PassId = @id AND Uses < MaxUses AND CancelledAt IS NULL AND SYSUTCDATETIME() BETWEEN ValidFrom AND ValidTo`);
      if (!used.rowsAffected[0]) throw fail(409, "That pass was just used up.");
    }
    requestId = (
      await tx.request().input("c", sql.UniqueIdentifier, clientRequestId).input("g", sql.Int, cur.gateId).input("p", sql.Int, cur.projectId)
        .input("b", sql.NVarChar(50), block).input("f", sql.NVarChar(50), flatNo).input("u", sql.Int, guardUserId).input("hp", sql.Bit, !!photo)
        .input("r", sql.NVarChar(200), reason).input("vn", sql.NVarChar(150), clean(body.visitorName, 150) || pass?.GuestName || null)
        .input("vp", sql.NVarChar(20), phone || pass?.GuestPhone || null).input("vv", sql.NVarChar(30), clean(body.vehicleNo, 30).toUpperCase() || pass?.VehicleNo || null)
        .input("pass", sql.Int, pass?.PassId ?? null).input("pc", sql.Int, pass?.CustomerId ?? null).query(`
          INSERT INTO dbo.SecurityVisitorRequest (ClientRequestId, GateId, ProjectId, Block, FlatNo, GuardUserId, HasPhoto, Reason, VisitorName, VisitorPhone, VehicleNo,
                                                  PassId, Status, DecidedAt, DecidedByCustomerId)
          OUTPUT INSERTED.RequestId AS id
          VALUES (@c, @g, @p, @b, @f, @u, @hp, @r, @vn, @vp, @vv, @pass,
                  CASE WHEN @pass IS NULL THEN N'PENDING' ELSE N'APPROVED' END,
                  CASE WHEN @pass IS NULL THEN NULL ELSE SYSUTCDATETIME() END, @pc)`)
    ).recordset[0].id;
    if (photo) {
      await tx.request().input("id", sql.Int, requestId).input("t", sql.NVarChar(30), photo.type).input("d", sql.VarBinary(sql.MAX), photo.data)
        .query(`INSERT INTO dbo.SecurityVisitorPhoto (RequestId, ContentType, Data) VALUES (@id, @t, @d)`);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    // The same request sent twice at once: the second insert hits the unique id; answer with the first.
    if (err.number === 2627 || err.number === 2601) {
      const again = (await pool.request().input("c", sql.UniqueIdentifier, clientRequestId).query(`SELECT RequestId FROM dbo.SecurityVisitorRequest WHERE ClientRequestId = @c`)).recordset[0];
      if (again) return { created: false, request: await loadRequest(pool, again.RequestId) };
    }
    throw err;
  }

  const request = await loadRequest(pool, requestId);
  if (pass) {
    toCustomers([pass.CustomerId], "security:visitor", { requestId, status: request.status });
    void pushResidents(pool, [pass.CustomerId], {
      title: `Your guest is here · flat ${flatOf(block, flatNo)}`,
      body: `${request.visitorName || "Your guest"} came in at ${request.gateName} on your pass.`,
      data: { type: "security-visitor", requestId },
    });
  } else {
    const first = firstWave(residents).map((r) => r.CustomerId);
    toCustomers(first, "security:visitor", { requestId, status: "PENDING" });
    void pushResidents(pool, first, visitorPush(request, "Visitor"));
  }
  return { created: true, request };
}

// ── Guest passes ───────────────────────────────────────────────────────────────────────────────────────────────
/** A pass at this project that can be used now, by its code or id. */
async function usablePass(pool, projectId, { code, id }) {
  return (
    (
      await pool.request().input("p", sql.Int, projectId).input("c", sql.Char(6), code).input("id", sql.Int, id).query(`
        SELECT TOP 1 PassId, Block, FlatNo, CustomerId, GuestName, GuestPhone, VehicleNo
        FROM dbo.SecurityGuestPass
        WHERE ProjectId = @p AND CancelledAt IS NULL AND Uses < MaxUses AND SYSUTCDATETIME() BETWEEN ValidFrom AND ValidTo
          AND ((@c IS NOT NULL AND Code = @c) OR (@id IS NOT NULL AND PassId = @id))`)
    ).recordset[0] || null
  );
}

/** The guard's list: passes valid now at the guard's project (no phone numbers). */
async function expectedGuests(pool, guardUserId) {
  const cur = await guardAssignmentNow(pool, guardUserId);
  if (!cur) return [];
  return (
    await pool.request().input("p", sql.Int, cur.projectId).query(`
      SELECT PassId AS id, NULLIF(Block, N'') AS block, FlatNo AS flat, GuestName AS guestName, VehicleNo AS vehicleNo, Note AS note,
             ValidTo AS validTo, MaxUses - Uses AS usesLeft
      FROM dbo.SecurityGuestPass
      WHERE ProjectId = @p AND CancelledAt IS NULL AND Uses < MaxUses AND SYSUTCDATETIME() BETWEEN ValidFrom AND ValidTo
      ORDER BY Block, FlatNo, GuestName`)
  ).recordset;
}

/** The resident's passes (still usable first, then the last 30 days). */
async function myPasses(pool, customerId) {
  return (
    await pool.request().input("c", sql.Int, customerId).query(`
      SELECT p.PassId AS id, NULLIF(p.Block, N'') AS block, p.FlatNo AS flat, p.GuestName AS guestName, p.GuestPhone AS guestPhone,
             p.VehicleNo AS vehicleNo, p.Note AS note, p.Code AS code, p.ValidFrom AS validFrom, p.ValidTo AS validTo,
             p.MaxUses AS maxUses, p.Uses AS uses, p.CancelledAt AS cancelledAt,
             CASE WHEN p.CancelledAt IS NULL AND p.Uses < p.MaxUses AND SYSUTCDATETIME() <= p.ValidTo THEN 1 ELSE 0 END AS active
      FROM dbo.SecurityGuestPass p
      WHERE p.CustomerId = @c AND p.CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME())
      ORDER BY active DESC, p.ValidFrom DESC`)
  ).recordset.map((r) => ({ ...r, active: !!r.active }));
}

async function createPass(pool, customerId, body = {}) {
  const residentId = Number(body.residentId);
  const res = (
    await pool.request().input("r", sql.Int, residentId).input("c", sql.Int, customerId).query(`
      SELECT ProjectId, Block, FlatNo FROM dbo.SecurityResident WHERE ResidentId = @r AND CustomerId = @c AND IsActive = 1`)
  ).recordset[0];
  if (!res) throw fail(404, "Choose one of your flats.");
  const guestName = clean(body.guestName, 150);
  if (!guestName) throw fail(400, "Enter the guest's name.");
  const from = body.validFrom ? new Date(body.validFrom) : new Date();
  const to = new Date(body.validTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw fail(400, "Choose when the pass starts and ends.");
  if (to - from > 31 * 86400000) throw fail(400, "A pass can last 31 days at most.");
  if (to < new Date()) throw fail(400, "The pass would already be over.");
  const maxUses = Math.min(50, Math.max(1, Math.round(Number(body.maxUses) || 1)));

  // A 6-digit code no other pass at this project is using now.
  let code = "";
  for (let i = 0; i < 20 && !code; i++) {
    const c = String(require("crypto").randomInt(0, 1000000)).padStart(6, "0");
    const clash = (
      await pool.request().input("p", sql.Int, res.ProjectId).input("c", sql.Char(6), c).query(`
        SELECT TOP 1 1 AS x FROM dbo.SecurityGuestPass WHERE ProjectId = @p AND Code = @c AND CancelledAt IS NULL AND ValidTo > SYSUTCDATETIME()`)
    ).recordset[0];
    if (!clash) code = c;
  }
  if (!code) throw fail(503, "Couldn't make a pass code. Try again.");
  const id = (
    await pool.request().input("p", sql.Int, res.ProjectId).input("b", sql.NVarChar(50), res.Block).input("f", sql.NVarChar(50), res.FlatNo)
      .input("c", sql.Int, customerId).input("n", sql.NVarChar(150), guestName).input("ph", sql.NVarChar(20), clean(body.guestPhone, 20).replace(/[^\d+]/g, "") || null)
      .input("v", sql.NVarChar(30), clean(body.vehicleNo, 30).toUpperCase() || null).input("note", sql.NVarChar(200), clean(body.note, 200) || null)
      .input("code", sql.Char(6), code).input("vf", sql.DateTime2, from).input("vt", sql.DateTime2, to).input("m", sql.Int, maxUses).query(`
        INSERT INTO dbo.SecurityGuestPass (ProjectId, Block, FlatNo, CustomerId, GuestName, GuestPhone, VehicleNo, Note, Code, ValidFrom, ValidTo, MaxUses)
        OUTPUT INSERTED.PassId AS id VALUES (@p, @b, @f, @c, @n, @ph, @v, @note, @code, @vf, @vt, @m)`)
  ).recordset[0].id;
  return { id, code };
}

async function cancelPass(pool, customerId, passId) {
  const r = await pool.request().input("id", sql.Int, passId).input("c", sql.Int, customerId).query(`
    UPDATE dbo.SecurityGuestPass SET CancelledAt = SYSUTCDATETIME() WHERE PassId = @id AND CustomerId = @c AND CancelledAt IS NULL`);
  if (!r.rowsAffected[0]) throw fail(404, "Pass not found or already cancelled.");
  return { success: true };
}

/** A resident's decision. Returns { settled, request }: settled false when someone else had already handled it. */
async function decideVisitorRequest(pool, customerId, requestId, decision, { deviceId = null, platform = null } = {}) {
  const d = String(decision || "").toUpperCase();
  if (d !== "APPROVE" && d !== "DENY") throw fail(400, "Decision must be approve or deny.");
  const mine = (
    await pool.request().input("id", sql.Int, requestId).input("c", sql.Int, customerId).query(`
      SELECT TOP 1 res.ResidentId, r.GuardUserId
      FROM dbo.SecurityVisitorRequest r
      JOIN dbo.SecurityResident res ON res.ProjectId = r.ProjectId AND res.Block = r.Block AND res.FlatNo = r.FlatNo AND res.IsActive = 1 AND res.CustomerId = @c
      WHERE r.RequestId = @id`)
  ).recordset[0];
  if (!mine) throw fail(404, "Visitor request not found.");

  let settled = false;
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("id", sql.Int, requestId).input("c", sql.Int, customerId).input("s", sql.NVarChar(20), d === "APPROVE" ? "APPROVED" : "DENIED").query(`
      UPDATE dbo.SecurityVisitorRequest SET Status = @s, DecidedAt = SYSUTCDATETIME(), DecidedByCustomerId = @c
      WHERE RequestId = @id AND Status = N'PENDING'`);
    settled = upd.rowsAffected[0] > 0;
    await tx.request().input("id", sql.Int, requestId).input("r", sql.Int, mine.ResidentId).input("c", sql.Int, customerId).input("d", sql.NVarChar(10), d)
      .input("st", sql.Bit, settled).input("dev", sql.NVarChar(100), clean(deviceId, 100) || null).input("pl", sql.NVarChar(20), clean(platform, 20) || null).query(`
        INSERT INTO dbo.SecurityVisitorDecision (RequestId, ResidentId, CustomerId, Decision, Settled, DeviceId, Platform) VALUES (@id, @r, @c, @d, @st, @dev, @pl)`);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  const request = await loadRequest(pool, requestId);
  if (settled) {
    const all = await residentsOf(pool, request.projectId, request.block || "", request.flat);
    toCustomers(all.map((r) => r.CustomerId), "security:visitor", { requestId, status: request.status, decidedBy: request.decidedBy });
    const ok = request.status === "APPROVED";
    tellGuard(mine.GuardUserId, { requestId, status: request.status, decidedBy: request.decidedBy }, {
      title: ok ? `Approved · flat ${flatOf(request.block, request.flat)}` : `Denied · flat ${flatOf(request.block, request.flat)}`,
      body: `${request.visitorName || "Visitor"} · ${request.reason}${request.decidedBy ? ` — ${request.decidedBy}` : ""}`,
    });
  }
  return { settled, request };
}

async function raiseUnanswered(pool, row) {
  const detail = `No answer from flat ${flatOf(row.Block, row.FlatNo)}`;
  const id = (
    await pool.request().input("p", sql.Int, row.ProjectId).input("g", sql.Int, row.GuardUserId).input("r", sql.Int, row.RequestId)
      .input("d", sql.NVarChar(500), detail).query(`
        INSERT INTO dbo.SecurityAlert (Type, ProjectId, GuardUserId, RequestId, Detail) OUTPUT INSERTED.AlertId AS id VALUES (N'UNANSWERED', @p, @g, @r, @d)`)
  ).recordset[0]?.id;
  // The security admins hear of it like any other alert.
  void require("./securityTracking").securityAdminIds(pool)
    .then((ids) => sendToUsers(ids, { title: "Request unanswered", body: detail, data: { type: "security-alert", alertId: id } }, { apps: [APP_KEY] }))
    .catch(() => {});
}

/** The guard (who raised it, or the guard now at that gate) closes a request nobody answered. */
async function markNoResponse(pool, guardUserId, requestId) {
  const row = (
    await pool.request().input("id", sql.Int, requestId).input("u", sql.Int, guardUserId).query(`
      UPDATE dbo.SecurityVisitorRequest SET Status = N'NO_RESPONSE', NoResponseBy = N'GUARD', DecidedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.RequestId, INSERTED.ProjectId, INSERTED.GuardUserId, INSERTED.Block, INSERTED.FlatNo
      WHERE RequestId = @id AND Status = N'PENDING'`)
  ).recordset[0];
  if (row) {
    await raiseUnanswered(pool, row);
    const all = await residentsOf(pool, row.ProjectId, row.Block, row.FlatNo);
    toCustomers(all.map((r) => r.CustomerId), "security:visitor", { requestId, status: "NO_RESPONSE" });
  }
  return { closed: !!row, request: await loadRequest(pool, requestId) };
}

async function sweepVisitorRequests(pool) {
  const escalated = (
    await pool.request().input("s", sql.Int, ESCALATE_S).query(`
      UPDATE dbo.SecurityVisitorRequest SET EscalatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.RequestId, INSERTED.ProjectId, INSERTED.Block, INSERTED.FlatNo, INSERTED.GuardUserId
      WHERE Status = N'PENDING' AND EscalatedAt IS NULL AND RequestedAt <= DATEADD(SECOND, -@s, SYSUTCDATETIME())`)
  ).recordset;
  for (const e of escalated) {
    const residents = await residentsOf(pool, e.ProjectId, e.Block, e.FlatNo);
    const first = new Set(firstWave(residents).map((r) => r.CustomerId));
    const next = residents.filter((r) => !first.has(r.CustomerId));
    const row = await loadRequest(pool, e.RequestId);
    toCustomers((next.length ? next : residents).map((r) => r.CustomerId), "security:visitor", { requestId: e.RequestId, status: "PENDING", escalated: true });
    // The members who weren't told yet; when everyone was told at first, a reminder to all of them.
    void pushResidents(pool, (next.length ? next : residents).map((r) => r.CustomerId), visitorPush(row, next.length ? "Visitor" : "Still waiting: visitor"));
    tellGuard(e.GuardUserId, { requestId: e.RequestId, status: "PENDING", escalated: true });
  }

  const expired = (
    await pool.request().input("s", sql.Int, EXPIRE_S).query(`
      UPDATE dbo.SecurityVisitorRequest SET Status = N'NO_RESPONSE', NoResponseBy = N'TIMEOUT', DecidedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.RequestId, INSERTED.ProjectId, INSERTED.GuardUserId, INSERTED.Block, INSERTED.FlatNo
      WHERE Status = N'PENDING' AND RequestedAt <= DATEADD(SECOND, -@s, SYSUTCDATETIME())`)
  ).recordset;
  for (const x of expired) {
    await raiseUnanswered(pool, x);
    const all = await residentsOf(pool, x.ProjectId, x.Block, x.FlatNo);
    toCustomers(all.map((r) => r.CustomerId), "security:visitor", { requestId: x.RequestId, status: "NO_RESPONSE" });
    tellGuard(x.GuardUserId, { requestId: x.RequestId, status: "NO_RESPONSE" }, { title: `No answer · flat ${flatOf(x.Block, x.FlatNo)}`, body: "Nobody answered the visitor request." });
  }
  return { escalated: escalated.length, expired: expired.length };
}

let timer = null;
function startVisitorSweepEngine() {
  if (timer) return;
  timer = setInterval(() => {
    const { getPool } = require("../db");
    require("./securityCalls").sweepCalls(getPool()).catch(() => {});
    sweepVisitorRequests(getPool()).catch((e) => e.number !== 208 && logger.error({ event: "SECURITY_VISITOR_SWEEP_FAILED", err: e.message }, "Visitor request sweep failed"));
  }, 15 * 1000);
}

module.exports = {
  expectedGuests,
  myPasses,
  createPass,
  cancelPass,
  ESCALATE_S,
  EXPIRE_S,
  residentsOf,
  loadRequest,
  createVisitorRequest,
  decideVisitorRequest,
  markNoResponse,
  sweepVisitorRequests,
  startVisitorSweepEngine,
};
