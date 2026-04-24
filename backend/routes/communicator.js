const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET config by channel (email | sms | whatsapp)
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
    res.status(500).json({ error: err.message });
  }
});

// PUT upsert config by channel
router.put("/:channel", adminOnly, async (req, res) => {
  const { channel } = req.params;
  const { config } = req.body;
  if (!config || typeof config !== "object")
    return res.status(400).json({ error: "config object required" });
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
          UPDATE SET ConfigJson = source.ConfigJson, UpdatedAt = GETDATE(), IsActive = 1
        WHEN NOT MATCHED THEN
          INSERT (Channel, ConfigJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (source.Channel, source.ConfigJson, 1, GETDATE(), GETDATE());
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
