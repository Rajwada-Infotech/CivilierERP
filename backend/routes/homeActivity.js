const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");

// ── Universal "recent activity" feed ────────────────────────────────────────
// One normalized row per recently-created transactional record, UNIONed
// across every core module table, ordered newest-first. Each branch is
// gated by the caller's ?modules= list (the same access flags the Home
// page already computes) so a user only sees activity for modules they can
// open. Add a new module by appending one SOURCES entry — no other change.
//
// Normalized shape (every branch must SELECT these columns in this order):
//   Kind, Module, DocNo, Title, Subtitle, Actor, Amount, Status, At, Href

const SOURCES = {
  // ── Finance ──────────────────────────────────────────────────────────────
  finance_payment: {
    module: "finance",
    sql: `
      SELECT TOP (@perSource)
        'payment' AS Kind, 'finance' AS Module,
        p.DocNo AS DocNo,
        CONCAT('Payment ', ISNULL(p.DocNo, CONCAT('#', p.PPaymentID))) AS Title,
        CONCAT(ISNULL(p.PPaymentName, '—'), ' · ', ISNULL(p.PMode, '')) AS Subtitle,
        p.PCreatedBy AS Actor,
        CAST(p.PAmount AS DECIMAL(18,2)) AS Amount,
        p.Status AS Status,
        CAST(COALESCE(p.PCreatedAt, p.PDate, '2000-01-01') AS DATETIME2) AS At,
        '/payments' AS Href
      FROM dbo.NewPayment p
      ORDER BY p.PPaymentID DESC`,
  },
  finance_receipt: {
    module: "finance",
    sql: `
      SELECT TOP (@perSource)
        'receipt' AS Kind, 'finance' AS Module,
        r.RPDocNo AS DocNo,
        CONCAT('Received ', ISNULL(r.RPDocNo, CONCAT('#', r.RPPaymentID))) AS Title,
        CONCAT(ISNULL(r.RPReceivedFrom, '—'), ' · ', ISNULL(r.RPMode, '')) AS Subtitle,
        NULL AS Actor,
        CAST(r.RPAmount AS DECIMAL(18,2)) AS Amount,
        r.RPStatus AS Status,
        CAST(COALESCE(r.RPCreatedAt, r.RPDocDate, '2000-01-01') AS DATETIME2) AS At,
        '/received-payments' AS Href
      FROM dbo.ReceivedPayment r
      ORDER BY r.RPPaymentID DESC`,
  },
  finance_jv: {
    module: "finance",
    sql: `
      SELECT TOP (@perSource)
        'journal' AS Kind, 'finance' AS Module,
        jv.JVNo AS DocNo,
        CONCAT('Journal Voucher ', ISNULL(jv.JVNo, CONCAT('#', jv.JVID))) AS Title,
        LEFT(ISNULL(jv.Narration, '—'), 120) AS Subtitle,
        jv.CreatedBy AS Actor,
        CAST((SELECT SUM(DebitAmount) FROM dbo.JournalVoucherLines WHERE JVID = jv.JVID) AS DECIMAL(18,2)) AS Amount,
        jv.Status AS Status,
        CAST(COALESCE(jv.CreatedAt, jv.JVDate, '2000-01-01') AS DATETIME2) AS At,
        '/journal-voucher' AS Href
      FROM dbo.JournalVoucher jv
      ORDER BY jv.JVID DESC`,
  },

  // ── Material / Procurement ───────────────────────────────────────────────
  material_grn: {
    module: "material",
    sql: `
      SELECT TOP (@perSource)
        'grn' AS Kind, 'material' AS Module,
        grn.GRNNo AS DocNo,
        CONCAT('GRN ', ISNULL(grn.GRNNo, CONCAT('#', grn.GRNID))) AS Title,
        ISNULL(s.LHeadName, '—') AS Subtitle,
        NULL AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        grn.Status AS Status,
        CAST(COALESCE(grn.CreatedDate, grn.GRNDate, '2000-01-01') AS DATETIME2) AS At,
        '/goods-receipt-notes' AS Href
      FROM dbo.GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
      ORDER BY grn.GRNID DESC`,
  },
  material_po: {
    module: "material",
    sql: `
      SELECT TOP (@perSource)
        'po' AS Kind, 'material' AS Module,
        po.PurchaseOrderNo AS DocNo,
        CONCAT('Purchase Order ', ISNULL(po.PurchaseOrderNo, CONCAT('#', po.PurchaseOrderID))) AS Title,
        ISNULL(ah.LHeadName, '—') AS Subtitle,
        po.CreatedBy AS Actor,
        CAST(po.TotalAmount AS DECIMAL(18,2)) AS Amount,
        po.Status AS Status,
        CAST(COALESCE(po.CreatedAt, po.PODate, '2000-01-01') AS DATETIME2) AS At,
        '/purchase-orders' AS Href
      FROM dbo.PurchaseOrders po
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
      ORDER BY po.PurchaseOrderID DESC`,
  },
  material_expense: {
    module: "material",
    sql: `
      SELECT TOP (@perSource)
        'expense' AS Kind, 'material' AS Module,
        eb.EDocNo AS DocNo,
        CONCAT('Expense ', ISNULL(eb.EDocNo, CONCAT('#', eb.Eid))) AS Title,
        ISNULL(ah.LHeadName, ISNULL(eb.EProjectName, '—')) AS Subtitle,
        NULL AS Actor,
        CAST(eb.EAmount AS DECIMAL(18,2)) AS Amount,
        eb.EStatus AS Status,
        CAST(COALESCE(eb.ECreatedAt, eb.EDocDate, '2000-01-01') AS DATETIME2) AS At,
        '/expense-booking' AS Href
      FROM dbo.ExpenseBooking eb
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = eb.LHeadId
      WHERE ISNULL(eb.EStatus, '') <> 'Draft'
      ORDER BY eb.Eid DESC`,
  },
  material_wo: {
    module: "material",
    sql: `
      SELECT TOP (@perSource)
        'workorder' AS Kind, 'engineering' AS Module,
        h.DocumentNumber AS DocNo,
        CONCAT('Work Order ', ISNULL(h.DocumentNumber, CONCAT('#', h.Id))) AS Title,
        ISNULL(con.LHeadName, ISNULL(ep.name, '—')) AS Subtitle,
        NULL AS Actor,
        CAST(h.TotalAmount AS DECIMAL(18,2)) AS Amount,
        h.Status AS Status,
        CAST(COALESCE(h.DocumentDate, '2000-01-01') AS DATETIME2) AS At,
        '/work-orders' AS Href
      FROM dbo.WorkOrderHeader h
      LEFT JOIN dbo.enterprise ep ON ep.id = h.ProjectId
      LEFT JOIN dbo.AccountHeadMaster con ON con.LHeadId = h.ContractorId
      ORDER BY h.Id DESC`,
  },

  // ── Sales ────────────────────────────────────────────────────────────────
  sales_order: {
    module: "sales",
    sql: `
      SELECT TOP (@perSource)
        'saleorder' AS Kind, 'sales' AS Module,
        so.DocNo AS DocNo,
        CONCAT('Sale Order ', ISNULL(so.DocNo, CONCAT('#', so.SaleOrderID))) AS Title,
        ISNULL(tc.name, '—') AS Subtitle,
        NULL AS Actor,
        CAST(so.TotalAmount AS DECIMAL(18,2)) AS Amount,
        so.Status AS Status,
        CAST(COALESCE(so.CreatedAt, so.OrderDate, '2000-01-01') AS DATETIME2) AS At,
        '/sales/sale-order' AS Href
      FROM dbo.SaleOrders so
      LEFT JOIN dbo.enterprise tc ON tc.id = so.ToCompanyID
      ORDER BY so.SaleOrderID DESC`,
  },
  sales_invoice: {
    module: "sales",
    sql: `
      SELECT TOP (@perSource)
        'saleinvoice' AS Kind, 'sales' AS Module,
        si.SaleInvoiceNo AS DocNo,
        CONCAT('Sale Invoice ', ISNULL(si.SaleInvoiceNo, CONCAT('#', si.SaleInvoiceID))) AS Title,
        ISNULL(ah.LHeadName, '—') AS Subtitle,
        NULL AS Actor,
        CAST(si.Amount AS DECIMAL(18,2)) AS Amount,
        si.PaymentStatus AS Status,
        CAST(COALESCE(si.CreatedAt, si.InvoiceDate, '2000-01-01') AS DATETIME2) AS At,
        '/sales/sale-invoice' AS Href
      FROM dbo.SaleInvoices si
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = si.CustomerID
      WHERE ISNULL(si.IsDeleted, 0) = 0
      ORDER BY si.SaleInvoiceID DESC`,
  },

  // ── CRM ──────────────────────────────────────────────────────────────────
  crm_booking: {
    module: "crm",
    sql: `
      SELECT TOP (@perSource)
        'booking' AS Kind, 'crm' AS Module,
        b.BookingNo AS DocNo,
        CONCAT('Booking ', ISNULL(b.BookingNo, CONCAT('#', b.Id))) AS Title,
        ISNULL(pr.name, '—') AS Subtitle,
        NULL AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        b.Status AS Status,
        CAST(COALESCE(b.CreatedAt, '2000-01-01') AS DATETIME2) AS At,
        '/crm/dashboard' AS Href
      FROM dbo.CrmBooking b
      LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
      ORDER BY b.Id DESC`,
  },

  // ── Tickets ──────────────────────────────────────────────────────────────
  ticket_new: {
    module: "ticket",
    sql: `
      SELECT TOP (@perSource)
        'ticket' AS Kind, 'ticket' AS Module,
        CONCAT('#', t.id) AS DocNo,
        CONCAT('Ticket #', t.id, ' — ', LEFT(ISNULL(t.subject, 'Untitled'), 80)) AS Title,
        CONCAT(ISNULL(t.customer_name, '—'), ' · ', ISNULL(t.priority, '')) AS Subtitle,
        t.created_by AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        t.status AS Status,
        CAST(COALESCE(t.created_at, '2000-01-01') AS DATETIME2) AS At,
        '/ticket' AS Href
      FROM dbo.tickets t
      ORDER BY t.id DESC`,
  },

  // ── Follow-Up / Task Master ──────────────────────────────────────────────
  task_new: {
    module: "followup",
    sql: `
      SELECT TOP (@perSource)
        'task' AS Kind, 'followup' AS Module,
        t.TaskNo AS DocNo,
        CONCAT('Task ', ISNULL(t.TaskNo, CONCAT('#', t.Id)), ' — ', LEFT(ISNULL(t.Subject, ''), 70)) AS Title,
        CONCAT(ISNULL(t.Priority, ''), ' · ', ISNULL(au.name, 'Unassigned')) AS Subtitle,
        cu.name AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        t.Status AS Status,
        CAST(COALESCE(t.CreatedAt, '2000-01-01') AS DATETIME2) AS At,
        '/followup' AS Href
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
      WHERE ISNULL(t.IsDeleted, 0) = 0
      ORDER BY t.Id DESC`,
  },

  // ── Fixed Asset ──────────────────────────────────────────────────────────
  fa_record: {
    module: "fixedasset",
    sql: `
      SELECT TOP (@perSource)
        'fa_record' AS Kind, 'fixedasset' AS Module,
        fa.DocNo AS DocNo,
        CONCAT('Fixed Asset ', ISNULL(fa.DocNo, fa.AssetCode)) AS Title,
        CONCAT(ISNULL(fa.AssetName, '—'), ' · ', ISNULL(fa.AssetCategory, '')) AS Subtitle,
        fa.CreatedBy AS Actor,
        CAST(fa.PurchaseCost AS DECIMAL(18,2)) AS Amount,
        fa.AssetStatus AS Status,
        CAST(COALESCE(fa.CreatedAt, '2000-01-01') AS DATETIME2) AS At,
        '/fixed-asset/record' AS Href
      FROM dbo.FixedAssetRecord fa
      WHERE fa.AssetCode IS NOT NULL AND fa.Status <> 'Deleted'
      ORDER BY fa.AssetId DESC`,
  },
  fa_assignment: {
    module: "fixedasset",
    sql: `
      SELECT TOP (@perSource)
        'fa_assignment' AS Kind, 'fixedasset' AS Module,
        a.DocNo AS DocNo,
        CONCAT('Assignment ', ISNULL(a.DocNo, CONCAT('#', a.AssignmentId))) AS Title,
        CONCAT(ISNULL(fa.FAItemCode, '—'), ' → ', ISNULL(u.name, '—')) AS Subtitle,
        a.CreatedBy AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        a.Status AS Status,
        CAST(COALESCE(a.CreatedAt, a.DocDate, '2000-01-01') AS DATETIME2) AS At,
        '/fixed-asset/assignment' AS Href
      FROM dbo.FixedAssetAssignment a
      LEFT JOIN dbo.users u ON u.id = a.UserId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = a.AssetId
      WHERE a.Status <> 'Deleted'
      ORDER BY a.AssignmentId DESC`,
  },
  fa_transfer: {
    module: "fixedasset",
    sql: `
      SELECT TOP (@perSource)
        'fa_transfer' AS Kind, 'fixedasset' AS Module,
        h.DocNo AS DocNo,
        CONCAT('Asset Transfer ', ISNULL(h.DocNo, CONCAT('#', h.Id))) AS Title,
        CONCAT(ISNULL(fu.name, '—'), ' → ', ISNULL(tu.name, '—')) AS Subtitle,
        NULL AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        h.Status AS Status,
        CAST(COALESCE(h.CreatedAt, h.TransferDate, '2000-01-01') AS DATETIME2) AS At,
        '/fixed-asset/transfer' AS Href
      FROM dbo.AssetTransferHistory h
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      WHERE h.Status <> 'Deleted'
      ORDER BY h.Id DESC`,
  },
  fa_quality: {
    module: "fixedasset",
    sql: `
      SELECT TOP (@perSource)
        'fa_quality' AS Kind, 'fixedasset' AS Module,
        q.DocNo AS DocNo,
        CONCAT('Quality Check ', ISNULL(q.DocNo, CONCAT('#', q.QualityCheckId))) AS Title,
        CONCAT(ISNULL(q.FAItemCode, '—'), ' · ', ISNULL(q.QualityStatus, '')) AS Subtitle,
        q.CreatedBy AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        q.FollowUpStatus AS Status,
        CAST(COALESCE(q.CreatedAt, q.DocDate, '2000-01-01') AS DATETIME2) AS At,
        '/fixed-asset/quality-check' AS Href
      FROM dbo.FixedAssetQualityCheck q
      WHERE q.Status <> 'Deleted'
      ORDER BY q.QualityCheckId DESC`,
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  admin_user: {
    module: "admin",
    sql: `
      SELECT TOP (@perSource)
        'user' AS Kind, 'admin' AS Module,
        NULL AS DocNo,
        CONCAT('User added — ', u.name) AS Title,
        ISNULL((SELECT TOP 1 r.RName FROM dbo.Role r WHERE r.RId = u.RoleId), u.email) AS Subtitle,
        NULL AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        CASE WHEN ISNULL(u.discontinue, 0) = 1 THEN 'Inactive' ELSE 'Active' END AS Status,
        CAST(COALESCE(u.created_datetime, '2000-01-01') AS DATETIME2) AS At,
        '/admin' AS Href
      FROM dbo.users u
      ORDER BY u.id DESC`,
  },
};

router.get("/", cache("home-activity-feed", 45), async (req, res) => {
  try {
    const pool = getPool();

    const limit = Math.min(80, Math.max(10, parseInt(req.query.limit, 10) || 40));
    // ?modules=finance,material,... — empty/absent = all (privileged view)
    const requested = String(req.query.modules || "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);
    const allow = requested.length ? new Set(requested) : null;

    const branches = Object.values(SOURCES)
      .filter((s) => !allow || allow.has(s.module))
      .map((s) => `SELECT * FROM (${s.sql}) x`);

    if (!branches.length) return res.json({ items: [] });

    const perSource = Math.max(8, Math.ceil(limit / 2));
    const unionSql = `
      SELECT TOP (@limit) *
      FROM (
        ${branches.join("\n        UNION ALL\n        ")}
      ) feed
      ORDER BY At DESC`;

    const result = await pool.request()
      .input("limit", sql.Int, limit)
      .input("perSource", sql.Int, perSource)
      .query(unionSql);

    res.json({ items: result.recordset });
  } catch (err) {
    console.error("[homeActivity] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
