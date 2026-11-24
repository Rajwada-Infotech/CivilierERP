"use strict";

/**
 * In-app voice calls for the Civilier Security app (doc phase 4), through LiveKit Cloud.
 *
 *   guard -> resident   from a visitor request: one of that flat's active residents
 *   resident -> gate    the guard on duty now at a gate of the resident's project
 *
 * The server only records the call (dbo.SecurityCallSession) and hands each side a short-lived LiveKit token for the
 * call's room; the voice itself goes through LiveKit. The callee is rung by a high-priority push on the "calls"
 * channel (and, for staff, over the socket too); a call nobody answers in RING_S seconds becomes MISSED.
 * Configure LIVEKIT_URL (wss://…), LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the server's .env; without them every
 * call is refused with "calling isn't set up" and the app offers the phone dialler instead.
 */
const crypto = require("crypto");
const { sql } = require("../db");
const { sendToTokens, sendToUsers, isExpoPushToken } = require("./pushNotifications");
const { onDutyGuards } = require("./securityDashboard");
const { toCustomers } = require("./securitySocket");

const RING_S = 45;
const APP_KEY = "security-intercom";
const fail = (status, message) => Object.assign(new Error(message), { status });

const configured = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

/** A token that lets this person into this call's room for 2 hours (audio only). */
async function tokenFor(party, name, room) {
  const { AccessToken } = require("livekit-server-sdk");
  const t = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: `${party.kind}-${party.id}`, name: name || undefined, ttl: 2 * 60 * 60 });
  t.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return t.toJwt();
}

async function nameOf(pool, party) {
  const q =
    party.kind === "STAFF"
      ? `SELECT name AS n FROM dbo.users WHERE id = @id`
      : `SELECT CustomerName AS n FROM dbo.CrmCustomer WHERE Id = @id`;
  return (await pool.request().input("id", sql.Int, party.id).query(q)).recordset[0]?.n || null;
}

/** Ring the callee: socket for staff, high-priority push on the "calls" channel for both. Best-effort. */
async function ring(pool, call, callerName) {
  const message = {
    title: "Incoming call",
    body: `${callerName || "Someone"} is calling${call.GateName ? ` from ${call.GateName}` : ""}.`,
    data: { type: "security-call", callId: call.CallId },
    channelId: "calls",
    ttl: RING_S,
  };
  try {
    if (call.CalleeKind === "STAFF") {
      try {
        require("../socket").getIo()?.to(`user:${call.CalleeId}`).emit("security:call", { callId: call.CallId, status: "RINGING", from: callerName });
      } catch {
        /* no socket server */
      }
      await sendToUsers([call.CalleeId], message, { apps: [APP_KEY] });
    } else {
      toCustomers([call.CalleeId], "security:call", { callId: call.CallId, status: "RINGING", from: callerName });
      const r = await pool.request().input("c", sql.Int, call.CalleeId).input("app", sql.NVarChar(50), APP_KEY).query(`
        SELECT DISTINCT t.Token FROM dbo.PushDeviceToken t JOIN dbo.CrmCustomerPortalUser pu ON pu.Id = t.PortalUserId
        WHERE pu.IsActive = 1 AND pu.CustomerId = @c AND t.AppKey = @app`);
      await sendToTokens(r.recordset.map((x) => x.Token).filter(isExpoPushToken), message);
    }
  } catch {
    /* the callee's app also polls for incoming calls */
  }
}

/** Tells both sides (over the socket) that the call changed: staff in user:<id>, residents in customer:<id>. */
function tellStaff(call, status) {
  try {
    const io = require("../socket").getIo();
    for (const [kind, id] of [[call.CallerKind, call.CallerId], [call.CalleeKind, call.CalleeId]]) {
      if (kind === "STAFF") io?.to(`user:${id}`).emit("security:call", { callId: call.CallId, status });
      else toCustomers([id], "security:call", { callId: call.CallId, status });
    }
  } catch {
    /* no socket server */
  }
}

