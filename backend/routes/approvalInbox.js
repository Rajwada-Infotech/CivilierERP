const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const logger = require("../logger");
const { getPool } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

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

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const { module } = req.query;

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
          PPaymentName                         AS Reference,
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
          ISNULL(CAST(jv.Narration AS NVARCHAR(MAX)), '') AS RejectionNote,
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

    // Application verification — reinstated. The verifier here is checking
    // the full data entry itself (not a downstream Booking), so this reads
    // straight off CrmApplication, before any Booking exists. Reject (with
    // a mandatory note — see crmApplications.js PUT /:id/reject) is the
    // "revert to fill/re-check" action; the applicant edits and resubmits
    // via PUT /:id/submit, which loops back here until level 1 clears.
    if (!module || module === "crm-applications") {
      queries.push(`
        SELECT
          'crm-applications'                    AS Module,
          'CRM Application'                     AS ModuleLabel,
          CAST(a.Id AS NVARCHAR)                AS RecordId,
          a.ApplicationNo                       AS Reference,
          a.CreatedAt                           AS RecordDate,
          a.Status,
          CAST(NULL AS NVARCHAR)                AS ContractorName,
          a.ApplicantName                       AS SupplierName,
          a.BookingAmount                       AS Amount,
          ${NULL_EXTRA}
          CAST(a.CreatedBy AS NVARCHAR(255))    AS CreatedBy,
          ''                                    AS ApprovedBy,
          ''                                    AS ApprovedAt,
          ISNULL((
            SELECT TOP 1 CAST(ApproverEmail AS NVARCHAR(255))
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'CrmApplication' AND RecordId = a.Id
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                AS RejectedBy,
          ISNULL((
            SELECT TOP 1 CAST(Note AS NVARCHAR(MAX))
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'CrmApplication' AND RecordId = a.Id
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                AS RejectionNote,
          ISNULL(a.UpdatedAt, a.CreatedAt)      AS LastModified
        FROM dbo.CrmApplication a
        WHERE a.Status = 'Pending' AND a.IsActive = 1
      `);
    }

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

    if (queries.length === 0) return res.json([]);

    const fullQuery =
      queries.join(" UNION ALL ") + " ORDER BY LastModified DESC";
    const result = await pool.request().query(fullQuery);

    res.json(result.recordset);
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

// GET /api/approval-inbox/count — lightweight badge count
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders      WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader    WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.NewPayment         WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ReceivedPayment    WHERE RPStatus = 'Pending') +
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes  WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ExpenseBooking     WHERE EStatus = 'Pending'
          AND NOT (ISNULL(ESourceType,'') = 'GRN' AND ISNULL(ERemarks,'') LIKE 'Auto-created for remaining items from GRN%')) +
        (SELECT COUNT(*) FROM dbo.WorkDone           WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.BOQ                WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.MaterialRequests   WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.MaterialIssues     WHERE ISNULL(Status,'Pending') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.SaleOrders         WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.VehicleInOut       WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.JournalVoucher     WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.InterCompanyTransfer WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.FundTransfer       WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.CrmApplication     WHERE Status = 'Pending' AND IsActive = 1) +
        (SELECT COUNT(*) FROM dbo.CrmBooking         WHERE Status = 'Pending' AND IsActive = 1 AND ReadyForApprovalAt IS NOT NULL) +
        (SELECT COUNT(*) FROM dbo.CrmAgreement       WHERE SeniorApprovalStatus = 'Pending') +
        (SELECT COUNT(*) FROM dbo.CrmAgreement       WHERE DateApprovalStatus = 'Pending') +
        (SELECT COUNT(*) FROM dbo.CrmBrokerageMaster WHERE Status = 'Pending' AND IsLocked = 0) +
        (SELECT COUNT(*) FROM dbo.CrmCancellation    WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.CrmNoc             WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.Contract           WHERE Status = 'Pending')
      AS TotalPending
    `);
    res.json({ count: result.recordset[0].TotalPending ?? 0 });
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox count error");
    res.status(500).json({
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal Server Error",
    });
  }
});

module.exports = router;

