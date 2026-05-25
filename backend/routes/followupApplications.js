const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const router = express.Router();

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
      SELECT Id, Name
      FROM (SELECT 0 AS Id, '' AS Name WHERE 1=0) AS _empty
      WHERE ISNULL(IsDeleted, 0) = 0 AND ISNULL(IsActive, 1) = 1
      ORDER BY Name
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
          LHeadId   AS Id,
          ISNULL(DisplayName, LHeadName) AS Name,
          LHeadPhone AS Phone,
          LHeadEmail AS Email
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
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanAdd"),
  async (req, res) => {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const payload = getPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ error: payload.error });
    }

    const transaction = new sql.Transaction(getPool());

    try {
      await transaction.begin();

      const insertResult = await new sql.Request(transaction)
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
        OUTPUT INSERTED.Id
        VALUES (
          NULL,
          @CustomerId, @ApplicantName, @PrimaryMobile, @Email,
          @PanNumber, @ApplicantAddress, @CoApplicantName, @CoApplicantPhone,
          @CorrespondenceAddress, @ApplicationDate,
          @City, @Source, @ProjectId, @UnitId, @CompanyId,
          @PreferredUnitType, @BudgetAmount, @Status, @AssignedTo,
          @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

      const id = insertResult.recordset[0]?.Id;
      const applicantNo = `APP${String(id).padStart(6, "0")}`;

      await new sql.Request(transaction)
        .input("Id", sql.Int, id)
        .input("ApplicantNo", sql.NVarChar(50), applicantNo).query(`
        UPDATE dbo.FollowupApplications
        SET ApplicantNo = @ApplicantNo
        WHERE Id = @Id
      `);

      await transaction.commit();
      res
        .status(201)
        .json({ Id: id, ApplicantNo: applicantNo, Status: payload.Status });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {}
      console.error("followupApplicants POST error:", err);
      res.status(500).json({ error: "Failed to create applicant" });
    }
  },
);

router.put(
  "/:id",
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
          (SELECT COUNT(*) FROM dbo.FollowupUnitSelections WHERE ApplicantId = @Id AND IsDeleted = 0) AS UnitSelections,
          (SELECT COUNT(*) FROM dbo.FollowupAgreements WHERE ApplicantId = @Id AND IsDeleted = 0) AS Agreements
      `);

      const dependency = dependencyResult.recordset[0];
      if (
        Number(dependency?.UnitSelections ?? 0) > 0 ||
        Number(dependency?.Agreements ?? 0) > 0
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

module.exports = router;
