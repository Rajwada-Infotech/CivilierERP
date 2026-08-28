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

// ── GET /fa-item-codes — every real Fixed Asset Record eligible for
// assignment (not scoped to "currently unassigned" — an asset can be
// re-assigned to a new user any number of times, each one a new history row) ─
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
    let where = [];

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
        CASE WHEN fa.CustodianUserId = h.UserId THEN 1 ELSE 0 END AS IsCurrent
      FROM dbo.FixedAssetAssignment h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users u ON u.id = h.UserId
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
        u.name AS UserName, u.avatar_url AS UserAvatar
      FROM dbo.FixedAssetAssignment h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users u ON u.id = h.UserId
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

  const { docDate, companyId, projectId, finYear, assetId, userId, userImage, remarks } = req.body;

  const assetIdVal = toInt(assetId);
  const userIdVal = toInt(userId);
  const companyIdVal = toInt(companyId);
  const projectIdVal = toInt(projectId);

  if (!assetIdVal) return res.status(400).json({ error: "FA Item Code (assetId) is required" });
  if (!userIdVal) return res.status(400).json({ error: "userId is required" });
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

    const userCheck = await pool.request().input("UserId", sql.Int, userIdVal).query(`
      SELECT id, name FROM dbo.users WHERE id = @UserId AND ISNULL(discontinue, 0) = 0
    `);
    const user = userCheck.recordset[0];
    if (!user) return res.status(400).json({ error: "Selected user is not a valid active account" });

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
        .input("UserImage", sql.NVarChar(sql.MAX), userImage || null)
        .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
        .input("CreatedBy", sql.NVarChar(200), email)
        .query(`
          INSERT INTO dbo.FixedAssetAssignment
            (DocNo, DocDate, FinYear, CompanyId, ProjectId, AssetId, UserId, UserImage, Remarks, CreatedBy, CreatedAt)
          OUTPUT INSERTED.AssignmentId
          VALUES
            (@DocNo, @DocDate, @FinYear, @CompanyId, @ProjectId, @AssetId, @UserId, @UserImage, @Remarks, @CreatedBy, SYSDATETIME())
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

module.exports = router;
