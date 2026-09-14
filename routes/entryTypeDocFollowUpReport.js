// Entry Type & Document Follow-Up Report — read-only analytics over the
// existing dbo.TaskMaster + dbo.TaskFollowUps + dbo.Entry_Type + dbo.TypeOfDoc
// tables. One row per follow-up record (not per task) so the frontend can
// group Entry Type -> Document -> Follow-Up Records and drill down to the
// exact rows behind any count, without a second query per drill-down level.
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

const STATUSES = ["Active", "Hold", "Cancel", "Closed"];

router.get("/", requirePageRight("entry-type-doc-followup-report", "view"), async (req, res) => {
  const {
    entryTypeId, typeOfDocId, companyId, projectId, userId,
    status, startDate, endDate,
  } = req.query;

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be: ${STATUSES.join(", ")}` });
  }

  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = ["t.IsDeleted = 0"];

    if (entryTypeId) {
      request.input("EntryTypeId", sql.UniqueIdentifier, entryTypeId);
      conditions.push("t.EntryTypeId = @EntryTypeId");
    }
    if (typeOfDocId) {
      request.input("TypeOfDocId", sql.Int, parseInt(typeOfDocId, 10));
      conditions.push("t.TypeOfDocId = @TypeOfDocId");
    }
    if (companyId) {
      request.input("CompanyId", sql.Int, parseInt(companyId, 10));
      conditions.push("t.CaseCompanyId = @CompanyId");
    }
    if (projectId) {
      request.input("ProjectId", sql.Int, parseInt(projectId, 10));
      conditions.push("t.CaseProjectId = @ProjectId");
    }
    if (userId) {
      request.input("UserId", sql.Int, parseInt(userId, 10));
      conditions.push("f.CreatedBy = @UserId");
    }
    if (status) {
      request.input("Status", sql.NVarChar(20), status);
      conditions.push("t.Status = @Status");
    }
    if (startDate) {
      request.input("StartDate", sql.Date, startDate);
      conditions.push("CAST(f.CreatedAt AS DATE) >= @StartDate");
    }
    if (endDate) {
      request.input("EndDate", sql.Date, endDate);
      conditions.push("CAST(f.CreatedAt AS DATE) <= @EndDate");
    }

    const result = await request.query(`
      SELECT
        f.Id AS FollowUpId, f.CreatedAt AS FollowUpDate, f.IsDone AS FollowUpIsDone,
        f.CreatedBy AS FollowUpUserId, fu.name AS FollowUpUserName,
        t.Id AS TaskId, t.TaskNo AS DocumentId, t.Subject, t.Status AS TaskStatus, t.Priority,
        t.DueDate AS TaskDueDate,
        t.EntryTypeId, et.EntryType AS EntryTypeLabel,
        t.TypeOfDocId,
        CASE WHEN td.TypeOfDocId IS NULL THEN 'Unassigned' ELSE td.Prefix + ' — ' + ISNULL(td.Description, '') END AS DocumentLabel,
        t.CaseCompanyId, co.name AS CompanyName,
        t.CaseProjectId, pr.name AS ProjectName,
        ISNULL(cnt.FollowUpCount, 0) AS FollowUpAttendCount
      FROM dbo.TaskFollowUps f
      JOIN dbo.TaskMaster t ON t.Id = f.TaskId
      LEFT JOIN dbo.users fu ON fu.id = f.CreatedBy
      LEFT JOIN dbo.Entry_Type et ON et.E_Id = t.EntryTypeId
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = t.TypeOfDocId
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      OUTER APPLY (
        SELECT COUNT(*) AS FollowUpCount FROM dbo.TaskFollowUps f2 WHERE f2.TaskId = t.Id
      ) cnt
      WHERE ${conditions.join(" AND ")}
      ORDER BY f.CreatedAt DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("[entry-type-doc-followup-report] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
