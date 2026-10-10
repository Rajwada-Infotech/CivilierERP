// GST Rule master — CRUD over dbo.CrmGstRule (migrations 507, 526).
//
// A rule only chooses WHICH HSN governs an amount; the rate lives on the HSN
// row (dbo.HSN), so rates are changed in one place — HSN Master. Rules are
// matched by services/gstRules.js: same AppliesTo, amount inside the band
// (MinValue exclusive, MaxValue inclusive), land-ownership and usage
// qualifiers (NULL = any), most specific first, then Priority.
//
// Deletes are SOFT (IsActive = 0): a rule decided the tax on past bookings,
// so it is retired, never erased.

const express = require("express");
const router = express.Router();
const rateLimit = require("../middleware/rateLimiter");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { APPLIES_TO } = require("../services/gstRules");

router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const PAGE = "crm-gst-rule-master";

// NULL / "" = any; true/"1"/"yes" = 1; false/"0"/"no" = 0.
const triState = (v) => {
  if (v === undefined || v === null || v === "" || v === "any") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "commercial", "customer"].includes(s)) return 1;
  if (["0", "false", "no", "residential", "company"].includes(s)) return 0;
  return null;
};
// Migration 526 adds ForCommercial. Until it has run, say so plainly rather
// than failing every request with an opaque 500.
async function schemaProblem(pool) {
  const r = await pool.request().query(`
    SELECT OBJECT_ID('dbo.CrmGstRule') AS T,
           COL_LENGTH('dbo.CrmGstRule', 'ForCommercial') AS C`);
  if (!r.recordset[0].T) return "GST rule table is missing — run database migration 507.";
  if (r.recordset[0].C == null) return "Database is not up to date — run migration 526 (commercial usage) and reload.";
  return null;
}

const money = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

router.get("/", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const problem = await schemaProblem(getPool());
    if (problem) return res.status(409).json({ error: problem });
    const r = await getPool().request().query(`
      SELECT r.Id, r.Name, r.AppliesTo, r.HsnCode, r.MinValue, r.MaxValue,
             r.LandOwnedByCustomer, r.ForCommercial, r.Priority, r.IsActive, r.Notes,
             h.HDescription AS HsnDescription, h.HIGST AS HsnRate
      FROM dbo.CrmGstRule r
      LEFT JOIN dbo.HSN h ON h.HCode = r.HsnCode AND h.HStatus = 1
      ORDER BY r.IsActive DESC, r.AppliesTo, r.Priority, r.Id`);
    res.json(r.recordset);
  } catch (e) {
    console.error("[crm-gst-rule] GET:", e.message);
    res.status(500).json({ error: `Failed to load GST rules: ${e.message}` });
  }
});

