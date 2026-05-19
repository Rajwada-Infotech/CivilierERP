const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const LIST_COLUMNS = `
  fn.Id,
  fn.NOCNo,
  fn.ApplicantId,
  fa.ApplicantNo,
  fa.ApplicantName,
  fn.UnitSelectionId,
  fus.SelectionNo,
  fus.UnitNo,
  fn.AgreementId,
  fag.AgreementNo,
  fn.ProjectId,
  pm.Name AS ProjectName,
  fn.CompanyId,
  cm.Name AS CompanyName,
  CONVERT(VARCHAR(10), fn.NOCDate, 23)      AS NOCDate,
  CONVERT(VARCHAR(10), fn.ApprovalDate, 23) AS ApprovalDate,
  CONVERT(VARCHAR(10), fn.IssuedDate, 23)   AS IssuedDate,
  fn.ApprovedBy,
  fn.Reason,
  fn.Status,
  fn.Notes,
  fn.CreatedBy,
  fn.CreatedAt
`;

const STATUS_OPTIONS = ["Pending", "Approved", "Issued", "Rejected"];

router.use(authMiddleware);

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

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

async function getApplicantSnapshot(applicantId) {
  if (!applicantId) return null;
  const result = await getPool()
    .request()
    .input("ApplicantId", sql.Int, applicantId).query(`
      SELECT TOP 1 Id, ProjectId, CompanyId
      FROM dbo.FollowupApplicants
      WHERE Id = @ApplicantId AND IsDeleted = 0
    `);
  return result.recordset[0] ?? null;
}