async function createCall(pool, caller, callee, { requestId = null, gateId = null } = {}) {
  if (!configured()) throw fail(503, "In-app calling isn't set up on this server yet. Use the phone instead.");
  const room = `sec-${crypto.randomBytes(9).toString("hex")}`;
  const row = (
    await pool.request().input("ck", sql.NVarChar(10), caller.kind).input("ci", sql.Int, caller.id).input("ek", sql.NVarChar(10), callee.kind)
      .input("ei", sql.Int, callee.id).input("r", sql.Int, requestId).input("g", sql.Int, gateId).input("room", sql.NVarChar(64), room).query(`
        INSERT INTO dbo.SecurityCallSession (CallerKind, CallerId, CalleeKind, CalleeId, RequestId, GateId, RoomName)
        OUTPUT INSERTED.CallId, INSERTED.CallerKind, INSERTED.CallerId, INSERTED.CalleeKind, INSERTED.CalleeId, INSERTED.RoomName
        VALUES (@ck, @ci, @ek, @ei, @r, @g, @room)`)
  ).recordset[0];
  const [callerName, calleeName, gateName] = await Promise.all([
    nameOf(pool, caller),
    nameOf(pool, callee),
    gateId ? pool.request().input("g", sql.Int, gateId).query(`SELECT Name AS n FROM dbo.SecurityGate WHERE GateId = @g`).then((r) => r.recordset[0]?.n || null) : null,
  ]);
  void ring(pool, { ...row, GateName: gateName }, callerName);
  return { callId: row.CallId, status: "RINGING", url: process.env.LIVEKIT_URL, token: await tokenFor(caller, callerName, room), calleeName, ringSeconds: RING_S };
}

/** Guard -> a resident of the request's flat (the guard who raised it, or the guard now at its gate). */
async function guardCallsResident(pool, guardUserId, requestId, customerId) {
  const ok = (
    await pool.request().input("r", sql.Int, requestId).input("c", sql.Int, customerId).query(`
      SELECT TOP 1 1 AS x FROM dbo.SecurityVisitorRequest v
      JOIN dbo.SecurityResident res ON res.ProjectId = v.ProjectId AND res.Block = v.Block AND res.FlatNo = v.FlatNo AND res.IsActive = 1
      WHERE v.RequestId = @r AND res.CustomerId = @c`)
  ).recordset[0];
  if (!ok) throw fail(404, "That resident isn't on this request's flat.");
  return createCall(pool, { kind: "STAFF", id: guardUserId }, { kind: "CUSTOMER", id: customerId }, { requestId });
}

/** The gates of the resident's projects, with whether a guard is on duty there now. */
async function gatesForResident(pool, customerId) {
  const gates = (
    await pool.request().input("c", sql.Int, customerId).query(`
      SELECT DISTINCT g.GateId AS id, g.Name AS name, g.ProjectId AS projectId, ISNULL(e.name, N'') AS projectName
      FROM dbo.SecurityResident r JOIN dbo.SecurityGate g ON g.ProjectId = r.ProjectId AND g.IsActive = 1
      LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
      WHERE r.CustomerId = @c AND r.IsActive = 1`)
  ).recordset;
  const onDuty = await onDutyGuards(pool);
  return gates.map((g) => ({ ...g, guardOnDuty: onDuty.some((o) => o.gateId === g.id) }));
}

/** Resident -> the guard on duty at that gate now. */
async function residentCallsGate(pool, customerId, gateId) {
  const gates = await gatesForResident(pool, customerId);
  if (!gates.some((g) => g.id === gateId)) throw fail(404, "That gate isn't at your project.");
  const guard = (await onDutyGuards(pool)).find((o) => o.gateId === gateId);
  if (!guard) throw fail(409, "No guard is on duty at that gate right now.");
  return createCall(pool, { kind: "CUSTOMER", id: customerId }, { kind: "STAFF", id: guard.guardUserId }, { gateId });
}

async function loadCall(pool, callId, party) {
  const c = (
    await pool.request().input("id", sql.BigInt, callId).query(`
      SELECT CallId, CallerKind, CallerId, CalleeKind, CalleeId, Status, StartedAt, AnsweredAt, EndedAt, DurationSec, RoomName, RequestId, GateId
      FROM dbo.SecurityCallSession WHERE CallId = @id`)
  ).recordset[0];
  if (!c) throw fail(404, "Call not found.");
  const isCaller = c.CallerKind === party.kind && c.CallerId === party.id;
  const isCallee = c.CalleeKind === party.kind && c.CalleeId === party.id;
  if (!isCaller && !isCallee) throw fail(404, "Call not found.");
  return { c, isCaller, isCallee };
}

