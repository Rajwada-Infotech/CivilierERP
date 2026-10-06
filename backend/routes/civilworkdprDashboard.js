const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const { projectPredicate } = require("../services/projectScope");
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
    // Project scoping: a restricted user's tiles/feeds only count their projects.
    const scope = req.projectScope;
    const caProject = projectPredicate(scope, "ProjectId");
    const dmProject = projectPredicate(scope, "dm.ProjectId");
    const rungInScope = scope
      ? `AND DependencyMasterActivityId IN (SELECT dma2.Id FROM dbo.DependencyMasterActivity dma2 JOIN dbo.DependencyMaster dm2 ON dm2.Id = dma2.DependencyMasterId WHERE 1=1${projectPredicate(scope, "dm2.ProjectId")})`
      : "";

    const [
      activityStats,
      allocationStats,
      labourStats,
      assignedWorkStats,
      recentAssignments,
      assignedTimeline,
      completedTimeline,
      currentByStatus,
      pace,
      qcSplit,
      projectRows,
      overdueRows,
      engineerRows,
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
        WHERE 1=1${caProject}
      `),

      // ── Daily Labour (today) ────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          ISNULL(SUM(SkilledLabourCount), 0)                                    AS SkilledToday,
          ISNULL(SUM(UnskilledLabourCount), 0)                                  AS UnskilledToday,
          COUNT(DISTINCT AllocationId)                                          AS CrewsToday
        FROM dbo.DailyLabourEntry
        WHERE CAST(EntryDate AS DATE) = CAST(GETDATE() AS DATE)${scope ? ` AND AllocationId IN (SELECT AllocationId FROM dbo.ContractorAllocation WHERE 1=1${caProject})` : ""}
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
        WHERE 1=1 ${rungInScope}
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
        WHERE 1=1${dmProject}
        ORDER BY daa.UpdatedAt DESC
      `),

      // ── Assignments created per day, last 14 days ───────────────────────────
      pool.request().query(`
        SELECT CAST(CreatedAt AS DATE) AS Day, COUNT(*) AS Cnt
        FROM dbo.DependencyActivityAssignment
        WHERE CAST(CreatedAt AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE)) ${rungInScope}
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
          AND CAST(UpdatedAt AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE)) ${rungInScope}
        GROUP BY CAST(UpdatedAt AS DATE)
      `),

      // ── What's live NOW: only each activity's CURRENT attempt (the queries above count every attempt,
      // so a reworked activity shows up twice there). ─────────────────────────────────────────────────
      pool.request().query(`
        SELECT Status, COUNT(*) AS Cnt
        FROM dbo.DependencyActivityAssignment
        WHERE IsCurrent = 1 ${rungInScope}
        GROUP BY Status
      `),

      // Overdue / due soon / average progress / this week vs last week — current attempts only.
      pool.request().query(`
        SELECT
          COUNT(CASE WHEN Status IN ('ALLOCATED','IN_PROGRESS','HOLD','REWORK')
                      AND EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE)) THEN 1 END)                   AS Overdue,
          COUNT(CASE WHEN Status IN ('ALLOCATED','IN_PROGRESS','HOLD')
                      AND EndDate >= CAST(GETDATE() AS DATE)
                      AND EndDate <= DATEADD(DAY, 2, CAST(GETDATE() AS DATE)) THEN 1 END) AS DueSoon,
          AVG(CASE WHEN Status IN ('IN_PROGRESS','HOLD') THEN CAST(ISNULL(ProgressPercent, 0) AS FLOAT) END) AS AvgProgress,
          COUNT(CASE WHEN Status IN ('COMPLETED','APPROVED')
                      AND UpdatedAt >= DATEADD(DAY, -6, CAST(GETDATE() AS DATE)) THEN 1 END)  AS DoneThisWeek,
          COUNT(CASE WHEN Status IN ('COMPLETED','APPROVED')
                      AND UpdatedAt >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
                      AND UpdatedAt <  DATEADD(DAY, -6, CAST(GETDATE() AS DATE)) THEN 1 END)  AS DoneLastWeek
        FROM dbo.DependencyActivityAssignment
        WHERE IsCurrent = 1 ${rungInScope}
      `),

      // Completed work, split into "waiting for Quality Check" and "QC passed, waiting for approval".
      pool.request().query(`
        SELECT
          COUNT(*)                                                    AS Completed,
          COUNT(CASE WHEN qc.AssignmentId IS NULL THEN 1 END)          AS AwaitingQc
        FROM dbo.DependencyActivityAssignment daa
        LEFT JOIN (SELECT DISTINCT AssignmentId FROM dbo.DependencyActivityQc WHERE Decision = 'APPROVED') qc
               ON qc.AssignmentId = daa.Id
        WHERE daa.IsCurrent = 1 AND daa.Status = 'COMPLETED' ${rungInScope}
      `),

      // Progress by project — biggest first.
      pool.request().query(`
        SELECT TOP 6
          ep.name AS ProjectName,
          COUNT(*) AS Total,
          COUNT(CASE WHEN daa.Status IN ('COMPLETED','APPROVED') THEN 1 END) AS Done,
          COUNT(CASE WHEN daa.Status = 'IN_PROGRESS' THEN 1 END) AS InProgress,
          COUNT(CASE WHEN daa.Status IN ('ALLOCATED','IN_PROGRESS','HOLD','REWORK')
                      AND daa.EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE)) THEN 1 END) AS Overdue,
          AVG(CAST(CASE WHEN daa.Status IN ('COMPLETED','APPROVED') THEN 100 ELSE ISNULL(daa.ProgressPercent, 0) END AS FLOAT)) AS AvgProgress
        FROM dbo.DependencyActivityAssignment daa
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        WHERE daa.IsCurrent = 1 AND daa.Status <> 'CANCELLED'${dmProject}
        GROUP BY ep.name
        ORDER BY COUNT(*) DESC
      `),

      // The five most overdue activities.
      pool.request().query(`
        SELECT TOP 5
          daa.DependencyMasterActivityId AS RungId,
          am.activity_name               AS ActivityName,
          ep.name                        AS ProjectName,
          CONCAT(ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor, ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—')) AS ScopePath,
          daa.Status                     AS Status,
          daa.EndDate                    AS EndDate,
          DATEDIFF(DAY, daa.EndDate, CAST(GETDATE() AS DATE)) AS DaysOverdue,
          ISNULL(daa.ProgressPercent, 0) AS ProgressPercent,
          (
            SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
            FROM dbo.DependencyActivityEngineer dae
            JOIN dbo.users u ON u.id = dae.EngineerId
            WHERE dae.AssignmentId = daa.Id
          )                              AS EngineerNames
        FROM dbo.DependencyActivityAssignment daa
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
        LEFT JOIN dbo.UnitMaster um ON um.Id = dm.FlatId
        LEFT JOIN dbo.RoomMaster rm ON rm.Id = dm.RoomId
        WHERE daa.IsCurrent = 1
          AND daa.Status IN ('ALLOCATED','IN_PROGRESS','HOLD','REWORK')
          AND daa.EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE))${dmProject}
        ORDER BY daa.EndDate ASC
      `),

      // Who's carrying the most live work, and how much of it is late.
      pool.request().query(`
        SELECT TOP 5
          u.name AS Name,
          COUNT(*) AS Active,
          COUNT(CASE WHEN daa.EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE)) THEN 1 END) AS Overdue
        FROM dbo.DependencyActivityAssignment daa
        JOIN dbo.DependencyActivityEngineer dae ON dae.AssignmentId = daa.Id
        JOIN dbo.users u ON u.id = dae.EngineerId
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        WHERE daa.IsCurrent = 1 AND daa.Status IN ('ALLOCATED','IN_PROGRESS','HOLD','REWORK')${dmProject}
        GROUP BY u.name
        ORDER BY COUNT(*) DESC
      `),
    ]);

    const act = activityStats.recordset[0];
    const alloc = allocationStats.recordset[0];
    const labour = labourStats.recordset[0];

    const currentMap = {};
    let total = 0;
    for (const row of currentByStatus.recordset) {
      currentMap[row.Status] = row.Cnt;
      total += row.Cnt;
    }
    const totalExCancelled = total - (currentMap.CANCELLED || 0);
    const pc = pace.recordset[0];
    const qcs = qcSplit.recordset[0];

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
      // Live picture (current attempts only) — what the mobile dashboard is built on.
      current: {
        total,
        byStatus: currentMap,
        active: (currentMap.ALLOCATED || 0) + (currentMap.IN_PROGRESS || 0) + (currentMap.HOLD || 0) + (currentMap.REWORK || 0),
        completionRate: totalExCancelled ? Math.round((((currentMap.COMPLETED || 0) + (currentMap.APPROVED || 0)) / totalExCancelled) * 100) : 0,
      },
      insights: {
        overdue: pc.Overdue,
        dueSoon: pc.DueSoon,
        avgProgress: pc.AvgProgress == null ? null : Math.round(pc.AvgProgress),
        doneThisWeek: pc.DoneThisWeek,
        doneLastWeek: pc.DoneLastWeek,
        awaitingQc: qcs.AwaitingQc,
        awaitingApproval: Math.max(0, qcs.Completed - qcs.AwaitingQc),
      },
      projects: projectRows.recordset.map((r) => ({
        name: r.ProjectName || "Unassigned",
        total: r.Total,
        done: r.Done,
        inProgress: r.InProgress,
        overdue: r.Overdue,
        avgProgress: Math.round(r.AvgProgress || 0),
      })),
      overdueList: overdueRows.recordset.map((r) => ({
        rungId: r.RungId,
        activityName: r.ActivityName,
        projectName: r.ProjectName,
        scopePath: r.ScopePath,
        status: r.Status,
        endDate: r.EndDate,
        daysOverdue: r.DaysOverdue,
        progressPercent: r.ProgressPercent,
        engineerNames: r.EngineerNames,
      })),
      engineerLoad: engineerRows.recordset.map((r) => ({ name: r.Name, active: r.Active, overdue: r.Overdue })),
      assignmentTimeline,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("CIVIL WORK DPR DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
