const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const LIST_COLUMNS = `
  fus.Id,
  fus.SelectionNo,
  fus.ApplicantId,
  fa.ApplicantNo,
  fa.ApplicantName,
  fus.ProjectId,
  pm.name AS ProjectName,
  fus.CompanyId,
  cm.name AS CompanyName,
  fus.UnitNo,
  fus.BlockName,
  fus.FloorName,
  fus.UnitType,
  fus.AreaSqFt,
  fus.RatePerSqFt,
  fus.TotalValue,
  fus.BookingAmount,
  CONVERT(VARCHAR(10), fus.SelectionDate, 23) AS SelectionDate,
  fus.Status,
  fus.Notes,
  fus.CreatedBy,
  fus.CreatedAt,
  fus.UpdatedBy,
  fus.UpdatedAt
`;

const STATUS_OPTIONS = ["Reserved", "Negotiation", "Confirmed", "Released"];

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "UnitSelections"));

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
      SELECT TOP 1 Id
      FROM dbo.FollowupApplications
      WHERE Id = @ApplicantId AND IsDeleted = 0
    `);

  return result.recordset[0] ?? null;
}

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const areaSqFt = normalizeNumber(body?.AreaSqFt);
  const ratePerSqFt = normalizeNumber(body?.RatePerSqFt);
  const totalValue = normalizeNumber(body?.TotalValue);
  const bookingAmount = normalizeNumber(body?.BookingAmount);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId) ||
    Number.isNaN(areaSqFt) ||
    Number.isNaN(ratePerSqFt) ||
    Number.isNaN(totalValue) ||
    Number.isNaN(bookingAmount)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  const unitNo = normalizeText(body?.UnitNo);
  if (!applicantId) {
    return { error: "Applicant is required" };
  }
  if (!unitNo) {
    return { error: "Unit number is required" };
  }

  const status = normalizeText(body?.Status) || "Reserved";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  let computedTotalValue = totalValue;
  if (
    computedTotalValue === null &&
    areaSqFt !== null &&
    ratePerSqFt !== null
  ) {
    computedTotalValue = areaSqFt * ratePerSqFt;
  }

  return {
    ApplicantId: applicantId,
    ProjectId: projectId,
    CompanyId: companyId,
    UnitNo: unitNo,
    BlockName: normalizeText(body?.BlockName),
    FloorName: normalizeText(body?.FloorName),
    UnitType: normalizeText(body?.UnitType),
    AreaSqFt: areaSqFt,
    RatePerSqFt: ratePerSqFt,
    TotalValue: computedTotalValue,
    BookingAmount: bookingAmount,
    SelectionDate: normalizeText(body?.SelectionDate),
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildOptions() {
  const pool = getPool();
  const [applicantsResult, projectsResult, companiesResult] = await Promise.all(
    [
      // Applicants — FollowupApplications (ApplicantId FK references this table)
      pool.request().query(`
      SELECT
        Id,
        ApplicantNo,
        ApplicantName
      FROM dbo.FollowupApplications
      WHERE IsDeleted = 0
      ORDER BY ApplicantName
    `),
      // Projects — enterprise where business_type = 'P'
      pool.request().query(`
      SELECT
          p.id   AS Id,
          p.name AS Name,
          COALESCE(p.company_id, pc.PrimaryCompanyId) AS company_id,
          pc.CompanyIds AS company_ids
        FROM dbo.enterprise p
        OUTER APPLY (
          SELECT
            MIN(x.cid) AS PrimaryCompanyId,
            STRING_AGG(CAST(x.cid AS NVARCHAR(20)), ',')
              WITHIN GROUP (ORDER BY x.cid) AS CompanyIds
          FROM (
            SELECT p.company_id AS cid WHERE p.company_id IS NOT NULL
            UNION
            SELECT pc2.CompanyId FROM dbo.ProjectCompanies pc2 WHERE pc2.ProjectId = p.id
          ) x
        ) pc
        WHERE p.business_type = 'P'
        ORDER BY p.name
    `),
      // Companies — enterprise where business_type = 'C'
      pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'C' AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `),
    ],
  );

  return {
    applicants: applicantsResult.recordset,
    projects: projectsResult.recordset,
    companies: companiesResult.recordset,
    statusOptions: STATUS_OPTIONS,
  };
}

