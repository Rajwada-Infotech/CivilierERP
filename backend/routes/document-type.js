// backend/routes/document-type.js  (adds /api/document-type/:id/next-number)
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const BYPASS_ROLES = ["admin", "super_admin", "dba", "sa"];
const bypassOrCheck = (module, subModule, action = "CanView") => [
  authMiddleware,
  (req, res, next) => {
    const role = (req.user?.role || "").toLowerCase().replace(/\s+/g, "_");
    if (BYPASS_ROLES.includes(role)) return next();
    return checkPermission(module, subModule, action)(req, res, next);
  },
];

// ── GET / — list all ──────────────────────────────────────────────────────────
router.get(
  "/",
  ...bypassOrCheck("Admin", "DocumentType", "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
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
        ORDER BY et.EntryType, t.Prefix;
      `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch document types" });
    }
  },
);

// ── GET /:id/next-number — generate the next doc number for a type ─────────────
// Called by the DocNumberPreview component in the frontend.
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

    // FullPrefix in the DB may already include the starting number
    // e.g. "PR/REC/000500" — strip trailing digits to get the true prefix "PR/REC/"
    const truePrefix = rawPrefix.replace(/\d+$/, "");

    // Find the current max sequence for this true prefix
    const maxResult = await pool
      .request()
      .input("Prefix", sql.NVarChar(50), truePrefix + "%").query(`
        SELECT MAX(
          TRY_CAST(
            SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT
          )
        ) AS MaxSeq
        FROM dbo.DocNumberSequence
        WHERE DocNo LIKE @Prefix
      `);

    let maxSeq = maxResult.recordset[0]?.MaxSeq ?? null;

    if (maxSeq === null) {
      maxSeq = startFrom - 1;
    }

    const nextSeq = Math.max(maxSeq + 1, startFrom);
    const paddedSeq = String(nextSeq).padStart(6, "0");

    // Final format: PR/REC/000500/2024-25  (or  PR/REC/000500  without finYear)
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
