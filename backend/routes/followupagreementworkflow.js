const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { logAudit } = require("../utils/auditLog");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "AgreementWorkflow"));

// ── Constants ─────────────────────────────────────────────────────────────────
const STEP_FIELDS = [
  "Drafting",
  "InternalReview",
  "CustomerSharing",
  "CustomerApproval",
  "Execution",
  "Registration",
  "Archival",
];

const STEP_STATUS_OPTIONS = [
  "Pending",
  "In Progress",
  "Completed",
  "Blocked",
  "Waived",
];

const OVERALL_STATUS_OPTIONS = [
  "In Progress",
  "Completed",
  "On Hold",
  "Cancelled",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function requireUserName(req, res) {
  const userName = req.user?.name || req.user?.email || null;
  if (!userName) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
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

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
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
    const [applicantsR, agreementsR, bookingsR, unitSelectionsR, projectsR, companiesR] =
      await Promise.all([
        pool.request().query(`
          SELECT Id, ApplicantNo, ApplicantName, ProjectId, CompanyId
          FROM dbo.FollowupApplications
          WHERE IsDeleted = 0
          ORDER BY ApplicantName
        `),
        pool.request().query(`
          SELECT Id, AgreementNo, ApplicantId, BookingId, Status
          FROM dbo.FollowupAgreements
          WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT Id, BookingNo, ApplicantId
          FROM dbo.FollowupBookings
          WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT Id, SelectionNo, UnitNo, ApplicantId
          FROM dbo.FollowupUnitSelections
          WHERE IsDeleted = 0
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
      agreements: agreementsR.recordset,
      bookings: bookingsR.recordset,
      unitSelections: unitSelectionsR.recordset,
      projects: projectsR.recordset,
      companies: companiesR.recordset,
      stepStatusOptions: STEP_STATUS_OPTIONS,
      overallStatusOptions: OVERALL_STATUS_OPTIONS,
      steps: STEP_FIELDS,
    });
  } catch (err) {
    console.error("agreementWorkflow options error:", err);
    res.status(500).json({ error: "Failed to load options" });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.pageSize, 10) || 20),
    );
    const offset = (page - 1) * pageSize;
    const search = normalizeText(req.query.search);
    const overallStatus = normalizeText(req.query.overallStatus);
    const applicantId = normalizeNumber(req.query.applicantId);

    if (Number.isNaN(applicantId)) {
      return res
        .status(400)
        .json({ error: "applicantId must be a valid number" });
    }

    const filters = ["aw.IsDeleted = 0"];
    if (search) {
      filters.push(
        `(aw.WorkflowNo LIKE @Search OR fa.ApplicantName LIKE @Search OR fa.ApplicantNo LIKE @Search OR fag.AgreementNo LIKE @Search)`,
      );
    }
    if (overallStatus) filters.push("aw.OverallStatus = @OverallStatus");
    if (applicantId) filters.push("aw.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupAgreementWorkflows aw
      LEFT JOIN dbo.FollowupApplications fa ON fa.Id = aw.ApplicantId AND fa.IsDeleted = 0
      LEFT JOIN dbo.FollowupAgreements fag ON fag.Id = aw.AgreementId AND fag.IsDeleted = 0
      LEFT JOIN dbo.FollowupBookings fb ON fb.Id = aw.BookingId AND fb.IsDeleted = 0
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = aw.UnitSelectionId AND fus.IsDeleted = 0
      LEFT JOIN dbo.enterprise ep ON ep.id = aw.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.enterprise ec ON ec.id = aw.CompanyId AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const r = pool.request();
      if (search) r.input("Search", sql.NVarChar(255), `%${search}%`);
      if (overallStatus)
        r.input("OverallStatus", sql.NVarChar(30), overallStatus);
      if (applicantId) r.input("ApplicantId", sql.Int, applicantId);
      return r;
    };

    const countResult = await buildRequest().query(
      `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`,
    );

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT
          aw.Id, aw.WorkflowNo,
          aw.ApplicantId,
          fa.ApplicantNo, fa.ApplicantName,
          aw.AgreementId, fag.AgreementNo,
          aw.BookingId, fb.BookingNo,
          aw.UnitSelectionId, fus.UnitNo,
          aw.ProjectId, ep.name AS ProjectName,
          aw.CompanyId, ec.name AS CompanyName,
          aw.CurrentStep, aw.OverallStatus,
          aw.Notes,
          -- Drafting
          CONVERT(VARCHAR(10), aw.DraftingDue, 23)  AS DraftingDue,
          CONVERT(VARCHAR(10), aw.DraftingDone, 23) AS DraftingDone,
          aw.DraftingStatus, aw.DraftingNotes,
          -- InternalReview
          CONVERT(VARCHAR(10), aw.InternalReviewDue, 23)  AS InternalReviewDue,
          CONVERT(VARCHAR(10), aw.InternalReviewDone, 23) AS InternalReviewDone,
          aw.InternalReviewStatus, aw.InternalReviewNotes,
          -- CustomerSharing
          CONVERT(VARCHAR(10), aw.CustomerSharingDue, 23)  AS CustomerSharingDue,
          CONVERT(VARCHAR(10), aw.CustomerSharingDone, 23) AS CustomerSharingDone,
          aw.CustomerSharingStatus, aw.CustomerSharingNotes,
          -- CustomerApproval
          CONVERT(VARCHAR(10), aw.CustomerApprovalDue, 23)  AS CustomerApprovalDue,
          CONVERT(VARCHAR(10), aw.CustomerApprovalDone, 23) AS CustomerApprovalDone,
          aw.CustomerApprovalStatus, aw.CustomerApprovalNotes,
          -- Execution
          CONVERT(VARCHAR(10), aw.ExecutionDue, 23)  AS ExecutionDue,
          CONVERT(VARCHAR(10), aw.ExecutionDone, 23) AS ExecutionDone,
          aw.ExecutionStatus, aw.ExecutionNotes,
          -- Registration
          CONVERT(VARCHAR(10), aw.RegistrationDue, 23)  AS RegistrationDue,
          CONVERT(VARCHAR(10), aw.RegistrationDone, 23) AS RegistrationDone,
          aw.RegistrationStatus, aw.RegistrationNotes,
          -- Archival
          CONVERT(VARCHAR(10), aw.ArchivalDue, 23)  AS ArchivalDue,
          CONVERT(VARCHAR(10), aw.ArchivalDone, 23) AS ArchivalDone,
          aw.ArchivalStatus, aw.ArchivalNotes,
          aw.CreatedBy, aw.CreatedAt
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY aw.CreatedAt DESC, aw.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);
    res.json({
      data: dataResult.recordset,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("agreementWorkflow GET error:", err);
    res.status(500).json({ error: "Failed to fetch agreement workflows" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const b = req.body;
  const applicantId = normalizeNumber(b?.ApplicantId);
  if (!applicantId)
    return res.status(400).json({ error: "Applicant is required" });

  try {
    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId", sql.Int, applicantId)
      .input("AgreementId", sql.Int, normalizeNumber(b?.AgreementId))
      .input("BookingId", sql.Int, normalizeNumber(b?.BookingId))
      .input("UnitSelectionId", sql.Int, normalizeNumber(b?.UnitSelectionId))
      .input("ProjectId", sql.Int, normalizeNumber(b?.ProjectId))
      .input("CompanyId", sql.Int, normalizeNumber(b?.CompanyId))
      .input("DraftingDue", sql.Date, normalizeDate(b?.DraftingDue))
      .input("InternalReviewDue", sql.Date, normalizeDate(b?.InternalReviewDue))
      .input("CustomerSharingDue", sql.Date, normalizeDate(b?.CustomerSharingDue))
      .input("CustomerApprovalDue", sql.Date, normalizeDate(b?.CustomerApprovalDue))
      .input("ExecutionDue", sql.Date, normalizeDate(b?.ExecutionDue))
      .input("RegistrationDue", sql.Date, normalizeDate(b?.RegistrationDue))
      .input("ArchivalDue", sql.Date, normalizeDate(b?.ArchivalDue))
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(b?.Notes))
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupAgreementWorkflows (
          ApplicantId, AgreementId, BookingId, UnitSelectionId, ProjectId, CompanyId,
          DraftingDue, InternalReviewDue, CustomerSharingDue, CustomerApprovalDue,
          ExecutionDue, RegistrationDue, ArchivalDue,
          Notes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @ApplicantId, @AgreementId, @BookingId, @UnitSelectionId, @ProjectId, @CompanyId,
          @DraftingDue, @InternalReviewDue, @CustomerSharingDue, @CustomerApprovalDue,
          @ExecutionDue, @RegistrationDue, @ArchivalDue,
          @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const workflowNo = `AWF${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("WorkflowNo", sql.NVarChar(50), workflowNo)
      .query(
        `UPDATE dbo.FollowupAgreementWorkflows SET WorkflowNo = @WorkflowNo WHERE Id = @Id`,
      );

    await transaction.commit();
    logAudit({ module: "AgreementWorkflow", recordId: id, recordNo: workflowNo, action: "Created", changedBy: userName });
    res.status(201).json({ Id: id, WorkflowNo: workflowNo });
  } catch (err) {
    console.error("agreementWorkflow POST error:", err);
    res.status(500).json({ error: "Failed to create agreement workflow" });
  }
});

// ── PATCH /:id/step ───────────────────────────────────────────────────────────
router.patch("/:id/step", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const { stepField, status, doneDate, notes, signatureId } = req.body;
  if (!STEP_FIELDS.includes(stepField))
    return res.status(400).json({ error: "Invalid stepField" });
  if (!STEP_STATUS_OPTIONS.includes(status))
    return res.status(400).json({ error: "Invalid status" });

  try {
    const statusCol = `${stepField}Status`;
    const doneCol = `${stepField}Done`;
    const notesCol = `${stepField}Notes`;

    const completedStepIndex = STEP_FIELDS.indexOf(stepField) + 1;
    const advanceStep = status === "Completed" ? completedStepIndex + 1 : null;

    let query = `
      UPDATE dbo.FollowupAgreementWorkflows
      SET [${statusCol}] = @Status,
          [${doneCol}]   = @DoneDate,
          [${notesCol}]  = COALESCE(@Notes, [${notesCol}]),
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
    `;
    // Stamp signature only on the Execution step
    if (stepField === "Execution") {
      query += `, ExecutionSignatureId = @SignatureId`;
      query += `, ExecutionSignedAt    = CASE WHEN @SignatureId IS NOT NULL THEN SYSDATETIME() ELSE ExecutionSignedAt END`;
      query += `, ExecutionSignedBy    = CASE WHEN @SignatureId IS NOT NULL THEN @UpdatedBy   ELSE ExecutionSignedBy END`;
    }
    if (advanceStep && advanceStep <= STEP_FIELDS.length) {
      query += `, CurrentStep = CASE WHEN CurrentStep < ${advanceStep} THEN ${advanceStep} ELSE CurrentStep END`;
    }
    if (status === "Completed" && completedStepIndex === STEP_FIELDS.length) {
      query += `, OverallStatus = 'Completed'`;
    }
    query += ` WHERE Id = @Id AND IsDeleted = 0`;

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("Status", sql.NVarChar(30), status)
      .input("DoneDate", sql.Date, normalizeDate(doneDate))
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(notes))
      .input("SignatureId", sql.Int, signatureId ? parseInt(signatureId, 10) : null)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(query);

    logAudit({ module: "AgreementWorkflow", recordId: id, action: "StepUpdated", stepName: stepField, newValue: status, changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("agreementWorkflow PATCH step error:", err);
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
    return res.status(400).json({
      error: `OverallStatus must be one of: ${OVERALL_STATUS_OPTIONS.join(", ")}`,
    });

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("OverallStatus", sql.NVarChar(30), overallStatus)
      .input("CurrentStep", sql.Int, normalizeNumber(b?.CurrentStep) || 1)
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(b?.Notes))
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupAgreementWorkflows
        SET OverallStatus = @OverallStatus,
            CurrentStep   = @CurrentStep,
            Notes         = @Notes,
            UpdatedBy     = @UpdatedBy,
            UpdatedAt     = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    logAudit({ module: "AgreementWorkflow", recordId: id, action: "Updated", fieldName: "OverallStatus", newValue: overallStatus, changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("agreementWorkflow PUT error:", err);
    res.status(500).json({ error: "Failed to update workflow" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupAgreementWorkflows
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    logAudit({ module: "AgreementWorkflow", recordId: id, action: "Deleted", changedBy: userName });
    res.json({ success: true });
  } catch (err) {
    console.error("agreementWorkflow DELETE error:", err);
    res.status(500).json({ error: "Failed to delete workflow" });
  }
});

module.exports = router;