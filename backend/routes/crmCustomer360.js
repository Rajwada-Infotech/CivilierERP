const express = require("express");
const { sumMoney } = require("../services/bookingUnits");
const { getMilestoneMoneyStages } = require("../services/crmOnAccountCoverage");
const { CrmStatus, DEAD_BOOKING_STATUSES, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { projectPredicate, crmCustomerGuard } = require("../services/projectScope");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
// Project access: a customer opens only if one of their applications is in the user's projects.
router.param("id", crmCustomerGuard);
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyPagination } = require("../services/crmListPagination");

router.use(authMiddleware);

// GET / — the Applicant Ledger's customer list: every customer with a
// rolled-up application/booking count and financial position, searchable by
// name/mobile/customer no. Same TotalOutstanding formula as crmCustomers.js's
// detail view (Waived milestones don't count as still-owed; a Cancelled/
// Rejected booking's balance isn't real collectible debt) so the two pages
// never disagree on what a customer actually owes.
// The list's sortable columns: sortKey → a column of the list row (x below).
const C360_SORT = {
  CreatedAt: "x.CreatedAt",
  CustomerName: "x.CustomerName",
  CustomerNo: "x.CustomerNo",
  City: "x.City",
  ApplicationCount: "x.ApplicationCount",
  ActiveBookingCount: "x.ActiveBookingCount",
  TotalPaid: "x.TotalPaid",
  TotalOutstanding: "x.TotalOutstanding",
};
// The list's saved views: view → which list rows it keeps. The summary counts each one with the same test.
const C360_VIEWS = {
  all: "1 = 1",
  due: "x.TotalOutstanding > 0",
  clear: "x.ActiveBookingCount > 0 AND x.TotalOutstanding <= 0",
  nobooking: "x.ActiveBookingCount = 0",
};

// Each listed customer's live units (project · unit), read for the given rows only, in batches that stay under
// SQL Server's 2,100-parameter limit (the export can list every customer).
async function attachUnits(pool, rows, scopeApp) {
  const byCustomer = new Map();
  for (let at = 0; at < rows.length; at += 1000) {
    const ur = pool.request();
    const ids = rows.slice(at, at + 1000).map((r, i) => { ur.input(`c${i}`, sql.Int, r.Id); return `@c${i}`; }).join(",");
    const units = await ur.query(`
      SELECT a.CustomerId, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE a.CustomerId IN (${ids}) AND b.Status NOT IN ${DEAD_BOOKING_SQL} ${scopeApp}
      ORDER BY b.CreatedAt DESC`);
    for (const u of units.recordset) {
      if (!byCustomer.has(u.CustomerId)) byCustomer.set(u.CustomerId, []);
      byCustomer.get(u.CustomerId).push({ ProjectName: u.ProjectName, UnitNo: u.UnitNo });
    }
  }
  for (const r of rows) r.Units = byCustomer.get(r.Id) || [];
}

