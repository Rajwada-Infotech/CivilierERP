const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// dbo.Worker — stable worker identity tied to a Contractor/company, so
// attendance can be searched/summarized across days without relying on
// free-text names re-typed on every Daily Labour entry.
// dbo.WorkerAttendance — one Present/Absent/Half-day status per worker per
// calendar day, referencing whichever Activity allocation they worked that
// day (for display context only — uniqueness is per worker+date, not
// per activity, since a worker is either in or out for the day).

const cleanStr = (v, len = 300) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// ─── GET /workers — list, filterable by project/company/activity, with
//     attendance summary + search + pagination ────────────────────────────
router.get("/workers", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const contractorId = req.query.contractorId ? parseInt(req.query.contractorId, 10) : null;
    const activityId = req.query.activityId ? parseInt(req.query.activityId, 10) : null;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10)) : 1;
    const pageSize = req.query.pageSize ? Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10))) : 20;
    const offset = (page - 1) * pageSize;

    // Company isn't a column on ContractorAllocation — it's the parent of
    // whichever Project the allocation belongs to, so it's filtered via the
    // Project's own company_id rather than a direct join condition.
    const baseWhere = `
      WHERE (@projectId IS NULL OR ca.ProjectId = @projectId)
        AND (@companyId IS NULL OR ca.ProjectId IN (
              SELECT id FROM dbo.enterprise WHERE company_id = @companyId
            ))
        AND (@contractorId IS NULL OR w.ContractorLHeadId = @contractorId)
        AND (@activityId IS NULL OR ca.ActivityId = @activityId)
        AND (@search IS NULL OR w.Name LIKE @search)
    `;

    const request = () =>
      pool.request()
        .input("companyId", sql.Int, companyId)
        .input("projectId", sql.Int, projectId)
        .input("contractorId", sql.Int, contractorId)
        .input("activityId", sql.Int, activityId)
        .input("search", sql.NVarChar, search);

    // Workers are scoped to a (Worker, latest allocation matching filters)
    // pair — pick the most recent matching allocation per worker so each
    // worker shows up once with a representative project/activity.
    const countResult = await request().query(`
      SELECT COUNT(DISTINCT w.WorkerId) AS total
      FROM dbo.Worker w
      JOIN dbo.WorkerAttendance wa ON wa.WorkerId = w.WorkerId
      JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wa.AllocationId
      ${baseWhere}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    const listResult = await request()
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        WITH LatestAlloc AS (
          SELECT wa.WorkerId, ca.ProjectId, ca.ActivityId, ca.AllocationId,
                 ROW_NUMBER() OVER (PARTITION BY wa.WorkerId ORDER BY wa.AttendanceDate DESC) AS rn
          FROM dbo.WorkerAttendance wa
          JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wa.AllocationId
        )
        SELECT
          w.WorkerId           AS id,
          w.Name               AS name,
          w.SkillType          AS skillType,
          ahm.LHeadName        AS companyName,
          la.ProjectId         AS projectId,
          pr.name              AS projectName,
          la.ActivityId        AS activityId,
          act.activity_name    AS activityName,
          ISNULL(sum_p.cnt, 0) AS presentCount,
          ISNULL(sum_a.cnt, 0) AS absentCount,
          ISNULL(sum_h.cnt, 0) AS halfDayCount
        FROM dbo.Worker w
        JOIN dbo.WorkerAttendance wa ON wa.WorkerId = w.WorkerId
        JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wa.AllocationId
        JOIN LatestAlloc la ON la.WorkerId = w.WorkerId AND la.rn = 1
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = w.ContractorLHeadId
        LEFT JOIN dbo.enterprise pr ON pr.id = la.ProjectId
        LEFT JOIN dbo.ActivityMaster act ON act.id = la.ActivityId
        LEFT JOIN (
          SELECT WorkerId, COUNT(*) AS cnt FROM dbo.WorkerAttendance WHERE Status = 'P' GROUP BY WorkerId
        ) sum_p ON sum_p.WorkerId = w.WorkerId
        LEFT JOIN (
          SELECT WorkerId, COUNT(*) AS cnt FROM dbo.WorkerAttendance WHERE Status = 'A' GROUP BY WorkerId
        ) sum_a ON sum_a.WorkerId = w.WorkerId
        LEFT JOIN (
          SELECT WorkerId, COUNT(*) AS cnt FROM dbo.WorkerAttendance WHERE Status = 'H' GROUP BY WorkerId
        ) sum_h ON sum_h.WorkerId = w.WorkerId
        ${baseWhere}
        GROUP BY w.WorkerId, w.Name, w.SkillType, ahm.LHeadName, la.ProjectId, pr.name,
                 la.ActivityId, act.activity_name, sum_p.cnt, sum_a.cnt, sum_h.cnt
        ORDER BY w.Name
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

    res.json({ data: listResult.recordset, total, page, pageSize });
  } catch (err) {
    console.error("WorkerAttendance /workers error:", err);
    res.status(500).json({ error: "Failed to fetch workers" });
  }
});

// ─── GET /workers/:id/calendar?month=YYYY-MM — one worker's attendance for a month ──
router.get("/workers/:id/calendar", authMiddleware, async (req, res) => {
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
          act.activity_name AS activityName,
          pr.name            AS projectName
        FROM dbo.WorkerAttendance wa
        JOIN dbo.ContractorAllocation ca ON ca.AllocationId = wa.AllocationId
        LEFT JOIN dbo.ActivityMaster act ON act.id = ca.ActivityId
        LEFT JOIN dbo.enterprise pr ON pr.id = ca.ProjectId
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

// ─── POST / — upsert one day's attendance for a worker (find-or-create
//     the Worker by name+contractor, then upsert the day's status) ────────
router.post(
  "/",
  authMiddleware,
  requirePageRight("civilworkdpr-contractor-register", "create"),
  async (req, res) => {
    const { name, contractorId, skillType, allocationId, date, status, remarks } = req.body;
    const actor = req.user?.email || req.user?.name || "system";

    if (!name || !contractorId) return res.status(400).json({ error: "Worker name and contractor are required" });
    if (!allocationId) return res.status(400).json({ error: "Allocation is required" });
    if (!date) return res.status(400).json({ error: "Date is required" });
    if (!["P", "A", "H"].includes(status)) {
      return res.status(400).json({ error: "status must be P, A, or H" });
    }

    try {
      const pool = getPool();

      let workerRow = await pool.request()
        .input("name", sql.NVarChar, cleanStr(name, 150))
        .input("contractorId", sql.Int, contractorId)
        .query(`SELECT WorkerId FROM dbo.Worker WHERE Name = @name AND ContractorLHeadId = @contractorId`);

      let workerId;
      if (workerRow.recordset.length) {
        workerId = workerRow.recordset[0].WorkerId;
      } else {
        const inserted = await pool.request()
          .input("name", sql.NVarChar, cleanStr(name, 150))
          .input("contractorId", sql.Int, contractorId)
          .input("skillType", sql.NVarChar, cleanStr(skillType, 20) || "Skilled")
          .input("createdBy", sql.NVarChar, actor)
          .query(`
            INSERT INTO dbo.Worker (Name, ContractorLHeadId, SkillType, CreatedBy, CreatedAt)
            OUTPUT INSERTED.WorkerId AS id
            VALUES (@name, @contractorId, @skillType, @createdBy, GETDATE())
          `);
        workerId = inserted.recordset[0].id;
      }

      const existing = await pool.request()
        .input("workerId", sql.Int, workerId)
        .input("date", sql.Date, date)
        .query(`SELECT AttendanceId FROM dbo.WorkerAttendance WHERE WorkerId = @workerId AND AttendanceDate = @date`);

      if (existing.recordset.length) {
        await pool.request()
          .input("id", sql.Int, existing.recordset[0].AttendanceId)
          .input("allocationId", sql.Int, allocationId)
          .input("status", sql.Char(1), status)
          .input("remarks", sql.NVarChar, cleanStr(remarks))
          .input("updatedBy", sql.NVarChar, actor)
          .query(`
            UPDATE dbo.WorkerAttendance SET
              AllocationId = @allocationId, Status = @status, Remarks = @remarks,
              UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
            WHERE AttendanceId = @id
          `);
        return res.json({ success: true, workerId, attendanceId: existing.recordset[0].AttendanceId });
      }

      const result = await pool.request()
        .input("workerId", sql.Int, workerId)
        .input("allocationId", sql.Int, allocationId)
        .input("date", sql.Date, date)
        .input("status", sql.Char(1), status)
        .input("remarks", sql.NVarChar, cleanStr(remarks))
        .input("createdBy", sql.NVarChar, actor)
        .query(`
          INSERT INTO dbo.WorkerAttendance (WorkerId, AllocationId, AttendanceDate, Status, Remarks, CreatedBy, CreatedAt)
          OUTPUT INSERTED.AttendanceId AS id
          VALUES (@workerId, @allocationId, @date, @status, @remarks, @createdBy, GETDATE())
        `);
      res.status(201).json({ success: true, workerId, attendanceId: result.recordset[0].id });
    } catch (err) {
      console.error("WorkerAttendance POST error:", err);
      res.status(500).json({ error: "Failed to record attendance" });
    }
  },
);

module.exports = router;
