/**
 * Instant Meta lead-form leads. Meta calls POST /api/public/integrations/meta-leads/:channelId
 * the moment someone submits a lead form on a Page; the call only carries the lead's id,
 * so the lead is then read from the Graph API with the connection's token and created
 * through the same path as every other lead (saLeadCreate.js): same checks, same
 * duplicate-mobile rule, same welcome message — linked to the matching ad when we have it.
 *
 * Switching on (turnOn): subscribes the Meta app to Page "leadgen" events at our address,
 * and subscribes every Page the connection can manage to the app.
 */
const crypto = require("crypto");
const { sql } = require("../db");
const { parseSettings, applyConnection, CONNECTION_COLUMNS } = require("./integrationConnections");
const { metaUrl, requestJson, normalizeMetaLead } = require("./saAdPlatformService");
const { createLead } = require("./saLeadCreate");

const LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data";

async function loadConnection(pool, channelId) {
  const r = await pool.request().input("id", sql.Int, channelId).query(`
    SELECT ${CONNECTION_COLUMNS}, ic.Provider
    FROM dbo.IntegrationChannels ic
    WHERE ic.Id = @id AND ic.IsActive = 1
  `);
  return r.recordset[0] || null;
}

/** GET handshake: Meta proves the address with the verify token we gave it. Returns the challenge or null. */
async function verifyHandshake(pool, channelId, query) {
  const conn = await loadConnection(pool, channelId);
  if (!conn || query["hub.mode"] !== "subscribe") return null;
  const expected = parseSettings(conn.ConnSettingsJson).webhookVerifyToken;
  return expected && query["hub.verify_token"] === expected ? String(query["hub.challenge"] || "") : null;
}

