const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all — includes CompanyName via enterprise JOIN
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        p.Id,
        p.Code,
        p.Name,
        p.ShortName,
        p.Type,
        p.BusinessUnit,
        p.ClientName,
        p.ClientCode,
        p.TeamSize,
        p.StartDate,
        p.EndDate,
        p.Currency,
        p.Status,
        p.Priority,
        p.Location,
        p.Description,
        p.Remarks,
        p.IsActive,
        p.EnterpriseId,
        e.name AS CompanyName
      FROM dbo.ProjectMaster p
      LEFT JOIN dbo.enterprise e ON p.EnterpriseId = e.id
      WHERE p.IsDeleted = 0
      ORDER BY p.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  const pool = getPool();
  const transaction = pool.transaction();
  try {
    await transaction.begin();

    // 1. Insert into dbo.enterprise and capture EnterpriseId
    const enterpriseResult = await transaction
      .request()
      .input("EntName", sql.NVarChar(255), f.name || null)
      .input("EntCode", sql.NVarChar(50), f.code || null)
      .input("EntShortName", sql.NVarChar(100), f.shortName || null)
      .input("EntType", sql.NVarChar(100), "Project")
      .input("EntBusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("EntCurrency", sql.NVarChar(10), f.currency || "INR")
      .input("EntIsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .query(`
        INSERT INTO dbo.enterprise
          (name, code, short_name, entity_type, business_unit, currency, is_active, created_at)
        VALUES
          (@EntName, @EntCode, @EntShortName, @EntType, @EntBusinessUnit, @EntCurrency, @EntIsActive, GETDATE());
        SELECT SCOPE_IDENTITY() AS EnterpriseId;
      `);

    const enterpriseId = enterpriseResult.recordset[0].EnterpriseId;

    // 2. Insert into dbo.ProjectMaster with EnterpriseId
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
      .query(`
        INSERT INTO dbo.ProjectMaster
          (EnterpriseId,Code,Name,ShortName,Type,BusinessUnit,ClientName,ClientCode,
           TeamSize,StartDate,EndDate,Currency,Status,Priority,Location,
           Description,Remarks,IsActive,IsDeleted,CreatedAt)
        VALUES
          (@EnterpriseId,@Code,@Name,@ShortName,@Type,@BusinessUnit,@ClientName,@ClientCode,
           @TeamSize,@StartDate,@EndDate,@Currency,@Status,@Priority,@Location,
           @Description,@Remarks,@IsActive,0,GETDATE())
      `);

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  const pool = getPool();
  const transaction = pool.transaction();
  try {
    await transaction.begin();

    // 1. Update dbo.ProjectMaster
    await transaction
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
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
      .query(`
        UPDATE dbo.ProjectMaster SET
          Code=@Code,Name=@Name,ShortName=@ShortName,Type=@Type,BusinessUnit=@BusinessUnit,
          ClientName=@ClientName,ClientCode=@ClientCode,TeamSize=@TeamSize,
          StartDate=@StartDate,EndDate=@EndDate,Currency=@Currency,Status=@Status,
          Priority=@Priority,Location=@Location,Description=@Description,Remarks=@Remarks,
          IsActive=@IsActive,UpdatedAt=GETDATE()
        WHERE Id=@Id AND IsDeleted=0
      `);

    // 2. Sync to dbo.enterprise via EnterpriseId
    await transaction
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("EntName", sql.NVarChar(255), f.name || null)
      .input("EntCode", sql.NVarChar(50), f.code || null)
      .input("EntShortName", sql.NVarChar(100), f.shortName || null)
      .input("EntBusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("EntCurrency", sql.NVarChar(10), f.currency || "INR")
      .input("EntIsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .query(`
        UPDATE e SET
          e.name        = @EntName,
          e.code        = @EntCode,
          e.short_name  = @EntShortName,
          e.business_unit = @EntBusinessUnit,
          e.currency    = @EntCurrency,
          e.is_active   = @EntIsActive,
          e.updated_at  = GETDATE()
        FROM dbo.enterprise e
        INNER JOIN dbo.ProjectMaster pm ON pm.EnterpriseId = e.id
        WHERE pm.Id = @Id AND pm.IsDeleted = 0
      `);

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete("/:id", adminOnly, async (req, res) => {
  const pool = getPool();
  const transaction = pool.transaction();
  try {
    await transaction.begin();

    await transaction
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(`
        UPDATE dbo.ProjectMaster SET IsDeleted=1, UpdatedAt=GETDATE() WHERE Id=@Id;

        DELETE e FROM dbo.enterprise e
        INNER JOIN dbo.ProjectMaster pm ON pm.EnterpriseId = e.id
        WHERE pm.Id = @Id;
      `);

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;