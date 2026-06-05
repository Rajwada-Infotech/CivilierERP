const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

router.use(authMiddleware);

// ── GET /summary ──────────────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        -- Applications
        (SELECT COUNT(*) FROM dbo.FollowupApplications  WHERE IsDeleted = 0) AS totalApplications,
        (SELECT COUNT(*) FROM dbo.FollowupApplications  WHERE IsDeleted = 0 AND Status = 'Approved') AS approvedApplications,

        -- Bookings
        (SELECT COUNT(*) FROM dbo.FollowupBookings      WHERE IsDeleted = 0) AS totalBookings,
        (SELECT COUNT(*) FROM dbo.FollowupBookings      WHERE IsDeleted = 0 AND Status = 'Confirmed') AS confirmedBookings,

        -- Welcome Calls
        (SELECT COUNT(*) FROM dbo.FollowupWelcomeCalls  WHERE IsDeleted = 0 AND Status = 'Scheduled') AS pendingWelcomeCalls,
        (SELECT COUNT(*) FROM dbo.FollowupWelcomeCalls  WHERE IsDeleted = 0 AND Status = 'Completed') AS completedWelcomeCalls,

        -- Agreements
        (SELECT COUNT(*) FROM dbo.FollowupAgreements    WHERE IsDeleted = 0 AND Status NOT IN ('Cancelled')) AS activeAgreements,

        -- NOC
        (SELECT COUNT(*) FROM dbo.FollowupNOCs           WHERE IsDeleted = 0 AND Status = 'Pending') AS pendingNOC,
        (SELECT COUNT(*) FROM dbo.FollowupNOCs           WHERE IsDeleted = 0 AND Status = 'Issued')  AS issuedNOC,

        -- Sales Deed
        (SELECT COUNT(*) FROM dbo.FollowupSalesDeed     WHERE IsDeleted = 0 AND Status = 'Draft')      AS draftSalesDeed,
        (SELECT COUNT(*) FROM dbo.FollowupSalesDeed     WHERE IsDeleted = 0 AND Status = 'Registered') AS registeredSalesDeed,

        -- Handover
        (SELECT COUNT(*) FROM dbo.FollowupHandover      WHERE IsDeleted = 0 AND Status = 'Completed')  AS handoverCompleted,
        (SELECT COUNT(*) FROM dbo.FollowupHandover      WHERE IsDeleted = 0 AND Status = 'Scheduled')  AS handoverScheduled,

        -- Total value of confirmed bookings
        ISNULL((SELECT SUM(TotalValue) FROM dbo.FollowupBookings WHERE IsDeleted = 0 AND Status = 'Confirmed'), 0) AS totalConfirmedValue
    `);

    // Recent activity — last 10 entries across key tables
    const recentResult = await pool.request().query(`
      SELECT TOP 10 activity, refNo, module, createdBy, createdAt FROM (
        SELECT
          'New Application' AS activity,
          ApplicantNo AS refNo,
          'Applications'   AS module,
          CreatedBy, CreatedAt
        FROM dbo.FollowupApplications WHERE IsDeleted = 0

        UNION ALL

        SELECT
          'New Booking' AS activity,
          BookingNo,
          'Bookings',
          CreatedBy, CreatedAt
        FROM dbo.FollowupBookings WHERE IsDeleted = 0

        UNION ALL

        SELECT
          'Welcome Call ' + ISNULL(Status, '') AS activity,
          CallNo,
          'WelcomeCalls',
          CreatedBy, CreatedAt
        FROM dbo.FollowupWelcomeCalls WHERE IsDeleted = 0

        UNION ALL

        SELECT
          'Agreement ' + ISNULL(Status, '') AS activity,
          AgreementNo,
          'Agreements',
          CreatedBy, CreatedAt
        FROM dbo.FollowupAgreements WHERE IsDeleted = 0

        UNION ALL

        SELECT
          'Handover ' + ISNULL(Status, '') AS activity,
          HandoverNo,
          'Handover',
          CreatedBy, CreatedAt
        FROM dbo.FollowupHandover WHERE IsDeleted = 0
      ) AS combined
      ORDER BY CreatedAt DESC
    `);

    const summary = result.recordset[0];

    // ── Legal Pending panel ──────────────────────────────────────────────────
    const legalPendingR = await pool.request().query(`
      SELECT TOP 20
        lm.Id, lm.MilestoneNo,
        ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
        lm.CurrentStep,
        lm.OverallStatus,
        CASE lm.CurrentStep
          WHEN 1 THEN lm.DocCollectionDue
          WHEN 2 THEN lm.LegalReviewDue
          WHEN 3 THEN lm.DraftingDue
          WHEN 4 THEN lm.InternalApprovalDue
          WHEN 5 THEN lm.DocSharedDue
          WHEN 6 THEN lm.MutualAgreementDue
          WHEN 7 THEN lm.DirectorMeetingDue
          WHEN 8 THEN lm.FinalExecutionDue
        END AS CurrentStepDue
      FROM dbo.FollowupLegalMilestones lm
      INNER JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = lm.ApplicantId
      WHERE lm.IsDeleted = 0 AND lm.OverallStatus NOT IN ('Completed','Cancelled')
      ORDER BY CurrentStepDue ASC, lm.CreatedAt ASC
    `);

    // ── Milestone Tracker panel ──────────────────────────────────────────────
    const milestoneTrackerR = await pool.request().query(`
      SELECT
        SUM(CASE WHEN OverallStatus = 'Completed'   THEN 1 ELSE 0 END) AS Completed,
        SUM(CASE WHEN OverallStatus = 'In Progress'  THEN 1 ELSE 0 END) AS InProgress,
        SUM(CASE WHEN OverallStatus = 'On Hold'      THEN 1 ELSE 0 END) AS OnHold,
        COUNT(*) AS Total
      FROM dbo.FollowupLegalMilestones WHERE IsDeleted = 0
    `);

    // ── Possession Pipeline panel ────────────────────────────────────────────
    const possessionPipelineR = await pool.request().query(`
      SELECT TOP 20
        pn.Id, pn.NoticeNo,
        ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
        fus.UnitNo,
        CONVERT(VARCHAR(10), pn.ScheduledPossDate, 23) AS ScheduledPossDate,
        pn.NoticeType, pn.Status,
        DATEDIFF(day, CAST(SYSDATETIME() AS DATE), pn.ScheduledPossDate) AS DaysRemaining
      FROM dbo.FollowupPossessionNotices pn
      INNER JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = pn.ApplicantId
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = pn.UnitSelectionId
      WHERE pn.IsDeleted = 0 AND pn.Status NOT IN ('Cancelled')
      ORDER BY pn.ScheduledPossDate ASC
    `);

    res.json({
      ...summary,
      recentActivity: recentResult.recordset,
      legalPending: legalPendingR.recordset,
      milestoneTracker: milestoneTrackerR.recordset[0] ?? {},
      possessionPipeline: possessionPipelineR.recordset,
    });
  } catch (err) {
    console.error("Followup Dashboard summary error:", err.message);
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
});

// ── GET /pipeline ─────────────────────────────────────────────────────────────
// Stage-by-stage funnel count
router.get("/pipeline", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.FollowupApplications WHERE IsDeleted = 0) AS stage1_applications,
        (SELECT COUNT(*) FROM dbo.FollowupBookings      WHERE IsDeleted = 0) AS stage2_bookings,
        (SELECT COUNT(*) FROM dbo.FollowupWelcomeCalls  WHERE IsDeleted = 0 AND Status = 'Completed') AS stage3_welcome_calls,
        (SELECT COUNT(*) FROM dbo.FollowupAgreements    WHERE IsDeleted = 0 AND Status = 'Signed')    AS stage4_agreements,
        (SELECT COUNT(*) FROM dbo.FollowupNOCs           WHERE IsDeleted = 0 AND Status = 'Issued')    AS stage5_noc,
        (SELECT COUNT(*) FROM dbo.FollowupHandover      WHERE IsDeleted = 0 AND Status = 'Completed') AS stage6_handover
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Followup pipeline error:", err.message);
    res.status(500).json({ error: "Failed to load pipeline" });
  }
});

module.exports = router;