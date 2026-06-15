const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { validateBody } = require("../middleware/validate");
const schemas = require("../validation/followupSchemas");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const LIST_COLUMNS = `
  fa.Id,
  fa.ApplicantNo,
  fa.CustomerId,
  fa.ApplicantName,
  fa.PrimaryMobile,
  fa.Email,
  fa.PanNumber,
  fa.ApplicantAddress,
  fa.CoApplicantName,
  fa.CoApplicantPhone,
  fa.CorrespondenceAddress,
  CONVERT(VARCHAR(10), fa.ApplicationDate, 120) AS ApplicationDate,
  fa.City,
  fa.Source,
  fa.ProjectId,
  pm.name AS ProjectName,
  fa.UnitId,
  um.UnitName AS UnitName,
  bm.BlockName,
  fa.CompanyId,
  fa.PreferredUnitType,
  fa.BudgetAmount,
  fa.Status,
  fa.AssignedTo,
  u.name AS AssignedToName,
  fa.Notes,
  fa.CreatedBy,
  fa.CreatedAt,
  fa.UpdatedBy,
  fa.UpdatedAt
`;

const STATUS_OPTIONS = [
  "New",
  "Qualified",
  "Shortlisted",
  "Document Pending",
  "Rejected",
];
const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "Applicants";


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
  // Treat empty / missing values as NULL (not 0) so SQL can store NULL.
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function assertValidNumber(value, fieldName) {
  // Only reject explicit NaN values.
  if (value === null) return null;
  return Number.isNaN(value) ? `${fieldName} must be a valid number` : null;
}

