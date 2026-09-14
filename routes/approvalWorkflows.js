const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

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
             modules, LevelsData AS levels,
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
router.post("/", authMiddleware, allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
      .input("LevelsData", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null)
      // Legacy NOT NULL columns that must be populated
      .input("Module", sql.NVarChar(100), modules[0] || "General")
      .input("LevelCount", sql.Int, levels.length)
      .input("Status", sql.NVarChar(20), "Active").query(`
        INSERT INTO dbo.ApprovalWorkflows
          (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt,
           Module, Levels, Status)
        OUTPUT
          INSERTED.Id, INSERTED.Name, INSERTED.type,
          INSERTED.modules, INSERTED.LevelsData,
          INSERTED.active, INSERTED.CreatedAt
        VALUES
          (@Name, @type, @modules, @LevelsData, @active, @CreatedBy, SYSDATETIME(),
           @Module, @LevelCount, @Status)
      `);

    await bumpCacheVersion(CACHE_NS);
    const row = result.recordset[0];
    res.status(201).json({
      id: row.Id,
      name: row.Name,
      type: row.type,
      modules: parseJson(row.modules),
      levels: parseJson(row.LevelsData),
      active: !!row.active,
      createdAt: row.CreatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/approval-workflows/:id
router.put("/:id", authMiddleware, allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
      .input("LevelsData", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null)
      // Keep legacy NOT NULL columns in sync
      .input("Module", sql.NVarChar(100), modules[0] || "General")
      .input("LevelCount", sql.Int, levels.length).query(`
        UPDATE dbo.ApprovalWorkflows SET
          Name       = @Name,
          type       = @type,
          modules    = @modules,
          LevelsData = @LevelsData,
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
router.patch("/:id/toggle", authMiddleware, allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
router.delete("/:id", authMiddleware, allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
    SaleOrders: { workflowId: "SaleOrder" },
    VehicleInOut: { workflowId: "VehicleInOut" },
    Contract: { workflowId: "Contract" },
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
        SELECT TOP 1 Id, Name, type, LevelsData AS LevelsJson, active
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

    // 2. Fetch full audit trail (all rows, Level > 0 only — Level 0 is submission marker)
    const auditResult = await pool
      .request()
      .input("TableName", sql.NVarChar(100), module)
      .input("RecordId", sql.Int, recordId).query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
        FROM dbo.ApprovalAuditLog
        WHERE TableName = @TableName AND RecordId = @RecordId AND Level > 0
        ORDER BY Level ASC, ActionAt ASC
      `);

    // 2b. Level 0 rows separately — submission ('Pending') and rejection
    // ('Rejected') markers. transition() (services/approvalService.js)
    // always writes a rejection at Level 0, never at the level it actually
    // happened, so without these a rejected record's trail would show no
    // rejection at all — every step above would just read "Pending".
    const level0Result = await pool
      .request()
      .input("TableName", sql.NVarChar(100), module)
      .input("RecordId", sql.Int, recordId).query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
        FROM dbo.ApprovalAuditLog
        WHERE TableName = @TableName AND RecordId = @RecordId AND Level = 0
        ORDER BY ActionAt ASC
      `);

    const allAuditRows = auditResult.recordset;
    const workflowType = wfRow?.type || "sequential";

    // For sequential/any: collapse to latest entry per level
    const auditRows =
      workflowType === "parallel"
        ? allAuditRows
        : Object.values(
            allAuditRows.reduce((acc, row) => {
              if (
                !acc[row.Level] ||
                new Date(row.ActionAt) > new Date(acc[row.Level].ActionAt)
              ) {
                acc[row.Level] = row;
              }
              return acc;
            }, {}),
          ).sort((a, b) => a.Level - b.Level);

    // 3. Merge workflow levels with audit entries
    const steps = workflowLevels.map((lvl, idx) => {
      const levelNum = idx + 1;
      const levelRows = auditRows.filter((a) => a.Level === levelNum);

      if (workflowType === "parallel") {
        const approvers = levelRows.map((r) => ({
          email: r.ApproverEmail,
          name: r.ApproverEmail?.split("@")[0] || null,
          role: r.Role,
          status: r.ActionStatus,
          actionAt: r.ActionAt,
        }));
        const allApproved =
          approvers.length > 0 &&
          approvers.every((a) => a.status === "Approved");
        const anyRejected = approvers.some((a) => a.status === "Rejected");
        const latestActor =
          [...approvers]
            .filter((a) => a.status === "Approved" || a.status === "Rejected")
            .sort((a, b) => new Date(b.actionAt) - new Date(a.actionAt))[0] ||
          null;
        return {
          level: levelNum,
          label: lvl.label || `Level ${levelNum}`,
          userIds: lvl.userIds || [],
          status: anyRejected
            ? "Rejected"
            : allApproved
              ? "Approved"
              : "Pending",
          approverEmail: latestActor?.email || null,
          approverName: latestActor?.name || null,
          role: latestActor?.role || null,
          actionAt: latestActor?.actionAt || null,
          note: null,
          approvers,
          workflowType,
        };
      }

      if (workflowType === "any") {
        // First to act wins
        const actor =
          levelRows.find(
            (r) =>
              r.ActionStatus === "Approved" || r.ActionStatus === "Rejected",
          ) ||
          levelRows[0] ||
          null;
        return {
          level: levelNum,
          label: lvl.label || `Level ${levelNum}`,
          userIds: lvl.userIds || [],
          status: actor?.ActionStatus || "Pending",
          approverEmail: actor?.ApproverEmail || null,
          approverName: actor?.ApproverEmail?.split("@")[0] || null,
          role: actor?.Role || null,
          actionAt: actor?.ActionAt || null,
          note: actor?.Note || null,
          workflowType,
        };
      }

      // sequential — latest entry at this level
      const audit = levelRows[levelRows.length - 1] || null;
      return {
        level: levelNum,
        label: lvl.label || `Level ${levelNum}`,
        userIds: lvl.userIds || [],
        status: audit?.ActionStatus || "Pending",
        approverEmail: audit?.ApproverEmail || null,
        approverName: audit?.ApproverEmail?.split("@")[0] || null,
        role: audit?.Role || null,
        actionAt: audit?.ActionAt || null,
        note: audit?.Note || null,
        workflowType,
      };
    });

    // If no workflow configured, surface raw audit rows (Level > 0 only)
    if (workflowLevels.length === 0 && allAuditRows.length > 0) {
      allAuditRows.forEach((a) => {
        steps.push({
          level: a.Level,
          label: `Level ${a.Level}`,
          userIds: [],
          status: a.ActionStatus,
          approverEmail: a.ApproverEmail,
          approverName: a.ApproverEmail?.split("@")[0] || null,
          role: a.Role,
          actionAt: a.ActionAt,
          note: a.Note,
          workflowType,
        });
      });
    }

    // Splice in the Level 0 markers: "Submitted" origin node(s) prepended,
    // "Rejected" terminal node(s) appended — a rejection always ends the
    // flow at whatever level it happened, so it reads naturally as the
    // last entry rather than fighting for a slot among the numbered levels.
    const submittedMarkers = level0Result.recordset
      .filter((r) => r.ActionStatus !== "Rejected")
      .map((r) => ({
        level: 0,
        label: "Submitted",
        userIds: [],
        status: "Submitted",
        approverEmail: r.ApproverEmail,
        approverName: r.ApproverEmail?.split("@")[0] || null,
        role: r.Role,
        actionAt: r.ActionAt,
        note: r.Note,
        workflowType,
        isOrigin: true,
      }));
    const rejectedMarkers = level0Result.recordset
      .filter((r) => r.ActionStatus === "Rejected")
      .map((r) => ({
        level: 0,
        label: "Rejected",
        userIds: [],
        status: "Rejected",
        approverEmail: r.ApproverEmail,
        approverName: r.ApproverEmail?.split("@")[0] || null,
        role: r.Role,
        actionAt: r.ActionAt,
        note: r.Note,
        workflowType,
        isTerminal: true,
      }));

    const fullSteps = [...submittedMarkers, ...steps, ...rejectedMarkers];

    const currentLevel =
      steps.findIndex((s) => s.status !== "Approved") + 1 || steps.length;
    const fullyApproved =
      steps.length > 0 && steps.every((s) => s.status === "Approved");
    const hasRejection = rejectedMarkers.length > 0 || steps.some((s) => s.status === "Rejected");

    res.json({
      workflowName: wfRow?.Name || null,
      workflowType: wfRow?.type || "sequential",
      // Includes the Level 0 Submitted/Rejected markers alongside the
      // numbered workflow levels — existing consumers that only care about
      // the numbered levels (e.g. ApprovalStatusChain's compact badge)
      // already filter to level > 0 client-side, so this is safe to widen.
      steps: fullSteps,
      currentLevel,
      fullyApproved,
      hasRejection,
      totalLevels: steps.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
