const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Returns { clauses: string[], bindFn: (req) => void } — always use parameterized inputs,
// never string interpolation. The caller appends clauses to their WHERE and calls bindFn on
// their pool.request() to bind @fromDate / @toDate safely.
function dateRangeParams(req, column) {
  const clauses = [];
  const hasFrom = req.query.from && ISO_DATE.test(req.query.from);
  const hasTo   = req.query.to   && ISO_DATE.test(req.query.to);
  if (hasFrom) clauses.push(`${column} >= @fromDate`);
  if (hasTo)   clauses.push(`${column} <= @toDate`);
  return {
    clauses,
    bind(r) {
      if (hasFrom) r.input("fromDate", sql.Date, req.query.from);
      if (hasTo)   r.input("toDate",   sql.Date, req.query.to);
    },
  };
}

// Company/Project/Block scoping, standardized across every report below —
// same lever used throughout the CRM scalability rollout (see
// CrmApplication.tsx, CrmBooking.tsx, etc.): a report otherwise has no
// bound on how many rows it returns as the portfolio grows across more
// companies/projects, so every report needs a way to narrow to one slice.
// `bookingCol`/`companyCol` let callers point at whichever alias actually
// carries CompanyId/ProjectId in their query (usually the booking `b`, but
// CrmApplication and UnitMaster both carry their own copies too).
function cpbParams(req, { companyCol, projectCol, blockCol } = {}) {
  const clauses = [];
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
  if (companyId && companyCol) clauses.push(`${companyCol} = @cpbCompanyId`);
  if (projectId && projectCol) clauses.push(`${projectCol} = @cpbProjectId`);
  if (blockId && blockCol) clauses.push(`${blockCol} = @cpbBlockId`);
  return {
    clauses,
    bind(r) {
      if (companyId && companyCol) r.input("cpbCompanyId", sql.Int, companyId);
      if (projectId && projectCol) r.input("cpbProjectId", sql.Int, projectId);
      if (blockId && blockCol) r.input("cpbBlockId", sql.Int, blockId);
    },
  };
}

