const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const {
  communicatorConfigSchema,
} = require("../validation/communicatorSchemas");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

const INTEGRATION_CHANNELS = [
  "payment-gateway",
  "sms-api",
  "whatsapp-api",
  "email-api",
  "push-notifications",
];

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

// ====================== FIXED GET /integrations ======================
router.get("/integrations", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();

    // Bind parameters
    INTEGRATION_CHANNELS.forEach((channel, index) => {
      request.input(`Channel${index}`, sql.NVarChar(50), channel);
    });
    request.input("LegacyChannel", sql.NVarChar(50), "integrations");

    // FIXED QUERY - Removed UpdatedBy because column doesn't exist
    const result = await request.query(`
      SELECT
        Channel,
        ConfigJson,
        IsActive,
        UpdatedAt          -- Keep only if this column exists, otherwise remove it too
      FROM dbo.CommunicatorConfig
      WHERE Channel IN (${INTEGRATION_CHANNELS.map((_, index) => `@Channel${index}`).join(", ")}, @LegacyChannel)
    `);

    const byChannel = new Map(
      result.recordset.map((row) => [
        row.Channel,
        {
          channel: row.Channel,
          configJson: parseConfigJson(row.ConfigJson),
          isActive: !!row.IsActive,
          updatedBy: null, // Column doesn't exist yet
          updatedAt: row.UpdatedAt || null,
        },
      ]),
    );

    // Build integrations list
    const integrations = INTEGRATION_CHANNELS.map((channel) => {
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

    const legacyApis = Array.isArray(legacyConfig.apis)
      ? legacyConfig.apis
      : [];

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

  if (!INTEGRATION_CHANNELS.includes(channel)) {
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
      .input("Channel", sql.NVarChar(50), channel)
      .input("ConfigJson", sql.NVarChar(sql.MAX), json)
      .input("IsActive", sql.Bit, isActive ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy)).query(`
        MERGE dbo.CommunicatorConfig AS target
        USING (
          VALUES (@Channel, @ConfigJson, @IsActive, @UpdatedBy)
        ) AS source (Channel, ConfigJson, IsActive, UpdatedBy)
        ON target.Channel = source.Channel
        WHEN MATCHED THEN
          UPDATE SET
            ConfigJson = source.ConfigJson,
            IsActive = source.IsActive,
            UpdatedBy = source.UpdatedBy,
            UpdatedAt = GETDATE()
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

// Other routes (unchanged for now)
router.get("/:channel", adminOnly, async (req, res) => {
  const { channel } = req.params;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Channel", sql.NVarChar(50), channel).query(`
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
      .input("Channel", sql.NVarChar(50), channel)
      .input("ConfigJson", sql.NVarChar(sql.MAX), json).query(`
        MERGE dbo.CommunicatorConfig AS target
        USING (VALUES (@Channel, @ConfigJson)) AS source (Channel, ConfigJson)
        ON target.Channel = source.Channel
        WHEN MATCHED THEN
          UPDATE SET
            ConfigJson = source.ConfigJson,
            UpdatedAt = GETDATE(),
            IsActive = 1
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
