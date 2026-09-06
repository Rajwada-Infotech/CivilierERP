const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");

router.use(authenticateToken);

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── GET /fa-item-codes — Fixed Asset Records available for a NEW manual
// assignment. An FA Item Code drops off this list the moment it is assigned
// through New Assignment and only comes back when that assignment is deleted
// or the asset is moved on by a User-Wise Asset Transfer. Transfer-sourced
// assignment rows (SourceTransferId IS NOT NULL) never block — a transferred
// asset is available to be manually (re)assigned again.
router.get("/fa-item-codes", requirePageRight("fixed-asset-assignment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        fa.AssetId, fa.FAItemCode, fa.AssetName, fa.AssetCategory,
        fa.CompanyId, co.name AS CompanyName,
        fa.ProjectId, pr.name AS ProjectName,
        fa.CustodianUserId, fa.Custodian AS CurrentCustodianName
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.enterprise co ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = fa.ProjectId
      WHERE fa.FAItemCode IS NOT NULL AND fa.AssetCode IS NOT NULL AND fa.Status <> 'Deleted'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.FixedAssetAssignment a
          WHERE a.AssetId = fa.AssetId
            AND a.Status <> 'Deleted'
            AND a.SourceTransferId IS NULL
            AND a.UserId = fa.CustodianUserId
        )
      ORDER BY fa.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetAssignment] GET /fa-item-codes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — assignment history ────────────────────────────────────────────────
