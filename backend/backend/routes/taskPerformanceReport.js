// Task Performance Report — read-only analytics over dbo.TaskMaster +
// dbo.TaskFollowUps. No new task data is stored anywhere; every column is
// either a direct field or a value computed on the fly from those two
// tables (completion day count, delay days, follow-up attend count).
//
// Status vocabulary note: TaskMaster only has Active/Hold/Cancel/Closed
// (see taskMaster.js). This report's "Pending" summary card maps to Hold
// (task paused/awaiting) and "Ongoing" maps to Active (task in progress) —
// there is no separate literal "Pending" status in the schema.
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { computeProgressMap } = require("../utils/taskProgress");

const STATUSES = ["Active", "Hold", "Cancel", "Closed"];
const PRIORITIES = ["Very Important", "Important", "Normal"];

router.get("/", requirePageRight("task-performance-report", "view"), async (req, res) => {
  const {
    companyId, projectId, taskId, caseId, createdBy, followerId,
    status, priority, startDate, endDate,
  } = req.query;

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be: ${STATUSES.join(", ")}` });
  }
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority. Must be: ${PRIORITIES.join(", ")}` });
  }

  try {
    const pool = getPool();
    const request = pool.request();

    const conditions = ["t.IsDeleted = 0"];

    if (companyId) {
      request.input("CompanyId", sql.Int, parseInt(companyId, 10));
      conditions.push("t.CaseCompanyId = @CompanyId");
    }
    if (projectId) {
      request.input("ProjectId", sql.Int, parseInt(projectId, 10));
      conditions.push("t.CaseProjectId = @ProjectId");
    }
    if (taskId) {
      request.input("TaskIdLike", sql.NVarChar(50), `%${taskId.trim()}%`);
      conditions.push("t.TaskNo LIKE @TaskIdLike");
    }
    if (caseId) {
      request.input("CaseIdLike", sql.NVarChar(150), `%${caseId.trim()}%`);
      conditions.push("(t.CaseNumber LIKE @CaseIdLike OR t.CaseDocumentNumber LIKE @CaseIdLike)");
    }
    if (createdBy) {
      request.input("CreatedBy", sql.Int, parseInt(createdBy, 10));
      conditions.push("t.CreatedBy = @CreatedBy");
    }
    if (followerId) {
      request.input("FollowerId", sql.Int, parseInt(followerId, 10));
      conditions.push("t.AssignedTo = @FollowerId");
    }
    if (status) {
      request.input("Status", sql.NVarChar(20), status);
      conditions.push("t.Status = @Status");
    }
    if (priority) {
      request.input("Priority", sql.NVarChar(20), priority);
      conditions.push("t.Priority = @Priority");
    }
    if (startDate) {
      request.input("StartDate", sql.Date, startDate);
      conditions.push("CAST(t.CreatedAt AS DATE) >= @StartDate");
    }
    if (endDate) {
      request.input("EndDate", sql.Date, endDate);
      conditions.push("CAST(t.CreatedAt AS DATE) <= @EndDate");
    }

    const result = await request.query(`
      SELECT
        t.Id, t.TaskNo, t.CaseNumber, t.CaseDocumentNumber, t.Subject, t.Details,
        t.CaseProjectId, pr.name AS ProjectName,
        t.CaseCompanyId, co.name AS CompanyName,
        t.CreatedBy, cb.name AS CreatedByName,
        t.AssignedTo, au.name AS FollowerName,
        t.CreatedAt AS TaskStartDate,
        t.DueDate AS TaskDueDate,
        CASE WHEN t.Status = 'Closed' THEN t.UpdatedAt END AS TaskCompletionDate,
        CASE WHEN t.Status = 'Closed'
          THEN DATEDIFF(DAY, CAST(t.CreatedAt AS DATE), CAST(t.UpdatedAt AS DATE))
        END AS CompletionDayCount,
        ISNULL(fu.FollowUpCount, 0) AS FollowUpAttendCount,
        t.Status, t.Priority,
        t.Progress,
        CASE
          WHEN t.Status = 'Closed' AND t.DueDate IS NOT NULL
            THEN DATEDIFF(DAY, t.DueDate, CAST(t.UpdatedAt AS DATE))
          WHEN t.Status IN ('Active', 'Hold') AND t.DueDate IS NOT NULL AND t.DueDate < CAST(GETDATE() AS DATE)
            THEN DATEDIFF(DAY, t.DueDate, CAST(GETDATE() AS DATE))
        END AS DelayDays
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      LEFT JOIN dbo.users cb ON cb.id = t.CreatedBy
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      OUTER APPLY (
        SELECT COUNT(*) AS FollowUpCount FROM dbo.TaskFollowUps f WHERE f.TaskId = t.Id
      ) fu
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.CreatedAt DESC
    `);

    // Tags merged in from the same TaskTags/TagMaster tables the task drawer
    // and Follow-Up board already use — no separate tag dataset, and the
    // Tag Performance Report (which groups these same rows by tag) reuses
    // this endpoint rather than duplicating the query.
    const taskIds = result.recordset.map((r) => r.Id);
    const tagsByTask = {};
    if (taskIds.length) {
      // taskIds are integers straight from our own just-run SELECT, never
      // user input, so inlining them into the IN-list is safe here.
      const tagsResult = await pool.request().query(`
        SELECT tt.TaskId, tg.Id, tg.Name
        FROM dbo.TaskTags tt
        JOIN dbo.TagMaster tg ON tg.Id = tt.TagId
        WHERE tt.TaskId IN (${taskIds.join(",")})
        ORDER BY tg.Name
      `);
      for (const row of tagsResult.recordset) {
        (tagsByTask[row.TaskId] ||= []).push({ Id: row.Id, Name: row.Name });
      }
    }

    const progressMap = await computeProgressMap(pool);
    res.json(result.recordset.map((r) => ({
      ...r,
      Tags: tagsByTask[r.Id] || [],
      ...(progressMap.get(r.Id) ?? { EffectiveProgress: r.Progress, HasChildren: false }),
    })));
  } catch (err) {
    console.error("[task-performance-report] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
