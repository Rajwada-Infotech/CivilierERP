const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "DocumentVault";

// ── Upload dir ────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../uploads/vault");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed"));
  },
});

router.use(authMiddleware);
router.use(checkPermissionForMethod(PERMISSION_MODULE, PERMISSION_SUBMODULE));

// ── Helpers ───────────────────────────────────────────────────────────────────
function requireUserName(req, res) {
  const u = req.user?.name || req.user?.email || null;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return u;
}
function parseId(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizeText(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

const CATEGORY_OPTIONS = [
  "Identity Proof",
  "Address Proof",
  "Income Proof",
  "Property Document",
  "Agreement",
  "NOC",
  "Bank Document",
  "Legal Document",
  "Possession Document",
  "Other",
];

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    const pool = getPool();
    const [appRes] = await Promise.all([
      pool.request().query(`
        SELECT
          fa.Id,
          fa.ApplicantNo,
          fa.ApplicantName
        FROM dbo.FollowupApplications fa
        WHERE fa.IsDeleted = 0
        ORDER BY fa.ApplicantName
      `),
    ]);
    res.json({
      categories: CATEGORY_OPTIONS,
      applicants: appRes.recordset,
    });
  } catch (err) {
    console.error("DocumentVault options error:", err.message);
    res.status(500).json({ error: "Failed to load options" });
  }
});

// ── GET / — list docs, optionally filtered by applicant ───────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.pageSize, 10) || 20),
    );
    const offset = (page - 1) * pageSize;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const applicantId = parseId(req.query.applicantId);

    const pool = getPool();
    const request = pool.request();
    const filters = ["d.IsDeleted = 0"];

    if (search) {
      filters.push(
        `(d.DocName LIKE @search OR d.DocNo LIKE @search OR fa.ApplicantName LIKE @search)`,
      );
      request.input("search", sql.NVarChar(255), `%${search}%`);
    }
    if (category) {
      filters.push("d.Category = @category");
      request.input("category", sql.NVarChar(100), category);
    }
    if (applicantId) {
      filters.push("d.ApplicantId = @applicantId");
      request.input("applicantId", sql.Int, applicantId);
    }

    const where = filters.join(" AND ");

    const dataResult = await request.query(`
      SELECT
        d.Id, d.DocNo, d.ApplicantId,
        fa.ApplicantName,
        fa.ApplicantNo AS ApplicantCode,
        d.Category, d.DocName, d.FileName, d.FilePath,
        d.FileSize, d.MimeType, d.Notes, d.Tags,
        d.CreatedBy, d.CreatedAt, d.UpdatedBy, d.UpdatedAt
      FROM dbo.FollowupDocumentVault d
      LEFT JOIN dbo.FollowupApplications fa ON fa.Id = d.ApplicantId
      WHERE ${where}
      ORDER BY d.CreatedAt DESC, d.Id DESC
      OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
    `);

    const countReq = pool.request();
    if (search)      countReq.input("search",      sql.NVarChar(255), `%${search}%`);
    if (category)    countReq.input("category",    sql.NVarChar(100), category);
    if (applicantId) countReq.input("applicantId", sql.Int,           applicantId);
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM dbo.FollowupDocumentVault d
      LEFT JOIN dbo.FollowupApplications fa ON fa.Id = d.ApplicantId
      WHERE ${where}
    `);

    const total = countResult.recordset[0].total;
    res.json({
      data: dataResult.recordset,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("DocumentVault GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// ── POST /upload — upload a file ──────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { ApplicantId, Category, DocName, Notes, Tags } = req.body || {};
  if (!ApplicantId)
    return res.status(400).json({ error: "ApplicantId is required" });

  try {
    const pool = getPool();

    // BUG-09 fix: DocNo is derived from SCOPE_IDENTITY() inside the same SQL
    // batch — concurrent uploads never race on COUNT(*)+1 and collide.
    const result = await pool
      .request()
      .input("ApplicantId", sql.Int, parseInt(ApplicantId, 10))
      .input("Category", sql.NVarChar(100), normalizeText(Category) || "Other")
      .input(
        "DocName",
        sql.NVarChar(255),
        normalizeText(DocName) || req.file.originalname,
      )
      .input("FileName", sql.NVarChar(255), req.file.filename)
      .input("FilePath", sql.NVarChar(500), req.file.path)
      .input("FileSize", sql.BigInt, req.file.size)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(Notes))
      .input("Tags", sql.NVarChar(500), normalizeText(Tags))
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupDocumentVault
          (DocNo, ApplicantId, Category, DocName, FileName, FilePath,
           FileSize, MimeType, Notes, Tags, CreatedBy)
        VALUES
          ('DV000000', @ApplicantId, @Category, @DocName, @FileName, @FilePath,
           @FileSize, @MimeType, @Notes, @Tags, @CreatedBy);
        DECLARE @NewId INT = CAST(SCOPE_IDENTITY() AS INT);
        DECLARE @DocNo NVARCHAR(50) = N'DV' + RIGHT('000000' + CAST(@NewId AS NVARCHAR(6)), 6);
        UPDATE dbo.FollowupDocumentVault SET DocNo = @DocNo WHERE Id = @NewId;
        SELECT @NewId AS Id, @DocNo AS DocNo;
      `);

    const { Id: newId, DocNo: docNo } = result.recordset[0];
    res.status(201).json({ id: newId, docNo });
  } catch (err) {
    // Clean up uploaded file on DB error — path comes from multer (trusted),
    // but guard anyway for consistency
    if (req.file?.path) {
      const resolvedPath = path.resolve(req.file.path);
      if (resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
        fs.unlink(resolvedPath, () => {});
      }
    }
    console.error("DocumentVault POST error:", err.message);
    res.status(500).json({ error: "Failed to save document" });
  }
});

