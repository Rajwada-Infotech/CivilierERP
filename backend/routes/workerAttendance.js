const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// dbo.Worker — stable worker identity tied to a Contractor/company.
//
// dbo.WorkerAttendance — one Present/Absent/Half-day status per worker per
// calendar day PER ACTIVITY (dbo.DependencyMasterActivity — a "rung" in the
// Company -> Project -> Tower/Floor/Flat/Room -> Activity dependency chain,
// same entity Civil Work DPR's "Assigned Activities" page shows). A worker
// on two activities the same day gets two independent attendance rows —
// see migration 364's UQ_WorkerAttendance_Worker_Activity_Date.
//
// dbo.WorkerActivityRoster — the persistent "which workers are assigned to
// this activity" list, populated via "+ Add Worker" — a worker added once
// keeps showing up on every subsequent day's attendance form without being
// re-added, matching a real labour roster rather than re-picking daily.

router.use(authMiddleware);

const PAGE_KEY = "civilworkdpr-worker-attendance";
const STATUS_VALUES = new Set(["P", "A", "H"]);

const cleanStr = (v, len = 300) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

function actorOf(req) {
  return req.user?.email || req.user?.name || "system";
}

// ─── GET /activities — rungs (DependencyMasterActivity) for a project, for
//     the Activity dropdown. Same join shape as dependencyActivityAssignment
//     .js's GET / — reused here rather than re-derived, so the Activity
//     label ("Electrical — Room 101") matches what Activity Reporting shows.
router.get("/activities", async (req, res) => {
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  try {
    const pool = getPool();
    const r = await pool.request().input("projectId", sql.Int, projectId).query(`
      SELECT
        dma.Id AS rungId,
        dma.SequenceNo AS sequenceNo,
        am.activity_name AS activityName,
        dm.Id AS dependencyMasterId, dm.Alias AS alias,
        dm.ProjectId AS projectId,
        bm.BlockName AS towerName, dm.Floor AS floor,
        um.UnitName AS flatName, rm.RoomName AS roomName,
        CONCAT(
          dm.Alias, ' — ', am.activity_name, ' (',
          ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor, ' > ',
          ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—'), ')'
        ) AS label,
        (SELECT COUNT(*) FROM dbo.WorkerActivityRoster war WHERE war.DependencyMasterActivityId = dma.Id AND war.IsActive = 1) AS rosterCount
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId
      WHERE dm.ProjectId = @projectId AND dm.IsActive = 1
      ORDER BY dm.Alias, dma.SequenceNo
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("WorkerAttendance /activities error:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

// ─── GET /workers — search across all workers (for the "+ Add Worker"
//     picker) — not activity-scoped, since the point is finding a worker to
//     ADD to an activity's roster in the first place.
router.get("/workers", async (req, res) => {
  try {
    const pool = getPool();
    const search = req.query.search ? `%${req.query.search}%` : null;
    const contractorId = req.query.contractorId ? parseInt(req.query.contractorId, 10) : null;
    const r = await pool.request()
      .input("search", sql.NVarChar, search)
      .input("contractorId", sql.Int, contractorId)
      .query(`
        SELECT TOP 100 w.WorkerId AS id, w.Name AS name, w.SkillType AS skillType,
               w.AadhaarNo AS aadhaarNo, ahm.LHeadName AS contractorName
        FROM dbo.Worker w
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
        WHERE w.IsActive = 1
          AND (@search IS NULL OR w.Name LIKE @search OR w.AadhaarNo LIKE @search)
          AND (@contractorId IS NULL OR w.ContractorLHeadId = @contractorId)
        ORDER BY w.Name
      `);
    res.json(r.recordset);
  } catch (err) {
    console.error("WorkerAttendance /workers error:", err);
    res.status(500).json({ error: "Failed to search workers" });
  }
});

// ─── POST /workers — create a new Worker (used by the "+ Add Worker"
//     picker when the search finds no existing match). Aadhaar is the real
//     dedup key — most workers here are casual labour re-registered from
//     scratch every time they come back (see workerRetentionService.js), so
//     the Aadhaar number is what stops the same person from picking up two
//     rows if they're re-added mid-engagement rather than actually purged. ─
router.post("/workers", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { name, contractorId, skillType, aadhaarNo } = req.body;
  if (!name || !contractorId) return res.status(400).json({ error: "Worker name and contractor are required" });
  const aadhaar = String(aadhaarNo || "").replace(/\s/g, "");
  if (!/^\d{12}$/.test(aadhaar)) return res.status(400).json({ error: "A valid 12-digit Aadhaar number is required" });

  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("aadhaar", sql.Char(12), aadhaar)
      .query(`SELECT WorkerId AS id FROM dbo.Worker WHERE AadhaarNo = @aadhaar`);
    if (existing.recordset.length) return res.status(200).json({ id: existing.recordset[0].id, existed: true });

    const inserted = await pool.request()
      .input("name", sql.NVarChar, cleanStr(name, 150))
      .input("contractorId", sql.Int, contractorId)
      .input("skillType", sql.NVarChar, cleanStr(skillType, 20) || "Skilled")
      .input("aadhaar", sql.Char(12), aadhaar)
      .input("createdBy", sql.NVarChar, actorOf(req))
      .query(`
        INSERT INTO dbo.Worker (Name, ContractorLHeadId, SkillType, AadhaarNo, CreatedBy, CreatedAt)
        OUTPUT INSERTED.WorkerId AS id
        VALUES (@name, @contractorId, @skillType, @aadhaar, @createdBy, GETDATE())
      `);
    res.status(201).json({ id: inserted.recordset[0].id, existed: false });
  } catch (err) {
    if (err?.number === 2627 || err?.number === 2601) {
      return res.status(409).json({ error: "A worker with this Aadhaar number is already registered" });
    }
    console.error("WorkerAttendance POST /workers error:", err);
    res.status(500).json({ error: "Failed to create worker" });
  }
});

// ─── GET /roster/:rungId — workers currently assigned to this activity ─────
router.get("/roster/:rungId", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!rungId) return res.status(400).json({ error: "Invalid rungId" });
  try {
    const pool = getPool();
    const r = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT w.WorkerId AS id, w.Name AS name, w.SkillType AS skillType,
             ahm.LHeadName AS contractorName
      FROM dbo.WorkerActivityRoster war
      JOIN dbo.Worker w ON w.WorkerId = war.WorkerId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
      WHERE war.DependencyMasterActivityId = @rungId AND war.IsActive = 1
      ORDER BY w.Name
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("WorkerAttendance /roster error:", err);
    res.status(500).json({ error: "Failed to fetch roster" });
  }
});

// ─── POST /roster/:rungId — add worker(s) to an activity's roster ──────────
router.post("/roster/:rungId", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!rungId) return res.status(400).json({ error: "Invalid rungId" });
  const workerIds = Array.isArray(req.body?.workerIds) ? req.body.workerIds.map((n) => parseInt(n, 10)).filter(Boolean) : [];
  if (!workerIds.length) return res.status(400).json({ error: "workerIds is required" });

  try {
    const pool = getPool();
    const actor = actorOf(req);
    for (const workerId of workerIds) {
      const already = await pool.request()
        .input("workerId", sql.Int, workerId)
        .input("rungId", sql.Int, rungId)
        .query(`SELECT RosterId FROM dbo.WorkerActivityRoster WHERE WorkerId = @workerId AND DependencyMasterActivityId = @rungId`);
      if (already.recordset.length) {
        await pool.request().input("id", sql.Int, already.recordset[0].RosterId)
          .query(`UPDATE dbo.WorkerActivityRoster SET IsActive = 1 WHERE RosterId = @id`);
      } else {
        await pool.request()
          .input("workerId", sql.Int, workerId)
          .input("rungId", sql.Int, rungId)
          .input("createdBy", sql.NVarChar, actor)
          .query(`
            INSERT INTO dbo.WorkerActivityRoster (WorkerId, DependencyMasterActivityId, CreatedBy, CreatedAt)
            VALUES (@workerId, @rungId, @createdBy, GETDATE())
          `);
      }
    }
    res.status(201).json({ success: true, added: workerIds.length });
  } catch (err) {
    console.error("WorkerAttendance POST /roster error:", err);
    res.status(500).json({ error: "Failed to add worker(s) to roster" });
  }
});

// ─── DELETE /roster/:rungId/:workerId — remove a worker from an activity's
//     roster (soft — keeps past attendance history intact) ─────────────────
router.delete("/roster/:rungId/:workerId", requirePageRight(PAGE_KEY, "delete"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  const workerId = parseInt(req.params.workerId, 10);
  if (!rungId || !workerId) return res.status(400).json({ error: "Invalid rungId/workerId" });
  try {
    const pool = getPool();
    await pool.request().input("rungId", sql.Int, rungId).input("workerId", sql.Int, workerId).query(`
      UPDATE dbo.WorkerActivityRoster SET IsActive = 0
      WHERE DependencyMasterActivityId = @rungId AND WorkerId = @workerId
    `);
    res.json({ success: true });
  } catch (err) {
    console.error("WorkerAttendance DELETE /roster error:", err);
    res.status(500).json({ error: "Failed to remove worker from roster" });
  }
});

// ─── GET /attendance?rungId=&date=YYYY-MM-DD — the activity's roster merged
//     with that date's saved attendance (roster members with no saved row
//     yet come back with status: null, so the frontend can default them). ──
router.get("/attendance", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const rungId = parseInt(req.query.rungId, 10);
  const date = req.query.date;
  if (!rungId) return res.status(400).json({ error: "rungId is required" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  try {
    const pool = getPool();
    const r = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("date", sql.Date, date)
      .query(`
        SELECT w.WorkerId AS workerId, w.Name AS workerName, w.SkillType AS skillType,
               ahm.LHeadName AS contractorName,
               wa.AttendanceId AS attendanceId, wa.Status AS status, wa.Remarks AS remarks
        FROM dbo.WorkerActivityRoster war
        JOIN dbo.Worker w ON w.WorkerId = war.WorkerId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
        LEFT JOIN dbo.WorkerAttendance wa
          ON wa.WorkerId = war.WorkerId AND wa.DependencyMasterActivityId = war.DependencyMasterActivityId
          AND wa.AttendanceDate = @date
        WHERE war.DependencyMasterActivityId = @rungId AND war.IsActive = 1
        ORDER BY w.Name
      `);
    res.json(r.recordset);
  } catch (err) {
    console.error("WorkerAttendance GET /attendance error:", err);
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

// ─── POST /attendance — bulk upsert one day's statuses for an activity ─────
router.post("/attendance", requirePageRight(PAGE_KEY, "create"), async (req, res) => {
  const { rungId, date, entries } = req.body;
  const rungIdVal = parseInt(rungId, 10);
  if (!rungIdVal) return res.status(400).json({ error: "rungId is required" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "entries is required" });
  for (const e of entries) {
    if (!STATUS_VALUES.has(e.status)) return res.status(400).json({ error: "Each entry's status must be P, A, or H" });
  }

  try {
    const pool = getPool();
    const actor = actorOf(req);
    let saved = 0;
    for (const entry of entries) {
      const workerId = parseInt(entry.workerId, 10);
      if (!workerId) continue;
      const remarks = cleanStr(entry.remarks);

      const existing = await pool.request()
        .input("workerId", sql.Int, workerId)
        .input("rungId", sql.Int, rungIdVal)
        .input("date", sql.Date, date)
        .query(`
          SELECT AttendanceId FROM dbo.WorkerAttendance
          WHERE WorkerId = @workerId AND DependencyMasterActivityId = @rungId AND AttendanceDate = @date
        `);

      if (existing.recordset.length) {
        await pool.request()
          .input("id", sql.Int, existing.recordset[0].AttendanceId)
          .input("status", sql.Char(1), entry.status)
          .input("remarks", sql.NVarChar, remarks)
          .input("updatedBy", sql.NVarChar, actor)
          .query(`
            UPDATE dbo.WorkerAttendance SET Status = @status, Remarks = @remarks,
              UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
            WHERE AttendanceId = @id
          `);
      } else {
        await pool.request()
          .input("workerId", sql.Int, workerId)
          .input("rungId", sql.Int, rungIdVal)
          .input("date", sql.Date, date)
          .input("status", sql.Char(1), entry.status)
          .input("remarks", sql.NVarChar, remarks)
          .input("createdBy", sql.NVarChar, actor)
          .query(`
            INSERT INTO dbo.WorkerAttendance
              (WorkerId, DependencyMasterActivityId, AttendanceDate, Status, Remarks, CreatedBy, CreatedAt)
            VALUES (@workerId, @rungId, @date, @status, @remarks, @createdBy, GETDATE())
          `);
      }
      saved++;
    }
    res.json({ success: true, saved });
  } catch (err) {
    console.error("WorkerAttendance POST /attendance error:", err);
    res.status(500).json({ error: "Failed to save attendance" });
  }
});

// ─── GET /report — flat rows for the Reports page (Activity-wise /
//     Worker-wise / Project-wise summaries are all derivable client-side
//     from this one flat list, same as Reports.tsx's other ReportDefs). ────
router.get("/report", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const rungId = req.query.activityId ? parseInt(req.query.activityId, 10) : null;
    const workerId = req.query.workerId ? parseInt(req.query.workerId, 10) : null;
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;

    const r = await pool.request()
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("rungId", sql.Int, rungId)
      .input("workerId", sql.Int, workerId)
      .input("status", sql.Char(1), status)
      .input("dateFrom", sql.Date, dateFrom)
      .input("dateTo", sql.Date, dateTo)
      .query(`
        SELECT
          wa.AttendanceId AS id,
          wa.AttendanceDate AS date,
          wa.Status AS status,
          w.WorkerId AS workerId, w.Name AS workerName,
          ahm.LHeadName AS contractorName,
          dma.Id AS activityId, am.activity_name AS activityName,
          dm.Alias AS dependencyAlias,
          CONCAT(dm.Alias, ' — ', am.activity_name) AS activityLabel,
          dm.ProjectId AS projectId, ep.name AS projectName,
          ep.company_id AS companyId, ec.name AS companyName
        FROM dbo.WorkerAttendance wa
        JOIN dbo.Worker w ON w.WorkerId = wa.WorkerId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = wa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        LEFT JOIN dbo.enterprise ec ON ec.id = ep.company_id AND ec.business_type = 'C'
        WHERE wa.DependencyMasterActivityId IS NOT NULL
          AND (@projectId IS NULL OR dm.ProjectId = @projectId)
          AND (@companyId IS NULL OR ep.company_id = @companyId)
          AND (@rungId IS NULL OR dma.Id = @rungId)
          AND (@workerId IS NULL OR w.WorkerId = @workerId)
          AND (@status IS NULL OR wa.Status = @status)
          AND (@dateFrom IS NULL OR wa.AttendanceDate >= @dateFrom)
          AND (@dateTo IS NULL OR wa.AttendanceDate <= @dateTo)
        ORDER BY wa.AttendanceDate DESC, w.Name
      `);
    res.json(r.recordset);
  } catch (err) {
    console.error("WorkerAttendance /report error:", err);
    res.status(500).json({ error: "Failed to fetch attendance report" });
  }
});

// ─── GET /workers/:id/calendar?month=YYYY-MM — one worker's attendance for
//     a month, across every activity ─────────────────────────────────────
router.get("/workers/:id/calendar", requirePageRight(PAGE_KEY, "view"), async (req, res) => {
  const workerId = parseInt(req.params.id, 10);
  if (isNaN(workerId)) return res.status(400).json({ error: "Invalid worker id" });

  const month = req.query.month; // "YYYY-MM"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month must be in YYYY-MM format" });
  }

  try {
    const pool = getPool();
    const result = await pool.request()
      .input("workerId", sql.Int, workerId)
      .input("from", sql.Date, `${month}-01`)
      .query(`
        SELECT
          wa.AttendanceId   AS id,
          wa.AttendanceDate AS date,
          wa.Status         AS status,
          wa.Remarks        AS remarks,
          CONCAT(dm.Alias, ' — ', am.activity_name) AS activityLabel,
          ep.name           AS projectName
        FROM dbo.WorkerAttendance wa
        LEFT JOIN dbo.DependencyMasterActivity dma ON dma.Id = wa.DependencyMasterActivityId
        LEFT JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        LEFT JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        WHERE wa.WorkerId = @workerId
          AND wa.AttendanceDate >= @from
          AND wa.AttendanceDate < DATEADD(MONTH, 1, @from)
        ORDER BY wa.AttendanceDate
      `);

    const worker = await pool.request()
      .input("workerId", sql.Int, workerId)
      .query(`
        SELECT w.WorkerId AS id, w.Name AS name, ahm.LHeadName AS companyName
        FROM dbo.Worker w
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
        WHERE w.WorkerId = @workerId
      `);
    if (!worker.recordset.length) return res.status(404).json({ error: "Worker not found" });

    res.json({ worker: worker.recordset[0], days: result.recordset });
  } catch (err) {
    console.error("WorkerAttendance /calendar error:", err);
    res.status(500).json({ error: "Failed to fetch attendance calendar" });
  }
});

module.exports = router;
