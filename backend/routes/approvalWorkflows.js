const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { MODULE_MAP: DOC_MODULE_MAP } = require("../services/approvalService");

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

// May the signed-in user approve/reject this record now? Approval Setup
// decides (approvalService.canUserAct — the same check transition() makes);
// the Approve / Reject buttons ask here instead of keeping role lists.
router.get("/can-act", authMiddleware, async (req, res) => {
  const module = String(req.query.module || "").trim();
  if (!module) return res.status(400).json({ error: "module is required" });
  try {
    const { canUserAct } = require("../services/approvalService");
    const userId = Number(req.user?.userId ?? req.user?.id) || null;
    const canAct = await canUserAct(module, req.query.recordId, req.user?.role, userId);
    res.json({ canAct });
  } catch (err) {
    console.error("[approval-workflows] can-act error:", err.message);
    res.status(500).json({ error: "Couldn't check approval rights" });
  }
});

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

// Map frontend module slug → { tableName, workflowModuleId }
// tableName matches what approvalService writes to ApprovalAuditLog
// workflowModuleId matches what ApprovalWorkflows.modules JSON array contains
const MODULE_TABLE_MAP = {
  GoodsReceiptNotes: { workflowId: "GRN", tableName: "GoodsReceiptNotes" },
  PurchaseOrders: { workflowId: "PurchaseOrders", tableName: "PurchaseOrders" },
  WorkOrderHeader: { workflowId: "WorkOrderHeader", tableName: "WorkOrderHeader" },
  ExpenseBooking: { workflowId: "Expenses", tableName: "ExpenseBooking" },
  NewPayment: { workflowId: "NewPayment", tableName: "NewPayment" },
  MaterialIssues: { workflowId: "MaterialIssues", tableName: "MaterialIssues" },
  MaterialIssueReturn: { workflowId: "MaterialIssueReturn", tableName: "MaterialIssueReturn" },
  MaterialRequests: { workflowId: "MaterialRequests", tableName: "MaterialRequests" },
  StockTransfers: { workflowId: "StockTransfer", tableName: "StockTransfers" },
  BOQ: { workflowId: "BOQ", tableName: "BOQ" },
  WorkDone: { workflowId: "WorkDone", tableName: "WorkDone" },
  SaleOrders: { workflowId: "SaleOrder", tableName: "SaleOrders" },
  VehicleInOut: { workflowId: "VehicleInOut", tableName: "VehicleInOut" },
  Contract: { workflowId: "Contract", tableName: "Contract" },
  JournalVoucher: { workflowId: "JournalVoucher", tableName: "JournalVoucher" },
  InterCompanyTransfer: { workflowId: "InterCompanyTransfer", tableName: "InterCompanyTransfer" },
  FundTransfer: { workflowId: "FundTransfer", tableName: "FundTransfer" },
  DebitNote: { workflowId: "debit-note", tableName: "DebitNote" },
  CrmApplication: { workflowId: "crm-applications", tableName: "CrmApplication" },
  CrmBooking: { workflowId: "crm-bookings", tableName: "CrmBooking" },
  CrmAgreement: { workflowId: "crm-agreements", tableName: "CrmAgreement" },
  CrmBrokerageMaster: { workflowId: "crm-brokerage", tableName: "CrmBrokerageMaster" },
  CrmCancellation: { workflowId: "crm-cancellations", tableName: "CrmCancellation" },
  CrmRefund: { workflowId: "crm-refunds", tableName: "CrmRefund" },
  CrmUnitResale: { workflowId: "crm-resales", tableName: "CrmUnitResale" },
  CrmOwnershipChange: { workflowId: "crm-ownership-changes", tableName: "CrmOwnershipChange" },
  CrmGstNote: { workflowId: "crm-credit-notes", tableName: "CrmGstNote" },
  CrmTransferDeed: { workflowId: "crm-transfer-deeds", tableName: "CrmTransferDeed" },
  CrmNoc: { workflowId: "crm-noc", tableName: "CrmNoc" },
  CrmSalesDeed: { workflowId: "crm-sales-deed-senior", tableName: "CrmSalesDeed" },

  // Slugs as aliases
  grn: { workflowId: "GRN", tableName: "GoodsReceiptNotes" },
  "goods-receipt": { workflowId: "GRN", tableName: "GoodsReceiptNotes" },
  "purchase-orders": { workflowId: "PurchaseOrders", tableName: "PurchaseOrders" },
  "work-orders": { workflowId: "WorkOrderHeader", tableName: "WorkOrderHeader" },
  "expense-booking": { workflowId: "Expenses", tableName: "ExpenseBooking" },
  payments: { workflowId: "NewPayment", tableName: "NewPayment" },
  "material-issues": { workflowId: "MaterialIssues", tableName: "MaterialIssues" },
  "material-issue-return": { workflowId: "MaterialIssueReturn", tableName: "MaterialIssueReturn" },
  "material-requests": { workflowId: "MaterialRequests", tableName: "MaterialRequests" },
  "stock-transfers": { workflowId: "StockTransfer", tableName: "StockTransfers" },
  boq: { workflowId: "BOQ", tableName: "BOQ" },
  "work-done": { workflowId: "WorkDone", tableName: "WorkDone" },
  "sale-orders": { workflowId: "SaleOrder", tableName: "SaleOrders" },
  "vehicle-in-out": { workflowId: "VehicleInOut", tableName: "VehicleInOut" },
  contracts: { workflowId: "Contract", tableName: "Contract" },
  "journal-voucher": { workflowId: "JournalVoucher", tableName: "JournalVoucher" },
  "inter-company-transfer": { workflowId: "InterCompanyTransfer", tableName: "InterCompanyTransfer" },
  "fund-transfer": { workflowId: "FundTransfer", tableName: "FundTransfer" },
  "debit-note": { workflowId: "debit-note", tableName: "DebitNote" },
  "crm-applications": { workflowId: "crm-applications", tableName: "CrmApplication" },
  "crm-bookings": { workflowId: "crm-bookings", tableName: "CrmBooking" },
  "crm-agreements": { workflowId: "crm-agreements", tableName: "CrmAgreement" },
  "crm-agreement-date": { workflowId: "crm-agreement-date", tableName: "CrmAgreement" },
  "crm-brokerage": { workflowId: "crm-brokerage", tableName: "CrmBrokerageMaster" },
  "crm-cancellations": { workflowId: "crm-cancellations", tableName: "CrmCancellation" },
  "crm-refunds": { workflowId: "crm-refunds", tableName: "CrmRefund" },
  "crm-resales": { workflowId: "crm-resales", tableName: "CrmUnitResale" },
  "crm-ownership-changes": { workflowId: "crm-ownership-changes", tableName: "CrmOwnershipChange" },
  "crm-credit-notes": { workflowId: "crm-credit-notes", tableName: "CrmGstNote" },
  "crm-credit-note-cancel": { workflowId: "crm-credit-note-cancel", tableName: "CrmGstNote" },
  "crm-transfer-deeds": { workflowId: "crm-transfer-deeds", tableName: "CrmTransferDeed" },
  "crm-transfer-deed-date": { workflowId: "crm-transfer-deed-date", tableName: "CrmTransferDeed" },
  "crm-noc": { workflowId: "crm-noc", tableName: "CrmNoc" },
  "crm-sales-deed-director": { workflowId: "crm-sales-deed-director", tableName: "CrmSalesDeed" },
  "crm-sales-deed-senior": { workflowId: "crm-sales-deed-senior", tableName: "CrmSalesDeed" },
};

