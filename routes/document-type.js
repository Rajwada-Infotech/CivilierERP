// backend/routes/document-type.js
"use strict";

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { checkPermission } = require("../middleware/permissions");
const { previewNextDocNumber } = require("../utils/docNumberLock");
const { cache, localVersionCache } = require("../middleware/cache");

// ── Auth helpers ──────────────────────────────────────────────────────────────

const BYPASS_ROLES = ["admin", "super_admin", "dba", "sa"];

// NOTE: authMiddleware is intentionally NOT included here.
// It is already applied globally via app.use("/api", authMiddleware) in server.js.
// Adding it here again was causing double auth stages in request timing logs
// (two auth.redis_blacklist + auth.jwt_verify blocks per request on this router).
const bypassOrCheck = (module, subModule, action = "CanView") => [
  (req, res, next) => {
    const role = (req.user?.role || "").toLowerCase().replace(/\s+/g, "_");
    if (BYPASS_ROLES.includes(role)) return next();
    return checkPermission(module, subModule, action)(req, res, next);
  },
];

// ── Module → links_to filter map ─────────────────────────────────────────────
//
// Maps the ?module= query param to LIKE patterns matched against
// TypeOfDoc.links_to (the canonical source of truth after migration 046).
//
// Each value in the array produces an OR clause:
//   t.links_to LIKE '%Work Order%' OR t.links_to LIKE '%Work Order PO%'
//
// Keep values consistent with the LINK_OPTIONS labels in TypeOfDocMaster.tsx.
//
const MODULE_LINKS = {
  WO: ["Work Order"],
  WO_PO: ["Work Order PO"],
  PO: ["Purchase Order"],
  GRN: ["GRN"],
  BOQ: ["BOQ"],
  EB: ["Expense Booking"],
  MIS: ["Material Issue"],
  PAY: ["Payment"],
  RECP: ["Received Payment"],
  DN: ["Debit Note"],
  WD: ["Work Done"],
  MR: ["Material Request"],
  ISS: ["Material Issue"], // further filtered below to exclude ExB-ISS prefixes
  SI: ["Sale Invoice"],
  QT: ["Quotation"],
  CON: ["Contract"],
  TASK: ["Task"],
};

