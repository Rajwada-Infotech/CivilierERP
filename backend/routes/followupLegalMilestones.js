const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { logAudit } = require("../utils/auditLog");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

router.use(authMiddleware);
router.use(apiRateLimit);
router.use(checkPermissionForMethod("Followup", "LegalMilestones"));

const STEP_FIELDS = [
  "DocCollection", "LegalReview", "Drafting",
  "InternalApproval", "DocShared", "MutualAgreement",
  "DirectorMeeting", "FinalExecution"
];
const STEP_STATUS_OPTIONS = ["Pending", "In Progress", "Completed", "Blocked", "Waived"];
const OVERALL_STATUS_OPTIONS = ["In Progress", "Completed", "On Hold", "Cancelled"];

function requireUserName(req, res) {
  const userName = req.user?.name || req.user?.email || null;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userName;
}
function parseId(rawId) {
  const id = parseInt(rawId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
function normalizeText(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
// FIX #11: return null (not NaN) for invalid numbers so mssql doesn't throw
function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : v;
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    const pool = getPool();
    const [applicantsR, unitSelectionsR, bookingsR, agreementsR, projectsR, companiesR] =
      await Promise.all([
        pool.request().query(`
          SELECT LHeadId AS Id, ISNULL(DisplayName, LHeadName) AS ApplicantName, LHeadCode AS ApplicantNo
          FROM dbo.AccountHeadMaster WHERE LHeadType = 'A' AND LHeadStatus = 1
          ORDER BY ISNULL(DisplayName, LHeadName)
        `),
        pool.request().query(`
          SELECT Id, SelectionNo, UnitNo, ApplicantId
          FROM dbo.FollowupUnitSelections WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT Id, BookingNo, ApplicantId
          FROM dbo.FollowupBookings WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT Id, AgreementNo, ApplicantId
          FROM dbo.FollowupAgreements WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT id AS Id, name AS Name FROM dbo.enterprise
          WHERE business_type = 'P' AND ISNULL(discontinue,0) = 0 ORDER BY name
        `),
        pool.request().query(`
          SELECT id AS Id, name AS Name FROM dbo.enterprise
          WHERE business_type = 'C' AND ISNULL(discontinue,0) = 0 ORDER BY name
        `),
      ]);
    res.json({
      applicants: applicantsR.recordset,
      unitSelections: unitSelectionsR.recordset,
      bookings: bookingsR.recordset,
      agreements: agreementsR.recordset,
      projects: projectsR.recordset,
      companies: companiesR.recordset,
      stepStatusOptions: STEP_STATUS_OPTIONS,
      overallStatusOptions: OVERALL_STATUS_OPTIONS,
      steps: STEP_FIELDS,
    });
  } catch (err) {
    console.error("legalMilestones options error:", err);
    res.status(500).json({ error: "Failed to load options" });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const search = normalizeText(req.query.search);
    const overallStatus = normalizeText(req.query.overallStatus);
    const applicantId = normalizeNumber(req.query.applicantId);

    // FIX #11 follow-through: normalizeNumber now returns null not NaN, so this guard still works
    if (applicantId !== null && !Number.isFinite(applicantId))
      return res.status(400).json({ error: "applicantId must be a valid number" });

    const filters = ["lm.IsDeleted = 0"];
    if (search) filters.push(`(lm.MilestoneNo LIKE @Search OR ISNULL(ahm.DisplayName, ahm.LHeadName) LIKE @Search OR ahm.LHeadCode LIKE @Search)`);
    if (overallStatus) filters.push("lm.OverallStatus = @OverallStatus");
    if (applicantId) filters.push("lm.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupLegalMilestones lm
      INNER JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = lm.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = lm.UnitSelectionId
      LEFT JOIN dbo.FollowupBookings fb ON fb.Id = lm.BookingId
      LEFT JOIN dbo.enterprise ep ON ep.id = lm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.enterprise ec ON ec.id = lm.CompanyId AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const r = pool.request();
      if (search) r.input("Search", sql.NVarChar(255), `%${search}%`);
      if (overallStatus) r.input("OverallStatus", sql.NVarChar(30), overallStatus);
      if (applicantId) r.input("ApplicantId", sql.Int, applicantId);
      return r;
    };

    const countResult = await buildRequest().query(
      `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`
    );
    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT
          lm.Id, lm.MilestoneNo, lm.ApplicantId,
          ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
          ahm.LHeadCode AS ApplicantNo,
          lm.UnitSelectionId, fus.UnitNo,
          lm.BookingId, fb.BookingNo,
          lm.ProjectId, ep.name AS ProjectName,
          lm.CompanyId, ec.name AS CompanyName,
          lm.CurrentStep, lm.OverallStatus,
          CONVERT(VARCHAR(10), lm.DocCollectionDue,  23) AS DocCollectionDue,
          CONVERT(VARCHAR(10), lm.DocCollectionDone, 23) AS DocCollectionDone,
          lm.DocCollectionStatus,    lm.DocCollectionNotes,
          CONVERT(VARCHAR(10), lm.LegalReviewDue,  23) AS LegalReviewDue,
          CONVERT(VARCHAR(10), lm.LegalReviewDone, 23) AS LegalReviewDone,
          lm.LegalReviewStatus,      lm.LegalReviewNotes,
          CONVERT(VARCHAR(10), lm.DraftingDue,  23) AS DraftingDue,
          CONVERT(VARCHAR(10), lm.DraftingDone, 23) AS DraftingDone,
          lm.DraftingStatus,         lm.DraftingNotes,
          CONVERT(VARCHAR(10), lm.InternalApprovalDue,  23) AS InternalApprovalDue,
          CONVERT(VARCHAR(10), lm.InternalApprovalDone, 23) AS InternalApprovalDone,
          lm.InternalApprovalStatus, lm.InternalApprovalNotes,
          CONVERT(VARCHAR(10), lm.DocSharedDue,  23) AS DocSharedDue,
          CONVERT(VARCHAR(10), lm.DocSharedDone, 23) AS DocSharedDone,
          lm.DocSharedStatus,        lm.DocSharedNotes,
          CONVERT(VARCHAR(10), lm.MutualAgreementDue,  23) AS MutualAgreementDue,
          CONVERT(VARCHAR(10), lm.MutualAgreementDone, 23) AS MutualAgreementDone,
          lm.MutualAgreementStatus,  lm.MutualAgreementNotes,
          CONVERT(VARCHAR(10), lm.DirectorMeetingDue,  23) AS DirectorMeetingDue,
          CONVERT(VARCHAR(10), lm.DirectorMeetingDone, 23) AS DirectorMeetingDone,
          lm.DirectorMeetingStatus,  lm.DirectorMeetingNotes,
          CONVERT(VARCHAR(10), lm.FinalExecutionDue,  23) AS FinalExecutionDue,
          CONVERT(VARCHAR(10), lm.FinalExecutionDone, 23) AS FinalExecutionDone,
          lm.FinalExecutionStatus,   lm.FinalExecutionNotes,
          lm.Notes, lm.CreatedBy, lm.CreatedAt
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY lm.CreatedAt DESC, lm.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);
    res.json({
      data: dataResult.recordset,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("legalMilestones GET error:", err);
    res.status(500).json({ error: "Failed to fetch Legal Milestones" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const b = req.body;
  const applicantId = normalizeNumber(b?.ApplicantId);
  if (!applicantId) return res.status(400).json({ error: "Applicant is required" });

  try {
    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    // FIX #3: include CurrentStep = 1 and OverallStatus = 'In Progress' in INSERT
    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId",      sql.Int,  applicantId)
      .input("UnitSelectionId",  sql.Int,  normalizeNumber(b?.UnitSelectionId))
      .input("BookingId",        sql.Int,  normalizeNumber(b?.BookingId))
      .input("AgreementId",      sql.Int,  normalizeNumber(b?.AgreementId))
      .input("ProjectId",        sql.Int,  normalizeNumber(b?.ProjectId))
      .input("CompanyId",        sql.Int,  normalizeNumber(b?.CompanyId))
      .input("DocCollectionDue",    sql.Date, normalizeDate(b?.DocCollectionDue))
      .input("LegalReviewDue",      sql.Date, normalizeDate(b?.LegalReviewDue))
      .input("DraftingDue",         sql.Date, normalizeDate(b?.DraftingDue))
      .input("InternalApprovalDue", sql.Date, normalizeDate(b?.InternalApprovalDue))
      .input("DocSharedDue",        sql.Date, normalizeDate(b?.DocSharedDue))
      .input("MutualAgreementDue",  sql.Date, normalizeDate(b?.MutualAgreementDue))
      .input("DirectorMeetingDue",  sql.Date, normalizeDate(b?.DirectorMeetingDue))
      .input("FinalExecutionDue",   sql.Date, normalizeDate(b?.FinalExecutionDue))
      .input("Notes",    sql.NVarChar(sql.MAX), normalizeText(b?.Notes))
      .input("CreatedBy", sql.NVarChar(100),    userName)
      .query(`
        INSERT INTO dbo.FollowupLegalMilestones (
          ApplicantId, UnitSelectionId, BookingId, AgreementId, ProjectId, CompanyId,
          DocCollectionDue, LegalReviewDue, DraftingDue, InternalApprovalDue,
          DocSharedDue, MutualAgreementDue, DirectorMeetingDue, FinalExecutionDue,
          Notes, CurrentStep, OverallStatus, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @ApplicantId, @UnitSelectionId, @BookingId, @AgreementId, @ProjectId, @CompanyId,
          @DocCollectionDue, @LegalReviewDue, @DraftingDue, @InternalApprovalDue,
          @DocSharedDue, @MutualAgreementDue, @DirectorMeetingDue, @FinalExecutionDue,
          @Notes, 1, 'In Progress', @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const milestoneNo = `LM${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("MilestoneNo", sql.NVarChar(50), milestoneNo)
      .query(`UPDATE dbo.FollowupLegalMilestones SET MilestoneNo = @MilestoneNo WHERE Id = @Id`);

    await transaction.commit();
    logAudit({ module: "LegalMilestone", recordId: id, recordNo: milestoneNo, action: "Created", changedBy: userName });
    res.status(201).json({ Id: id, MilestoneNo: milestoneNo });
  } catch (err) {
    console.error("legalMilestones POST error:", err);
    res.status(500).json({ error: "Failed to create Legal Milestone" });
  }
});

// ── PATCH /:id/step ───────────────────────────────────────────────────────────
router.patch("/:id/step", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const { stepField, status, doneDate, notes } = req.body;
  if (!STEP_FIELDS.includes(stepField))
    return res.status(400).json({ error: "Invalid stepField" });
  if (!STEP_STATUS_OPTIONS.includes(status))
    return res.status(400).json({ error: "Invalid status" });

  try {
    const statusCol = `${stepField}Status`;
    const doneCol   = `${stepField}Done`;
    const notesCol  = `${stepField}Notes`;

    // Auto-advance CurrentStep when a step is completed
    const completedStepIndex = STEP_FIELDS.indexOf(stepField) + 1;
    const advanceStep = status === "Completed" ? completedStepIndex + 1 : null;

    // FIX #5: distinguish "notes explicitly sent as empty string" (clear) vs "not sent" (preserve)
    // Frontend sends notes: undefined when no change intended, notes: "" when user cleared the field.
    // normalizeText("") returns null. We use a flag to decide between unconditional SET vs COALESCE.
    const notesExplicitlyProvided = Object.prototype.hasOwnProperty.call(req.body, "notes");
    const normalizedNotes = normalizeText(notes);

    let query = `
      UPDATE dbo.FollowupLegalMilestones
      SET [${statusCol}] = @Status,
          [${doneCol}]   = @DoneDate,
          [${notesCol}]  = ${notesExplicitlyProvided ? "@Notes" : `COALESCE(@Notes, [${notesCol}])`},
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
    `;
    if (advanceStep && advanceStep <= 8) {
      query += `, CurrentStep = CASE WHEN CurrentStep < ${advanceStep} THEN ${advanceStep} ELSE CurrentStep END`;
    }
    if (status === "Completed" && completedStepIndex === 8) {
      query += `, OverallStatus = 'Completed'`;
    }
    query += ` WHERE Id = @Id AND IsDeleted = 0`;

    await getPool().request()
      .input("Id",        sql.Int,              id)
      .input("Status",    sql.NVarChar(30),      status)
      .input("DoneDate",  sql.Date,              normalizeDate(doneDate))
      .input("Notes",     sql.NVarChar(sql.MAX), normalizedNotes)
      .input("UpdatedBy", sql.NVarChar(100),     userName)
      .query(query);

    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    logAudit({ module: "LegalMilestone", recordId: id, action: "StepUpdated", stepName: stepField, newValue: status, changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("legalMilestones PATCH step error:", err);
    res.status(500).json({ error: "Failed to update step" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const b = req.body;
  const overallStatus = normalizeText(b?.OverallStatus) || "In Progress";
  if (!OVERALL_STATUS_OPTIONS.includes(overallStatus))
    return res.status(400).json({ error: `OverallStatus must be one of: ${OVERALL_STATUS_OPTIONS.join(", ")}` });

  try {
    const result = await getPool().request()
      .input("Id",            sql.Int,              id)
      .input("OverallStatus", sql.NVarChar(30),      overallStatus)
      .input("CurrentStep",   sql.Int,              normalizeNumber(b?.CurrentStep) || 1)
      .input("Notes",         sql.NVarChar(sql.MAX), normalizeText(b?.Notes))
      .input("UpdatedBy",     sql.NVarChar(100),     userName)
      .query(`
        UPDATE dbo.FollowupLegalMilestones
        SET OverallStatus = @OverallStatus,
            CurrentStep   = @CurrentStep,
            Notes         = @Notes,
            UpdatedBy     = @UpdatedBy,
            UpdatedAt     = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    logAudit({ module: "LegalMilestone", recordId: id, action: "Updated", fieldName: "OverallStatus", newValue: overallStatus, changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("legalMilestones PUT error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const result = await getPool().request()
      .input("Id",        sql.Int,         id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupLegalMilestones
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    logAudit({ module: "LegalMilestone", recordId: id, action: "Deleted", changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("legalMilestones DELETE error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

module.exports = router;