async function describe(pool, c, party) {
  const other = c.CallerKind === party.kind && c.CallerId === party.id ? { kind: c.CalleeKind, id: c.CalleeId } : { kind: c.CallerKind, id: c.CallerId };
  return {
    callId: c.CallId,
    status: c.Status,
    startedAt: c.StartedAt,
    answeredAt: c.AnsweredAt,
    durationSec: c.DurationSec,
    incoming: !(c.CallerKind === party.kind && c.CallerId === party.id),
    otherName: await nameOf(pool, other),
    requestId: c.RequestId,
  };
}

async function getCall(pool, party, callId) {
  const { c } = await loadCall(pool, callId, party);
  return describe(pool, c, party);
}

/** The callee picks up: ANSWERED, and their token for the room. */
async function answerCall(pool, party, callId) {
  if (!configured()) throw fail(503, "In-app calling isn't set up on this server yet.");
  const { c, isCallee } = await loadCall(pool, callId, party);
  if (!isCallee) throw fail(403, "Only the person called can answer.");
  const r = await pool.request().input("id", sql.BigInt, callId).input("s", sql.Int, RING_S).query(`
    UPDATE dbo.SecurityCallSession SET Status = N'ANSWERED', AnsweredAt = SYSUTCDATETIME()
    WHERE CallId = @id AND Status = N'RINGING' AND StartedAt > DATEADD(SECOND, -@s, SYSUTCDATETIME())`);
  if (!r.rowsAffected[0]) throw fail(409, "The call has ended.");
  tellStaff(c, "ANSWERED");
  return { ...(await getCall(pool, party, callId)), url: process.env.LIVEKIT_URL, token: await tokenFor(party, await nameOf(pool, party), c.RoomName) };
}

/** Decline (callee, while ringing) or hang up (either side): MISSED / DECLINED before an answer, ENDED after. */
async function endCall(pool, party, callId, { decline = false } = {}) {
  const { c, isCallee } = await loadCall(pool, callId, party);
  const r = await pool.request().input("id", sql.BigInt, callId).input("d", sql.Bit, decline && isCallee).query(`
    UPDATE dbo.SecurityCallSession SET
      Status = CASE WHEN Status = N'ANSWERED' THEN N'ENDED' WHEN @d = 1 THEN N'DECLINED' ELSE N'MISSED' END,
      EndedAt = SYSUTCDATETIME(),
      DurationSec = CASE WHEN Status = N'ANSWERED' THEN DATEDIFF(SECOND, AnsweredAt, SYSUTCDATETIME()) ELSE NULL END
    OUTPUT INSERTED.Status
    WHERE CallId = @id AND Status IN (N'RINGING', N'ANSWERED')`);
  if (r.recordset[0]) tellStaff(c, r.recordset[0].Status);
  return getCall(pool, party, callId);
}

/** A call ringing for this person now (the app's fallback when the push or socket didn't arrive). */
async function incomingFor(pool, party) {
  const c = (
    await pool.request().input("k", sql.NVarChar(10), party.kind).input("i", sql.Int, party.id).input("s", sql.Int, RING_S).query(`
      SELECT TOP 1 CallId, CallerKind, CallerId, CalleeKind, CalleeId, Status, StartedAt, AnsweredAt, DurationSec, RequestId
      FROM dbo.SecurityCallSession
      WHERE CalleeKind = @k AND CalleeId = @i AND Status = N'RINGING' AND StartedAt > DATEADD(SECOND, -@s, SYSUTCDATETIME())
      ORDER BY StartedAt DESC`)
  ).recordset[0];
  return c ? describe(pool, c, party) : null;
}

/** Rings nobody answered become MISSED (run from the visitor sweep). */
async function sweepCalls(pool) {
  const r = await pool.request().input("s", sql.Int, RING_S).query(`
    UPDATE dbo.SecurityCallSession SET Status = N'MISSED', EndedAt = SYSUTCDATETIME()
    OUTPUT INSERTED.CallId, INSERTED.CallerKind, INSERTED.CallerId, INSERTED.CalleeKind, INSERTED.CalleeId
    WHERE Status = N'RINGING' AND StartedAt <= DATEADD(SECOND, -@s, SYSUTCDATETIME())`);
  for (const c of r.recordset) tellStaff(c, "MISSED");
  return r.recordset.length;
}

module.exports = { RING_S, configured, guardCallsResident, residentCallsGate, gatesForResident, getCall, answerCall, endCall, incomingFor, sweepCalls };