function getPayload(body) {
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const budgetAmount = normalizeNumber(body?.BudgetAmount);
  const assignedTo = normalizeNumber(body?.AssignedTo);
  const customerId = normalizeNumber(body?.CustomerId);
  const unitId = normalizeNumber(body?.UnitId);

  const numericError =
    assertValidNumber(projectId, "ProjectId") ||
    assertValidNumber(companyId, "CompanyId") ||
    assertValidNumber(budgetAmount, "BudgetAmount") ||
    assertValidNumber(assignedTo, "AssignedTo") ||
    assertValidNumber(customerId, "CustomerId") ||
    assertValidNumber(unitId, "UnitId");
  if (numericError) return { error: numericError };

  const status = normalizeText(body?.Status) || "New";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  const applicantName = normalizeText(body?.ApplicantName);
  if (!applicantName) {
    return { error: "Applicant name is required" };
  }

  return {
    CustomerId: customerId,
    ApplicantName: applicantName,
    PrimaryMobile: normalizeText(body?.PrimaryMobile),
    Email: normalizeText(body?.Email),
    PanNumber: normalizeText(body?.PanNumber),
    ApplicantAddress: normalizeText(body?.ApplicantAddress),
    CoApplicantName: normalizeText(body?.CoApplicantName),
    CoApplicantPhone: normalizeText(body?.CoApplicantPhone),
    CorrespondenceAddress: normalizeText(body?.CorrespondenceAddress),
    ApplicationDate: normalizeText(body?.ApplicationDate),
    City: normalizeText(body?.City),
    Source: normalizeText(body?.Source),
    ProjectId: projectId,
    UnitId: unitId,
    CompanyId: companyId,
    PreferredUnitType: normalizeText(body?.PreferredUnitType),
    BudgetAmount: budgetAmount,
    Status: status,
    AssignedTo: assignedTo,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildCommonOptions() {
  const pool = getPool();
  const [projectsResult, companiesResult, usersResult] = await Promise.all([
    pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P'
      ORDER BY name
    `),
    pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'C'
      ORDER BY name
    `),
    pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.users
      WHERE ISNULL(discontinue, 0) = 0
      ORDER BY name
    `),
  ]);

  return {
    projects: projectsResult.recordset,
    companies: companiesResult.recordset,
    users: usersResult.recordset,
    statusOptions: STATUS_OPTIONS,
  };
}

router.get(
  "/customers",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (_req, res) => {
    try {
      const result = await getPool().request().query(`
        SELECT
          LHeadId              AS Id,
          ISNULL(DisplayName, LHeadName) AS Name,
          LHeadPhone           AS Phone,
          LHeadEmail           AS Email,
          LHeadAddress         AS Address,
          LHeadContactPerson   AS ContactPerson,
          LGST                 AS PanNumber
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'A' AND ISNULL(LHeadStatus, 1) = 1
        ORDER BY LHeadName
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupApplicants /customers error:", err);
      res.status(500).json({ error: "Failed to load customers" });
    }
  },
);

router.get(
  "/projects",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (_req, res) => {
    try {
      const result = await getPool().request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'P'
        ORDER BY name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupApplicants /projects error:", err);
      res.status(500).json({ error: "Failed to load projects" });
    }
  },
);

router.get(
  "/units",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const projectId = parseInt(req.query.projectId, 10) || null;
      const request = getPool().request();
      let where = "WHERE ISNULL(u.IsActive, 1) = 1";
      if (projectId) {
        where += " AND u.ProjectId = @ProjectId";
        request.input("ProjectId", sql.Int, projectId);
      }
      const result = await request.query(`
        SELECT u.Id, u.UnitName AS Name, u.ProjectId, u.BlockId, b.BlockName
        FROM dbo.UnitMaster u
        LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
        ${where}
        ORDER BY b.BlockName, u.UnitName
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupApplicants /units error:", err);
      res.status(500).json({ error: "Failed to load units" });
    }
  },
);

router.get(
  "/options",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      res.json(await buildCommonOptions());
    } catch (err) {
      console.error("followupApplications options error:", err);
      res.status(500).json({ error: "Failed to load applicant options" });
    }
  },
);

router.get(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(req.query.pageSize, 10) || 20),
      );
      const offset = (page - 1) * pageSize;
      const search = normalizeText(req.query.search);
      const status = normalizeText(req.query.status);
      const projectId = normalizeNumber(req.query.projectId);

      if (Number.isNaN(projectId)) {
        return res
          .status(400)
          .json({ error: "projectId must be a valid number" });
      }

      const filters = ["fa.IsDeleted = 0"];
      if (search) {
        filters.push(`
        (
          fa.ApplicantNo LIKE @Search
          OR fa.ApplicantName LIKE @Search
          OR fa.PrimaryMobile LIKE @Search
          OR fa.Email LIKE @Search
          OR fa.PanNumber LIKE @Search
          OR pm.name LIKE @Search
        )
      `);
      }
      if (status) filters.push("fa.Status = @Status");
      if (projectId) filters.push("fa.ProjectId = @ProjectId");

      const whereClause = `WHERE ${filters.join(" AND ")}`;
      const pool = getPool();
      const buildRequest = () => {
        const request = pool.request();
        if (search) request.input("Search", sql.NVarChar(255), `%${search}%`);
        if (status) request.input("Status", sql.NVarChar(30), status);
        if (projectId) request.input("ProjectId", sql.Int, projectId);
        return request;
      };

      const countResult = await buildRequest().query(`
      SELECT COUNT(*) AS Total
      FROM dbo.FollowupApplications fa
      LEFT JOIN dbo.enterprise pm ON pm.id = fa.ProjectId
      LEFT JOIN dbo.UnitMaster    um ON um.Id = fa.UnitId
      LEFT JOIN dbo.BlockMaster   bm ON bm.Id = um.BlockId
      ${whereClause}
    `);

      const dataResult = await buildRequest()
        .input("Offset", sql.Int, offset)
        .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupApplications fa
        LEFT JOIN dbo.enterprise pm ON pm.id = fa.ProjectId
          LEFT JOIN dbo.users u ON u.id = fa.AssignedTo
        LEFT JOIN dbo.UnitMaster    um ON um.Id = fa.UnitId
        LEFT JOIN dbo.BlockMaster   bm ON bm.Id = um.BlockId
        ${whereClause}
        ORDER BY fa.CreatedAt DESC, fa.Id DESC
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
      console.error("followupApplicants GET error:", err);
      res.status(500).json({ error: "Failed to fetch applicants" });
    }
  },
);

router.get(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid applicant id" });
    }

    try {
      const result = await getPool().request().input("Id", sql.Int, id).query(`
        SELECT TOP 1 ${LIST_COLUMNS}
        FROM dbo.FollowupApplications fa
        LEFT JOIN dbo.enterprise pm ON pm.id = fa.ProjectId
          LEFT JOIN dbo.users u ON u.id = fa.AssignedTo
        LEFT JOIN dbo.UnitMaster    um ON um.Id = fa.UnitId
        LEFT JOIN dbo.BlockMaster   bm ON bm.Id = um.BlockId
        WHERE fa.Id = @Id AND fa.IsDeleted = 0
      `);

      const applicant = result.recordset[0];
      if (!applicant) {
        return res.status(404).json({ error: "Applicant not found" });
      }

      res.json(applicant);
    } catch (err) {
      console.error("followupApplicants DETAIL error:", err);
      res.status(500).json({ error: "Failed to fetch applicant" });
    }
  },
);

router.post(
  "/",
  validateBody(schemas.applicationCreate),
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanAdd"),
  async (req, res) => {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const payload = getPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ error: payload.error });
    }

    const pool = getPool();

    try {
      const insertResult = await pool.request()
        .input("CustomerId", sql.Int, payload.CustomerId)
        .input("ApplicantName", sql.NVarChar(255), payload.ApplicantName)
        .input("PrimaryMobile", sql.NVarChar(20), payload.PrimaryMobile)
        .input("Email", sql.NVarChar(255), payload.Email)
        .input("PanNumber", sql.NVarChar(20), payload.PanNumber)
        .input("ApplicantAddress", sql.NVarChar(500), payload.ApplicantAddress)
        .input("CoApplicantName", sql.NVarChar(255), payload.CoApplicantName)
        .input("CoApplicantPhone", sql.NVarChar(20), payload.CoApplicantPhone)
        .input("CorrespondenceAddress", sql.NVarChar(500), payload.CorrespondenceAddress)
        .input("ApplicationDate", sql.Date, payload.ApplicationDate)
        .input("City", sql.NVarChar(100), payload.City)
        .input("Source", sql.NVarChar(100), payload.Source)
        .input("ProjectId", sql.Int, payload.ProjectId)
        .input("UnitId", sql.Int, payload.UnitId)
        .input("CompanyId", sql.Int, payload.CompanyId)
        .input("PreferredUnitType", sql.NVarChar(100), payload.PreferredUnitType)
        .input("BudgetAmount", sql.Decimal(18, 2), payload.BudgetAmount)
        .input("Status", sql.NVarChar(30), payload.Status)
        .input("AssignedTo", sql.Int, payload.AssignedTo)
        .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
        .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupApplications (
          ApplicantNo,
          CustomerId, ApplicantName, PrimaryMobile, Email,
          PanNumber, ApplicantAddress, CoApplicantName, CoApplicantPhone,
          CorrespondenceAddress, ApplicationDate,
          City, Source, ProjectId, UnitId, CompanyId,
          PreferredUnitType, BudgetAmount, Status, AssignedTo,
          Notes, CreatedBy, CreatedAt
        )
        VALUES (
          NULL,
          @CustomerId, @ApplicantName, @PrimaryMobile, @Email,
          @PanNumber, @ApplicantAddress, @CoApplicantName, @CoApplicantPhone,
          @CorrespondenceAddress, @ApplicationDate,
          @City, @Source, @ProjectId, @UnitId, @CompanyId,
          @PreferredUnitType, @BudgetAmount, @Status, @AssignedTo,
          @Notes, @CreatedBy, SYSDATETIME()
        );
        SELECT SCOPE_IDENTITY() AS Id;
      `);

      const id = Number(insertResult.recordset[0]?.Id);
      if (!id) throw new Error("Insert returned no Id");
      const applicantNo = `APP${String(id).padStart(6, "0")}`;

      await pool.request()
        .input("Id", sql.Int, id)
        .input("ApplicantNo", sql.NVarChar(50), applicantNo).query(`
        UPDATE dbo.FollowupApplications
        SET ApplicantNo = @ApplicantNo
        WHERE Id = @Id
      `);

      res.status(201).json({ Id: id, ApplicantNo: applicantNo, Status: payload.Status });
    } catch (err) {
      console.error("followupApplicants POST error:", err);
      res.status(500).json({ error: "Failed to create applicant" });
    }
  },
);