router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildOptions());
  } catch (err) {
    console.error("followupUnitSelections options error:", err);
    res.status(500).json({ error: "Failed to load unit selection options" });
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

    const filters = ["fus.IsDeleted = 0"];
    if (search) {
      filters.push(`
        (
          fus.SelectionNo LIKE @Search
          OR fa.ApplicantNo LIKE @Search
          OR fa.ApplicantName LIKE @Search
          OR fus.UnitNo LIKE @Search
          OR pm.name LIKE @Search
        )
      `);
    }
    if (status) filters.push("fus.Status = @Status");
    if (applicantId) filters.push("fus.ApplicantId = @ApplicantId");

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
      FROM dbo.FollowupUnitSelections fus
      INNER JOIN dbo.FollowupApplications fa ON fa.Id = fus.ApplicantId AND fa.IsDeleted = 0
      LEFT JOIN dbo.enterprise pm ON pm.id = fus.ProjectId AND pm.business_type = 'P'
      ${whereClause}
    `);

    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupUnitSelections fus
        INNER JOIN dbo.FollowupApplications fa ON fa.Id = fus.ApplicantId AND fa.IsDeleted = 0
        LEFT JOIN dbo.enterprise pm ON pm.id = fus.ProjectId AND pm.business_type = 'P'
        LEFT JOIN dbo.enterprise cm ON cm.id = fus.CompanyId AND cm.business_type = 'C'
        ${whereClause}
        ORDER BY fus.CreatedAt DESC, fus.Id DESC
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
    console.error("followupUnitSelections GET error:", err);
    res.status(500).json({ error: "Failed to fetch unit selections" });
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

    const pool = getPool();
    const projectId = payload.ProjectId || null;
    const companyId = payload.CompanyId || null;

    // INSERT with SelectionNo as a computed expression so we avoid a transaction.
    // MSSQL allows referencing INSERTED.Id inside the same statement via OUTPUT,
    // but not in VALUES. We insert NULL, then immediately UPDATE in a single
    // round-trip using the returned Id — same pattern used across other routes.
    const insertResult = await pool
      .request()
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("ProjectId", sql.Int, projectId)
      .input("CompanyId", sql.Int, companyId)
      .input("UnitNo", sql.NVarChar(100), payload.UnitNo)
      .input("BlockName", sql.NVarChar(100), payload.BlockName)
      .input("FloorName", sql.NVarChar(100), payload.FloorName)
      .input("UnitType", sql.NVarChar(100), payload.UnitType)
      .input("AreaSqFt", sql.Decimal(18, 2), payload.AreaSqFt)
      .input("RatePerSqFt", sql.Decimal(18, 2), payload.RatePerSqFt)
      .input("TotalValue", sql.Decimal(18, 2), payload.TotalValue)
      .input("BookingAmount", sql.Decimal(18, 2), payload.BookingAmount)
      .input("SelectionDate", sql.Date, payload.SelectionDate)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupUnitSelections (
          SelectionNo,
          ApplicantId,
          ProjectId,
          CompanyId,
          UnitNo,
          BlockName,
          FloorName,
          UnitType,
          AreaSqFt,
          RatePerSqFt,
          TotalValue,
          BookingAmount,
          SelectionDate,
          Status,
          Notes,
          CreatedBy,
          CreatedAt
        )
        VALUES (
          NULL,
          @ApplicantId,
          @ProjectId,
          @CompanyId,
          @UnitNo,
          @BlockName,
          @FloorName,
          @UnitType,
          @AreaSqFt,
          @RatePerSqFt,
          @TotalValue,
          @BookingAmount,
          @SelectionDate,
          @Status,
          @Notes,
          @CreatedBy,
          SYSDATETIME()
        );
        SELECT SCOPE_IDENTITY() AS Id;
      `);

    const id = insertResult.recordset[0]?.Id
      ? Number(insertResult.recordset[0].Id)
      : null;
    if (!id) throw new Error("INSERT did not return a record Id");

    const selectionNo = `SEL${String(id).padStart(6, "0")}`;

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("SelectionNo", sql.NVarChar(50), selectionNo).query(`
        UPDATE dbo.FollowupUnitSelections
        SET SelectionNo = @SelectionNo
        WHERE Id = @Id
      `);

    res
      .status(201)
      .json({ Id: id, SelectionNo: selectionNo, Status: payload.Status });
  } catch (err) {
    console.error("followupUnitSelections POST error:", err);
    res.status(500).json({ error: "Failed to create unit selection" });
  }
});

router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid unit selection id" });
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

    const existingResult = await getPool().request().input("Id", sql.Int, id)
      .query(`
        SELECT Id
        FROM dbo.FollowupUnitSelections
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!existingResult.recordset[0]) {
      return res.status(404).json({ error: "Unit selection not found" });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("ProjectId", sql.Int, payload.ProjectId || null)
      .input("CompanyId", sql.Int, payload.CompanyId || null)
      .input("UnitNo", sql.NVarChar(100), payload.UnitNo)
      .input("BlockName", sql.NVarChar(100), payload.BlockName)
      .input("FloorName", sql.NVarChar(100), payload.FloorName)
      .input("UnitType", sql.NVarChar(100), payload.UnitType)
      .input("AreaSqFt", sql.Decimal(18, 2), payload.AreaSqFt)
      .input("RatePerSqFt", sql.Decimal(18, 2), payload.RatePerSqFt)
      .input("TotalValue", sql.Decimal(18, 2), payload.TotalValue)
      .input("BookingAmount", sql.Decimal(18, 2), payload.BookingAmount)
      .input("SelectionDate", sql.Date, payload.SelectionDate)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupUnitSelections
        SET
          ApplicantId = @ApplicantId,
          ProjectId = @ProjectId,
          CompanyId = @CompanyId,
          UnitNo = @UnitNo,
          BlockName = @BlockName,
          FloorName = @FloorName,
          UnitType = @UnitType,
          AreaSqFt = @AreaSqFt,
          RatePerSqFt = @RatePerSqFt,
          TotalValue = @TotalValue,
          BookingAmount = @BookingAmount,
          SelectionDate = @SelectionDate,
          Status = @Status,
          Notes = @Notes,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupUnitSelections PUT error:", err);
    res.status(500).json({ error: "Failed to update unit selection" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid unit selection id" });
  }

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const dependencyResult = await getPool().request().input("Id", sql.Int, id)
      .query(`
        SELECT COUNT(*) AS Agreements
        FROM dbo.FollowupAgreements
        WHERE UnitSelectionId = @Id AND IsDeleted = 0
      `);

    if (Number(dependencyResult.recordset[0]?.Agreements ?? 0) > 0) {
      return res.status(400).json({
        error:
          "This unit selection is already linked to an agreement and cannot be deleted.",
      });
    }

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupUnitSelections
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupUnitSelections DELETE error:", err);
    res.status(500).json({ error: "Failed to delete unit selection" });
  }
});

module.exports = router;