const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
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
 *   - Daily labour today (dbo.DailyLabourEntry)
 *   - Work Reporting's rung-level assignments (dbo.DependencyActivityAssignment)
 *     — recent feed + status breakdown
 *
 * dbo.WorkProgress used to back this dashboard's "recent progress" feed, but
 * no page writes to that table anymore (Work Reporting's dependency-chain
 * flow replaced it) — pulling from it here just meant showing frozen,
 * un-updatable history. Dropped in favor of the real, currently-writable
 * DependencyActivityAssignment feed below.
 *
 * No caching — the frontend polls this on a short interval for a
 * near-realtime feel, so a 60s+ cache would just show stale counts.
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const [
      activityStats,
      allocationStats,
      labourStats,
      assignedWorkStats,
      recentAssignments,
      assignedTimeline,
      completedTimeline,
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

      // ── Daily Labour (today) ────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          ISNULL(SUM(SkilledLabourCount), 0)                                    AS SkilledToday,
          ISNULL(SUM(UnskilledLabourCount), 0)                                  AS UnskilledToday,
          COUNT(DISTINCT AllocationId)                                          AS CrewsToday
        FROM dbo.DailyLabourEntry
        WHERE CAST(EntryDate AS DATE) = CAST(GETDATE() AS DATE)
      `),

      // ── Work Reporting's rung-level assignments (engineer/material,
      // tracked through Pending → ... → Completed) ────────────────────────────
      pool.request().query(`
        SELECT
          Status,
          COUNT(*)                                                              AS StatusCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount
        FROM dbo.DependencyActivityAssignment
        GROUP BY Status
      `),

      // ── Recent assignment feed (last 8) ─────────────────────────────────────
      pool.request().query(`
        SELECT TOP 8
          daa.Id             AS Id,
          am.activity_name   AS ActivityName,
          (
            SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
            FROM dbo.DependencyActivityEngineer dae
            JOIN dbo.users u ON u.id = dae.EngineerId
            WHERE dae.AssignmentId = daa.Id
          )                  AS EngineerNames,
          dm.Alias           AS ChainAlias,
          ep.name            AS ProjectName,
          daa.Status         AS Status,
          daa.UpdatedAt       AS UpdatedAt
        FROM dbo.DependencyActivityAssignment daa
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        ORDER BY daa.UpdatedAt DESC
      `),

      // ── Assignments created per day, last 14 days ───────────────────────────
      pool.request().query(`
        SELECT CAST(CreatedAt AS DATE) AS Day, COUNT(*) AS Cnt
        FROM dbo.DependencyActivityAssignment
        WHERE CAST(CreatedAt AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(CreatedAt AS DATE)
      `),

      // ── Assignments that reached Completed per day, last 14 days — UpdatedAt
      // is the closest proxy available since there's no dedicated
      // CompletedAt column (status can move between any two states). ────────
      pool.request().query(`
        SELECT CAST(UpdatedAt AS DATE) AS Day, COUNT(*) AS Cnt
        FROM dbo.DependencyActivityAssignment
        WHERE Status = 'COMPLETED'
          AND UpdatedAt IS NOT NULL
          AND CAST(UpdatedAt AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(UpdatedAt AS DATE)
      `),
    ]);

    const act = activityStats.recordset[0];
    const alloc = allocationStats.recordset[0];
    const labour = labourStats.recordset[0];

    // One row per status, each carrying its own today-count (rows created
    // today under that status) — sum both across rows for the totals.
    const assignedWorkByStatus = {};
    let assignedWorkTotal = 0;
    let assignedWorkToday = 0;
    for (const row of assignedWorkStats.recordset) {
      assignedWorkByStatus[row.Status] = row.StatusCount;
      assignedWorkTotal += row.StatusCount;
      assignedWorkToday += row.TodayCount;
    }

    // Zero-fill all 14 days — the GROUP BY queries above only return days
    // that actually had activity, so gaps would otherwise break the line.
    const assignedByDay = new Map(
      assignedTimeline.recordset.map((r) => [r.Day.toISOString().slice(0, 10), r.Cnt]),
    );
    const completedByDay = new Map(
      completedTimeline.recordset.map((r) => [r.Day.toISOString().slice(0, 10), r.Cnt]),
    );
    const assignmentTimeline = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      assignmentTimeline.push({
        date: key,
        assigned: assignedByDay.get(key) ?? 0,
        completed: completedByDay.get(key) ?? 0,
      });
    }

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
      labour: {
        skilledToday: labour.SkilledToday,
        unskilledToday: labour.UnskilledToday,
        totalToday: labour.SkilledToday + labour.UnskilledToday,
        crewsToday: labour.CrewsToday,
      },
      assignedWork: {
        totalCount: assignedWorkTotal,
        todayCount: assignedWorkToday,
        pendingCount: assignedWorkByStatus.PENDING || 0,
        inProgressCount: assignedWorkByStatus.IN_PROGRESS || 0,
        completedCount: assignedWorkByStatus.COMPLETED || 0,
        holdCount: assignedWorkByStatus.HOLD || 0,
        cancelledCount: assignedWorkByStatus.CANCELLED || 0,
        approvedCount: assignedWorkByStatus.APPROVED || 0,
        reworkCount: assignedWorkByStatus.REWORK || 0,
      },
      recentAssignments: recentAssignments.recordset,
      assignmentTimeline,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("CIVIL WORK DPR DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
