const { requirePageRight } = require("../middleware/requirePageRight");
// routes/paymentPlanMaster.js  — flat PaymentTermMaster CRUD
// Mounted at: /api/payment-plan-master  (no server.js change needed)
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const CACHE_KEY = "payment-term-master";
bumpCacheVersion(CACHE_KEY).catch(() => {});

async function hasColumn(pool, tableName, columnName) {
  const result = await pool
    .request()
    .input("TableName", sql.NVarChar(128), tableName)
    .input("ColumnName", sql.NVarChar(128), columnName).query(`
      SELECT 1 AS found
      FROM sys.columns
      WHERE object_id = OBJECT_ID(@TableName)
        AND name = @ColumnName
    `);
  return !!result.recordset[0];
}

// ── GET all ──────────────────────────────────────────────────────────────────
router.get("/", cache(CACHE_KEY, 300), async (req, res) => {
  try {
    const pool = getPool();
    const hasCreditDays = await hasColumn(pool, "dbo.PaymentTermMaster", "CreditDays");
    const result = await pool.request().query(`
      SELECT TermID, TermName, ValueType, TermValue,
             ${hasCreditDays ? "CreditDays" : "CAST(NULL AS INT) AS CreditDays"},
             IsActive, CreatedAt, UpdatedAt
      FROM dbo.PaymentTermMaster
      ORDER BY TermName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[payment-term-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET single ───────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool
      .request()
      .input("TermID", sql.Int, id)
      .query("SELECT * FROM dbo.PaymentTermMaster WHERE TermID = @TermID");
    if (!r.recordset.length)
      return res.status(404).json({ error: "Not found" });
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST ─────────────────────────────────────────────────────────────────────
router.post("/", requirePageRight("payment-plan-master", "create"), async (req, res) => {
  const { TermName, ValueType, TermValue, CreditDays } = req.body;
  if (!TermName?.trim())
    return res.status(400).json({ error: "TermName is required" });
  const validTypes = ["percent", "fixed"];
  if (!validTypes.includes(ValueType))
    return res
      .status(400)
      .json({ error: "ValueType must be percent or fixed" });
  const val = parseFloat(TermValue);
  if (isNaN(val) || val < 0)
    return res.status(400).json({ error: "TermValue must be >= 0" });
  const creditDays =
    CreditDays === undefined || CreditDays === null || CreditDays === ""
      ? null
      : parseInt(CreditDays, 10);
  if (creditDays !== null && (!Number.isFinite(creditDays) || creditDays < 0))
    return res.status(400).json({ error: "CreditDays must be >= 0" });

  try {
    const pool = getPool();
    const hasCreditDays = await hasColumn(pool, "dbo.PaymentTermMaster", "CreditDays");
    const request = pool
      .request()
      .input("TermName", sql.NVarChar(200), TermName.trim())
      .input("ValueType", sql.NVarChar(20), ValueType)
      .input("TermValue", sql.Decimal(18, 4), val)
      .input("CreatedBy", sql.Int, req.user?.userId || null)
      .input("CreatedAt", sql.DateTime2(3), new Date());
    if (hasCreditDays) request.input("CreditDays", sql.Int, creditDays);
    const r = await request.query(`
        INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, ${hasCreditDays ? "CreditDays, " : ""}CreatedBy, CreatedAt)
        OUTPUT INSERTED.*
        VALUES (@TermName, @ValueType, @TermValue, ${hasCreditDays ? "@CreditDays, " : ""}@CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion(CACHE_KEY);
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT ──────────────────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("payment-plan-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  const { TermName, ValueType, TermValue, CreditDays, IsActive } = req.body;
  const sets = [];
  const pool = await getPool();
  const hasCreditDays = await hasColumn(pool, "dbo.PaymentTermMaster", "CreditDays");
  const request = pool.request().input("TermID", sql.Int, id);

  if (TermName !== undefined) {
    if (!TermName?.trim())
      return res.status(400).json({ error: "TermName cannot be empty" });
    sets.push("TermName = @TermName");
    request.input("TermName", sql.NVarChar(200), TermName.trim());
  }
  if (ValueType !== undefined) {
    const validTypes = ["percent", "fixed"];
    if (!validTypes.includes(ValueType))
      return res.status(400).json({ error: "Invalid ValueType" });
    sets.push("ValueType = @ValueType");
    request.input("ValueType", sql.NVarChar(20), ValueType);
  }
  if (TermValue !== undefined) {
    const val = parseFloat(TermValue);
    if (isNaN(val) || val < 0)
      return res.status(400).json({ error: "TermValue must be >= 0" });
    sets.push("TermValue = @TermValue");
    request.input("TermValue", sql.Decimal(18, 4), val);
  }
  if (CreditDays !== undefined && hasCreditDays) {
    const creditDays =
      CreditDays === null || CreditDays === ""
        ? null
        : parseInt(CreditDays, 10);
    if (creditDays !== null && (!Number.isFinite(creditDays) || creditDays < 0))
      return res.status(400).json({ error: "CreditDays must be >= 0" });
    sets.push("CreditDays = @CreditDays");
    request.input("CreditDays", sql.Int, creditDays);
  }
  if (IsActive !== undefined) {
    sets.push("IsActive = @IsActive");
    request.input("IsActive", sql.Bit, IsActive ? 1 : 0);
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });

  sets.push("UpdatedAt = @UpdatedAt", "UpdatedBy = @UpdatedBy");
  request
    .input("UpdatedAt", sql.DateTime2(3), new Date())
    .input("UpdatedBy", sql.Int, req.user?.userId || null);

  try {
    const r = await request.query(`
      UPDATE dbo.PaymentTermMaster
      SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE TermID = @TermID
    `);
    if (!r.recordset.length)
      return res.status(404).json({ error: "Not found" });
    await bumpCacheVersion(CACHE_KEY);
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE — hard if unused, soft otherwise ──────────────────────────────────
router.delete("/:id", requirePageRight("payment-plan-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("TermID", sql.Int, id)
      .query(
        "SELECT TermName FROM dbo.PaymentTermMaster WHERE TermID = @TermID",
      );
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Not found" });

    await pool
      .request()
      .input("TermID", sql.Int, id)
      .query("DELETE FROM dbo.PaymentTermMaster WHERE TermID = @TermID");
    await bumpCacheVersion(CACHE_KEY);
    res.json({ message: "Term deleted", softDeleted: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




