const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { runFollowupReminderCheck } = require("../services/fixedAssetFollowupReminders");

router.use(authenticateToken);

const PAGE = "fixed-asset-quality-check";
const QUALITY = ["Good", "Average", "Defective", "Repairing"];
const FU_STATUS = ["Pending", "Completed", "Cancelled"];

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const IMG_RE = /^data:image\/(jpeg|jpg|png|webp);base64,/;

// ── latest, non-deleted Assignment for an asset (the "current owner") ────────
async function latestAssignment(pool, assetId) {
  const r = await pool.request().input("AssetId", sql.Int, assetId).query(`
    SELECT TOP 1 h.AssignmentId, h.UserId, h.UserImage, u.name AS UserName, u.avatar_url AS UserAvatar,
           h.ResponsibleUserId, ru.name AS ResponsibleUserName, ru.avatar_url AS ResponsibleUserAvatar
    FROM dbo.FixedAssetAssignment h
    LEFT JOIN dbo.users u ON u.id = h.UserId
    LEFT JOIN dbo.users ru ON ru.id = h.ResponsibleUserId
    WHERE h.AssetId = @AssetId AND h.Status <> 'Deleted'
    ORDER BY h.DocDate DESC, h.CreatedAt DESC, h.AssignmentId DESC
  `);
  return r.recordset[0] || null;
}