router.get("/", requirePageRight("fixed-asset-assignment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = ["h.Status <> 'Deleted'"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("h.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("h.ProjectId = @ProjectId"); }
    if (req.query.assetId)   { request.input("AssetId",   sql.Int, parseInt(req.query.assetId, 10));   where.push("h.AssetId = @AssetId"); }
    if (req.query.userId)    { request.input("UserId",    sql.Int, parseInt(req.query.userId, 10));    where.push("h.UserId = @UserId"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        h.AssignmentId, h.DocNo, h.DocDate, h.FinYear, h.Remarks, h.CreatedAt, h.CreatedBy,
        h.CompanyId, co.name AS CompanyName,
        h.ProjectId, pr.name AS ProjectName,
        h.AssetId, fa.AssetName, fa.AssetCategory, fa.AssetCode, fa.FAItemCode,
        h.UserId, u.name AS UserName, u.avatar_url AS UserAvatar,
        h.ResponsibleUserId, ru.name AS ResponsibleUserName, ru.avatar_url AS ResponsibleUserAvatar,
        h.SourceTransferId, th.DocNo AS SourceTransferDocNo,
        CASE WHEN fa.CustodianUserId = h.UserId THEN 1 ELSE 0 END AS IsCurrent
      FROM dbo.FixedAssetAssignment h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users u ON u.id = h.UserId
      LEFT JOIN dbo.users ru ON ru.id = h.ResponsibleUserId
      LEFT JOIN dbo.AssetTransferHistory th ON th.Id = h.SourceTransferId
      ${whereClause}
      ORDER BY h.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetAssignment] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("fixed-asset-assignment", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("AssignmentId", sql.Int, id).query(`
      SELECT
        h.*, co.name AS CompanyName, pr.name AS ProjectName,
        fa.AssetName, fa.AssetCategory, fa.AssetCode, fa.FAItemCode,
        u.name AS UserName, u.avatar_url AS UserAvatar,
        ru.name AS ResponsibleUserName, ru.avatar_url AS ResponsibleUserAvatar,
        th.DocNo AS SourceTransferDocNo,
        CASE WHEN fa.CustodianUserId = h.UserId THEN 1 ELSE 0 END AS IsCurrent
      FROM dbo.FixedAssetAssignment h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users u ON u.id = h.UserId
      LEFT JOIN dbo.users ru ON ru.id = h.ResponsibleUserId
      LEFT JOIN dbo.AssetTransferHistory th ON th.Id = h.SourceTransferId
      WHERE h.AssignmentId = @AssignmentId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[fixedAssetAssignment] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create an assignment ─────────────────────────────────────────────
router.post("/", requirePageRight("fixed-asset-assignment", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;

  const { docDate, companyId, projectId, finYear, assetId, userId, responsibleUserId, userImage, remarks } = req.body;

  const assetIdVal = toInt(assetId);
  const userIdVal = toInt(userId);
  const responsibleUserIdVal = toInt(responsibleUserId);
  const companyIdVal = toInt(companyId);
  const projectIdVal = toInt(projectId);

  if (!assetIdVal) return res.status(400).json({ error: "FA Item Code (assetId) is required" });
  if (!userIdVal) return res.status(400).json({ error: "userId is required" });
  if (!responsibleUserIdVal) return res.status(400).json({ error: "responsibleUserId is required" });
  if (!companyIdVal) return res.status(400).json({ error: "companyId is required" });
  if (!projectIdVal) return res.status(400).json({ error: "projectId is required" });
  if (!docDate) return res.status(400).json({ error: "docDate is required" });
  if (!finYear) return res.status(400).json({ error: "finYear is required" });

  if (userImage != null && userImage !== "") {
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(userImage)) {
      return res.status(400).json({ error: "Invalid image data" });
    }
    if (userImage.length > 550_000) {
      return res.status(400).json({ error: "Image is too large (max ~400KB)" });
    }
  }

  try {
    const pool = getPool();

    const userCheck = await pool.request()
      .input("UserId", sql.Int, userIdVal)
      .input("RespId", sql.Int, responsibleUserIdVal)
      .query(`SELECT id, name FROM dbo.users WHERE id IN (@UserId, @RespId) AND ISNULL(discontinue, 0) = 0`);
    const user = userCheck.recordset.find((u) => u.id === userIdVal);
    if (!user) return res.status(400).json({ error: "Selected user is not a valid active account" });
    if (!userCheck.recordset.some((u) => u.id === responsibleUserIdVal)) {
      return res.status(400).json({ error: "Selected responsible user is not a valid active account" });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      // FA Item Code must belong to an existing, non-deleted Fixed Asset
      // Record — never a raw GRN/Import batch (those never carry a
      // FAItemCode of their own) and never a code someone typed by hand.
      const assetRes = await tx.request().input("AssetId", sql.Int, assetIdVal).query(`
        SELECT AssetId, AssetName, FAItemCode, Status
        FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
        WHERE AssetId = @AssetId
      `);
      const asset = assetRes.recordset[0];
      if (!asset || !asset.FAItemCode || asset.Status === "Deleted") {
        await tx.rollback();
        return res.status(400).json({ error: "This FA Item Code does not exist or is no longer a valid Fixed Asset Record" });
      }

      // One live manual assignment per FA Item Code — the same rule the
      // /fa-item-codes picker enforces, guarded here so a stale client or a
      // crafted request can't create a duplicate. Cleared by deleting the
      // existing assignment or by a User-Wise Asset Transfer.
      const dupe = await tx.request().input("AssetId", sql.Int, assetIdVal).query(`
        SELECT TOP 1 a.DocNo, u.name AS UserName
        FROM dbo.FixedAssetAssignment a
        JOIN dbo.FixedAssetRecord fa ON fa.AssetId = a.AssetId
        LEFT JOIN dbo.users u ON u.id = a.UserId
        WHERE a.AssetId = @AssetId
          AND a.Status <> 'Deleted'
          AND a.SourceTransferId IS NULL
          AND a.UserId = fa.CustodianUserId
      `);
      if (dupe.recordset[0]) {
        await tx.rollback();
        const d = dupe.recordset[0];
        return res.status(409).json({
          error: `${asset.FAItemCode} is already assigned to ${d.UserName || "a user"}${d.DocNo ? ` (${d.DocNo})` : ""}. Delete that assignment or transfer the asset before assigning it again.`,
        });
      }

      const docTypeId = await resolveDocTypeId(pool, sql, "FAA");
      const docNo = await lockNextDocNumber(pool, sql, {
        docTypeId, finYear, tableName: "FixedAssetAssignment", issuedBy: email,
      });

      const insert = await tx.request()
        .input("DocNo",     sql.NVarChar(100), docNo)
        .input("DocDate",   sql.Date,          docDate)
        .input("FinYear",   sql.NVarChar(20),  finYear)
        .input("CompanyId", sql.Int,           companyIdVal)
        .input("ProjectId", sql.Int,           projectIdVal)
        .input("AssetId",   sql.Int,           assetIdVal)
        .input("UserId",    sql.Int,           userIdVal)
        .input("ResponsibleUserId", sql.Int,   responsibleUserIdVal)
        .input("UserImage", sql.NVarChar(sql.MAX), userImage || null)
        .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
        .input("CreatedBy", sql.NVarChar(200), email)
        .query(`
          INSERT INTO dbo.FixedAssetAssignment
            (DocNo, DocDate, FinYear, CompanyId, ProjectId, AssetId, UserId, ResponsibleUserId, UserImage, Remarks, CreatedBy, CreatedAt)
          OUTPUT INSERTED.AssignmentId
          VALUES
            (@DocNo, @DocDate, @FinYear, @CompanyId, @ProjectId, @AssetId, @UserId, @ResponsibleUserId, @UserImage, @Remarks, @CreatedBy, SYSDATETIME())
        `);
      const assignmentId = insert.recordset[0].AssignmentId;

      // Keep the asset's own "current holder" columns in sync — the same
      // columns Asset Register/Detail/Transfer already read.
      await tx.request()
        .input("AssetId",    sql.Int, assetIdVal)
        .input("UserId",     sql.Int, userIdVal)
        .input("UserName",   sql.NVarChar(200), user.name)
        .input("CompanyId",  sql.Int, companyIdVal)
        .input("ProjectId",  sql.Int, projectIdVal)
        .input("UpdatedBy",  sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET CustodianUserId = @UserId, Custodian = @UserName,
              CompanyId = @CompanyId, ProjectId = @ProjectId,
              UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE AssetId = @AssetId
        `);

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "FixedAssetAssignment", assignmentId);
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ assignmentId, docNo });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetAssignment] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── re-sync an asset's "current holder" from the single most-recent custody
// event across BOTH subsystems — Fixed Asset Assignment rows and User-Wise
// Asset Transfer rows — so the two never fight over CustodianUserId. Used
// after an assignment edit/delete; the transfer route has its own
// recompute for its own writes. ─────────────────────────────────────────────
async function resyncCustodian(txReq, assetId, email) {
  await txReq
    .input("RS_AssetId",   sql.Int, assetId)
    .input("RS_UpdatedBy", sql.NVarChar(200), email)
    .query(`
      DECLARE @UserId INT, @CompanyId INT, @ProjectId INT, @UserName NVARCHAR(200);

      ;WITH events AS (
        SELECT h.UserId AS UserId, h.CompanyId AS CompanyId, h.ProjectId AS ProjectId,
               COALESCE(h.DocDate, CAST(h.CreatedAt AS DATE)) AS EventDate, h.CreatedAt AS CreatedAt,
               0 AS Pri
        FROM dbo.FixedAssetAssignment h
        WHERE h.AssetId = @RS_AssetId AND h.Status <> 'Deleted'
        UNION ALL
        SELECT t.ToUserId, t.CompanyId, t.ProjectId,
               COALESCE(t.TransferDate, CAST(t.CreatedAt AS DATE)), t.CreatedAt,
               1 AS Pri
        FROM dbo.AssetTransferHistory t
        WHERE t.AssetId = @RS_AssetId AND t.Status <> 'Deleted'
      )
      SELECT TOP 1
        @UserId = e.UserId, @CompanyId = e.CompanyId, @ProjectId = e.ProjectId,
        @UserName = u.name
      FROM events e
      LEFT JOIN dbo.users u ON u.id = e.UserId
      ORDER BY e.EventDate DESC, e.CreatedAt DESC, e.Pri DESC;

      UPDATE dbo.FixedAssetRecord
      SET CustodianUserId = @UserId,
          Custodian       = @UserName,
          CompanyId       = ISNULL(@CompanyId, CompanyId),
          ProjectId       = ISNULL(@ProjectId, ProjectId),
          UpdatedBy       = @RS_UpdatedBy,
          UpdatedAt       = SYSDATETIME()
      WHERE AssetId = @RS_AssetId;
    `);
}

