const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");

router.use(authMiddleware);
router.use(apiRateLimit);

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toDecimal(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}


// ─── GET all debit notes ──────────────────────────────────────────────────────
router.get("/", requirePageRight("debit-note", "view"), cache("debit-note", 120), async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    if (!companyId) return res.status(400).json({ error: "companyId is required." });
    const result = await pool.request().input("companyId", sql.Int, companyId).query(`
      SELECT
        dn.id, dn.DocNo, dn.DebitDate, dn.company_id, dn.project_id,
        dn.supplier_id, dn.bill_id, dn.is_active, dn.created_by,
        dn.created_at, dn.updated_at, dn.Reason, dn.TotalAmount,
        ISNULL(dn.Status, 'Draft') AS Status,
        u.name AS created_by_name,
        co.name AS company_name,
        pr.name AS project_name,
        sup.LHeadName AS supplier_name
      FROM dbo.DebitNote dn
      LEFT JOIN dbo.users u ON u.id = dn.created_by
      LEFT JOIN dbo.enterprise co ON co.id = dn.company_id
      LEFT JOIN dbo.enterprise pr ON pr.id = dn.project_id
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = dn.supplier_id
      WHERE dn.company_id = @companyId
      ORDER BY dn.id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[debitNote] GET /:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET single debit note with items ────────────────────────────────────────
router.get("/:id", requirePageRight("debit-note", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const [header, items] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`
        SELECT dn.*, ISNULL(dn.Status, 'Draft') AS Status,
               co.name AS company_name, pr.name AS project_name,
               sup.LHeadName AS supplier_name
        FROM dbo.DebitNote dn
        LEFT JOIN dbo.enterprise co ON co.id = dn.company_id
        LEFT JOIN dbo.enterprise pr ON pr.id = dn.project_id
        LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = dn.supplier_id
        WHERE dn.id = @id
      `),
      pool.request().input("id", sql.Int, id).query(`
        SELECT * FROM dbo.DebitNoteItems WHERE DebitNoteId = @id ORDER BY ItemId
      `),
    ]);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json({ ...header.recordset[0], items: items.recordset });
  } catch (err) {
    console.error("[debitNote] GET /:id:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST — create debit note with items ─────────────────────────────────────
router.post("/", requirePageRight("debit-note", "create"), async (req, res) => {
  const {
    company_id, project_id, supplier_id, bill_id, is_active,
    DocNo, DebitDate, Reason, items = [],
  } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const supplier_id_val = toInt(supplier_id);
  const bill_id_val = toInt(bill_id);

  // bill_id is a NOT NULL column in dbo.DebitNote with no fallback default
  // in the insert/update below — toInt() returns null for a missing/invalid
  // value, which used to reach the database and crash with an unhandled SQL
  // "Cannot insert the value NULL" 500 instead of this clean validation
  // error. Same bug class found and fixed across purchaseOrders.js,
  // expenseBooking.js, workOrder.js, materialIssues.js, and
  // chequeMasterSchemas.js during a live-DB workflow test.
  if (!company_id_val || !project_id_val || !supplier_id_val || !bill_id_val) {
    return res.status(400).json({ error: "company_id, project_id, supplier_id, bill_id are required" });
  }

  const validItems = items.filter(i => {
    const desc = String(i.Description || i.description || "").trim();
    const amt = parseFloat(i.Amount ?? i.amount);
    return desc && Number.isFinite(amt) && amt >= 0;
  });
  if (items.length > 0 && validItems.length === 0)
    return res.status(400).json({ error: "At least one item with a valid non-negative amount is required" });

  const totalAmount = validItems.reduce((s, i) => s + (parseFloat(i.Amount ?? i.amount) || 0), 0);

  try {
    const pool = getPool();
    const createdBy = req.user?.id ?? req.user?.userId ?? null;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const headerResult = await tx.request()
        .input("company_id", sql.Int, company_id_val)
        .input("project_id", sql.Int, project_id_val)
        .input("supplier_id", sql.Int, supplier_id_val)
        .input("bill_id", sql.Int, toInt(bill_id))
        .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
        .input("created_by", sql.Int, createdBy)
        .input("created_at", sql.DateTime2, new Date())
        .input("DocNo", sql.NVarChar(50), DocNo || null)
        .input("DebitDate", sql.Date, DebitDate || null)
        .input("Reason", sql.NVarChar(1000), Reason || null)
        .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
        .input("Status", sql.NVarChar(20), "Draft")
        .query(`
          INSERT INTO dbo.DebitNote
            (company_id, project_id, supplier_id, bill_id, is_active, created_by, created_at,
             DocNo, DebitDate, Reason, TotalAmount, Status)
          OUTPUT INSERTED.id
          VALUES
            (@company_id, @project_id, @supplier_id, @bill_id, @is_active, @created_by, @created_at,
             @DocNo, @DebitDate, @Reason, @TotalAmount, @Status)
        `);

      const newId = headerResult.recordset[0].id;

      for (const item of validItems) {
        await tx.request()
          .input("DebitNoteId", sql.Int, newId)
          .input("Description", sql.NVarChar(500), String(item.Description || item.description || ""))
          .input("Quantity", sql.Decimal(18, 4), toDecimal(item.Quantity ?? item.quantity))
          .input("UOMSymbol", sql.NVarChar(30), item.UOMSymbol || item.uomSymbol || null)
          .input("Rate", sql.Decimal(18, 4), toDecimal(item.Rate ?? item.rate))
          .input("Amount", sql.Decimal(18, 2), toDecimal(item.Amount ?? item.amount))
          .query(`
            INSERT INTO dbo.DebitNoteItems (DebitNoteId, Description, Quantity, UOMSymbol, Rate, Amount)
            VALUES (@DebitNoteId, @Description, @Quantity, @UOMSymbol, @Rate, @Amount)
          `);
      }

      await tx.commit();
      await bumpCacheVersion("debit-note");
      res.status(201).json({ message: "Debit note created", id: newId });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[debitNote] POST /:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT — update debit note with items ──────────────────────────────────────
router.put("/:id", requirePageRight("debit-note", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const {
    company_id, project_id, supplier_id, bill_id, is_active,
    DocNo, DebitDate, Reason, items = [],
  } = req.body;

  const company_id_val = toInt(company_id);
  const project_id_val = toInt(project_id);
  const supplier_id_val = toInt(supplier_id);
  const bill_id_val = toInt(bill_id);

  // bill_id is a NOT NULL column in dbo.DebitNote with no fallback default
  // in the insert/update below — toInt() returns null for a missing/invalid
  // value, which used to reach the database and crash with an unhandled SQL
  // "Cannot insert the value NULL" 500 instead of this clean validation
  // error. Same bug class found and fixed across purchaseOrders.js,
  // expenseBooking.js, workOrder.js, materialIssues.js, and
  // chequeMasterSchemas.js during a live-DB workflow test.
  if (!company_id_val || !project_id_val || !supplier_id_val || !bill_id_val) {
    return res.status(400).json({ error: "company_id, project_id, supplier_id, bill_id are required" });
  }

  const validItems = items.filter(i => {
    const desc = String(i.Description || i.description || "").trim();
    const amt = parseFloat(i.Amount ?? i.amount);
    return desc && Number.isFinite(amt) && amt >= 0;
  });

  const totalAmount = validItems.reduce((s, i) => s + (parseFloat(i.Amount ?? i.amount) || 0), 0);

  try {
    const pool = getPool();
    const updatedBy = req.user?.id ?? req.user?.userId ?? null;

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input("id", sql.Int, id)
        .input("company_id", sql.Int, company_id_val)
        .input("project_id", sql.Int, project_id_val)
        .input("supplier_id", sql.Int, supplier_id_val)
        .input("bill_id", sql.Int, toInt(bill_id))
        .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
        .input("updated_by", sql.Int, updatedBy)
        .input("updated_at", sql.DateTime2, new Date())
        .input("DocNo", sql.NVarChar(50), DocNo || null)
        .input("DebitDate", sql.Date, DebitDate || null)
        .input("Reason", sql.NVarChar(1000), Reason || null)
        .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
        .query(`
          UPDATE dbo.DebitNote SET
            company_id  = @company_id, project_id = @project_id,
            supplier_id = @supplier_id, bill_id    = @bill_id,
            is_active   = @is_active,  updated_by  = @updated_by,
            updated_at  = @updated_at, DocNo       = @DocNo,
            DebitDate   = @DebitDate,  Reason      = @Reason,
            TotalAmount = @TotalAmount
          WHERE id = @id
        `);

      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.DebitNoteItems WHERE DebitNoteId = @id");

      for (const item of validItems) {
        await tx.request()
          .input("DebitNoteId", sql.Int, id)
          .input("Description", sql.NVarChar(500), String(item.Description || item.description || ""))
          .input("Quantity", sql.Decimal(18, 4), toDecimal(item.Quantity ?? item.quantity))
          .input("UOMSymbol", sql.NVarChar(30), item.UOMSymbol || item.uomSymbol || null)
          .input("Rate", sql.Decimal(18, 4), toDecimal(item.Rate ?? item.rate))
          .input("Amount", sql.Decimal(18, 2), toDecimal(item.Amount ?? item.amount))
          .query(`
            INSERT INTO dbo.DebitNoteItems (DebitNoteId, Description, Quantity, UOMSymbol, Rate, Amount)
            VALUES (@DebitNoteId, @Description, @Quantity, @UOMSymbol, @Rate, @Amount)
          `);
      }

      await tx.commit();
      await bumpCacheVersion("debit-note");
      res.json({ message: "Debit note updated" });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[debitNote] PUT /:id:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE debit note ────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("debit-note", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid record id" });
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.DebitNoteItems WHERE DebitNoteId = @id");
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.DebitNote WHERE id = @id");
      await tx.commit();
      await bumpCacheVersion("debit-note");
      res.json({ message: "Debit note deleted" });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[debitNote] DELETE /:id:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
