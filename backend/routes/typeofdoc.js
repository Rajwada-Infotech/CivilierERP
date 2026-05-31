// backend/routes/typeofdoc.js
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

// GET /api/typeofdoc - List all document types
router.get(
  "/",
  authMiddleware,
  checkPermission("Admin", "DocumentType", "CanView"),
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
        et.EntryType,
        et.Eprefix,
        et.EDOC_N,
        ISNULL(c.CompanyName, 'All Companies') AS CompanyName,
        ISNULL(p.ProjectName, 'All Projects') AS ProjectName,
        t.CreatedAt,
        t.UpdatedAt
      FROM dbo.TypeOfDoc t
      LEFT JOIN dbo.Entry_Type et ON t.EntryTypeId = et.E_Id
      WHERE t.IsActive = 1
      ORDER BY et.EntryType, t.Prefix;
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("Error fetching TypeOfDoc:", err);
      res.status(500).json({ error: "Failed to fetch document types" });
    }
  },
);

// GET /api/typeofdoc/entrytypes - Get Entry_Type for dropdown
router.get("/entrytypes", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        E_Id AS EntryTypeId,
        EntryType,
        Eprefix,
        EDOC_N
      FROM dbo.Entry_Type
      ORDER BY EntryType;
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching Entry_Type:", err);
    res.status(500).json({ error: "Failed to fetch entry types" });
  }
});

// POST /api/typeofdoc - Create new document type
router.post(
  "/",
  authMiddleware,
  checkPermission("Admin", "DocumentType", "CanAdd"),
  async (req, res) => {
    const { Prefix, Description, CompanyId, ProjectId, EntryTypeId } = req.body;

    if (!Prefix || !Description || !EntryTypeId) {
      return res
        .status(400)
        .json({ error: "Prefix, Description and EntryTypeId are required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("Prefix", sql.NVarChar(20), Prefix.toUpperCase().trim())
        .input("Description", sql.NVarChar(255), Description.trim())
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("EntryTypeId", sql.UniqueIdentifier, EntryTypeId)
        .input(
          "CreatedBy",
          sql.NVarChar(100),
          req.user?.email || req.user?.name || "system",
        ).query(`
        INSERT INTO dbo.TypeOfDoc (Prefix, Description, CompanyId, ProjectId, EntryTypeId, CreatedBy)
        VALUES (@Prefix, @Description, @CompanyId, @ProjectId, @EntryTypeId, @CreatedBy);
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

// PUT /api/typeofdoc/:id - Update
router.put(
  "/:id",
  authMiddleware,
  checkPermission("Admin", "DocumentType", "CanEdit"),
  async (req, res) => {
    const { id } = req.params;
    const { Prefix, Description, CompanyId, ProjectId, EntryTypeId, IsActive } =
      req.body;

    try {
      const pool = getPool();
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("Prefix", sql.NVarChar(20), Prefix.toUpperCase().trim())
        .input("Description", sql.NVarChar(255), Description.trim())
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("EntryTypeId", sql.UniqueIdentifier, EntryTypeId)
        .input("IsActive", sql.Bit, IsActive !== undefined ? IsActive : true)
        .input("UpdatedBy", sql.NVarChar(100), req.user?.email || "system")
        .query(`
        UPDATE dbo.TypeOfDoc
        SET Prefix = @Prefix,
            Description = @Description,
            CompanyId = @CompanyId,
            ProjectId = @ProjectId,
            EntryTypeId = @EntryTypeId,
            IsActive = @IsActive,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
        WHERE TypeOfDocId = @id;
      `);
      res.json({ message: "Document type updated successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update document type" });
    }
  },
);

// DELETE /api/typeofdoc/:id - Soft delete (deactivate)
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("Admin", "DocumentType", "CanDelete"),
  async (req, res) => {
    try {
      const pool = getPool();
      await pool
        .request()
        .input("id", sql.Int, req.params.id)
        .query(
          `
        UPDATE dbo.TypeOfDoc
        SET IsActive = 0,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
        WHERE TypeOfDocId = @id
      `,
          {
            UpdatedBy: req.user?.email || "system",
          },
        );
      res.json({ message: "Document type deactivated successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to deactivate document type" });
    }
  },
);

module.exports = router;


