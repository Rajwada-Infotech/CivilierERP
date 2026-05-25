// routes/paymentPlanMaster.js  — flat PaymentTermMaster CRUD
// Mounted at: /api/payment-plan-master  (no server.js change needed)
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

const CACHE_KEY = "payment-term-master";
bumpCacheVersion(CACHE_KEY).catch(() => {});

// ── GET all ──────────────────────────────────────────────────────────────────
router.get("/", cache(CACHE_KEY, 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TermID, TermName, ValueType, TermValue, IsActive, CreatedAt, UpdatedAt
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
router.post("/", async (req, res) => {
  const { TermName, ValueType, TermValue } = req.body;
  if (!TermName?.trim())
    return res.status(400).json({ error: "TermName is required" });
  const validTypes = ["percent", "fixed", "deduction"];
  if (!validTypes.includes(ValueType))
    return res
      .status(400)
      .json({ error: "ValueType must be percent, fixed, or deduction" });
  const val = parseFloat(TermValue);
  if (isNaN(val) || val < 0)
    return res.status(400).json({ error: "TermValue must be >= 0" });

  try {
    const pool = getPool();
    const r = await pool
      .request()
      .input("TermName", sql.NVarChar(200), TermName.trim())
      .input("ValueType", sql.NVarChar(20), ValueType)
      .input("TermValue", sql.Decimal(18, 4), val)
      .input("CreatedBy", sql.Int, req.user?.userId || null)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreatedBy, CreatedAt)
        OUTPUT INSERTED.*
        VALUES (@TermName, @ValueType, @TermValue, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion(CACHE_KEY);
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT ──────────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  const { TermName, ValueType, TermValue, IsActive } = req.body;
  const sets = [];
  const request = (await getPool()).request().input("TermID", sql.Int, id);

  if (TermName !== undefined) {
    if (!TermName?.trim())
      return res.status(400).json({ error: "TermName cannot be empty" });
    sets.push("TermName = @TermName");
    request.input("TermName", sql.NVarChar(200), TermName.trim());
  }
  if (ValueType !== undefined) {
    const validTypes = ["percent", "fixed", "deduction"];
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
router.delete("/:id", async (req, res) => {
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
