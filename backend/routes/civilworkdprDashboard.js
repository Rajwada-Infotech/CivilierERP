const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool } = require("../db");
// No extra permission gate here — /api routes are already protected by
// authMiddleware at the server level. Any authenticated user granted Civil
// Work DPR rights can view aggregate dashboard stats.

/**
 * GET /api/civilworkdpr-dashboard
 *
 * Live aggregates for the Civil Work DPR module:
 *   - Activities (dbo.ActivityMaster, activity_type = 1)
 *   - Contractor allocations (dbo.ContractorAllocation)
 *   - Work progress entries + review queue (dbo.WorkProgress)
 *   - Daily labour today (dbo.DailyLabourEntry)
 *   - Recent progress feed + status breakdown
 *
 * No caching — the frontend polls this on a short interval for a
 * near-realtime feel, so a 60s+ cache would just show stale review counts.
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const [
      activityStats,
      allocationStats,
      progressStats,
      labourStats,
      recentProgress,
      statusBreakdown,
    ] = await Promise.all([
      // ── Activities ──────────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                            AS TotalCount,
          COUNT(CASE WHEN ISNULL(is_active, 1) = 1 THEN 1 END) AS ActiveCount
        FROM dbo.ActivityMaster
        WHERE activity_type = 1
      `),

      // ── Contractor Allocations ──────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(DISTINCT ProjectId)                                             AS ProjectCount,
          COUNT(DISTINCT ContractorLHeadId)                                     AS WorkerCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          COUNT(CASE WHEN IsAcknowledged = 0 AND StartDate IS NULL THEN 1 END) AS NewCount
        FROM dbo.ContractorAllocation
      `),

      // ── Work Progress ────────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN ReviewStatus = 'Pending' THEN 1 END)                  AS PendingReviewCount,
          COUNT(CASE WHEN ReviewStatus = 'Approved' THEN 1 END)                 AS ApprovedCount,
          COUNT(CASE WHEN ReviewStatus = 'Rejected' THEN 1 END)                 AS RejectedCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount
        FROM dbo.WorkProgress
      `),

      // ── Daily Labour (today) ────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          ISNULL(SUM(SkilledLabourCount), 0)                                    AS SkilledToday,
          ISNULL(SUM(UnskilledLabourCount), 0)                                  AS UnskilledToday,
          COUNT(DISTINCT AllocationId)                                          AS CrewsToday
        FROM dbo.DailyLabourEntry
        WHERE CAST(EntryDate AS DATE) = CAST(GETDATE() AS DATE)
      `),

      // ── Recent progress feed (last 8) ───────────────────────────────────────
      pool.request().query(`
        SELECT TOP 8
          wp.WorkProgressId AS Id,
          act.activity_name  AS ActivityName,
          ahm.LHeadName      AS ContractorName,
          pr.name            AS ProjectName,
          CASE WHEN ISNULL(wp.QuantityPlanned, 0) > 0
               THEN ROUND((ISNULL(wp.QuantityCompleted, 0) / wp.QuantityPlanned) * 100, 0)
               ELSE 0 END    AS PercentageProgress,
          wp.CurrentStatus   AS CurrentStatus,
          wp.ReviewStatus    AS ReviewStatus,
          wp.CreatedAt       AS CreatedAt
        FROM dbo.WorkProgress wp
        JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wp.AllocationId
        LEFT JOIN dbo.ActivityMaster act ON act.id = ca.ActivityId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
        LEFT JOIN dbo.enterprise pr ON pr.id = ca.ProjectId
        ORDER BY wp.CreatedAt DESC
      `),

      // ── Status breakdown across all progress entries ───────────────────────
      pool.request().query(`
        SELECT ISNULL(CurrentStatus, 'Not Started') AS Status, COUNT(*) AS Count
        FROM dbo.WorkProgress
        GROUP BY ISNULL(CurrentStatus, 'Not Started')
      `),
    ]);

    const act = activityStats.recordset[0];
    const alloc = allocationStats.recordset[0];
    const prog = progressStats.recordset[0];
    const labour = labourStats.recordset[0];

    res.json({
      activities: {
        totalCount: act.TotalCount,
        activeCount: act.ActiveCount,
      },
      allocations: {
        totalCount: alloc.TotalCount,
        projectCount: alloc.ProjectCount,
        workerCount: alloc.WorkerCount,
        todayCount: alloc.TodayCount,
        newCount: alloc.NewCount,
      },
      progress: {
        totalCount: prog.TotalCount,
        pendingReviewCount: prog.PendingReviewCount,
        approvedCount: prog.ApprovedCount,
        rejectedCount: prog.RejectedCount,
        todayCount: prog.TodayCount,
      },
      labour: {
        skilledToday: labour.SkilledToday,
        unskilledToday: labour.UnskilledToday,
        totalToday: labour.SkilledToday + labour.UnskilledToday,
        crewsToday: labour.CrewsToday,
      },
      recentProgress: recentProgress.recordset,
      statusBreakdown: statusBreakdown.recordset,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("CIVIL WORK DPR DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
