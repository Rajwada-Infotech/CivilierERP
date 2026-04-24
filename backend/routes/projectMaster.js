const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.ProjectMaster WHERE IsDeleted=0 ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("BusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("ClientName", sql.NVarChar(200), f.clientName || null)
      .input("ClientCode", sql.NVarChar(50), f.clientCode || null)
      .input("ProjectManager", sql.NVarChar(200), f.projectManager || null)
      .input("TeamSize", sql.Int, parseInt(f.teamSize) || null)
      .input("StartDate", sql.Date, f.startDate || null)
      .input("EndDate", sql.Date, f.endDate || null)
      .input("EstimatedCost", sql.Decimal(18, 2), f.estimatedCost || null)
      .input("ApprovedBudget", sql.Decimal(18, 2), f.approvedBudget || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("BillingType", sql.NVarChar(100), f.billingType || null)
      .input("ContractValue", sql.Decimal(18, 2), f.contractValue || null)
      .input("Status", sql.NVarChar(50), f.status || "Planning")
      .input("Priority", sql.NVarChar(50), f.priority || "Medium")
      .input("Location", sql.NVarChar(255), f.location || null)
      .input("Description", sql.NVarChar(sql.MAX), f.description || null)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("CostCenter", sql.NVarChar(100), f.costCenter || null)
      .input("ProfitCenter", sql.NVarChar(100), f.profitCenter || null)
      .input("WBSCode", sql.NVarChar(100), f.wbsCode || null)
      .input("PercentComplete", sql.Decimal(5, 2), f.percentComplete || 0)
      .query(`
        INSERT INTO dbo.ProjectMaster
          (Code,Name,ShortName,Type,BusinessUnit,ClientName,ClientCode,ProjectManager,
           TeamSize,StartDate,EndDate,EstimatedCost,ApprovedBudget,Currency,BillingType,
           ContractValue,Status,Priority,Location,Description,Remarks,IsActive,
           CostCenter,ProfitCenter,WBSCode,PercentComplete,IsDeleted,CreatedAt)
        VALUES
          (@Code,@Name,@ShortName,@Type,@BusinessUnit,@ClientName,@ClientCode,@ProjectManager,
           @TeamSize,@StartDate,@EndDate,@EstimatedCost,@ApprovedBudget,@Currency,@BillingType,
           @ContractValue,@Status,@Priority,@Location,@Description,@Remarks,@IsActive,
           @CostCenter,@ProfitCenter,@WBSCode,@PercentComplete,0,GETDATE())
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("Code", sql.NVarChar(50), f.code || null)
      .input("Name", sql.NVarChar(255), f.name || null)
      .input("ShortName", sql.NVarChar(100), f.shortName || null)
      .input("Type", sql.NVarChar(100), f.type || null)
      .input("BusinessUnit", sql.NVarChar(200), f.businessUnit || null)
      .input("ClientName", sql.NVarChar(200), f.clientName || null)
      .input("ClientCode", sql.NVarChar(50), f.clientCode || null)
      .input("ProjectManager", sql.NVarChar(200), f.projectManager || null)
      .input("TeamSize", sql.Int, parseInt(f.teamSize) || null)
      .input("StartDate", sql.Date, f.startDate || null)
      .input("EndDate", sql.Date, f.endDate || null)
      .input("EstimatedCost", sql.Decimal(18, 2), f.estimatedCost || null)
      .input("ApprovedBudget", sql.Decimal(18, 2), f.approvedBudget || null)
      .input("Currency", sql.NVarChar(10), f.currency || "INR")
      .input("BillingType", sql.NVarChar(100), f.billingType || null)
      .input("ContractValue", sql.Decimal(18, 2), f.contractValue || null)
      .input("Status", sql.NVarChar(50), f.status || "Planning")
      .input("Priority", sql.NVarChar(50), f.priority || "Medium")
      .input("Location", sql.NVarChar(255), f.location || null)
      .input("Description", sql.NVarChar(sql.MAX), f.description || null)
      .input("Remarks", sql.NVarChar(500), f.remarks || null)
      .input("IsActive", sql.Bit, f.isActive !== false ? 1 : 0)
      .input("CostCenter", sql.NVarChar(100), f.costCenter || null)
      .input("ProfitCenter", sql.NVarChar(100), f.profitCenter || null)
      .input("WBSCode", sql.NVarChar(100), f.wbsCode || null)
      .input("PercentComplete", sql.Decimal(5, 2), f.percentComplete || 0)
      .query(`
        UPDATE dbo.ProjectMaster SET
          Code=@Code,Name=@Name,ShortName=@ShortName,Type=@Type,BusinessUnit=@BusinessUnit,
          ClientName=@ClientName,ClientCode=@ClientCode,ProjectManager=@ProjectManager,
          TeamSize=@TeamSize,StartDate=@StartDate,EndDate=@EndDate,
          EstimatedCost=@EstimatedCost,ApprovedBudget=@ApprovedBudget,Currency=@Currency,
          BillingType=@BillingType,ContractValue=@ContractValue,Status=@Status,
          Priority=@Priority,Location=@Location,Description=@Description,Remarks=@Remarks,
          IsActive=@IsActive,CostCenter=@CostCenter,ProfitCenter=@ProfitCenter,
          WBSCode=@WBSCode,PercentComplete=@PercentComplete,UpdatedAt=GETDATE()
        WHERE Id=@Id AND IsDeleted=0
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(
        "UPDATE dbo.ProjectMaster SET IsDeleted=1, UpdatedAt=GETDATE() WHERE Id=@Id",
      );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