/** Meta signs every delivery with the app secret (X-Hub-Signature-256: sha256=<hmac of the raw body>). */
function signatureValid(appSecret, rawBody, header) {
  if (!appSecret || !rawBody || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Which SA platform / campaign / ad a lead belongs to: the ad by its Meta id, else a platform on this connection. */
async function sourceFor(pool, channelId, adId, pageId) {
  if (adId) {
    const ad = await pool.request().input("ext", sql.NVarChar(200), String(adId)).query(`
      SELECT TOP 1 a.Id AS AdId, a.CampaignId, c.PlatformId
      FROM dbo.SaAd a JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
      WHERE a.ExternalAdId = @ext AND a.IsActive = 1
    `);
    if (ad.recordset[0]) return ad.recordset[0];
  }
  const platforms = await pool.request().input("cid", sql.Int, channelId).query(
    "SELECT Id, AccountDetails FROM dbo.SaSocialMediaPlatform WHERE ApiConfigId = @cid AND IsActive = 1 ORDER BY Id",
  );
  const onPage = platforms.recordset.find((p) => pageId && String(parseSettings(p.AccountDetails).pageId || "") === String(pageId));
  const platform = onPage || platforms.recordset[0];
  return { PlatformId: platform?.Id || null, CampaignId: null, AdId: null };
}

async function recordDelivery(pool, channelId, ok, message, added) {
  await pool.request()
    .input("id", sql.Int, channelId)
    .input("ok", sql.Bit, ok ? 1 : 0)
    .input("msg", sql.NVarChar(500), String(message || "").slice(0, 500))
    .input("n", sql.Int, added)
    .query(`
      UPDATE dbo.IntegrationChannels SET
        LastWebhookAt = SYSDATETIME(), LastWebhookOk = @ok, LastWebhookMessage = @msg, WebhookLeads = WebhookLeads + @n
      WHERE Id = @id
    `);
}

/**
 * Handles one delivery (already answered 200 to Meta). Every leadgen change is read
 * and created; the outcome is recorded on the connection.
 */
async function processDelivery(pool, channelId, body) {
  const changes = (body?.entry || []).flatMap((e) => (e.changes || []).filter((c) => c.field === "leadgen").map((c) => c.value || {}));
  if (!changes.length) return;
  const row = await loadConnection(pool, channelId);
  if (!row) return;
  const conn = await applyConnection(pool, { ...row });
  const notes = [];
  let added = 0;
  let repeats = 0; // already a lead — noted on it as enquired again
  for (const change of changes) {
    // A Meta lead id is digits only; anything else is never put into a Graph URL (which carries the access token).
    const leadgenId = String(change.leadgen_id ?? "");
    if (!/^\d{1,30}$/.test(leadgenId)) {
      notes.push(`skipped a change with an invalid lead id`);
      continue;
    }
    try {
      const lead = await requestJson(metaUrl(encodeURIComponent(leadgenId), { access_token: conn.AccessToken, fields: LEAD_FIELDS }));
      const source = await sourceFor(pool, channelId, lead.ad_id || change.ad_id, change.page_id);
      const r = await createLead(pool, { ...normalizeMetaLead(lead), ...source, SourceType: "Ad" }, null, { repeatVia: "a Meta lead form" });
      if (r.noted) repeats += 1;
      else if (r.error) notes.push(`lead ${change.leadgen_id}: ${r.error}`);
      else added += 1;
    } catch (err) {
      notes.push(`lead ${change.leadgen_id}: ${err.message}`);
    }
  }
  const ok = notes.length === 0;
  const summary = [`${added} lead(s) added`, repeats ? `${repeats} already a lead (noted as enquired again)` : "", ...notes].filter(Boolean).join(" · ");
  await recordDelivery(pool, channelId, ok, summary, added);
}

/**
 * Switches instant leads on: subscribes the app to Page leadgen events at callbackUrl and
 * every Page this connection can manage to the app. Resolves { pages: [{ id, name, ok, error? }] }.
 */
async function turnOn(pool, channelId, callbackUrl) {
  const row = await loadConnection(pool, channelId);
  if (!row) throw new Error("Connection not found or switched off");
  const settings = parseSettings(row.ConnSettingsJson);
  if (!settings.appId || !settings.appSecret) throw new Error("Save the Meta app ID and app secret under Credentials first");
  const conn = await applyConnection(pool, { ...row });
  if (!conn.AccessToken) throw new Error("Connect with Facebook (or paste a token) first");

  // One verify token per connection, kept so Meta's later re-checks still pass.
  if (!settings.webhookVerifyToken) {
    settings.webhookVerifyToken = crypto.randomBytes(24).toString("hex");
    await pool.request().input("id", sql.Int, channelId).input("s", sql.NVarChar(sql.MAX), JSON.stringify(settings))
      .query("UPDATE dbo.IntegrationChannels SET SettingsJson = @s WHERE Id = @id");
  }

  await requestJson(metaUrl(`${settings.appId}/subscriptions`, {
    access_token: `${settings.appId}|${settings.appSecret}`,
    object: "page", callback_url: callbackUrl, fields: "leadgen", verify_token: settings.webhookVerifyToken,
  }), { method: "POST" });

  const accounts = await requestJson(metaUrl("me/accounts", { access_token: conn.AccessToken, fields: "id,name,access_token", limit: 100 }));
  const pages = [];
  for (const page of accounts.data || []) {
    try {
      await requestJson(metaUrl(`${page.id}/subscribed_apps`, { access_token: page.access_token, subscribed_fields: "leadgen" }), { method: "POST" });
      pages.push({ id: page.id, name: page.name, ok: true });
    } catch (err) {
      pages.push({ id: page.id, name: page.name, ok: false, error: err.message });
    }
  }
  if (!pages.length) throw new Error("This connection can't see any Facebook Page — give it access to your Pages, then try again");

  await pool.request().input("id", sql.Int, channelId)
    .query("UPDATE dbo.IntegrationChannels SET WebhookOnAt = SYSDATETIME() WHERE Id = @id");
  return { pages };
}

module.exports = { verifyHandshake, signatureValid, processDelivery, turnOn, loadConnection };
