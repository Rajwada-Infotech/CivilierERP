const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const LIST_COLUMNS = `
  fa.Id,
  fa.ApplicantNo,
  fa.ApplicantName,
  fa.PrimaryMobile,
  fa.Email,
  fa.City,
  fa.Source,
  fa.ProjectId,
  pm.Name AS ProjectName,
  fa.CompanyId,
  cm.Name AS CompanyName,
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

const STATUS_OPTIONS = ["New", "Qualified", "Shortlisted", "Document Pending", "Rejected"];

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

function getPayload(body) {
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const budgetAmount = normalizeNumber(body?.BudgetAmount);
  const assignedTo = normalizeNumber(body?.AssignedTo);

  if (
    Number.isNaN(projectId) ||
    Number.isNaN(companyId) ||
    Number.isNaN(budgetAmount) ||
    Number.isNaN(assignedTo)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  const status = normalizeText(body?.Status) || "New";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  const applicantName = normalizeText(body?.ApplicantName);
  if (!applicantName) {
    return { error: "Applicant name is required" };
  }

  return {
    ApplicantName: applicantName,
    PrimaryMobile: normalizeText(body?.PrimaryMobile),
    Email: normalizeText(body?.Email),
    City: normalizeText(body?.City),
    Source: normalizeText(body?.Source),
    ProjectId: projectId,
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

router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildCommonOptions());
  } catch (err) {
    console.error("followupApplicants options error:", err);
    res.status(500).json({ error: "Failed to load applicant options" });
  }
});

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const search = normalizeText(req.query.search);
    const status = normalizeText(req.query.status);
    const projectId = normalizeNumber(req.query.projectId);

    if (Number.isNaN(projectId)) {
      return res.status(400).json({ error: "projectId must be a valid number" });
    }

    const filters = ["fa.IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          fa.ApplicantNo LIKE @Search
          OR fa.ApplicantName LIKE @Search
          OR fa.PrimaryMobile LIKE @Search
          OR fa.Email LIKE @Search
          OR pm.Name LIKE @Search
          OR cm.Name LIKE @Search
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
      FROM dbo.FollowupApplicants fa
      LEFT JOIN dbo.ProjectMaster pm ON pm.Id = fa.ProjectId
      LEFT JOIN dbo.CompanyMaster cm ON cm.Id = fa.CompanyId
      ${whereClause}
    `);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize)
      .query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupApplicants fa
        LEFT JOIN dbo.ProjectMaster pm ON pm.Id = fa.ProjectId
        LEFT JOIN dbo.CompanyMaster cm ON cm.Id = fa.CompanyId
        LEFT JOIN dbo.users u ON u.id = fa.AssignedTo
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
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid applicant id" });
  }

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT TOP 1 ${LIST_COLUMNS}
        FROM dbo.FollowupApplicants fa
        LEFT JOIN dbo.ProjectMaster pm ON pm.Id = fa.ProjectId
        LEFT JOIN dbo.CompanyMaster cm ON cm.Id = fa.CompanyId
        LEFT JOIN dbo.users u ON u.id = fa.AssignedTo
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
});

router.post("/", async (req, res) => {
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
      .input("ApplicantName", sql.NVarChar(255), payload.ApplicantName)
      .input("PrimaryMobile", sql.NVarChar(20), payload.PrimaryMobile)
      .input("Email", sql.NVarChar(255), payload.Email)
      .input("City", sql.NVarChar(100), payload.City)
      .input("Source", sql.NVarChar(100), payload.Source)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("PreferredUnitType", sql.NVarChar(100), payload.PreferredUnitType)
      .input("BudgetAmount", sql.Decimal(18, 2), payload.BudgetAmount)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("AssignedTo", sql.Int, payload.AssignedTo)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName)
      .query(`
        INSERT INTO dbo.FollowupApplicants (
          ApplicantNo,
          ApplicantName,
          PrimaryMobile,
          Email,
          City,
          Source,
          ProjectId,
          CompanyId,
          PreferredUnitType,
          BudgetAmount,
          Status,
          AssignedTo,
          Notes,
          CreatedBy,
          CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          NULL,
          @ApplicantName,
          @PrimaryMobile,
          @Email,
          @City,
          @Source,
          @ProjectId,
          @CompanyId,
          @PreferredUnitType,
          @BudgetAmount,
          @Status,
          @AssignedTo,
          @Notes,
          @CreatedBy,
          SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const applicantNo = `APP${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("ApplicantNo", sql.NVarChar(50), applicantNo)
      .query(`
        UPDATE dbo.FollowupApplicants
        SET ApplicantNo = @ApplicantNo
        WHERE Id = @Id
      `);

    await transaction.commit();
    res.status(201).json({ Id: id, ApplicantNo: applicantNo, Status: payload.Status });
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {}
    console.error("followupApplicants POST error:", err);
    res.status(500).json({ error: "Failed to create applicant" });
  }
});

router.put("/:id", async (req, res) => {
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
    const existingResult = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT Id
        FROM dbo.FollowupApplicants
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!existingResult.recordset[0]) {
      return res.status(404).json({ error: "Applicant not found" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantName", sql.NVarChar(255), payload.ApplicantName)
      .input("PrimaryMobile", sql.NVarChar(20), payload.PrimaryMobile)
      .input("Email", sql.NVarChar(255), payload.Email)
      .input("City", sql.NVarChar(100), payload.City)
      .input("Source", sql.NVarChar(100), payload.Source)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("PreferredUnitType", sql.NVarChar(100), payload.PreferredUnitType)
      .input("BudgetAmount", sql.Decimal(18, 2), payload.BudgetAmount)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("AssignedTo", sql.Int, payload.AssignedTo)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupApplicants
        SET
          ApplicantName = @ApplicantName,
          PrimaryMobile = @PrimaryMobile,
          Email = @Email,
          City = @City,
          Source = @Source,
          ProjectId = @ProjectId,
          CompanyId = @CompanyId,
          PreferredUnitType = @PreferredUnitType,
          BudgetAmount = @BudgetAmount,
          Status = @Status,
          AssignedTo = @AssignedTo,
          Notes = @Notes,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupApplicants PUT error:", err);
    res.status(500).json({ error: "Failed to update applicant" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid applicant id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const dependencyResult = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.FollowupUnitSelections WHERE ApplicantId = @Id AND IsDeleted = 0) AS UnitSelections,
          (SELECT COUNT(*) FROM dbo.FollowupAgreements WHERE ApplicantId = @Id AND IsDeleted = 0) AS Agreements
      `);

    const dependency = dependencyResult.recordset[0];
    if (Number(dependency?.UnitSelections ?? 0) > 0 || Number(dependency?.Agreements ?? 0) > 0) {
      return res.status(400).json({
        error: "This applicant is already linked to downstream sales records and cannot be deleted.",
      });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupApplicants
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupApplicants DELETE error:", err);
    res.status(500).json({ error: "Failed to delete applicant" });
  }
});

module.exports = router;
