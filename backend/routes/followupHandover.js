const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

// ─── Sources ──────────────────────────────────────────────────────────────────
// Applicant  → dbo.AccountHeadMaster  WHERE LHeadType = 'A'
// Company    → dbo.enterprise         WHERE business_type = 'C'
// Project    → dbo.enterprise         WHERE business_type = 'P'

const LIST_COLUMNS = `
  fho.Id,
  fho.HandoverNo,
  fho.ApplicantId,
  COALESCE(fa.ApplicantName, ISNULL(ahm.DisplayName, ahm.LHeadName)) AS ApplicantName,
  COALESCE(fa.ApplicantNo,   ahm.LHeadCode)                         AS ApplicantNo,
  fho.UnitSelectionId,
  fus.SelectionNo,
  fus.UnitNo,
  fho.AgreementId,
  fag.AgreementNo,
  fho.SalesDeedId,
  fsd.DeedNo,
  fho.ProjectId,
  ep.name  AS ProjectName,
  fho.CompanyId,
  ec.name  AS CompanyName,
  CONVERT(VARCHAR(10), fho.HandoverDate, 23)       AS HandoverDate,
  CONVERT(VARCHAR(10), fho.ActualHandoverDate, 23) AS ActualHandoverDate,
  CONVERT(VARCHAR(10), fho.KeyHandoverDate, 23)    AS KeyHandoverDate,
  fho.UnitCondition,
  fho.SnagListItems,
  CONVERT(VARCHAR(10), fho.SnagsClearedDate, 23)  AS SnagsClearedDate,
  fho.HandedOverBy,
  fho.ReceivedBy,
  fho.WitnessNames,
  fho.ElectricMeterHandedOver,
  fho.WaterConnectionHandedOver,
  fho.ParkingAllotted,
  fho.WelcomeKitGiven,
  fho.Status,
  fho.Notes,
  fho.CreatedBy,
  fho.CreatedAt
`;

const STATUS_OPTIONS = ["Scheduled", "Completed", "Delayed", "Cancelled"];
const CONDITION_OPTIONS = [
  "Ready",
  "Punch-list Pending",
  "Snagging",
  "Minor Works",
];

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "Handover"));

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

function normalizeBit(value) {
  if (value === true || value === 1 || value === "1" || value === "true")
    return 1;
  return 0;
}