// ── GET / — list all doc types, optionally filtered by ?module= ───────────────
router.get(
  "/",
  ...bypassOrCheck("Admin", "DocumentType", "CanView"),
  cache("document-type", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const module = (req.query.module || "").toString().toUpperCase().trim();
      const tags = MODULE_LINKS[module]; // array of link labels, or undefined

      const request = pool.request();
      let linksWhere = "";

      if (tags && tags.length > 0) {
        // Filter: links_to must contain at least one of the tag strings
        const conditions = tags.map((tag, i) => {
          request.input(`tag${i}`, sql.NVarChar(100), `%${tag}%`);
          return `t.links_to LIKE @tag${i}`;
        });
        linksWhere = `AND (${conditions.join(" OR ")})`;

        // ISS (plain Material Issue) must NOT include Expense Booking doc types.
        // ExB-ISS doc types also have links_to containing "Material Issue" so we
        // explicitly exclude any doc type whose prefix starts with "ExB-".
        if (module === "ISS") {
          linksWhere += ` AND COALESCE(t.DocNoPrefix, t.FullPrefix, t.Prefix) NOT LIKE 'ExB-%'`;
        }
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
          t.FullPrefix,
          t.links_to,
          t.DocNoPrefix,
          t.ModuleCode,
          t.ProjectCode,
          t.FinYearReset,
          t.CreatedAt,
          t.UpdatedAt,
          et.EntryType,
          et.Eprefix,
          et.EDOC_N,
          ISNULL(c.name,  'All Companies') AS CompanyName,
          ISNULL(p.name,  'All Projects')  AS ProjectName,
          ISNULL(p.short_name, '')         AS ProjectShortName
        FROM dbo.TypeOfDoc t
        LEFT JOIN dbo.Entry_Type et ON t.EntryTypeId  = et.E_Id
        LEFT JOIN dbo.enterprise c  ON t.CompanyId    = c.id AND c.business_type = 'C'
        LEFT JOIN dbo.enterprise p  ON t.ProjectId    = p.id AND p.business_type = 'P'
        WHERE t.IsActive = 1
        ${linksWhere}
        ORDER BY et.EntryType, t.Prefix;
      `);

      res.json(result.recordset);
    } catch (err) {
      console.error("GET /document-type error:", err.message);
      res.status(500).json({ error: "Failed to fetch document types" });
    }
  },
);

// ── GET /:id/next-number — preview next doc number (read-only, no lock) ───────
//
// Query params:
//   finYear — financial year string, e.g. "26-27"
//             Required for Tier 1 (new-project) and Tier 3 (legacy) rows.
//             Auto-derived from today for Tier 1 when omitted.
//
router.get("/:id/next-number", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid document type id" });

  const finYear = (req.query.finYear || "").toString().trim() || null;

  try {
    const pool = getPool();
    const preview = await previewNextDocNumber(pool, sql, id, finYear);
    return res.json(preview);
  } catch (err) {
    console.error("next-number error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /entrytypes ───────────────────────────────────────────────────────────
router.get("/entrytypes", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT E_Id AS EntryTypeId, EntryType, Eprefix, EDOC_N
      FROM dbo.Entry_Type
      ORDER BY EntryType;
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /entrytypes error:", err.message);
    res.status(500).json({ error: "Failed to fetch entry types" });
  }
});

// ── GET /companies ────────────────────────────────────────────────────────────
router.get("/companies", async (req, res) => {
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
    console.error("GET /companies error:", err.message);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get("/projects", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        id         AS ProjectId,
        name       AS ProjectName,
        short_name AS ProjectCode,
        company_id AS CompanyId
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name;
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /projects error:", err.message);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── POST / — create a new TypeOfDoc record ────────────────────────────────────
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
      links_to,
      ModuleCode,
      DocNoPrefix,
      FinYearReset,
    } = req.body;

    if (!Prefix || !Description || !EntryTypeId)
      return res
        .status(400)
        .json({ error: "Prefix, Description and EntryTypeId are required" });

    try {
      const pool = getPool();

      // If a ProjectId is supplied, resolve the project's short_name so it
      // can be snapshot-stored as ProjectCode on the TypeOfDoc row.
      let resolvedProjectCode = null;
      if (ProjectId) {
        const pcRes = await pool
          .request()
          .input("ProjectId", sql.Int, ProjectId).query(`
            SELECT short_name FROM dbo.enterprise
            WHERE id = @ProjectId AND business_type = 'P'
          `);
        resolvedProjectCode = pcRes.recordset[0]?.short_name ?? null;
      }

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
        .input("links_to", sql.NVarChar(500), links_to || null)
        .input("ModuleCode", sql.NVarChar(20), ModuleCode || null)
        .input("DocNoPrefix", sql.NVarChar(50), DocNoPrefix || null)
        .input("ProjectCode", sql.NVarChar(20), resolvedProjectCode)
        .input("FinYearReset", sql.Bit, FinYearReset !== false ? 1 : 0).query(`
          INSERT INTO dbo.TypeOfDoc
            (Prefix, Description, CompanyId, ProjectId, EntryTypeId,
             StartingDocNo, CreatedBy, links_to,
             ModuleCode, DocNoPrefix, ProjectCode, FinYearReset)
          VALUES
            (@Prefix, @Description, @CompanyId, @ProjectId, @EntryTypeId,
             @StartingDocNo, @CreatedBy, @links_to,
             @ModuleCode, @DocNoPrefix, @ProjectCode, @FinYearReset);
        `);

      localVersionCache.invalidate("document-type");
      res.status(201).json({ message: "Document type created successfully" });
    } catch (err) {
      console.error("POST /document-type error:", err.message);
      res
        .status(500)
        .json({ error: err.message || "Failed to create document type" });
    }
  },
);

// ── PUT /:id — update an existing TypeOfDoc record ───────────────────────────
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
      links_to,
      ModuleCode,
      DocNoPrefix,
      FinYearReset,
    } = req.body;

    try {
      const pool = getPool();

      // Re-resolve ProjectCode whenever ProjectId changes
      let resolvedProjectCode = null;
      if (ProjectId) {
        const pcRes = await pool
          .request()
          .input("ProjectId", sql.Int, ProjectId).query(`
            SELECT short_name FROM dbo.enterprise
            WHERE id = @ProjectId AND business_type = 'P'
          `);
        resolvedProjectCode = pcRes.recordset[0]?.short_name ?? null;
      }

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
        .input("links_to", sql.NVarChar(500), links_to || null)
        .input("ModuleCode", sql.NVarChar(20), ModuleCode || null)
        .input("DocNoPrefix", sql.NVarChar(50), DocNoPrefix || null)
        .input("ProjectCode", sql.NVarChar(20), resolvedProjectCode)
        .input("FinYearReset", sql.Bit, FinYearReset !== false ? 1 : 0).query(`
          UPDATE dbo.TypeOfDoc SET
            Prefix        = @Prefix,
            Description   = @Description,
            CompanyId     = @CompanyId,
            ProjectId     = @ProjectId,
            EntryTypeId   = @EntryTypeId,
            IsActive      = @IsActive,
            StartingDocNo = @StartingDocNo,
            links_to      = @links_to,
            ModuleCode    = @ModuleCode,
            DocNoPrefix   = @DocNoPrefix,
            ProjectCode   = @ProjectCode,
            FinYearReset  = @FinYearReset,
            UpdatedBy     = @UpdatedBy,
            UpdatedAt     = SYSDATETIME()
          WHERE TypeOfDocId = @id;
        `);

      localVersionCache.invalidate("document-type");
      res.json({ message: "Document type updated successfully" });
    } catch (err) {
      console.error("PUT /document-type error:", err.message);
      res
        .status(500)
        .json({ error: err.message || "Failed to update document type" });
    }
  },
);

// ── DELETE /:id — soft delete (sets IsActive = 0) ─────────────────────────────
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
      localVersionCache.invalidate("document-type");
      res.json({ message: "Document type deactivated successfully" });
    } catch (err) {
      console.error("DELETE /document-type error:", err.message);
      res.status(500).json({ error: "Failed to deactivate document type" });
    }
  },
);

module.exports = router;
