const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");

const CACHE_NS = "approval-workflows";

// GET all workflows — cached 60s
router.get("/", authMiddleware, cache(CACHE_NS, 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, Name AS name, Module AS module, Levels AS levels,
             Approvers AS approvers, Status AS status, Description AS description,
             CreatedAt AS createdAt, CreatedBy AS createdBy
      FROM dbo.ApprovalWorkflows
      ORDER BY CreatedAt DESC
    `);
    const data = result.recordset.map((w) => ({
      ...w,
      approvers: w.approvers ? w.approvers.split(",").map((s) => s.trim()) : [],
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — create workflow
router.post("/", authMiddleware, async (req, res) => {
  const { name, module, levels, approvers, status, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!module?.trim())
    return res.status(400).json({ error: "Module is required" });

  try {
    const pool = getPool();
    const approversStr = Array.isArray(approvers)
      ? approvers.join(",")
      : approvers || "";

    await pool
      .request()
      .input("Name", sql.NVarChar(100), name.trim())
      .input("Module", sql.NVarChar(100), module.trim())
      .input("Levels", sql.Int, levels || 1)
      .input("Approvers", sql.NVarChar(500), approversStr || null)
      .input("Status", sql.NVarChar(20), status || "Active")
      .input("Description", sql.NVarChar(500), description || null)
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.ApprovalWorkflows
          (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt)
        VALUES
          (@Name, @Module, @Levels, @Approvers, @Status, @Description, @CreatedBy, @CreatedAt)
      `);

    await bumpCacheVersion(CACHE_NS);
    res.status(201).json({ message: "Workflow created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — update workflow
router.put("/:id", authMiddleware, async (req, res) => {
  const { name, module, levels, approvers, status, description } = req.body;
  try {
    const pool = getPool();
    const approversStr = Array.isArray(approvers)
      ? approvers.join(",")
      : approvers || "";

    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .input("Name", sql.NVarChar(100), name?.trim() || null)
      .input("Module", sql.NVarChar(100), module?.trim() || null)
      .input("Levels", sql.Int, levels || 1)
      .input("Approvers", sql.NVarChar(500), approversStr || null)
      .input("Status", sql.NVarChar(20), status || "Active")
      .input("Description", sql.NVarChar(500), description || null)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.ApprovalWorkflows SET
          Name=@Name, Module=@Module, Levels=@Levels, Approvers=@Approvers,
          Status=@Status, Description=@Description,
          UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE Id=@Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ message: "Workflow updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id/toggle
router.patch("/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null).query(`
        UPDATE dbo.ApprovalWorkflows SET
          Status    = CASE WHEN Status = 'Active' THEN 'Inactive' ELSE 'Active' END,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ message: "Status toggled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.ApprovalWorkflows WHERE Id=@Id");

    await bumpCacheVersion(CACHE_NS);
    res.json({ message: "Workflow deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

