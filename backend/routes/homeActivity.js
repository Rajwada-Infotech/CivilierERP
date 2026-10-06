const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { usersHaveCreatedBy } = require("../services/usersCreatedBy");
const { MODULES, rankModules, pickWidgets } = require("../services/moduleUsage");

// ── Personalised widgets ─────────────────────────────────────────────────────
// POST /usage records that the caller just worked in a module; GET /widgets
// returns the metric widgets for the modules they use most and most recently.
// Not cached: the answer is per user.
router.post("/usage", async (req, res) => {
  const userId = parseInt(req.user?.userId ?? req.user?.id, 10);
  const module = String(req.body?.module || "");
  if (!Number.isFinite(userId)) return res.status(401).json({ error: "Not authenticated" });
  if (!MODULES.includes(module)) return res.status(400).json({ error: "Unknown module" });
  try {
    const pool = getPool();
    await pool.request()
      .input("userId", sql.Int, userId)
      .input("module", sql.NVarChar(40), module)
      .query(`
        MERGE dbo.UserModuleUsage AS t
        USING (SELECT @userId AS UserId, @module AS Module) AS s
          ON t.UserId = s.UserId AND t.Module = s.Module
        WHEN MATCHED THEN UPDATE SET VisitCount = t.VisitCount + 1, LastVisitedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (UserId, Module, VisitCount, LastVisitedAt) VALUES (s.UserId, s.Module, 1, SYSUTCDATETIME());
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[homeActivity] POST /usage:", err.message);
    res.status(500).json({ error: "Failed to record usage" });
  }
});

router.get("/widgets", async (req, res) => {
  const userId = parseInt(req.user?.userId ?? req.user?.id, 10);
  if (!Number.isFinite(userId)) return res.status(401).json({ error: "Not authenticated" });
  const allowedModules = req.query.modules
    ? String(req.query.modules).split(",").map((m) => m.trim()).filter((m) => MODULES.includes(m))
    : null;
  try {
    const pool = getPool();
    const r = await pool.request().input("userId", sql.Int, userId).query(`
      SELECT Module AS module, VisitCount AS visitCount, LastVisitedAt AS lastVisitedAt
      FROM dbo.UserModuleUsage WHERE UserId = @userId
    `);
    const { CATALOG } = require("./widgetMetrics");
    res.json(pickWidgets(CATALOG, rankModules(r.recordset), allowedModules));
  } catch (err) {
    console.error("[homeActivity] GET /widgets:", err.message);
    res.status(500).json({ error: "Failed to load widgets" });
  }
});

// ── Lightweight sales summary for Home dashboard ─────────────────────────────
// Returns only SQL-aggregated scalars — no row transfer — so the home page
// doesn't have to pull 500+ sale order rows just to count/sum them.
router.get("/sales-summary", cache("home-sales-summary", 120), async (req, res) => {
  try {
    const pool = getPool();
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const result = await pool.request()
      .input("monthPrefix", sql.NVarChar(7), monthPrefix)
      .query(`
        SELECT
          COUNT(*)                                                                AS total,
          COUNT(CASE WHEN Status NOT IN ('Deleted','Cancelled') THEN 1 END)      AS active,
          COUNT(CASE WHEN LOWER(ISNULL(Status,'')) LIKE '%approved%'
                          AND Status NOT IN ('Deleted','Cancelled') THEN 1 END)  AS approved,
          COUNT(CASE WHEN LOWER(ISNULL(Status,'')) IN ('pending','draft')
                          AND Status NOT IN ('Deleted','Cancelled') THEN 1 END)  AS pendingApproval,
          ISNULL(SUM(CASE WHEN LEFT(CONVERT(VARCHAR(10),
                            COALESCE(OrderDate, CreatedAt, '2000-01-01'), 120), 7) = @monthPrefix
                          AND Status NOT IN ('Deleted','Cancelled')
                          THEN ISNULL(TotalAmount,0) ELSE 0 END), 0)             AS thisMonthAmount,
          ISNULL(SUM(CASE WHEN Status NOT IN ('Deleted','Cancelled')
                          THEN ISNULL(TotalAmount,0) ELSE 0 END), 0)             AS totalAmount
        FROM dbo.SaleOrders
      `);
    const row = result.recordset[0] ?? {};
    res.json({
      total:          row.total          ?? 0,
      approved:       row.approved       ?? 0,
      pendingApproval:row.pendingApproval ?? 0,
      thisMonthAmount:row.thisMonthAmount ?? 0,
      totalAmount:    row.totalAmount    ?? 0,
    });
  } catch (err) {
    console.error("[homeActivity] GET /sales-summary:", err.message);
    res.status(500).json({ error: err.message });
  }
});


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
        /*USER_ACTOR*/NULL AS Actor,
        CAST(NULL AS DECIMAL(18,2)) AS Amount,
        CASE WHEN ISNULL(u.discontinue, 0) = 1 THEN 'Inactive' ELSE 'Active' END AS Status,
        CAST(COALESCE(u.created_datetime, '2000-01-01') AS DATETIME2) AS At,
        '/admin' AS Href
      FROM dbo.users u
      ORDER BY u.id DESC`,
  },
};

// Who added a user, when the column exists (migration 535); otherwise the feed shows no actor.
const USER_ACTOR_SQL =
  "(SELECT TOP 1 COALESCE(NULLIF(cu.name, ''), cu.email) FROM dbo.users cu WHERE cu.id = u.CreatedBy)";
const sourceSql = (s, hasCreatedBy) =>
  s.sql.replace("/*USER_ACTOR*/NULL", hasCreatedBy ? USER_ACTOR_SQL : "NULL");

router.get("/activity-feed", cache("home-activity-feed", 45), async (req, res) => {
  try {
    const pool = getPool();

    const limit = Math.min(80, Math.max(10, parseInt(req.query.limit, 10) || 40));
    // ?modules=finance,material,... — empty/absent = all (privileged view)
    const requested = String(req.query.modules || "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);
    const allow = requested.length ? new Set(requested) : null;

    const hasCreatedBy = await usersHaveCreatedBy(pool);
    const branches = Object.values(SOURCES)
      .filter((s) => !allow || allow.has(s.module))
      .map((s) => `SELECT * FROM (${sourceSql(s, hasCreatedBy)}) x`);

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

// ── Per-day totals for the "Actions this week" charts ────────────────────────
// Counts and rupee value of everything created on each of the last 7 days
// (India days, UTC+5:30), across the same module sources as the feed. The feed
// itself is only the newest ~50 rows, which spans a day or two on a busy site —
// charting that made every earlier day read zero — so this aggregates in SQL
// instead. Each source contributes up to PER_SOURCE of its newest rows (a
// week of activity in any one table is far below that), then they are bucketed
// by day.
const WEEK_PER_SOURCE = 3000;
const IST_MINUTES = 330;

router.get("/activity-week", cache("home-activity-week", 60), async (req, res) => {
  try {
    const pool = getPool();
    const requested = String(req.query.modules || "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);
    const allow = requested.length ? new Set(requested) : null;

    // The last 7 India calendar days, oldest first, as "YYYY-MM-DD".
    const istNow = new Date(Date.now() + IST_MINUTES * 60_000);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(istNow);
      d.setUTCDate(d.getUTCDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });

    const hasCreatedBy = await usersHaveCreatedBy(pool);
    const branches = Object.values(SOURCES)
      .filter((s) => !allow || allow.has(s.module))
      .map((s) => `SELECT * FROM (${sourceSql(s, hasCreatedBy)}) x`);
    if (!branches.length) {
      return res.json({ days: days.map((date) => ({ date, count: 0, amount: 0 })) });
    }

    // Stamps are the database clock (UTC): shift to IST before taking the date.
    // Start a day early so IST-day edges are never cut off.
    const from = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    const result = await pool.request()
      .input("perSource", sql.Int, WEEK_PER_SOURCE)
      .input("from", sql.DateTime2, from)
      .query(`
        SELECT CAST(DATEADD(MINUTE, ${IST_MINUTES}, feed.At) AS DATE) AS Day,
               COUNT(*) AS Cnt,
               ISNULL(SUM(feed.Amount), 0) AS Amt
        FROM (
          ${branches.join(" UNION ALL ")}
        ) feed
        WHERE feed.At >= @from
        GROUP BY CAST(DATEADD(MINUTE, ${IST_MINUTES}, feed.At) AS DATE)`);

    const byDay = new Map(
      result.recordset.map((r) => [new Date(r.Day).toISOString().slice(0, 10), r]),
    );
    res.json({
      days: days.map((date) => ({
        date,
        count: Number(byDay.get(date)?.Cnt || 0),
        amount: Math.round(Number(byDay.get(date)?.Amt || 0)),
      })),
    });
  } catch (err) {
    console.error("[homeActivity] GET /activity-week:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
