const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — CRM Command Centre dashboard.
// Accepts optional ?projectId=N to scope all KPIs to a single project.
// Returns two root keys:
//   alerts   — actionable attention items (counts that need human action today)
//   metrics  — aggregated pipeline/financial metrics for charts
router.get("/", requirePageRight("crm-dashboard", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;

    // Build a project filter clause that works across all queries.
    // CrmBooking has ProjectId; we join through BookingId in child tables.
    const projBookingCond   = projectId ? "AND b.ProjectId = @pid"  : "";
    const projBookingAlone  = projectId ? "WHERE b.ProjectId = @pid" : "";

    const addPid = (req0) => projectId ? req0.input("pid", sql.Int, projectId) : req0;

    // ── PROJECTS LIST (for the selector dropdown) ─────────────────────────────
    const projectsQ = pool.request().query(`
      SELECT DISTINCT b.ProjectId AS Id, COALESCE(proj.name, b.ProjectName) AS Name
      FROM dbo.CrmBooking b
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      WHERE b.IsActive = 1 AND b.ProjectId IS NOT NULL
      ORDER BY COALESCE(proj.name, b.ProjectName)
    `);

    // ── ALERT KPIs ────────────────────────────────────────────────────────────

    // 1. Bookings pending Welcome Call (approved > 0 days, no Welcomed outcome logged)
    const alertWelcomeCallQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmBooking b
      WHERE b.IsActive = 1 AND b.Status = '${CrmStatus.APPROVED}' ${projBookingCond}
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmWelcomeCall w
          WHERE w.BookingId = b.Id AND w.Outcome = 'Welcomed'
        )
    `);

    // 2. Overdue payment milestones (DueDate < today, Status = Pending, active booking)
    const alertOverdueDemandsQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME()) ${projBookingCond}
        AND m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
    `);

    // 3. Disputed possession notices (permanently blocks handover)
    const alertDisputedNoticesQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmPossessionNotice n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      WHERE n.Status = 'Disputed' ${projBookingCond.replace("AND b.", "AND b.")}
        AND b.IsActive = 1
    `);

    // 4. Handovers scheduled in next 7 days
    const alertHandoversThisWeekQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmHandover h
      JOIN dbo.CrmBooking b ON b.Id = h.BookingId
      WHERE h.Status = 'Scheduled' ${projBookingCond}
        AND h.ScheduledDate BETWEEN CAST(SYSDATETIME() AS DATE)
            AND DATEADD(DAY, 7, CAST(SYSDATETIME() AS DATE))
    `);

    // 5. Open Urgent/High priority service tickets
    const alertUrgentTicketsQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE t.Status NOT IN ('${CrmStatus.RESOLVED}','${CrmStatus.CLOSED}') ${projBookingCond}
        AND t.Priority IN ('Urgent','High')
    `);

    // 6. Cancellations pending approval
    const alertCancellationsPendingQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmCancellation c
      JOIN dbo.CrmBooking b ON b.Id = c.BookingId
      WHERE c.Status = '${CrmStatus.PENDING}' ${projBookingCond}
    `);

    // 7. Sales deeds awaiting customer portal approval
    const alertDeedsAwaitingCustomerQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmSalesDeed sd
      JOIN dbo.CrmBooking b ON b.Id = sd.BookingId
      WHERE sd.CustomerApprovalStatus = '${CrmStatus.PENDING}' ${projBookingCond}
        AND b.IsActive = 1
    `);

    // 8. Sales deeds awaiting director approval
    const alertDeedsAwaitingDirectorQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmSalesDeed sd
      JOIN dbo.CrmBooking b ON b.Id = sd.BookingId
      WHERE sd.DirectorApprovalStatus = '${CrmStatus.PENDING}' ${projBookingCond}
        AND b.IsActive = 1
    `);

    // 9. NOCs approved but not yet issued (stuck in approved limbo)
    const alertNocsNotIssuedQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmNoc n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      WHERE n.Status = '${CrmStatus.APPROVED}' ${projBookingCond}
        AND b.IsActive = 1
    `);

    // 10. Agreements needing action: approved booking, no agreement at all OR
    //     agreement stuck in Draft for more than 5 days
    const alertAgreementsPendingQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.CrmBooking b
      WHERE b.IsActive = 1 AND b.Status = '${CrmStatus.APPROVED}' ${projBookingCond}
        AND (
          NOT EXISTS (SELECT 1 FROM dbo.CrmAgreement a WHERE a.BookingId = b.Id)
          OR EXISTS (
            SELECT 1 FROM dbo.CrmAgreement a
            WHERE a.BookingId = b.Id AND a.Status = '${CrmStatus.DRAFT}'
              AND DATEDIFF(DAY, a.CreatedAt, SYSDATETIME()) > 5
          )
        )
    `);

    // ── THIS WEEK — daily breakdown for the 7-day strip ──────────────────────
    // Returns one row per day for next 7 days with counts of scheduled events
    const thisWeekQ = addPid(pool.request()).query(`
      ;WITH Days AS (
        SELECT CAST(DATEADD(DAY, n, CAST(SYSDATETIME() AS DATE)) AS DATE) AS D
        FROM (VALUES(0),(1),(2),(3),(4),(5),(6)) AS v(n)
      )
      SELECT
        FORMAT(d.D, 'ddd dd MMM') AS DayLabel,
        CONVERT(varchar(10), d.D, 120)  AS DayDate,
        ISNULL((SELECT COUNT(*) FROM dbo.CrmHandover h
          JOIN dbo.CrmBooking b ON b.Id = h.BookingId
          WHERE h.Status = 'Scheduled' AND CAST(h.ScheduledDate AS DATE) = d.D ${projBookingCond}), 0) AS Handovers,
        ISNULL((SELECT COUNT(*) FROM dbo.CrmRegistry r
          JOIN dbo.CrmBooking b ON b.Id = r.BookingId
          WHERE r.Status = 'Scheduled' AND CAST(r.ScheduledDate AS DATE) = d.D ${projBookingCond}), 0) AS Registries,
        ISNULL((SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m
          JOIN dbo.CrmBooking b ON b.Id = m.BookingId
          WHERE m.Status = '${CrmStatus.PENDING}' AND CAST(m.DueDate AS DATE) = d.D
            AND b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME()) ${projBookingCond}), 0) AS MilestonesDue
      FROM Days d
      ORDER BY d.D
    `);

    // ── METRICS KPIs ──────────────────────────────────────────────────────────

    // Units sold this month (BookingDate in current calendar month)
    const unitsSoldThisMonthQ = addPid(pool.request()).query(`
      SELECT COUNT(*) AS Cnt, ISNULL(SUM(TotalValue), 0) AS TotalValue
      FROM dbo.CrmBooking b
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME()) ${projBookingCond}
        AND CAST(b.BookingDate AS DATE) >= DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)
    `);

    // Collection efficiency per project
    const collectionPerProjectQ = pool.request().query(`
      SELECT
        COALESCE(proj.name, b.ProjectName) AS ProjectName,
        ISNULL(SUM(m.AmountDue), 0)  AS TotalDue,
        ISNULL(SUM(m.AmountPaid), 0) AS TotalPaid,
        SUM(CASE WHEN m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END) AS OverdueCount
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME())
      GROUP BY COALESCE(proj.name, b.ProjectName)
      ORDER BY COALESCE(proj.name, b.ProjectName)
    `);

    // Forward-looking: amount due in next 30 days
    const forwardDueQ = addPid(pool.request()).query(`
      SELECT
        ISNULL(SUM(m.AmountDue - m.AmountPaid), 0) AS AmountDueNext30Days,
        COUNT(*) AS MilestoneCount
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME()) ${projBookingCond}
        AND m.Status = '${CrmStatus.PENDING}'
        AND m.DueDate BETWEEN CAST(SYSDATETIME() AS DATE)
            AND DATEADD(DAY, 30, CAST(SYSDATETIME() AS DATE))
    `);

    // Funnel stage counts — Applications → Bookings → Agreements → Possessions
    const funnelQ = addPid(pool.request()).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.CrmApplication a
          WHERE a.IsActive = 1
          ${projectId ? "AND EXISTS (SELECT 1 FROM dbo.CrmBooking bx WHERE bx.ApplicationId = a.Id AND bx.ProjectId = @pid)" : ""}
        ) AS Applications,
        (SELECT COUNT(*) FROM dbo.CrmBooking b
          WHERE b.IsActive = 1
            AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired')
            ${projectId ? "AND b.ProjectId = @pid" : ""}
        ) AS Bookings,
        (SELECT COUNT(*) FROM dbo.CrmAgreement ag
          JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
          WHERE ag.Status IN ('${CrmStatus.EXECUTED}','${CrmStatus.REGISTERED}')
            AND b.IsActive = 1
            ${projectId ? "AND b.ProjectId = @pid" : ""}
        ) AS Agreements,
        (SELECT COUNT(*) FROM dbo.CrmHandover h
          JOIN dbo.CrmBooking b ON b.Id = h.BookingId
          WHERE h.Status = 'Completed'
            ${projectId ? "AND b.ProjectId = @pid" : ""}
        ) AS Possessions
    `);

    // Existing aggregates (scoped to project where possible)
    const appsQ = addPid(pool.request()).query(`
      SELECT a.Status, COUNT(*) AS Count
      FROM dbo.CrmApplication a
      WHERE a.IsActive = 1
        ${projectId ? "AND EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = a.Id AND b.ProjectId = @pid)" : ""}
      GROUP BY a.Status
    `);

    const bookingsQ = addPid(pool.request()).query(`
      SELECT Status, COUNT(*) AS Count, SUM(ISNULL(TotalValue,0)) AS TotalValue
      FROM dbo.CrmBooking b
      WHERE b.IsActive = 1 ${projBookingCond}
      GROUP BY Status
    `);

    const paymentsQ = addPid(pool.request()).query(`
      SELECT
        ISNULL(SUM(m.AmountDue), 0)  AS TotalDue,
        ISNULL(SUM(m.AmountPaid), 0) AS TotalPaid,
        SUM(CASE WHEN m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END) AS OverdueCount
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      WHERE b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}','Expired') AND (b.Status = 'Approved' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME()) ${projBookingCond}
    `);

    const ticketsQ = addPid(pool.request()).query(`
      SELECT t.Status, COUNT(*) AS Count
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE 1=1 ${projBookingCond}
      GROUP BY t.Status
    `);

    const cancellationsQ = addPid(pool.request()).query(`
      SELECT c.Status, COUNT(*) AS Count, ISNULL(SUM(c.RefundAmount),0) AS TotalRefund
      FROM dbo.CrmCancellation c
      JOIN dbo.CrmBooking b ON b.Id = c.BookingId
      WHERE 1=1 ${projBookingCond}
      GROUP BY c.Status
    `);

    const handoversQ = addPid(pool.request()).query(`
      SELECT h.Status, COUNT(*) AS Count
      FROM dbo.CrmHandover h
      JOIN dbo.CrmBooking b ON b.Id = h.BookingId
      WHERE 1=1 ${projBookingCond}
      GROUP BY h.Status
    `);

    const monthlyTrendQ = addPid(pool.request()).query(`
      ;WITH Months AS (
        SELECT DATEFROMPARTS(YEAR(m.d), MONTH(m.d), 1) AS MonthStart
        FROM (VALUES
          (DATEADD(MONTH,-5,SYSDATETIME())),(DATEADD(MONTH,-4,SYSDATETIME())),
          (DATEADD(MONTH,-3,SYSDATETIME())),(DATEADD(MONTH,-2,SYSDATETIME())),
          (DATEADD(MONTH,-1,SYSDATETIME())),(SYSDATETIME())
        ) AS m(d)
      )
      SELECT
        FORMAT(mo.MonthStart,'MMM yyyy') AS MonthLabel,
        (SELECT COUNT(*) FROM dbo.CrmApplication a
          WHERE a.IsActive = 1
            AND a.CreatedAt >= mo.MonthStart AND a.CreatedAt < DATEADD(MONTH,1,mo.MonthStart)
            ${projectId ? "AND EXISTS(SELECT 1 FROM dbo.CrmBooking bx WHERE bx.ApplicationId=a.Id AND bx.ProjectId=@pid)" : ""}
        ) AS Applications,
        (SELECT COUNT(*) FROM dbo.CrmBooking b
          WHERE b.IsActive = 1 ${projBookingCond}
            AND b.BookingDate >= mo.MonthStart AND b.BookingDate < DATEADD(MONTH,1,mo.MonthStart)
        ) AS Bookings,
        (SELECT ISNULL(SUM(pm.AmountPaid),0)
          FROM dbo.CrmPaymentMilestone pm
          JOIN dbo.CrmBooking b ON b.Id = pm.BookingId
          WHERE ${projectId ? "b.ProjectId = @pid AND" : ""} pm.PaidDate >= mo.MonthStart AND pm.PaidDate < DATEADD(MONTH,1,mo.MonthStart)
        ) AS Collected
      FROM Months mo ORDER BY mo.MonthStart
    `);

    // Run all queries in parallel
    const [
      projects,
      alertWelcomeCall, alertOverdueDemands, alertDisputedNotices,
      alertHandoversThisWeek, alertUrgentTickets, alertCancellationsPending,
      alertDeedsCustomer, alertDeedsDirector, alertNocsNotIssued, alertAgreements,
      thisWeek, unitsSoldThisMonth, collectionPerProject, forwardDue,
      apps, bkgs, payments, tickets, cancellations, handovers, monthlyTrend,
      funnel,
    ] = await Promise.all([
      projectsQ,
      alertWelcomeCallQ, alertOverdueDemandsQ, alertDisputedNoticesQ,
      alertHandoversThisWeekQ, alertUrgentTicketsQ, alertCancellationsPendingQ,
      alertDeedsAwaitingCustomerQ, alertDeedsAwaitingDirectorQ,
      alertNocsNotIssuedQ, alertAgreementsPendingQ,
      thisWeekQ, unitsSoldThisMonthQ, collectionPerProjectQ, forwardDueQ,
      appsQ, bookingsQ, paymentsQ, ticketsQ, cancellationsQ, handoversQ, monthlyTrendQ,
      funnelQ,
    ]);

    res.json({
      projects: projects.recordset,
      alerts: {
        welcomeCallPending:      alertWelcomeCall.recordset[0]?.Cnt    ?? 0,
        overduePayments:         alertOverdueDemands.recordset[0]?.Cnt ?? 0,
        disputedNotices:         alertDisputedNotices.recordset[0]?.Cnt ?? 0,
        handoversThisWeek:       alertHandoversThisWeek.recordset[0]?.Cnt ?? 0,
        urgentTickets:           alertUrgentTickets.recordset[0]?.Cnt  ?? 0,
        cancellationsPending:    alertCancellationsPending.recordset[0]?.Cnt ?? 0,
        deedsAwaitingCustomer:   alertDeedsCustomer.recordset[0]?.Cnt  ?? 0,
        deedsAwaitingDirector:   alertDeedsDirector.recordset[0]?.Cnt  ?? 0,
        nocsNotIssued:           alertNocsNotIssued.recordset[0]?.Cnt  ?? 0,
        agreementsPending:       alertAgreements.recordset[0]?.Cnt     ?? 0,
      },
      thisWeek: thisWeek.recordset,
      metrics: {
        unitsSoldThisMonth:  unitsSoldThisMonth.recordset[0]?.Cnt ?? 0,
        revenueThisMonth:    unitsSoldThisMonth.recordset[0]?.TotalValue ?? 0,
        forwardDue30Days:    forwardDue.recordset[0]?.AmountDueNext30Days ?? 0,
        forwardDueCount:     forwardDue.recordset[0]?.MilestoneCount ?? 0,
        collectionPerProject: collectionPerProject.recordset,
      },
      applications:   apps.recordset,
      bookings:       bkgs.recordset,
      payments:       payments.recordset[0],
      serviceTickets: tickets.recordset,
      cancellations:  cancellations.recordset,
      handovers:      handovers.recordset,
      monthlyTrend:   monthlyTrend.recordset,
      funnel:         funnel.recordset[0] ?? { Applications: 0, Bookings: 0, Agreements: 0, Possessions: 0 },
    });
  } catch (e) {
    console.error("[crm-dashboard] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
