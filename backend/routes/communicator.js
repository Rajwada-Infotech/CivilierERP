const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const allowRoles = require("../middleware/role");
const { send: sendMessage, messagingStatus } = require("../services/messageProviders");
const { CONNECTION_PROVIDERS } = require("../services/saAdPlatformService");
const { testConnection, parseSettings } = require("../services/integrationConnections");


router.use(authMiddleware);
router.use(apiRateLimit);
const adminOnly = allowRoles("admin", "super_admin", "dba");
const superAdminOnly = allowRoles("super_admin");

// ─── Channel management CRUD (super_admin only) ──────────────────────────────

// Every channel column the browser may see — credentials only as Has* flags, never the values.
const CHANNEL_COLUMNS = `
  Id, ChannelKey, Label, Description, SortOrder, IsActive, UpdatedAt, UpdatedBy,
  Provider, TokenExpiresAt, LastTestAt, LastTestOk, LastTestMessage, SettingsJson,
  CASE WHEN LEN(AccessToken) > 0 THEN 1 ELSE 0 END AS HasAccessToken,
  CASE WHEN LEN(RefreshToken) > 0 THEN 1 ELSE 0 END AS HasRefreshToken`;

// SettingsJson holds the Google developer token (a secret) — only the login customer id is shown.
const publicChannel = ({ SettingsJson, ...c }) => {
  const settings = parseSettings(SettingsJson);
  return { ...c, HasDeveloperToken: !!settings.developerToken, LoginCustomerId: settings.loginCustomerId || "" };
};

/**
 * GET /api/communicator/channels
 * Returns all channel rows (active + inactive) for the admin UI.
 */
