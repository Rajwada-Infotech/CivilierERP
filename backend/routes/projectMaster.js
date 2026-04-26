const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all projects
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.ProjectMaster
      WHERE IsDeleted = 0
      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST - Create new project with Base64 image
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    const enterpriseId = parseInt(f.enterpriseId || f.businessUnit);
    if (!enterpriseId) {
      throw new Error("Enterprise is required");
    }

    await transaction
      .request()
      .input("EnterpriseId", sql.Int, enterpriseId)
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("BusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("ClientName", sql.NVarChar(200), f.clientName || null)
      .input("ClientCode", sql.NVarChar(50), f.clientCode || null)
      .input("TeamSize", sql.Int, parseInt(f.teamSize) || null)
      .input("StartDate", sql.Date, f.startDate || null)
      .input("EndDate", sql.Date, f.endDate || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("Status", sql.NVarChar(50), f.status || "Planning")
      .input("Priority", sql.NVarChar(50), f.priority || "Medium")
      .input("Location", sql.NVarChar(255), f.location || null)
      .input("Description", sql.NVarChar(sql.MAX), f.description || null)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("ProjectImage", sql.NVarChar(sql.MAX), f.projectImage || null) // Base64 URI
      .query(`
        INSERT INTO dbo.ProjectMaster
          (EnterpriseId, Code, Name, ShortName, Type, BusinessUnit, ClientName, ClientCode,
           TeamSize, StartDate, EndDate, Currency, Status, Priority, Location,
           Description, Remarks, IsActive, ProjectImage, IsDeleted, CreatedAt)
        VALUES
          (@EnterpriseId, @Code, @Name, @ShortName, @Type, @BusinessUnit, @ClientName, @ClientCode,
           @TeamSize, @StartDate, @EndDate, @Currency, @Status, @Priority, @Location,
           @Description, @Remarks, @IsActive, @ProjectImage, 0, GETDATE())
      `);

    await transaction.commit();
    res.json({ success: true, message: "Project created successfully" });
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT - Update project with optional new Base64 image
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    const enterpriseId = parseInt(f.enterpriseId || f.businessUnit);

    await transaction
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("EnterpriseId", sql.Int, enterpriseId)
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("BusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("ClientName", sql.NVarChar(200), f.clientName || null)
      .input("ClientCode", sql.NVarChar(50), f.clientCode || null)
      .input("TeamSize", sql.Int, parseInt(f.teamSize) || null)
      .input("StartDate", sql.Date, f.startDate || null)
      .input("EndDate", sql.Date, f.endDate || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("Status", sql.NVarChar(50), f.status || "Planning")
      .input("Priority", sql.NVarChar(50), f.priority || "Medium")
      .input("Location", sql.NVarChar(255), f.location || null)
      .input("Description", sql.NVarChar(sql.MAX), f.description || null)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("ProjectImage", sql.NVarChar(sql.MAX), f.projectImage || null)
      .query(`
        UPDATE dbo.ProjectMaster SET
          EnterpriseId = @EnterpriseId,
          Code = @Code,
          Name = @Name,
          ShortName = @ShortName,
          Type = @Type,
          BusinessUnit = @BusinessUnit,
          ClientName = @ClientName,
          ClientCode = @ClientCode,
          TeamSize = @TeamSize,
          StartDate = @StartDate,
          EndDate = @EndDate,
          Currency = @Currency,
          Status = @Status,
          Priority = @Priority,
          Location = @Location,
          Description = @Description,
          Remarks = @Remarks,
          IsActive = @IsActive,
          ProjectImage = COALESCE(@ProjectImage, ProjectImage),   -- Keep old image if null
          UpdatedAt = GETDATE()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    await transaction.commit();
    res.json({ success: true, message: "Project updated successfully" });
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete("/:id", adminOnly, async (req, res) => {
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    await transaction.request().input("Id", sql.Int, parseInt(req.params.id))
      .query(`
        UPDATE dbo.ProjectMaster
        SET IsDeleted = 1, UpdatedAt = GETDATE()
        WHERE Id = @Id;
      `);

    await transaction.commit();
    res.json({ success: true, message: "Project deleted successfully" });
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