// ── GET /file/:id — download/view a file ──────────────────────────────────────
router.get("/file/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(
        `SELECT FileName, FilePath, MimeType, DocName FROM dbo.FollowupDocumentVault WHERE Id = @Id AND IsDeleted = 0`,
      );

    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const doc = result.recordset[0];

    // ── Path-traversal guard ──────────────────────────────────────────────────
    // Resolve the stored path and confirm it lives inside UPLOAD_DIR.
    // This prevents an attacker (or corrupted DB value) from reading arbitrary
    // files on the server (e.g. ../../etc/passwd).
    const resolvedPath = path.resolve(doc.FilePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(resolvedPath))
      return res.status(404).json({ error: "File not found on disk" });

    res.setHeader("Content-Type", doc.MimeType);
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    console.error("DocumentVault file GET error:", err.message);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// ── PUT /:id — update metadata ────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const { Category, DocName, Notes, Tags } = req.body || {};

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("Category", sql.NVarChar(100), normalizeText(Category))
      .input("DocName", sql.NVarChar(255), normalizeText(DocName))
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(Notes))
      .input("Tags", sql.NVarChar(500), normalizeText(Tags))
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupDocumentVault SET
          Category  = ISNULL(@Category,  Category),
          DocName   = ISNULL(@DocName,   DocName),
          Notes     = @Notes,
          Tags      = @Tags,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("DocumentVault PUT error:", err.message);
    res.status(500).json({ error: "Failed to update document" });
  }
});

// ── DELETE /:id — soft delete + physical file removal ────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const pool = getPool();

    // Fetch path before soft-delete for cleanup
    const fileRes = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(
        `SELECT FilePath FROM dbo.FollowupDocumentVault WHERE Id = @Id AND IsDeleted = 0`,
      );

    if (!fileRes.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupDocumentVault
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });

    // Best-effort physical cleanup — guard against path traversal
    const filePath = fileRes.recordset[0].FilePath;
    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      if (
        resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) &&
        fs.existsSync(resolvedPath)
      ) {
        fs.unlink(resolvedPath, () => {});
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DocumentVault DELETE error:", err.message);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;