router.get("/channels", superAdminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ${CHANNEL_COLUMNS}
      FROM dbo.IntegrationChannels
      ORDER BY SortOrder ASC
    `);
    // The channels are offered on the Social Media platform master; show which platforms point at each.
    const usage = await pool
      .request()
      .query(`
        IF OBJECT_ID('dbo.SaSocialMediaPlatform', 'U') IS NULL
          SELECT CAST(NULL AS INT) AS ApiConfigId, CAST(NULL AS NVARCHAR(200)) AS Name WHERE 1 = 0
        ELSE
          SELECT ApiConfigId, Name FROM dbo.SaSocialMediaPlatform WHERE ApiConfigId IS NOT NULL ORDER BY Name
      `)
      .catch(() => ({ recordset: [] }));
    const usedBy = new Map();
    for (const r of usage.recordset) usedBy.set(r.ApiConfigId, [...(usedBy.get(r.ApiConfigId) || []), r.Name]);
    res.json({
      channels: result.recordset.map((c) => ({ ...publicChannel(c), UsedBy: usedBy.get(c.Id) || [] })),
      providers: CONNECTION_PROVIDERS,
    });
  } catch (err) {
    console.error("ERROR in GET /communicator/channels:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/communicator/channels
 * Create a new channel.
 * Body: { channelKey, label, description?, sortOrder? }
 */
router.post("/channels", superAdminOnly, async (req, res) => {
  const { channelKey, label, description, sortOrder } = req.body;

  if (!channelKey || typeof channelKey !== "string" || !channelKey.trim()) {
    return res.status(400).json({ error: "channelKey is required" });
  }
  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "label is required" });
  }

  // Enforce slug format: lowercase, hyphens, no spaces
  const key = channelKey.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
    return res.status(400).json({
      error: "channelKey must be lowercase letters, numbers, and hyphens only (e.g. my-channel)",
    });
  }

  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();

    // Duplicate key check
    const existing = await pool
      .request()
      .input("Key", sql.NVarChar(50), key)
      .query("SELECT 1 FROM dbo.IntegrationChannels WHERE ChannelKey = @Key");

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: "A channel with this key already exists" });
    }

    const result = await pool
      .request()
      .input("Key",         sql.NVarChar(50),  key)
      .input("Label",       sql.NVarChar(100), label.trim())
      .input("Description", sql.NVarChar(255), description?.trim() || null)
      .input("SortOrder",   sql.Int,           Number(sortOrder) || 0)
      .input("UpdatedBy",   sql.NVarChar(100), String(updatedBy))
      .query(`
        INSERT INTO dbo.IntegrationChannels (ChannelKey, Label, Description, SortOrder, IsActive, CreatedAt, UpdatedAt, UpdatedBy)
        VALUES (@Key, @Label, @Description, @SortOrder, 1, GETDATE(), GETDATE(), @UpdatedBy);
        SELECT ${CHANNEL_COLUMNS} FROM dbo.IntegrationChannels WHERE Id = SCOPE_IDENTITY();
      `);

    res.status(201).json({ channel: publicChannel(result.recordset[0]) });
  } catch (err) {
    console.error("ERROR in POST /communicator/channels:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/communicator/channels/:id
 * Update label, description, sortOrder, or isActive.
 * ChannelKey is immutable after creation.
 */
router.put("/channels/:id", superAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const { label, description, sortOrder, isActive } = req.body;
  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  if (label !== undefined && (!label || typeof label !== "string")) {
    return res.status(400).json({ error: "label must be a non-empty string" });
  }

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id",          sql.Int,           id)
      .input("Label",       sql.NVarChar(100), label?.trim() ?? null)
      .input("Description", sql.NVarChar(255), description?.trim() ?? null)
      .input("SortOrder",   sql.Int,           sortOrder !== undefined ? Number(sortOrder) : null)
      .input("IsActive",    sql.Bit,           isActive !== undefined ? (isActive ? 1 : 0) : null)
      .input("UpdatedBy",   sql.NVarChar(100), String(updatedBy))
      .query(`
        UPDATE dbo.IntegrationChannels SET
          Label       = COALESCE(@Label,       Label),
          Description = COALESCE(@Description, Description),
          SortOrder   = COALESCE(@SortOrder,   SortOrder),
          IsActive    = COALESCE(@IsActive,     IsActive),
          UpdatedAt   = GETDATE(),
          UpdatedBy   = @UpdatedBy
        WHERE Id = @Id;
        SELECT ${CHANNEL_COLUMNS} FROM dbo.IntegrationChannels WHERE Id = @Id;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Channel not found" });
    }
    res.json({ channel: publicChannel(result.recordset[0]) });
  } catch (err) {
    console.error("ERROR in PUT /communicator/channels/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/communicator/channels/:id/credentials
 * Makes the channel a Meta / Google connection. A blank token keeps the saved one.
 * Body: { provider, accessToken?, refreshToken?, tokenExpiresAt?, developerToken?, loginCustomerId? }
 */
router.put("/channels/:id/credentials", superAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  const b = req.body || {};
  const provider = String(b.provider || "").trim();
  if (!CONNECTION_PROVIDERS.some((p) => p.id === provider)) {
    return res.status(400).json({ error: `Provider must be one of: ${CONNECTION_PROVIDERS.map((p) => p.label).join(", ")}` });
  }
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();
    const cur = await pool.request().input("Id", sql.Int, id).query("SELECT SettingsJson FROM dbo.IntegrationChannels WHERE Id = @Id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Channel not found" });
    const settings = parseSettings(cur.recordset[0].SettingsJson);
    if (text(b.developerToken)) settings.developerToken = text(b.developerToken);
    if (b.loginCustomerId !== undefined) settings.loginCustomerId = text(b.loginCustomerId) || undefined;

    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("Provider", sql.NVarChar(30), provider)
      .input("AccessToken", sql.NVarChar(sql.MAX), text(b.accessToken))
      .input("RefreshToken", sql.NVarChar(sql.MAX), text(b.refreshToken))
      .input("TokenExpiresAt", sql.DateTime2(3), b.tokenExpiresAt || null)
      .input("SettingsJson", sql.NVarChar(sql.MAX), JSON.stringify(settings))
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy))
      .query(`
        UPDATE dbo.IntegrationChannels SET
          Provider       = @Provider,
          AccessToken    = COALESCE(@AccessToken, AccessToken),
          RefreshToken   = COALESCE(@RefreshToken, RefreshToken),
          TokenExpiresAt = @TokenExpiresAt,
          SettingsJson   = @SettingsJson,
          -- New credentials: the last test no longer describes them.
          LastTestOk     = CASE WHEN @AccessToken IS NULL THEN LastTestOk END,
          LastTestAt     = CASE WHEN @AccessToken IS NULL THEN LastTestAt END,
          LastTestMessage = CASE WHEN @AccessToken IS NULL THEN LastTestMessage END,
          UpdatedAt      = GETDATE(),
          UpdatedBy      = @UpdatedBy
        WHERE Id = @Id;
        SELECT ${CHANNEL_COLUMNS} FROM dbo.IntegrationChannels WHERE Id = @Id;
      `);
    res.json({ channel: publicChannel(result.recordset[0]) });
  } catch (err) {
    console.error("ERROR in PUT /communicator/channels/:id/credentials:", err);
    res.status(500).json({ error: "Could not save the connection" });
  }
});