// Builds one record's trail payload — shared by the single-record GET
// /trail and the bulk GET /trail/bulk below, which a list page (dozens of
// rows, each previously firing its own GET /trail on every render) uses to
// fetch every visible row's trail in ONE request instead of one-per-row.
// That N+1 pattern was tripping the per-user API rate limit outright on
// pages like Material Request (~36 rows => 36 concurrent requests, replayed
// on every refetch) — ApprovalStatusChain's fallback prop masked it as a
// plain "Pending"/"Approved" badge instead of an error, which is why it
// looked like the richer badge was silently "reverting" on its own.
// Statuses a record only reaches AFTER it was fully approved: a PO becomes
// "Received" once its GRNs cover the PO total, and a Material Request becomes
// "Partially Fulfilled"/"Completed" as POs and transfers draw it down. The
// trail must keep showing these as approved — matching only "Approved" left
// them on "Final Level · Pending" whenever the final level had no audit row.
// Scoped per module: "Completed" means something else on other documents.
const POST_APPROVAL_STATUSES = {
  PurchaseOrders: ["Received"],
  MaterialRequests: ["Partially Fulfilled", "Completed"],
  WorkOrderHeader: ["In Progress", "Completed"],
  CrmBooking: ["Confirmed"],
  CrmAgreement: ["Executed", "Registered"],
  CrmApplication: ["Converted"],
};
function isApprovedOutcome(module, status) {
  const s = String(status ?? "");
  return s === "Approved" || (POST_APPROVAL_STATUSES[module] || []).includes(s);
}

