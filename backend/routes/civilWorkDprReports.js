"use strict";

/**
 * civilWorkDprReports.js — the reports behind Reports → Civil Work DPR.
 *
 *   GET /api/civilworkdpr-reports/activity-status     every current activity: status, progress, dates, engineers
 *   GET /api/civilworkdpr-reports/overdue             activities past their end date, or ending within 2 days
 *   GET /api/civilworkdpr-reports/engineer-workload   per engineer: activities by status, overdue, average progress
 *   GET /api/civilworkdpr-reports/quality-checks      every QC inspection (approved / rework) with its check results
 *   GET /api/civilworkdpr-reports/daily-updates       daily checkpoint photo updates (date, time logged in IST, who)
 *   GET /api/civilworkdpr-reports/daily-reports       the daily logbook: which work was done where on which day, and how much progress that day
 *
 * Every route answers { data, total, page, totalPages } so the Reports page can page through it (it asks for
 * 500 rows at a time) and export everything. Filters: projectId (one id or a comma-separated list), dateFrom,
 * dateTo (what the date means is
 * stated per report below). Restricted users only ever see the projects in their Project Access.
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { projectPredicate } = require("../services/projectScope");
const { requireAnyPageRight } = require("../middleware/requirePageRight");

const guard = requireAnyPageRight(
  [
    "civilworkdpr-dashboard",
    "civilworkdpr-activity-reporting",
    "civilworkdpr-work-done",
    "civilworkdpr-quality-check",
    "civilworkdpr-work-transfer",
  ],
  "view",
);

const STATUS_VALUES = new Set(["PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "CANCELLED", "APPROVED", "REWORK", "COMPLETED"]);
const OPEN_STATUSES = "'ALLOCATED','IN_PROGRESS','HOLD','REWORK'";
const TODAY = "CAST(GETDATE() AS DATE)";
// End dates before 2000 are placeholders, not real deadlines.
const REAL_END = "daa.EndDate BETWEEN '2000-01-01' AND '2999-12-31'";

const validDate = (v) => (v && !Number.isNaN(Date.parse(v)) ? String(v).slice(0, 10) : null);

function parseCommon(req) {
  // projectId may be one id or a comma-separated list (the Reports screen's project picker is multi-select).
  const projectIds = [
    ...new Set(
      String(req.query.projectId ?? "")
        .split(",")
        .map((x) => parseInt(x.trim(), 10))
        .filter(Number.isInteger),
    ),
  ].slice(0, 200);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return {
    projectIds,
    // ?withTotal=0 — the caller already has the total (page 2+ of the same filters), skip the COUNT(*).
    withTotal: req.query.withTotal !== "0",
    dateFrom: validDate(req.query.dateFrom),
    dateTo: validDate(req.query.dateTo),
    limit,
    page,
    offset: (page - 1) * limit,
  };
}

// Activity -> chain -> project / block / floor / unit / room.
const ACTIVITY_FROM = `
  FROM dbo.DependencyActivityAssignment daa
  JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
  JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
  JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
  LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
  LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
  LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
  LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId`;

const SCOPE_PATH = `CONCAT(
    ISNULL(bm.BlockName, '—'), CASE WHEN dm.Floor = 'G' OR TRY_CAST(dm.Floor AS INT) IS NOT NULL THEN ' > Floor ' ELSE ' > ' END, dm.Floor,
    ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—'))`;

const ENGINEER_NAMES = `(
    SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
    FROM dbo.DependencyActivityEngineer dae JOIN dbo.users u ON u.id = dae.EngineerId
    WHERE dae.AssignmentId = daa.Id)`;

// rungId / chainId let the Reports screen open exactly this activity / chain in Work Allocation, Activity
// Reporting or Work Transfer.
const ACTIVITY_COLUMNS = `
    dma.Id AS rungId,
    dm.Id AS chainId,
    ep.name AS projectName,
    ${SCOPE_PATH} AS location,
    dm.Alias AS chain,
    am.activity_name AS activityName,
    ${ENGINEER_NAMES} AS engineers`;

/** Runs `core` (a SELECT with unique column names) one page at a time, and counts the whole set. */
async function sendPage(res, pool, p, { core, countSql, orderBy, bind }) {
  const rowsReq = pool.request();
  const countReq = pool.request();
  bind(rowsReq);
  bind(countReq);
  rowsReq.input("offset", sql.Int, p.offset).input("limit", sql.Int, p.limit);
  const [rows, count] = await Promise.all([
    rowsReq.query(`${core} ORDER BY ${orderBy} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`),
    p.withTotal ? countReq.query(countSql || `SELECT COUNT(*) AS total FROM (${core}) q`) : null,
  ]);
  if (!count) {
    // No count asked for: report "more pages" only when this page came back full.
    return res.json({ data: rows.recordset, page: p.page, hasMore: rows.recordset.length === p.limit });
  }
  const total = Number(count.recordset[0]?.total || 0);
  res.json({ data: rows.recordset, total, page: p.page, totalPages: Math.max(1, Math.ceil(total / p.limit)) });
}

