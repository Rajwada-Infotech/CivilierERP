/**
 * backend/routes/vehicleInOut.js
 *
 * REST endpoints for the Vehicle In/Out module.
 *
 * Prefix  : /api/vehicle-in-out
 * DocType : VEH  (VEH-2026-00001)
 * Table   : dbo.VehicleInOut
 * Perms   : Module="Material", SubModule="VehicleInOut"
 *
 * Attachments (camera captures + file picks) are stored as binary in
 * dbo.VehicleInOutAttachments — same pattern as dbo.ticket_attachments.
 * No disk dependency: any app instance can serve any attachment, and
 * attachments are included in normal DB backups automatically.
 *
 * Routes
 *   GET    /                     — paginated list
 *   GET    /next-number          — preview next VEH-YYYY-NNNNN
 *   GET    /:id                  — single record (includes attachments[])
 *   POST   /                     — create (links pending attachmentIds)
 *   PUT    /:id                  — update (links/unlinks attachmentIds)
 *   DELETE /:id                  — delete (attachments cascade-delete)
 *   POST   /upload                — upload one or more files to DB, returns attachment ids/urls
 *   GET    /attachment/:attachId — stream a single attachment's binary
 *   DELETE /attachment/:attachId — remove a single attachment (e.g. user removes it before saving)
 */

"use strict";

const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const { getPool, sql } = require("../db");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { transition } = require("../services/approvalService");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  resolveDocTypeId,
  lockNextDocNumber,
  backPatchRecordId,
  previewNextDocNumber,
} = require("../utils/docNumberLock");
const {
  getPendingVehicleInOutsForPO,
  getDocumentChainForVehicleInOut,
  getVehicleInOutItemsEnriched,
} = require("../services/poVehicleGrnChain");

const router = express.Router();

// ── Rate-limit ────────────────────────────────────────────────────────────────
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// ── Permission guard ─────────────────────────────────────────────────────────
router.use(checkPermissionForMethod("Material", "VehicleInOut"));

// ── Multer — memory storage (files go to DB, not disk) ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|heic/i;
    const okExt = allowed.test(file.originalname);
    const okMime =
      allowed.test(file.mimetype) || file.mimetype === "application/pdf";
    if (okExt || okMime) cb(null, true);
    else
      cb(
        new Error(
          "Only images (jpg, png, gif, webp, heic) and PDFs are allowed",
        ),
      );
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const CACHE_KEY = "vehicle_in_out";

function userEmail(req, res) {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
}

function parseIdList(raw) {
  // Accepts a real array (JSON body) or a JSON-string-encoded array.
  if (Array.isArray(raw))
    return raw.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    } catch {
      return [];
    }
  }
  return [];
}

function attachmentRowToDto(a) {
  return {
    id: a.AttachmentId,
    filename: a.FileName,
    mimeType: a.MimeType,
    size: a.FileSize,
    url: `/api/vehicle-in-out/attachment/${a.AttachmentId}`,
  };
}

/** Link a set of previously-uploaded (unlinked) attachment ids to a VehicleInOutID. */
async function linkAttachments(pool, vehicleInOutId, attachmentIds) {
  if (!attachmentIds.length) return;
  for (const attachId of attachmentIds) {
    await pool
      .request()
      .input("AttachmentId", sql.Int, attachId)
      .input("VehicleInOutID", sql.Int, vehicleInOutId).query(`
        UPDATE dbo.VehicleInOutAttachments
        SET VehicleInOutID = @VehicleInOutID
        WHERE AttachmentId = @AttachmentId AND VehicleInOutID IS NULL
      `);
  }
}

/** Fetch attachment metadata (no binary) for a given VehicleInOutID. */
async function getAttachmentsFor(pool, vehicleInOutId) {
  const result = await pool
    .request()
    .input("VehicleInOutID", sql.Int, vehicleInOutId).query(`
      SELECT AttachmentId, FileName, MimeType, FileSize
      FROM dbo.VehicleInOutAttachments
      WHERE VehicleInOutID = @VehicleInOutID
      ORDER BY UploadedAt ASC
    `);
  return result.recordset.map(attachmentRowToDto);
}