// What a rule can be for, and which HSN codes exist. "Applies to" values are
// the supply categories the GST engine actually looks up (services/gstRules.js)
// plus any already used in the table; HSN codes come from HSN Master.
router.get("/options", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    const [used, hsn] = await Promise.all([
      pool.request().query("SELECT DISTINCT AppliesTo FROM dbo.CrmGstRule"),
      // Only what a sale can be: service (SAC) codes, as flagged in HSN Master
      // (HIsSAC), plus any code a rule already uses. Goods HSNs (cement, sand…)
      // are purchases, never a CRM sale. If no code is flagged SAC yet, all
      // active codes are offered rather than an empty list.
      pool.request().query(`
        SELECT HCode, HDescription, HIGST FROM dbo.HSN h
        WHERE h.HStatus = 1
          AND (h.HIsSAC = 1
               OR h.HCode IN (SELECT HsnCode FROM dbo.CrmGstRule WHERE HsnCode IS NOT NULL)
               OR NOT EXISTS (SELECT 1 FROM dbo.HSN s WHERE s.HStatus = 1 AND s.HIsSAC = 1))
        ORDER BY HCode`),
    ]);
    const appliesTo = [...new Set([...Object.values(APPLIES_TO), ...used.recordset.map((x) => x.AppliesTo)])].sort();
    // Coverage check: commercial units exist but no active rule targets them
    // -> they are taxed with the residential rules until one is added.
    const cov = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.UnitMaster u JOIN dbo.CrmConstructedAssetKind k ON k.Code = u.UnitKind
          WHERE u.IsActive = 1 AND k.IsCommercial = 1) AS CommercialUnits,
        (SELECT COUNT(*) FROM dbo.CrmGstRule WHERE IsActive = 1 AND ForCommercial = 1) AS CommercialRules`)
      .then((r) => r.recordset[0]).catch(() => ({ CommercialUnits: 0, CommercialRules: 0 })); // pre-526: nothing to check
    res.json({
      coverage: { commercialUnits: cov.CommercialUnits, commercialRules: cov.CommercialRules },
      appliesTo,
      hsn: hsn.recordset.map((h) => ({ code: h.HCode, label: `${h.HCode} — ${h.HDescription || ""} (${Number(h.HIGST) || 0}%)` })),
    });
  } catch (e) {
    console.error("[crm-gst-rule] GET options:", e.message);
    res.status(500).json({ error: "Failed to load GST rule options" });
  }
});

async function validate(pool, b) {
  const name = String(b.Name || "").trim();
  const appliesTo = String(b.AppliesTo || "").trim().toUpperCase();
  const hsnCode = String(b.HsnCode || "").trim();
  if (!name) return { error: "Name is required" };
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(appliesTo)) return { error: "Applies To is required (letters, numbers, underscores)" };
  if (!hsnCode) return { error: "HSN code is required" };
  const h = await pool.request().input("c", sql.VarChar(20), hsnCode)
    .query("SELECT TOP 1 HCode FROM dbo.HSN WHERE HCode = @c AND HStatus = 1");
  if (!h.recordset.length) return { error: `HSN "${hsnCode}" is not an active code in HSN Master` };
  const min = money(b.MinValue), max = money(b.MaxValue);
  if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) return { error: "Band values must be numbers" };
  if (min != null && max != null && max <= min) return { error: "Max value must be greater than Min value" };
  const priority = b.Priority === undefined || b.Priority === "" ? 100 : parseInt(b.Priority, 10);
  if (!Number.isInteger(priority)) return { error: "Priority must be a whole number" };
  return {
    name, appliesTo, hsnCode, min, max, priority,
    land: triState(b.LandOwnedByCustomer),
    commercial: triState(b.ForCommercial),
    isActive: b.IsActive === false || b.IsActive === 0 || b.IsActive === "false" ? 0 : 1,
    notes: b.Notes ? String(b.Notes).slice(0, 500) : null,
  };
}

const bind = (r, v, req) => r
  .input("name", sql.NVarChar(150), v.name)
  .input("applies", sql.NVarChar(40), v.appliesTo)
  .input("hsn", sql.VarChar(20), v.hsnCode)
  .input("min", sql.Decimal(18, 2), v.min)
  .input("max", sql.Decimal(18, 2), v.max)
  .input("land", sql.Bit, v.land)
  .input("comm", sql.Bit, v.commercial)
  .input("prio", sql.Int, v.priority)
  .input("active", sql.Bit, v.isActive)
  .input("notes", sql.NVarChar(500), v.notes)
  .input("by", sql.Int, req.user?.userId ?? req.user?.id ?? null);

router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  try {
    const pool = getPool();
    const problem = await schemaProblem(pool);
    if (problem) return res.status(409).json({ error: problem });
    const v = await validate(pool, req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const r = await bind(pool.request(), v, req).query(`
      INSERT INTO dbo.CrmGstRule (Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, ForCommercial, Priority, IsActive, Notes, CreatedBy)
      OUTPUT INSERTED.Id
      VALUES (@name, @applies, @hsn, @min, @max, @land, @comm, @prio, @active, @notes, @by)`);
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error("[crm-gst-rule] POST:", e.message);
    res.status(500).json({ error: "Failed to create GST rule" });
  }
});

router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const v = await validate(pool, req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const r = await bind(pool.request().input("id", sql.Int, id), v, req).query(`
      UPDATE dbo.CrmGstRule SET
        Name = @name, AppliesTo = @applies, HsnCode = @hsn, MinValue = @min, MaxValue = @max,
        LandOwnedByCustomer = @land, ForCommercial = @comm, Priority = @prio, IsActive = @active,
        Notes = @notes, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "GST rule not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-gst-rule] PUT:", e.message);
    res.status(500).json({ error: "Failed to update GST rule" });
  }
});

router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("id", sql.Int, id).input("by", sql.Int, req.user?.userId ?? null)
      .query("UPDATE dbo.CrmGstRule SET IsActive = 0, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "GST rule not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-gst-rule] DELETE:", e.message);
    res.status(500).json({ error: "Failed to retire GST rule" });
  }
});

module.exports = router;