const fail = (res, label, err) => {
  console.error(`[civilworkdpr-reports] ${label} error:`, err.message);
  res.status(500).json({ error: "Could not load the report." });
};

const bindFilters = (p, extra) => (request) => {
  if (p.dateFrom) request.input("dateFrom", sql.Date, p.dateFrom);
  if (p.dateTo) request.input("dateTo", sql.Date, p.dateTo);
  if (extra) extra(request);
};

const projectConds = (req, p) => {
  const conds = [];
  // Validated integers only, so inlining the list is injection-safe.
  if (p.projectIds.length) conds.push(`dm.ProjectId IN (${p.projectIds.join(",")})`);
  if (req.projectScope) conds.push(projectPredicate(req.projectScope, "dm.ProjectId", "").trim());
  return conds.filter(Boolean);
};

// ── Activity Status ───────────────────────────────────────────────────────────
// Date range = activities whose planned END DATE falls in the range. Optional ?status=.
router.get("/activity-status", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  try {
    const conds = ["daa.IsCurrent = 1", "dm.IsActive = 1", ...projectConds(req, p)];
    if (status && STATUS_VALUES.has(status)) conds.push("daa.Status = @status");
    if (p.dateFrom) conds.push("daa.EndDate >= @dateFrom");
    if (p.dateTo) conds.push("daa.EndDate <= @dateTo");
    const where = `WHERE ${conds.join(" AND ")}`;
    await sendPage(res, await getPool(), p, {
      core: `SELECT daa.Id AS assignmentId, ${ACTIVITY_COLUMNS},
        daa.Status AS status, daa.ProgressPercent AS progressPercent,
        daa.StartDate AS startDate, daa.EndDate AS endDate, daa.AttemptNo AS attemptNo,
        (SELECT TOP 1 qc.Decision FROM dbo.DependencyActivityQc qc WHERE qc.AssignmentId = daa.Id ORDER BY qc.QcAt DESC, qc.Id DESC) AS qcStatus
        ${ACTIVITY_FROM} ${where}`,
      countSql: `SELECT COUNT(*) AS total ${ACTIVITY_FROM} ${where}`,
      orderBy: "ep.name, dm.Id, dma.SequenceNo, daa.Id",
      bind: bindFilters(p, (r) => {
        if (status && STATUS_VALUES.has(status)) r.input("status", sql.NVarChar(20), status);
      }),
    });
  } catch (err) {
    fail(res, "activity-status", err);
  }
});

// ── Overdue & Due Soon ────────────────────────────────────────────────────────
// Open activities (allocated / in progress / hold / rework) past their end date, or ending within 2 days.
// ?scope=overdue | due-soon narrows it. Today's state, so the date range is not used.
router.get("/overdue", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  const scope = req.query.scope === "overdue" || req.query.scope === "due-soon" ? req.query.scope : "all";
  try {
    const conds = ["daa.IsCurrent = 1", "dm.IsActive = 1", `daa.Status IN (${OPEN_STATUSES})`, REAL_END, ...projectConds(req, p)];
    if (scope === "overdue") conds.push(`daa.EndDate < ${TODAY}`);
    else if (scope === "due-soon") conds.push(`daa.EndDate >= ${TODAY}`, `daa.EndDate <= DATEADD(DAY, 2, ${TODAY})`);
    else conds.push(`daa.EndDate <= DATEADD(DAY, 2, ${TODAY})`);
    const where = `WHERE ${conds.join(" AND ")}`;
    await sendPage(res, await getPool(), p, {
      core: `SELECT daa.Id AS assignmentId, ${ACTIVITY_COLUMNS},
        daa.Status AS status, daa.ProgressPercent AS progressPercent, daa.EndDate AS endDate,
        CASE WHEN daa.EndDate < ${TODAY} THEN 'Overdue' ELSE 'Due soon' END AS dueState,
        DATEDIFF(DAY, daa.EndDate, ${TODAY}) AS daysLate
        ${ACTIVITY_FROM} ${where}`,
      countSql: `SELECT COUNT(*) AS total ${ACTIVITY_FROM} ${where}`,
      orderBy: "daa.EndDate, ep.name, daa.Id",
      bind: bindFilters(p),
    });
  } catch (err) {
    fail(res, "overdue", err);
  }
});

