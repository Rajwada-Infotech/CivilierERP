const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ─── Sources ──────────────────────────────────────────────────────────────────
// Applicant  → dbo.AccountHeadMaster  WHERE LHeadType = 'A'  (LHeadId, LHeadName/DisplayName, LHeadCode)
// Company    → dbo.enterprise         WHERE business_type = 'C'  (id, name)
// Project    → dbo.enterprise         WHERE business_type = 'P'  (id, name)

const LIST_COLUMNS = `
  fsd.Id,
  fsd.DeedNo,
  fsd.ApplicantId,
  ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
  ahm.LHeadCode                          AS ApplicantNo,
  fsd.UnitSelectionId,
  fus.SelectionNo,
  fus.UnitNo,
  fsd.AgreementId,
  fag.AgreementNo,
  fsd.ProjectId,
  ep.name  AS ProjectName,
  fsd.CompanyId,
  ec.name  AS CompanyName,
  fsd.DeedValue,
  fsd.StampDuty,
  fsd.RegistrationFee,
  fsd.SubRegistrarOffice,
  fsd.RegistrationNo,
  fsd.BookNo,
  fsd.PartNo,
  CONVERT(VARCHAR(10), fsd.DeedDate, 23)         AS DeedDate,
  CONVERT(VARCHAR(10), fsd.RegistrationDate, 23) AS RegistrationDate,
  CONVERT(VARCHAR(10), fsd.PossessionDate, 23)   AS PossessionDate,
  fsd.ExecutedBy,
  fsd.WitnessNames,
  fsd.Status,
  fsd.Notes,
  fsd.CreatedBy,
  fsd.CreatedAt
`;

const STATUS_OPTIONS = ["Draft", "Executed", "Registered", "Cancelled"];

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "SalesDeed"));

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