async function getApplicantSnapshot(applicantId) {
  if (!applicantId) return null;
  const result = await getPool()
    .request()
    .input("ApplicantId", sql.Int, applicantId).query(`
      SELECT TOP 1 Id FROM dbo.FollowupApplications WHERE Id = @ApplicantId AND IsDeleted = 0
      UNION ALL
      SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadId = @ApplicantId AND LHeadType = 'A' AND LHeadStatus = 1
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
  const salesDeedId = normalizeNumber(body?.SalesDeedId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(unitSelectionId) ||
    Number.isNaN(agreementId) ||
    Number.isNaN(salesDeedId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  if (!applicantId) return { error: "Applicant is required" };

  const status = normalizeText(body?.Status) || "Scheduled";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  const unitCondition = normalizeText(body?.UnitCondition);
  if (unitCondition && !CONDITION_OPTIONS.includes(unitCondition)) {
    return {
      error: `Unit condition must be one of: ${CONDITION_OPTIONS.join(", ")}`,
    };
  }

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    AgreementId: agreementId,
    SalesDeedId: salesDeedId,
    ProjectId: projectId,
    CompanyId: companyId,
    HandoverDate: normalizeText(body?.HandoverDate),
    ActualHandoverDate: normalizeText(body?.ActualHandoverDate),
    KeyHandoverDate: normalizeText(body?.KeyHandoverDate),
    UnitCondition: unitCondition,
    SnagListItems: normalizeText(body?.SnagListItems),
    SnagsClearedDate: normalizeText(body?.SnagsClearedDate),
    HandedOverBy: normalizeText(body?.HandedOverBy),
    ReceivedBy: normalizeText(body?.ReceivedBy),
    WitnessNames: normalizeText(body?.WitnessNames),
    ElectricMeterHandedOver: normalizeBit(body?.ElectricMeterHandedOver),
    WaterConnectionHandedOver: normalizeBit(body?.WaterConnectionHandedOver),
    ParkingAllotted: normalizeBit(body?.ParkingAllotted),
    WelcomeKitGiven: normalizeBit(body?.WelcomeKitGiven),
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildOptions() {
  const pool = getPool();
  const [
    applicantsR,
    unitSelectionsR,
    agreementsR,
    salesDeedsR,
    projectsR,
    companiesR,
  ] = await Promise.all([
    pool.request().query(`
        SELECT Id, ApplicantNo, ApplicantName, ProjectId, CompanyId
        FROM dbo.FollowupApplications
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
        SELECT fsd.Id, fsd.DeedNo, fsd.ApplicantId, fsd.UnitSelectionId
        FROM dbo.FollowupSalesDeeds fsd
        WHERE fsd.IsDeleted = 0
        ORDER BY fsd.CreatedAt DESC, fsd.Id DESC
      `),
    pool.request().query(`
        SELECT id AS Id, name AS Name FROM dbo.enterprise
        WHERE business_type = 'P' AND ISNULL(discontinue, 0) = 0 ORDER BY name
      `),
    pool.request().query(`
        SELECT id AS Id, name AS Name FROM dbo.enterprise
        WHERE business_type = 'C' AND ISNULL(discontinue, 0) = 0 ORDER BY name
      `),
  ]);

  return {
    applicants: applicantsR.recordset,
    unitSelections: unitSelectionsR.recordset,
    agreements: agreementsR.recordset,
    salesDeeds: salesDeedsR.recordset,
    projects: projectsR.recordset,
    companies: companiesR.recordset,
    statusOptions: STATUS_OPTIONS,
    conditionOptions: CONDITION_OPTIONS,
  };
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildOptions());
  } catch (err) {
    console.error("followupHandover options error:", err);
    res.status(500).json({ error: "Failed to load Handover options" });
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

    if (Number.isNaN(applicantId))
      return res
        .status(400)
        .json({ error: "applicantId must be a valid number" });

    const filters = ["fho.IsDeleted = 0"];
    if (search) {
      filters.push(`(
        fho.HandoverNo                              LIKE @Search
        OR COALESCE(fa.ApplicantNo,   ahm.LHeadCode)                          LIKE @Search
        OR COALESCE(fa.ApplicantName, ISNULL(ahm.DisplayName, ahm.LHeadName)) LIKE @Search
        OR fus.UnitNo                               LIKE @Search
        OR fag.AgreementNo                          LIKE @Search
        OR fsd.DeedNo                               LIKE @Search
        OR ep.name                                  LIKE @Search
      )`);
    }
    if (status) filters.push("fho.Status = @Status");
    if (applicantId) filters.push("fho.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupHandovers fho
      LEFT JOIN  dbo.AccountHeadMaster ahm     ON ahm.LHeadId = fho.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN  dbo.FollowupApplications fa   ON fa.Id = fho.ApplicantId AND fa.IsDeleted = 0 AND ahm.LHeadId IS NULL
      LEFT JOIN  dbo.FollowupUnitSelections fus ON fus.Id = fho.UnitSelectionId
      LEFT JOIN  dbo.FollowupAgreements fag     ON fag.Id = fho.AgreementId
      LEFT JOIN  dbo.FollowupSalesDeeds fsd     ON fsd.Id = fho.SalesDeedId
      LEFT JOIN  dbo.enterprise ep              ON ep.id  = fho.ProjectId  AND ep.business_type = 'P'
      LEFT JOIN  dbo.enterprise ec              ON ec.id  = fho.CompanyId  AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const r = pool.request();
      if (search) r.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) r.input("Status", sql.NVarChar(30), status);
      if (applicantId) r.input("ApplicantId", sql.Int, applicantId);
      return r;
    };

    const countResult = await buildRequest().query(
      `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`,
    );
    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY fho.CreatedAt DESC, fho.Id DESC
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
    console.error("followupHandover GET error:", err);
    res.status(500).json({ error: "Failed to fetch Handovers" });
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
      return res.status(400).json({
        error: "The selected unit does not belong to the selected applicant.",
      });

    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input("SalesDeedId", sql.Int, payload.SalesDeedId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("HandoverDate", sql.Date, payload.HandoverDate)
      .input("ActualHandoverDate", sql.Date, payload.ActualHandoverDate)
      .input("KeyHandoverDate", sql.Date, payload.KeyHandoverDate)
      .input("UnitCondition", sql.NVarChar(50), payload.UnitCondition)
      .input("SnagListItems", sql.NVarChar(sql.MAX), payload.SnagListItems)
      .input("SnagsClearedDate", sql.Date, payload.SnagsClearedDate)
      .input("HandedOverBy", sql.NVarChar(200), payload.HandedOverBy)
      .input("ReceivedBy", sql.NVarChar(200), payload.ReceivedBy)
      .input("WitnessNames", sql.NVarChar(500), payload.WitnessNames)
      .input(
        "ElectricMeterHandedOver",
        sql.Bit,
        payload.ElectricMeterHandedOver,
      )
      .input(
        "WaterConnectionHandedOver",
        sql.Bit,
        payload.WaterConnectionHandedOver,
      )
      .input("ParkingAllotted", sql.Bit, payload.ParkingAllotted)
      .input("WelcomeKitGiven", sql.Bit, payload.WelcomeKitGiven)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupHandovers (
          HandoverNo, ApplicantId, UnitSelectionId, AgreementId, SalesDeedId,
          ProjectId, CompanyId,
          HandoverDate, ActualHandoverDate, KeyHandoverDate,
          UnitCondition, SnagListItems, SnagsClearedDate,
          HandedOverBy, ReceivedBy, WitnessNames,
          ElectricMeterHandedOver, WaterConnectionHandedOver, ParkingAllotted, WelcomeKitGiven,
          Status, Notes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          NULL, @ApplicantId, @UnitSelectionId, @AgreementId, @SalesDeedId,
          @ProjectId, @CompanyId,
          @HandoverDate, @ActualHandoverDate, @KeyHandoverDate,
          @UnitCondition, @SnagListItems, @SnagsClearedDate,
          @HandedOverBy, @ReceivedBy, @WitnessNames,
          @ElectricMeterHandedOver, @WaterConnectionHandedOver, @ParkingAllotted, @WelcomeKitGiven,
          @Status, @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const handoverNo = `HO${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("HandoverNo", sql.NVarChar(50), handoverNo)
      .query(
        `UPDATE dbo.FollowupHandovers SET HandoverNo = @HandoverNo WHERE Id = @Id`,
      );

    await transaction.commit();
    res
      .status(201)
      .json({ Id: id, HandoverNo: handoverNo, Status: payload.Status });
  } catch (err) {
    console.error("followupHandover POST error:", err);
    res.status(500).json({ error: "Failed to create Handover" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid Handover id" });

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
      return res.status(400).json({
        error: "The selected unit does not belong to the selected applicant.",
      });

    const existing = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(
        `SELECT Id FROM dbo.FollowupHandovers WHERE Id = @Id AND IsDeleted = 0`,
      );
    if (!existing.recordset[0])
      return res.status(404).json({ error: "Handover not found" });

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("AgreementId", sql.Int, payload.AgreementId)
      .input("SalesDeedId", sql.Int, payload.SalesDeedId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("HandoverDate", sql.Date, payload.HandoverDate)
      .input("ActualHandoverDate", sql.Date, payload.ActualHandoverDate)
      .input("KeyHandoverDate", sql.Date, payload.KeyHandoverDate)
      .input("UnitCondition", sql.NVarChar(50), payload.UnitCondition)
      .input("SnagListItems", sql.NVarChar(sql.MAX), payload.SnagListItems)
      .input("SnagsClearedDate", sql.Date, payload.SnagsClearedDate)
      .input("HandedOverBy", sql.NVarChar(200), payload.HandedOverBy)
      .input("ReceivedBy", sql.NVarChar(200), payload.ReceivedBy)
      .input("WitnessNames", sql.NVarChar(500), payload.WitnessNames)
      .input(
        "ElectricMeterHandedOver",
        sql.Bit,
        payload.ElectricMeterHandedOver,
      )
      .input(
        "WaterConnectionHandedOver",
        sql.Bit,
        payload.WaterConnectionHandedOver,
      )
      .input("ParkingAllotted", sql.Bit, payload.ParkingAllotted)
      .input("WelcomeKitGiven", sql.Bit, payload.WelcomeKitGiven)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupHandovers SET
          ApplicantId               = @ApplicantId,
          UnitSelectionId           = @UnitSelectionId,
          AgreementId               = @AgreementId,
          SalesDeedId               = @SalesDeedId,
          ProjectId                 = @ProjectId,
          CompanyId                 = @CompanyId,
          HandoverDate              = @HandoverDate,
          ActualHandoverDate        = @ActualHandoverDate,
          KeyHandoverDate           = @KeyHandoverDate,
          UnitCondition             = @UnitCondition,
          SnagListItems             = @SnagListItems,
          SnagsClearedDate          = @SnagsClearedDate,
          HandedOverBy              = @HandedOverBy,
          ReceivedBy                = @ReceivedBy,
          WitnessNames              = @WitnessNames,
          ElectricMeterHandedOver   = @ElectricMeterHandedOver,
          WaterConnectionHandedOver = @WaterConnectionHandedOver,
          ParkingAllotted           = @ParkingAllotted,
          WelcomeKitGiven           = @WelcomeKitGiven,
          Status                    = @Status,
          Notes                     = @Notes,
          UpdatedBy                 = @UpdatedBy,
          UpdatedAt                 = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupHandover PUT error:", err);
    res.status(500).json({ error: "Failed to update Handover" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid Handover id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupHandovers
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("followupHandover DELETE error:", err);
    res.status(500).json({ error: "Failed to delete Handover" });
  }
});

module.exports = router;




