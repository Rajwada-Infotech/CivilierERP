const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const logger = require("../logger");
const { getPool } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  MODULE_MAP,
  MODULE_APPROVER_ROLE_OVERRIDES,
  APPROVER_ROLES,
  getWorkflow,
  resolveCurrentLevel,
  hasApprovalInboxEditRight,
} = require("../services/approvalService");

// ── Per-record visibility filter ────────────────────────────────────────────
// Before this, GET / returned every Pending row in the system to anyone
// holding "approval-inbox: view" — a Material Request waiting on its named
// Level-2 approvers (say, two specific people picked in Approval Setup) was
// just as visible to everyone else with that page right, with nothing
// showing which level it was actually on or who was meant to act next.
//
// This mirrors transition()'s own per-level gate (approvalService.js) so a
// record only shows up for:
//  - admin / super_admin (oversight — they can always see everything), or
//  - whoever is actually allowed to act on the level it's CURRENTLY on: the
//    role(s)/specific user(s) named on that level in Approval Setup, or —
//    for a level left uncustomised, or a module with no workflow configured
//    at all — the module's existing default approver set (today's fallback
//    behaviour, unchanged).
async function isVisibleToViewer(item, viewerRole, viewerUserId, workflowCache) {
  const role = (viewerRole || "").toLowerCase();
  if (role === "admin" || role === "super_admin") return true;

  const map = MODULE_MAP[item.Module];
  const fallbackRoles = MODULE_APPROVER_ROLE_OVERRIDES[item.Module] || APPROVER_ROLES;
  const fallbackVisible = async () =>
    fallbackRoles.includes(role) || (await hasApprovalInboxEditRight(viewerUserId));

  // Modules the aggregator lists but that aren't in the shared MODULE_MAP
  // (e.g. received-payment, crm-money-receipts — they never went through
  // approvalService.js's level engine) keep today's page-right-only
  // visibility; there's no per-level data to filter on.
  if (!map) return true;

  const workflow = workflowCache.get(item.Module);
  if (!workflow || !workflow.LevelDefs?.length) return fallbackVisible();

  const tableName = map.table.replace("dbo.", "");
  const recordId = parseInt(item.RecordId, 10);
  const totalLevels = workflow.Levels || workflow.LevelDefs.length;
  const currentLevel = await resolveCurrentLevel(tableName, recordId, totalLevels, workflow.LevelDefs);
  // Fully approved already (shouldn't normally reach here — every branch of
  // the aggregator query only selects Pending rows) — nothing left to show.
  if (currentLevel > totalLevels) return false;

  const levelDef = workflow.LevelDefs[currentLevel - 1];
  if (!levelDef) return fallbackVisible();

  const hasRoles = Array.isArray(levelDef.roles) && levelDef.roles.length > 0;
  const hasUsers = Array.isArray(levelDef.userIds) && levelDef.userIds.length > 0;
  // Level left uncustomised — no named roles or people — falls back to the
  // module's default approver set, exactly like transition()'s own gate does.
  if (!hasRoles && !hasUsers) return fallbackVisible();

  const roleMatch = hasRoles && levelDef.roles.map((r) => String(r).toLowerCase()).includes(role);
  const userMatch = hasUsers && viewerUserId != null && levelDef.userIds.includes(viewerUserId);
  return roleMatch || userMatch;
}

async function filterVisibleToViewer(items, req) {
  const viewerRole = req.user?.role;
  const viewerUserId = req.user?.userId ?? req.user?.id ?? null;

  // Resolve each distinct module's workflow once, sequentially, before
  // filtering — items.map + Promise.all below runs every row concurrently,
  // so lazily populating the cache inside isVisibleToViewer would just race
  // (every row for the same module would see an empty cache at once and all
  // issue their own identical getWorkflow() query).
  const workflowCache = new Map();
  const distinctModules = [...new Set(items.map((i) => i.Module))];
  for (const mod of distinctModules) {
    workflowCache.set(mod, await getWorkflow(mod));
  }

  const flags = await Promise.all(
    items.map((item) => isVisibleToViewer(item, viewerRole, viewerUserId, workflowCache)),
  );
  return items.filter((_, i) => flags[i]);
}

// This router previously had no page-level check at all — every other route
// file in this codebase gates with requirePageRight, but this one relied
// only on the blanket /api authMiddleware in server.js (so a valid login was
// required, but ANY role could read pending PO/Payment/ReceivedPayment/GRN/
// Contract/CRM-brokerage amounts across the whole company). Gated the same
// way the rest of the app does, using an "approval-inbox" page key.
// NOTE: if dbo.Pages / the menu table has no "approval-inbox" entry yet,
// requirePageRight will deny everyone (including admins) until it's seeded —
// add it the same way the widget-rights table was seeded, then grant it to
// whichever roles should see the cross-module inbox.
router.use(requirePageRight("approval-inbox", "view"));

// NULL placeholders so every UNION ALL branch has the same column count.
// Only the expense-booking branch populates GrnTotalAmount, GrnBasicAmount,
// and BillingTermsData.
const NULL_EXTRA = `
  CAST(NULL AS DECIMAL(18,2)) AS GrnTotalAmount,
  CAST(NULL AS DECIMAL(18,2)) AS GrnBasicAmount,
  CAST(NULL AS NVARCHAR(MAX)) AS BillingTermsData,
  CAST(NULL AS NVARCHAR(100)) AS SourceTransferDocNo,
  CAST(NULL AS NVARCHAR(255)) AS FromGodownName,
  CAST(NULL AS NVARCHAR(255)) AS ToGodownName,`;

