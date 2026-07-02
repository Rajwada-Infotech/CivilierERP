"use strict";

/**
 * backend/routes/supplierPortal.js
 *
 * Supplier-facing endpoints for the external Supplier Portal login.
 * Mounted at /api/supplier-portal behind authenticateToken + role("supplier")
 * in server.js — every handler additionally re-resolves the caller's
 * AccountHeadMaster link (dbo.users.LinkedLHeadId) fresh on each request via
 * resolveSupplier() below, and every query is scoped to that id. The client
 * never supplies its own supplier id for any read/write in this file.
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));
const { getPool, sql } = require("../db");

// ── Resolve the caller's linked supplier (AccountHeadMaster.LHeadId) ─────────
async function resolveSupplier(req, res, next) {
  try {
    const pool = getPool();
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ error: "Invalid token - missing user id" });

    const result = await pool
      .request()
      .input("id", sql.Int, userId)
      .query("SELECT LinkedLHeadId FROM dbo.users WHERE id = @id AND discontinue = 0");

    const lheadId = result.recordset[0]?.LinkedLHeadId;
    if (!lheadId)
      return res.status(403).json({ error: "This account is not linked to a supplier record." });

    req.supplierLHeadId = lheadId;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
router.use(resolveSupplier);

// ── GET /me ─────────────────────────────────────────────────────────────────────
router.get("/me", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.supplierLHeadId)
      .query(`
        SELECT LHeadId, ISNULL(DisplayName, LHeadName) AS Name, LHeadCode,
               LHeadEmail, LHeadPhone, LHeadAddress, LHeadContactPerson
        FROM dbo.AccountHeadMaster
        WHERE LHeadId = @id
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "Supplier record not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quotations ─────────────────────────────────────────────────────────────
// Quotations I've been tagged on, with my submission status.
router.get("/quotations", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          q.QuotationId, q.DocNo, q.Status AS QuotationStatus, q.DocDate, q.DueDate, q.Remarks,
          ec.name AS CompanyName, ep.name AS ProjectName,
          qs.Status AS MySubmissionStatus, qs.InvitedAt,
          (SELECT COUNT(*) FROM dbo.QuotationItems qi WHERE qi.QuotationId = q.QuotationId) AS ItemCount
        FROM dbo.QuotationSuppliers qs
        JOIN dbo.Quotations q ON q.QuotationId = qs.QuotationId
        LEFT JOIN dbo.enterprise ec ON ec.id = q.CompanyId
        LEFT JOIN dbo.enterprise ep ON ep.id = q.ProjectId
        WHERE qs.SupplierLHeadId = @supplierId
          AND q.Status <> 'Draft'
        ORDER BY qs.InvitedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quotations/:id ──────────────────────────────────────────────────────────
router.get("/quotations/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const tagCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId)
      .query(
        "SELECT Status FROM dbo.QuotationSuppliers WHERE QuotationId=@id AND SupplierLHeadId=@supplierId",
      );
    if (!tagCheck.recordset.length)
      return res.status(403).json({ error: "You are not tagged on this quotation." });

    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT q.QuotationId, q.DocNo, q.Status, q.DocDate, q.DueDate, q.Remarks
      FROM dbo.Quotations q
      WHERE q.QuotationId = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Quotation not found" });

    const items = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          qi.QuotationItemId, qi.ItemId, qi.ItemName, qi.UOMCode, u.UOMName, qi.Quantity, qi.Remarks,
          qsp.Rate, qsp.SupplyDate, qsp.Quality
        FROM dbo.QuotationItems qi
        LEFT JOIN dbo.UOMMaster u ON u.UOMCode = qi.UOMCode
        LEFT JOIN dbo.QuotationSupplierPrices qsp
          ON qsp.QuotationItemId = qi.QuotationItemId AND qsp.SupplierLHeadId = @supplierId
        WHERE qi.QuotationId = @id
        ORDER BY qi.QuotationItemId
      `);

    res.json({
      ...header.recordset[0],
      MySubmissionStatus: tagCheck.recordset[0].Status,
      items: items.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /quotations/:id/prices ──────────────────────────────────────────────
// Upserts my Rate/SupplyDate/Quality per item, flips my tag Status to Submitted.
router.post("/quotations/:id/prices", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const tagCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId)
      .query(
        "SELECT 1 FROM dbo.QuotationSuppliers WHERE QuotationId=@id AND SupplierLHeadId=@supplierId",
      );
    if (!tagCheck.recordset.length)
      return res.status(403).json({ error: "You are not tagged on this quotation." });

    const { items = [] } = req.body;
    if (!items.length) return res.status(400).json({ error: "At least one item price is required" });

    for (const item of items) {
      const quotationItemId = parseInt(item.QuotationItemId, 10);
      if (!quotationItemId) continue;

      // Confirm this line item actually belongs to this quotation before upserting.
      const itemCheck = await pool
        .request()
        .input("qid", sql.Int, quotationItemId)
        .input("id", sql.Int, id)
        .query("SELECT 1 FROM dbo.QuotationItems WHERE QuotationItemId=@qid AND QuotationId=@id");
      if (!itemCheck.recordset.length) continue;

      await pool
        .request()
        .input("QuotationId", sql.Int, id)
        .input("SupplierLHeadId", sql.Int, req.supplierLHeadId)
        .input("QuotationItemId", sql.Int, quotationItemId)
        .input("Rate", sql.Decimal(18, 2), parseFloat(item.Rate) || 0)
        .input("SupplyDate", sql.Date, item.SupplyDate || null)
        .input("Quality", sql.NVarChar(200), item.Quality || null).query(`
          MERGE dbo.QuotationSupplierPrices AS target
          USING (SELECT @QuotationItemId AS QuotationItemId, @SupplierLHeadId AS SupplierLHeadId) AS src
            ON target.QuotationItemId = src.QuotationItemId AND target.SupplierLHeadId = src.SupplierLHeadId
          WHEN MATCHED THEN
            UPDATE SET Rate = @Rate, SupplyDate = @SupplyDate, Quality = @Quality, SubmittedAt = SYSDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (QuotationId, SupplierLHeadId, QuotationItemId, Rate, SupplyDate, Quality, SubmittedAt)
            VALUES (@QuotationId, @SupplierLHeadId, @QuotationItemId, @Rate, @SupplyDate, @Quality, SYSDATETIME());
        `);
    }

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        UPDATE dbo.QuotationSuppliers
        SET Status = 'Submitted'
        WHERE QuotationId = @id AND SupplierLHeadId = @supplierId
      `);

    // Roll the quotation header status forward: PartiallyQuoted once at least
    // one supplier has submitted, Quoted once every tagged supplier has.
    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.Quotations
      SET Status = CASE
            WHEN (SELECT COUNT(*) FROM dbo.QuotationSuppliers WHERE QuotationId = @id AND Status <> 'Submitted') = 0
              THEN 'Quoted'
            ELSE 'PartiallyQuoted'
          END,
          UpdatedAt = SYSDATETIME()
      WHERE QuotationId = @id AND Status IN ('Sent', 'PartiallyQuoted')
    `);

    res.json({ message: "Prices submitted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /catalog ────────────────────────────────────────────────────────────────
// My standalone rate card — full active Item Master list left-joined against
// whatever rates I've already set, so unset items show blank rows.
router.get("/catalog", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          im.M_Id AS ItemId, im.M_Name AS ItemName, im.M_UOM AS UOMCode, u.UOMName,
          sir.Rate, sir.SupplyLeadTime, sir.Quality, sir.UpdatedAt
        FROM dbo.Item_Master_Group im
        LEFT JOIN dbo.UOMMaster u ON u.UOMCode = im.M_UOM
        LEFT JOIN dbo.SupplierItemRates sir
          ON sir.ItemId = CONVERT(NVARCHAR(50), im.M_Id) AND sir.SupplierLHeadId = @supplierId
        WHERE im.Parent_Id IS NOT NULL OR im.M_IdentityCode = 1
        ORDER BY im.M_Name
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /catalog ───────────────────────────────────────────────────────────────
router.put("/catalog", async (req, res) => {
  try {
    const pool = getPool();
    const { items = [] } = req.body;
    if (!items.length) return res.status(400).json({ error: "At least one item is required" });

    for (const item of items) {
      if (!item.ItemId) continue;
      await pool
        .request()
        .input("SupplierLHeadId", sql.Int, req.supplierLHeadId)
        .input("ItemId", sql.NVarChar(50), String(item.ItemId))
        .input("ItemName", sql.NVarChar(200), item.ItemName || null)
        .input("UOMCode", sql.NVarChar(20), item.UOMCode || null)
        .input("Rate", sql.Decimal(18, 2), parseFloat(item.Rate) || 0)
        .input("SupplyLeadTime", sql.NVarChar(100), item.SupplyLeadTime || null)
        .input("Quality", sql.NVarChar(200), item.Quality || null).query(`
          MERGE dbo.SupplierItemRates AS target
          USING (SELECT @SupplierLHeadId AS SupplierLHeadId, @ItemId AS ItemId) AS src
            ON target.SupplierLHeadId = src.SupplierLHeadId AND target.ItemId = src.ItemId
          WHEN MATCHED THEN
            UPDATE SET Rate = @Rate, SupplyLeadTime = @SupplyLeadTime, Quality = @Quality,
                       ItemName = @ItemName, UOMCode = @UOMCode, UpdatedAt = SYSDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (SupplierLHeadId, ItemId, ItemName, UOMCode, Rate, SupplyLeadTime, Quality, UpdatedAt)
            VALUES (@SupplierLHeadId, @ItemId, @ItemName, @UOMCode, @Rate, @SupplyLeadTime, @Quality, SYSDATETIME());
        `);
    }

    res.json({ message: "Catalog updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
