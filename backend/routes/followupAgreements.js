const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const LIST_COLUMNS = `
  fag.Id,
  fag.AgreementNo,
  fag.ApplicantId,
  ISNULL(ahm.LHeadCode, 'APP' + RIGHT('000000' + CAST(fa.Id AS VARCHAR(10)), 6))   AS ApplicantNo,
  ISNULL(ISNULL(ahm.DisplayName, ahm.LHeadName), fa.ApplicantName)                 AS ApplicantName,
  fag.UnitSelectionId,
  fus.SelectionNo,
  fus.UnitNo,
  fag.BookingId,
  fb.BookingNo,
  fag.ProjectId,
  ep.name AS ProjectName,
  fag.CompanyId,
  ec.name AS CompanyName,
  CONVERT(VARCHAR(10), fag.AgreementDate, 23) AS AgreementDate,
  fag.AgreementValue,
  fag.AdvanceAmount,
  fag.BalanceAmount,
  CONVERT(VARCHAR(10), fag.RegistrationDate, 23) AS RegistrationDate,
  fag.Status,
  fag.Notes,
  fag.CreatedBy,
  fag.CreatedAt,
  fag.UpdatedBy,
  fag.UpdatedAt
`;

const STATUS_OPTIONS = ["Draft", "Issued", "Signed", "Cancelled"];

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "Agreements"));

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
      SELECT TOP 1 LHeadId AS Id, NULL AS ProjectId, NULL AS CompanyId
      FROM dbo.AccountHeadMaster
      WHERE LHeadId = @ApplicantId AND LHeadType = 'A' AND ISNULL(LHeadStatus, 1) = 1
      UNION ALL
      SELECT TOP 1 Id, ProjectId, CompanyId
      FROM dbo.FollowupApplications
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
  const bookingId = normalizeNumber(body?.BookingId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const agreementValue = normalizeNumber(body?.AgreementValue);
  const advanceAmount = normalizeNumber(body?.AdvanceAmount);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(unitSelectionId) ||
    Number.isNaN(bookingId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId) ||
    Number.isNaN(agreementValue) ||
    Number.isNaN(advanceAmount)
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

  const balanceAmount =
    agreementValue !== null && advanceAmount !== null
      ? agreementValue - advanceAmount
      : null;

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    BookingId: bookingId,
    ProjectId: projectId,
    CompanyId: companyId,
    AgreementDate: normalizeText(body?.AgreementDate),
    AgreementValue: agreementValue,
    AdvanceAmount: advanceAmount,
    BalanceAmount: balanceAmount,
    RegistrationDate: normalizeText(body?.RegistrationDate),
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildOptions() {
  const pool = getPool();
  const [
    applicantsResult,
    unitSelectionsResult,
    bookingsResult,
    projectsResult,
    companiesResult,
  ] = await Promise.all([
    pool.request().query(`
        SELECT
          LHeadId                                                                AS Id,
          LHeadCode                                                              AS ApplicantNo,
          ISNULL(DisplayName, LHeadName)                                        AS ApplicantName,
          NULL                                                                   AS ProjectId,
          NULL                                                                   AS CompanyId
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'A' AND ISNULL(LHeadStatus, 1) = 1
        ORDER BY LHeadName
      `),
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
    pool.request().query(`
        SELECT
          fb.Id,
          fb.BookingNo,
          fb.UnitNo,
          fb.ApplicantId,
          fb.ProjectId,
          fb.CompanyId
        FROM dbo.FollowupBookings fb
        WHERE fb.IsDeleted = 0
        ORDER BY fb.CreatedAt DESC, fb.Id DESC
      `),
    pool.request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'P' AND (discontinue = 0 OR discontinue IS NULL)
        ORDER BY name
      `),
    pool.request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'C' AND (discontinue = 0 OR discontinue IS NULL)
        ORDER BY name
      `),
  ]);

  return {
    applicants: applicantsResult.recordset,
    unitSelections: unitSelectionsResult.recordset,
    bookings: bookingsResult.recordset,
    projects: projectsResult.recordset,
    companies: companiesResult.recordset,
    statusOptions: STATUS_OPTIONS,
  };
}