async function getUnitSelectionSnapshot(unitSelectionId) {
  if (!unitSelectionId) return null;
  const result = await getPool()
    .request()
    .input("UnitSelectionId", sql.Int, unitSelectionId).query(`
      SELECT TOP 1 Id, ApplicantId, ProjectId, CompanyId
      FROM dbo.FollowupUnitSelections
      WHERE Id = @UnitSelectionId AND IsDeleted = 0
    `);
  return result.recordset[0] ?? null;
}

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  const unitSelectionId = normalizeNumber(body?.UnitSelectionId);
  const agreementId = normalizeNumber(body?.AgreementId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(unitSelectionId) ||
    Number.isNaN(agreementId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  if (!applicantId) {
    return { error: "Applicant is required" };
  }

  const status = normalizeText(body?.Status) || "Pending";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    AgreementId: agreementId,
    ProjectId: projectId,
    CompanyId: companyId,
    NOCDate: normalizeText(body?.NOCDate),
    ApprovalDate: normalizeText(body?.ApprovalDate),
    IssuedDate: normalizeText(body?.IssuedDate),
    ApprovedBy: normalizeText(body?.ApprovedBy),
    Reason: normalizeText(body?.Reason),
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildOptions() {
  const pool = getPool();
  const [
    applicantsResult,
    unitSelectionsResult,
    agreementsResult,
    projectsResult,
    companiesResult,
  ] = await Promise.all([
    pool.request().query(`
        SELECT Id, ApplicantNo, ApplicantName, ProjectId, CompanyId
        FROM dbo.FollowupApplicants
        WHERE IsDeleted = 0
        ORDER BY ApplicantName
      `),
    pool.request().query(`
        SELECT fus.Id, fus.SelectionNo, fus.UnitNo, fus.ApplicantId, fus.ProjectId, fus.CompanyId
        FROM dbo.FollowupUnitSelections fus
        WHERE fus.IsDeleted = 0
        ORDER BY fus.CreatedAt DESC, fus.Id DESC
      `),
    pool.request().query(`
        SELECT fag.Id, fag.AgreementNo, fag.ApplicantId, fag.UnitSelectionId
        FROM dbo.FollowupAgreements fag
        WHERE fag.IsDeleted = 0
        ORDER BY fag.CreatedAt DESC, fag.Id DESC
      `),
    pool.request().query(`
        SELECT Id, Name
        FROM dbo.ProjectMaster
        WHERE ISNULL(IsDeleted, 0) = 0 AND ISNULL(IsActive, 1) = 1
        ORDER BY Name
      `),
    pool.request().query(`
        SELECT Id, Name
        FROM dbo.CompanyMaster
        WHERE ISNULL(IsDeleted, 0) = 0 AND ISNULL(IsActive, 1) = 1
        ORDER BY Name
      `),
  ]);

  return {
    applicants: applicantsResult.recordset,
    unitSelections: unitSelectionsResult.recordset,
    agreements: agreementsResult.recordset,
    projects: projectsResult.recordset,
    companies: companiesResult.recordset,
    statusOptions: STATUS_OPTIONS,
  };
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildOptions());
  } catch (err) {
    console.error("followupNoc options error:", err);
    res.status(500).json({ error: "Failed to load NOC options" });
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
    const status = normalizeText(req.query.status);
    const applicantId = normalizeNumber(req.query.applicantId);

    if (Number.isNaN(applicantId)) {
      return res
        .status(400)
        .json({ error: "applicantId must be a valid number" });
    }

    const filters = ["fn.IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          fn.NOCNo           LIKE @Search
          OR fa.ApplicantNo  LIKE @Search
          OR fa.ApplicantName LIKE @Search
          OR fus.UnitNo      LIKE @Search
          OR fag.AgreementNo LIKE @Search
          OR pm.Name         LIKE @Search
        )
      `);
    }
    if (status) filters.push("fn.Status = @Status");
    if (applicantId) filters.push("fn.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const buildRequest = () => {
      const request = pool.request();
      if (search) request.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) request.input("Status", sql.NVarChar(30), status);
      if (applicantId) request.input("ApplicantId", sql.Int, applicantId);
      return request;
    };

    const countResult = await buildRequest().query(`
      SELECT COUNT(*) AS Total
      FROM dbo.FollowupNOCs fn
      INNER JOIN dbo.FollowupApplicants fa ON fa.Id = fn.ApplicantId
      LEFT JOIN  dbo.FollowupUnitSelections fus ON fus.Id = fn.UnitSelectionId
      LEFT JOIN  dbo.FollowupAgreements fag     ON fag.Id = fn.AgreementId
      LEFT JOIN  dbo.ProjectMaster pm           ON pm.Id  = fn.ProjectId
      ${whereClause}
    `);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupNOCs fn
        INNER JOIN dbo.FollowupApplicants fa     ON fa.Id  = fn.ApplicantId
        LEFT JOIN  dbo.FollowupUnitSelections fus ON fus.Id = fn.UnitSelectionId
        LEFT JOIN  dbo.FollowupAgreements fag     ON fag.Id = fn.AgreementId
        LEFT JOIN  dbo.ProjectMaster pm           ON pm.Id  = fn.ProjectId
        LEFT JOIN  dbo.CompanyMaster cm           ON cm.Id  = fn.CompanyId
        ${whereClause}
        ORDER BY fn.CreatedAt DESC, fn.Id DESC
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
    console.error("followupNoc GET error:", err);
    res.status(500).json({ error: "Failed to fetch NOCs" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const applicant = await getApplicantSnapshot(payload.ApplicantId);
    if (!applicant)
      return res.status(404).json({ error: "Applicant not found" });

    const unitSelection = await getUnitSelectionSnapshot(
      payload.UnitSelectionId,
    );
    if (payload.UnitSelectionId && !unitSelection)
      return res.status(404).json({ error: "Unit selection not found" });
    if (
      unitSelection &&
      Number(unitSelection.ApplicantId) !== Number(payload.ApplicantId)
    )
      return res
        .status(400)
        .json({
          error: "The selected unit does not belong to the selected applicant.",
        });

    const projectId =
      payload.ProjectId ||
      unitSelection?.ProjectId ||
      applicant.ProjectId ||
      null;
    const companyId =
      payload.CompanyId ||
      unitSelection?.CompanyId ||
      applicant.CompanyId ||
      null;

    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input("ProjectId", sql.Int, projectId)
      .input("CompanyId", sql.Int, companyId)
      .input("NOCDate", sql.Date, payload.NOCDate)
      .input("ApprovalDate", sql.Date, payload.ApprovalDate)
      .input("IssuedDate", sql.Date, payload.IssuedDate)
      .input("ApprovedBy", sql.NVarChar(200), payload.ApprovedBy)
      .input("Reason", sql.NVarChar(500), payload.Reason)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupNOCs (
          NOCNo, ApplicantId, UnitSelectionId, AgreementId,
          ProjectId, CompanyId,
          NOCDate, ApprovalDate, IssuedDate,
          ApprovedBy, Reason, Status, Notes,
          CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          NULL, @ApplicantId, @UnitSelectionId, @AgreementId,
          @ProjectId, @CompanyId,
          @NOCDate, @ApprovalDate, @IssuedDate,
          @ApprovedBy, @Reason, @Status, @Notes,
          @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const nocNo = `NOC${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("NOCNo", sql.NVarChar(50), nocNo)
      .query(`UPDATE dbo.FollowupNOCs SET NOCNo = @NOCNo WHERE Id = @Id`);

    await transaction.commit();
    res.status(201).json({ Id: id, NOCNo: nocNo, Status: payload.Status });
  } catch (err) {
    console.error("followupNoc POST error:", err);
    res.status(500).json({ error: "Failed to create NOC" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid NOC id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const applicant = await getApplicantSnapshot(payload.ApplicantId);
    if (!applicant)
      return res.status(404).json({ error: "Applicant not found" });

    const unitSelection = await getUnitSelectionSnapshot(
      payload.UnitSelectionId,
    );
    if (payload.UnitSelectionId && !unitSelection)
      return res.status(404).json({ error: "Unit selection not found" });
    if (
      unitSelection &&
      Number(unitSelection.ApplicantId) !== Number(payload.ApplicantId)
    )
      return res
        .status(400)
        .json({
          error: "The selected unit does not belong to the selected applicant.",
        });

    const existing = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(
        `SELECT Id FROM dbo.FollowupNOCs WHERE Id = @Id AND IsDeleted = 0`,
      );

    if (!existing.recordset[0])
      return res.status(404).json({ error: "NOC not found" });

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input(
        "ProjectId",
        sql.Int,
        payload.ProjectId ||
          unitSelection?.ProjectId ||
          applicant.ProjectId ||
          null,
      )
      .input(
        "CompanyId",
        sql.Int,
        payload.CompanyId ||
          unitSelection?.CompanyId ||
          applicant.CompanyId ||
          null,
      )
      .input("NOCDate", sql.Date, payload.NOCDate)
      .input("ApprovalDate", sql.Date, payload.ApprovalDate)
      .input("IssuedDate", sql.Date, payload.IssuedDate)
      .input("ApprovedBy", sql.NVarChar(200), payload.ApprovedBy)
      .input("Reason", sql.NVarChar(500), payload.Reason)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupNOCs SET
          ApplicantId     = @ApplicantId,
          UnitSelectionId = @UnitSelectionId,
          AgreementId     = @AgreementId,
          ProjectId       = @ProjectId,
          CompanyId       = @CompanyId,
          NOCDate         = @NOCDate,
          ApprovalDate    = @ApprovalDate,
          IssuedDate      = @IssuedDate,
          ApprovedBy      = @ApprovedBy,
          Reason          = @Reason,
          Status          = @Status,
          Notes           = @Notes,
          UpdatedBy       = @UpdatedBy,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupNoc PUT error:", err);
    res.status(500).json({ error: "Failed to update NOC" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid NOC id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupNOCs
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("followupNoc DELETE error:", err);
    res.status(500).json({ error: "Failed to delete NOC" });
  }
});

module.exports = router;
