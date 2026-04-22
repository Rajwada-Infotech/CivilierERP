const express = require("express")
const router = express.Router()
const { getPool, sql } = require("../db")
const { cache } = require("../middleware/cache")
const { bumpCacheVersion } = require("../redis")
const { transition, guardEdit } = require("../services/approvalService")

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// GET all payments
router.get("/", cache("new-payment", 300), async (req, res) => {
  try {
    const pool = getPool()

    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.NewPayment");
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        SELECT * FROM dbo.NewPayment
        ORDER BY PPaymentID DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error("PAYMENT GET ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST - Create payment
router.post("/", async (req, res) => {
  const {
    PPaymentName, PMode, PAmount, PDocType,
    PDate, PBankID, PBankName, PProject, PCompany
  } = req.body

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    await guardEdit("payments", req.params.id);

    const pool = getPool()
    await pool.request()
      .input("PPaymentName", sql.VarChar,        PPaymentName || null)
      .input("PMode",        sql.VarChar,        PMode || null)
      .input("PAmount",      sql.Decimal(18, 2), PAmount || null)
      .input("PDocType",     sql.VarChar,        PDocType || null)
      .input("PDate",        sql.Date,           PDate || null)
      .input("PBankID",      sql.Int,            PBankID || null)
      .input("PBankName",    sql.VarChar,        PBankName || null)
      .input("PProject",     sql.VarChar,        PProject || null)
      .input("PCompany",     sql.VarChar,        PCompany || null)
      .input("PCreatedAt",   sql.DateTime,       new Date())
      .input("PCreatedBy",   sql.NVarChar(100),  userEmail)   // ✅ real email, was hardcoded 1
      .input("PApprovedBy",  sql.NVarChar(100),  null)
      .query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PMode, PAmount, PDocType, PDate,
          PBankID, PBankName, PProject, PCompany,
          PCreatedAt, PCreatedBy, PApprovedBy
        ) VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany,
          @PCreatedAt, @PCreatedBy, @PApprovedBy
        )
      `)
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment added successfully" })
  } catch (err) {
    console.error("PAYMENT INSERT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT - Update payment
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const {
    PPaymentName, PMode, PAmount, PDocType,
    PDate, PBankID, PBankName, PProject, PCompany
  } = req.body

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool()
    await pool.request()
      .input("PPaymentID",   sql.Int,            id)
      .input("PPaymentName", sql.VarChar,        PPaymentName || null)
      .input("PMode",        sql.VarChar,        PMode || null)
      .input("PAmount",      sql.Decimal(18, 2), PAmount || null)
      .input("PDocType",     sql.VarChar,        PDocType || null)
      .input("PDate",        sql.Date,           PDate || null)
      .input("PBankID",      sql.Int,            PBankID || null)
      .input("PBankName",    sql.VarChar,        PBankName || null)
      .input("PProject",     sql.VarChar,        PProject || null)
      .input("PCompany",     sql.VarChar,        PCompany || null)
      .input("PUpdatedBy",   sql.NVarChar(100),  userEmail)   // ✅ real email
      .query(`
        UPDATE dbo.NewPayment SET
          PPaymentName=@PPaymentName, PMode=@PMode,
          PAmount=@PAmount, PDocType=@PDocType, PDate=@PDate,
          PBankID=@PBankID, PBankName=@PBankName,
          PProject=@PProject, PCompany=@PCompany
        WHERE PPaymentID=@PPaymentID
      `)
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment updated successfully" })
  } catch (err) {
    console.error("PAYMENT UPDATE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE - Remove payment
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  try {
    const pool = getPool()
    await pool.request()
      .input("PPaymentID", sql.Int, id)
      .query("DELETE FROM dbo.NewPayment WHERE PPaymentID=@PPaymentID")
    await bumpCacheVersion("new-payment")
    res.json({ message: "Payment deleted successfully" })
  } catch (err) {
    console.error("PAYMENT DELETE ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /:id/submit — Draft → Pending ─────────────────────────────────────────
router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("payments", id, "Pending", userEmail, req.user?.role);
    await bumpCacheVersion("payments");
    res.json({ message: "Payment submitted for approval", ...result });
  } catch (err) {
    console.error("Payment submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("payments", id, "Approved", userEmail, req.user?.role);
    await bumpCacheVersion("payments");
    res.json({ message: "Payment approved", ...result });
  } catch (err) {
    console.error("Payment approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ──────────────────────────────────────
router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("payments", id, "Rejected", userEmail, req.user?.role, note || null);
    await bumpCacheVersion("payments");
    res.json({ message: "Payment rejected", ...result });
  } catch (err) {
    console.error("Payment reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
})

module.exports = router