router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildOptions());
  } catch (err) {
    console.error("followupAgreements options error:", err);
    res.status(500).json({ error: "Failed to load agreement options" });
  }
});

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

    const filters = ["fag.IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          fag.AgreementNo LIKE @Search
          OR ahm.LHeadCode LIKE @Search
          OR ISNULL(ahm.DisplayName, ahm.LHeadName) LIKE @Search
          OR fa.ApplicantNo LIKE @Search
          OR fa.ApplicantName LIKE @Search
          OR fus.SelectionNo LIKE @Search
          OR fus.UnitNo LIKE @Search
        )
      `);
    }
    if (status) filters.push("fag.Status = @Status");
    if (applicantId) filters.push("fag.ApplicantId = @ApplicantId");

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
      FROM dbo.FollowupAgreements fag
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = fag.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN dbo.FollowupApplications fa ON fa.Id = fag.ApplicantId AND fa.IsDeleted = 0 AND ahm.LHeadId IS NULL
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = fag.UnitSelectionId AND fus.IsDeleted = 0
      LEFT JOIN dbo.FollowupBookings fb ON fb.Id = fag.BookingId AND fb.IsDeleted = 0
      LEFT JOIN dbo.enterprise ep ON ep.id = fag.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.enterprise ec ON ec.id = fag.CompanyId AND ec.business_type = 'C'
      ${whereClause}
    `);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupAgreements fag
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = fag.ApplicantId AND ahm.LHeadType = 'A'
        LEFT JOIN dbo.FollowupApplications fa ON fa.Id = fag.ApplicantId AND fa.IsDeleted = 0 AND ahm.LHeadId IS NULL
        LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = fag.UnitSelectionId AND fus.IsDeleted = 0
        LEFT JOIN dbo.FollowupBookings fb ON fb.Id = fag.BookingId AND fb.IsDeleted = 0
        LEFT JOIN dbo.enterprise ep ON ep.id = fag.ProjectId AND ep.business_type = 'P'
        LEFT JOIN dbo.enterprise ec ON ec.id = fag.CompanyId AND ec.business_type = 'C'
        ${whereClause}
        ORDER BY fag.CreatedAt DESC, fag.Id DESC
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
    console.error("followupAgreements GET error:", err);
    res.status(500).json({ error: "Failed to fetch agreements" });
  }
});

