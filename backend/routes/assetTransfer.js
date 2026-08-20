const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

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

// ── GET /users — active users for the From/To pickers ────────────────────────
router.get("/users", requirePageRight("asset-transfer", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[assetTransfer] GET /users:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /eligible-assets — assets currently held by fromUserId in a project ──
router.get("/eligible-assets", requirePageRight("asset-transfer", "view"), async (req, res) => {
  const fromUserId = toInt(req.query.fromUserId);
  const projectId = toInt(req.query.projectId);
  if (!fromUserId || !projectId) return res.json([]);
  try {
    const pool = getPool();
    const request = pool.request()
      .input("FromUserId", sql.Int, fromUserId)
      .input("ProjectId", sql.Int, projectId);
    let where = ["fa.CustodianUserId = @FromUserId", "fa.ProjectId = @ProjectId", "fa.AssetStatus = 'Active'", "fa.Status <> 'Deleted'"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.finYear)   { request.input("FinYear", sql.NVarChar(20), req.query.finYear);          where.push("fa.FinYear = @FinYear"); }

    const result = await request.query(`
      SELECT fa.AssetId, fa.AssetName, fa.AssetCode, fa.AssetCategory,
             fa.CompanyId, fa.ProjectId, fa.FinYear
      FROM dbo.FixedAssetRecord fa
      WHERE ${where.join(" AND ")}
      ORDER BY fa.AssetName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[assetTransfer] GET /eligible-assets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list transfer history ─────────────────────────────────────────────
router.get("/", requirePageRight("asset-transfer", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = [];

    if (req.query.companyId)  { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10));  where.push("h.CompanyId = @CompanyId"); }
    if (req.query.projectId)  { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10));  where.push("h.ProjectId = @ProjectId"); }
    if (req.query.finYear)    { request.input("FinYear", sql.NVarChar(20), req.query.finYear);           where.push("h.FinYear = @FinYear"); }
    if (req.query.assetId)    { request.input("AssetId", sql.Int, parseInt(req.query.assetId, 10));      where.push("h.AssetId = @AssetId"); }
    if (req.query.fromUserId) { request.input("FromUserId", sql.Int, parseInt(req.query.fromUserId, 10)); where.push("h.FromUserId = @FromUserId"); }
    if (req.query.toUserId)   { request.input("ToUserId", sql.Int, parseInt(req.query.toUserId, 10));     where.push("h.ToUserId = @ToUserId"); }
    if (req.query.fromDate)   { request.input("FromDate", sql.Date, req.query.fromDate);                 where.push("h.TransferDate >= @FromDate"); }
    if (req.query.toDate)     { request.input("ToDate", sql.Date, req.query.toDate);                     where.push("h.TransferDate <= @ToDate"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        h.Id, h.DocNo, h.DocDate, h.TransferDate, h.FinYear, h.Remarks, h.CreatedAt,
        h.CompanyId, co.name AS CompanyName,
        h.ProjectId, pr.name AS ProjectName,
        h.AssetId, fa.AssetName, fa.AssetCode, fa.AssetCategory,
        h.FromUserId, fu.name AS FromUserName,
        h.ToUserId, tu.name AS ToUserName,
        h.TransferredBy, bu.name AS TransferredByName
      FROM dbo.AssetTransferHistory h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      LEFT JOIN dbo.users bu ON bu.id = h.TransferredBy
      ${whereClause}
      ORDER BY h.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[assetTransfer] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single transfer detail ─────────────────────────────────────────
router.get("/:id", requirePageRight("asset-transfer", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`
      SELECT
        h.*,
        co.name AS CompanyName, pr.name AS ProjectName,
        fa.AssetName, fa.AssetCode, fa.AssetCategory,
        fu.name AS FromUserName, tu.name AS ToUserName, bu.name AS TransferredByName
      FROM dbo.AssetTransferHistory h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      LEFT JOIN dbo.users bu ON bu.id = h.TransferredBy
      WHERE h.Id = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[assetTransfer] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create a transfer ────────────────────────────────────────────────
router.post("/", requirePageRight("asset-transfer", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;

  const {
    docDate, transferDate, companyId, projectId, finYear,
    assetId, fromUserId, toUserId, remarks,
  } = req.body;

  const assetIdVal = toInt(assetId);
  const projectIdVal = toInt(projectId);
  const fromUserIdVal = toInt(fromUserId);
  const toUserIdVal = toInt(toUserId);

  if (!assetIdVal) return res.status(400).json({ error: "assetId is required" });
  if (!projectIdVal) return res.status(400).json({ error: "projectId is required" });
  if (!fromUserIdVal || !toUserIdVal) return res.status(400).json({ error: "fromUserId and toUserId are required" });
  if (fromUserIdVal === toUserIdVal) return res.status(400).json({ error: "From User and To User must be different" });

  try {
    const pool = getPool();

    const userCheck = await pool.request()
      .input("FromUserId", sql.Int, fromUserIdVal)
      .input("ToUserId", sql.Int, toUserIdVal)
      .query(`
        SELECT id, name FROM dbo.users
        WHERE id IN (@FromUserId, @ToUserId) AND ISNULL(discontinue, 0) = 0
      `);
    if (userCheck.recordset.length !== 2) {
      return res.status(400).json({ error: "Both From User and To User must be active accounts" });
    }
    const toUserName = userCheck.recordset.find((u) => u.id === toUserIdVal)?.name || null;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const assetRes = await tx.request()
        .input("AssetId", sql.Int, assetIdVal)
        .query(`
          SELECT AssetId, AssetName, CustodianUserId, ProjectId, AssetStatus
          FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
          WHERE AssetId = @AssetId
        `);
      const asset = assetRes.recordset[0];
      if (!asset) { await tx.rollback(); return res.status(404).json({ error: "Asset not found" }); }
      if (asset.CustodianUserId !== fromUserIdVal) {
        await tx.rollback();
        return res.status(400).json({ error: `"${asset.AssetName}" is not currently assigned to the selected From User — refresh and try again` });
      }
      if (asset.ProjectId !== projectIdVal) {
        await tx.rollback();
        return res.status(400).json({ error: `"${asset.AssetName}" does not belong to the selected project` });
      }
      if (asset.AssetStatus !== "Active") {
        await tx.rollback();
        return res.status(400).json({ error: `"${asset.AssetName}" is ${asset.AssetStatus} and can't be transferred` });
      }

      const docTypeId = await resolveDocTypeId(pool, sql, "AST");
      const docNo = await lockNextDocNumber(pool, sql, {
        docTypeId, finYear, tableName: "AssetTransferHistory", issuedBy: email,
      });

      const updateRes = await tx.request()
        .input("AssetId", sql.Int, assetIdVal)
        .input("FromUserId", sql.Int, fromUserIdVal)
        .input("ToUserId", sql.Int, toUserIdVal)
        .input("ToUserName", sql.NVarChar(200), toUserName)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET CustodianUserId = @ToUserId, Custodian = @ToUserName,
              UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE AssetId = @AssetId AND CustodianUserId = @FromUserId
        `);
      if (updateRes.rowsAffected[0] === 0) {
        throw new Error(`"${asset.AssetName}" was reassigned by someone else — refresh and try again`);
      }

      const transferredBy = req.user?.userId ?? req.user?.id ?? null;
      const insert = await tx.request()
        .input("DocNo", sql.NVarChar(100), docNo)
        .input("DocDate", sql.Date, docDate || null)
        .input("TransferDate", sql.Date, transferDate || docDate || null)
        .input("CompanyId", sql.Int, companyId ? parseInt(companyId, 10) : null)
        .input("ProjectId", sql.Int, projectIdVal)
        .input("FinYear", sql.NVarChar(20), finYear || null)
        .input("AssetId", sql.Int, assetIdVal)
        .input("FromUserId", sql.Int, fromUserIdVal)
        .input("ToUserId", sql.Int, toUserIdVal)
        .input("TransferredBy", sql.Int, transferredBy ? parseInt(transferredBy, 10) : null)
        .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
        .query(`
          INSERT INTO dbo.AssetTransferHistory
            (DocNo, DocDate, TransferDate, CompanyId, ProjectId, FinYear, AssetId, FromUserId, ToUserId, TransferredBy, Remarks, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES
            (@DocNo, @DocDate, @TransferDate, @CompanyId, @ProjectId, @FinYear, @AssetId, @FromUserId, @ToUserId, @TransferredBy, @Remarks, SYSDATETIME())
        `);
      const newId = insert.recordset[0].Id;

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "AssetTransferHistory", newId);
      await bumpCacheVersion("asset-transfer");
      await bumpCacheVersion("fixed-assets");
      res.json({ id: newId, docNo });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[assetTransfer] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id — edit remarks/transfer date only (ownership is immutable) ──────
router.put("/:id", requirePageRight("asset-transfer", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const { transferDate, remarks } = req.body;
    await pool.request()
      .input("Id", sql.Int, id)
      .input("TransferDate", sql.Date, transferDate || null)
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .query(`
        UPDATE dbo.AssetTransferHistory SET
          TransferDate = ISNULL(@TransferDate, TransferDate),
          Remarks = @Remarks
        WHERE Id = @Id
      `);
    await bumpCacheVersion("asset-transfer");
    res.json({ ok: true });
  } catch (err) {
    console.error("[assetTransfer] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