router.put(
  "/:id",
  validateBody(schemas.applicationUpdate),
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanEdit"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid applicant id" });
    }

    const userName = requireUserName(req, res);
    if (!userName) return;

    const payload = getPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ error: payload.error });
    }

    try {
      const existingResult = await getPool().request().input("Id", sql.Int, id)
        .query(`
        SELECT Id
        FROM dbo.FollowupApplications
        WHERE Id = @Id AND IsDeleted = 0
      `);

      if (!existingResult.recordset[0]) {
        return res.status(404).json({ error: "Applicant not found" });
      }

      await getPool()
        .request()
        .input("Id", sql.Int, id)
        .input("CustomerId", sql.Int, payload.CustomerId)
        .input("ApplicantName", sql.NVarChar(255), payload.ApplicantName)
        .input("PrimaryMobile", sql.NVarChar(20), payload.PrimaryMobile)
        .input("Email", sql.NVarChar(255), payload.Email)
        .input("PanNumber", sql.NVarChar(20), payload.PanNumber)
        .input("ApplicantAddress", sql.NVarChar(500), payload.ApplicantAddress)
        .input("CoApplicantName", sql.NVarChar(255), payload.CoApplicantName)
        .input("CoApplicantPhone", sql.NVarChar(20), payload.CoApplicantPhone)
        .input(
          "CorrespondenceAddress",
          sql.NVarChar(500),
          payload.CorrespondenceAddress,
        )
        .input("ApplicationDate", sql.Date, payload.ApplicationDate)
        .input("City", sql.NVarChar(100), payload.City)
        .input("Source", sql.NVarChar(100), payload.Source)
        .input("ProjectId", sql.Int, payload.ProjectId)
        .input("UnitId", sql.Int, payload.UnitId)
        .input("CompanyId", sql.Int, payload.CompanyId)
        .input(
          "PreferredUnitType",
          sql.NVarChar(100),
          payload.PreferredUnitType,
        )
        .input("BudgetAmount", sql.Decimal(18, 2), payload.BudgetAmount)
        .input("Status", sql.NVarChar(30), payload.Status)
        .input("AssignedTo", sql.Int, payload.AssignedTo)
        .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
        .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupApplications
        SET
          CustomerId            = @CustomerId,
          ApplicantName         = @ApplicantName,
          PrimaryMobile         = @PrimaryMobile,
          Email                 = @Email,
          PanNumber             = @PanNumber,
          ApplicantAddress      = @ApplicantAddress,
          CoApplicantName       = @CoApplicantName,
          CoApplicantPhone      = @CoApplicantPhone,
          CorrespondenceAddress = @CorrespondenceAddress,
          ApplicationDate       = @ApplicationDate,
          City                  = @City,
          Source                = @Source,
          ProjectId             = @ProjectId,
          UnitId                = @UnitId,
          CompanyId             = @CompanyId,
          PreferredUnitType     = @PreferredUnitType,
          BudgetAmount          = @BudgetAmount,
          Status                = @Status,
          AssignedTo            = @AssignedTo,
          Notes                 = @Notes,
          UpdatedBy             = @UpdatedBy,
          UpdatedAt             = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

      res.json({ success: true });
    } catch (err) {
      console.error("followupApplicants PUT error:", err);
      res.status(500).json({ error: "Failed to update applicant" });
    }
  },
);