router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const applicant = await getApplicantSnapshot(payload.ApplicantId);
    if (!applicant) {
      return res.status(404).json({ error: "Applicant not found" });
    }

    const unitSelection = await getUnitSelectionSnapshot(
      payload.UnitSelectionId,
    );
    if (payload.UnitSelectionId && !unitSelection) {
      return res.status(404).json({ error: "Unit selection not found" });
    }
    if (
      unitSelection &&
      Number(unitSelection.ApplicantId) !== Number(payload.ApplicantId)
    ) {
      return res.status(400).json({
        error: "The selected unit does not belong to the selected applicant.",
      });
    }

    const pool = getPool();

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

    const insertResult = await pool
      .request()
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("BookingId", sql.Int, payload.BookingId)
      .input("ProjectId", sql.Int, projectId)
      .input("CompanyId", sql.Int, companyId)
      .input("AgreementDate", sql.Date, payload.AgreementDate)
      .input("AgreementValue", sql.Decimal(18, 2), payload.AgreementValue)
      .input("AdvanceAmount", sql.Decimal(18, 2), payload.AdvanceAmount)
      .input("BalanceAmount", sql.Decimal(18, 2), payload.BalanceAmount)
      .input("RegistrationDate", sql.Date, payload.RegistrationDate)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupAgreements (
          AgreementNo, ApplicantId, UnitSelectionId, BookingId,
          ProjectId, CompanyId, AgreementDate, AgreementValue,
          AdvanceAmount, BalanceAmount, RegistrationDate,
          Status, Notes, CreatedBy, CreatedAt
        )
        VALUES (
          NULL, @ApplicantId, @UnitSelectionId, @BookingId,
          @ProjectId, @CompanyId, @AgreementDate, @AgreementValue,
          @AdvanceAmount, @BalanceAmount, @RegistrationDate,
          @Status, @Notes, @CreatedBy, SYSDATETIME()
        );
        SELECT SCOPE_IDENTITY() AS Id;
      `);

    const id = Number(insertResult.recordset[0]?.Id);
    if (!id) throw new Error("Insert returned no Id");
    const agreementNo = `AGR${String(id).padStart(6, "0")}`;

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("AgreementNo", sql.NVarChar(50), agreementNo).query(`
        UPDATE dbo.FollowupAgreements
        SET AgreementNo = @AgreementNo
        WHERE Id = @Id
      `);

    res
      .status(201)
      .json({ Id: id, AgreementNo: agreementNo, Status: payload.Status });
  } catch (err) {
    console.error("followupAgreements POST error:", err);
    res.status(500).json({ error: "Failed to create agreement" });
  }
});

router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid agreement id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const applicant = await getApplicantSnapshot(payload.ApplicantId);
    if (!applicant) {
      return res.status(404).json({ error: "Applicant not found" });
    }

    const unitSelection = await getUnitSelectionSnapshot(
      payload.UnitSelectionId,
    );
    if (payload.UnitSelectionId && !unitSelection) {
      return res.status(404).json({ error: "Unit selection not found" });
    }
    if (
      unitSelection &&
      Number(unitSelection.ApplicantId) !== Number(payload.ApplicantId)
    ) {
      return res.status(400).json({
        error: "The selected unit does not belong to the selected applicant.",
      });
    }

    const existingResult = await getPool().request().input("Id", sql.Int, id)
      .query(`
        SELECT Id
        FROM dbo.FollowupAgreements
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!existingResult.recordset[0]) {
      return res.status(404).json({ error: "Agreement not found" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("BookingId", sql.Int, payload.BookingId)
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
      .input("AgreementDate", sql.Date, payload.AgreementDate)
      .input("AgreementValue", sql.Decimal(18, 2), payload.AgreementValue)
      .input("AdvanceAmount", sql.Decimal(18, 2), payload.AdvanceAmount)
      .input("BalanceAmount", sql.Decimal(18, 2), payload.BalanceAmount)
      .input("RegistrationDate", sql.Date, payload.RegistrationDate)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupAgreements
        SET
          ApplicantId = @ApplicantId,
          UnitSelectionId = @UnitSelectionId,
          BookingId = @BookingId,
          ProjectId = @ProjectId,
          CompanyId = @CompanyId,
          AgreementDate = @AgreementDate,
          AgreementValue = @AgreementValue,
          AdvanceAmount = @AdvanceAmount,
          BalanceAmount = @BalanceAmount,
          RegistrationDate = @RegistrationDate,
          Status = @Status,
          Notes = @Notes,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupAgreements PUT error:", err);
    res.status(500).json({ error: "Failed to update agreement" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid agreement id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const pool = getPool();

    const checkResult = await pool.request().input("Id", sql.Int, id).query(`
      SELECT Status FROM dbo.FollowupAgreements WHERE Id = @Id AND IsDeleted = 0
    `);
    const existing = checkResult.recordset[0];
    if (!existing)
      return res.status(404).json({ error: "Agreement not found" });
    if (existing.Status === "Signed") {
      return res
        .status(409)
        .json({ error: "Signed agreements cannot be deleted." });
    }

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupAgreements
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupAgreements DELETE error:", err);
    res.status(500).json({ error: "Failed to delete agreement" });
  }
});

module.exports = router;
