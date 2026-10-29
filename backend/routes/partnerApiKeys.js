// Admin → Integrations: API keys channel partners use to push leads in.
const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { newKey, PARTNER_FIELDS, MAX_BATCH, REQUESTS_PER_MINUTE } = require("../services/partnerApiKeys");

const router = express.Router();
router.use(authMiddleware);
router.use(apiRateLimit);

const PAGE = "api-integration";

// GET / — every key (never the key itself) and the partners a key can be made for.
router.get("/", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [keys, partners] = await Promise.all([
      pool.request().query(`
        SELECT k.Id, k.ChannelPartnerId, p.Name AS PartnerName, p.PartnerCode, k.Label, k.KeyPrefix,
               k.IsActive, k.LastUsedAt, k.LeadsReceived, k.CreatedAt, k.RevokedAt,
               cu.name AS CreatedByName, ru.name AS RevokedByName
        FROM dbo.SaChannelPartnerApiKey k
        JOIN dbo.SaChannelPartner p ON p.Id = k.ChannelPartnerId
        LEFT JOIN dbo.users cu ON cu.id = k.CreatedBy
        LEFT JOIN dbo.users ru ON ru.id = k.RevokedBy
        ORDER BY k.IsActive DESC, k.CreatedAt DESC
      `),
      pool.request().query("SELECT Id, Name, PartnerCode FROM dbo.SaChannelPartner WHERE IsActive = 1 ORDER BY Name"),
    ]);
    res.json({
      keys: keys.recordset,
      partners: partners.recordset,
      api: { fields: PARTNER_FIELDS, required: ["Mobile"], maxBatch: MAX_BATCH, requestsPerMinute: REQUESTS_PER_MINUTE },
    });
  } catch (err) {
    console.error("[partner-api-keys] GET error:", err.message);
    res.status(500).json({ error: "Could not read the partner keys" });
  }
});

// POST / { channelPartnerId, label? } — makes a key; the response is the only time it is shown.
router.post("/", requirePageRight(PAGE, "edit"), async (req, res) => {
  const partnerId = parseId(req.body?.channelPartnerId);
  if (partnerId === null) return res.status(400).json({ error: "Choose a channel partner" });
  const label = String(req.body?.label || "").trim().slice(0, 100) || null;
  try {
    const pool = getPool();
    const partner = await pool.request().input("id", sql.Int, partnerId)
      .query("SELECT Name FROM dbo.SaChannelPartner WHERE Id = @id AND IsActive = 1");
    if (!partner.recordset.length) return res.status(400).json({ error: "That channel partner does not exist or is inactive" });

    const k = newKey();
    await pool.request()
      .input("pid", sql.Int, partnerId)
      .input("label", sql.NVarChar(100), label)
      .input("prefix", sql.NVarChar(16), k.prefix)
      .input("hash", sql.Char(64), k.hash)
      .input("cb", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.SaChannelPartnerApiKey (ChannelPartnerId, Label, KeyPrefix, KeyHash, CreatedBy)
        VALUES (@pid, @label, @prefix, @hash, @cb)
      `);
    res.status(201).json({ key: k.key, prefix: k.prefix, partnerName: partner.recordset[0].Name });
  } catch (err) {
    console.error("[partner-api-keys] POST error:", err.message);
    res.status(500).json({ error: "Could not make the key" });
  }
});

// POST /:id/revoke — the key stops working at once. Kept (not deleted) so its history stays.
router.post("/:id/revoke", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request()
      .input("id", sql.Int, id)
      .input("rb", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.SaChannelPartnerApiKey SET IsActive = 0, RevokedAt = SYSDATETIME(), RevokedBy = @rb
        WHERE Id = @id AND IsActive = 1
      `);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Key not found or already revoked" });
    res.json({ success: true });
  } catch (err) {
    console.error("[partner-api-keys] revoke error:", err.message);
    res.status(500).json({ error: "Could not revoke the key" });
  }
});

module.exports = router;
