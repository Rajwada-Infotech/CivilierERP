// backend/routes/document-type.js  (adds /api/document-type/:id/next-number)
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { previewNextDocNumber } = require("../utils/docNumberLock");

const BYPASS_ROLES = ["admin", "super_admin", "dba", "sa"];
const bypassOrCheck = (module, subModule, action = "CanView") => [
  authMiddleware,
  (req, res, next) => {
    const role = (req.user?.role || "").toLowerCase().replace(/\s+/g, "_");
    if (BYPASS_ROLES.includes(role)) return next();
    return checkPermission(module, subModule, action)(req, res, next);
  },
];

// ── Module → EntryType keyword map ───────────────────────────────────────────
// Maps ?module= query param to SQL LIKE patterns applied to et.EntryType
const MODULE_KEYWORDS = {
  PO: ["purchase order", "purchase"],
  WO: ["work order"],
  GRN: ["goods receipt", "grn", "goods received"],
  BOQ: ["boq", "bill of quantities", "bill of quantity", "quantity"],
};

// ── GET / — list all (or filtered by ?module=PO|WO|GRN) ──────────────────────
router.get(
  "/",
  ...bypassOrCheck("Admin", "DocumentType", "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const module = (req.query.module || "").toString().toUpperCase().trim();
      const keywords = MODULE_KEYWORDS[module];

      // Build WHERE clause: if a module is specified, filter by EntryType name
      let entryTypeWhere = "";
      const request = pool.request();
      if (keywords && keywords.length > 0) {
        const conditions = keywords.map((kw, i) => {
          request.input(`kw${i}`, sql.NVarChar(100), `%${kw}%`);
          return `et.EntryType LIKE @kw${i}`;
        });
        entryTypeWhere = `AND (${conditions.join(" OR ")})`;
      }

      const result = await request.query(`
        SELECT
          t.TypeOfDocId,
          t.Prefix,
          t.Description,
          t.CompanyId,
          t.ProjectId,
          t.EntryTypeId,
          t.IsActive,
          t.StartingDocNo,
          et.EntryType,
          et.Eprefix,
          et.EDOC_N,
          ISNULL(c.name, 'All Companies') AS CompanyName,
          ISNULL(p.name, 'All Projects')  AS ProjectName,
          t.FullPrefix,
          t.CreatedAt,
          t.UpdatedAt
        FROM dbo.TypeOfDoc t
        LEFT JOIN dbo.Entry_Type    et ON t.EntryTypeId = et.E_Id
        LEFT JOIN dbo.enterprise c  ON t.CompanyId = c.id AND c.business_type = 'C'
        LEFT JOIN dbo.enterprise p  ON t.ProjectId = p.id AND p.business_type = 'P'
        WHERE t.IsActive = 1
        ${entryTypeWhere}
        ORDER BY et.EntryType, t.Prefix;
      `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch document types" });
    }
  },
);