async function buildApprovalTrail(pool, module, recordId) {
  const entry = MODULE_TABLE_MAP[module];
  if (!entry) return { error: `Unknown module table: ${module}` };

  const tableName = entry.tableName || module;

  // A CRM Refund's payout voucher is a NewPayment row routed through its
  // own single-level "CrmRefundPayment" workflow (see approvalService.js),
  // not the multi-module "NewPayment" bundle every other Payment shares —
  // this endpoint only receives the table name, not which workflow
  // actually governed the approve/reject click, so it has to look the
  // row up itself to show the chain that's actually in effect.
  let workflowId = entry.workflowId;
  if (tableName === "NewPayment") {
    const srcCheck = await pool.request().input("id", sql.Int, recordId)
      .query("SELECT SourceCrmRefundId FROM dbo.NewPayment WHERE PPaymentID = @id");
    if (srcCheck.recordset[0]?.SourceCrmRefundId) workflowId = "CrmRefundPayment";
  }

    // 1. Fetch workflow config (levels + type)
    const wfResult = await pool
      .request()
      .input("WorkflowId", sql.NVarChar(100), workflowId).query(`
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
      .input("TableName", sql.NVarChar(100), tableName)
      .input("RecordId", sql.Int, recordId).query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
        FROM dbo.ApprovalAuditLog
        WHERE TableName = @TableName AND RecordId = @RecordId AND Level > 0
        ORDER BY Level ASC, ActionAt ASC
      `);

    // 2b. Level 0 rows separately — submission ('Pending') markers, plus
    // rejection markers from records rejected before transition() was
    // fixed to log the real level it happened at (see approvalService.js
    // resolveCurrentLevel/writeAuditLog). New rejections land at their real
    // level and are picked up by the numbered-level merge above; this
    // Level 0 fallback only still matters for that older historical data.
    const level0Result = await pool
      .request()
      .input("TableName", sql.NVarChar(100), tableName)
      .input("RecordId", sql.Int, recordId).query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
        FROM dbo.ApprovalAuditLog
        WHERE TableName = @TableName AND RecordId = @RecordId AND Level = 0
        ORDER BY ActionAt ASC
      `);

    const allAuditRows = auditResult.recordset;
    const workflowType = wfRow?.type || "sequential";
    // Kept raw (not collapsed to one row per level) — a level whose own
    // `mode` is "all" can have several distinct approvers, and the per-level
    // branch below (not a global workflow-wide type) decides how to
    // summarize each level's rows.
    const auditRows = allAuditRows;

    // 3. Merge workflow levels with audit entries. Each level's own `mode`
    // ("all" = everyone assigned must approve, anything else = the first
    // approval settles it) drives how its rows are summarized — this is a
    // per-step setting (ApprovalLevel.mode), not the old workflow-wide type.
    const steps = workflowLevels.map((lvl, idx) => {
      const levelNum = idx + 1;
      const levelRows = auditRows.filter((a) => a.Level === levelNum);

      if (lvl.mode === "all") {
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
          mode: "all",
          status: anyRejected
            ? "Rejected"
            : allApproved
              ? "Approved"
              : "Pending",
          approverEmail: latestActor?.email || null,
          approverName: latestActor?.name || null,
          role: latestActor?.role || null,
          actionAt: latestActor?.actionAt || null,
          note: latestActor?.status === "Rejected" ? (levelRows.find((r) => r.ActionStatus === "Rejected")?.Note ?? null) : null,
          approvers,
          workflowType,
        };
      }

      // Default ("any"/unset) — a level completes on its first approval, so
      // there is ever at most one meaningful row here.
      const audit = levelRows[levelRows.length - 1] || null;
      return {
        level: levelNum,
        label: lvl.label || `Level ${levelNum}`,
        userIds: lvl.userIds || [],
        mode: "any",
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

    // The record's own Status column is the actual source of truth for a
    // terminal outcome — the walk above only re-derives "fully approved" by
    // matching audit history against the workflow's CURRENT level list. If a
    // level is added to an already-active workflow after a record was fully
    // approved under the old (shorter) shape, that record suddenly has no
    // audit row for the new level and every consumer of `steps` — including
    // ApprovalStatusChain on the frontend, which recomputes fullyApproved
    // itself from each step's own `status` rather than trusting the
    // `fullyApproved` field below — would show it as stuck on that new level,
    // even though nothing about the record itself changed. Backfilling every
    // step to "Approved" here (not just the summary flags) is what actually
    // fixes the badge, since the frontend never reads the flags directly.
    // Only in-progress (Pending) records are still evaluated against the
    // current workflow shape.
    const docEntry = Object.values(DOC_MODULE_MAP).find(
      (m) => m.table.replace("dbo.", "") === tableName,
    );
    let actualStatus = null;
    if (docEntry) {
      try {
        const docResult = await pool
          .request()
          .input("id", sql.Int, recordId)
          .query(`SELECT ${docEntry.status} AS Status FROM ${docEntry.table} WHERE ${docEntry.pk} = @id`);
        actualStatus = docResult.recordset[0]?.Status ?? null;
      } catch {
        // Best-effort — if the lookup fails for any reason, fall back to
        // the step-derived computation below rather than erroring the badge.
      }
    }
    const approvedOutcome = isApprovedOutcome(tableName, actualStatus);
    if (approvedOutcome) {
      for (const s of steps) {
        if (s.status !== "Approved") {
          s.status = "Approved";
          s.note = s.note ?? "Approved under an earlier version of this workflow";
        }
      }
    }

    // The other way round: the record is Pending again but every level still
    // reads Approved. That's a document amended after approval — the edit
    // routes put Status back to Pending directly, so no new cycle marker has
    // been written yet and the old cycle's sign-offs are still the latest
    // rows. The approval engine restarts such a record at level 1 the moment
    // anyone acts on it (approvalService.resolveCurrentLevel), so show it that
    // way now instead of "Final level · Approved" beside a Pending status.
    const amendedAfterApproval =
      !approvedOutcome &&
      actualStatus === "Pending" &&
      steps.length > 0 &&
      steps.every((s) => s.status === "Approved");
    if (amendedAfterApproval) {
      for (const s of steps) {
        s.status = "Pending";
        s.approverEmail = null;
        s.approverName = null;
        s.role = null;
        s.actionAt = null;
        if (Array.isArray(s.approvers)) s.approvers = [];
        s.note = "Amended after approval — waiting for approval again";
      }
    }

    const fullSteps = [...submittedMarkers, ...steps, ...rejectedMarkers];

    const currentLevel =
      steps.findIndex((s) => s.status !== "Approved") + 1 || steps.length;
    const fullyApproved =
      approvedOutcome ||
      (steps.length > 0 && steps.every((s) => s.status === "Approved"));
    const hasRejection =
      !approvedOutcome &&
      (actualStatus === "Rejected" || rejectedMarkers.length > 0 || steps.some((s) => s.status === "Rejected"));

    return {
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
    };
}

// GET /api/approval-workflows/trail?module=GoodsReceiptNotes&id=123
// Returns the active workflow levels + audit log for a specific record.
// Only returns the LATEST entry per level (handles resubmissions).
router.get("/trail", authMiddleware, async (req, res) => {
  const { module, id } = req.query;
  if (!module || !id) {
    return res.status(400).json({ error: "module and id are required" });
  }
  try {
    const pool = getPool();
    const recordId = parseInt(id, 10);
    const result = await buildApprovalTrail(pool, module, recordId);
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/approval-workflows/trail/bulk?module=MaterialRequests&ids=1,2,3
// Same payload as GET /trail, but for every id in one request — a list page
// with N rows previously fired N concurrent GET /trail calls (one per
// ApprovalStatusChain), which on a page like Material Request (~36 rows)
// was enough on its own to trip the per-user API rate limit; see
// buildApprovalTrail's comment above. Capped at 200 ids per call — well
// above any real page size, just a sanity ceiling.
router.get("/trail/bulk", authMiddleware, async (req, res) => {
  const { module, ids } = req.query;
  if (!module || !ids) {
    return res.status(400).json({ error: "module and ids are required" });
  }
  const idList = String(ids)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n))
    .slice(0, 200);
  if (!idList.length) {
    return res.status(400).json({ error: "ids must contain at least one valid integer" });
  }

  try {
    const pool = getPool();
    const out = {};
    // Sequential, not Promise.all — this already replaces N concurrent HTTP
    // requests (the actual rate-limit cost) with 1, so there's no pressure
    // to also parallelize the DB round-trips, and sequential keeps this from
    // adding its own burst of concurrent queries against the pool.
    for (const recordId of idList) {
      out[recordId] = await buildApprovalTrail(pool, module, recordId);
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
