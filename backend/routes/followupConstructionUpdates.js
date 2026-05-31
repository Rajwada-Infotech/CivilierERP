const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "ConstructionUpdates"));

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["Draft", "Sent", "Acknowledged", "Disputed"];
const STAGE_OPTIONS = [
  "Foundation",
  "Basement",
  "Slab",
  "Columns & Beams",
  "Brickwork",
  "Plastering",
  "Electrical & Plumbing",
  "Flooring",
  "Finishing",
  "Completion",
  "Other",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const applicantId = normalizeNumber(body?.ApplicantId);
  const unitSelectionId = normalizeNumber(body?.UnitSelectionId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);

  if (
    Number.isNaN(applicantId) ||
    Number.isNaN(unitSelectionId) ||
    Number.isNaN(projectId) ||
    Number.isNaN(companyId)
  ) {
    return { error: "Numeric fields must contain valid numbers" };
  }

  if (!applicantId) return { error: "Applicant is required" };

  const status = normalizeText(body?.Status) || "Draft";
  if (!STATUS_OPTIONS.includes(status)) {
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };
  }

  const stage = normalizeText(body?.Stage);
  if (stage && !STAGE_OPTIONS.includes(stage)) {
    return { error: `Stage must be one of: ${STAGE_OPTIONS.join(", ")}` };
  }

  const percentRaw = body?.PercentComplete;
  let percentComplete = null;
  if (percentRaw !== undefined && percentRaw !== null && percentRaw !== "") {
    percentComplete = parseInt(percentRaw, 10);
    if (
      !Number.isFinite(percentComplete) ||
      percentComplete < 0 ||
      percentComplete > 100
    ) {
      return { error: "PercentComplete must be 0–100" };
    }
  }

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    ProjectId: projectId,
    CompanyId: companyId,
    UpdateDate:
      normalizeText(body?.UpdateDate) || new Date().toISOString().slice(0, 10),
    Stage: stage,
    PercentComplete: percentComplete,
    Description: normalizeText(body?.Description),
    SharedWith: normalizeText(body?.SharedWith),
    SharedOn: normalizeText(body?.SharedOn),
    MediaLinks: normalizeText(body?.MediaLinks),
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

