/**
 * "Connect with Google" / "Connect with Facebook" for Admin → Integrations.
 * The admin is sent to the provider's sign-in page; the provider sends them back
 * to GET /api/public/integrations/oauth/callback with a code, which is exchanged
 * here for tokens and saved on the connection.
 *
 *  - Google: a refresh token (offline access) — permanent; the access token is
 *    renewed from it automatically (integrationConnections.js).
 *  - Meta: a long-lived user token (about 60 days). A system-user token pasted by
 *    hand is the never-expiring option; the page says so.
 *
 * The state parameter is a short-lived signed token naming the connection, the
 * admin and where to send them back, so a callback can't be forged or replayed later.
 */
const jwt = require("jsonwebtoken");
const { sql } = require("../db");
const { parseSettings } = require("./integrationConnections");
const { META_GRAPH_VERSION, metaUrl, requestJson, providerFamily } = require("./saAdPlatformService");

const STATE_TTL = "10m";

// What each provider family's sign-in asks for. Meta's scopes cover ads, lead forms and the
// Page subscription instant leads need.
const OAUTH = {
  google: {
    needs: ["clientId", "clientSecret"],
    authorizeUrl: ({ settings, redirectUri, state }) => {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({
        client_id: settings.clientId, redirect_uri: redirectUri, response_type: "code", state,
        scope: "https://www.googleapis.com/auth/adwords",
        access_type: "offline", prompt: "consent", // always hand back a refresh token
      });
      return u.toString();
    },
    exchange: async ({ settings, code, redirectUri }) => {
      const body = await requestJson("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: settings.clientId, client_secret: settings.clientSecret, code,
          redirect_uri: redirectUri, grant_type: "authorization_code",
        }),
      });
      if (!body.refresh_token) throw new Error("Google did not return a refresh token — remove CivilierERP's access in your Google account settings and connect again");
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000),
      };
    },
  },
  meta: {
    needs: ["appId", "appSecret"],
    authorizeUrl: ({ settings, redirectUri, state }) => {
      const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
      u.search = new URLSearchParams({
        client_id: settings.appId, redirect_uri: redirectUri, response_type: "code", state,
        scope: [
          "ads_management", "ads_read", "business_management", "leads_retrieval",
          "pages_show_list", "pages_read_engagement", "pages_manage_ads", "pages_manage_metadata",
        ].join(","),
      });
      return u.toString();
    },
    exchange: async ({ settings, code, redirectUri }) => {
      const short = await requestJson(metaUrl("oauth/access_token", {
        client_id: settings.appId, client_secret: settings.appSecret, redirect_uri: redirectUri, code,
      }));
      // Swap the short (1–2 hour) token for a long-lived one.
      const long = await requestJson(metaUrl("oauth/access_token", {
        grant_type: "fb_exchange_token", client_id: settings.appId, client_secret: settings.appSecret,
        fb_exchange_token: short.access_token,
      }));
      return {
        accessToken: long.access_token,
        refreshToken: null,
        expiresAt: long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000) : null,
      };
    },
  },
};

const oauthFor = (provider) => OAUTH[providerFamily(provider)] || null;

/** The sign-in link for a connection, or { error }. */
async function startUrl(pool, channelId, { userId, redirectUri, returnTo }) {
  const r = await pool.request().input("id", sql.Int, channelId)
    .query("SELECT Provider, SettingsJson FROM dbo.IntegrationChannels WHERE Id = @id AND IsActive = 1");
  const conn = r.recordset[0];
  if (!conn) return { error: "Connection not found or switched off" };
  const oauth = oauthFor(conn.Provider);
  if (!oauth) return { error: "Choose Meta or Google for this connection first" };
  const settings = parseSettings(conn.SettingsJson);
  const missing = oauth.needs.filter((k) => !settings[k]);
  if (missing.length) return { error: `Save the ${missing.join(" and ")} under Credentials first` };

  const state = jwt.sign({ cid: channelId, uid: userId, redirectUri, returnTo }, process.env.JWT_SECRET, { expiresIn: STATE_TTL });
  return { url: oauth.authorizeUrl({ settings, redirectUri, state }) };
}

/** Reads a callback's state; throws when it is forged or expired. */
const readState = (state) => jwt.verify(String(state || ""), process.env.JWT_SECRET);

/** Exchanges the callback's code and saves the tokens on the connection. */
async function finish(pool, { cid, uid, redirectUri }, code) {
  const r = await pool.request().input("id", sql.Int, cid)
    .query("SELECT Provider, SettingsJson FROM dbo.IntegrationChannels WHERE Id = @id AND IsActive = 1");
  const conn = r.recordset[0];
  if (!conn) throw new Error("The connection was removed while signing in");
  const tokens = await oauthFor(conn.Provider).exchange({ settings: parseSettings(conn.SettingsJson), code, redirectUri });
  await pool.request()
    .input("id", sql.Int, cid)
    .input("tok", sql.NVarChar(sql.MAX), tokens.accessToken || null)
    .input("ref", sql.NVarChar(sql.MAX), tokens.refreshToken)
    .input("exp", sql.DateTime2(3), tokens.expiresAt)
    .input("by", sql.NVarChar(100), String(uid || "oauth"))
    .query(`
      UPDATE dbo.IntegrationChannels SET
        AccessToken = @tok, RefreshToken = COALESCE(@ref, RefreshToken), TokenExpiresAt = @exp,
        LastTestOk = NULL, LastTestAt = NULL, LastTestMessage = NULL,
        UpdatedAt = GETDATE(), UpdatedBy = @by
      WHERE Id = @id
    `);
}

module.exports = { startUrl, readState, finish, oauthFor };