// ── GET /assets — FA-Item-Code assets for the picker ────────────────────────
router.get("/assets", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["fa.Status <> 'Deleted'", "fa.FAItemCode IS NOT NULL", "fa.AssetCode IS NOT NULL"];
    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    const result = await request.query(`
      SELECT fa.AssetId, fa.FAItemCode, fa.AssetName, fa.AssetCategory,
             fa.CompanyId, fa.ProjectId, fa.FinYear
      FROM dbo.FixedAssetRecord fa
      WHERE ${where.join(" AND ")}
      ORDER BY fa.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faQualityCheck] GET /assets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /asset-context/:assetId — auto-fetch on FA Item Code select ─────────
// FA Item Code -> Item Name + Current User + User Photo + Item Picture,
// always from the latest Assignment record.
router.get("/asset-context/:assetId", requirePageRight(PAGE, "view"), async (req, res) => {
  const assetId = toInt(req.params.assetId);
  if (!assetId) return res.status(400).json({ error: "Invalid assetId" });
  try {
    const pool = getPool();
    const faRes = await pool.request().input("AssetId", sql.Int, assetId).query(`
      SELECT fa.AssetId, fa.FAItemCode, fa.AssetName, fa.CompanyId, fa.ProjectId, fa.FinYear,
             fa.PictureBase64, fa.CustodianUserId, cu.name AS CustodianName, cu.avatar_url AS CustodianAvatar
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.users cu ON cu.id = fa.CustodianUserId
      WHERE fa.AssetId = @AssetId AND fa.Status <> 'Deleted' AND fa.AssetCode IS NOT NULL
    `);
    const fa = faRes.recordset[0];
    if (!fa) return res.status(404).json({ error: "Fixed Asset Record not found" });

    const asn = await latestAssignment(pool, assetId);

    // "Previous / latest image" to show before a new capture = the most
    // recent Quality Check record's own image for this FA Item Code, falling
    // back to the asset-level picture only when no check has an image yet.
    const lastImg = await pool.request().input("AssetId", sql.Int, assetId).query(`
      SELECT TOP 1 q.ItemPicture, q.DocNo, q.DocDate
      FROM dbo.FixedAssetQualityCheck q
      WHERE q.AssetId = @AssetId AND q.Status <> 'Deleted' AND q.ItemPicture IS NOT NULL
      ORDER BY q.DocDate DESC, q.CreatedAt DESC, q.QualityCheckId DESC
    `);
    const prev = lastImg.recordset[0];

    res.json({
      assetId:      fa.AssetId,
      faItemCode:   fa.FAItemCode,
      itemName:     fa.AssetName,
      companyId:    fa.CompanyId,
      projectId:    fa.ProjectId,
      finYear:      fa.FinYear,
      itemPicture:  prev?.ItemPicture ?? fa.PictureBase64 ?? null,
      itemPictureFromDocNo: prev?.DocNo ?? null,
      itemPictureFromDate:  prev?.DocDate ?? null,
      currentUserId:     asn?.UserId ?? fa.CustodianUserId ?? null,
      currentUserName:   asn?.UserName ?? fa.CustodianName ?? null,
      currentUserAvatar: asn?.UserAvatar ?? fa.CustodianAvatar ?? null,
      userPhoto:        asn?.UserImage || null,
      hasAssignment:    !!asn,
      assignmentId:     asn?.AssignmentId ?? null,
      responsibleUserId:     asn?.ResponsibleUserId ?? null,
      responsibleUserName:   asn?.ResponsibleUserName ?? null,
      responsibleUserAvatar: asn?.ResponsibleUserAvatar ?? null,
    });
  } catch (err) {
    console.error("[faQualityCheck] GET /asset-context:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const LIST_SELECT = `
  SELECT
    q.QualityCheckId, q.DocNo, q.DocDate, q.CompanyId, q.ProjectId,
    q.AssetId, q.FAItemCode, q.ItemName,
    q.CurrentUserId, cu.name AS CurrentUserName, cu.avatar_url AS CurrentUserAvatar, q.UserPhoto,
    q.QualityStatus, q.Remarks,
    q.NextFollowUpDate, q.FollowUpType, q.FollowUpRemarks,
    q.ResponsibleUserId, ru.name AS ResponsibleUserName, ru.avatar_url AS ResponsibleUserAvatar,
    q.FollowUpStatus, q.LastFollowUpDate, q.NextActionNotes,
    q.CompletedBy, q.CompletedAt, q.Status, q.CreatedBy, q.CreatedAt, q.UpdatedBy, q.UpdatedAt,
    co.name AS CompanyName, pr.name AS ProjectName,
    fa.AssetCode,
    q.ItemPicture,                       -- this record's own captured image (never the latest)
    CASE WHEN q.FollowUpStatus = 'Pending' AND q.NextFollowUpDate < CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END AS IsOverdue
  FROM dbo.FixedAssetQualityCheck q
  LEFT JOIN dbo.users cu ON cu.id = q.CurrentUserId
  LEFT JOIN dbo.users ru ON ru.id = q.ResponsibleUserId
  LEFT JOIN dbo.enterprise co ON co.id = q.CompanyId
  LEFT JOIN dbo.enterprise pr ON pr.id = q.ProjectId
  LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = q.AssetId
`;

// ── GET / — list ───────────────────────────────────────────────────────────
router.get("/", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["q.Status <> 'Deleted'"];
    if (req.query.companyId)     { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("q.CompanyId = @CompanyId"); }
    if (req.query.projectId)     { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("q.ProjectId = @ProjectId"); }
    if (req.query.assetId)       { request.input("AssetId", sql.Int, parseInt(req.query.assetId, 10)); where.push("q.AssetId = @AssetId"); }
    if (req.query.followUpStatus){ request.input("FUS", sql.NVarChar(20), req.query.followUpStatus); where.push("q.FollowUpStatus = @FUS"); }
    if (req.query.overdue === "1") where.push("q.FollowUpStatus = 'Pending' AND q.NextFollowUpDate < CAST(SYSDATETIME() AS DATE)");
    const result = await request.query(`${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY q.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faQualityCheck] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`${LIST_SELECT} WHERE q.QualityCheckId = @Id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[faQualityCheck] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function validateBody(b) {
  if (!toInt(b.assetId)) return "FA Item Code (assetId) is required";
  if (!QUALITY.includes(b.qualityStatus)) return "Quality Status must be Good, Average, Defective or Repairing";
  if (!b.nextFollowUpDate) return "Next Follow-Up Date is required";
  if (b.followUpStatus && !FU_STATUS.includes(b.followUpStatus)) return "Invalid Follow-Up Status";
  return null;
}

// ── POST / — create a quality check + follow-up ────────────────────────────
router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const err0 = validateBody(req.body);
  if (err0) return res.status(400).json({ error: err0 });

  const {
    docDate, companyId, projectId, assetId, qualityStatus, remarks, itemPicture,
    nextFollowUpDate, followUpType, followUpRemarks,
    followUpStatus, lastFollowUpDate, nextActionNotes,
  } = req.body;
  const assetIdVal = toInt(assetId);

  if (itemPicture != null && itemPicture !== "") {
    if (!IMG_RE.test(itemPicture)) return res.status(400).json({ error: "Unsupported image — use JPG, JPEG, PNG or WEBP" });
    if (itemPicture.length > 6_000_000) return res.status(400).json({ error: "Image is too large (max ~4 MB)" });
  }

  try {
    const pool = getPool();
    const faRes = await pool.request().input("AssetId", sql.Int, assetIdVal).query(`
      SELECT AssetId, FAItemCode, AssetName, CompanyId, ProjectId, FinYear
      FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId AND Status <> 'Deleted' AND AssetCode IS NOT NULL
    `);
    const fa = faRes.recordset[0];
    if (!fa) return res.status(400).json({ error: "This FA Item Code is not a valid Fixed Asset Record" });

    const asn = await latestAssignment(pool, assetIdVal);
    const docTypeId = await resolveDocTypeId(pool, sql, "FAQ");
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId, finYear: fa.FinYear || null, tableName: "FixedAssetQualityCheck", issuedBy: email,
    });

    const ins = await pool.request()
      .input("DocNo",            sql.NVarChar(100), docNo)
      .input("DocDate",          sql.Date, docDate || null)
      .input("CompanyId",        sql.Int, toInt(companyId) || fa.CompanyId || null)
      .input("ProjectId",        sql.Int, toInt(projectId) || fa.ProjectId || null)
      .input("AssetId",          sql.Int, assetIdVal)
      .input("FAItemCode",       sql.NVarChar(200), fa.FAItemCode)
      .input("ItemName",         sql.NVarChar(200), fa.AssetName)
      .input("CurrentUserId",    sql.Int, asn?.UserId ?? null)
      .input("UserPhoto",        sql.NVarChar(sql.MAX), asn?.UserImage || null)
      .input("QualityStatus",    sql.NVarChar(20), qualityStatus)
      .input("Remarks",          sql.NVarChar(sql.MAX), remarks || null)
      .input("ItemPicture",      sql.NVarChar(sql.MAX), itemPicture || null)
      .input("NextFollowUpDate", sql.Date, nextFollowUpDate)
      .input("FollowUpType",     sql.NVarChar(50), followUpType || null)
      .input("FollowUpRemarks",  sql.NVarChar(sql.MAX), followUpRemarks || null)
      // Responsible User is NOT accepted from the client — it always comes
      // from the FA Item Code's latest/current Assignment record.
      .input("ResponsibleUserId",sql.Int, asn?.ResponsibleUserId ?? null)
      .input("FollowUpStatus",   sql.NVarChar(20), FU_STATUS.includes(followUpStatus) ? followUpStatus : "Pending")
      .input("LastFollowUpDate", sql.Date, lastFollowUpDate || null)
      .input("NextActionNotes",  sql.NVarChar(sql.MAX), nextActionNotes || null)
      .input("CreatedBy",        sql.NVarChar(200), email)
      .query(`
        INSERT INTO dbo.FixedAssetQualityCheck
          (DocNo, DocDate, CompanyId, ProjectId, AssetId, FAItemCode, ItemName,
           CurrentUserId, UserPhoto, QualityStatus, Remarks, ItemPicture,
           NextFollowUpDate, FollowUpType, FollowUpRemarks, ResponsibleUserId,
           FollowUpStatus, LastFollowUpDate, NextActionNotes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.QualityCheckId
        VALUES
          (@DocNo, @DocDate, @CompanyId, @ProjectId, @AssetId, @FAItemCode, @ItemName,
           @CurrentUserId, @UserPhoto, @QualityStatus, @Remarks, @ItemPicture,
           @NextFollowUpDate, @FollowUpType, @FollowUpRemarks, @ResponsibleUserId,
           @FollowUpStatus, @LastFollowUpDate, @NextActionNotes, @CreatedBy, SYSDATETIME())
      `);
    const newId = ins.recordset[0].QualityCheckId;
    await backPatchRecordId(pool, sql, docNo, "FixedAssetQualityCheck", newId);
    await bumpCacheVersion("fixed-asset-quality-check");
    res.json({ qualityCheckId: newId, docNo });
  } catch (err) {
    console.error("[faQualityCheck] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id — edit ───────────────────────────────────────────────────────
router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const err0 = validateBody({ ...req.body, assetId: req.body.assetId || 1 });
  if (err0 && !err0.startsWith("FA Item Code")) return res.status(400).json({ error: err0 });

  const {
    docDate, qualityStatus, remarks, itemPicture,
    nextFollowUpDate, followUpType, followUpRemarks,
    followUpStatus, lastFollowUpDate, nextActionNotes,
  } = req.body;

  const pictureProvided = itemPicture !== undefined;
  if (pictureProvided && itemPicture != null && itemPicture !== "") {
    if (!IMG_RE.test(itemPicture)) return res.status(400).json({ error: "Unsupported image — use JPG, JPEG, PNG or WEBP" });
    if (itemPicture.length > 6_000_000) return res.status(400).json({ error: "Image is too large (max ~4 MB)" });
  }

  try {
    const pool = getPool();
    const cur = await pool.request().input("Id", sql.Int, id).query(
      `SELECT QualityCheckId, FollowUpStatus, AssetId FROM dbo.FixedAssetQualityCheck WHERE QualityCheckId = @Id AND Status <> 'Deleted'`,
    );
    if (!cur.recordset.length) return res.status(404).json({ error: "Not found" });

    // Re-derive Responsible User from the asset's current Assignment — the
    // field is not client-editable, and a transfer since the last save may
    // have changed who's responsible.
    const asn = await latestAssignment(pool, cur.recordset[0].AssetId);

    const nextFUStatus = FU_STATUS.includes(followUpStatus) ? followUpStatus : cur.recordset[0].FollowUpStatus;
    const completing = nextFUStatus !== "Pending" && cur.recordset[0].FollowUpStatus === "Pending";

    await pool.request()
      .input("Id",               sql.Int, id)
      .input("DocDate",          sql.Date, docDate || null)
      .input("QualityStatus",    sql.NVarChar(20), qualityStatus)
      .input("Remarks",          sql.NVarChar(sql.MAX), remarks || null)
      .input("ItemPicture",      sql.NVarChar(sql.MAX), pictureProvided ? (itemPicture || null) : null)
      .input("PictureProvided",  sql.Bit, pictureProvided ? 1 : 0)
      .input("NextFollowUpDate", sql.Date, nextFollowUpDate)
      .input("FollowUpType",     sql.NVarChar(50), followUpType || null)
      .input("FollowUpRemarks",  sql.NVarChar(sql.MAX), followUpRemarks || null)
      .input("ResponsibleUserId",sql.Int, asn?.ResponsibleUserId ?? null)
      .input("FollowUpStatus",   sql.NVarChar(20), nextFUStatus)
      .input("LastFollowUpDate", sql.Date, lastFollowUpDate || null)
      .input("NextActionNotes",  sql.NVarChar(sql.MAX), nextActionNotes || null)
      .input("CompletedBy",      sql.NVarChar(200), completing ? email : null)
      .input("Completing",       sql.Bit, completing ? 1 : 0)
      .input("UpdatedBy",        sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetQualityCheck SET
          DocDate = @DocDate, QualityStatus = @QualityStatus, Remarks = @Remarks,
          ItemPicture = CASE WHEN @PictureProvided = 1 THEN @ItemPicture ELSE ItemPicture END,
          NextFollowUpDate = @NextFollowUpDate, FollowUpType = @FollowUpType,
          FollowUpRemarks = @FollowUpRemarks, ResponsibleUserId = @ResponsibleUserId,
          FollowUpStatus = @FollowUpStatus, LastFollowUpDate = @LastFollowUpDate,
          NextActionNotes = @NextActionNotes,
          CompletedBy = CASE WHEN @Completing = 1 THEN @CompletedBy ELSE CompletedBy END,
          CompletedAt = CASE WHEN @Completing = 1 THEN SYSDATETIME() ELSE CompletedAt END,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE QualityCheckId = @Id
      `);
    await bumpCacheVersion("fixed-asset-quality-check");
    res.json({ ok: true });
  } catch (err) {
    console.error("[faQualityCheck] PUT /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /:id/follow-up-status — quick Complete / Cancel from the list ─────
router.patch("/:id/follow-up-status", requirePageRight(PAGE, "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const { status } = req.body;
  if (!FU_STATUS.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id)
      .input("Status", sql.NVarChar(20), status)
      .input("By", sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetQualityCheck SET
          FollowUpStatus = @Status,
          LastFollowUpDate = CASE WHEN @Status = 'Completed' THEN CAST(SYSDATETIME() AS DATE) ELSE LastFollowUpDate END,
          CompletedBy = CASE WHEN @Status <> 'Pending' THEN @By ELSE NULL END,
          CompletedAt = CASE WHEN @Status <> 'Pending' THEN SYSDATETIME() ELSE NULL END,
          UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE QualityCheckId = @Id AND Status <> 'Deleted'
      `);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Not found" });
    await bumpCacheVersion("fixed-asset-quality-check");
    res.json({ ok: true });
  } catch (err) {
    console.error("[faQualityCheck] PATCH follow-up-status:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /:id — soft delete ─────────────────────────────────────────────
router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id).input("By", sql.NVarChar(200), email)
      .query(`UPDATE dbo.FixedAssetQualityCheck SET Status = 'Deleted', UpdatedBy = @By, UpdatedAt = SYSDATETIME()
              WHERE QualityCheckId = @Id AND Status <> 'Deleted'`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Not found" });
    await bumpCacheVersion("fixed-asset-quality-check");
    res.json({ ok: true });
  } catch (err) {
    console.error("[faQualityCheck] DELETE /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// User Photo is strictly read-only on the Owner & Quality Checking page — it
// is shown from the latest Assignment record and can only be changed on the
// Assignment page itself. No user-photo write endpoint here by design.

// Item Picture is stored per Quality Check record (FixedAssetQualityCheck
// .ItemPicture), captured at create/edit time — never a single overwritable
// field on the FA Item Code. Every record keeps its own image permanently.

// ── POST /run-reminders — manual trigger (admin/testing) ──────────────────
router.post("/run-reminders", requirePageRight(PAGE, "edit"), async (_req, res) => {
  try {
    const summary = await runFollowupReminderCheck();
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[faQualityCheck] POST /run-reminders:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