/**
 * PO line items with how much has already been received across Vehicle
 * In/Out lots (excluding Rejected/Deleted header records and, when editing
 * an existing record, that record's own rows — otherwise a record would
 * count its own already-saved quantity against itself and shrink its own
 * editable range every time it's opened). Independent of GRN's
 * PurchaseOrderItems.ReceivedQty — see migration 191's header comment.
 */
async function getPOItemsWithRemaining(pool, poId, excludeVehicleInOutId) {
  const request = pool.request().input("POID", sql.Int, poId);
  if (excludeVehicleInOutId) {
    request.input("ExcludeID", sql.Int, excludeVehicleInOutId);
  }
  const result = await request.query(`
    SELECT
      poi.Id AS POItemId,
      poi.ItemId,
      poi.ItemName,
      poi.ItemCode,
      poi.UomName,
      poi.Quantity AS OrderedQty,
      ISNULL((
        SELECT SUM(vi.ReceivedQty)
        FROM dbo.VehicleInOutItems vi
        JOIN dbo.VehicleInOut v ON v.VehicleInOutID = vi.VehicleInOutID
        WHERE vi.POItemId = poi.Id
          AND v.Status NOT IN ('Rejected', 'Deleted')
          ${excludeVehicleInOutId ? "AND v.VehicleInOutID <> @ExcludeID" : ""}
      ), 0) AS ReceivedSoFar
    FROM dbo.PurchaseOrderItems poi
    WHERE poi.PurchaseOrderID = @POID
    ORDER BY poi.SortOrder
  `);
  return result.recordset.map((r) => ({
    poItemId: r.POItemId,
    itemId: r.ItemId,
    itemName: r.ItemName,
    itemCode: r.ItemCode,
    uomName: r.UomName,
    orderedQty: Number(r.OrderedQty) || 0,
    receivedSoFar: Number(r.ReceivedSoFar) || 0,
    remainingQty: Math.max(0, (Number(r.OrderedQty) || 0) - (Number(r.ReceivedSoFar) || 0)),
  }));
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Validates each submitted {poItemId, receivedQty} against what's actually
 * left to receive on the PO (ordered - already received across other
 * lots, excluding this record's own rows when editing). Throws
 * ValidationError (caught by the route as a 400) if any line would push
 * received-so-far past what was ordered — the "don't let me save 1000
 * when I ordered 100" rule, enforced per PO line item. Pure — no writes —
 * so callers can validate before touching the header row.
 */
async function validateVehicleInOutItems(pool, poId, items, excludeVehicleInOutId) {
  const submitted = (Array.isArray(items) ? items : [])
    .map((it) => ({
      poItemId: parseInt(it.poItemId, 10),
      receivedQty: Number(it.receivedQty) || 0,
    }))
    .filter((it) => it.poItemId && it.receivedQty > 0);

  if (!poId || submitted.length === 0) return [];

  const remaining = await getPOItemsWithRemaining(pool, poId, excludeVehicleInOutId);
  const byId = new Map(remaining.map((r) => [r.poItemId, r]));

  for (const line of submitted) {
    const po = byId.get(line.poItemId);
    if (!po) {
      throw new ValidationError(
        `Item (PO line ${line.poItemId}) does not belong to the selected purchase order.`,
      );
    }
    if (line.receivedQty > po.remainingQty + 1e-6) {
      throw new ValidationError(
        `${po.itemName || "Item"}: cannot receive ${line.receivedQty} — only ${po.remainingQty} remaining on the PO (ordered ${po.orderedQty}, already received ${po.receivedSoFar}).`,
      );
    }
  }

  return submitted.map((line) => ({ ...line, po: byId.get(line.poItemId) }));
}

/**
 * Replaces a Vehicle In/Out record's item rows with an already-validated
 * set (from validateVehicleInOutItems). Delete-then-insert so an edit that
 * drops a line (receivedQty set to 0, or removed entirely) doesn't leave a
 * stale row counting against the PO forever.
 */
async function saveVehicleInOutItems(pool, vehicleInOutId, validatedItems) {
  await pool.request().input("ID", sql.Int, vehicleInOutId).query(`
    DELETE FROM dbo.VehicleInOutItems WHERE VehicleInOutID = @ID
  `);

  for (const line of validatedItems) {
    await pool
      .request()
      .input("VehicleInOutID", sql.Int, vehicleInOutId)
      .input("POItemId", sql.Int, line.poItemId)
      .input("ItemId", sql.NVarChar(100), line.po.itemId || null)
      .input("ItemName", sql.NVarChar(255), line.po.itemName || null)
      .input("UomName", sql.NVarChar(50), line.po.uomName || null)
      .input("ReceivedQty", sql.Decimal(18, 3), line.receivedQty).query(`
        INSERT INTO dbo.VehicleInOutItems
          (VehicleInOutID, POItemId, ItemId, ItemName, UomName, ReceivedQty)
        VALUES
          (@VehicleInOutID, @POItemId, @ItemId, @ItemName, @UomName, @ReceivedQty)
      `);
  }
}

// ── GET /next-number ─────────────────────────────────────────────────────────
router.get("/next-number", async (req, res) => {
  try {
    const pool = getPool();
    const docTypeId = await resolveDocTypeId(pool, sql, "VEH");
    const preview = await previewNextDocNumber(pool, sql, docTypeId);
    res.json({ nextDocNo: preview.nextDocNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /po-ids-with-vio — distinct PO ids that have at least one Vehicle
// In/Out record logged against them. Used by GRN.tsx to only offer POs in
// its picker that have actually had a vehicle bring goods in, rather than
// every Approved PO regardless of whether anything's arrived yet.
router.get("/po-ids-with-vio", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT DISTINCT POID FROM dbo.VehicleInOut WHERE POID IS NOT NULL
    `);
    res.json(result.recordset.map((r) => r.POID));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — paginated list ────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const offset = (page - 1) * limit;

    const finYear = req.query.finYear || null;
    const search = req.query.search || null;

    const request = pool
      .request()
      .input("Offset", sql.Int, offset)
      .input("Limit", sql.Int, limit)
      .input("FinYear", sql.NVarChar(20), finYear)
      .input("Search", sql.NVarChar(255), search ? `%${search}%` : null);

    const result = await request.query(`
      SELECT
        v.VehicleInOutID,
        v.DocNo,
        v.DocDate,
        v.CompanyID,
        v.ProjectID,
        v.FinYear,
        v.SupplierID,
        v.SupplierName,
        v.POID,
        v.PONumber,
        v.VehicleNo,
        v.EntryTime,
        v.ExitTime,
        v.ChallanNo,
        v.Remarks,
        v.Status,
        v.CreatedAt,
        -- Joined names
        ec.Name   AS CompanyName,
        ep.Name   AS ProjectName,
        -- Attachment count (binary itself is fetched separately/lazily)
        (SELECT COUNT(*) FROM dbo.VehicleInOutAttachments a WHERE a.VehicleInOutID = v.VehicleInOutID) AS AttachmentCount
      FROM dbo.VehicleInOut v
      LEFT JOIN dbo.enterprise ec ON ec.id = v.CompanyID
      LEFT JOIN dbo.enterprise ep ON ep.id = v.ProjectID
      WHERE 1=1
        AND (@FinYear IS NULL OR v.FinYear = @FinYear)
        AND (
          @Search IS NULL OR
          v.DocNo      LIKE @Search OR
          v.VehicleNo  LIKE @Search OR
          v.ChallanNo  LIKE @Search OR
          v.SupplierName LIKE @Search
        )
      ORDER BY v.VehicleInOutID DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;

      SELECT COUNT(*) AS Total
      FROM dbo.VehicleInOut v
      WHERE 1=1
        AND (@FinYear IS NULL OR v.FinYear = @FinYear)
        AND (
          @Search IS NULL OR
          v.DocNo      LIKE @Search OR
          v.VehicleNo  LIKE @Search OR
          v.ChallanNo  LIKE @Search OR
          v.SupplierName LIKE @Search
        );
    `);

    const rows = result.recordsets[0];
    const total = result.recordsets[1][0]?.Total ?? 0;

    res.json({
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("ID", sql.Int, id).query(`
        SELECT
          v.*,
          ec.Name AS CompanyName,
          ep.Name AS ProjectName
        FROM dbo.VehicleInOut v
        LEFT JOIN dbo.enterprise ec ON ec.id = v.CompanyID
        LEFT JOIN dbo.enterprise ep ON ep.id = v.ProjectID
        WHERE v.VehicleInOutID = @ID
      `);

    if (!result.recordset[0])
      return res.status(404).json({ error: "Not found" });

    const record = result.recordset[0];
    record.Attachments = await getAttachmentsFor(pool, id);
    const itemsResult = await pool.request().input("ItemsID", sql.Int, id).query(`
      SELECT VehicleInOutItemID, POItemId, ItemId, ItemName, UomName, ReceivedQty
      FROM dbo.VehicleInOutItems
      WHERE VehicleInOutID = @ItemsID
    `);
    record.Items = itemsResult.recordset;

    const chain = await getDocumentChainForVehicleInOut(pool, id);
    record.GRN = chain?.grn || null;
    record.GRNStatus = chain?.grn ? "GRN Created" : "Pending GRN";

    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /po/:poId/pending-grn — Vehicle In/Out lots eligible for a new GRN ───
// Excludes any lot that already has an active (non-Rejected) GRN — the
// "PO -> Vehicle In/Out -> GRN" picker on the GRN form uses this to only
// offer lots that haven't been consumed yet.
router.get("/po/:poId/pending-grn", async (req, res) => {
  try {
    const pool = getPool();
    const poId = parseInt(req.params.poId, 10);
    if (!poId) return res.status(400).json({ error: "Invalid poId" });
    const rows = await getPendingVehicleInOutsForPO(pool, poId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/po — fetch linked PO details (no PO permission needed) ──────────
router.get("/:id/po", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    // Resolve POID from this VehicleInOut record
    const vehResult = await pool.request()
      .input("ID", sql.Int, id)
      .query("SELECT POID FROM dbo.VehicleInOut WHERE VehicleInOutID = @ID");
    const poid = vehResult.recordset[0]?.POID;
    if (!poid) return res.status(404).json({ error: "No PO linked to this record" });

    // Fetch PO header
    const poResult = await pool.request()
      .input("POID", sql.Int, poid)
      .query(`
        SELECT
          po.PurchaseOrderID, po.PurchaseOrderNo, po.PODate,
          po.ExpectedDeliveryDate, po.Status, po.TotalAmount, po.PaymentTerms,
          po.Remarks,
          ah.LHeadName AS SupplierName,
          co.name      AS CompanyName,
          pr.name      AS ProjectName
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        LEFT JOIN dbo.enterprise        co ON co.id      = po.CompanyId
        LEFT JOIN dbo.enterprise        pr ON pr.id      = po.ProjectId
        WHERE po.PurchaseOrderID = @POID
      `);
    if (!poResult.recordset[0])
      return res.status(404).json({ error: "PO not found" });

    // Fetch line items
    const itemsResult = await pool.request()
      .input("POID2", sql.Int, poid)
      .query(`
        SELECT ItemName, Description, Quantity, UomName, Rate, TaxPct, LineAmount
        FROM dbo.PurchaseOrderItems
        WHERE PurchaseOrderID = @POID2
        ORDER BY SortOrder
      `);

    res.json({ ...poResult.recordset[0], LineItems: itemsResult.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/items-enriched — this record's items joined with PO rate/UOM/tax ──
// Used by the GRN form once a Vehicle In/Out lot is picked: builds GRN line
// items straight from what this specific vehicle actually brought in.
router.get("/:id/items-enriched", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const items = await getVehicleInOutItemsEnriched(pool, id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pending-summary — POs with goods still outstanding after partial
// Vehicle In/Out deliveries. Backs the "Pending Vehicle In/Out" widget:
// PendingQty = ordered - received-so-far (excluding Rejected/Deleted lots),
// aggregated across all line items on the PO. LastVehicleInOutID points at
// the most recent lot already logged against that PO (if any), so clicking
// a widget row can jump straight to what's already come in.
router.get("/pending-summary", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      ;WITH ItemReceived AS (
        SELECT
          poi.PurchaseOrderID,
          poi.Quantity AS OrderedQty,
          ISNULL((
            SELECT SUM(vi.ReceivedQty)
            FROM dbo.VehicleInOutItems vi
            JOIN dbo.VehicleInOut v ON v.VehicleInOutID = vi.VehicleInOutID
            WHERE vi.POItemId = poi.Id AND v.Status NOT IN ('Rejected', 'Deleted')
          ), 0) AS ReceivedQty
        FROM dbo.PurchaseOrderItems poi
      ),
      ItemAgg AS (
        SELECT
          PurchaseOrderID,
          SUM(OrderedQty) AS TotalOrdered,
          SUM(ReceivedQty) AS TotalReceived
        FROM ItemReceived
        GROUP BY PurchaseOrderID
      )
      SELECT
        po.PurchaseOrderID,
        po.PurchaseOrderNo,
        po.DocNo,
        po.SupplierID,
        ahm.LHeadName AS SupplierName,
        po.CompanyId,
        po.ProjectId,
        ia.TotalOrdered,
        ia.TotalReceived,
        (ia.TotalOrdered - ia.TotalReceived) AS PendingQty,
        lastVeh.VehicleInOutID AS LastVehicleInOutID,
        lastVeh.DocNo AS LastVehicleInOutDocNo,
        lastVeh.VehicleNo AS LastVehicleNo
      FROM ItemAgg ia
      JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = ia.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = po.SupplierID
      OUTER APPLY (
        SELECT TOP 1 v.VehicleInOutID, v.DocNo, v.VehicleNo
        FROM dbo.VehicleInOut v
        WHERE v.POID = po.PurchaseOrderID AND v.Status NOT IN ('Rejected', 'Deleted')
        ORDER BY v.VehicleInOutID DESC
      ) lastVeh
      WHERE po.Status IN ('Approved', 'Received')
        AND (ia.TotalOrdered - ia.TotalReceived) > 0
      ORDER BY po.PurchaseOrderID DESC
    `);

    res.json(
      result.recordset.map((r) => ({
        poId: r.PurchaseOrderID,
        poNumber: r.DocNo || r.PurchaseOrderNo,
        supplierName: r.SupplierName,
        companyId: r.CompanyId,
        projectId: r.ProjectId,
        totalOrdered: Number(r.TotalOrdered) || 0,
        totalReceived: Number(r.TotalReceived) || 0,
        pendingQty: Number(r.PendingQty) || 0,
        lastVehicleInOutId: r.LastVehicleInOutID ?? null,
        lastVehicleInOutDocNo: r.LastVehicleInOutDocNo ?? null,
        lastVehicleNo: r.LastVehicleNo ?? null,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /po-items/:poId — PO line items with remaining-to-receive quantity ───
// Used both when picking a PO on a new record (no excludeVehicleInOutId) and
// when editing an existing one (excludeVehicleInOutId=<this record's id>, so
// its own already-saved quantities don't count against its own remaining).
router.get("/po-items/:poId", async (req, res) => {
  try {
    const pool = getPool();
    const poId = parseInt(req.params.poId, 10);
    if (!poId) return res.status(400).json({ error: "Invalid poId" });
    const excludeId = req.query.excludeVehicleInOutId
      ? parseInt(req.query.excludeVehicleInOutId, 10)
      : null;
    const items = await getPOItemsWithRemaining(pool, poId, excludeId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/items — this record's own saved received quantities ─────────────
router.get("/:id/items", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const result = await pool.request().input("ID", sql.Int, id).query(`
      SELECT VehicleInOutItemID, POItemId, ItemId, ItemName, UomName, ReceivedQty
      FROM dbo.VehicleInOutItems
      WHERE VehicleInOutID = @ID
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", requirePageRight("vehicle-in-out", "create"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const {
    docDate,
    companyId,
    projectId,
    finYear,
    supplierId,
    supplierName,
    poId,
    poNumber,
    vehicleNo,
    entryTime,
    exitTime,
    challanNo,
    attachmentIds, // array of ids returned by POST /upload, still unlinked
    remarks,
    items, // [{ poItemId, receivedQty }] — quantity received in this lot
  } = req.body;

  if (!vehicleNo)
    return res.status(400).json({ error: "vehicleNo is required" });

  const pool = getPool();
  let recordId = null;

  try {
    // ── 0. Validate received quantities against what's left on the PO ───────
    // before touching the header row, so a rejected submission never
    // creates an orphaned Vehicle In/Out record.
    const validatedItems = await validateVehicleInOutItems(pool, poId, items, null);

    // ── 1. Resolve doc type ──────────────────────────────────────────────────
    const docTypeId = await resolveDocTypeId(pool, sql, "VEH");

    // ── 2. Lock next doc number ──────────────────────────────────────────────
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      finYear: finYear || null,
      tableName: "VehicleInOut",
      docNoColumn: "DocNo",
      issuedBy: email,
      parentDocNo: null,
    });

    // ── 3. Insert record ─────────────────────────────────────────────────────
    const insert = await pool
      .request()
      .input("DocNo", sql.NVarChar(50), finalDocNo)
      .input("DocTypeId", sql.Int, docTypeId)
      .input("DocDate", sql.Date, docDate || new Date())
      .input("CompanyID", sql.Int, companyId || null)
      .input("ProjectID", sql.Int, projectId || null)
      .input("FinYear", sql.NVarChar(20), finYear || null)
      .input("SupplierID", sql.Int, supplierId || null)
      .input("SupplierName", sql.NVarChar(255), supplierName || null)
      .input("POID", sql.Int, poId || null)
      .input("PONumber", sql.NVarChar(100), poNumber || null)
      .input("VehicleNo", sql.NVarChar(50), vehicleNo)
      .input(
        "EntryTime",
        sql.DateTime,
        entryTime ? new Date(entryTime) : new Date(),
      )
      .input("ExitTime", sql.DateTime, exitTime ? new Date(exitTime) : null)
      .input("ChallanNo", sql.NVarChar(100), challanNo || null)
      .input("Remarks", sql.NVarChar(1000), remarks || null)
      .input("Status", sql.NVarChar(30), "Draft")
      .input("CreatedBy", sql.NVarChar(150), email)
      .input("UpdatedBy", sql.NVarChar(150), email).query(`
        INSERT INTO dbo.VehicleInOut
          (DocNo, DocTypeId, DocDate,
           CompanyID, ProjectID, FinYear,
           SupplierID, SupplierName, POID, PONumber,
           VehicleNo, EntryTime, ExitTime,
           ChallanNo, Remarks,
           Status, CreatedBy, UpdatedBy)
        OUTPUT INSERTED.VehicleInOutID
        VALUES
          (@DocNo, @DocTypeId, @DocDate,
           @CompanyID, @ProjectID, @FinYear,
           @SupplierID, @SupplierName, @POID, @PONumber,
           @VehicleNo, @EntryTime, @ExitTime,
           @ChallanNo, @Remarks,
           @Status, @CreatedBy, @UpdatedBy)
      `);

    recordId = insert.recordset[0].VehicleInOutID;

    // ── 4. Back-patch DocNumberSequence with the real PK ────────────────────
    await backPatchRecordId(pool, sql, finalDocNo, "VehicleInOut", recordId);

    // ── 5. Link any attachments uploaded while filling out the form ─────────
    await linkAttachments(pool, recordId, parseIdList(attachmentIds));

    // ── 6. Persist the validated received-quantity lines ────────────────────
    await saveVehicleInOutItems(pool, recordId, validatedItems);

    await bumpCacheVersion(CACHE_KEY);

    // Auto-submit: transition Draft → Pending immediately so no manual
    // "Submit" step is required after creation (same pattern as Material
    // Requests). Non-fatal — record is saved either way.
    try {
      await transition(
        "vehicle-in-out",
        recordId,
        "Pending",
        req.user?.email || email,
        req.user?.role,
      );
    } catch (submitErr) {
      console.warn(
        "Vehicle In/Out auto-submit failed (non-fatal):",
        submitErr.message,
      );
    }

    res.status(201).json({ vehicleInOutId: recordId, docNo: finalDocNo });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  const {
    docDate,
    companyId,
    projectId,
    finYear,
    supplierId,
    supplierName,
    poId,
    poNumber,
    vehicleNo,
    entryTime,
    exitTime,
    challanNo,
    attachmentIds, // any newly-uploaded (still-unlinked) attachment ids to attach
    remarks,
    items, // [{ poItemId, receivedQty }] — quantity received in this lot
  } = req.body;

  if (!vehicleNo)
    return res.status(400).json({ error: "vehicleNo is required" });

  try {
    const pool = getPool();

    // Validate before writing anything — excludeVehicleInOutId=id so this
    // record's own previously-saved quantities don't count against its
    // own remaining allowance while re-editing it.
    const validatedItems = await validateVehicleInOutItems(pool, poId, items, id);

    await pool
      .request()
      .input("ID", sql.Int, id)
      .input("DocDate", sql.Date, docDate || new Date())
      .input("CompanyID", sql.Int, companyId || null)
      .input("ProjectID", sql.Int, projectId || null)
      .input("FinYear", sql.NVarChar(20), finYear || null)
      .input("SupplierID", sql.Int, supplierId || null)
      .input("SupplierName", sql.NVarChar(255), supplierName || null)
      .input("POID", sql.Int, poId || null)
      .input("PONumber", sql.NVarChar(100), poNumber || null)
      .input("VehicleNo", sql.NVarChar(50), vehicleNo)
      .input("EntryTime", sql.DateTime, entryTime ? new Date(entryTime) : null)
      .input("ExitTime", sql.DateTime, exitTime ? new Date(exitTime) : null)
      .input("ChallanNo", sql.NVarChar(100), challanNo || null)
      .input("Remarks", sql.NVarChar(1000), remarks || null)
      .input("UpdatedBy", sql.NVarChar(150), email).query(`
        UPDATE dbo.VehicleInOut SET
          DocDate        = @DocDate,
          CompanyID      = @CompanyID,
          ProjectID      = @ProjectID,
          FinYear        = @FinYear,
          SupplierID     = @SupplierID,
          SupplierName   = @SupplierName,
          POID           = @POID,
          PONumber       = @PONumber,
          VehicleNo      = @VehicleNo,
          EntryTime      = @EntryTime,
          ExitTime       = @ExitTime,
          ChallanNo      = @ChallanNo,
          Remarks        = @Remarks,
          UpdatedAt      = GETDATE(),
          UpdatedBy      = @UpdatedBy
        WHERE VehicleInOutID = @ID
      `);

    // Link any newly-uploaded attachments added during this edit.
    await linkAttachments(pool, id, parseIdList(attachmentIds));

    // Persist the validated received-quantity lines (replaces this
    // record's previous item rows).
    await saveVehicleInOutItems(pool, id, validatedItems);

    await bumpCacheVersion(CACHE_KEY);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Draft/Rejected → Pending ────────────────────────────────
// Records are auto-submitted on creation; this is only needed to re-submit
// after a rejection (or as a fallback if auto-submit failed).
router.put("/:id/submit", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await transition(
      "vehicle-in-out",
      id,
      "Pending",
      req.user?.email || email,
      req.user?.role,
    );
    await bumpCacheVersion(CACHE_KEY);
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── PUT /:id/approve ──────────────────────────────────────────────────────────
router.put("/:id/approve", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await transition(
      "vehicle-in-out",
      id,
      "Approved",
      req.user?.email || email,
      req.user?.role,
    );
    await bumpCacheVersion(CACHE_KEY);
    res.json({ message: "Vehicle In/Out approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── PUT /:id/reject ───────────────────────────────────────────────────────────
router.put("/:id/reject", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const { note } = req.body;
    const result = await transition(
      "vehicle-in-out",
      id,
      "Rejected",
      req.user?.email || email,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion(CACHE_KEY);
    res.json({ message: "Vehicle In/Out rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// Attachments cascade-delete automatically via FK_VehicleInOutAttachments_Parent
// (ON DELETE CASCADE) — no manual cleanup needed since everything lives in SQL.
router.delete("/:id", requirePageRight("vehicle-in-out", "delete"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const check = await pool
      .request()
      .input("ID", sql.Int, id)
      .query(
        `SELECT VehicleInOutID, POID FROM dbo.VehicleInOut WHERE VehicleInOutID = @ID`,
      );

    if (!check.recordset[0])
      return res.status(404).json({ error: "Not found" });

    // ── Guard: a GRN already exists against this specific Vehicle In/Out record ──
    const grnCheck = await pool
      .request()
      .input("ID", sql.Int, id)
      .query(
        "SELECT COUNT(*) AS cnt FROM dbo.GoodsReceiptNotes WHERE VehicleInOutID = @ID AND Status <> 'Rejected'",
      );
    if (Number(grnCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_grn",
        message: "A GRN has already been created against this Vehicle In/Out record. Delete the GRN first, then delete this Vehicle In/Out record.",
      });
    }

    await pool
      .request()
      .input("ID", sql.Int, id)
      .query(`DELETE FROM dbo.VehicleInOut WHERE VehicleInOutID = @ID`);

    await bumpCacheVersion(CACHE_KEY);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload — attachment / camera photo (stored in DB, not disk) ────────
// Files are uploaded while the user is still filling out the form, before a
// VehicleInOutID exists — same flow as ticket attachments. Each row starts
// with VehicleInOutID = NULL and gets linked once the parent record is
// actually saved (see linkAttachments() in POST / and PUT /:id above).
router.post("/upload", requirePageRight("vehicle-in-out", "edit"), upload.array("file", 20), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const files = req.files;
  if (!files || files.length === 0)
    return res.status(400).json({ error: "No file uploaded" });

  try {
    const pool = getPool();
    const results = [];

    for (const file of files) {
      const insertResult = await pool
        .request()
        .input("FileName", sql.NVarChar(255), file.originalname)
        .input("MimeType", sql.NVarChar(100), file.mimetype)
        .input("FileSize", sql.Int, file.size)
        .input("FileData", sql.VarBinary(sql.MAX), file.buffer)
        .input("UploadedBy", sql.NVarChar(150), email).query(`
          INSERT INTO dbo.VehicleInOutAttachments
            (VehicleInOutID, FileName, MimeType, FileSize, FileData, UploadedBy)
          OUTPUT INSERTED.AttachmentId
          VALUES
            (NULL, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy)
        `);

      const attachId = insertResult.recordset[0].AttachmentId;
      results.push({
        id: attachId,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: `/api/vehicle-in-out/attachment/${attachId}`,
      });
    }

    res.json({
      success: true,
      attachments: results,
      ids: results.map((r) => r.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /attachment/:attachId — stream binary from DB ─────────────────────────
router.get("/attachment/:attachId", async (req, res) => {
  try {
    const attachId = parseInt(req.params.attachId, 10);
    if (isNaN(attachId))
      return res.status(400).json({ error: "Invalid attachment id" });

    const pool = getPool();
    const result = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query(`
        SELECT AttachmentId, FileName, MimeType, FileData
        FROM dbo.VehicleInOutAttachments
        WHERE AttachmentId = @AttachmentId
      `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "Attachment not found" });

    const attachment = result.recordset[0];
    res.setHeader("Content-Type", attachment.MimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.FileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(attachment.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /attachment/:attachId — remove a single attachment ─────────────────
// Used when the user removes a captured photo / file before saving the form,
// or removes one from an existing record while editing.
router.delete("/attachment/:attachId", requirePageRight("vehicle-in-out", "delete"), async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  try {
    const attachId = parseInt(req.params.attachId, 10);
    if (isNaN(attachId))
      return res.status(400).json({ error: "Invalid attachment id" });

    const pool = getPool();
    const result = await pool
      .request()
      .input("AttachmentId", sql.Int, attachId)
      .query(
        `DELETE FROM dbo.VehicleInOutAttachments WHERE AttachmentId = @AttachmentId`,
      );

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Attachment not found" });

    await bumpCacheVersion(CACHE_KEY);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
