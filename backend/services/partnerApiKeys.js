/**
 * Channel partners' API keys (dbo.SaChannelPartnerApiKey). A key is
 * "cp_" + 40 random hex characters; only its SHA-256 hash is stored, plus a
 * short prefix so people can tell keys apart. The key itself is shown once.
 */
const crypto = require("crypto");
const { sql } = require("../db");

const PREFIX_LENGTH = 10; // "cp_" + 7 characters

// What a partner may send per lead — everything else (status, assignment, source) is ours to set.
const PARTNER_FIELDS = [
  "CustomerName", "Mobile", "AltMobile", "Email", "CustomerRemarks",
  "BudgetMin", "BudgetMax", "PropertyType", "BhkPreference", "PreferredLocation", "PurchaseTimeline",
  "ExternalLeadId",
];
const MAX_BATCH = 100; // leads per request
const REQUESTS_PER_MINUTE = 60; // per key

const hashKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");

function newKey() {
  const key = `cp_${crypto.randomBytes(20).toString("hex")}`;
  return { key, prefix: key.slice(0, PREFIX_LENGTH), hash: hashKey(key) };
}

/** The active key's partner, or null. Marks the key used. */
async function partnerForKey(pool, key) {
  if (!key || typeof key !== "string" || key.length > 200) return null;
  const r = await pool.request().input("h", sql.Char(64), hashKey(key.trim())).query(`
    SELECT k.Id AS KeyId, p.Id AS ChannelPartnerId, p.Name, p.CreatedBy
    FROM dbo.SaChannelPartnerApiKey k
    JOIN dbo.SaChannelPartner p ON p.Id = k.ChannelPartnerId
    WHERE k.KeyHash = @h AND k.IsActive = 1 AND p.IsActive = 1
  `);
  return r.recordset[0] || null;
}

async function recordUse(pool, keyId, leadsAdded) {
  await pool.request().input("id", sql.Int, keyId).input("n", sql.Int, leadsAdded).query(`
    UPDATE dbo.SaChannelPartnerApiKey SET LastUsedAt = SYSDATETIME(), LeadsReceived = LeadsReceived + @n WHERE Id = @id
  `);
}

module.exports = { newKey, partnerForKey, recordUse, PARTNER_FIELDS, MAX_BATCH, REQUESTS_PER_MINUTE };
