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
 */
"use strict";

const { getPool, sql } = require("../db");
const logger = require("../logger");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100; // Expo's per-request limit
const TOKEN_RE = /^(Exponent|Expo)PushToken\[[^\]\s]+\]$/;

const isExpoPushToken = (t) => typeof t === "string" && t.length <= 200 && TOKEN_RE.test(t);

/** Insert, or re-point an existing token at this user (a handed-over phone). */
async function registerToken(userId, token, { appKey = null, platform = null } = {}) {
  if (!Number.isInteger(userId) || !isExpoPushToken(token)) {
    const err = new Error("A valid user and Expo push token are required.");
    err.status = 400;
    throw err;
  }
  await getPool()
    .request()
    .input("uid", sql.Int, userId)
    .input("token", sql.NVarChar(200), token)
    .input("app", sql.NVarChar(50), appKey ? String(appKey).slice(0, 50) : null)
    .input("plat", sql.NVarChar(20), platform ? String(platform).slice(0, 20) : null)
    .query(`
      MERGE dbo.PushDeviceToken AS t
      USING (SELECT @token AS Token) AS s ON t.Token = s.Token
      WHEN MATCHED THEN
        UPDATE SET UserId = @uid, AppKey = @app, Platform = @plat, LastSeenAt = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (UserId, Token, AppKey, Platform) VALUES (@uid, @token, @app, @plat);
    `);
}

/** Remove a token on logout. Scoped to the user so one person can't unregister another's phone. */
async function unregisterToken(userId, token) {
  if (!Number.isInteger(userId) || typeof token !== "string") return 0;
  const r = await getPool()
    .request()
    .input("uid", sql.Int, userId)
    .input("token", sql.NVarChar(200), token)
    .query("DELETE FROM dbo.PushDeviceToken WHERE Token = @token AND UserId = @uid");
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

/**
 * @param {number[]} userIds   recipients (duplicates / invalid ids ignored)
 * @param {{title:string, body?:string, data?:object}} message
 * @param {{apps?: string[]}} [opts]  only deliver to these apps' devices
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function sendToUsers(userIds, { title, body, data } = {}, { apps = null } = {}) {
  const result = { sent: 0, failed: 0 };
  try {
    if (!title) return result;
    const tokens = await tokensForUsers(userIds, apps);
    if (!tokens.length) return result;

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
        channelId: "default",
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
  } catch (err) {
    logger.warn({ err: err.message }, "[push] sendToUsers failed");
  }
  return result;
}

module.exports = { isExpoPushToken, registerToken, unregisterToken, tokensForUsers, sendToUsers };
