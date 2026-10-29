/**
 * Meta / Google connections kept in Admin → Integrations (dbo.IntegrationChannels).
 * A Social Media platform points at one (SaSocialMediaPlatform.ApiConfigId) and
 * keeps only its own account details (ad account, pixel, page). The platform's
 * own AccessToken is the fallback for platforms not yet moved to a connection.
 *
 * Permanent setup: a Meta system-user token set to never expire, or a Google
 * refresh token + OAuth client — the Google access token (about an hour) is
 * renewed here whenever it is missing or about to run out, and saved back.
 */
const { sql } = require("../db");
const {
  testPlatformConnection, providerFamily, renewGoogleAccessToken, CONNECTION_PROVIDERS,
} = require("./saAdPlatformService");

// Joined onto a platform row (alias p) — the connection's credentials, never sent to the browser.
const CONNECTION_JOIN = "LEFT JOIN dbo.IntegrationChannels ic ON ic.Id = p.ApiConfigId AND ic.IsActive = 1";
const CONNECTION_COLUMNS = `ic.Id AS ConnId, ic.Provider AS ConnProvider, ic.AccessToken AS ConnAccessToken,
  ic.RefreshToken AS ConnRefreshToken, ic.TokenExpiresAt AS ConnTokenExpiresAt, ic.SettingsJson AS ConnSettingsJson`;

const RENEW_MARGIN_MS = 5 * 60 * 1000; // renew a little before Google's token runs out

const parseSettings = (json) => {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const providerOf = (id) => CONNECTION_PROVIDERS.find((p) => p.id === id);

/**
 * The access token to use for a connection — renewed first when its provider
 * renews tokens and the saved one is missing or about to expire.
 * conn: { Id, Provider, AccessToken, RefreshToken, TokenExpiresAt, SettingsJson }
 */
async function currentAccessToken(pool, conn) {
  const settings = parseSettings(conn.SettingsJson);
  const canRenew = providerOf(conn.Provider)?.autoRenew && conn.RefreshToken && settings.clientId && settings.clientSecret;
  const fresh = conn.AccessToken && (!conn.TokenExpiresAt || new Date(conn.TokenExpiresAt).getTime() - Date.now() > RENEW_MARGIN_MS);
  if (!canRenew || fresh) return conn.AccessToken;

  const renewed = await renewGoogleAccessToken({
    clientId: settings.clientId, clientSecret: settings.clientSecret, refreshToken: conn.RefreshToken,
  });
  await pool.request()
    .input("id", sql.Int, conn.Id)
    .input("tok", sql.NVarChar(sql.MAX), renewed.accessToken)
    .input("exp", sql.DateTime2(3), renewed.expiresAt)
    .query("UPDATE dbo.IntegrationChannels SET AccessToken = @tok, TokenExpiresAt = @exp WHERE Id = @id");
  return renewed.accessToken;
}

/** Puts the connection's credentials onto a platform row (renewing the token if due); the Conn* columns are removed. */
async function applyConnection(pool, row) {
  if (!row) return row;
  const { ConnId, ConnProvider, ConnAccessToken, ConnRefreshToken, ConnTokenExpiresAt, ConnSettingsJson, ...rest } = row;
  if (!ConnId || (!ConnAccessToken && !ConnRefreshToken)) return rest;
  const token = await currentAccessToken(pool, {
    Id: ConnId, Provider: ConnProvider, AccessToken: ConnAccessToken,
    RefreshToken: ConnRefreshToken, TokenExpiresAt: ConnTokenExpiresAt, SettingsJson: ConnSettingsJson,
  });
  if (!token) return rest;
  const settings = parseSettings(ConnSettingsJson);
  return {
    ...rest,
    AccessToken: token,
    DeveloperToken: settings.developerToken || rest.DeveloperToken,
    LoginCustomerId: settings.loginCustomerId || rest.LoginCustomerId,
  };
}

/** A platform may only use a connection of its own provider family (a Facebook page can't use a Google login). */
async function connectionMismatch(pool, apiConfigId, platformType) {
  if (!apiConfigId) return null;
  const r = await pool.request().input("id", sql.Int, apiConfigId)
    .query("SELECT Label, Provider FROM dbo.IntegrationChannels WHERE Id = @id AND IsActive = 1");
  const conn = r.recordset[0];
  if (!conn) return "That connection does not exist or is switched off";
  if (conn.Provider && platformType && providerFamily(conn.Provider) !== providerFamily(platformType)) {
    return `${conn.Label} is a ${conn.Provider} connection — it can't be used for a ${platformType} platform`;
  }
  return null;
}

/** Tests a connection's credentials (renewing first where it can) and records the result on it. */
async function testConnection(pool, id) {
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT Id, Provider, AccessToken, RefreshToken, TokenExpiresAt, SettingsJson FROM dbo.IntegrationChannels WHERE Id = @id");
  const conn = r.recordset[0];
  if (!conn) return null;
  const settings = parseSettings(conn.SettingsJson);
  let result;
  if (!conn.Provider) {
    result = { ok: false, message: "Choose whether this is a Meta or Google connection first." };
  } else {
    try {
      const token = await currentAccessToken(pool, conn);
      result = await testPlatformConnection(conn.Provider, token, null, {
        DeveloperToken: settings.developerToken,
        LoginCustomerId: settings.loginCustomerId,
      });
    } catch (err) {
      result = { ok: false, message: err.message || "Could not renew the access token" };
    }
  }
  await pool.request()
    .input("id", sql.Int, id)
    .input("ok", sql.Bit, result.ok ? 1 : 0)
    .input("msg", sql.NVarChar(500), String(result.message || "").slice(0, 500))
    .query("UPDATE dbo.IntegrationChannels SET LastTestAt = SYSDATETIME(), LastTestOk = @ok, LastTestMessage = @msg WHERE Id = @id");
  return { ok: !!result.ok, message: result.message };
}

module.exports = { CONNECTION_JOIN, CONNECTION_COLUMNS, applyConnection, connectionMismatch, testConnection, parseSettings, providerOf };
