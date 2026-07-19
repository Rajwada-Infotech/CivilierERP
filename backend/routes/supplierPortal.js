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
               LHeadEmail, LHeadPhone, LHeadAddress, LHeadContactPerson,
               LHeadStatus, LHeadPaymentTerms, LGST, LGSTState, LCountry,
               LBelongsTo, LDescription
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
          (SELECT COUNT(*) FROM dbo.QuotationItems qi WHERE qi.QuotationId = q.QuotationId) AS ItemCount,
          (
            SELECT MAX(qsp.SubmittedAt)
            FROM dbo.QuotationSupplierPrices qsp
            JOIN dbo.QuotationItems qi2 ON qi2.QuotationItemId = qsp.QuotationItemId
            WHERE qi2.QuotationId = q.QuotationId AND qsp.SupplierLHeadId = qs.SupplierLHeadId
          ) AS SubmittedAt
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

    // CompanyName/ProjectName were missing here (unlike the sibling GET
    // /quotations list endpoint above, which already joins these) — the
    // detail page's company/project row silently never rendered because
    // these came back undefined. Same JOIN pattern as GET /quotations.
    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT q.QuotationId, q.DocNo, q.Status, q.DocDate, q.DueDate, q.Remarks,
             ec.name AS CompanyName, ep.name AS ProjectName
      FROM dbo.Quotations q
      LEFT JOIN dbo.enterprise ec ON ec.id = q.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id = q.ProjectId
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

    // Item price upserts + tag status flip + header status roll-up must be
    // one atomic unit — previously each ran on the plain pool, so a failure
    // partway through the item loop left some prices saved and others not,
    // while the tag/header status still correctly stayed un-submitted (the
    // error aborted before reaching those updates). Wrapping in a
    // transaction closes the gap: either the whole submission lands, or
    // none of it does. Same bug class found and fixed in
    // materialRequests.js/quotations.js.
    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const item of items) {
        const quotationItemId = parseInt(item.QuotationItemId, 10);
        if (!quotationItemId) continue;

        // Confirm this line item actually belongs to this quotation before upserting.
        const itemCheck = await tx
          .request()
          .input("qid", sql.Int, quotationItemId)
          .input("id", sql.Int, id)
          .query("SELECT 1 FROM dbo.QuotationItems WHERE QuotationItemId=@qid AND QuotationId=@id");
        if (!itemCheck.recordset.length) continue;

        await tx
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

      await tx
        .request()
        .input("id", sql.Int, id)
        .input("supplierId", sql.Int, req.supplierLHeadId).query(`
          UPDATE dbo.QuotationSuppliers
          SET Status = 'Submitted'
          WHERE QuotationId = @id AND SupplierLHeadId = @supplierId
        `);

      // Roll the quotation header status forward: PartiallyQuoted once at least
      // one supplier has submitted, Quoted once every tagged supplier has.
      await tx.request().input("id", sql.Int, id).query(`
        UPDATE dbo.Quotations
        SET Status = CASE
              WHEN (SELECT COUNT(*) FROM dbo.QuotationSuppliers WHERE QuotationId = @id AND Status <> 'Submitted') = 0
                THEN 'Quoted'
              ELSE 'PartiallyQuoted'
            END,
            UpdatedAt = SYSDATETIME()
        WHERE QuotationId = @id AND Status IN ('Sent', 'PartiallyQuoted')
      `);

      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

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

    // Same bug class found and fixed in materialRequests.js/quotations.js:
    // each MERGE previously ran on the plain pool, so a failure partway
    // through the loop left some rate-card rows updated and others not.
    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const item of items) {
        if (!item.ItemId) continue;
        await tx
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
      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    res.json({ message: "Catalog updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lazy Socket.IO handle (mirrors purchaseOrders.js's pattern) ─────────────
let _getIo = null;
function getIo() {
  if (!_getIo) _getIo = require("../socket").getIo;
  return _getIo();
}
function emitPOMessage(poId, comment) {
  try {
    getIo().to(`po:${poId}`).emit("po:message", { poId, comment });
  } catch (err) {
    console.warn(`[supplierPortal] Socket emit failed for poId="${poId}": ${err?.message || err}`);
  }
}

// ── GET /orders — Purchase Orders addressed to me ────────────────────────────
// Intentionally source-agnostic: no filter on POType/SourceXxxId, so this
// returns every PO with SupplierID = me regardless of how it was created —
// Direct entry, from a Material Request, or from the Quotation/L1-Chart
// flow (POType='QPO'). SourceLabel below is just a display hint.
router.get("/orders", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate,
          po.ExpectedDeliveryDate, po.ItemDescription, po.Quantity, po.Unit,
          po.TotalAmount, po.Status, po.Remarks,
          po.SupplierAcknowledged, po.SupplierAcknowledgedAt,
          po.SuppliedDate, po.ChallanNumber,
          po.POType,
          po.SourceMRDocNo, po.SourceQTDocNo, po.SourceWDDocNo,
          CASE
            WHEN po.POType = 'QPO'        THEN 'Quotation'
            WHEN po.SourceMRId IS NOT NULL THEN 'Material Request'
            WHEN po.SourceWDId IS NOT NULL THEN 'Work Done'
            WHEN po.POType = 'WO_PO'      THEN 'Work Order'
            ELSE 'Direct'
          END AS SourceLabel,
          co.name AS CompanyName, pr.name AS ProjectName,
          (SELECT COUNT(*) FROM dbo.PurchaseOrderComments c WHERE c.PurchaseOrderId = po.PurchaseOrderID) AS CommentCount
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.enterprise co ON co.id = po.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
        WHERE po.SupplierID = @supplierId
          AND po.Status NOT IN ('Draft', 'Rejected')
        ORDER BY po.PODate DESC, po.PurchaseOrderID DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/:id — PO detail (only if addressed to me) ───────────────────
router.get("/orders/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate,
          po.ExpectedDeliveryDate, po.ItemDescription, po.Quantity, po.Unit,
          po.Rate, po.SubtotalAmount, po.TotalAmount, po.HsnCode, po.GstType, po.GstRate,
          po.PaymentTerms, po.Remarks, po.Status, po.POItems,
          po.SupplierAcknowledged, po.SupplierAcknowledgedAt,
          po.SuppliedDate, po.ChallanNumber,
          po.POType,
          po.SourceMRDocNo, po.SourceQTDocNo, po.SourceWDDocNo,
          CASE
            WHEN po.POType = 'QPO'        THEN 'Quotation'
            WHEN po.SourceMRId IS NOT NULL THEN 'Material Request'
            WHEN po.SourceWDId IS NOT NULL THEN 'Work Done'
            WHEN po.POType = 'WO_PO'      THEN 'Work Order'
            ELSE 'Direct'
          END AS SourceLabel,
          co.name AS CompanyName, pr.name AS ProjectName
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.enterprise co ON co.id = po.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
        WHERE po.PurchaseOrderID = @id AND po.SupplierID = @supplierId
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "Order not found" });

    const row = result.recordset[0];
    let items = [];
    try { items = row.POItems ? JSON.parse(row.POItems) : []; } catch { /* ignore */ }

    res.json({ ...row, POItems: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /orders/:id/acknowledge — mark supplies dispatched ("tick box") ─────
// SuppliedDate is stamped with today whenever the box is ticked on (never
// backdated/edited by the client) so "days to deliver" stays trustworthy.
// ChallanNumber is optional, prompted client-side at the same moment.
router.put("/orders/:id/acknowledge", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const acknowledged = !!req.body?.acknowledged;
    const challanNumber = (req.body?.challanNumber || "").toString().trim() || null;

    const owned = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId)
      .query("SELECT 1 FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id AND SupplierID = @supplierId");
    if (!owned.recordset.length) return res.status(404).json({ error: "Order not found" });

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("Acknowledged", sql.Bit, acknowledged ? 1 : 0)
      .input("AcknowledgedAt", sql.DateTime2, acknowledged ? new Date() : null)
      .input("SuppliedDate", sql.Date, acknowledged ? new Date() : null)
      .input("ChallanNumber", sql.NVarChar(100), acknowledged ? challanNumber : null)
      .query(`
        UPDATE dbo.PurchaseOrders
        SET SupplierAcknowledged = @Acknowledged,
            SupplierAcknowledgedAt = @AcknowledgedAt,
            SuppliedDate = @SuppliedDate,
            ChallanNumber = @ChallanNumber
        WHERE PurchaseOrderID = @id
      `);

    res.json({ ok: true, acknowledged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/:id/comments — chat thread for a PO I own ───────────────────
router.get("/orders/:id/comments", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const owned = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId)
      .query("SELECT 1 FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id AND SupplierID = @supplierId");
    if (!owned.recordset.length) return res.status(404).json({ error: "Order not found" });

    const result = await pool.request().input("POID", sql.Int, id).query(`
      SELECT Id, PurchaseOrderId, Comment AS comment, AuthorName AS author_name,
             AuthorId AS author_id, AuthorRole AS author_role, CreatedAt AS created_at
      FROM dbo.PurchaseOrderComments
      WHERE PurchaseOrderId = @POID
      ORDER BY CreatedAt ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /orders/:id/comment — reply in the chat thread ──────────────────────
router.post("/orders/:id/comment", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const comment = (req.body?.comment || "").trim();
    if (!comment) return res.status(400).json({ error: "Comment is required" });

    const owned = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, req.supplierLHeadId)
      .query("SELECT 1 FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id AND SupplierID = @supplierId");
    if (!owned.recordset.length) return res.status(404).json({ error: "Order not found" });

    const authorName = req.user?.name ?? req.user?.username ?? "Supplier";
    const authorId = req.user?.userId ?? req.user?.id ?? null;

    const insert = await pool.request()
      .input("POID",       sql.Int,           id)
      .input("Comment",    sql.NVarChar(sql.MAX), comment)
      .input("AuthorName", sql.NVarChar(200), authorName)
      .input("AuthorId",   sql.Int,           authorId)
      .input("AuthorRole", sql.NVarChar(50),  "supplier")
      .query(`
        INSERT INTO dbo.PurchaseOrderComments (PurchaseOrderId, Comment, AuthorName, AuthorId, AuthorRole)
        OUTPUT INSERTED.Id, INSERTED.PurchaseOrderId, INSERTED.Comment AS comment,
               INSERTED.AuthorName AS author_name, INSERTED.AuthorId AS author_id,
               INSERTED.AuthorRole AS author_role, INSERTED.CreatedAt AS created_at
        VALUES (@POID, @Comment, @AuthorName, @AuthorId, @AuthorRole)
      `);

    const saved = insert.recordset[0];
    res.json({ comment: saved });
    emitPOMessage(id, saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /grns — "Received by Customer": per-order goods-received progress ───
// One row per PO that has at least one item with GRN activity recorded
// against it (PurchaseOrderItems.ReceivedQty synced by grns.js on every
// Approved GRN). isFullyReceived flips true once every line's ReceivedQty
// has caught up to its ordered Quantity — the frontend renders a tick for
// that order and, while any item still has a shortfall, surfaces it as a
// reminder (see /grns/reminders below).
router.get("/grns", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("supplierId", sql.Int, req.supplierLHeadId).query(`
        SELECT
          po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate, po.Status,
          co.name AS CompanyName, pr.name AS ProjectName,
          poi.Id AS ItemId, poi.ItemName, poi.Quantity AS OrderedQty,
          ISNULL(poi.ReceivedQty, 0) AS ReceivedQty, poi.UomName,
          (SELECT COUNT(*) FROM dbo.PurchaseOrderComments c WHERE c.PurchaseOrderId = po.PurchaseOrderID) AS CommentCount
        FROM dbo.PurchaseOrders po
        JOIN dbo.PurchaseOrderItems poi ON poi.PurchaseOrderID = po.PurchaseOrderID
        LEFT JOIN dbo.enterprise co ON co.id = po.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
        WHERE po.SupplierID = @supplierId
          AND po.Status NOT IN ('Draft', 'Rejected')
          AND EXISTS (
            SELECT 1 FROM dbo.PurchaseOrderItems x
            WHERE x.PurchaseOrderID = po.PurchaseOrderID AND ISNULL(x.ReceivedQty, 0) > 0
          )
        ORDER BY po.PODate DESC, po.PurchaseOrderID DESC, poi.SortOrder ASC
      `);

    const byOrder = new Map();
    for (const row of result.recordset) {
      if (!byOrder.has(row.PurchaseOrderID)) {
        byOrder.set(row.PurchaseOrderID, {
          purchaseOrderId: row.PurchaseOrderID,
          purchaseOrderNo: row.PurchaseOrderNo,
          docNo: row.DocNo || row.PurchaseOrderNo,
          poDate: row.PODate,
          status: row.Status,
          companyName: row.CompanyName,
          projectName: row.ProjectName,
          commentCount: row.CommentCount ?? 0,
          items: [],
        });
      }
      byOrder.get(row.PurchaseOrderID).items.push({
        itemId: row.ItemId,
        itemName: row.ItemName,
        orderedQty: Number(row.OrderedQty) || 0,
        receivedQty: Number(row.ReceivedQty) || 0,
        remainingQty: Math.max(0, (Number(row.OrderedQty) || 0) - (Number(row.ReceivedQty) || 0)),
        uom: row.UomName,
      });
    }

    const orders = Array.from(byOrder.values()).map((o) => {
      const totalRemaining = o.items.reduce((s, i) => s + i.remainingQty, 0);
      return { ...o, isFullyReceived: totalRemaining <= 0, totalRemaining };
    });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