// ── PUT /:id — edit an assignment (asset stays fixed) ─────────────────────────
router.put("/:id", requirePageRight("fixed-asset-assignment", "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const { docDate, finYear, userId, responsibleUserId, userImage, remarks } = req.body;
  const userIdVal = toInt(userId);
  const responsibleUserIdVal = toInt(responsibleUserId);
  if (!userIdVal) return res.status(400).json({ error: "userId is required" });
  if (!responsibleUserIdVal) return res.status(400).json({ error: "responsibleUserId is required" });
  if (!docDate) return res.status(400).json({ error: "docDate is required" });
  if (!finYear) return res.status(400).json({ error: "finYear is required" });

  const imageProvided = userImage !== undefined;
  if (imageProvided && userImage != null && userImage !== "") {
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(userImage)) {
      return res.status(400).json({ error: "Invalid image data" });
    }
    if (userImage.length > 550_000) {
      return res.status(400).json({ error: "Image is too large (max ~400KB)" });
    }
  }

  try {
    const pool = getPool();

    const existing = await pool.request().input("AssignmentId", sql.Int, id).query(`
      SELECT AssignmentId, AssetId, Status, SourceTransferId, UserId FROM dbo.FixedAssetAssignment WHERE AssignmentId = @AssignmentId
    `);
    const row = existing.recordset[0];
    if (!row || row.Status === "Deleted") return res.status(404).json({ error: "Not found" });

    // Auto-created from a transfer: the assigned user is owned by the transfer
    // document. Everything else (date, remarks, the user photo) stays editable.
    const effectiveUserId = row.SourceTransferId ? row.UserId : userIdVal;
    if (row.SourceTransferId && userIdVal !== row.UserId) {
      return res.status(400).json({ error: "This assignment's user comes from a User-Wise Asset Transfer and can't be changed here — edit the transfer instead." });
    }

    const userCheck = await pool.request()
      .input("UserId", sql.Int, effectiveUserId)
      .input("RespId", sql.Int, responsibleUserIdVal)
      .query(`SELECT id FROM dbo.users WHERE id IN (@UserId, @RespId) AND ISNULL(discontinue, 0) = 0`);
    if (!userCheck.recordset.some((u) => u.id === effectiveUserId)) return res.status(400).json({ error: "Selected user is not a valid active account" });
    if (!userCheck.recordset.some((u) => u.id === responsibleUserIdVal)) return res.status(400).json({ error: "Selected responsible user is not a valid active account" });

    const tx = pool.transaction();
    await tx.begin();
    try {
      const upd = tx.request()
        .input("AssignmentId",  sql.Int,           id)
        .input("DocDate",       sql.Date,          docDate)
        .input("FinYear",       sql.NVarChar(20),  finYear)
        .input("UserId",        sql.Int,           effectiveUserId)
        .input("ResponsibleUserId", sql.Int,       responsibleUserIdVal)
        .input("Remarks",       sql.NVarChar(sql.MAX), remarks || null)
        .input("UserImage",     sql.NVarChar(sql.MAX), imageProvided ? (userImage || null) : null)
        .input("ImageProvided", sql.Bit,           imageProvided ? 1 : 0)
        .input("UpdatedBy",     sql.NVarChar(200), email);
      await upd.query(`
        UPDATE dbo.FixedAssetAssignment SET
          DocDate   = @DocDate,
          FinYear   = @FinYear,
          UserId    = @UserId,
          ResponsibleUserId = @ResponsibleUserId,
          Remarks   = @Remarks,
          UserImage = CASE WHEN @ImageProvided = 1 THEN @UserImage ELSE UserImage END
        WHERE AssignmentId = @AssignmentId
      `);

      await resyncCustodian(tx.request(), row.AssetId, email);

      await tx.commit();
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetAssignment] PUT /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /:id — soft-delete an assignment ──────────────────────────────────
router.delete("/:id", requirePageRight("fixed-asset-assignment", "delete"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const existing = await pool.request().input("AssignmentId", sql.Int, id).query(`
      SELECT AssignmentId, AssetId, Status, SourceTransferId FROM dbo.FixedAssetAssignment WHERE AssignmentId = @AssignmentId
    `);
    const row = existing.recordset[0];
    if (!row || row.Status === "Deleted") return res.status(404).json({ error: "Not found" });
    if (row.SourceTransferId) {
      return res.status(400).json({ error: "This assignment was created by a User-Wise Asset Transfer — delete that transfer instead to roll it back." });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input("AssignmentId", sql.Int, id)
        .query(`UPDATE dbo.FixedAssetAssignment SET Status = 'Deleted' WHERE AssignmentId = @AssignmentId`);

      await resyncCustodian(tx.request(), row.AssetId, email);

      await tx.commit();
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetAssignment] DELETE /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
