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
 * Routes
 *   GET    /                 — paginated list
 *   GET    /next-number      — preview next VEH-YYYY-NNNNN
 *   GET    /:id              — single record
 *   POST   /                 — create
 *   PUT    /:id              — update
 *   DELETE /:id              — delete
 *   POST   /upload           — multer attachment upload
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const { getPool, sql } = require("../db");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const {
  resolveDocTypeId,
  lockNextDocNumber,
  backPatchRecordId,
  previewNextDocNumber,
} = require("../utils/docNumberLock");

const router = express.Router();

// ── Rate-limit ────────────────────────────────────────────────────────────────
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));

// ── Permission guard ─────────────────────────────────────────────────────────
router.use(checkPermissionForMethod("Material", "VehicleInOut"));

// ── Multer (attachment / camera photo) ───────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../uploads/vehicle-in-out");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "-");
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|heic/i;
    cb(null, allowed.test(path.extname(file.originalname)));
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

// ── GET /next-number ─────────────────────────────────────────────────────────
router.get("/next-number", async (req, res) => {
  try {
    const pool = await getPool();
    const docTypeId = await resolveDocTypeId(pool, sql, "VEH");
    const preview = await previewNextDocNumber(pool, sql, docTypeId);
    res.json({ nextDocNo: preview.nextDocNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — paginated list ────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
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
        v.AttachmentPath,
        v.Remarks,
        v.Status,
        v.CreatedAt,
        -- Joined names
        ec.Name   AS CompanyName,
        ep.Name   AS ProjectName
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
    const pool = await getPool();
    const result = await pool
      .request()
      .input("ID", sql.Int, parseInt(req.params.id, 10)).query(`
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
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
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
    attachmentPath,
    remarks,
  } = req.body;

  if (!vehicleNo)
    return res.status(400).json({ error: "vehicleNo is required" });

  const pool = await getPool();
  let recordId = null;

  try {
    // ── 1. Resolve doc type ──────────────────────────────────────────────────
    const docTypeId = await resolveDocTypeId(pool, sql, "VEH");

    // ── 2. Lock next doc number ──────────────────────────────────────────────
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      finYear: finYear || null,
      projectId: projectId || null,
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
      .input("AttachmentPath", sql.NVarChar(500), attachmentPath || null)
      .input("Remarks", sql.NVarChar(1000), remarks || null)
      .input("Status", sql.NVarChar(30), "Draft")
      .input("CreatedBy", sql.NVarChar(150), email)
      .input("UpdatedBy", sql.NVarChar(150), email).query(`
        INSERT INTO dbo.VehicleInOut
          (DocNo, DocTypeId, DocDate,
           CompanyID, ProjectID, FinYear,
           SupplierID, SupplierName, POID, PONumber,
           VehicleNo, EntryTime, ExitTime,
           ChallanNo, AttachmentPath, Remarks,
           Status, CreatedBy, UpdatedBy)
        OUTPUT INSERTED.VehicleInOutID
        VALUES
          (@DocNo, @DocTypeId, @DocDate,
           @CompanyID, @ProjectID, @FinYear,
           @SupplierID, @SupplierName, @POID, @PONumber,
           @VehicleNo, @EntryTime, @ExitTime,
           @ChallanNo, @AttachmentPath, @Remarks,
           @Status, @CreatedBy, @UpdatedBy)
      `);

    recordId = insert.recordset[0].VehicleInOutID;

    // ── 4. Back-patch DocNumberSequence with the real PK ────────────────────
    await backPatchRecordId(pool, sql, docTypeId, finalDocNo, recordId);

    await bumpCacheVersion(CACHE_KEY);

    res.status(201).json({ vehicleInOutId: recordId, docNo: finalDocNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
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
    attachmentPath,
    remarks,
  } = req.body;

  if (!vehicleNo)
    return res.status(400).json({ error: "vehicleNo is required" });

  try {
    const pool = await getPool();
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
      .input("AttachmentPath", sql.NVarChar(500), attachmentPath || null)
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
          AttachmentPath = @AttachmentPath,
          Remarks        = @Remarks,
          UpdatedAt      = GETDATE(),
          UpdatedBy      = @UpdatedBy
        WHERE VehicleInOutID = @ID
      `);

    await bumpCacheVersion(CACHE_KEY);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const email = userEmail(req, res);
  if (!email) return;

  const id = parseInt(req.params.id, 10);
  try {
    const pool = await getPool();
    const check = await pool
      .request()
      .input("ID", sql.Int, id)
      .query(
        `SELECT AttachmentPath FROM dbo.VehicleInOut WHERE VehicleInOutID = @ID`,
      );

    if (!check.recordset[0])
      return res.status(404).json({ error: "Not found" });

    // Clean up uploaded file if present
    const attachPath = check.recordset[0].AttachmentPath;
    if (attachPath) {
      const full = path.join(
        __dirname,
        "../uploads",
        attachPath.replace(/^\/uploads\//, ""),
      );
      if (fs.existsSync(full)) fs.unlinkSync(full);
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

// ── POST /upload — attachment / camera photo ──────────────────────────────────
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  // Return a relative URL the frontend can store and serve via /uploads/...
  res.json({
    path: `/uploads/vehicle-in-out/${req.file.filename}`,
    originalName: req.file.originalname,
    size: req.file.size,
  });
});

module.exports = router;
