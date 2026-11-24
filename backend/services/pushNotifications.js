/**
 * pushNotifications.js — phone push notifications through Expo's push service.
 *
 * Devices register an Expo push token (POST /api/push-devices/register). Sending
 * is "tell Expo to deliver this to these tokens"; Expo forwards it to Google's
 * FCM (Android) / Apple's APNs. Everything here is best-effort and NEVER throws:
 * a push failing must not fail the approval, reminder run, or request that
 * triggered it.
 *
 * Tokens Expo reports as dead (DeviceNotRegistered — app uninstalled, token
 * rotated) are deleted so the table doesn't grow stale rows forever.
 *
 * Each phone also reports its installed build (Android version code), so a new
 * build published in APK Manager can be announced to just the phones still on an
 * older one (sendAppUpdate).
 */
"use strict";

const { getPool, sql } = require("../db");
const logger = require("../logger");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100; // Expo's per-request limit
const TOKEN_RE = /^(Exponent|Expo)PushToken\[[^\]\s]+\]$/;

const isExpoPushToken = (t) => typeof t === "string" && t.length <= 200 && TOKEN_RE.test(t);

/**
 * Who a phone token belongs to: a staff user id (a number), or a customer portal login ({ portalUserId },
 * dbo.CrmCustomerPortalUser — migration 692). Exactly one of the two is set on the row.
 */
function ownerOf(owner) {
  if (owner && typeof owner === "object") return { userId: null, portalUserId: Number.isInteger(owner.portalUserId) ? owner.portalUserId : null };
  return { userId: Number.isInteger(owner) ? owner : null, portalUserId: null };
}

/** Insert, or re-point an existing token at this owner (a handed-over phone). Records the installed build too. */
async function registerToken(owner, token, { appKey = null, platform = null, versionCode = null } = {}) {
  const { userId, portalUserId } = ownerOf(owner);
  if ((userId == null && portalUserId == null) || !isExpoPushToken(token)) {
    const err = new Error("A valid user and Expo push token are required.");
    err.status = 400;
    throw err;
  }
  await getPool()
    .request()
    .input("uid", sql.Int, userId)
    .input("puid", sql.Int, portalUserId)
    .input("token", sql.NVarChar(200), token)
    .input("app", sql.NVarChar(50), appKey ? String(appKey).slice(0, 50) : null)
    .input("plat", sql.NVarChar(20), platform ? String(platform).slice(0, 20) : null)
    .input("vc", sql.Int, Number.isInteger(Number(versionCode)) && Number(versionCode) > 0 ? Number(versionCode) : null)
    .query(`
      MERGE dbo.PushDeviceToken AS t
      USING (SELECT @token AS Token) AS s ON t.Token = s.Token
      WHEN MATCHED THEN
        UPDATE SET UserId = @uid, PortalUserId = @puid, AppKey = @app, Platform = @plat, AppVersionCode = @vc, LastSeenAt = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (UserId, PortalUserId, Token, AppKey, Platform, AppVersionCode) VALUES (@uid, @puid, @token, @app, @plat, @vc);
    `);
}

/** Remove a token on logout. Scoped to its owner so one person can't unregister another's phone. */
async function unregisterToken(owner, token) {
  const { userId, portalUserId } = ownerOf(owner);
  if ((userId == null && portalUserId == null) || typeof token !== "string") return 0;
  const r = await getPool()
    .request()
    .input("uid", sql.Int, userId)
    .input("puid", sql.Int, portalUserId)
    .input("token", sql.NVarChar(200), token)
    .query(`DELETE FROM dbo.PushDeviceToken WHERE Token = @token AND ${userId != null ? "UserId = @uid" : "PortalUserId = @puid"}`);
  return r.rowsAffected?.[0] ?? 0;
}

/**
 * `apps` (optional) limits delivery to those apps' devices, so a person logged
 * into several Civilier apps isn't pinged on every one. A token with no app
 * recorded is always eligible.
 */