router.delete(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanDelete"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid applicant id" });
    }

    const userName = requireUserName(req, res);
    if (!userName) return;

    try {
      const dependencyResult = await getPool()
        .request()
        .input("Id", sql.Int, id).query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.FollowupBookings        WHERE ApplicantId = @Id AND IsDeleted = 0) AS Bookings,
          (SELECT COUNT(*) FROM dbo.FollowupUnitSelections  WHERE ApplicantId = @Id AND IsDeleted = 0) AS UnitSelections,
          (SELECT COUNT(*) FROM dbo.FollowupAgreements      WHERE ApplicantId = @Id AND IsDeleted = 0) AS Agreements
      `);

      const dependency = dependencyResult.recordset[0];
      if (
        Number(dependency?.Bookings      ?? 0) > 0 ||
        Number(dependency?.UnitSelections ?? 0) > 0 ||
        Number(dependency?.Agreements     ?? 0) > 0
      ) {
        return res.status(400).json({
          error:
            "This applicant is already linked to downstream sales records and cannot be deleted.",
        });
      }

      await getPool()
        .request()
        .input("Id", sql.Int, id)
        .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupApplications
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

      res.json({ success: true });
    } catch (err) {
      console.error("followupApplicants DELETE error:", err);
      res.status(500).json({ error: "Failed to delete applicant" });
    }
  },
);

// ── GET /:id/timeline — full applicant journey ────────────────────────────────
router.get(
  "/:id/timeline",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid applicant id" });

    try {
      const pool = getPool();

      const [
        applicantRes,
        unitSelectionsRes,
        bookingsRes,
        welcomeCallsRes,
        agreementsRes,
        nocsRes,
        salesDeedsRes,
        handoversRes,
        logsRes,
      ] = await Promise.all([
        // Applicant detail
        pool.request().input("Id", sql.Int, id).query(`
          SELECT TOP 1 ${LIST_COLUMNS}
          FROM dbo.FollowupApplications fa
          LEFT JOIN dbo.enterprise pm ON pm.id = fa.ProjectId
          LEFT JOIN dbo.users      u  ON u.id  = fa.AssignedTo
          LEFT JOIN dbo.UnitMaster um ON um.Id = fa.UnitId
          LEFT JOIN dbo.BlockMaster bm ON bm.Id = um.BlockId
          WHERE fa.Id = @Id AND fa.IsDeleted = 0
        `),

        // Unit Selections
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fus.Id, fus.SelectionNo, fus.UnitNo, fus.BlockName, fus.FloorName,
            fus.UnitType, fus.AreaSqFt, fus.RatePerSqFt, fus.TotalValue, fus.Status,
            CONVERT(VARCHAR(10), fus.CreatedAt, 23) AS CreatedDate
          FROM dbo.FollowupUnitSelections fus
          WHERE fus.ApplicantId = @ApplicantId AND fus.IsDeleted = 0
          ORDER BY fus.CreatedAt
        `),

        // Bookings
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fb.Id, fb.BookingNo, fb.UnitNo, fb.BlockName, fb.TotalValue,
            fb.BookingAmount, fb.Status, fb.PaymentMode,
            CONVERT(VARCHAR(10), fb.BookingDate, 23) AS BookingDate,
            ep.name AS ProjectName
          FROM dbo.FollowupBookings fb
          LEFT JOIN dbo.enterprise ep ON ep.id = fb.ProjectId AND ep.business_type = 'P'
          WHERE fb.ApplicantId = @ApplicantId AND fb.IsDeleted = 0
          ORDER BY fb.BookingDate
        `),

        // Welcome Calls
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            wc.Id, wc.CallNo, wc.BookingId, fb.BookingNo,
            CONVERT(VARCHAR(10), wc.CallDate, 23) AS CallDate,
            wc.Outcome, wc.BankSelected, wc.LoanRequired,
            wc.ExpectedLoanAmount, wc.Status, wc.Notes
          FROM dbo.FollowupWelcomeCalls wc
          LEFT JOIN dbo.FollowupBookings fb ON fb.Id = wc.BookingId
          WHERE wc.ApplicantId = @ApplicantId AND wc.IsDeleted = 0
          ORDER BY wc.CallDate
        `),

        // Agreements
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fa.Id, fa.AgreementNo, fa.AgreementType, fa.Status, fa.TotalValue,
            CONVERT(VARCHAR(10), fa.AgreementDate, 23) AS AgreementDate
          FROM dbo.FollowupAgreements fa
          WHERE fa.ApplicantId = @ApplicantId AND fa.IsDeleted = 0
          ORDER BY fa.AgreementDate
        `),

        // NOCs
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fn.Id, fn.NocNo, fn.BankName, fn.NocType, fn.Status,
            CONVERT(VARCHAR(10), fn.IssueDate,  23) AS IssueDate,
            CONVERT(VARCHAR(10), fn.ExpiryDate, 23) AS ExpiryDate
          FROM dbo.FollowupNoc fn
          WHERE fn.ApplicantId = @ApplicantId AND fn.IsDeleted = 0
          ORDER BY fn.IssueDate
        `),

        // Sales Deeds
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fsd.Id, fsd.DeedNo, fsd.Status, fsd.StampDuty, fsd.RegistrationFee,
            CONVERT(VARCHAR(10), fsd.ExecutionDate,    23) AS ExecutionDate,
            CONVERT(VARCHAR(10), fsd.RegistrationDate, 23) AS RegistrationDate
          FROM dbo.FollowupSalesDeed fsd
          WHERE fsd.ApplicantId = @ApplicantId AND fsd.IsDeleted = 0
          ORDER BY fsd.ExecutionDate
        `),

        // Handovers
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT
            fho.Id, fho.HandoverNo, fho.Status, fho.UnitCondition,
            CONVERT(VARCHAR(10), fho.HandoverDate,       23) AS HandoverDate,
            CONVERT(VARCHAR(10), fho.ActualHandoverDate, 23) AS ActualHandoverDate,
            fho.ElectricMeterHandedOver, fho.WaterConnectionHandedOver,
            fho.ParkingAllotted, fho.WelcomeKitGiven
          FROM dbo.FollowupHandover fho
          WHERE fho.ApplicantId = @ApplicantId AND fho.IsDeleted = 0
          ORDER BY fho.HandoverDate
        `),

        // Audit Logs
        pool.request().input("ApplicantId", sql.Int, id).query(`
          SELECT TOP 50
            fl.Id, fl.LogType, fl.Module, fl.Notes, fl.Amount, fl.CreatedBy,
            CONVERT(VARCHAR(10), fl.LogDate, 23) AS LogDate
          FROM dbo.FollowupLog fl
          WHERE fl.RefId = @ApplicantId AND fl.IsDeleted = 0
          ORDER BY fl.CreatedAt DESC
        `),
      ]);

      if (!applicantRes.recordset.length) {
        return res.status(404).json({ error: "Applicant not found" });
      }

      res.json({
        applicant:      applicantRes.recordset[0],
        unitSelections: unitSelectionsRes.recordset,
        bookings:       bookingsRes.recordset,
        welcomeCalls:   welcomeCallsRes.recordset,
        agreements:     agreementsRes.recordset,
        nocs:           nocsRes.recordset,
        salesDeeds:     salesDeedsRes.recordset,
        handovers:      handoversRes.recordset,
        logs:           logsRes.recordset,
      });
    } catch (err) {
      console.error("followupApplicants TIMELINE error:", err);
      res.status(500).json({ error: "Failed to load applicant timeline" });
    }
  },
);

module.exports = router;