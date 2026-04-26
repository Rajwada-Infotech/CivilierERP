// backend/routes/document-type.js
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

// ── Bypass permission check for admin / super_admin / dba ────────────────────
const BYPASS_ROLES = ["admin", "super_admin", "dba", "sa"];
const bypassOrCheck = (module, subModule, action = "CanView") => [
  authMiddleware,
  (req, res, next) => {
    const role = (req.user?.role || "").toLowerCase().replace(/\s+/g, "_");
    if (BYPASS_ROLES.includes(role)) return next();
    return checkPermission(module, subModule, action)(req, res, next);
  },
];

// GET /api/document-type — list all
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
          ISNULL(c.Name, 'All Companies') AS CompanyName,
          ISNULL(p.Name, 'All Projects')  AS ProjectName,
          t.FullPrefix,
          t.CreatedAt,
          t.UpdatedAt
        FROM dbo.TypeOfDoc t
        LEFT JOIN dbo.Entry_Type    et ON t.EntryTypeId = et.E_Id
        LEFT JOIN dbo.CompanyMaster c  ON t.CompanyId   = c.Id
        LEFT JOIN dbo.ProjectMaster p  ON t.ProjectId   = p.Id
        WHERE t.IsActive = 1
        ORDER BY et.EntryType, t.Prefix;
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching document types:", err);
      res.status(500).json({ error: "Failed to fetch document types" });
    }
  },
);

// GET /api/document-type/entrytypes
router.get("/entrytypes", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT E_Id AS EntryTypeId, EntryType, Eprefix, EDOC_N
      FROM dbo.Entry_Type
      ORDER BY EntryType;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch entry types" });
  }
});

// GET /api/document-type/companies
router.get("/companies", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS CompanyId, Name AS CompanyName
      FROM dbo.CompanyMaster WHERE IsDeleted = 0 ORDER BY Name;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// GET /api/document-type/projects — includes Code for prefix preview
router.get("/projects", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS ProjectId, Name AS ProjectName, Code AS ProjectCode
      FROM dbo.ProjectMaster WHERE IsActive = 1 ORDER BY Name;
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/document-type
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
      console.error(err);
      res
        .status(500)
        .json({ error: err.message || "Failed to create document type" });
    }
  },
);

// PUT /api/document-type/:id
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
      console.error(err);
      res.status(500).json({ error: "Failed to update document type" });
    }
  },
);

// DELETE /api/document-type/:id — soft delete
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