async function tokensForUsers(userIds, apps = null) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const req = getPool().request();
  let appFilter = "";
  const appKeys = Array.isArray(apps) ? apps.map(String).filter(Boolean) : [];
  if (appKeys.length) {
    const ph = appKeys.map((a, i) => {
      req.input(`a${i}`, sql.NVarChar(50), a);
      return `@a${i}`;
    });
    appFilter = ` AND (AppKey IS NULL OR AppKey IN (${ph.join(",")}))`;
  }
  // Ids are integers (validated above), so inlining them is injection-safe.
  const r = await req.query(`SELECT Token FROM dbo.PushDeviceToken WHERE UserId IN (${ids.join(",")})${appFilter}`);
  return r.recordset.map((row) => row.Token).filter(isExpoPushToken);
}

async function dropTokens(tokens) {
  if (!tokens.length) return;
  try {
    const req = getPool().request();
    const names = tokens.map((t, i) => {
      req.input(`t${i}`, sql.NVarChar(200), t);
      return `@t${i}`;
    });
    await req.query(`DELETE FROM dbo.PushDeviceToken WHERE Token IN (${names.join(",")})`);
  } catch (err) {
    logger.warn({ err: err.message }, "[push] could not drop dead tokens");
  }
}

/** Delivers one message to these tokens in Expo-sized batches; drops tokens Expo reports as dead. Never throws. */
/** `channelId`: the Android channel (default "default"; "calls" rings for an incoming call). `ttl` seconds before Expo drops it. */
async function sendToTokens(tokens, { title, body, data, channelId, ttl } = {}) {
  const result = { sent: 0, failed: 0 };
  if (!title || !tokens.length) return result;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const dead = [];
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const messages = batch.map((to) => ({
      to,
      title: String(title).slice(0, 120),
      body: body ? String(body).slice(0, 240) : undefined,
      data: data || {},
      sound: "default",
      priority: "high",
      channelId: channelId || "default",
      ...(ttl ? { ttl } : {}),
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
      if (!res.ok) {
        result.failed += batch.length;
        logger.warn({ status: res.status }, "[push] Expo push request rejected");
        continue;
      }
      const json = await res.json().catch(() => ({}));
      (json.data || []).forEach((ticket, idx) => {
        if (ticket?.status === "ok") result.sent += 1;
        else {
          result.failed += 1;
          if (ticket?.details?.error === "DeviceNotRegistered") dead.push(batch[idx]);
        }
      });
    } catch (err) {
      result.failed += batch.length;
      logger.warn({ err: err.message }, "[push] Expo push request failed");
    }
  }
  await dropTokens(dead);
  return result;
}

/**
 * @param {number[]} userIds   recipients (duplicates / invalid ids ignored)
 * @param {{title:string, body?:string, data?:object}} message
 * @param {{apps?: string[]}} [opts]  only deliver to these apps' devices
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function sendToUsers(userIds, message = {}, { apps = null } = {}) {
  try {
    if (!message.title) return { sent: 0, failed: 0 };
    return await sendToTokens(await tokensForUsers(userIds, apps), message);
  } catch (err) {
    logger.warn({ err: err.message }, "[push] sendToUsers failed");
    return { sent: 0, failed: 0 };
  }
}

/**
 * Tells the customers of a booking — the main applicant and the joint applicants (co-applicants with a customer
 * record) — on the phones signed in to their Customer Portal. `message.data` gains the booking's application, so
 * a tap opens that property. Best-effort and never throws, like every send here.
 */
async function sendToBookingCustomers(bookingId, message = {}) {
  try {
    const id = Number(bookingId);
    if (!message.title || !Number.isInteger(id)) return { sent: 0, failed: 0 };
    const r = await getPool().request().input("b", sql.Int, id).query(`
      SELECT DISTINCT t.Token, b.ApplicationId
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomerPortalUser pu ON pu.IsActive = 1 AND (pu.CustomerId = a.CustomerId OR pu.CustomerId IN (
        SELECT co.CustomerId FROM dbo.CrmCoApplicant co WHERE co.IsActive = 1 AND co.CustomerId IS NOT NULL
          AND (co.BookingId = b.Id OR co.ApplicationId = b.ApplicationId)))
      JOIN dbo.PushDeviceToken t ON t.PortalUserId = pu.Id
      WHERE b.Id = @b`);
    if (!r.recordset.length) return { sent: 0, failed: 0 };
    const applicationId = r.recordset[0].ApplicationId;
    return await sendToTokens(r.recordset.map((x) => x.Token).filter(isExpoPushToken),
      { ...message, data: { ...(message.data || {}), applicationId, bookingId: id } });
  } catch (err) {
    logger.warn({ err: err.message }, "[push] sendToBookingCustomers failed");
    return { sent: 0, failed: 0 };
  }
}

/**
 * What a customer is told, on their phone, when something on their booking needs them or reaches them — one list,
 * so the wording lives in one place. `screen` is the customer screen a tap opens (mobile-maintenance
 * CustomerStack). Each takes the facts its message names.
 */
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const CUSTOMER_EVENTS = {
  agreementShared: (v) => ({ title: "Your agreement is waiting for your review", body: `${v.no || "Your agreement"} — approve or request a recheck.`, screen: "CustomerDocuments" }),
  agreementDateProposed: (v) => ({ title: "Agreement date proposed", body: `We proposed ${day(v.date)} — accept it, or suggest a different date.`, screen: "CustomerDocuments" }),
  agreementSigned: (v) => ({ title: "Your agreement is signed", body: `${v.no || "Your agreement"}${v.date ? ` · signed ${day(v.date)}` : ""}.`, screen: "CustomerDocuments" }),
  agreementRegistered: (v) => ({ title: "Your agreement is registered", body: `${v.no || "Your agreement"}${v.regNo ? ` · Reg. no. ${v.regNo}` : ""}${v.date ? ` · ${day(v.date)}` : ""}.`, screen: "CustomerDocuments" }),
  salesDeedShared: (v) => ({ title: "Your sales deed is waiting for your review", body: `${v.no || "Your sales deed"} — approve or request a recheck.`, screen: "CustomerDocuments" }),
  govtPaymentInfo: () => ({ title: "Government payment details shared", body: "Stamp duty and registration fee — upload your proof once paid.", screen: "CustomerDocuments" }),
  demandRaised: (v) => ({ title: `${v.milestone} payment is due`, body: `${inr(v.amount)}${v.due ? ` · Due ${day(v.due)}` : ""}`, screen: "CustomerPayments" }),
  paymentReceived: (v) => ({ title: "Payment received", body: `${inr(v.amount)} received. Thank you — your receipt is in Payments.`, screen: "CustomerPayments" }),
  maintenanceBill: (v) => ({ title: "New maintenance bill", body: `${v.no} · ${inr(v.amount)}${v.due ? ` · Due ${day(v.due)}` : ""}`, screen: "CustomerBills" }),
  possessionOffered: (v) => ({ title: "Possession offered", body: `${v.no}${v.respondBy ? ` — respond by ${day(v.respondBy)}` : ""}. Acknowledge or dispute it in the app.`, screen: "CustomerConstruction" }),
  ticketUpdated: (v) => ({ title: `Ticket ${v.no} — ${v.status}`, body: v.subject || "", screen: "CustomerRequests" }),
  transferDeedForYou: (v) => ({ title: "Transfer deed for your review", body: `${v.no} · ${v.property} — read the draft and approve it or ask for a correction.`, screen: "CustomerTransferDeed" }),
};

/** The phones signed in to these customers' Customer Portal. Never throws. */
async function sendToCustomers(customerIds, message = {}) {
  try {
    const ids = [...new Set((customerIds || []).map(Number).filter(Number.isInteger))];
    if (!message.title || !ids.length) return { sent: 0, failed: 0 };
    // Ids are integers (validated above), so inlining them is injection-safe.
    const r = await getPool().request().query(`
      SELECT DISTINCT t.Token FROM dbo.PushDeviceToken t JOIN dbo.CrmCustomerPortalUser pu ON pu.Id = t.PortalUserId
      WHERE pu.IsActive = 1 AND pu.CustomerId IN (${ids.join(",")})`);
    return await sendToTokens(r.recordset.map((x) => x.Token).filter(isExpoPushToken), message);
  } catch (err) {
    logger.warn({ err: err.message }, "[push] sendToCustomers failed");
    return { sent: 0, failed: 0 };
  }
}

/** Tells these customers about one of CUSTOMER_EVENTS (when it isn't about a booking they hold). Fire-and-forget. */
function notifyCustomers(customerIds, event, facts = {}) {
  const make = CUSTOMER_EVENTS[event];
  if (!make) return;
  const m = make(facts);
  void sendToCustomers(customerIds, { title: m.title, body: m.body, data: { type: "portal", event, screen: m.screen } });
}

/** Tells a booking's customers about one of CUSTOMER_EVENTS. Fire-and-forget: never throws, never waits on Expo. */
function notifyBookingCustomers(bookingId, event, facts = {}) {
  const make = CUSTOMER_EVENTS[event];
  if (!make || bookingId == null) return;
  const m = make(facts);
  void sendToBookingCustomers(bookingId, { title: m.title, body: m.body, data: { type: "portal", event, screen: m.screen } });
}

/** Tokens of one app's phones on a build older than `versionCode` (or that never reported one — builds from before
 * phones reported it, so older still). */
async function outdatedTokens(appKey, versionCode) {
  const r = await getPool()
    .request()
    .input("app", sql.NVarChar(50), String(appKey).slice(0, 50))
    .input("vc", sql.Int, versionCode)
    .query("SELECT Token FROM dbo.PushDeviceToken WHERE AppKey = @app AND (AppVersionCode IS NULL OR AppVersionCode < @vc)");
  return r.recordset.map((row) => row.Token).filter(isExpoPushToken);
}

/**
 * Tells every phone of `appKey` still on a build older than `versionCode` that a new one is out. Tapping it opens the
 * app, whose updater (UpdateGate) offers the download. Never throws.
 * @returns {Promise<{sent:number, failed:number, targeted:number}>}
 */
async function sendAppUpdate({ appKey, appLabel, versionCode, versionName, mandatory = false, notes = null }) {
  try {
    if (!appKey || !Number.isInteger(versionCode)) return { sent: 0, failed: 0, targeted: 0 };
    const tokens = await outdatedTokens(appKey, versionCode);
    const label = appLabel || "the app";
    const version = versionName ? `Version ${versionName}` : "A new version";
    const firstNote = notes ? String(notes).split(/\r?\n/).map((l) => l.trim()).find(Boolean) : "";
    const r = await sendToTokens(tokens, {
      title: mandatory ? `Update required: ${label}` : `Update available: ${label}`,
      body: `${version} is ready.${firstNote ? ` ${firstNote}` : ""} Open the app to install it.`,
      data: { type: "app-update", appKey, versionCode },
    });
    return { ...r, targeted: tokens.length };
  } catch (err) {
    logger.warn({ err: err.message }, "[push] sendAppUpdate failed");
    return { sent: 0, failed: 0, targeted: 0 };
  }
}

module.exports = { inr, day, isExpoPushToken, registerToken, unregisterToken, tokensForUsers, sendToUsers, sendToTokens, sendAppUpdate, sendToBookingCustomers, notifyBookingCustomers, sendToCustomers, notifyCustomers };
