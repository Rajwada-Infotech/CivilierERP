/**
 * POST /api/public/partner-leads — a channel partner's system pushes leads in.
 * No staff login: the partner sends its API key (made in Admin → Integrations)
 * in the X-Api-Key header. Body is one lead or { leads: [...] } (up to MAX_BATCH).
 * Each lead goes through the same create path as manual entry (saLeadCreate.js):
 * same validation, same duplicate-mobile check, same welcome message — tagged
 * to the partner as a Referral.
 */
const express = require("express");
const crypto = require("crypto");
const rateLimit = require("../middleware/rateLimiter");
const { getPool } = require("../db");
const { createLead } = require("../services/saLeadCreate");
const { partnerForKey, recordUse, PARTNER_FIELDS, MAX_BATCH, REQUESTS_PER_MINUTE } = require("../services/partnerApiKeys");

const router = express.Router();

// Counted per API key (a hash of it — the key itself isn't kept in memory) so one partner
// can't use up another's allowance; requests without a key count by address.
const partnerLimiter = rateLimit({
  windowMs: 60_000,
  max: REQUESTS_PER_MINUTE,
  keyGenerator: (req) => {
    const key = req.get("x-api-key");
    return key ? `partner-key:${crypto.createHash("sha256").update(key).digest("hex")}` : `ip:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — wait a minute and try again" },
});

router.post("/", partnerLimiter, async (req, res) => {
  try {
    const pool = getPool();
    const partner = await partnerForKey(pool, req.get("x-api-key"));
    if (!partner) return res.status(401).json({ error: "Missing, wrong or revoked API key (send it in the X-Api-Key header)" });

    const incoming = Array.isArray(req.body?.leads) ? req.body.leads : [req.body];
    if (!incoming.length || incoming.some((l) => !l || typeof l !== "object")) {
      return res.status(400).json({ error: "Send one lead, or { leads: [ ... ] }" });
    }
    if (incoming.length > MAX_BATCH) return res.status(400).json({ error: `At most ${MAX_BATCH} leads per request` });

    const results = [];
    for (const [index, raw] of incoming.entries()) {
      const lead = Object.fromEntries(PARTNER_FIELDS.filter((f) => raw[f] !== undefined).map((f) => [f, raw[f]]));
      const r = await createLead(pool, { ...lead, SourceType: "Referral", ChannelPartnerId: partner.ChannelPartnerId }, null);
      results.push(r.error
        ? { index, ok: false, error: r.error, duplicate: r.status === 409 }
        : { index, ok: true, leadUid: r.uid });
    }
    const added = results.filter((r) => r.ok).length;
    await recordUse(pool, partner.KeyId, added);

    const single = !Array.isArray(req.body?.leads);
    if (single) {
      const r = results[0];
      return r.ok ? res.status(201).json(r) : res.status(r.duplicate ? 409 : 400).json(r);
    }
    res.status(added ? 201 : 400).json({ added, rejected: results.length - added, results });
  } catch (err) {
    console.error("[public-partner-leads] error:", err.message);
    res.status(500).json({ error: "Could not take the leads — try again later" });
  }
});

module.exports = router;
