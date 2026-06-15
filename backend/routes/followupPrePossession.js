const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

router.use(checkPermissionForMethod("Followup", "PrePossession"));

const STATUS_OPTIONS = ["Pending", "In Progress", "Cleared", "Failed"];

const CLEARANCE_BIT_FIELDS = [
  "StructuralClearance", "ElectricalClearance", "PlumbingClearance",
  "PaintingClearance", "FlooringClearance", "FireClearance",
  "OccupancyCertIssued", "SnagListCleared"
];

function requireUserName(req, res) {
  const userName = req.user?.name || req.user?.email || null;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return null; }
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
function normalizeBit(v) {
  return (v === true || v === 1 || v === "1" || v === "true") ? 1 : 0;
}

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  if (!applicantId) return { error: "Applicant is required" };

  const status = normalizeText(body?.Status) || "Pending";
  if (!STATUS_OPTIONS.includes(status))
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };

  return {
    ApplicantId:         applicantId,
    UnitSelectionId:     normalizeNumber(body?.UnitSelectionId),
    HandoverId:          normalizeNumber(body?.HandoverId),
    ProjectId:           normalizeNumber(body?.ProjectId),
    CompanyId:           normalizeNumber(body?.CompanyId),
    StructuralClearance: normalizeBit(body?.StructuralClearance),
    ElectricalClearance: normalizeBit(body?.ElectricalClearance),
    PlumbingClearance:   normalizeBit(body?.PlumbingClearance),
    PaintingClearance:   normalizeBit(body?.PaintingClearance),
    FlooringClearance:   normalizeBit(body?.FlooringClearance),
    FireClearance:       normalizeBit(body?.FireClearance),
    OccupancyCertIssued: normalizeBit(body?.OccupancyCertIssued),
    SnagListCleared:     normalizeBit(body?.SnagListCleared),
    ClearanceDate:       normalizeDate(body?.ClearanceDate),
    InspectedBy:         normalizeText(body?.InspectedBy),
    Status:              status,
    Notes:               normalizeText(body?.Notes),
  };
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    const pool = getPool();
    const [applicantsR, unitSelectionsR, handoversR, projectsR, companiesR] =
      await Promise.all([
        pool.request().query(`
          SELECT LHeadId AS Id, ISNULL(DisplayName, LHeadName) AS ApplicantName, LHeadCode AS ApplicantNo
          FROM dbo.AccountHeadMaster WHERE LHeadType = 'A' AND LHeadStatus = 1
          ORDER BY ISNULL(DisplayName, LHeadName)
        `),
        pool.request().query(`
          SELECT Id, SelectionNo, UnitNo, ApplicantId
          FROM dbo.FollowupUnitSelections WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
        pool.request().query(`
          SELECT Id, HandoverNo, ApplicantId
          FROM dbo.FollowupHandovers WHERE IsDeleted = 0
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
      applicants:     applicantsR.recordset,
      unitSelections: unitSelectionsR.recordset,
      handovers:      handoversR.recordset,
      projects:       projectsR.recordset,
      companies:      companiesR.recordset,
      statusOptions:  STATUS_OPTIONS,
      clearanceFields: CLEARANCE_BIT_FIELDS,
    });
  } catch (err) {
    console.error("prePosspossession options error:", err);
    res.status(500).json({ error: "Failed to load options" });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const search = normalizeText(req.query.search);
    const status = normalizeText(req.query.status);
    const applicantId = normalizeNumber(req.query.applicantId);

    if (Number.isNaN(applicantId))
      return res.status(400).json({ error: "applicantId must be a valid number" });

    const filters = ["pp.IsDeleted = 0"];
    if (search) filters.push(`(pp.ClearanceNo LIKE @Search OR ISNULL(ahm.DisplayName, ahm.LHeadName) LIKE @Search OR ahm.LHeadCode LIKE @Search)`);
    if (status) filters.push("pp.Status = @Status");
    if (applicantId) filters.push("pp.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupPrePossession pp
      INNER JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = pp.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = pp.UnitSelectionId
      LEFT JOIN dbo.FollowupHandovers fho      ON fho.Id = pp.HandoverId
      LEFT JOIN dbo.enterprise ep ON ep.id = pp.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.enterprise ec ON ec.id = pp.CompanyId AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const r = pool.request();
      if (search) r.input("Search", sql.NVarChar(255), `%${search}%`);
      if (status) r.input("Status", sql.NVarChar(30), status);
      if (applicantId) r.input("ApplicantId", sql.Int, applicantId);
      return r;
    };

    const countResult = await buildRequest().query(
      `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`
    );
    const dataResult = await buildRequest()
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT
          pp.Id, pp.ClearanceNo, pp.ApplicantId,
          ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
          ahm.LHeadCode AS ApplicantNo,
          pp.UnitSelectionId, fus.UnitNo, fus.SelectionNo,
          pp.HandoverId, fho.HandoverNo,
          pp.ProjectId, ep.name AS ProjectName,
          pp.CompanyId, ec.name AS CompanyName,
          pp.StructuralClearance, pp.ElectricalClearance, pp.PlumbingClearance,
          pp.PaintingClearance,   pp.FlooringClearance,   pp.FireClearance,
          pp.OccupancyCertIssued, pp.SnagListCleared,
          CONVERT(VARCHAR(10), pp.ClearanceDate, 23) AS ClearanceDate,
          pp.InspectedBy, pp.Status, pp.Notes,
          pp.CreatedBy, pp.CreatedAt
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY pp.CreatedAt DESC, pp.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);
    res.json({
      data: dataResult.recordset,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("prePossession GET error:", err);
    res.status(500).json({ error: "Failed to fetch Pre-Possession records" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const transaction = new sql.Transaction(getPool());
    await transaction.begin();

    const insertResult = await new sql.Request(transaction)
      .input("ApplicantId",        sql.Int,          payload.ApplicantId)
      .input("UnitSelectionId",    sql.Int,          payload.UnitSelectionId)
      .input("HandoverId",         sql.Int,          payload.HandoverId)
      .input("ProjectId",          sql.Int,          payload.ProjectId)
      .input("CompanyId",          sql.Int,          payload.CompanyId)
      .input("StructuralClearance",sql.Bit,          payload.StructuralClearance)
      .input("ElectricalClearance",sql.Bit,          payload.ElectricalClearance)
      .input("PlumbingClearance",  sql.Bit,          payload.PlumbingClearance)
      .input("PaintingClearance",  sql.Bit,          payload.PaintingClearance)
      .input("FlooringClearance",  sql.Bit,          payload.FlooringClearance)
      .input("FireClearance",      sql.Bit,          payload.FireClearance)
      .input("OccupancyCertIssued",sql.Bit,          payload.OccupancyCertIssued)
      .input("SnagListCleared",    sql.Bit,          payload.SnagListCleared)
      .input("ClearanceDate",      sql.Date,         payload.ClearanceDate)
      .input("InspectedBy",        sql.NVarChar(200), payload.InspectedBy)
      .input("Status",             sql.NVarChar(30),  payload.Status)
      .input("Notes",              sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy",          sql.NVarChar(100), userName)
      .query(`
        INSERT INTO dbo.FollowupPrePossession (
          ApplicantId, UnitSelectionId, HandoverId, ProjectId, CompanyId,
          StructuralClearance, ElectricalClearance, PlumbingClearance,
          PaintingClearance, FlooringClearance, FireClearance,
          OccupancyCertIssued, SnagListCleared,
          ClearanceDate, InspectedBy, Status, Notes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @ApplicantId, @UnitSelectionId, @HandoverId, @ProjectId, @CompanyId,
          @StructuralClearance, @ElectricalClearance, @PlumbingClearance,
          @PaintingClearance, @FlooringClearance, @FireClearance,
          @OccupancyCertIssued, @SnagListCleared,
          @ClearanceDate, @InspectedBy, @Status, @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const clearanceNo = `PPC${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id", sql.Int, id)
      .input("ClearanceNo", sql.NVarChar(50), clearanceNo)
      .query(`UPDATE dbo.FollowupPrePossession SET ClearanceNo = @ClearanceNo WHERE Id = @Id`);

    await transaction.commit();
    res.status(201).json({ Id: id, ClearanceNo: clearanceNo, Status: payload.Status });
  } catch (err) {
    console.error("prePossession POST error:", err);
    res.status(500).json({ error: "Failed to create Pre-Possession record" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const payload = getPayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });

  try {
    const existing = await getPool().request()
      .input("Id", sql.Int, id)
      .query(`SELECT Id FROM dbo.FollowupPrePossession WHERE Id = @Id AND IsDeleted = 0`);
    if (!existing.recordset[0])
      return res.status(404).json({ error: "Record not found" });

    await getPool().request()
      .input("Id",                 sql.Int,          id)
      .input("ApplicantId",        sql.Int,          payload.ApplicantId)
      .input("UnitSelectionId",    sql.Int,          payload.UnitSelectionId)
      .input("HandoverId",         sql.Int,          payload.HandoverId)
      .input("ProjectId",          sql.Int,          payload.ProjectId)
      .input("CompanyId",          sql.Int,          payload.CompanyId)
      .input("StructuralClearance",sql.Bit,          payload.StructuralClearance)
      .input("ElectricalClearance",sql.Bit,          payload.ElectricalClearance)
      .input("PlumbingClearance",  sql.Bit,          payload.PlumbingClearance)
      .input("PaintingClearance",  sql.Bit,          payload.PaintingClearance)
      .input("FlooringClearance",  sql.Bit,          payload.FlooringClearance)
      .input("FireClearance",      sql.Bit,          payload.FireClearance)
      .input("OccupancyCertIssued",sql.Bit,          payload.OccupancyCertIssued)
      .input("SnagListCleared",    sql.Bit,          payload.SnagListCleared)
      .input("ClearanceDate",      sql.Date,         payload.ClearanceDate)
      .input("InspectedBy",        sql.NVarChar(200), payload.InspectedBy)
      .input("Status",             sql.NVarChar(30),  payload.Status)
      .input("Notes",              sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy",          sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupPrePossession SET
          ApplicantId         = @ApplicantId,
          UnitSelectionId     = @UnitSelectionId,
          HandoverId          = @HandoverId,
          ProjectId           = @ProjectId,
          CompanyId           = @CompanyId,
          StructuralClearance = @StructuralClearance,
          ElectricalClearance = @ElectricalClearance,
          PlumbingClearance   = @PlumbingClearance,
          PaintingClearance   = @PaintingClearance,
          FlooringClearance   = @FlooringClearance,
          FireClearance       = @FireClearance,
          OccupancyCertIssued = @OccupancyCertIssued,
          SnagListCleared     = @SnagListCleared,
          ClearanceDate       = @ClearanceDate,
          InspectedBy         = @InspectedBy,
          Status              = @Status,
          Notes               = @Notes,
          UpdatedBy           = @UpdatedBy,
          UpdatedAt           = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("prePossession PUT error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    await getPool().request()
      .input("Id",        sql.Int,          id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupPrePossession
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("prePossession DELETE error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

module.exports = router;