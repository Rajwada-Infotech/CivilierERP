const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

router.use(authMiddleware);
router.use(checkPermissionForMethod("Followup", "PossessionNotice"));

const NOTICE_TYPE_OPTIONS = ["30-day", "60-day", "Final"];
const STATUS_OPTIONS      = ["Sent", "Acknowledged", "Overdue", "Cancelled"];
const SENT_VIA_OPTIONS    = ["Email", "WhatsApp", "Courier", "Hand Delivery"];

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

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  if (!applicantId) return { error: "Applicant is required" };

  const noticeType = normalizeText(body?.NoticeType) || "30-day";
  if (!NOTICE_TYPE_OPTIONS.includes(noticeType))
    return { error: `NoticeType must be one of: ${NOTICE_TYPE_OPTIONS.join(", ")}` };

  const status = normalizeText(body?.Status) || "Sent";
  if (!STATUS_OPTIONS.includes(status))
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };

  return {
    ApplicantId:       applicantId,
    UnitSelectionId:   normalizeNumber(body?.UnitSelectionId),
    HandoverId:        normalizeNumber(body?.HandoverId),
    PrePossessionId:   normalizeNumber(body?.PrePossessionId),
    ProjectId:         normalizeNumber(body?.ProjectId),
    CompanyId:         normalizeNumber(body?.CompanyId),
    NoticeDate:        normalizeDate(body?.NoticeDate),
    NoticeType:        noticeType,
    ScheduledPossDate: normalizeDate(body?.ScheduledPossDate),
    ActualPossDate:    normalizeDate(body?.ActualPossDate),
    SentVia:           normalizeText(body?.SentVia),
    AcknowledgedDate:  normalizeDate(body?.AcknowledgedDate),
    AcknowledgedBy:    normalizeText(body?.AcknowledgedBy),
    Status:            status,
    Notes:             normalizeText(body?.Notes),
  };
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    const pool = getPool();
    const [applicantsR, unitSelectionsR, handoversR, prePossessionsR, projectsR, companiesR] =
      await Promise.all([
        pool.request().query(`
          SELECT Id, ApplicantNo, ApplicantName, ProjectId, CompanyId
          FROM dbo.FollowupApplications WHERE IsDeleted = 0
          ORDER BY ApplicantName
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
          SELECT Id, ClearanceNo, ApplicantId
          FROM dbo.FollowupPrePossession WHERE IsDeleted = 0
          ORDER BY CreatedAt DESC
        `),
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
        pool.request().query(`
          SELECT id AS Id, name AS Name FROM dbo.enterprise
          WHERE business_type = 'C' AND ISNULL(discontinue,0) = 0 ORDER BY name
        `),
      ]);
    res.json({
      applicants:      applicantsR.recordset,
      unitSelections:  unitSelectionsR.recordset,
      handovers:       handoversR.recordset,
      prePossessions:  prePossessionsR.recordset,
      projects:        projectsR.recordset,
      companies:       companiesR.recordset,
      noticeTypeOptions: NOTICE_TYPE_OPTIONS,
      statusOptions:     STATUS_OPTIONS,
      sentViaOptions:    SENT_VIA_OPTIONS,
    });
  } catch (err) {
    console.error("possessionNotice options error:", err);
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
    const noticeType = normalizeText(req.query.noticeType);
    const applicantId = normalizeNumber(req.query.applicantId);

    if (Number.isNaN(applicantId))
      return res.status(400).json({ error: "applicantId must be a valid number" });

    const filters = ["pn.IsDeleted = 0"];
    if (search) filters.push(`(pn.NoticeNo LIKE @Search OR COALESCE(fa.ApplicantName, ISNULL(ahm.DisplayName, ahm.LHeadName)) LIKE @Search OR COALESCE(fa.ApplicantNo, ahm.LHeadCode) LIKE @Search)`);
    if (status) filters.push("pn.Status = @Status");
    if (noticeType) filters.push("pn.NoticeType = @NoticeType");
    if (applicantId) filters.push("pn.ApplicantId = @ApplicantId");

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const pool = getPool();

    const BASE_JOINS = `
      FROM dbo.FollowupPossessionNotices pn
      LEFT JOIN dbo.AccountHeadMaster ahm    ON ahm.LHeadId = pn.ApplicantId AND ahm.LHeadType = 'A'
      LEFT JOIN dbo.FollowupApplications fa  ON fa.Id = pn.ApplicantId AND fa.IsDeleted = 0 AND ahm.LHeadId IS NULL
      LEFT JOIN dbo.FollowupUnitSelections fus ON fus.Id = pn.UnitSelectionId
      LEFT JOIN dbo.FollowupHandovers fho      ON fho.Id = pn.HandoverId
      LEFT JOIN dbo.FollowupPrePossession fpp  ON fpp.Id = pn.PrePossessionId
      LEFT JOIN dbo.enterprise ep ON ep.id = pn.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.enterprise ec ON ec.id = pn.CompanyId AND ec.business_type = 'C'
    `;

    const buildRequest = () => {
      const r = pool.request();
      if (search)     r.input("Search",     sql.NVarChar(255), `%${search}%`);
      if (status)     r.input("Status",     sql.NVarChar(30),  status);
      if (noticeType) r.input("NoticeType", sql.NVarChar(20),  noticeType);
      if (applicantId) r.input("ApplicantId", sql.Int,         applicantId);
      return r;
    };

    const countResult = await buildRequest().query(
      `SELECT COUNT(*) AS Total ${BASE_JOINS} ${whereClause}`
    );
    const dataResult = await buildRequest()
      .input("Offset",   sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
        SELECT
          pn.Id, pn.NoticeNo, pn.ApplicantId,
          COALESCE(fa.ApplicantName, ISNULL(ahm.DisplayName, ahm.LHeadName)) AS ApplicantName,
          COALESCE(fa.ApplicantNo,   ahm.LHeadCode)                         AS ApplicantNo,
          pn.UnitSelectionId, fus.UnitNo, fus.SelectionNo,
          pn.HandoverId,      fho.HandoverNo,
          pn.PrePossessionId, fpp.ClearanceNo,
          pn.ProjectId, ep.name AS ProjectName,
          pn.CompanyId, ec.name AS CompanyName,
          CONVERT(VARCHAR(10), pn.NoticeDate,        23) AS NoticeDate,
          pn.NoticeType,
          CONVERT(VARCHAR(10), pn.ScheduledPossDate, 23) AS ScheduledPossDate,
          CONVERT(VARCHAR(10), pn.ActualPossDate,    23) AS ActualPossDate,
          pn.SentVia,
          CONVERT(VARCHAR(10), pn.AcknowledgedDate,  23) AS AcknowledgedDate,
          pn.AcknowledgedBy,
          pn.Status, pn.Notes,
          DATEDIFF(day, CAST(SYSDATETIME() AS DATE), pn.ScheduledPossDate) AS DaysRemaining,
          pn.CreatedBy, pn.CreatedAt
        ${BASE_JOINS}
        ${whereClause}
        ORDER BY pn.ScheduledPossDate ASC, pn.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);
    res.json({
      data: dataResult.recordset,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("possessionNotice GET error:", err);
    res.status(500).json({ error: "Failed to fetch Possession Notices" });
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
      .input("ApplicantId",      sql.Int,          payload.ApplicantId)
      .input("UnitSelectionId",  sql.Int,          payload.UnitSelectionId)
      .input("HandoverId",       sql.Int,          payload.HandoverId)
      .input("PrePossessionId",  sql.Int,          payload.PrePossessionId)
      .input("ProjectId",        sql.Int,          payload.ProjectId)
      .input("CompanyId",        sql.Int,          payload.CompanyId)
      .input("NoticeDate",       sql.Date,         payload.NoticeDate)
      .input("NoticeType",       sql.NVarChar(20),  payload.NoticeType)
      .input("ScheduledPossDate",sql.Date,         payload.ScheduledPossDate)
      .input("ActualPossDate",   sql.Date,         payload.ActualPossDate)
      .input("SentVia",          sql.NVarChar(100), payload.SentVia)
      .input("AcknowledgedDate", sql.Date,         payload.AcknowledgedDate)
      .input("AcknowledgedBy",   sql.NVarChar(200), payload.AcknowledgedBy)
      .input("Status",           sql.NVarChar(30),  payload.Status)
      .input("Notes",            sql.NVarChar(sql.MAX), payload.Notes)
      .input("CreatedBy",        sql.NVarChar(100), userName)
      .query(`
        INSERT INTO dbo.FollowupPossessionNotices (
          ApplicantId, UnitSelectionId, HandoverId, PrePossessionId, ProjectId, CompanyId,
          NoticeDate, NoticeType, ScheduledPossDate, ActualPossDate,
          SentVia, AcknowledgedDate, AcknowledgedBy,
          Status, Notes, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @ApplicantId, @UnitSelectionId, @HandoverId, @PrePossessionId, @ProjectId, @CompanyId,
          @NoticeDate, @NoticeType, @ScheduledPossDate, @ActualPossDate,
          @SentVia, @AcknowledgedDate, @AcknowledgedBy,
          @Status, @Notes, @CreatedBy, SYSDATETIME()
        )
      `);

    const id = insertResult.recordset[0]?.Id;
    const noticeNo = `PN${String(id).padStart(6, "0")}`;

    await new sql.Request(transaction)
      .input("Id",       sql.Int,         id)
      .input("NoticeNo", sql.NVarChar(50), noticeNo)
      .query(`UPDATE dbo.FollowupPossessionNotices SET NoticeNo = @NoticeNo WHERE Id = @Id`);

    await transaction.commit();
    res.status(201).json({ Id: id, NoticeNo: noticeNo, Status: payload.Status });
  } catch (err) {
    console.error("possessionNotice POST error:", err);
    res.status(500).json({ error: "Failed to create Possession Notice" });
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
      .query(`SELECT Id FROM dbo.FollowupPossessionNotices WHERE Id = @Id AND IsDeleted = 0`);
    if (!existing.recordset[0])
      return res.status(404).json({ error: "Possession Notice not found" });

    await getPool().request()
      .input("Id",               sql.Int,          id)
      .input("ApplicantId",      sql.Int,          payload.ApplicantId)
      .input("UnitSelectionId",  sql.Int,          payload.UnitSelectionId)
      .input("HandoverId",       sql.Int,          payload.HandoverId)
      .input("PrePossessionId",  sql.Int,          payload.PrePossessionId)
      .input("ProjectId",        sql.Int,          payload.ProjectId)
      .input("CompanyId",        sql.Int,          payload.CompanyId)
      .input("NoticeDate",       sql.Date,         payload.NoticeDate)
      .input("NoticeType",       sql.NVarChar(20),  payload.NoticeType)
      .input("ScheduledPossDate",sql.Date,         payload.ScheduledPossDate)
      .input("ActualPossDate",   sql.Date,         payload.ActualPossDate)
      .input("SentVia",          sql.NVarChar(100), payload.SentVia)
      .input("AcknowledgedDate", sql.Date,         payload.AcknowledgedDate)
      .input("AcknowledgedBy",   sql.NVarChar(200), payload.AcknowledgedBy)
      .input("Status",           sql.NVarChar(30),  payload.Status)
      .input("Notes",            sql.NVarChar(sql.MAX), payload.Notes)
      .input("UpdatedBy",        sql.NVarChar(100), userName)
      .query(`
        UPDATE dbo.FollowupPossessionNotices SET
          ApplicantId       = @ApplicantId,
          UnitSelectionId   = @UnitSelectionId,
          HandoverId        = @HandoverId,
          PrePossessionId   = @PrePossessionId,
          ProjectId         = @ProjectId,
          CompanyId         = @CompanyId,
          NoticeDate        = @NoticeDate,
          NoticeType        = @NoticeType,
          ScheduledPossDate = @ScheduledPossDate,
          ActualPossDate    = @ActualPossDate,
          SentVia           = @SentVia,
          AcknowledgedDate  = @AcknowledgedDate,
          AcknowledgedBy    = @AcknowledgedBy,
          Status            = @Status,
          Notes             = @Notes,
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("possessionNotice PUT error:", err);
    res.status(500).json({ error: "Failed to update Possession Notice" });
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
        UPDATE dbo.FollowupPossessionNotices
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("possessionNotice DELETE error:", err);
    res.status(500).json({ error: "Failed to delete Possession Notice" });
  }
});

module.exports = router;