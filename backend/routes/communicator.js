const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const {
  communicatorConfigSchema,
} = require("../validation/communicatorSchemas");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");
const superAdminOnly = allowRoles("super_admin");

// ─── helpers ─────────────────────────────────────────────────────────────────

const parseConfigJson = (value) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const toLegacyApiRecord = (channel, row) => {
  const config = row?.configJson || {};
  return {
    id: channel,
    name:
      config.name ||
      channel
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    baseUrl: config.baseUrl || "",
    apiKey: config.apiKey || "",
    status: row?.isActive ? "active" : "inactive",
  };
};

/**
 * Fetch the list of active channel keys from dbo.IntegrationChannels.
 * Falls back to the legacy hardcoded list if the table doesn't exist yet
 * (safe during the migration window).
 */
const LEGACY_CHANNELS = [
  "payment-gateway",
  "sms-api",
  "whatsapp-api",
  "email-api",
  "push-notifications",
];

async function getActiveChannelKeys() {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ChannelKey
      FROM dbo.IntegrationChannels
      WHERE IsActive = 1
      ORDER BY SortOrder ASC
    `);
    const keys = result.recordset.map((r) => r.ChannelKey);
    return keys.length > 0 ? keys : LEGACY_CHANNELS;
  } catch {
    // Table doesn't exist yet — migration hasn't run; fall back gracefully
    return LEGACY_CHANNELS;
  }
}

// ─── Channel management CRUD (super_admin only) ──────────────────────────────

/**
 * GET /api/communicator/channels
 * Returns all channel rows (active + inactive) for the admin UI.
 */
router.get("/channels", superAdminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, ChannelKey, Label, Description, SortOrder, IsActive, UpdatedAt, UpdatedBy
      FROM dbo.IntegrationChannels
      ORDER BY SortOrder ASC
    `);
    res.json({ channels: result.recordset });
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
        OUTPUT INSERTED.*
        VALUES (@Key, @Label, @Description, @SortOrder, 1, GETDATE(), GETDATE(), @UpdatedBy)
      `);

    res.status(201).json({ channel: result.recordset[0] });
  } catch (err) {
    console.error("ERROR in POST /communicator/channels:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/communicator/channels/:id
 * Update label, description, sortOrder, or isActive.
 * ChannelKey is immutable after creation (it's the FK used in CommunicatorConfig).
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
        SELECT * FROM dbo.IntegrationChannels WHERE Id = @Id;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Channel not found" });
    }
    res.json({ channel: result.recordset[0] });
  } catch (err) {
    console.error("ERROR in PUT /communicator/channels/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/communicator/channels/:id  (soft delete — sets IsActive = 0)
 * Hard deletes are intentionally not exposed; the channel may still have
 * config rows in CommunicatorConfig.
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

// ====================== GET /integrations ======================
router.get("/integrations", adminOnly, async (req, res) => {
  try {
    const activeChannels = await getActiveChannelKeys();
    const pool = getPool();
    const request = pool.request();

    activeChannels.forEach((channel, index) => {
      request.input(`Channel${index}`, sql.NVarChar(50), channel);
    });
    request.input("LegacyChannel", sql.NVarChar(50), "integrations");

    const result = await request.query(`
      SELECT
        Channel,
        ConfigJson,
        IsActive,
        UpdatedAt
      FROM dbo.CommunicatorConfig
      WHERE Channel IN (${activeChannels.map((_, i) => `@Channel${i}`).join(", ")}, @LegacyChannel)
    `);

    const byChannel = new Map(
      result.recordset.map((row) => [
        row.Channel,
        {
          channel: row.Channel,
          configJson: parseConfigJson(row.ConfigJson),
          isActive: !!row.IsActive,
          updatedBy: null,
          updatedAt: row.UpdatedAt || null,
        },
      ]),
    );

    const integrations = activeChannels.map((channel) => {
      const existing = byChannel.get(channel);
      return (
        existing || {
          channel,
          configJson: {},
          isActive: false,
          updatedBy: null,
          updatedAt: null,
        }
      );
    });

    const legacyConfig = byChannel.get("integrations")?.configJson || {};
    const configuredApis = integrations
      .filter(
        (row) => row.isActive || Object.keys(row.configJson || {}).length > 0,
      )
      .map((row) => toLegacyApiRecord(row.channel, row));

    const legacyApis = Array.isArray(legacyConfig.apis) ? legacyConfig.apis : [];

    res.json({
      integrations,
      config: {
        apis: legacyApis.length > 0 ? legacyApis : configuredApis,
      },
    });
  } catch (err) {
    console.error("🔥 ERROR in GET /integrations:", err);
    if (req.log) req.log.error(err, "Failed to fetch integrations");
    res.status(500).json({
      error: "Failed to load integrations",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// ====================== PUT /integrations/:channel ======================
router.put("/integrations/:channel", adminOnly, async (req, res) => {
  const { channel } = req.params;

  // Validate against DB list (with legacy fallback)
  const activeChannels = await getActiveChannelKeys();
  if (!activeChannels.includes(channel)) {
    return res.status(400).json({ error: "invalid integration channel" });
  }

  const rawConfig = req.body?.configJson ?? req.body?.config ?? req.body;
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return res.status(400).json({ error: "config object required" });
  }

  const isActive =
    typeof req.body?.isActive === "boolean" ? req.body.isActive : true;
  const updatedBy =
    req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();
    const json = JSON.stringify(rawConfig);

    await pool
      .request()
      .input("Channel",    sql.NVarChar(50),       channel)
      .input("ConfigJson", sql.NVarChar(sql.MAX),   json)
      .input("IsActive",   sql.Bit,                 isActive ? 1 : 0)
      .input("UpdatedBy",  sql.NVarChar(100),       String(updatedBy))
      .query(`
        MERGE dbo.CommunicatorConfig AS target
        USING (
          VALUES (@Channel, @ConfigJson, @IsActive, @UpdatedBy)
        ) AS source (Channel, ConfigJson, IsActive, UpdatedBy)
        ON target.Channel = source.Channel
        WHEN MATCHED THEN
          UPDATE SET
            ConfigJson = source.ConfigJson,
            IsActive   = source.IsActive,
            UpdatedBy  = source.UpdatedBy,
            UpdatedAt  = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (Channel, ConfigJson, IsActive, CreatedAt, UpdatedAt, UpdatedBy)
          VALUES (
            source.Channel,
            source.ConfigJson,
            source.IsActive,
            GETDATE(),
            GETDATE(),
            source.UpdatedBy
          );
      `);

    res.json({ success: true, channel, isActive });
  } catch (err) {
    console.error("🔥 ERROR in PUT /integrations/:channel:", err);
    if (req.log) req.log.error(err, `Failed to update integration ${channel}`);
    res.status(500).json({ error: err.message });
  }
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