// Builds the per-module SELECT list (optionally scoped to one module) shared
// by both GET / (the full inbox) and GET /count (the badge) — a single
// source of truth for "what counts as pending" so the two can never drift,
// and so the badge count can be run through the exact same per-viewer
// visibility filter as the list itself instead of a separate raw aggregate.
function buildInboxQueries(module) {
  const queries = [];

  if (!module || module === "purchase-orders") {
      queries.push(`
        SELECT
          'purchase-orders'                    AS Module,
          'Purchase Order'                     AS ModuleLabel,
          CAST(PurchaseOrderID AS NVARCHAR)    AS RecordId,
          PurchaseOrderNo                      AS Reference,
          PODate                               AS RecordDate,
          Status,
          CAST(NULL AS NVARCHAR)               AS ContractorName,
          CAST(NULL AS NVARCHAR)               AS SupplierName,
          TotalAmount                          AS Amount,
          ${NULL_EXTRA}
          CAST(CreatedBy AS NVARCHAR(255))     AS CreatedBy,
          ISNULL(CAST(ApprovedBy AS NVARCHAR(255)), '')  AS ApprovedBy,
          ISNULL(CAST(ApprovedAt AS NVARCHAR), '')       AS ApprovedAt,
          ISNULL(CAST(RejectedBy AS NVARCHAR(255)), '')  AS RejectedBy,
          ISNULL(CAST(RejectionNote AS NVARCHAR(MAX)), '') AS RejectionNote,
          UpdatedAt                            AS LastModified
        FROM dbo.PurchaseOrders
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "work-orders") {
      queries.push(`
        SELECT
          'work-orders'                        AS Module,
          'Work Order'                         AS ModuleLabel,
          CAST(Id AS NVARCHAR)                 AS RecordId,
          DocumentNumber                       AS Reference,
          DocumentDate                         AS RecordDate,
          Status,
          CAST(NULL AS NVARCHAR)               AS ContractorName,
          CAST(NULL AS NVARCHAR)               AS SupplierName,
          TotalAmount                          AS Amount,
          ${NULL_EXTRA}
          CAST(CreatedBy AS NVARCHAR(255))     AS CreatedBy,
          ISNULL(CAST(ApprovedBy AS NVARCHAR(255)), '')  AS ApprovedBy,
          ISNULL(CAST(ApprovedAt AS NVARCHAR), '')       AS ApprovedAt,
          ISNULL(CAST(RejectedBy AS NVARCHAR(255)), '')  AS RejectedBy,
          ISNULL(CAST(RejectionNote AS NVARCHAR(MAX)), '') AS RejectionNote,
          UpdatedAt                            AS LastModified
        FROM dbo.WorkOrderHeader
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "payments") {
      queries.push(`
        SELECT
          'payments'                           AS Module,
          'Payment'                            AS ModuleLabel,
          CAST(PPaymentID AS NVARCHAR)         AS RecordId,
          -- CRM Refund / Brokerage payouts (SourceCrmRefundId / SourceCrmBrokerageId)
          -- were showing the generic "CRM Refund"/"CRM Brokerage" name here instead
          -- of the actual voucher DocNo every other module in this inbox uses.
          ISNULL(DocNo, PPaymentName)          AS Reference,
          PDate                                AS RecordDate,
          ISNULL(Status, 'Draft')              AS Status,
          CAST(NULL AS NVARCHAR)               AS ContractorName,
          CAST(NULL AS NVARCHAR)               AS SupplierName,
          PAmount                              AS Amount,
          ${NULL_EXTRA}
          CAST(PCreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ISNULL(CAST(PApprovedBy AS NVARCHAR(255)), '') AS ApprovedBy,
          ''                                   AS ApprovedAt,
          ''                                   AS RejectedBy,
          ''                                   AS RejectionNote,
          CAST(NULL AS DATETIME2)              AS LastModified
        FROM dbo.NewPayment
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "received-payment") {
      queries.push(`
        SELECT
          'received-payment'                              AS Module,
          'Received Payment'                              AS ModuleLabel,
          CAST(RPPaymentID AS NVARCHAR)                   AS RecordId,
          ISNULL(RPDocNo, CONCAT('REC/', CAST(RPPaymentID AS NVARCHAR))) AS Reference,
          RPDocDate                                       AS RecordDate,
          ISNULL(RPStatus, 'Draft')                       AS Status,
          CAST(NULL AS NVARCHAR)                           AS ContractorName,
          ISNULL(RPCustomerName, RPReceivedFrom)           AS SupplierName,
          RPAmount                                        AS Amount,
          ${NULL_EXTRA}
          CAST(RPCreatedBy AS NVARCHAR(255))              AS CreatedBy,
          ISNULL(CAST(RPApprovedBy AS NVARCHAR(255)), '') AS ApprovedBy,
          ISNULL(CAST(RPApprovedAt AS NVARCHAR), '')      AS ApprovedAt,
          ISNULL(CAST(RPRejectedBy AS NVARCHAR(255)), '') AS RejectedBy,
          ISNULL(CAST(RPRejectionNote AS NVARCHAR(MAX)), '') AS RejectionNote,
          RPUpdatedAt                                     AS LastModified
        FROM dbo.ReceivedPayment
        WHERE RPStatus = 'Pending'
      `);
    }

    if (!module || module === "goods-receipt") {
      queries.push(`
        SELECT
          'goods-receipt'                           AS Module,
          'GRN'                                     AS ModuleLabel,
          CAST(grn.GRNID AS NVARCHAR)               AS RecordId,
          ISNULL(grn.DocNo, grn.GRNNo)              AS Reference,
          grn.GRNDate                               AS RecordDate,
          ISNULL(grn.Status, 'Draft')               AS Status,
          CAST(NULL AS NVARCHAR)                     AS ContractorName,
          s.LHeadName                               AS SupplierName,
          grn.TotalAmount                           AS Amount,
          CAST(NULL AS DECIMAL(18,2))               AS GrnTotalAmount,
          CAST(NULL AS DECIMAL(18,2))               AS GrnBasicAmount,
          CAST(NULL AS NVARCHAR(MAX))               AS BillingTermsData,
          grn.SourceTransferDocNo                   AS SourceTransferDocNo,
          fg.GodownName                             AS FromGodownName,
          tg.GodownName                             AS ToGodownName,
          CAST(ISNULL(po.PurchaseOrderNo, '') AS NVARCHAR(255)) AS CreatedBy,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ), '')                                    AS ApprovedBy,
          ISNULL(CAST((
            SELECT TOP 1 ActionAt
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ) AS NVARCHAR), '')                       AS ApprovedAt,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                    AS RejectedBy,
          ISNULL((
            SELECT TOP 1 Note
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                    AS RejectionNote,
          grn.UpdatedAt                             AS LastModified
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
        LEFT JOIN dbo.StockTransfers st ON st.TransferID = grn.SourceTransferID
        LEFT JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
        LEFT JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
        WHERE grn.Status = 'Pending'
      `);
    }

    if (!module || module === "expense-booking") {
      queries.push(`
        SELECT
          'expense-booking'        AS Module,
          'Expense Booking'        AS ModuleLabel,
          CAST(eb.Eid AS NVARCHAR) AS RecordId,
          ISNULL(eb.EDocNo, CONCAT('EB#', CAST(eb.Eid AS NVARCHAR))) AS Reference,
          eb.EDocDate              AS RecordDate,
          ISNULL(eb.EStatus, 'Draft') AS Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn_eb.GRNID IS NOT NULL THEN ISNULL(ahm_eb.LHeadName, eb.EName)
            ELSE eb.EName
          END                      AS SupplierName,
          ISNULL(eb.ENetAmount, eb.EAmount) AS Amount,
          -- Live GRN total (incl GST) for GRN-linked bookings; NULL otherwise.
          -- Multi-GRN combined invoices (ELinkedGrnIds set — see
          -- backend/services/invoiceLinking.js) have no single source GRN to
          -- pull a live total from; grn_eb only ever joins the primary/first
          -- one, so recomputing from it alone understates the real total.
          -- For those, leave this NULL so the frontend falls back to the
          -- already-correct combined Amount above (same guard as GET /:id
          -- in expenseBooking.js).
          CASE
            WHEN eb.ESourceType = 'GRN' AND eb.ELinkedGrnIds IS NULL AND grn_eb.TotalAmount IS NOT NULL AND grn_eb.TotalAmount > 0
            THEN grn_eb.TotalAmount
            ELSE NULL
          END                      AS GrnTotalAmount,
          -- Stored basic/taxable amount (pre-GST) — required by
          -- computeGrnNetWithTerms to correctly recompute GST after
          -- pre-GST billing terms shift the base. Without this the frontend
          -- defaults to a base of 0 and the recomputed net collapses to ₹0.
          eb.EAmount               AS GrnBasicAmount,
          -- Billing terms JSON so the frontend can apply them on top of GrnTotalAmount.
          eb.EBillingTermsData     AS BillingTermsData,
          CAST(NULL AS NVARCHAR(100)) AS SourceTransferDocNo,
          CAST(NULL AS NVARCHAR(255)) AS FromGodownName,
          CAST(NULL AS NVARCHAR(255)) AS ToGodownName,
          CAST(ISNULL(u_created.name, CAST(eb.ECreatedBy AS NVARCHAR(255))) AS NVARCHAR(255))  AS CreatedBy,
          CAST(ISNULL(u_approved.name, '') AS NVARCHAR(255))                                    AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          eb.EUpdatedAt            AS LastModified
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn_eb
          ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ahm_eb
          ON ahm_eb.LHeadId = grn_eb.SupplierID
        LEFT JOIN dbo.users u_created  ON u_created.id = eb.ECreatedBy
        LEFT JOIN dbo.users u_approved ON u_approved.id = eb.EApprovedBy
        WHERE eb.EStatus = 'Pending'
          AND NOT (
            ISNULL(eb.ESourceType, '') = 'GRN'
            AND ISNULL(eb.ERemarks, '') LIKE 'Auto-created for remaining items from GRN%'
          )
      `);
    }

    if (!module || module === "work-done") {
      queries.push(`
        SELECT
          'work-done'                          AS Module,
          'Work Done'                          AS ModuleLabel,
          CAST(wd.ID AS NVARCHAR)              AS RecordId,
          wd.DocNo                             AS Reference,
          wd.DocDate                           AS RecordDate,
          ISNULL(wd.Status, 'Draft')           AS Status,
          CAST(NULL AS NVARCHAR)               AS ContractorName,
          CAST(NULL AS NVARCHAR)               AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))          AS Amount,
          ${NULL_EXTRA}
          CAST(wd.CreatedBy AS NVARCHAR(255))  AS CreatedBy,
          ''                                   AS ApprovedBy,
          ''                                   AS ApprovedAt,
          ''                                   AS RejectedBy,
          ISNULL(CAST(wd.Remarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          wd.UpdatedAt                         AS LastModified
        FROM dbo.WorkDone wd
        WHERE ISNULL(wd.Status, 'Draft') = 'Pending'
      `);
    }

    if (!module || module === "boq") {
      queries.push(`
        SELECT
          'boq'                                AS Module,
          'BOQ'                                AS ModuleLabel,
          CAST(b.BoqID AS NVARCHAR)            AS RecordId,
          COALESCE(b.DocNo, b.BoqNo)           AS Reference,
          b.BoqDate                            AS RecordDate,
          ISNULL(b.Status, 'Draft')            AS Status,
          CAST(pr.name AS NVARCHAR(255))       AS ContractorName,
          CAST(CONCAT(
            COALESCE(pr.name, ''),
            CASE WHEN pr.name IS NOT NULL AND co.name IS NOT NULL THEN ' / ' ELSE '' END,
            COALESCE(co.name, '')
          ) AS NVARCHAR(512))                  AS SupplierName,
          b.TotalAmount                        AS Amount,
          ${NULL_EXTRA}
          CAST(b.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                   AS ApprovedBy,
          ''                                   AS ApprovedAt,
          ''                                   AS RejectedBy,
          ISNULL(CAST(b.Remarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(b.UpdatedAt, b.CreatedAt)     AS LastModified
        FROM dbo.BOQ b
        LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
        WHERE ISNULL(b.Status, 'Draft') = 'Pending'
      `);
    }

    if (!module || module === "material-requests") {
      queries.push(`
        SELECT
          'material-requests'                  AS Module,
          'Material Request'                   AS ModuleLabel,
          CAST(mr.MRId AS NVARCHAR)             AS RecordId,
          ISNULL(mr.DocNo, CONCAT('MR#', CAST(mr.MRId AS NVARCHAR))) AS Reference,
          mr.RequestDate                       AS RecordDate,
          mr.Status,
          CAST(pr.name AS NVARCHAR(255))        AS ContractorName,
          CAST(CONCAT(
            COALESCE(pr.name, ''),
            CASE WHEN pr.name IS NOT NULL AND co.name IS NOT NULL THEN ' / ' ELSE '' END,
            COALESCE(co.name, '')
          ) AS NVARCHAR(512))                   AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))          AS Amount,
          ${NULL_EXTRA}
          CAST(mr.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                   AS ApprovedBy,
          ''                                   AS ApprovedAt,
          ''                                   AS RejectedBy,
          ''                                   AS RejectionNote,
          mr.UpdatedAt                          AS LastModified
        FROM dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise co ON co.id = mr.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = mr.ProjectId
        WHERE mr.Status = 'Pending'
      `);
    }

    if (!module || module === "stock-transfers") {
      queries.push(`
        SELECT
          'stock-transfers'                    AS Module,
          'Stock Transfer'                     AS ModuleLabel,
          CAST(st.TransferID AS NVARCHAR)      AS RecordId,
          st.DocNo                             AS Reference,
          st.TransferDate                      AS RecordDate,
          st.Status,
          CAST(fg.GodownName AS NVARCHAR(255)) AS ContractorName,
          CAST(CONCAT(
            COALESCE(fg.GodownName, ''), N' → ', COALESCE(tg.GodownName, '')
          ) AS NVARCHAR(512))                  AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))          AS Amount,
          ${NULL_EXTRA}
          CAST(st.CreatedBy AS NVARCHAR(255))  AS CreatedBy,
          ''                                   AS ApprovedBy,
          ''                                   AS ApprovedAt,
          ''                                   AS RejectedBy,
          ISNULL(CAST(st.Remarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(st.UpdatedAt, st.CreatedAt)   AS LastModified
        FROM dbo.StockTransfers st
        LEFT JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
        LEFT JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
        WHERE st.Status = 'Pending'
      `);
    }

    if (!module || module === "vehicle-in-out") {
      queries.push(`
        SELECT
          'vehicle-in-out'                       AS Module,
          'Vehicle In/Out'                       AS ModuleLabel,
          CAST(v.VehicleInOutID AS NVARCHAR)     AS RecordId,
          ISNULL(v.DocNo, CONCAT('VEH#', CAST(v.VehicleInOutID AS NVARCHAR))) AS Reference,
          v.DocDate                              AS RecordDate,
          v.Status,
          CAST(NULL AS NVARCHAR)                 AS ContractorName,
          ISNULL(v.SupplierName, v.VehicleNo)    AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))            AS Amount,
          ${NULL_EXTRA}
          CAST(v.CreatedBy AS NVARCHAR(255))     AS CreatedBy,
          ''                                     AS ApprovedBy,
          ''                                     AS ApprovedAt,
          ''                                     AS RejectedBy,
          ''                                     AS RejectionNote,
          v.UpdatedAt                            AS LastModified
        FROM dbo.VehicleInOut v
        WHERE v.Status = 'Pending'
      `);
    }

    if (!module || module === "material-issues") {
      queries.push(`
        SELECT
          'material-issues'                                              AS Module,
          'Material Issue'                                               AS ModuleLabel,
          CAST(mi.IssueId AS NVARCHAR)                                   AS RecordId,
          ISNULL(mi.DocNo, ISNULL(mi.IssueNo, CONCAT('ISS#', CAST(mi.IssueId AS NVARCHAR)))) AS Reference,
          mi.Date                                                        AS RecordDate,
          ISNULL(mi.Status, 'Pending')                                   AS Status,
          CAST(NULL AS NVARCHAR)                                         AS ContractorName,
          ISNULL(mi.IssuedTo, ISNULL(p.name, mi.Reason))                AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))                                    AS Amount,
          ${NULL_EXTRA}
          CAST(mi.CreatedBy AS NVARCHAR(255))                            AS CreatedBy,
          ''                                                             AS ApprovedBy,
          ''                                                             AS ApprovedAt,
          ''                                                             AS RejectedBy,
          ''                                                             AS RejectionNote,
          ISNULL(mi.UpdatedAt, mi.CreatedAt)                            AS LastModified
        FROM dbo.MaterialIssues mi
        LEFT JOIN dbo.enterprise p ON p.id = mi.ProjectId
        WHERE ISNULL(mi.Status, 'Pending') = 'Pending'
      `);
    }

    if (!module || module === "material-issue-return") {
      queries.push(`
        SELECT
          'material-issue-return'                                        AS Module,
          'Material Issue Return'                                        AS ModuleLabel,
          CAST(ir.ReturnId AS NVARCHAR)                                   AS RecordId,
          ISNULL(ir.DocNo, CONCAT('IRN#', CAST(ir.ReturnId AS NVARCHAR))) AS Reference,
          ir.ReturnDate                                                   AS RecordDate,
          ISNULL(ir.Status, 'Pending')                                    AS Status,
          CAST(NULL AS NVARCHAR)                                         AS ContractorName,
          ISNULL(mi.DocNo, ISNULL(p.name, ir.Reason))                    AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))                                     AS Amount,
          ${NULL_EXTRA}
          CAST(ir.CreatedBy AS NVARCHAR(255))                             AS CreatedBy,
          ''                                                              AS ApprovedBy,
          ''                                                              AS ApprovedAt,
          ''                                                              AS RejectedBy,
          ''                                                              AS RejectionNote,
          ISNULL(ir.UpdatedAt, ir.CreatedAt)                             AS LastModified
        FROM dbo.MaterialIssueReturn ir
        LEFT JOIN dbo.MaterialIssues mi ON mi.IssueId = ir.IssueId
        LEFT JOIN dbo.enterprise p ON p.id = ir.ProjectId
        WHERE ISNULL(ir.Status, 'Pending') = 'Pending'
      `);
    }

    if (!module || module === "sale-orders") {
      queries.push(`
        SELECT
          'sale-orders'                              AS Module,
          'Sale Order'                                AS ModuleLabel,
          CAST(so.SaleOrderID AS NVARCHAR)            AS RecordId,
          so.DocNo                                    AS Reference,
          so.OrderDate                                AS RecordDate,
          ISNULL(so.Status, 'Draft')                  AS Status,
          fc.name                                      AS ContractorName,
          tc.name                                      AS SupplierName,
          so.TotalAmount                               AS Amount,
          CAST(NULL AS DECIMAL(18,2))                  AS GrnTotalAmount,
          CAST(NULL AS DECIMAL(18,2))                  AS GrnBasicAmount,
          CAST(NULL AS NVARCHAR(MAX))                  AS BillingTermsData,
          CAST(NULL AS NVARCHAR(100))                  AS SourceTransferDocNo,
          fg.GodownName                                 AS FromGodownName,
          tg.GodownName                                 AS ToGodownName,
          CAST(so.CreatedBy AS NVARCHAR(255))          AS CreatedBy,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'SaleOrders'
              AND RecordId = so.SaleOrderID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ), '')                                       AS ApprovedBy,
          ISNULL(CAST((
            SELECT TOP 1 ActionAt
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'SaleOrders'
              AND RecordId = so.SaleOrderID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ) AS NVARCHAR), '')                          AS ApprovedAt,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'SaleOrders'
              AND RecordId = so.SaleOrderID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                       AS RejectedBy,
          ISNULL((
            SELECT TOP 1 Note
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'SaleOrders'
              AND RecordId = so.SaleOrderID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                       AS RejectionNote,
          ISNULL(so.UpdatedAt, so.CreatedAt)           AS LastModified
        FROM dbo.SaleOrders so
        JOIN dbo.enterprise fc ON fc.id = so.FromCompanyID
        JOIN dbo.enterprise tc ON tc.id = so.ToCompanyID
        JOIN dbo.Godowns fg ON fg.GodownID = so.FromGodownID
        JOIN dbo.Godowns tg ON tg.GodownID = so.ToGodownID
        WHERE so.Status = 'Pending'
      `);
    }

    if (!module || module === "journal-voucher") {
      queries.push(`
        SELECT
          'journal-voucher'                     AS Module,
          'Journal Voucher'                     AS ModuleLabel,
          CAST(jv.JVID AS NVARCHAR)             AS RecordId,
          ISNULL(jv.JVNo, CONCAT('JV#', CAST(jv.JVID AS NVARCHAR))) AS Reference,
          jv.JVDate                             AS RecordDate,
          jv.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          CAST(NULL AS NVARCHAR)                AS SupplierName,
          (SELECT SUM(DebitAmount) FROM dbo.JournalVoucherLines WHERE JVID = jv.JVID) AS Amount,
          ${NULL_EXTRA}
          CAST(jv.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          -- JournalVoucher has no RejectionNote column of its own (rejection
          -- reasons live in ApprovalAuditLog, not surfaced here) — this used
          -- to read jv.Narration instead, which meant every pending JV's own
          -- narration/description showed up mislabeled as a "Rejection Note"
          -- in the inbox, even though it was never rejected.
          ''                                    AS RejectionNote,
          ISNULL(jv.UpdatedAt, jv.CreatedAt)    AS LastModified
        FROM dbo.JournalVoucher jv
        WHERE jv.Status = 'Pending'
      `);
    }

    if (!module || module === "inter-company-transfer") {
      queries.push(`
        SELECT
          'inter-company-transfer'              AS Module,
          'Inter-Company Transfer'              AS ModuleLabel,
          CAST(ict.ICTId AS NVARCHAR)           AS RecordId,
          ISNULL(ict.DocNo, CONCAT('ICT#', CAST(ict.ICTId AS NVARCHAR))) AS Reference,
          ict.TransferDate                      AS RecordDate,
          ict.Status,
          sp.name                               AS ContractorName,
          rp.name                                AS SupplierName,
          ict.TotalAmount                       AS Amount,
          ${NULL_EXTRA}
          CAST(ict.CreatedBy AS NVARCHAR(255))  AS CreatedBy,
          ''                                     AS ApprovedBy,
          ''                                     AS ApprovedAt,
          ''                                     AS RejectedBy,
          ISNULL(CAST(ict.Remarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ict.CreatedAt                          AS LastModified
        FROM dbo.InterCompanyTransfer ict
        LEFT JOIN dbo.enterprise sp ON sp.id = ict.SenderProjectId
        LEFT JOIN dbo.enterprise rp ON rp.id = ict.ReceiverProjectId
        WHERE ict.Status = 'Pending'
      `);
    }

    if (!module || module === "fund-transfer") {
      queries.push(`
        SELECT
          'fund-transfer'                        AS Module,
          'Fund Transfer'                        AS ModuleLabel,
          CAST(ft.FTId AS NVARCHAR)              AS RecordId,
          ISNULL(ft.DocNo, CONCAT('FT#', CAST(ft.FTId AS NVARCHAR))) AS Reference,
          ft.TransferDate                        AS RecordDate,
          ft.Status,
          sc.name                                AS ContractorName,
          dc.name                                AS SupplierName,
          ft.Amount                              AS Amount,
          ${NULL_EXTRA}
          CAST(ft.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                      AS ApprovedBy,
          ''                                      AS ApprovedAt,
          ''                                      AS RejectedBy,
          ISNULL(CAST(ft.Narration AS NVARCHAR(MAX)), '') AS RejectionNote,
          ft.CreatedAt                            AS LastModified
        FROM dbo.FundTransfer ft
        LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
        LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
        WHERE ft.Status = 'Pending'
      `);
    }

    // Applications no longer have their own approve/reject cycle — they
    // stay Pending permanently once Submitted, and all real review/approval
    // happens on the Booking that's auto-created for them instead (see
    // crmApplications.js PUT /:id/submit, crmBookings.js, and
    // crmBookingStageService.js). An Application row here would have no
    // valid action left to take (its approve/reject/checklist routes were
    // retired) and would never clear, so it's deliberately excluded now.

    if (!module || module === "crm-bookings") {
      queries.push(`
        SELECT
          'crm-bookings'                        AS Module,
          'CRM Booking'                         AS ModuleLabel,
          CAST(b.Id AS NVARCHAR)                AS RecordId,
          b.BookingNo                           AS Reference,
          b.CreatedAt                           AS RecordDate,
          b.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          b.GrandTotal                          AS Amount,
          ${NULL_EXTRA}
          CAST(b.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ''                                    AS RejectionNote,
          ISNULL(b.UpdatedAt, b.CreatedAt)      AS LastModified
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.Status = 'Pending' AND b.IsActive = 1 AND b.ReadyForApprovalAt IS NOT NULL
      `);
    }

    if (!module || module === "crm-agreements") {
      queries.push(`
        SELECT
          'crm-agreements'                      AS Module,
          'CRM Agreement (Senior Approval)'     AS ModuleLabel,
          CAST(ag.Id AS NVARCHAR)               AS RecordId,
          ag.AgreementNo                        AS Reference,
          ag.CreatedAt                          AS RecordDate,
          ag.SeniorApprovalStatus               AS Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          b.TotalValue                          AS Amount,
          ${NULL_EXTRA}
          CAST(ag.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(ag.SeniorApprovalRemarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(ag.UpdatedAt, ag.CreatedAt)    AS LastModified
        FROM dbo.CrmAgreement ag
        JOIN dbo.CrmBooking b     ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE ag.SeniorApprovalStatus = 'Pending'
      `);
    }

    if (!module || module === "crm-agreement-date") {
      queries.push(`
        SELECT
          'crm-agreement-date'                  AS Module,
          'CRM Agreement (Date Approval)'       AS ModuleLabel,
          CAST(ag.Id AS NVARCHAR)               AS RecordId,
          ag.AgreementNo                        AS Reference,
          ag.CreatedAt                          AS RecordDate,
          ag.DateApprovalStatus                 AS Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          b.TotalValue                          AS Amount,
          ${NULL_EXTRA}
          CAST(ag.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          CONCAT('Proposed: ', CONVERT(NVARCHAR(10), ag.ProposedDateByCompany, 23)) AS RejectionNote,
          ISNULL(ag.UpdatedAt, ag.CreatedAt)    AS LastModified
        FROM dbo.CrmAgreement ag
        JOIN dbo.CrmBooking b     ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE ag.DateApprovalStatus = 'Pending'
      `);
    }

    if (!module || module === "crm-sales-deed-director") {
      queries.push(`
        SELECT
          'crm-sales-deed-director'             AS Module,
          'CRM Sales Deed (Director)'           AS ModuleLabel,
          CAST(d.Id AS NVARCHAR)                AS RecordId,
          d.DeedNo                              AS Reference,
          d.CreatedAt                           AS RecordDate,
          d.DirectorApprovalStatus              AS Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          d.DeedValue                           AS Amount,
          ${NULL_EXTRA}
          CAST(d.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(d.DirectorApprovalRemarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(d.UpdatedAt, d.CreatedAt)      AS LastModified
        FROM dbo.CrmSalesDeed d
        JOIN dbo.CrmBooking b     ON b.Id = d.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE d.DirectorApprovalStatus = 'Pending'
      `);
    }

    if (!module || module === "crm-brokerage") {
      queries.push(`
        SELECT
          'crm-brokerage'                       AS Module,
          'CRM Brokerage'                       AS ModuleLabel,
          CAST(br.Id AS NVARCHAR)               AS RecordId,
          b.BookingNo                           AS Reference,
          br.CreatedAt                          AS RecordDate,
          br.Status,
          br.BrokerName                         AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          br.ComputedAmount                     AS Amount,
          ${NULL_EXTRA}
          CAST(br.CreatedBy AS NVARCHAR(255))   AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(br.Notes AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(br.UpdatedAt, br.CreatedAt)    AS LastModified
        FROM dbo.CrmBrokerageMaster br
        JOIN dbo.CrmBooking b     ON b.Id = br.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE br.Status = 'Pending' AND br.IsLocked = 0
      `);
    }

    if (!module || module === "crm-cancellations") {
      queries.push(`
        SELECT
          'crm-cancellations'                   AS Module,
          'CRM Cancellation & Refund'           AS ModuleLabel,
          CAST(c.Id AS NVARCHAR)                AS RecordId,
          c.CancellationNo                      AS Reference,
          c.CreatedAt                           AS RecordDate,
          c.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          c.RefundAmount                        AS Amount,
          ${NULL_EXTRA}
          CAST(c.RequestedBy AS NVARCHAR(255))  AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(c.Reason AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(c.UpdatedAt, c.CreatedAt)      AS LastModified
        FROM dbo.CrmCancellation c
        JOIN dbo.CrmBooking b     ON b.Id = c.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE c.Status = 'Pending'
      `);
    }

    if (!module || module === "crm-money-receipts") {
      queries.push(`
        SELECT
          'crm-money-receipts'                  AS Module,
          'CRM Money Receipt'                   AS ModuleLabel,
          CAST(mr.Id AS NVARCHAR)               AS RecordId,
          mr.ReceiptNo                          AS Reference,
          mr.ReceivedDate                       AS RecordDate,
          mr.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          mr.Amount                             AS Amount,
          ${NULL_EXTRA}
          CAST(ISNULL(u_cr.name, CAST(mr.CreatedBy AS NVARCHAR(255))) AS NVARCHAR(255)) AS CreatedBy,
          ISNULL(CAST(u_appr.name AS NVARCHAR(255)), '') AS ApprovedBy,
          ISNULL(CAST(mr.ApprovedAt AS NVARCHAR), '')    AS ApprovedAt,
          ISNULL(CAST(u_bnc.name AS NVARCHAR(255)), '')  AS RejectedBy,
          ISNULL(CAST(mr.BouncedReason AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(mr.UpdatedAt, mr.CreatedAt)    AS LastModified
        FROM dbo.CrmMoneyReceipt mr
        JOIN dbo.CrmBooking b     ON b.Id = mr.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.Users u_cr   ON u_cr.id   = mr.CreatedBy
        LEFT JOIN dbo.Users u_appr ON u_appr.id = mr.ApprovedBy
        LEFT JOIN dbo.Users u_bnc  ON u_bnc.id  = mr.BouncedBy
        WHERE mr.Status = 'Pending' AND mr.ReceivedPaymentId IS NULL
      `);
    }

    if (!module || module === "crm-noc") {
      queries.push(`
        SELECT
          'crm-noc'                             AS Module,
          'CRM NOC'                             AS ModuleLabel,
          CAST(n.Id AS NVARCHAR)                AS RecordId,
          n.NocNo                               AS Reference,
          n.CreatedAt                           AS RecordDate,
          n.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          n.LoanAmount                          AS Amount,
          ${NULL_EXTRA}
          CAST(n.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(n.Reason AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(n.UpdatedAt, n.CreatedAt)      AS LastModified
        FROM dbo.CrmNoc n
        JOIN dbo.CrmBooking b     ON b.Id = n.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE n.Status = 'Pending'
      `);
    }

    if (!module || module === "debit-note") {
      queries.push(`
        SELECT
          'debit-note'                          AS Module,
          'Debit Note'                          AS ModuleLabel,
          CAST(dn.id AS NVARCHAR)               AS RecordId,
          ISNULL(dn.DocNo, CONCAT('DN#', CAST(dn.id AS NVARCHAR))) AS Reference,
          dn.DebitDate                          AS RecordDate,
          ISNULL(dn.Status, 'Draft')             AS Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          CONCAT(ISNULL(party.LHeadName, ''), ' — ', ISNULL(eb.EDocNo, '')) AS SupplierName,
          dn.TotalAmount                        AS Amount,
          ${NULL_EXTRA}
          CAST(ISNULL(u.name, CAST(dn.created_by AS NVARCHAR(255))) AS NVARCHAR(255)) AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(dn.Reason AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(dn.updated_at, dn.created_at)  AS LastModified
        FROM dbo.DebitNote dn
        LEFT JOIN dbo.AccountHeadMaster party ON party.LHeadId = dn.supplier_id
        LEFT JOIN dbo.ExpenseBooking eb ON eb.Eid = dn.bill_id
        LEFT JOIN dbo.users u ON u.id = dn.created_by
        WHERE ISNULL(dn.Status, 'Draft') = 'Pending' AND dn.is_active = 1
      `);
    }

    if (!module || module === "contracts") {
      queries.push(`
        SELECT
          'contracts'                           AS Module,
          'Contract'                            AS ModuleLabel,
          CAST(c.ContractId AS NVARCHAR)        AS RecordId,
          ISNULL(c.DocNo, CONCAT('CON#', CAST(c.ContractId AS NVARCHAR))) AS Reference,
          c.DocDate                             AS RecordDate,
          c.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          c.ContactPerson                       AS SupplierName,
          c.ContractAmount                      AS Amount,
          ${NULL_EXTRA}
          CAST(c.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(c.Remarks AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(c.UpdatedAt, c.CreatedAt)      AS LastModified
        FROM dbo.Contract c
        WHERE c.Status = 'Pending'
      `);
    }

    if (!module || module === "crm-booking-amendment") {
      queries.push(`
        SELECT
          'crm-booking-amendment'               AS Module,
          'Booking Amendment'                   AS ModuleLabel,
          CAST(r.Id AS NVARCHAR)                AS RecordId,
          CONCAT(b.BookingNo, ' – ', r.ChangeType, ' ', r.Action) AS Reference,
          r.RequestedAt                         AS RecordDate,
          r.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))           AS Amount,
          ${NULL_EXTRA}
          ISNULL(CAST(u_req.name AS NVARCHAR(255)), CAST(r.RequestedBy AS NVARCHAR(255))) AS CreatedBy,
          ISNULL(CAST(u_rev.name AS NVARCHAR(255)), '') AS ApprovedBy,
          ISNULL(CAST(r.ReviewedAt AS NVARCHAR), '')    AS ApprovedAt,
          ''                                    AS RejectedBy,
          ISNULL(CAST(r.ReviewNotes AS NVARCHAR(MAX)), '') AS RejectionNote,
          r.RequestedAt                         AS LastModified
        FROM dbo.CrmBookingAmendmentRequest r
        JOIN dbo.CrmBooking b     ON b.Id = r.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.Users u_req ON u_req.id = r.RequestedBy
        LEFT JOIN dbo.Users u_rev ON u_rev.id = r.ReviewedBy
        WHERE r.Status = 'Pending'
      `);
    }

    // Was missing entirely — CrmRefund already has a real Pending/Approve/
    // Reject cycle (see crmRefunds.js PUT /:id/approve) using the same
    // shared approvalService.js transition() every other CRM module here
    // uses, but never got a branch in this aggregator, so refunds only ever
    // surfaced via CrmRefunds.tsx's own inline ApprovalActions — invisible
    // to the centralized cross-module inbox every sibling CRM module
    // (cancellations, agreements, brokerage, NOC, booking amendments) is in.
    if (!module || module === "crm-refunds") {
      queries.push(`
        SELECT
          'crm-refunds'                          AS Module,
          'CRM Refund'                           AS ModuleLabel,
          CAST(r.Id AS NVARCHAR)                 AS RecordId,
          r.RefundNo                             AS Reference,
          r.CreatedAt                            AS RecordDate,
          r.Status,
          CAST(NULL AS NVARCHAR)                 AS ContractorName,
          cu.CustomerName                        AS SupplierName,
          r.GrossAmount                          AS Amount,
          ${NULL_EXTRA}
          ISNULL(CAST(rq.name AS NVARCHAR(255)), CAST(r.RequestedBy AS NVARCHAR(255))) AS CreatedBy,
          ISNULL(CAST(ap.name AS NVARCHAR(255)), '') AS ApprovedBy,
          ISNULL(CAST(r.ApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ''                                      AS RejectedBy,
          ISNULL(CAST(r.RejectionNote AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(r.UpdatedAt, r.CreatedAt)        AS LastModified
        FROM dbo.CrmRefund r
        JOIN dbo.CrmCustomer cu ON cu.Id = r.CustomerId
        LEFT JOIN dbo.Users rq ON rq.id = r.RequestedBy
        LEFT JOIN dbo.Users ap ON ap.id = r.ApprovedBy
        WHERE r.Status = 'Pending'
      `);
    }

    // Second, separate approval tier — same gap as crm-refunds above but for
    // the Finance-side step (PUT /:id/finance-approve in crmRefunds.js),
    // which only ever ran from CrmRefunds.tsx's own inline "Finance Approve"
    // button. Kept as its own module (not folded into crm-refunds) because
    // it's a genuinely different gate — CRM checker vs. Finance — exactly
    // like crm-agreement-date is split out from crm-agreements.
    if (!module || module === "crm-refunds-finance") {
      queries.push(`
        SELECT
          'crm-refunds-finance'                  AS Module,
          'CRM Refund (Finance)'                 AS ModuleLabel,
          CAST(r.Id AS NVARCHAR)                 AS RecordId,
          r.RefundNo                             AS Reference,
          r.CreatedAt                            AS RecordDate,
          r.Status,
          CAST(NULL AS NVARCHAR)                 AS ContractorName,
          cu.CustomerName                        AS SupplierName,
          r.NetAmount                            AS Amount,
          ${NULL_EXTRA}
          ISNULL(CAST(rq.name AS NVARCHAR(255)), CAST(r.RequestedBy AS NVARCHAR(255))) AS CreatedBy,
          ISNULL(CAST(ap.name AS NVARCHAR(255)), '') AS ApprovedBy,
          ISNULL(CAST(r.ApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ''                                      AS RejectedBy,
          ISNULL(CAST(r.RejectionNote AS NVARCHAR(MAX)), '') AS RejectionNote,
          ISNULL(r.UpdatedAt, r.CreatedAt)        AS LastModified
        FROM dbo.CrmRefund r
        JOIN dbo.CrmCustomer cu ON cu.Id = r.CustomerId
        LEFT JOIN dbo.Users rq ON rq.id = r.RequestedBy
        LEFT JOIN dbo.Users ap ON ap.id = r.ApprovedBy
        WHERE r.Status = 'FinancePending'
      `);
    }

  return queries;
}

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const queries = buildInboxQueries(req.query.module);
    if (queries.length === 0) return res.json([]);

    const fullQuery =
      queries.join(" UNION ALL ") + " ORDER BY LastModified DESC";
    const result = await pool.request().query(fullQuery);

    res.json(await filterVisibleToViewer(result.recordset, req));
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox error");
    res.status(500).json({
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal Server Error",
    });
  }
});

// GET /api/approval-inbox/count — lightweight badge count.
// Runs the exact same query + visibility filter as GET / and returns just
// the length — previously a separate raw SQL aggregate that counted every
// Pending row system-wide, which meant the badge (unlike the list once
// filterVisibleToViewer landed there) still showed a count that included
// records the viewer had no part in and couldn't act on.
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const queries = buildInboxQueries(undefined);
    if (queries.length === 0) return res.json({ count: 0 });

    const fullQuery = queries.join(" UNION ALL ");
    const result = await pool.request().query(fullQuery);
    const visible = await filterVisibleToViewer(result.recordset, req);
    res.json({ count: visible.length });
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox count error");
    res.json({ count: 0 });
  }
});

module.exports = router;