/**
 * POST /api/communicator/channels/:id/test — calls Meta / Google with the saved token and records the result.
 */
router.post("/channels/:id/test", superAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const result = await testConnection(getPool(), id);
    if (!result) return res.status(404).json({ error: "Channel not found" });
    res.json(result);
  } catch (err) {
    console.error("ERROR in POST /communicator/channels/:id/test:", err);
    res.status(500).json({ error: "Connection test failed to run" });
  }
});

/**
 * DELETE /api/communicator/channels/:id  (soft delete — sets IsActive = 0)
 * Hard deletes are intentionally not exposed; Social Media platforms may still
 * point at the channel (SaSocialMediaPlatform.ApiConfigId).
 */
router.delete("/channels/:id", superAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int,           id)
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy))
      .query(`
        UPDATE dbo.IntegrationChannels
        SET IsActive = 0, UpdatedAt = GETDATE(), UpdatedBy = @UpdatedBy
        WHERE Id = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("ERROR in DELETE /communicator/channels/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================== Messaging channels: status + test ======================
const MESSAGING = ["email", "sms", "whatsapp"];

// GET /messaging/status — whether each channel is set up and switched on (no secrets).
router.get("/messaging/status", adminOnly, async (req, res) => {
  try {
    res.json({ channels: await messagingStatus() });
  } catch (err) {
    console.error("ERROR in GET /messaging/status:", err);
    res.status(500).json({ error: "Failed to load messaging status" });
  }
});

// POST /messaging/:channel/test { to } — sends one test message, even while the channel is switched off.
router.post("/messaging/:channel/test", adminOnly, async (req, res) => {
  const { channel } = req.params;
  const to = String(req.body?.to || "").trim();
  if (!MESSAGING.includes(channel)) return res.status(400).json({ error: "invalid channel" });
  if (!to || to.length > 200) return res.status(400).json({ error: "Enter where to send the test" });
  if (channel === "email" ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) : !/^\+?[\d\s-]{8,16}$/.test(to)) {
    return res.status(400).json({ error: channel === "email" ? "Enter a valid email address" : "Enter a valid mobile number" });
  }
  const result = await sendMessage(
    channel,
    { to, subject: "CivilierERP test message", text: "This is a test message from CivilierERP. If you received it, this channel is working." },
    { force: true },
  );
  res.status(result.ok ? 200 : 422).json(result.ok ? { ok: true } : { ok: false, error: result.error });
});

// ─── Generic channel config routes (unchanged) ───────────────────────────────

router.get("/:channel", adminOnly, async (req, res) => {
  const { channel } = req.params;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Channel", sql.NVarChar(50), channel)
      .query(`
        SELECT ConfigJson
        FROM dbo.CommunicatorConfig
        WHERE Channel = @Channel AND IsActive = 1
      `);

    const row = result.recordset[0];
    let config = {};
    try {
      config = row?.ConfigJson ? JSON.parse(row.ConfigJson) : {};
    } catch {}

    res.json({ config });
  } catch (err) {
    console.error("ERROR in GET /:channel:", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:channel", adminOnly, async (req, res) => {
  const { channel } = req.params;
  const { config } = req.body;

  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "config object required" });
  }

  try {
    const pool = getPool();
    const json = JSON.stringify(config);

    await pool
      .request()
      .input("Channel",    sql.NVarChar(50),     channel)
      .input("ConfigJson", sql.NVarChar(sql.MAX), json)
      .query(`
        MERGE dbo.CommunicatorConfig AS target
        USING (VALUES (@Channel, @ConfigJson)) AS source (Channel, ConfigJson)
        ON target.Channel = source.Channel
        WHEN MATCHED THEN
          UPDATE SET
            ConfigJson = source.ConfigJson,
            UpdatedAt  = GETDATE(),
            IsActive   = 1
        WHEN NOT MATCHED THEN
          INSERT (Channel, ConfigJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (source.Channel, source.ConfigJson, 1, GETDATE(), GETDATE());
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("ERROR in PUT /:channel:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