// ── GET /:id/next-number — preview the next doc number (read-only, no lock) ───
// Called by the DocNumberPreview component and DocSelectorPanel in the frontend.
// Updates in real-time when finYear changes.
// Query params:
//   finYear  — e.g. "2024-25"  appended as suffix: PREFIX/000500/2024-25
router.get("/:id/next-number", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid document type id" });

  // Fin year from query string (e.g. "2024-25")
  const finYear = (req.query.finYear || "").toString().trim();

  try {
    const pool = getPool();
    const preview = await previewNextDocNumber(pool, sql, id, finYear);
    return res.json({
      ...preview,
      finYear: finYear || null,
    });

    // Fetch the doc type config
    const typeResult = await pool.request().input("TypeOfDocId", sql.Int, id)
      .query(`
        SELECT t.Prefix, t.FullPrefix, t.StartingDocNo,
               et.EDOC_N
        FROM dbo.TypeOfDoc t
        LEFT JOIN dbo.Entry_Type et ON t.EntryTypeId = et.E_Id
        WHERE t.TypeOfDocId = @TypeOfDocId AND t.IsActive = 1
      `);

    const typeRow = typeResult.recordset[0];
    if (!typeRow)
      return res.status(404).json({ error: "Document type not found" });

    const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
    const startFrom = typeRow.StartingDocNo ?? 1;

    // Strip trailing digits so "CI/OTH/000001" → "CI/OTH/"
    const truePrefix = rawPrefix.replace(/\d+$/, "");

    // ── Strategy: max sequence number across ALL fin years (global counter) ──
    // The fin year is only a cosmetic suffix — the counter never resets per year.
    // This matches exactly what lockNextDocNumber does when it issues numbers.

    // Max already locked in DocNumberSequence (all fin years, same prefix).
    // DocNo has a global unique constraint, so do not filter by TypeOfDocId here.
    const maxDNSResult = await pool
      .request()
      .input("Prefix", sql.NVarChar(100), truePrefix)
      .input("PrefixLike", sql.NVarChar(100), truePrefix + "%").query(`
        SELECT MAX(
          TRY_CAST(
            SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT
          )
        ) AS MaxSeq
        FROM dbo.DocNumberSequence
        WHERE DocNo LIKE @PrefixLike
      `);

    // Max already committed in ExpenseBooking (all fin years, same prefix)
    const maxEBResult = await pool
      .request()
      .input("EDocTypeId", sql.Int, id)
      .input("Prefix2", sql.NVarChar(100), truePrefix)
      .input("PrefixLike2", sql.NVarChar(100), truePrefix + "%").query(`
        SELECT MAX(
          TRY_CAST(
            SUBSTRING(EDocNo, LEN(@Prefix2) + 1, 6) AS INT
          )
        ) AS MaxSeq
        FROM dbo.ExpenseBooking
        WHERE EDocTypeId = @EDocTypeId
          AND EDocNo LIKE @PrefixLike2
      `);

    const seqFromDNS = maxDNSResult.recordset[0]?.MaxSeq ?? null;
    const seqFromEB = maxEBResult.recordset[0]?.MaxSeq ?? null;
    const globalMax = Math.max(seqFromDNS ?? 0, seqFromEB ?? 0);

    const nextSeq = Math.max(globalMax + 1, startFrom);
    const paddedSeq = String(nextSeq).padStart(6, "0");

    // Final format: CI/OTH/000002/2025-26  (or  CI/OTH/000002  without finYear)
    const nextDocNo = finYear
      ? `${truePrefix}${paddedSeq}/${finYear}`
      : `${truePrefix}${paddedSeq}`;

    res.json({
      nextDocNo,
      prefix: truePrefix,
      nextSeq,
      finYear: finYear || null,
    });
  } catch (err) {
    console.error("next-number error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /entrytypes ───────────────────────────────────────────────────────────
router.get("/entrytypes", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT E_Id AS EntryTypeId, EntryType, Eprefix, EDOC_N
      FROM dbo.Entry_Type ORDER BY EntryType;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch entry types" });
  }
});

// ── GET /companies ────────────────────────────────────────────────────────────
// Sources from enterprise table where business_type = 'C'
router.get("/companies", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS CompanyId, name AS CompanyName
      FROM dbo.enterprise
      WHERE business_type = 'C'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// ── GET /projects ─────────────────────────────────────────────────────────────
// Sources from enterprise table where business_type = 'P'
router.get("/projects", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS ProjectId, name AS ProjectName, NULL AS ProjectCode
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post(
  "/",
  ...bypassOrCheck("Admin", "DocumentType", "CanAdd"),
  async (req, res) => {
    const {
      Prefix,
      Description,
      CompanyId,
      ProjectId,
      EntryTypeId,
      StartingDocNo,
    } = req.body;
    if (!Prefix || !Description || !EntryTypeId)
      return res
        .status(400)
        .json({ error: "Prefix, Description and EntryTypeId are required" });

    try {
      const pool = getPool();
      await pool
        .request()
        .input("Prefix", sql.NVarChar(30), Prefix.toUpperCase().trim())
        .input("Description", sql.NVarChar(255), Description.trim())
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("EntryTypeId", sql.UniqueIdentifier, EntryTypeId)
        .input(
          "StartingDocNo",
          sql.Int,
          StartingDocNo ? parseInt(StartingDocNo) : 1,
        )
        .input("CreatedBy", sql.NVarChar(100), req.user?.email || "system")
        .query(`
          INSERT INTO dbo.TypeOfDoc
            (Prefix, Description, CompanyId, ProjectId, EntryTypeId, StartingDocNo, CreatedBy)
          VALUES
            (@Prefix, @Description, @CompanyId, @ProjectId, @EntryTypeId, @StartingDocNo, @CreatedBy);
        `);
      res.status(201).json({ message: "Document type created successfully" });
    } catch (err) {
      res
        .status(500)
        .json({ error: err.message || "Failed to create document type" });
    }
  },
);

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put(
  "/:id",
  ...bypassOrCheck("Admin", "DocumentType", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const {
      Prefix,
      Description,
      CompanyId,
      ProjectId,
      EntryTypeId,
      IsActive,
      StartingDocNo,
    } = req.body;
    try {
      const pool = getPool();
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("Prefix", sql.NVarChar(30), Prefix.toUpperCase().trim())
        .input("Description", sql.NVarChar(255), Description.trim())
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("EntryTypeId", sql.UniqueIdentifier, EntryTypeId)
        .input("IsActive", sql.Bit, IsActive !== undefined ? IsActive : true)
        .input(
          "StartingDocNo",
          sql.Int,
          StartingDocNo ? parseInt(StartingDocNo) : 1,
        )
        .input("UpdatedBy", sql.NVarChar(100), req.user?.email || "system")
        .query(`
          UPDATE dbo.TypeOfDoc SET
            Prefix        = @Prefix,
            Description   = @Description,
            CompanyId     = @CompanyId,
            ProjectId     = @ProjectId,
            EntryTypeId   = @EntryTypeId,
            IsActive      = @IsActive,
            StartingDocNo = @StartingDocNo,
            UpdatedBy     = @UpdatedBy,
            UpdatedAt     = SYSDATETIME()
          WHERE TypeOfDocId = @id;
        `);
      res.json({ message: "Document type updated successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to update document type" });
    }
  },
);

// ── DELETE /:id — soft delete ─────────────────────────────────────────────────
router.delete(
  "/:id",
  ...bypassOrCheck("Admin", "DocumentType", "CanDelete"),
  async (req, res) => {
    try {
      const pool = getPool();
      await pool
        .request()
        .input("id", sql.Int, req.params.id)
        .input("UpdatedBy", sql.NVarChar(100), req.user?.email || "system")
        .query(`
          UPDATE dbo.TypeOfDoc SET
            IsActive  = 0,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
          WHERE TypeOfDocId = @id;
        `);
      res.json({ message: "Document type deactivated successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to deactivate document type" });
    }
  },
);

module.exports = router;