// ── Engineer Workload ─────────────────────────────────────────────────────────
// One row per engineer over their CURRENT activities (cancelled ones left out); date range not used.
router.get("/engineer-workload", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  try {
    const conds = ["daa.IsCurrent = 1", "dm.IsActive = 1", "daa.Status <> 'CANCELLED'", ...projectConds(req, p)];
    const count = (status) => `SUM(CASE WHEN daa.Status = '${status}' THEN 1 ELSE 0 END)`;
    await sendPage(res, await getPool(), p, {
      core: `SELECT u.id AS engineerId, u.name AS engineerName,
        COUNT(*) AS total,
        ${count("ALLOCATED")} AS allocated, ${count("IN_PROGRESS")} AS inProgress, ${count("HOLD")} AS onHold,
        ${count("REWORK")} AS rework, ${count("COMPLETED")} AS completed, ${count("APPROVED")} AS approved,
        SUM(CASE WHEN daa.Status IN (${OPEN_STATUSES}) AND daa.EndDate BETWEEN '2000-01-01' AND DATEADD(DAY, -1, ${TODAY}) THEN 1 ELSE 0 END) AS overdue,
        CAST(AVG(CAST(ISNULL(daa.ProgressPercent, 0) AS FLOAT)) AS DECIMAL(5, 1)) AS avgProgress
        FROM dbo.DependencyActivityEngineer dae
        JOIN dbo.users u ON u.id = dae.EngineerId
        JOIN dbo.DependencyActivityAssignment daa ON daa.Id = dae.AssignmentId
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        WHERE ${conds.join(" AND ")}
        GROUP BY u.id, u.name`,
      orderBy: "overdue DESC, total DESC, engineerName",
      bind: bindFilters(p),
    });
  } catch (err) {
    fail(res, "engineer-workload", err);
  }
});

// ── Quality Checks ────────────────────────────────────────────────────────────
// One row per QC inspection (every attempt). Date range = the inspection date.
router.get("/quality-checks", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  try {
    const conds = [...projectConds(req, p)];
    if (p.dateFrom) conds.push("qc.QcAt >= @dateFrom");
    if (p.dateTo) conds.push("qc.QcAt < DATEADD(DAY, 1, @dateTo)");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const from = `
      FROM dbo.DependencyActivityQc qc
      JOIN dbo.DependencyActivityAssignment daa ON daa.Id = qc.AssignmentId
      JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId`;
    await sendPage(res, await getPool(), p, {
      core: `SELECT qc.Id AS qcId, qc.QcAt AS qcAt, qc.Decision AS decision, qc.Remarks AS remarks, qc.QcBy AS qcBy,
        daa.AttemptNo AS attemptNo, ${ACTIVITY_COLUMNS},
        (SELECT COUNT(*) FROM dbo.DependencyActivityQcCheck c WHERE c.QcId = qc.Id) AS checksTotal,
        (SELECT COUNT(*) FROM dbo.DependencyActivityQcCheck c WHERE c.QcId = qc.Id AND c.Passed = 1) AS checksPassed
        ${from} ${where}`,
      countSql: `SELECT COUNT(*) AS total ${from} ${where}`,
      orderBy: "qc.QcAt DESC, qc.Id DESC",
      bind: bindFilters(p),
    });
  } catch (err) {
    fail(res, "quality-checks", err);
  }
});

