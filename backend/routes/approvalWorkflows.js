const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");

const CACHE_NS = "approval-workflows";

function parseJson(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// GET /api/approval-workflows[?module=X]
router.get("/", authMiddleware, cache(CACHE_NS, 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, Name AS name, type,
             modules, LevelsJson AS levels,
             active,
             CreatedAt AS createdAt, CreatedBy AS createdBy
      FROM dbo.ApprovalWorkflows
      ORDER BY CreatedAt DESC
    `);

    let rows = result.recordset.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type || "sequential",
      modules: parseJson(r.modules),
      levels: parseJson(r.levels),
      active: !!r.active,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
    }));

    if (req.query.module) {
      rows = rows.filter((r) => r.modules.includes(req.query.module));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approval-workflows
router.post("/", authMiddleware, async (req, res) => {
  const {
    name,
    type = "sequential",
    modules = [],
    levels = [],
    active = true,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!modules.length)
    return res.status(400).json({ error: "At least one module is required" });
  if (!levels.length)
    return res.status(400).json({ error: "At least one level is required" });

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(255), name.trim())
      .input("type", sql.NVarChar(50), type)
      .input("modules", sql.NVarChar(sql.MAX), JSON.stringify(modules))
      .input("LevelsJson", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
      // Legacy NOT NULL columns that must be populated
      .input("Module", sql.NVarChar(100), modules[0] || "General")
      .input("LevelCount", sql.Int, levels.length)
      .input("Status", sql.NVarChar(20), "Active").query(`
        INSERT INTO dbo.ApprovalWorkflows
          (Name, type, modules, LevelsJson, active, CreatedBy, CreatedAt,
           Module, Levels, Status)
        OUTPUT
          INSERTED.Id, INSERTED.Name, INSERTED.type,
          INSERTED.modules, INSERTED.LevelsJson,
          INSERTED.active, INSERTED.CreatedAt
        VALUES
          (@Name, @type, @modules, @LevelsJson, @active, @CreatedBy, SYSDATETIME(),
           @Module, @LevelCount, @Status)
      `);

    await bumpCacheVersion(CACHE_NS);
    const row = result.recordset[0];
    res.status(201).json({
      id: row.Id,
      name: row.Name,
      type: row.type,
      modules: parseJson(row.modules),
      levels: parseJson(row.LevelsJson),
      active: !!row.active,
      createdAt: row.CreatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/approval-workflows/:id
router.put("/:id", authMiddleware, async (req, res) => {
  const {
    name,
    type = "sequential",
    modules = [],
    levels = [],
    active,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .input("Name", sql.NVarChar(255), name?.trim() || null)
      .input("type", sql.NVarChar(50), type)
      .input("modules", sql.NVarChar(sql.MAX), JSON.stringify(modules))
      .input("LevelsJson", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
      // Keep legacy NOT NULL columns in sync
      .input("Module", sql.NVarChar(100), modules[0] || "General")
      .input("LevelCount", sql.Int, levels.length).query(`
        UPDATE dbo.ApprovalWorkflows SET
          Name       = @Name,
          type       = @type,
          modules    = @modules,
          LevelsJson = @LevelsJson,
          active     = @active,
          UpdatedBy  = @UpdatedBy,
          UpdatedAt  = SYSDATETIME(),
          Module     = @Module,
          Levels     = @LevelCount
        WHERE Id = @Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/approval-workflows/:id/toggle
router.patch("/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null).query(`
        UPDATE dbo.ApprovalWorkflows SET
          active    = CASE WHEN active = 1 THEN 0 ELSE 1 END,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/approval-workflows/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .query("DELETE FROM dbo.ApprovalWorkflows WHERE Id = @Id");

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// GET /api/approval-workflows/trail?module=GoodsReceiptNotes&id=123
// Returns the active workflow levels + audit log for a specific record.
// Only returns the LATEST entry per level (handles resubmissions).
router.get("/trail", authMiddleware, async (req, res) => {
  const { module, id } = req.query;
  if (!module || !id) {
    return res.status(400).json({ error: "module and id are required" });
  }

  // Map frontend module slug → { tableName, workflowModuleId }
  // tableName matches what approvalService writes to ApprovalAuditLog
  // workflowModuleId matches what ApprovalWorkflows.modules JSON array contains
  const MODULE_TABLE_MAP = {
    GoodsReceiptNotes: { workflowId: "GRN" },
    PurchaseOrders: { workflowId: "PurchaseOrders" },
    WorkOrderHeader: { workflowId: "WorkOrderHeader" },
    ExpenseBooking: { workflowId: "Expenses" },
    NewPayment: { workflowId: "NewPayment" },
    MaterialIssues: { workflowId: "MaterialIssues" },
    MaterialRequests: { workflowId: "MaterialRequests" },
    StockTransfers: { workflowId: "StockTransfer" },
    BOQ: { workflowId: "BOQ" },
    WorkDone: { workflowId: "WorkDone" },
  };

  const entry = MODULE_TABLE_MAP[module];
  if (!entry) {
    return res.status(400).json({ error: `Unknown module table: ${module}` });
  }

  try {
    const pool = getPool();
    const recordId = parseInt(id, 10);

    // 1. Fetch workflow config (levels + type)
    const wfResult = await pool
      .request()
      .input("WorkflowId", sql.NVarChar(100), entry.workflowId).query(`
        SELECT TOP 1 Id, Name, type, LevelsJson, active
        FROM dbo.ApprovalWorkflows
        WHERE active = 1
          AND modules LIKE '%' + @WorkflowId + '%'
        ORDER BY CreatedAt DESC
      `);

    const wfRow = wfResult.recordset[0];
    let workflowLevels = [];
    if (wfRow?.LevelsJson) {
      try {
        workflowLevels = JSON.parse(wfRow.LevelsJson);
      } catch {}
    }

    // 2. Fetch audit trail for this record (latest entry per level)
    const auditResult = await pool
      .request()
      .input("TableName", sql.NVarChar(100), module)
      .input("RecordId", sql.Int, recordId).query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
        FROM (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY Level ORDER BY ActionAt DESC) AS rn
          FROM dbo.ApprovalAuditLog
          WHERE TableName = @TableName AND RecordId = @RecordId
        ) t
        WHERE rn = 1
        ORDER BY Level ASC
      `);

    const auditRows = auditResult.recordset;

    // 3. Merge workflow levels with audit entries
    const steps = workflowLevels.map((lvl, idx) => {
      const levelNum = idx + 1;
      const audit = auditRows.find((a) => a.Level === levelNum);
      return {
        level: levelNum,
        label: lvl.label || `Level ${levelNum}`,
        userIds: lvl.userIds || [],
        status: audit?.ActionStatus || "Pending",
        approverEmail: audit?.ApproverEmail || null,
        role: audit?.Role || null,
        actionAt: audit?.ActionAt || null,
        note: audit?.Note || null,
      };
    });

    // If no workflow configured, still return any audit rows.
    // Level 0 is a submission marker written by approvalService — NOT an approver
    // step. Filter it out so it never appears as a "Level 0 · Pending" pill.
    if (workflowLevels.length === 0 && auditRows.length > 0) {
      auditRows
        .filter((a) => a.Level > 0)
        .forEach((a) => {
          steps.push({
            level: a.Level,
            label: `Level ${a.Level}`,
            userIds: [],
            status: a.ActionStatus,
            approverEmail: a.ApproverEmail,
            role: a.Role,
            actionAt: a.ActionAt,
            note: a.Note,
          });
        });
    }

    const currentLevel =
      steps.findIndex((s) => s.status !== "Approved") + 1 || steps.length;
    const fullyApproved =
      steps.length > 0 && steps.every((s) => s.status === "Approved");
    const hasRejection = steps.some((s) => s.status === "Rejected");

    res.json({
      workflowName: wfRow?.Name || null,
      workflowType: wfRow?.type || "sequential",
      steps,
      currentLevel,
      fullyApproved,
      hasRejection,
      totalLevels: steps.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
