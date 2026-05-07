const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

// ─── Helper: parse a value as a positive integer, or return null ──────────────
function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── GET all debit notes ──────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        dn.id,
        dn.company_id,
        dn.project_id,
        dn.supplier_id,
        dn.bill_id,
        dn.is_active,
        dn.created_by,
        dn.created_at,
        dn.updated_at,

        u.name AS created_by_name,
        u.email AS created_by_email


      FROM dbo.DebitNote dn
      LEFT JOIN dbo.users u ON u.id = dn.created_by

      ORDER BY dn.id DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADD debit note ───────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { company_id, project_id, supplier_id, bill_id, is_active } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const supplier_id_val = toInt(supplier_id);
  const bill_id_val = toInt(bill_id);

  const missing = [];
  if (!company_id_val) missing.push("company_id");
  if (!project_id_val) missing.push("project_id");
  if (!supplier_id_val) missing.push("supplier_id");
  if (!bill_id_val) missing.push("bill_id");

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing or invalid required fields: ${missing.join(", ")}`,
    });
  }

  try {
    const pool = getPool();
    const createdBy = req.user?.userId ?? null;

    const result = await pool
      .request()
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, supplier_id_val)
      .input("bill_id", sql.Int, bill_id_val)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("created_by", sql.Int, createdBy)
      .input("created_at", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.DebitNote
          (company_id, project_id, supplier_id, bill_id, is_active, created_by, created_at)
        OUTPUT INSERTED.id
        VALUES
          (@company_id, @project_id, @supplier_id, @bill_id, @is_active, @created_by, @created_at)
      `);

    const newId = result.recordset[0]?.id;
    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note added successfully", id: newId });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE debit note ────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { company_id, project_id, supplier_id, bill_id, is_active } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const supplier_id_val = toInt(supplier_id);
  const bill_id_val = toInt(bill_id);

  const missing = [];
  if (!company_id_val) missing.push("company_id");
  if (!project_id_val) missing.push("project_id");
  if (!supplier_id_val) missing.push("supplier_id");
  if (!bill_id_val) missing.push("bill_id");

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing or invalid required fields: ${missing.join(", ")}`,
    });
  }

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();
    const updatedBy = req.user?.userId ?? null;
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, supplier_id_val)
      .input("bill_id", sql.Int, bill_id_val)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("updated_by", sql.Int, updatedBy)
      .input("updated_at", sql.DateTime2, new Date()).query(`
        UPDATE dbo.DebitNote SET
          company_id  = @company_id,
          project_id  = @project_id,
          supplier_id = @supplier_id,
          bill_id     = @bill_id,
          is_active   = @is_active,
          updated_by  = @updated_by,
          updated_at  = @updated_at
        WHERE id = @id
      `);
    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note updated successfully" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE debit note ────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.DebitNote WHERE id = @id");
    await bumpCacheVersion("debit-note");
    res.json({ message: "Debit note deleted successfully" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