// ── Daily Checkpoint Updates ──────────────────────────────────────────────────
// One row per daily photo update. Date range = the update date. loggedTime is IST (UTC+5:30)
// whatever timezone the SQL server runs in.
router.get("/daily-updates", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  try {
    const conds = [...projectConds(req, p)];
    if (p.dateFrom) conds.push("cu.UpdateDate >= @dateFrom");
    if (p.dateTo) conds.push("cu.UpdateDate <= @dateTo");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const from = `
      FROM dbo.DependencyActivityCheckpointUpdate cu
      JOIN dbo.DependencyActivityCheckpoint c ON c.Id = cu.AssignmentCheckpointId
      JOIN dbo.DependencyActivityAssignment daa ON daa.Id = c.AssignmentId
      JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId`;
    // [checkpoint] stays bracketed: CHECKPOINT is a reserved word, and unbracketed SQL Server rejects the whole
    // paged query ("Invalid usage of the option NEXT in the FETCH statement").
    await sendPage(res, await getPool(), p, {
      core: `SELECT cu.Id AS updateId, cu.UpdateDate AS updateDate,
        CONVERT(VARCHAR(5), DATEADD(MINUTE, 330 - DATEDIFF(MINUTE, SYSUTCDATETIME(), SYSDATETIME()), COALESCE(cu.UpdatedAt, cu.CreatedAt)), 108) AS loggedTime,
        c.FieldName AS [checkpoint], cu.Note AS note, cu.CreatedBy AS loggedBy,
        CAST(CASE WHEN cu.Photo IS NULL THEN 0 ELSE 1 END AS BIT) AS hasPhoto,
        ${ACTIVITY_COLUMNS}
        ${from} ${where}`,
      countSql: `SELECT COUNT(*) AS total ${from} ${where}`,
      orderBy: "cu.UpdateDate DESC, cu.Id DESC",
      bind: bindFilters(p),
    });
  } catch (err) {
    fail(res, "daily-updates", err);
  }
});

// ── Daily Reports ─────────────────────────────────────────────────────────────
// The daily logbook (dbo.DependencyActivityDailyLog): one row per activity per day it was reported on, grouped
// by project. "Rate" is the progress made that day - the day's progress % minus the previous reported day's
// (the first report counts from 0) - next to the progress reached. Date range = the log date. The day-over-day
// difference is worked out over the whole logbook BEFORE the date filter, so the first day in a range still
// shows its true progress made.
router.get("/daily-reports", authMiddleware, guard, async (req, res) => {
  const p = parseCommon(req);
  try {
    const conds = [...projectConds(req, p)];
    if (p.dateFrom) conds.push("dl.LogDate >= @dateFrom");
    if (p.dateTo) conds.push("dl.LogDate <= @dateTo");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const from = `
      FROM (
        SELECT l.Id, l.DependencyMasterActivityId, l.LogDate, l.ProgressPercent, l.Remarks, l.CreatedBy, l.UpdatedBy,
          CASE WHEN l.ProgressPercent IS NULL THEN NULL
               ELSE l.ProgressPercent - ISNULL(LAG(l.ProgressPercent) OVER (PARTITION BY l.DependencyMasterActivityId ORDER BY l.LogDate), 0)
          END AS ProgressMade
        FROM dbo.DependencyActivityDailyLog l
      ) dl
      JOIN dbo.DependencyMasterActivity dma ON dma.Id = dl.DependencyMasterActivityId
      JOIN dbo.DependencyActivityAssignment daa ON daa.DependencyMasterActivityId = dma.Id AND daa.IsCurrent = 1
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId`;
    await sendPage(res, await getPool(), p, {
      core: `SELECT dl.Id AS logId, dl.LogDate AS logDate, ${ACTIVITY_COLUMNS},
        daa.Status AS status, dl.ProgressPercent AS progressPercent, dl.ProgressMade AS progressMade,
        dl.Remarks AS remarks, COALESCE(dl.UpdatedBy, dl.CreatedBy) AS loggedBy
        ${from} ${where}`,
      countSql: `SELECT COUNT(*) AS total ${from} ${where}`,
      orderBy: "ep.name, dl.LogDate DESC, dm.Id, dma.SequenceNo, dl.Id DESC",
      bind: bindFilters(p),
    });
  } catch (err) {
    fail(res, "daily-reports", err);
  }
});

module.exports = router;
module.exports._test = { parseCommon, validDate };