// 1. Booking Register — every active booking with customer, unit & value
router.get("/booking-register", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(b.BookingDate AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = ["b.IsActive = 1", `b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}')`, ...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT b.BookingNo, a.ApplicantName, a.Mobile, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, COALESCE(bn.UnitType, b.UnitType) AS UnitType,
        b.AreaSqFt, b.TotalValue AS TotalValue, b.BookingAmount, b.Status,
        CAST(b.BookingDate AS DATE) AS BookingDate
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      WHERE ${conds.join(" AND ")}
      ORDER BY b.BookingDate DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Payment Collection Report — milestone due/paid/balance per active booking
router.get("/payment-collection", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(m.DueDate AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = ["b.IsActive = 1", `b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}')`, ...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT b.BookingNo, a.ApplicantName, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, m.MilestoneName,
        CAST(m.DueDate AS DATE) AS DueDate, m.AmountDue, m.AmountPaid,
        (m.AmountDue - m.AmountPaid) AS Balance, m.Status
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      WHERE ${conds.join(" AND ")}
      ORDER BY m.DueDate DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Receipt Register — actual money received
router.get("/receipt-register", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(r.ReceivedDate AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const req0 = pool.request();
    dr.bind(req0); cpb.bind(req0);
    const result = await req0.query(`
      SELECT r.ReceiptNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, m.MilestoneName,
        r.Amount, CAST(r.ReceivedDate AS DATE) AS ReceivedDate, r.PaymentMode, r.TransactionRef
      FROM dbo.CrmPaymentReceipt r
      JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY r.ReceivedDate DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Overdue Payments — pending milestones past due date, active bookings only
router.get("/overdue-payments", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, a.Mobile, m.MilestoneName,
        CAST(m.DueDate AS DATE) AS DueDate, m.AmountDue, m.AmountPaid,
        (m.AmountDue - m.AmountPaid) AS OverdueAmount,
        DATEDIFF(DAY, m.DueDate, SYSDATETIME()) AS DaysOverdue
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      WHERE m.Status = '${CrmStatus.PENDING}'
        AND m.DueDate < CAST(SYSDATETIME() AS DATE)
        AND b.IsActive = 1
        AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}')
        ${cpb.clauses.length ? "AND " + cpb.clauses.join(" AND ") : ""}
      ORDER BY m.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Brokerage Report — computed vs paid per broker
router.get("/brokerage-report", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(br.CreatedAt AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT br.BrokerName, br.BrokerFirm, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        br.RateType, br.RateValue, br.ComputedAmount,
        br.TDSName, br.TDSPercentage, ISNULL(br.TDSAmount, 0) AS TDSAmount,
        ISNULL(br.NetPayable, br.ComputedAmount) AS NetPayable,
        br.Status,
        ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0) AS TotalPaid,
        (ISNULL(br.NetPayable, br.ComputedAmount) - ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0)) AS Balance
      FROM dbo.CrmBrokerageMaster br
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY br.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Cancellation Report — refund/deduction breakdown
router.get("/cancellation-report", requirePageRight("crm-cancellations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(c.CreatedAt AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT c.CancellationNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, c.Reason,
        c.AmountPaidTillDate, c.DeductionPercent, c.DeductionAmount, c.RefundAmount, c.Status,
        CAST(c.CreatedAt AS DATE) AS RequestedDate
      FROM dbo.CrmCancellation c
      JOIN dbo.CrmBooking b ON b.Id = c.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Booking Status Summary — funnel counts by status
router.get("/booking-status-summary", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.Status, COUNT(*) AS Count, SUM(ISNULL(b.TotalValue,0)) AS TotalValue
      FROM dbo.CrmBooking b
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      WHERE b.IsActive = 1
        ${cpb.clauses.length ? "AND " + cpb.clauses.join(" AND ") : ""}
      GROUP BY b.Status
      ORDER BY Count DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Customer Master Report — all customers with contact info
router.get("/customer-report", requirePageRight("crm-customers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(c.CreatedAt AS DATE)");
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const conds = ["c.IsActive = 1", ...dr.clauses];
    const r = pool.request();
    dr.bind(r);
    // CrmCustomer carries no CompanyId/ProjectId of its own — same
    // EXISTS-against-CrmApplication pattern as crmCustomers.js.
    if (companyId) { r.input("cpbCompanyId", sql.Int, companyId); conds.push("EXISTS (SELECT 1 FROM dbo.CrmApplication ap WHERE ap.CustomerId = c.Id AND ap.CompanyId = @cpbCompanyId)"); }
    if (projectId) { r.input("cpbProjectId", sql.Int, projectId); conds.push("EXISTS (SELECT 1 FROM dbo.CrmApplication ap WHERE ap.CustomerId = c.Id AND ap.ProjectId = @cpbProjectId)"); }
    if (blockId) { r.input("cpbBlockId", sql.Int, blockId); conds.push("EXISTS (SELECT 1 FROM dbo.CrmApplication ap JOIN dbo.UnitMaster um ON um.Id = ap.PreferredUnitId WHERE ap.CustomerId = c.Id AND um.BlockId = @cpbBlockId)"); }
    const result = await r.query(`
      SELECT c.CustomerNo, c.CustomerName, c.Mobile, c.Email,
        (SELECT COUNT(*) FROM dbo.CrmBooking bk JOIN dbo.CrmApplication ap ON ap.Id = bk.ApplicationId
         WHERE ap.CustomerId = c.Id AND bk.IsActive = 1) AS TotalBookings,
        CAST(c.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmCustomer c
      WHERE ${conds.join(" AND ")}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Application Funnel — leads-to-booking conversion by status
router.get("/application-funnel", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(a.CreatedAt AS DATE)");
    const cpb = cpbParams(req, { companyCol: "a.CompanyId", projectCol: "a.ProjectId", blockCol: "um.BlockId" });
    const conds = ["a.IsActive = 1", ...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT a.Status,
        COUNT(*) AS Count,
        SUM(CASE WHEN bk.ApplicationId IS NOT NULL THEN 1 ELSE 0 END) AS Converted
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.UnitMaster um ON um.Id = a.PreferredUnitId
      LEFT JOIN (SELECT DISTINCT ApplicationId FROM dbo.CrmBooking WHERE IsActive = 1) bk ON bk.ApplicationId = a.Id
      WHERE ${conds.join(" AND ")}
      GROUP BY a.Status
      ORDER BY Count DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. Service Ticket Report — support tickets with SLA
router.get("/service-tickets", requirePageRight("crm-service-tickets", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(t.CreatedAt AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT t.TicketNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, t.Category, t.Priority,
        t.Subject, t.Status, CAST(t.SlaDueDate AS DATE) AS SlaDueDate,
        CAST(t.ResolvedAt AS DATE) AS ResolvedDate, CAST(t.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. Legal Milestone Report — title/legal clearance progress
router.get("/legal-milestones", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, m.CurrentStep, m.OverallStatus,
        CAST(m.CreatedAt AS DATE) AS CreatedDate, CAST(m.UpdatedAt AS DATE) AS LastUpdated
      FROM dbo.CrmLegalMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY m.UpdatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 12. NOC Report — bank/organisation NOC requests
router.get("/noc-report", requirePageRight("crm-noc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(n.CreatedAt AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT n.NocNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, n.NocType,
        CAST(n.NocDate AS DATE) AS NocDate, n.BankName, n.LoanAmount, n.Status
      FROM dbo.CrmNoc n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY n.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 13. Sales Deed Report — registration & execution status
router.get("/sales-deed-report", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT d.DeedNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        d.DeedValue, d.StampDuty, d.RegistrationFee,
        CAST(d.DeedDate AS DATE) AS DeedDate, d.RegistrationNo,
        CASE
          WHEN b.Status = '${CrmStatus.CANCELLED}' THEN '${CrmStatus.CANCELLED}'
          WHEN d.RegistrationNo IS NOT NULL THEN '${CrmStatus.REGISTERED}'
          WHEN d.ExecutedBy IS NOT NULL THEN '${CrmStatus.EXECUTED}'
          WHEN d.DeedDate IS NOT NULL AND d.DeedDate < CAST(GETDATE() AS DATE) THEN 'Overdue'
          ELSE '${CrmStatus.DRAFT}'
        END AS Status,
        d.CustomerApprovalStatus, d.DirectorApprovalStatus
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY d.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 14. Handover Report — key handover progress
router.get("/handover-report", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        CAST(h.ScheduledDate AS DATE) AS ScheduledDate,
        CAST(h.ActualHandoverDate AS DATE) AS ActualHandoverDate,
        h.Status, h.FinalDuesCleared, h.CustomerAcknowledged,
        kh.name AS KeyHandoverByName
      FROM dbo.CrmHandover h
      JOIN dbo.CrmBooking b ON b.Id = h.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      LEFT JOIN dbo.Users kh ON kh.id = h.KeyHandoverBy
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY h.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 15. Agreement Report — sale agreement drafting/approval status
router.get("/agreement-report", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT ag.AgreementNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        CAST(ag.AgreementDate AS DATE) AS AgreementDate,
        ag.Status, ag.SeniorApprovalStatus, ag.CustomerApprovalStatus
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY ag.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 16. Welcome Call Report — post-booking onboarding calls
router.get("/welcome-call-report", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(wc.CallDate AS DATE)");
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const conds = [...dr.clauses, ...cpb.clauses];
    const r = pool.request();
    dr.bind(r); cpb.bind(r);
    const result = await r.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        CAST(wc.CallDate AS DATE) AS CallDate, wc.Outcome,
        CAST(wc.NextCallDate AS DATE) AS NextCallDate, wc.PaymentPlanConfirmed
      FROM dbo.CrmWelcomeCall wc
      JOIN dbo.CrmBooking b ON b.Id = wc.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY wc.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 17. Parking Allotment Report
router.get("/parking-report", requirePageRight("crm-parking-booking", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const req0 = pool.request();
    const conds = ["pa.IsActive = 1"];
    // Company/Project resolved via either linkage a parking row can carry
    // (its own Application directly for a standalone sale, or via its
    // Booking) — same "either linkage" pattern as crmCommunication.js.
    // Block isn't resolvable here without joining ParkingMaster/ParkingSlot
    // for their own ProjectId/BlockId (see crmParking.js's ALLOTMENT_SELECT)
    // — skipped for this report rather than half-implemented.
    if (companyId) { req0.input("cpbCompanyId", sql.Int, companyId); conds.push("(a.CompanyId = @cpbCompanyId OR b.CompanyId = @cpbCompanyId)"); }
    if (projectId) { req0.input("cpbProjectId", sql.Int, projectId); conds.push("(a.ProjectId = @cpbProjectId OR b.ProjectId = @cpbProjectId)"); }
    const result = await req0.query(`
      SELECT ISNULL(b.BookingNo, '(Standalone)') AS BookingNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, pa.ParkingSlotNo, pa.Quantity,
        pa.TotalAmount, pa.PaymentStatus, CAST(pa.CreatedAt AS DATE) AS AllotmentDate
      FROM dbo.CrmParkingAllotment pa
      LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
      LEFT JOIN dbo.CrmApplication a ON a.Id = ISNULL(pa.ApplicationId, b.ApplicationId)
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE ${conds.join(" AND ")}
      ORDER BY pa.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 18. Possession Notice Report
router.get("/possession-notice-report", requirePageRight("crm-possession-notice", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT n.NoticeNo, b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        CAST(n.OfferedDate AS DATE) AS OfferedDate,
        CAST(n.ResponseDeadline AS DATE) AS ResponseDeadline,
        n.DeliveryMode, n.Status
      FROM dbo.CrmPossessionNotice n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY n.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 19. Pre-Possession Inspection Report
router.get("/pre-possession-report", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName,
        CAST(p.ScheduledInspectionDate AS DATE) AS InspectionDate,
        p.DuesClearedCheck, p.DocumentationCheck, p.QualityInspectionCheck, p.UtilityReadinessCheck,
        p.Status, CAST(p.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmPrePossession p
      JOIN dbo.CrmBooking b ON b.Id = p.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      ${cpb.clauses.length ? "WHERE " + cpb.clauses.join(" AND ") : ""}
      ORDER BY p.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 20. Construction Update Report — project progress log
router.get("/construction-updates", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const dr = dateRangeParams(req, "CAST(u.UpdateDate AS DATE)");
    // CrmConstructionUpdate carries its own ProjectId (see
    // crmConstructionUpdates.js) — no Company/Block link exists on this
    // table, so only Project scoping applies here.
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const conds = [...dr.clauses];
    const r = pool.request();
    dr.bind(r);
    if (projectId) { r.input("cpbProjectId", sql.Int, projectId); conds.push("u.ProjectId = @cpbProjectId"); }
    const result = await r.query(`
      SELECT u.ProjectName, CAST(u.UpdateDate AS DATE) AS UpdateDate,
        u.PercentComplete, u.Stage, u.Summary
      FROM dbo.CrmConstructionUpdate u
      ${conds.length ? "WHERE " + conds.join(" AND ") : ""}
      ORDER BY u.UpdateDate DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 21. Aging Analysis — overdue payment buckets, active bookings only
router.get("/aging-analysis", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const cpb = cpbParams(req, { companyCol: "b.CompanyId", projectCol: "b.ProjectId", blockCol: "um.BlockId" });
    const req0 = pool.request();
    cpb.bind(req0);
    const result = await req0.query(`
      SELECT b.BookingNo, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName, a.ApplicantName, a.Mobile,
        m.MilestoneName, CAST(m.DueDate AS DATE) AS DueDate,
        (m.AmountDue - m.AmountPaid) AS Balance,
        DATEDIFF(DAY, m.DueDate, SYSDATETIME()) AS DaysOverdue,
        CASE
          WHEN DATEDIFF(DAY, m.DueDate, SYSDATETIME()) <= 30 THEN '0–30 Days'
          WHEN DATEDIFF(DAY, m.DueDate, SYSDATETIME()) BETWEEN 31 AND 60 THEN '31–60 Days'
          WHEN DATEDIFF(DAY, m.DueDate, SYSDATETIME()) BETWEEN 61 AND 90 THEN '61–90 Days'
          ELSE '90+ Days'
        END AS AgingBucket
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      WHERE m.Status = '${CrmStatus.PENDING}'
        AND m.DueDate < CAST(SYSDATETIME() AS DATE)
        AND b.IsActive = 1
        AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}')
        ${cpb.clauses.length ? "AND " + cpb.clauses.join(" AND ") : ""}
      ORDER BY DaysOverdue DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 22. Inventory Status — units availability matrix
router.get("/inventory-status", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    // UnitMaster/enterprise carry no CompanyId column of their own (see
    // established finding earlier this rollout — Company only lives on
    // CrmBooking/CrmApplication directly), so only Project/Block scope here.
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const req0 = pool.request();
    const conds = ["u.IsActive = 1"];
    if (projectId) { req0.input("cpbProjectId", sql.Int, projectId); conds.push("u.ProjectId = @cpbProjectId"); }
    if (blockId) { req0.input("cpbBlockId", sql.Int, blockId); conds.push("u.BlockId = @cpbBlockId"); }
    const result = await req0.query(`
      SELECT
        ep.name AS ProjectName,
        u.UnitType,
        COUNT(u.Id) AS TotalUnits,
        SUM(CASE WHEN bk.Id IS NOT NULL THEN 1 ELSE 0 END) AS BookedUnits,
        SUM(CASE WHEN bk.Id IS NULL THEN 1 ELSE 0 END) AS AvailableUnits
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise ep ON ep.id = u.ProjectId
      LEFT JOIN dbo.CrmBooking bk ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}')
      WHERE ${conds.join(" AND ")}
      GROUP BY ep.name, u.UnitType
      ORDER BY ep.name, u.UnitType
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;