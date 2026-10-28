/**
 * Bulk lead import — a lead export from Meta, Google, a portal or any sheet, uploaded on
 * Sales Automation → Leads. The page reads the file and sends its headings and rows here;
 * matching headings to lead fields, cleaning values and every check happen here, through
 * the same create path as a lead typed in by hand (saLeadCreate.js).
 *
 *  GET  /fields   — the fields a column can fill, and the batch size
 *  POST /mapping  — { headings } → how they match: remembered from last time, else recognised by name
 *  POST /run      — { headings, mapping, rows, source, sendWelcome, dryRun } → a result per row
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { createLead } = require("../services/saLeadCreate");
const { IMPORT_FIELDS, IMPORT_BATCH, headingKey } = require("../constants/saLeadImport");

router.use(authMiddleware);
router.use(apiRateLimit);

const FIELD_KEYS = new Set(IMPORT_FIELDS.map((f) => f.key));
// The source picked for the whole file — the only lead fields not taken from the columns.
const SOURCE_KEYS = ["SourceType", "PlatformId", "CampaignId", "AdId", "ChannelPartnerId"];

const headingsHash = (headings) =>
  crypto.createHash("sha256").update([...new Set(headings.map(headingKey))].sort().join("|")).digest("hex");

/** Recognises each heading by name; a field is given to the first heading that matches it. */
function autoMapping(headings) {
  const taken = new Set();
  const mapping = {};
  for (const h of headings) {
    const k = headingKey(h);
    const field = IMPORT_FIELDS.find((f) => !taken.has(f.key) && f.headings.some((x) => headingKey(x) === k));
    if (field) {
      mapping[h] = field.key;
      taken.add(field.key);
    }
  }
  return mapping;
}

// Values as exports write them → what a lead holds.
const CLEAN = {
  Mobile: (v) => v.replace(/^p:/i, ""),       // Meta writes "p:+919876543210"
  AltMobile: (v) => v.replace(/^p:/i, ""),
  BudgetMin: (v) => (v.replace(/[^\d.]/g, "") || null),
  BudgetMax: (v) => (v.replace(/[^\d.]/g, "") || null),
  CapturedAt: (v) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
};

function rowToLead(headings, mapping, cells) {
  const lead = {};
  headings.forEach((h, i) => {
    const field = mapping[h];
    const raw = String(cells?.[i] ?? "").trim();
    if (!field || !FIELD_KEYS.has(field) || !raw || lead[field]) return;
    lead[field] = CLEAN[field] ? CLEAN[field](raw) : raw;
  });
  return lead;
}

router.get("/fields", requirePageRight("sa-leads", "create"), (req, res) => {
  res.json({ fields: IMPORT_FIELDS.map(({ key, label, required }) => ({ key, label, required })), batch: IMPORT_BATCH });
});

router.post("/mapping", requirePageRight("sa-leads", "create"), async (req, res) => {
  const headings = Array.isArray(req.body?.headings) ? req.body.headings.map(String) : [];
  if (!headings.length) return res.status(400).json({ error: "The file has no column headings" });
  try {
    const r = await getPool().request().input("k", sql.Char(64), headingsHash(headings))
      .query("SELECT MappingJson, SourceJson FROM dbo.SaLeadImportMapping WHERE HeadingsKey = @k");
    const saved = r.recordset[0];
    if (saved) {
      const mapping = JSON.parse(saved.MappingJson || "{}");
      return res.json({ mapping, source: JSON.parse(saved.SourceJson || "null"), remembered: true });
    }
    res.json({ mapping: autoMapping(headings), source: null, remembered: false });
  } catch (e) {
    console.error("[sa-lead-import] mapping error:", e.message);
    res.status(500).json({ error: "Could not read the saved column matches" });
  }
});

router.post("/run", requirePageRight("sa-leads", "create"), async (req, res) => {
  const b = req.body || {};
  const headings = Array.isArray(b.headings) ? b.headings.map(String) : [];
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const mapping = b.mapping && typeof b.mapping === "object" ? b.mapping : {};
  const dryRun = b.dryRun !== false;
  if (!headings.length) return res.status(400).json({ error: "The file has no column headings" });
  if (rows.length > IMPORT_BATCH) return res.status(400).json({ error: `Send at most ${IMPORT_BATCH} rows at a time` });
  if (!Object.values(mapping).includes("Mobile")) return res.status(400).json({ error: "Choose which column holds the mobile number" });
  const source = Object.fromEntries(SOURCE_KEYS.filter((k) => b.source?.[k]).map((k) => [k, b.source[k]]));

  try {
    const pool = getPool();
    const actor = actorId(req);
    const seen = new Map(); // mobile → row number, for repeats inside this batch
    const results = [];
    for (const [i, cells] of rows.entries()) {
      const rowNo = Number(b.firstRowNo || 1) + i;
      const lead = { ...rowToLead(headings, mapping, cells), ...source };
      const check = await createLead(pool, lead, actor, { dryRun: true });
      if (check.error) {
        results.push({ rowNo, status: check.status === 409 ? "existing" : "error", reason: check.error, mobile: lead.Mobile || "" });
        continue;
      }
      const mobile = check.value.Mobile;
      if (seen.has(mobile)) {
        results.push({ rowNo, status: "repeat", reason: `Same mobile as row ${seen.get(mobile)} in this file`, mobile });
        continue;
      }
      seen.set(mobile, rowNo);
      if (dryRun) {
        results.push({ rowNo, status: "new", mobile, name: check.value.CustomerName || "" });
        continue;
      }
      const made = await createLead(pool, lead, actor, { welcome: b.sendWelcome === true });
      results.push(made.error
        ? { rowNo, status: made.status === 409 ? "existing" : "error", reason: made.error, mobile }
        : { rowNo, status: "added", mobile, leadUid: made.uid });
    }

    // Remember how this file's columns matched (and its source) once something is imported.
    if (!dryRun) {
      await pool.request()
        .input("k", sql.Char(64), headingsHash(headings))
        .input("m", sql.NVarChar(sql.MAX), JSON.stringify(mapping))
        .input("s", sql.NVarChar(sql.MAX), JSON.stringify(source))
        .input("u", sql.Int, actor)
        .query(`
          MERGE dbo.SaLeadImportMapping AS t
          USING (SELECT @k AS HeadingsKey) AS s ON t.HeadingsKey = s.HeadingsKey
          WHEN MATCHED THEN UPDATE SET MappingJson = @m, SourceJson = @s, UsedCount = t.UsedCount + 1, UpdatedBy = @u, UpdatedAt = SYSDATETIME()
          WHEN NOT MATCHED THEN INSERT (HeadingsKey, MappingJson, SourceJson, UsedCount, UpdatedBy) VALUES (@k, @m, @s, 1, @u);
        `);
    }
    res.json({ results });
  } catch (e) {
    console.error("[sa-lead-import] run error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
