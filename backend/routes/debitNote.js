const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

// ─── Helper: parse a value as a positive integer, or return null ──────────────
function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET company options (business_type = 'C')
router.get("/options/companies", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name AS label
      FROM dbo.enterprise
      WHERE business_type = 'C'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Company options error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET project options (business_type = 'P')
router.get("/options/projects", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name AS label
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Project options error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET all debit notes
router.get("/", cache("debit-note", 300), async (req, res) => {
  try {
    const pool = getPool();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.DebitNote");
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          dn.id, dn.company_id, dn.project_id, dn.supplier_id, dn.bill_id, dn.is_active,
          dn.doc_type_id, dn.doc_no,
          dn.created_at, dn.updated_at,
          td.Prefix    AS doc_type_prefix,
          td.Description AS doc_type_description,
          ec.name      AS company_name,
          ep.name      AS project_name
        FROM dbo.DebitNote dn
        LEFT JOIN dbo.TypeOfDoc  td ON td.TypeOfDocId  = dn.doc_type_id
        LEFT JOIN dbo.enterprise ec ON ec.id = dn.company_id AND ec.business_type = 'C'
        LEFT JOIN dbo.enterprise ep ON ep.id = dn.project_id AND ep.business_type = 'P'
        ORDER BY dn.id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD debit note
router.post("/", async (req, res) => {
  const {
    company_id,
    project_id,
    supplier_id,
    bill_id,
    is_active,
    doc_type_id,
    doc_no,
    finYear,
  } = req.body;

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

  let transaction;
  try {
    const pool = getPool();
    transaction = pool.transaction();
    await transaction.begin();

    let finalDocNo = doc_no || null;

    if (doc_type_id) {
      finalDocNo = await lockNextDocNumber(transaction, sql, {
        docTypeId: toInt(doc_type_id),
        finYear,
        tableName: "DebitNote",
        issuedBy: req.user?.email || req.user?.name || null,
      });
    }

    const result = await transaction
      .request()
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, supplier_id_val)
      .input("bill_id", sql.Int, bill_id_val)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("doc_type_id", sql.Int, doc_type_id ? toInt(doc_type_id) : null)
      .input("doc_no", sql.NVarChar(100), finalDocNo || null)
      .input("created_by", sql.Int, 1)
      .input("created_at", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.DebitNote
          (company_id, project_id, supplier_id, bill_id, is_active, doc_type_id, doc_no, created_by, created_at)
        OUTPUT INSERTED.id
        VALUES
          (@company_id, @project_id, @supplier_id, @bill_id, @is_active, @doc_type_id, @doc_no, @created_by, @created_at)
      `);

    const newId = result.recordset[0]?.id;

    if (doc_type_id && finalDocNo && newId) {
      await backPatchRecordId(transaction, sql, finalDocNo, "DebitNote", newId);
    }

    await transaction.commit();
    await bumpCacheVersion("debit-note");
    res.json({
      message: "Debit note added successfully",
      id: newId,
      doc_no: finalDocNo,
    });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {
      // ignore rollback failure
    }
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE debit note
router.put("/:id", async (req, res) => {
  const {
    company_id,
    project_id,
    supplier_id,
    bill_id,
    is_active,
    doc_type_id,
    doc_no,
  } = req.body;

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
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("company_id", sql.Int, company_id_val)
      .input("project_id", sql.Int, project_id_val)
      .input("supplier_id", sql.Int, supplier_id_val)
      .input("bill_id", sql.Int, bill_id_val)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("doc_type_id", sql.Int, doc_type_id ? toInt(doc_type_id) : null)
      .input("doc_no", sql.NVarChar(100), doc_no || null)
      .input("updated_by", sql.Int, 1)
      .input("updated_at", sql.DateTime2, new Date()).query(`
        UPDATE dbo.DebitNote SET
          company_id  = @company_id,
          project_id  = @project_id,
          supplier_id = @supplier_id,
          bill_id     = @bill_id,
          is_active   = @is_active,
          doc_type_id = @doc_type_id,
          doc_no      = @doc_no,
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

// DELETE debit note
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
