"use strict";

/**
 * backend/routes/quotations.js
 *
 * Quotation (QT) routes — RFQ sent to one or more suppliers against a tagged
 * Material Request, plus the L1 Price Comparative Chart data feed and the
 * PO prefill handoff once a winning supplier is picked.
 *
 * Document numbering:  QT-YYYY-NNNNN  (see backend/utils/docNumberLock.js)
 *
 * Tables touched:
 *   dbo.Quotations              — header (company, project, fin year, source MR, dates)
 *   dbo.QuotationItems          — line items (item, uom, qty) — copied from the tagged MR
 *   dbo.QuotationSuppliers      — suppliers tagged/invited to quote
 *   dbo.QuotationSupplierPrices — each supplier's per-item Rate/SupplyDate/Quality response
 *
 * Status flow: Draft → Sent → PartiallyQuoted → Quoted → Closed
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
} = require("../utils/docNumberLock");

const requireUser = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

// ── GET / (list) ───────────────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = ["1=1"];

    if (req.query.companyId) {
      conditions.push("q.CompanyId = @companyId");
      request.input("companyId", sql.Int, parseInt(req.query.companyId, 10));
    }
    if (req.query.projectId) {
      conditions.push("q.ProjectId = @projectId");
      request.input("projectId", sql.Int, parseInt(req.query.projectId, 10));
    }
    if (req.query.finYearId) {
      conditions.push("q.FinYearId = @finYearId");
      request.input("finYearId", sql.Int, parseInt(req.query.finYearId, 10));
    }
    if (req.query.status) {
      conditions.push("q.Status = @status");
      request.input("status", sql.NVarChar(30), req.query.status);
    }

    const result = await request.query(`
      SELECT
        q.QuotationId, q.DocNo, q.Status, q.DocDate, q.DueDate,
        q.CompanyId, q.ProjectId, q.FinYearId, q.SourceMRId, q.SourceMRDocNo,
        q.Remarks, q.CreatedBy, q.CreatedAt,
        ec.name  AS CompanyName,
        ep.name  AS ProjectName,
        fy.FName AS FinYearName,
        (SELECT COUNT(*) FROM dbo.QuotationItems qi WHERE qi.QuotationId = q.QuotationId) AS ItemCount,
        (SELECT COUNT(*) FROM dbo.QuotationSuppliers qs WHERE qs.QuotationId = q.QuotationId) AS SupplierCount,
        (SELECT COUNT(*) FROM dbo.QuotationSuppliers qs WHERE qs.QuotationId = q.QuotationId AND qs.Status = 'Submitted') AS SubmittedCount
      FROM       dbo.Quotations q
      LEFT JOIN  dbo.enterprise ec ON ec.id  = q.CompanyId
      LEFT JOIN  dbo.enterprise ep ON ep.id  = q.ProjectId
      LEFT JOIN  dbo.FinYear    fy ON fy.FId = q.FinYearId
      WHERE ${conditions.join(" AND ")}
      ORDER BY q.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const hdr = await pool.request().input("id", sql.Int, id).query(`
      SELECT q.*, ec.name AS CompanyName, ep.name AS ProjectName, fy.FName AS FinYearName
      FROM   dbo.Quotations q
      LEFT JOIN dbo.enterprise ec ON ec.id  = q.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id  = q.ProjectId
      LEFT JOIN dbo.FinYear    fy ON fy.FId = q.FinYearId
      WHERE q.QuotationId = @id
    `);
    if (!hdr.recordset.length) return res.status(404).json({ error: "Not found" });

    const items = await pool.request().input("id", sql.Int, id).query(`
      SELECT qi.*, u.UOMName, u.Symbol AS UOMSymbol
      FROM   dbo.QuotationItems qi
      LEFT JOIN dbo.UOMMaster u ON u.UOMCode = qi.UOMCode
      WHERE  qi.QuotationId = @id
      ORDER  BY qi.QuotationItemId
    `);

    const suppliers = await pool.request().input("id", sql.Int, id).query(`
      SELECT qs.Id, qs.SupplierLHeadId, qs.Status, qs.InvitedAt,
             ISNULL(ah.DisplayName, ah.LHeadName) AS SupplierName
      FROM   dbo.QuotationSuppliers qs
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = qs.SupplierLHeadId
      WHERE  qs.QuotationId = @id
      ORDER  BY SupplierName
    `);

    const prices = await pool.request().input("id", sql.Int, id).query(`
      SELECT QuotationItemId, SupplierLHeadId, Rate, SupplyDate, Quality, SubmittedAt
      FROM   dbo.QuotationSupplierPrices
      WHERE  QuotationId = @id
    `);

    res.json({
      ...hdr.recordset[0],
      items: items.recordset,
      suppliers: suppliers.recordset,
      prices: prices.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─────────────────────────────────────────────────────────────────────
router.post("/", authenticateToken, requirePageRight("quotation", "create"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const {
      CompanyId,
      ProjectId,
      FinYearId,
      SourceMRId,
      SourceMRDocNo,
      DocDate,
      DueDate,
      Remarks,
      TermsConditionIds,
      items = [],
      supplierLHeadIds = [],
    } = req.body;

    if (!items.length)
      return res.status(400).json({ error: "At least one item is required" });

    let dtId = null;
    try {
      dtId = await resolveDocTypeId(pool, sql, "QT");
    } catch {
      /* no QT doc type configured — proceed without numbering */
    }
    let lockedDocNo = null;
    if (dtId) {
      try {
        lockedDocNo = await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "Quotations",
          docNoColumn: "DocNo",
          issuedBy: user,
        });
      } catch {
        lockedDocNo = null;
      }
    }

    // Header + items + tagged suppliers must be one atomic unit — previously
    // each ran on the plain pool (auto-committing individually), so a
    // failure partway through either loop left a Quotations header
    // permanently committed with only some of its intended items/suppliers,
    // and no rollback to clean it up. Same bug class found and fixed in
    // materialRequests.js.
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
      const insertHdr = await tx
        .request()
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("FinYearId", sql.Int, FinYearId || null)
        .input("SourceMRId", sql.Int, SourceMRId || null)
        .input("SourceMRDocNo", sql.NVarChar(100), SourceMRDocNo || null)
        .input("DocDate", sql.Date, DocDate || new Date())
        .input("DueDate", sql.Date, DueDate || null)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input("TermsConditionIds", sql.NVarChar(sql.MAX), TermsConditionIds ? JSON.stringify(TermsConditionIds) : null)
        .input("DocTypeId", sql.Int, dtId || null)
        .input("DocNo", sql.NVarChar(100), lockedDocNo || null)
        .input("CreatedBy", sql.NVarChar(200), user).query(`
          INSERT INTO dbo.Quotations
            (CompanyId, ProjectId, FinYearId, SourceMRId, SourceMRDocNo,
             DocDate, DueDate, Remarks, TermsConditionIds, Status, DocTypeId, DocNo, CreatedBy, UpdatedBy)
          OUTPUT INSERTED.QuotationId
          VALUES (@CompanyId, @ProjectId, @FinYearId, @SourceMRId, @SourceMRDocNo,
                  @DocDate, @DueDate, @Remarks, @TermsConditionIds, 'Draft', @DocTypeId, @DocNo, @CreatedBy, @CreatedBy)
        `);

      newId = insertHdr.recordset[0].QuotationId;

      for (const item of items) {
        await tx
          .request()
          .input("QuotationId", sql.Int, newId)
          .input("MRItemId", sql.Int, item.MRItemId || null)
          .input("ItemId", sql.NVarChar(50), String(item.ItemId))
          .input("ItemName", sql.NVarChar(200), item.ItemName || null)
          .input("UOMCode", sql.NVarChar(20), item.UOMCode || null)
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity) || 0)
          .input("Remarks", sql.NVarChar(sql.MAX), item.Remarks || null).query(`
            INSERT INTO dbo.QuotationItems (QuotationId, MRItemId, ItemId, ItemName, UOMCode, Quantity, Remarks)
            VALUES (@QuotationId, @MRItemId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
          `);
      }

      for (const lheadId of supplierLHeadIds) {
        await tx
          .request()
          .input("QuotationId", sql.Int, newId)
          .input("SupplierLHeadId", sql.Int, parseInt(lheadId, 10)).query(`
            INSERT INTO dbo.QuotationSuppliers (QuotationId, SupplierLHeadId)
            VALUES (@QuotationId, @SupplierLHeadId)
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

    // Best-effort, after commit — matching materialRequests.js's convention:
    // a failure here shouldn't roll back an already-successful quotation.
    if (lockedDocNo) {
      await backPatchRecordId(pool, sql, lockedDocNo, "Quotations", newId);
    }

    const created = await pool
      .request()
      .input("id", sql.Int, newId)
      .query("SELECT DocNo, Status FROM dbo.Quotations WHERE QuotationId = @id");

    res.status(201).json({
      QuotationId: newId,
      DocNo: created.recordset[0]?.DocNo,
      Status: created.recordset[0]?.Status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("quotation", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const statusCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.Quotations WHERE QuotationId=@id");
    if (!statusCheck.recordset.length) return res.status(404).json({ error: "Not found" });
    if (statusCheck.recordset[0].Status !== "Draft")
      return res.status(409).json({
        error: `Cannot edit a Quotation with status "${statusCheck.recordset[0].Status}". Only Draft quotations can be edited.`,
      });

    const {
      CompanyId,
      ProjectId,
      FinYearId,
      SourceMRId,
      SourceMRDocNo,
      DocDate,
      DueDate,
      Remarks,
      TermsConditionIds,
      items = [],
    } = req.body;

    // Header update + item replacement must be one atomic unit — the item
    // replacement DELETEs all existing items before re-inserting the new
    // set, so a failure partway through the insert loop used to leave the
    // quotation with neither its old nor its complete new items. Same bug
    // class found and fixed in materialRequests.js.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const updateResult = await tx
        .request()
        .input("id", sql.Int, id)
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("FinYearId", sql.Int, FinYearId || null)
        .input("SourceMRId", sql.Int, SourceMRId || null)
        .input("SourceMRDocNo", sql.NVarChar(100), SourceMRDocNo || null)
        .input("DocDate", sql.Date, DocDate || new Date())
        .input("DueDate", sql.Date, DueDate || null)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input("TermsConditionIds", sql.NVarChar(sql.MAX), TermsConditionIds ? JSON.stringify(TermsConditionIds) : null)
        .input("UpdatedBy", sql.NVarChar(200), user).query(`
          UPDATE dbo.Quotations
          SET CompanyId=@CompanyId, ProjectId=@ProjectId, FinYearId=@FinYearId,
              SourceMRId=@SourceMRId, SourceMRDocNo=@SourceMRDocNo,
              DocDate=@DocDate, DueDate=@DueDate, Remarks=@Remarks,
              TermsConditionIds=@TermsConditionIds,
              UpdatedBy=@UpdatedBy, UpdatedAt=SYSDATETIME()
          WHERE QuotationId=@id AND Status='Draft'
        `);

      // Race-condition guard: if another request approved/sent this
      // quotation between our status check and the UPDATE, rowsAffected
      // will be 0.
      if (updateResult.rowsAffected[0] === 0) {
        await tx.rollback();
        return res.status(409).json({
          error: "Update failed: the quotation status changed before the update could be applied.",
        });
      }

      await tx.request().input("id", sql.Int, id).query(
        "DELETE FROM dbo.QuotationItems WHERE QuotationId=@id",
      );

      for (const item of items) {
        await tx
          .request()
          .input("QuotationId", sql.Int, id)
          .input("MRItemId", sql.Int, item.MRItemId || null)
          .input("ItemId", sql.NVarChar(50), String(item.ItemId))
          .input("ItemName", sql.NVarChar(200), item.ItemName || null)
          .input("UOMCode", sql.NVarChar(20), item.UOMCode || null)
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity) || 0)
          .input("Remarks", sql.NVarChar(sql.MAX), item.Remarks || null).query(`
            INSERT INTO dbo.QuotationItems (QuotationId, MRItemId, ItemId, ItemName, UOMCode, Quantity, Remarks)
            VALUES (@QuotationId, @MRItemId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
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

    res.json({ message: "Quotation updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id (Draft only) ──────────────────────────────────────────────────
router.delete("/:id", authenticateToken, requirePageRight("quotation", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const check = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.Quotations WHERE QuotationId=@id");
    if (!check.recordset.length) return res.status(404).json({ error: "Not found" });
    if (check.recordset[0].Status !== "Draft")
      return res.status(409).json({ error: "Only Draft quotations can be deleted." });

    await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.Quotations WHERE QuotationId=@id");

    res.json({ message: "Quotation deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/send ─────────────────────────────────────────────────────────────
// Flips Draft → Sent, making the quotation visible in tagged suppliers' portal.
router.post("/:id/send", authenticateToken, requirePageRight("quotation", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const supplierCheck = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS cnt FROM dbo.QuotationSuppliers WHERE QuotationId=@id");
    if (!supplierCheck.recordset[0].cnt)
      return res.status(400).json({ error: "Tag at least one supplier before sending the quotation." });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("user", sql.NVarChar(200), user).query(`
        UPDATE dbo.Quotations
        SET Status='Sent', UpdatedBy=@user, UpdatedAt=SYSDATETIME()
        WHERE QuotationId=@id AND Status='Draft'
      `);

    if (result.rowsAffected[0] === 0)
      return res.status(409).json({ error: "Only Draft quotations can be sent." });

    res.json({ message: "Quotation sent to suppliers" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/suppliers ───────────────────────────────────────────────────────
// Tag additional suppliers onto an existing quotation (used from the L1 Chart
// "+ Add Supplier" button as well as during initial creation).
router.post("/:id/suppliers", authenticateToken, requirePageRight("quotation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const { supplierLHeadIds = [] } = req.body;
    if (!supplierLHeadIds.length)
      return res.status(400).json({ error: "supplierLHeadIds is required" });

    const qCheck = await pool.request().input("id", sql.Int, id)
      .query("SELECT QuotationId FROM dbo.Quotations WHERE QuotationId=@id");
    if (!qCheck.recordset.length) return res.status(404).json({ error: "Quotation not found" });

    for (const lheadId of supplierLHeadIds) {
      const supplierId = parseInt(lheadId, 10);
      if (!supplierId) continue;
      const exists = await pool
        .request()
        .input("QuotationId", sql.Int, id)
        .input("SupplierLHeadId", sql.Int, supplierId)
        .query(
          "SELECT 1 FROM dbo.QuotationSuppliers WHERE QuotationId=@QuotationId AND SupplierLHeadId=@SupplierLHeadId",
        );
      if (exists.recordset.length) continue;

      await pool
        .request()
        .input("QuotationId", sql.Int, id)
        .input("SupplierLHeadId", sql.Int, supplierId).query(`
          INSERT INTO dbo.QuotationSuppliers (QuotationId, SupplierLHeadId)
          VALUES (@QuotationId, @SupplierLHeadId)
        `);
    }

    // A quotation gaining suppliers after being Sent should surface as Sent again
    // (in case it had already moved to Quoted/Closed — keep it simple: no-op there).
    res.json({ message: "Supplier(s) tagged" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id/suppliers/:supplierId ─────────────────────────────────────────
router.delete("/:id/suppliers/:supplierId", authenticateToken, requirePageRight("quotation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const supplierId = parseInt(req.params.supplierId, 10);
    if (isNaN(id) || isNaN(supplierId)) return res.status(400).json({ error: "Invalid id" });
    await pool
      .request()
      .input("QuotationId", sql.Int, id)
      .input("SupplierLHeadId", sql.Int, supplierId)
      .query("DELETE FROM dbo.QuotationSuppliers WHERE QuotationId=@QuotationId AND SupplierLHeadId=@SupplierLHeadId");
    res.json({ message: "Supplier removed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/l1-chart ──────────────────────────────────────────────────────────
// Comparative data: every item x every tagged supplier's Rate/SupplyDate/Quality.
router.get("/:id/l1-chart", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const items = await pool.request().input("id", sql.Int, id).query(`
      SELECT qi.QuotationItemId, qi.ItemId, qi.ItemName, qi.UOMCode, u.UOMName, qi.Quantity
      FROM   dbo.QuotationItems qi
      LEFT JOIN dbo.UOMMaster u ON u.UOMCode = qi.UOMCode
      WHERE  qi.QuotationId = @id
      ORDER  BY qi.QuotationItemId
    `);

    const suppliers = await pool.request().input("id", sql.Int, id).query(`
      SELECT qs.SupplierLHeadId, qs.Status,
             ISNULL(ah.DisplayName, ah.LHeadName) AS SupplierName
      FROM   dbo.QuotationSuppliers qs
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = qs.SupplierLHeadId
      WHERE  qs.QuotationId = @id
      ORDER  BY SupplierName
    `);

    const prices = await pool.request().input("id", sql.Int, id).query(`
      SELECT QuotationItemId, SupplierLHeadId, Rate, SupplyDate, Quality
      FROM   dbo.QuotationSupplierPrices
      WHERE  QuotationId = @id
    `);

    res.json({
      items: items.recordset,
      suppliers: suppliers.recordset,
      prices: prices.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/po-prefill?supplierId= ───────────────────────────────────────────
// Shapes the winning supplier's submitted rates as a PO prefill payload —
// mirrors the shape of GET /api/material-requests/:id/create-po-prefill.
router.get("/:id/po-prefill", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const supplierId = parseInt(req.query.supplierId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    if (!supplierId) return res.status(400).json({ error: "supplierId is required" });

    const header = await pool.request().input("id", sql.Int, id).query(`
      SELECT q.QuotationId, q.DocNo, q.Status,
             q.CompanyId, ec.name AS CompanyName,
             q.ProjectId, ep.name AS ProjectName,
             q.FinYearId, q.Remarks,
             q.SourceMRId, q.SourceMRDocNo
      FROM dbo.Quotations q
      LEFT JOIN dbo.enterprise ec ON ec.id = q.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id = q.ProjectId
      WHERE q.QuotationId = @id
    `);
    if (!header.recordset.length) return res.status(404).json({ error: "Quotation not found" });
    const qt = header.recordset[0];

    const supplierCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, supplierId)
      .query(
        "SELECT 1 FROM dbo.QuotationSuppliers WHERE QuotationId=@id AND SupplierLHeadId=@supplierId",
      );
    if (!supplierCheck.recordset.length)
      return res.status(400).json({ error: "That supplier is not tagged on this quotation." });

    const supplierName = await pool
      .request()
      .input("id", sql.Int, supplierId)
      .query("SELECT ISNULL(DisplayName, LHeadName) AS Name FROM dbo.AccountHeadMaster WHERE LHeadId=@id");

    const items = await pool
      .request()
      .input("id", sql.Int, id)
      .input("supplierId", sql.Int, supplierId).query(`
        SELECT
          qi.QuotationItemId, qi.ItemId, qi.ItemName, qi.UOMCode, u.UOMName,
          qi.Quantity, qi.Remarks,
          im.M_CGST, im.M_SGST, im.M_IGST,
          qsp.Rate, qsp.SupplyDate, qsp.Quality
        FROM dbo.QuotationItems qi
        LEFT JOIN dbo.UOMMaster u ON u.UOMCode = qi.UOMCode
        LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(50), im.M_Id) = CONVERT(NVARCHAR(50), qi.ItemId)
        LEFT JOIN dbo.QuotationSupplierPrices qsp
          ON qsp.QuotationItemId = qi.QuotationItemId AND qsp.SupplierLHeadId = @supplierId
        WHERE qi.QuotationId = @id
      `);

    res.json({
      QuotationId: qt.QuotationId,
      DocNo: qt.DocNo,
      CompanyId: qt.CompanyId,
      CompanyName: qt.CompanyName,
      ProjectId: qt.ProjectId,
      ProjectName: qt.ProjectName,
      FinYearId: qt.FinYearId,
      Remarks: qt.Remarks,
      SupplierId: supplierId,
      SupplierName: supplierName.recordset[0]?.Name || null,
      SourceMRId: qt.SourceMRId ?? null,
      SourceMRDocNo: qt.SourceMRDocNo ?? null,
      items: items.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