router.get("/", requirePageRight("crm-customer-360", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { search } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const view = Object.hasOwn(C360_VIEWS, req.query.status) ? req.query.status : "all";
    const conds = ["c.IsActive = 1"];
    const inputs = [];
    // A restricted user sees customers with an application in their projects.
    if (req.projectScope) conds.push(`EXISTS (SELECT 1 FROM dbo.CrmApplication sa WHERE sa.CustomerId = c.Id ${projectPredicate(req.projectScope, "sa.ProjectId")})`);
    if (search) {
      inputs.push(["srch", sql.NVarChar(200), `%${search}%`]);
      conds.push("(c.CustomerName LIKE @srch OR c.Mobile LIKE @srch OR c.CustomerNo LIKE @srch)");
    }
    // Matched by the real CustomerId foreign key, not Mobile string equality: a customer with a blank Mobile
    // (optional since migration 445) would otherwise lose every application, booking and payment.
    if (companyId) { inputs.push(["companyId", sql.Int, companyId]); conds.push("EXISTS (SELECT 1 FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id AND a.CompanyId = @companyId)"); }
    if (projectId) { inputs.push(["projectId", sql.Int, projectId]); conds.push("EXISTS (SELECT 1 FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id AND a.ProjectId = @projectId)"); }
    if (blockId) { inputs.push(["blockId", sql.Int, blockId]); conds.push("(EXISTS (SELECT 1 FROM dbo.CrmApplication a JOIN dbo.UnitMaster um ON um.Id = a.PreferredUnitId WHERE a.CustomerId = c.Id AND um.BlockId = @blockId) OR EXISTS (SELECT 1 FROM dbo.CrmApplication a2 JOIN dbo.CrmApplicationPlot ap ON ap.ApplicationId = a2.Id AND ap.Status = N'Active' JOIN dbo.PlotMaster pm ON pm.Id = ap.PlotId WHERE a2.CustomerId = c.Id AND pm.BlockId = @blockId))"); }
    const newReq = () => { const r = pool.request(); for (const [n, t, v] of inputs) r.input(n, t, v); return r; };
    const scopeApp = req.projectScope ? projectPredicate(req.projectScope, "a.ProjectId") : "";
    // One row per customer; the views, the sort and the summary all read these columns.
    const LIST = `
      SELECT
        c.Id, c.CustomerNo, c.CustomerName, c.Mobile, c.City, c.State, c.CreatedAt,
        (SELECT COUNT(*) FROM dbo.CrmApplication a WHERE a.CustomerId = c.Id ${scopeApp}) AS ApplicationCount,
        (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE a.CustomerId = c.Id AND b.Status NOT IN ${DEAD_BOOKING_SQL} ${scopeApp}) AS ActiveBookingCount,
        -- Includes each booking's unswept On Account balance alongside milestone AmountPaid: every payment
        -- holds On Account until an explicit sweep, so AmountPaid alone would under-report cash received.
        ((SELECT ISNULL(SUM(ISNULL(m.AmountPaid, 0)), 0)
          FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE a.CustomerId = c.Id AND b.Status NOT IN ${DEAD_BOOKING_SQL} ${scopeApp})
        + (SELECT ISNULL(SUM(CASE WHEN ISNULL(oa.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND oa.Amount > ISNULL(oa.AppliedAmount,0) THEN oa.Amount - ISNULL(oa.AppliedAmount,0) ELSE 0 END), 0)
          FROM dbo.CrmOnAccountPayment oa JOIN dbo.CrmBooking b ON b.Id = oa.BookingId JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE a.CustomerId = c.Id AND b.Status NOT IN ${DEAD_BOOKING_SQL} ${scopeApp})) AS TotalPaid,
        (SELECT ISNULL(SUM(CASE WHEN m.Status NOT IN ('${CrmStatus.PAID}', 'Waived') THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END), 0)
          FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE a.CustomerId = c.Id AND b.Status NOT IN ${DEAD_BOOKING_SQL} ${scopeApp}) AS TotalOutstanding
      FROM dbo.CrmCustomer c
      WHERE ${conds.join(" AND ")}
    `;
    const sortCol = Object.hasOwn(C360_SORT, req.query.sortKey) ? C360_SORT[req.query.sortKey] : C360_SORT.CreatedAt;
    const dir = req.query.sortDir === "asc" ? "ASC" : "DESC";
    const ORDER = `ORDER BY ${sortCol} ${dir}, x.Id DESC`;
    const VIEW_WHERE = `WHERE ${C360_VIEWS[view]}`;

    // No page: every matching row (the Excel export).
    if (!req.query.page) {
      const result = await newReq().query(`SELECT x.* FROM (${LIST}) x ${VIEW_WHERE} ${ORDER}`);
      await attachUnits(pool, result.recordset, scopeApp);
      return res.json(result.recordset);
    }

    const { page, pageSize, offset } = applyPagination(req);
    const viewCounts = Object.entries(C360_VIEWS)
      .map(([k, cond]) => `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS View_${k}`).join(", ");
    const [result, summaryResult] = await Promise.all([
      newReq().input("offset", sql.Int, offset).input("pageSize", sql.Int, pageSize)
        .query(`SELECT x.* FROM (${LIST}) x ${VIEW_WHERE} ${ORDER} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      // Each view's count and the money across the current view: the view tabs and the totals strip.
      newReq().query(`
        SELECT ${viewCounts},
               SUM(CASE WHEN ${C360_VIEWS[view]} THEN x.TotalPaid ELSE 0 END) AS totalPaid,
               SUM(CASE WHEN ${C360_VIEWS[view]} THEN x.TotalOutstanding ELSE 0 END) AS totalOutstanding,
               SUM(CASE WHEN ${C360_VIEWS[view]} THEN x.ActiveBookingCount ELSE 0 END) AS activeBookings
        FROM (${LIST}) x`),
    ]);
    const rows = result.recordset;
    await attachUnits(pool, rows, scopeApp);
    const sm = summaryResult.recordset[0] || {};
    const views = Object.fromEntries(Object.keys(C360_VIEWS).map((k) => [k, sm[`View_${k}`] || 0]));
    res.json({
      rows, total: views[view], page, pageSize, views,
      summary: { totalPaid: sm.totalPaid || 0, totalOutstanding: sm.totalOutstanding || 0, activeBookings: sm.activeBookings || 0 },
    });
  } catch (e) {
    console.error("[crm-customer-360] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — full customer journey across Lead → Application → Booking →
// Agreement → Payments → Handover → Service Tickets, merged into one
// centralized ledger: invoices, payment receipts, on-account deposits, and
// broker settlements per booking, plus a customer-level financial summary.
// Restricted to admin-tier roles per the "leads visible only to marketing
// head and super admin" access rule.
//
// Keyed by CrmCustomer.Id (the real primary key), not Mobile. It used to be
// mobile-keyed end to end — meaning a customer with no mobile had no valid
// URL for this page at all, and every join here (Application/Booking/
// Tickets/Cancellations) matched by Mobile STRING EQUALITY instead of the
// actual CustomerId foreign key, which silently dropped all of a mobile-
// less customer's records (NULL = NULL is never true in SQL) and could
// under/over-match even for customers who do have one (typos, shared
// numbers). CustomerId is strictly correct in every case Mobile matching
// was standing in for.
router.get("/:id", requirePageRight("crm-customer-360", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const customerId = parseInt(req.params.id, 10);
    if (!Number.isFinite(customerId)) return res.status(400).json({ error: "Invalid customer id" });

    const customerRes = await pool.request().input("id", sql.Int, customerId).query(`
      SELECT Id, CustomerNo, CustomerName, Mobile, AltMobile, Email, PanNo, Address, City, State, Pincode, LeadId
      FROM dbo.CrmCustomer WHERE Id = @id AND IsActive = 1
    `);
    if (!customerRes.recordset.length) return res.status(404).json({ error: "Customer not found" });
    const customerRow = customerRes.recordset[0];

    const scopeApp = req.projectScope ? projectPredicate(req.projectScope, "a.ProjectId") : "";
    const scopeBooking = req.projectScope ? projectPredicate(req.projectScope, "b.ProjectId") : "";

    const [leads, apps, bookings, calls, tickets, cancellations] = await Promise.all([
      // A customer links to at most the ONE lead it converted from
      // (CrmCustomer.LeadId) — set at customer-creation time, whether via
      // the New Customer dialog's "Link to Existing Lead" or the
      // Lead-conversion flow itself.
      pool.request().input("lid", sql.Int, customerRow.LeadId).query(`
        SELECT Id, LeadUid, Status, Classification, SourceType, PlatformId,
               CreatedAt, AssignedSalespersonId
        FROM dbo.SaLead WHERE Id = @lid
        ORDER BY CreatedAt DESC
      `),
      pool.request().input("cid", sql.Int, customerId).query(`
        SELECT a.Id, a.ApplicationNo, a.ApplicantName, a.Status, a.CreatedAt,
               a.InterestedProject, a.PropertyType, a.BhkPreference,
               u.name AS AssigneeName
        FROM dbo.CrmApplication a
        LEFT JOIN dbo.Users u ON u.id = a.AssignedTo
        WHERE a.CustomerId = @cid ${scopeApp}
        ORDER BY a.CreatedAt DESC
      `),
      pool.request().input("cid", sql.Int, customerId).query(`
        SELECT b.Id, b.BookingNo,
               COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
               COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
               b.TotalValue, b.Status,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
               b.BookingDate, a.ApplicationNo,
               -- the page's timeline reads these (Booking / Cancellation events)
               b.ApplicationId, b.CreatedAt, b.UpdatedAt,
               ag.Status AS AgreementStatus,
               h.Status AS HandoverStatus, h.ActualHandoverDate,
               lm.OverallStatus AS LegalMilestoneStatus,
               pp.Status AS PrePossessionStatus,
               (SELECT COUNT(*) FROM dbo.CrmNoc n WHERE n.BookingId = b.Id AND n.Status <> 'Issued') AS NocPendingCount,
               (SELECT COUNT(*) FROM dbo.CrmNoc n WHERE n.BookingId = b.Id) AS NocTotalCount,
               -- Plus unswept On Account balance — same reasoning as the
               -- customer-level TotalPaid above.
               (SELECT ISNULL(SUM(AmountPaid),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
                 + (SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount,0)
                     THEN Amount - ISNULL(AppliedAmount,0) ELSE 0 END),0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS TotalPaid,
               (SELECT ISNULL(SUM(CASE WHEN Status <> 'Waived' THEN AmountDue ELSE 0 END),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalDue,
               CASE WHEN b.Status IN ${DEAD_BOOKING_SQL} THEN 0 ELSE
                 (SELECT ISNULL(SUM(CASE WHEN m2.Status NOT IN ('${CrmStatus.PAID}', 'Waived') THEN m2.AmountDue - ISNULL(m2.AmountPaid, 0) ELSE 0 END), 0)
                  FROM dbo.CrmPaymentMilestone m2 WHERE m2.BookingId = b.Id)
               END AS TotalOutstanding,
               (SELECT COUNT(*) FROM dbo.CrmCancellation WHERE BookingId = b.Id AND Status IN ('Requested','${CrmStatus.APPROVED}')) AS HasCancellation
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
        OUTER APPLY (SELECT TOP 1 x.* FROM dbo.CrmAgreement x WHERE x.BookingId = b.Id
                     ORDER BY CASE WHEN x.Status = 'Cancelled' THEN 1 ELSE 0 END, x.Id DESC) ag
        -- the current handover: a live / completed one before a cancelled one (migration 572)
        OUTER APPLY (SELECT TOP 1 x.* FROM dbo.CrmHandover x WHERE x.BookingId = b.Id
                     ORDER BY CASE WHEN x.Status = 'Cancelled' THEN 1 ELSE 0 END, x.Id DESC) h
        LEFT JOIN dbo.CrmLegalMilestone lm ON lm.BookingId = b.Id
        LEFT JOIN dbo.CrmPrePossession pp ON pp.BookingId = b.Id
        WHERE a.CustomerId = @cid ${scopeBooking}
        ORDER BY b.CreatedAt DESC
      `),
      pool.request().input("lid", sql.Int, customerRow.LeadId).query(`
        SELECT c.Id, c.CallTime, c.Outcome, c.Classification, c.Remarks
        FROM dbo.SaInquiryCall c
        WHERE c.LeadId = @lid
        ORDER BY c.CallTime DESC
      `),
      pool.request().input("cid", sql.Int, customerId).query(`
        SELECT t.Id, t.TicketNo, t.Category, t.Priority, t.Subject, t.Status, t.CreatedAt
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE a.CustomerId = @cid ${scopeBooking}
        ORDER BY t.CreatedAt DESC
      `),
      pool.request().input("cid", sql.Int, customerId).query(`
        SELECT c.Id, c.Status, c.RefundAmount, c.CreatedAt
        FROM dbo.CrmCancellation c
        JOIN dbo.CrmBooking b ON b.Id = c.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE a.CustomerId = @cid ${scopeBooking}
        ORDER BY c.CreatedAt DESC
      `),
    ]);

    const bookingRows = bookings.recordset;
    const bookingIds = bookingRows.map((b) => b.Id);

    let receiptsByBooking = {}, invoicesByBooking = {}, onAccountByBooking = {}, brokerageByBooking = {}, milestonesByBooking = {};
    if (bookingIds.length) {
      const idList = bookingIds.join(",");
      const [receiptsRes, invoicesRes, onAccountRes, brokerageRes, milestonesRes] = await Promise.all([
        // Receipts are keyed off Milestone, not Booking directly — join through
        // CrmPaymentMilestone the same way the milestone-payment flow itself does.
        pool.request().query(`
          SELECT r.Id, r.ReceiptNo, r.MilestoneId, r.Amount, r.ReceivedDate, r.PaymentMode,
                 r.DepositBankName, m.MilestoneName, m.BookingId
          FROM dbo.CrmPaymentReceipt r
          JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
          WHERE m.BookingId IN (${idList})
          ORDER BY r.ReceivedDate DESC
        `),
        // CreatedByName — "invoice history list management (per-user wise)"
        // needs to show who actually generated each invoice, not just the
        // invoice itself.
        pool.request().query(`
          SELECT i.Id, i.InvoiceNo, i.BookingId, i.InvoiceType, i.Amount, i.InvoiceDate, i.Description, i.Status,
                 cu.name AS CreatedByName
          FROM dbo.CrmInvoice i
          LEFT JOIN dbo.Users cu ON cu.id = i.CreatedBy
          WHERE i.BookingId IN (${idList})
          ORDER BY i.InvoiceDate DESC
        `),
        pool.request().query(`
          SELECT Id, ReceiptNo, BookingId, Amount, AppliedAmount, ReceivedDate, PaymentMode, DepositBankName
          FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${idList})
          ORDER BY ReceivedDate DESC
        `),
        // Broker name/firm come off the booking itself (BrokerName/BrokerFirm
        // captured at brokerage-creation time), same denormalized fields
        // crmBrokerage.js's own list view reads — no separate broker master
        // join needed here.
        pool.request().query(`
          SELECT br.Id, br.BookingId, br.BrokerName, br.BrokerFirm, br.RateType, br.RateValue,
                 br.ComputedAmount, br.Status, br.TrancheLabel,
                 (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id) AS TotalPaid
          FROM dbo.CrmBrokerageMaster br
          WHERE br.BookingId IN (${idList})
        `),
        // Full milestone-wise schedule — "act like a Customer 360" means
        // showing the real payment plan step by step (done / pending /
        // upcoming / overdue), not just the booking-level Paid/Outstanding
        // totals already summarized above.
        pool.request().query(`
          SELECT Id, BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status, [Percent]
          FROM dbo.CrmPaymentMilestone
          WHERE BookingId IN (${idList})
          ORDER BY BookingId, MilestoneNo
        `),
      ]);
      for (const r of receiptsRes.recordset) (receiptsByBooking[r.BookingId] ??= []).push(r);
      for (const inv of invoicesRes.recordset) (invoicesByBooking[inv.BookingId] ??= []).push(inv);
      for (const oa of onAccountRes.recordset) (onAccountByBooking[oa.BookingId] ??= []).push(oa);
      for (const br of brokerageRes.recordset) (brokerageByBooking[br.BookingId] ??= []).push(br);
      for (const m of milestonesRes.recordset) (milestonesByBooking[m.BookingId] ??= []).push(m);
      // Each milestone's money stage and the on-account money held against it — the same rule the Payments page
      // uses, so a customer's payments show on the plan while they are held On Account.
      const staged = await Promise.all(bookingIds.map((id) => getMilestoneMoneyStages(pool, id)));
      const stageById = new Map(staged.flatMap((s) => s.milestones).map((c) => [c.Id, c]));
      for (const list of Object.values(milestonesByBooking)) {
        for (const m of list) {
          const c = stageById.get(m.Id);
          m.MoneyStage = c ? c.MoneyStage : null;
          m.HeldOnAccount = c?.HeldOnAccount || 0;
        }
      }
    }

    const enrichedBookings = bookingRows.map((b) => ({
      ...b,
      receipts: receiptsByBooking[b.Id] || [],
      invoices: invoicesByBooking[b.Id] || [],
      onAccount: onAccountByBooking[b.Id] || [],
      brokerage: brokerageByBooking[b.Id] || [],
      milestones: milestonesByBooking[b.Id] || [],
    }));

    // Customer-level summary rolls up every non-Cancelled/Rejected booking's
    // figures — same exclusion rule as the per-booking TotalOutstanding above,
    // so the top-of-page tiles and the drill-down numbers always agree.
    // Credit notes on each booking (refunds and invoice reductions), newest first.
    if (bookingIds.length) {
      const cn = (await pool.request().query(`
        SELECT n.Id, n.BookingId, n.DocNo, n.DocType, n.Status, n.Source, n.ReasonType, n.AgainstRef, n.DocDate, n.TotalAmount, n.GstAmount, n.MovedToAccount
        FROM dbo.CrmGstNote n WHERE n.BookingId IN (${bookingIds.join(",")}) ORDER BY n.DocDate DESC, n.Id DESC`)).recordset;
      for (const b of enrichedBookings) b.creditNotes = cn.filter((n) => n.BookingId === b.Id);
    }
    const liveBookings = enrichedBookings.filter((b) => !DEAD_BOOKING_STATUSES.includes(b.Status));
    const summary = {
      totalInvoiced: sumMoney(liveBookings, (b) => sumMoney(b.invoices, (i) => i.Amount)),
      totalPaid: sumMoney(liveBookings, (b) => b.TotalPaid),
      totalOutstanding: sumMoney(liveBookings, (b) => b.TotalOutstanding),
      totalCredited: sumMoney(liveBookings, (b) => sumMoney((b.creditNotes || []).filter((n) => n.Status === "Issued" || n.Status === "TimeBarred"), (n) => n.TotalAmount)),
      totalOnAccountBalance: sumMoney(liveBookings, (b) => sumMoney(b.onAccount, (oa) => Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0))),
      totalBrokeragePaid: sumMoney(liveBookings, (b) => sumMoney(b.brokerage, (br) => br.TotalPaid)),
      totalBrokerageDue: sumMoney(liveBookings, (b) => sumMoney(b.brokerage, (br) => Math.max(0, Number(br.ComputedAmount || 0) - Number(br.TotalPaid || 0)))),
    };

    res.json({
      customer: customerRow,
      summary,
      leads: leads.recordset,
      applications: apps.recordset,
      bookings: enrichedBookings,
      calls: calls.recordset,
      serviceTickets: tickets.recordset,
      cancellations: cancellations.recordset,
    });
  } catch (e) {
    console.error("[crm-customer-360] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
