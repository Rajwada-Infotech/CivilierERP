/**
 * Meta / Google connections kept in Admin → Integrations (dbo.IntegrationChannels).
 * A Social Media platform points at one (SaSocialMediaPlatform.ApiConfigId) and
 * keeps only its own account details (ad account, pixel, page). The platform's
 * own AccessToken is the fallback for platforms not yet moved to a connection.
 */
const { sql } = require("../db");
const { testPlatformConnection, providerFamily } = require("./saAdPlatformService");

// Joined onto a platform row (alias p) — the connection's credentials, never sent to the browser.
const CONNECTION_JOIN = "LEFT JOIN dbo.IntegrationChannels ic ON ic.Id = p.ApiConfigId AND ic.IsActive = 1";
const CONNECTION_COLUMNS = "ic.Provider AS ConnProvider, ic.AccessToken AS ConnAccessToken, ic.SettingsJson AS ConnSettingsJson";

const parseSettings = (json) => {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Puts the connection's credentials onto a platform row; the Conn* columns are removed. */
function applyConnection(row) {
  if (!row) return row;
  const { ConnProvider, ConnAccessToken, ConnSettingsJson, ...rest } = row;
  if (!ConnAccessToken) return rest;
  const settings = parseSettings(ConnSettingsJson);
  return {
    ...rest,
    AccessToken: ConnAccessToken,
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

/** Tests a connection's credentials and records the result on it. */
async function testConnection(pool, id) {
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT Provider, AccessToken, SettingsJson FROM dbo.IntegrationChannels WHERE Id = @id");
  const conn = r.recordset[0];
  if (!conn) return null;
  const settings = parseSettings(conn.SettingsJson);
  const result = conn.Provider
    ? await testPlatformConnection(conn.Provider, conn.AccessToken, null, {
        DeveloperToken: settings.developerToken,
        LoginCustomerId: settings.loginCustomerId,
      })
    : { ok: false, message: "Choose whether this is a Meta or Google connection first." };
  await pool.request()
    .input("id", sql.Int, id)
    .input("ok", sql.Bit, result.ok ? 1 : 0)
    .input("msg", sql.NVarChar(500), String(result.message || "").slice(0, 500))
    .query("UPDATE dbo.IntegrationChannels SET LastTestAt = SYSDATETIME(), LastTestOk = @ok, LastTestMessage = @msg WHERE Id = @id");
  return { ok: !!result.ok, message: result.message };
}

module.exports = { CONNECTION_JOIN, CONNECTION_COLUMNS, applyConnection, connectionMismatch, testConnection, parseSettings };