async function buildOptions() {
  const pool = getPool();
  const [applicantsR, unitSelectionsR, projectsR, companiesR] =
    await Promise.all([
      pool.request().query(`
        SELECT LHeadId AS Id, ISNULL(DisplayName, LHeadName) AS ApplicantName, LHeadCode AS ApplicantNo
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'A' AND LHeadStatus = 1
        ORDER BY ISNULL(DisplayName, LHeadName)
      `),
      pool.request().query(`
        SELECT fus.Id, fus.SelectionNo, fus.UnitNo, fus.ApplicantId, fus.ProjectId, fus.CompanyId
        FROM dbo.FollowupUnitSelections fus
        WHERE fus.IsDeleted = 0
        ORDER BY fus.CreatedAt DESC, fus.Id DESC
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
    projects: projectsR.recordset,
    companies: companiesR.recordset,
    statusOptions: STATUS_OPTIONS,
    stageOptions: STAGE_OPTIONS,
  };
}

const LIST_COLUMNS = `
  fcu.Id,
  fcu.UpdateNo,
  fcu.ApplicantId,
  ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
  ahm.LHeadCode                          AS ApplicantNo,
  fcu.UnitSelectionId,
  fus.SelectionNo,
  fus.UnitNo,
  fcu.ProjectId,
  ep.name   AS ProjectName,
  fcu.CompanyId,
  ec.name   AS CompanyName,
  CONVERT(VARCHAR(10), fcu.UpdateDate, 23)  AS UpdateDate,
  fcu.Stage,
  fcu.PercentComplete,
  fcu.Description,
  fcu.SharedWith,
  CONVERT(VARCHAR(10), fcu.SharedOn, 23)    AS SharedOn,
  fcu.MediaLinks,
  fcu.Status,
  fcu.Notes,
  fcu.CreatedBy,
  fcu.CreatedAt
`;

const BASE_JOINS = `
  FROM dbo.FollowupConstructionUpdates fcu
  INNER JOIN dbo.AccountHeadMaster ahm       ON ahm.LHeadId = fcu.ApplicantId AND ahm.LHeadType = 'A'
  LEFT JOIN  dbo.FollowupUnitSelections fus  ON fus.Id = fcu.UnitSelectionId
  LEFT JOIN  dbo.enterprise ep               ON ep.id  = fcu.ProjectId  AND ep.business_type = 'P'
  LEFT JOIN  dbo.enterprise ec               ON ec.id  = fcu.CompanyId  AND ec.business_type = 'C'
`;

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    res.json(await buildOptions());
  } catch (err) {
    console.error("followupConstructionUpdates options error:", err);
    res
      .status(500)
      .json({ error: "Failed to load Construction Update options" });
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
    const projectId = normalizeNumber(req.query.projectId);

    if (Number.isNaN(projectId))
      return res
        .status(400)
        .json({ error: "projectId must be a valid number" });

    const filters = ["fcu.IsDeleted = 0"];
    if (search) {
      filters.push(`(
        fcu.UpdateNo                               LIKE @Search
        OR ISNULL(ahm.DisplayName, ahm.LHeadName)  LIKE @Search
        OR ahm.LHeadCode                            LIKE @Search
        OR fus.UnitNo                               LIKE @Search
        OR ep.name                                  LIKE @Search
        OR fcu.Stage                                LIKE @Search
        OR fcu.Description                          LIKE @Search
      )`);
    }
    if (status) filters.push("fcu.Status = @Status");
    if (projectId) filters.push("fcu.ProjectId = @ProjectId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const buildRequest = () => {
      const r = pool.request();
      if (search) r.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) r.input("Status", sql.NVarChar(30), status);
      if (projectId) r.input("ProjectId", sql.Int, projectId);
      return r;
    };

    const [countResult, dataResult] = await Promise.all([
      buildRequest().query(
        `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`,
      ),
      buildRequest()
        .input("Offset", sql.Int, offset)
        .input("PageSize", sql.Int, pageSize).query(`
          SELECT ${LIST_COLUMNS}
          ${BASE_JOINS}
          ${whereClause}
          ORDER BY fcu.UpdateDate DESC, fcu.Id DESC
          OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
        `),
    ]);

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
    console.error("followupConstructionUpdates GET error:", err);
    res.status(500).json({ error: "Failed to fetch Construction Updates" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    // Verify applicant exists
    const applicantCheck = await getPool()
      .request()
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .query(
        `SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadId = @ApplicantId AND LHeadType = 'A' AND LHeadStatus = 1`,
      );
    if (!applicantCheck.recordset[0])
      return res
        .status(404)
        .json({ error: "Applicant not found in account master" });

    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("UpdateDate", sql.Date, payload.UpdateDate)
      .input("Stage", sql.NVarChar(100), payload.Stage)
      .input("PercentComplete", sql.TinyInt, payload.PercentComplete)
      .input("Description", sql.NVarChar(sql.MAX), payload.Description)
      .input("SharedWith", sql.NVarChar(500), payload.SharedWith)
      .input("SharedOn", sql.Date, payload.SharedOn)
      .input("MediaLinks", sql.NVarChar(sql.MAX), payload.MediaLinks)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupConstructionUpdates (
          UpdateNo, ApplicantId, UnitSelectionId, ProjectId, CompanyId,
          UpdateDate, Stage, PercentComplete, Description,
          SharedWith, SharedOn, MediaLinks,
          Status, Notes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          NULL, @ApplicantId, @UnitSelectionId, @ProjectId, @CompanyId,
          @UpdateDate, @Stage, @PercentComplete, @Description,
          @SharedWith, @SharedOn, @MediaLinks,
          @Status, @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const updateNo = `CU${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("UpdateNo", sql.NVarChar(50), updateNo)
      .query(
        `UPDATE dbo.FollowupConstructionUpdates SET UpdateNo = @UpdateNo WHERE Id = @Id`,
      );

    await transaction.commit();
    res
      .status(201)
      .json({ Id: id, UpdateNo: updateNo, Status: payload.Status });
  } catch (err) {
    console.error("followupConstructionUpdates POST error:", err);
    res.status(500).json({ error: "Failed to create Construction Update" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id)
    return res.status(400).json({ error: "Invalid Construction Update id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const existing = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .query(
        `SELECT Id FROM dbo.FollowupConstructionUpdates WHERE Id = @Id AND IsDeleted = 0`,
      );
    if (!existing.recordset[0])
      return res.status(404).json({ error: "Construction Update not found" });

    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("ApplicantId", sql.Int, payload.ApplicantId)
      .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
      .input("ProjectId", sql.Int, payload.ProjectId)
      .input("CompanyId", sql.Int, payload.CompanyId)
      .input("UpdateDate", sql.Date, payload.UpdateDate)
      .input("Stage", sql.NVarChar(100), payload.Stage)
      .input("PercentComplete", sql.TinyInt, payload.PercentComplete)
      .input("Description", sql.NVarChar(sql.MAX), payload.Description)
      .input("SharedWith", sql.NVarChar(500), payload.SharedWith)
      .input("SharedOn", sql.Date, payload.SharedOn)
      .input("MediaLinks", sql.NVarChar(sql.MAX), payload.MediaLinks)
      .input("Status", sql.NVarChar(30), payload.Status)
      .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupConstructionUpdates SET
          ApplicantId     = @ApplicantId,
          UnitSelectionId = @UnitSelectionId,
          ProjectId       = @ProjectId,
          CompanyId       = @CompanyId,
          UpdateDate      = @UpdateDate,
          Stage           = @Stage,
          PercentComplete = @PercentComplete,
          Description     = @Description,
          SharedWith      = @SharedWith,
          SharedOn        = @SharedOn,
          MediaLinks      = @MediaLinks,
          Status          = @Status,
          Notes           = @Notes,
          UpdatedBy       = @UpdatedBy,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("followupConstructionUpdates PUT error:", err);
    res.status(500).json({ error: "Failed to update Construction Update" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id)
    return res.status(400).json({ error: "Invalid Construction Update id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupConstructionUpdates
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("followupConstructionUpdates DELETE error:", err);
    res.status(500).json({ error: "Failed to delete Construction Update" });
  }
});

module.exports = router;