// Validate applicant exists in AccountHeadMaster LHeadType='A'
async function getApplicantSnapshot(applicantId) {
  if (!applicantId) return null;
  const result = await getPool()
    .request()
    .input("ApplicantId", sql.Int, applicantId).query(`
      SELECT TOP 1 LHeadId AS Id
      FROM dbo.AccountHeadMaster
      WHERE LHeadId = @ApplicantId
        AND LHeadType = 'A'
        AND LHeadStatus = 1
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
  const deedValue = normalizeNumber(body?.DeedValue);
  const stampDuty = normalizeNumber(body?.StampDuty);
  const registrationFee = normalizeNumber(body?.RegistrationFee);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(unitSelectionId) ||
    Number.isNaN(agreementId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId) ||
    Number.isNaN(deedValue) ||
    Number.isNaN(stampDuty) ||
    Number.isNaN(registrationFee)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  if (!applicantId) {
    return { error: "Applicant is required" };
  }

  const status = normalizeText(body?.Status) || "Draft";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    AgreementId: agreementId,
    ProjectId: projectId,
    CompanyId: companyId,
    DeedValue: deedValue,
    StampDuty: stampDuty,
    RegistrationFee: registrationFee,
    SubRegistrarOffice: normalizeText(body?.SubRegistrarOffice),
    RegistrationNo: normalizeText(body?.RegistrationNo),
    BookNo: normalizeText(body?.BookNo),
    PartNo: normalizeText(body?.PartNo),
    DeedDate: normalizeText(body?.DeedDate),
    RegistrationDate: normalizeText(body?.RegistrationDate),
    PossessionDate: normalizeText(body?.PossessionDate),
    ExecutedBy: normalizeText(body?.ExecutedBy),
    WitnessNames: normalizeText(body?.WitnessNames),
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
    // Applicants from AccountHeadMaster where LHeadType = 'A'
    pool.request().query(`
        SELECT
          LHeadId                        AS Id,
          ISNULL(DisplayName, LHeadName) AS ApplicantName,
          LHeadCode                      AS ApplicantNo
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'A'
          AND LHeadStatus = 1
        ORDER BY ISNULL(DisplayName, LHeadName)
      `),
    // Unit selections
    pool.request().query(`
        SELECT
          fus.Id,
          fus.SelectionNo,
          fus.UnitNo,
          fus.ApplicantId,
          fus.ProjectId,
          fus.CompanyId
        FROM dbo.FollowupUnitSelections fus
        WHERE fus.IsDeleted = 0
        ORDER BY fus.CreatedAt DESC, fus.Id DESC
      `),
    // Agreements
    pool.request().query(`
        SELECT
          fag.Id,
          fag.AgreementNo,
          fag.ApplicantId,
          fag.UnitSelectionId
        FROM dbo.FollowupAgreements fag
        WHERE fag.IsDeleted = 0
        ORDER BY fag.CreatedAt DESC, fag.Id DESC
      `),
    // Projects from enterprise where business_type = 'P'
    pool.request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'P'
          AND ISNULL(discontinue, 0) = 0
        ORDER BY name
      `),
    // Companies from enterprise where business_type = 'C'
    pool.request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'C'
          AND ISNULL(discontinue, 0) = 0
        ORDER BY name
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
    console.error("followupSalesDeed options error:", err);
    res.status(500).json({ error: "Failed to load Sales Deed options" });
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

    const filters = ["fsd.IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          fsd.DeedNo                                  LIKE @Search
          OR fsd.RegistrationNo                       LIKE @Search
          OR ahm.LHeadCode                            LIKE @Search
          OR ISNULL(ahm.DisplayName, ahm.LHeadName)  LIKE @Search
          OR fus.UnitNo                               LIKE @Search
          OR fag.AgreementNo                          LIKE @Search
          OR ep.name                                  LIKE @Search
          OR fsd.SubRegistrarOffice                   LIKE @Search
        )
      `);
    }
    if (status) filters.push("fsd.Status = @Status");
    if (applicantId) filters.push("fsd.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupSalesDeeds fsd
      INNER JOIN dbo.AccountHeadMaster ahm  ON ahm.LHeadId = fsd.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN  dbo.FollowupUnitSelections fus ON fus.Id  = fsd.UnitSelectionId
      LEFT JOIN  dbo.FollowupAgreements fag     ON fag.Id  = fsd.AgreementId
      LEFT JOIN  dbo.enterprise ep              ON ep.id   = fsd.ProjectId  AND ep.business_type = 'P'
      LEFT JOIN  dbo.enterprise ec              ON ec.id   = fsd.CompanyId  AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const request = pool.request();
      if (search) request.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) request.input("Status", sql.NVarChar(30), status);
      if (applicantId) request.input("ApplicantId", sql.Int, applicantId);
      return request;
    };

    const countResult = await buildRequest().query(`
      SELECT COUNT(*) AS Total
      ${BASE_JOINS}
      ${whereClause}
    `);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY fsd.CreatedAt DESC, fsd.Id DESC
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
    console.error("followupSalesDeed GET error:", err);
    res.status(500).json({ error: "Failed to fetch Sales Deeds" });
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
      return res
        .status(404)
        .json({ error: "Applicant not found in account master" });

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

    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("DeedValue", sql.Decimal(18, 2), payload.DeedValue)
      .input("StampDuty", sql.Decimal(18, 2), payload.StampDuty)
      .input("RegistrationFee", sql.Decimal(18, 2), payload.RegistrationFee)
      .input(
        "SubRegistrarOffice",
        sql.NVarChar(200),
        payload.SubRegistrarOffice,
      )
      .input("RegistrationNo", sql.NVarChar(100), payload.RegistrationNo)
      .input("BookNo", sql.NVarChar(50), payload.BookNo)
      .input("PartNo", sql.NVarChar(50), payload.PartNo)
      .input("DeedDate", sql.Date, payload.DeedDate)
      .input("RegistrationDate", sql.Date, payload.RegistrationDate)
      .input("PossessionDate", sql.Date, payload.PossessionDate)
      .input("ExecutedBy", sql.NVarChar(200), payload.ExecutedBy)
      .input("WitnessNames", sql.NVarChar(500), payload.WitnessNames)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupSalesDeeds (
          DeedNo, ApplicantId, UnitSelectionId, AgreementId,
          ProjectId, CompanyId,
          DeedValue, StampDuty, RegistrationFee,
          SubRegistrarOffice, RegistrationNo, BookNo, PartNo,
          DeedDate, RegistrationDate, PossessionDate,
          ExecutedBy, WitnessNames,
          Status, Notes,
          CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          NULL, @ApplicantId, @UnitSelectionId, @AgreementId,
          @ProjectId, @CompanyId,
          @DeedValue, @StampDuty, @RegistrationFee,
          @SubRegistrarOffice, @RegistrationNo, @BookNo, @PartNo,
          @DeedDate, @RegistrationDate, @PossessionDate,
          @ExecutedBy, @WitnessNames,
          @Status, @Notes,
          @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const deedNo = `DEED${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("DeedNo", sql.NVarChar(50), deedNo)
      .query(
        `UPDATE dbo.FollowupSalesDeeds SET DeedNo = @DeedNo WHERE Id = @Id`,
      );

    await transaction.commit();
    res.status(201).json({ Id: id, DeedNo: deedNo, Status: payload.Status });
  } catch (err) {
    console.error("followupSalesDeed POST error:", err);
    res.status(500).json({ error: "Failed to create Sales Deed" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid Sales Deed id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const applicant = await getApplicantSnapshot(payload.ApplicantId);
    if (!applicant)
      return res
        .status(404)
        .json({ error: "Applicant not found in account master" });

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
        `SELECT Id FROM dbo.FollowupSalesDeeds WHERE Id = @Id AND IsDeleted = 0`,
      );

    if (!existing.recordset[0])
      return res.status(404).json({ error: "Sales Deed not found" });

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("DeedValue", sql.Decimal(18, 2), payload.DeedValue)
      .input("StampDuty", sql.Decimal(18, 2), payload.StampDuty)
      .input("RegistrationFee", sql.Decimal(18, 2), payload.RegistrationFee)
      .input(
        "SubRegistrarOffice",
        sql.NVarChar(200),
        payload.SubRegistrarOffice,
      )
      .input("RegistrationNo", sql.NVarChar(100), payload.RegistrationNo)
      .input("BookNo", sql.NVarChar(50), payload.BookNo)
      .input("PartNo", sql.NVarChar(50), payload.PartNo)
      .input("DeedDate", sql.Date, payload.DeedDate)
      .input("RegistrationDate", sql.Date, payload.RegistrationDate)
      .input("PossessionDate", sql.Date, payload.PossessionDate)
      .input("ExecutedBy", sql.NVarChar(200), payload.ExecutedBy)
      .input("WitnessNames", sql.NVarChar(500), payload.WitnessNames)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupSalesDeeds SET
          ApplicantId        = @ApplicantId,
          UnitSelectionId    = @UnitSelectionId,
          AgreementId        = @AgreementId,
          ProjectId          = @ProjectId,
          CompanyId          = @CompanyId,
          DeedValue          = @DeedValue,
          StampDuty          = @StampDuty,
          RegistrationFee    = @RegistrationFee,
          SubRegistrarOffice = @SubRegistrarOffice,
          RegistrationNo     = @RegistrationNo,
          BookNo             = @BookNo,
          PartNo             = @PartNo,
          DeedDate           = @DeedDate,
          RegistrationDate   = @RegistrationDate,
          PossessionDate     = @PossessionDate,
          ExecutedBy         = @ExecutedBy,
          WitnessNames       = @WitnessNames,
          Status             = @Status,
          Notes              = @Notes,
          UpdatedBy          = @UpdatedBy,
          UpdatedAt          = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupSalesDeed PUT error:", err);
    res.status(500).json({ error: "Failed to update Sales Deed" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid Sales Deed id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupSalesDeeds
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("followupSalesDeed DELETE error:", err);
    res.status(500).json({ error: "Failed to delete Sales Deed" });
  }
});

module.exports = router;

