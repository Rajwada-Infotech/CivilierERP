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

// Sets FixedAssetRecord.CustodianUserId/Custodian for an asset, from an
// already-known ToUserId (no lookup query needed for the id itself).
async function applyCustodian(tx, assetId, custodianUserId) {
  const userRes = await tx.request()
    .input("Id", sql.Int, custodianUserId)
    .query(`SELECT name FROM dbo.users WHERE id = @Id`);
  const custodianName = userRes.recordset[0]?.name || null;
  await tx.request()
    .input("AssetId", sql.Int, assetId)
    .input("CustodianUserId", sql.Int, custodianUserId)
    .input("CustodianName", sql.NVarChar(200), custodianName)
    .query(`
      UPDATE dbo.FixedAssetRecord
      SET CustodianUserId = @CustodianUserId, Custodian = @CustodianName, UpdatedAt = SYSDATETIME()
      WHERE AssetId = @AssetId
    `);
}

// Recomputes an asset's current custodian purely from its (non-deleted)
// transfer history — the ToUserId of the most recent remaining row wins.
// Used by both PUT (asset reassigned away/into, or same-asset edit) and
// DELETE, so "undo a transfer" and "redo a transfer" are the same operation:
// re-derive the answer from whatever history is left, rather than trying to
// track and reverse individual deltas.
//
// Returns the resolved custodian id, or null if no history rows are left
// for this asset at all — callers fall back to whatever "before this
// transfer" value they have on hand (the edited/deleted row's FromUserId).
async function recomputeCustodianForAsset(tx, assetId) {
  const latest = await tx.request()
    .input("AssetId", sql.Int, assetId)
    .query(`
      SELECT TOP 1 ToUserId
      FROM dbo.AssetTransferHistory
      WHERE AssetId = @AssetId AND Status <> 'Deleted'
      ORDER BY TransferDate DESC, CreatedAt DESC, Id DESC
    `);
  if (!latest.recordset.length) return null;
  const custodianUserId = latest.recordset[0].ToUserId;
  await applyCustodian(tx, assetId, custodianUserId);
  return custodianUserId;
}

// ── Asset Transfer → Assignment integration ─────────────────────────────────
// Every successful transfer keeps exactly one live Fixed Asset Assignment row
// linked back to it (SourceTransferId), for the receiving user. "Current" vs
// "Old" is still derived from FixedAssetRecord.CustodianUserId elsewhere, so
// these helpers only maintain the row + its link, never a status flag.
async function upsertAssignmentForTransfer(tx, pool, opts) {
  const {
    transferId, assetId, toUserId, companyId, projectId, finYear,
    departmentId, transferDate, email,
  } = opts;

  const existing = await tx.request()
    .input("TransferId", sql.Int, transferId)
    .query(`
      SELECT AssignmentId FROM dbo.FixedAssetAssignment
      WHERE SourceTransferId = @TransferId AND Status <> 'Deleted'
    `);

  if (existing.recordset.length) {
    await tx.request()
      .input("AssignmentId", sql.Int, existing.recordset[0].AssignmentId)
      .input("AssetId",      sql.Int, assetId)
      .input("UserId",       sql.Int, toUserId)
      .input("CompanyId",    sql.Int, companyId || null)
      .input("ProjectId",    sql.Int, projectId || null)
      .input("FinYear",      sql.NVarChar(20), finYear || null)
      .input("DepartmentId", sql.Int, departmentId || null)
      .input("DocDate",      sql.Date, transferDate || null)
      .query(`
        UPDATE dbo.FixedAssetAssignment SET
          AssetId = @AssetId, UserId = @UserId,
          CompanyId = @CompanyId, ProjectId = @ProjectId, FinYear = @FinYear,
          DepartmentId = @DepartmentId, DocDate = @DocDate
        WHERE AssignmentId = @AssignmentId
      `);
    return null;
  }

  const docTypeId = await resolveDocTypeId(pool, sql, "FAA");
  const docNo = await lockNextDocNumber(pool, sql, {
    docTypeId, finYear: finYear || null, tableName: "FixedAssetAssignment", issuedBy: email,
  });
  const ins = await tx.request()
    .input("DocNo",            sql.NVarChar(100), docNo)
    .input("DocDate",          sql.Date, transferDate || null)
    .input("FinYear",          sql.NVarChar(20), finYear || null)
    .input("CompanyId",        sql.Int, companyId || null)
    .input("ProjectId",        sql.Int, projectId || null)
    .input("AssetId",          sql.Int, assetId)
    .input("UserId",           sql.Int, toUserId)
    .input("DepartmentId",     sql.Int, departmentId || null)
    .input("SourceTransferId", sql.Int, transferId)
    .input("Remarks",          sql.NVarChar(sql.MAX), "Auto-created from User-Wise Asset Transfer")
    .input("CreatedBy",        sql.NVarChar(200), email)
    .query(`
      INSERT INTO dbo.FixedAssetAssignment
        (DocNo, DocDate, FinYear, CompanyId, ProjectId, AssetId, UserId, DepartmentId,
         SourceTransferId, UserImage, Remarks, CreatedBy, CreatedAt)
      OUTPUT INSERTED.AssignmentId
      VALUES
        (@DocNo, @DocDate, @FinYear, @CompanyId, @ProjectId, @AssetId, @UserId, @DepartmentId,
         @SourceTransferId, NULL, @Remarks, @CreatedBy, SYSDATETIME())
    `);
  return { assignmentId: ins.recordset[0].AssignmentId, docNo };
}

async function softDeleteAssignmentForTransfer(tx, transferId) {
  await tx.request()
    .input("TransferId", sql.Int, transferId)
    .query(`
      UPDATE dbo.FixedAssetAssignment
      SET Status = 'Deleted'
      WHERE SourceTransferId = @TransferId AND Status <> 'Deleted'
    `);
}

// ── GET /users — active users for the From/To pickers ────────────────────────
router.get("/users", requirePageRight("asset-transfer", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.name, u.avatar_url, u.DepartmentId, d.DepartmentName
      FROM dbo.users u
      LEFT JOIN dbo.DepartmentMaster d ON d.Id = u.DepartmentId
      WHERE ISNULL(u.discontinue, 0) = 0
      ORDER BY u.name
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

// ── GET /transferable-assets — active assets with their current holder ───────
// Unlike /eligible-assets, this isn't scoped to a From User — the caller
// picks the asset first and the current custodian (From User) is derived
// from it, always reflecting the latest successful transfer.
router.get("/transferable-assets", requirePageRight("asset-transfer", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    // Scoped to individually FA-Item-Code-tagged assets only — a transfer
    // needs a unique per-unit identifier to select against, and a record
    // without a code (e.g. a legacy/manual entry) has nothing unambiguous
    // to pick here.
    let where = ["fa.AssetStatus = 'Active'", "fa.Status <> 'Deleted'", "fa.CustodianUserId IS NOT NULL", "fa.FAItemCode IS NOT NULL"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    if (req.query.finYear)   { request.input("FinYear", sql.NVarChar(20), req.query.finYear);          where.push("fa.FinYear = @FinYear"); }

    const result = await request.query(`
      SELECT fa.AssetId, fa.AssetName, fa.AssetCode, fa.AssetCategory, fa.FAItemCode,
             fa.CompanyId, fa.ProjectId, fa.FinYear, fa.PictureBase64,
             fa.CustodianUserId, fa.Custodian AS CustodianName, cu.avatar_url AS CustodianAvatar
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.users cu ON cu.id = fa.CustodianUserId
      WHERE ${where.join(" AND ")}
      ORDER BY fa.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[assetTransfer] GET /transferable-assets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /asset-picture/:assetId — set/replace/remove the Item Picture on the
// Fixed Asset Record itself (asset-specific, shared with Assignment / Asset
// Register / Detail). Lets the transfer form fill in a missing photo without
// needing the fixed-asset-record edit right. ────────────────────────────────
router.put("/asset-picture/:assetId", requirePageRight("asset-transfer", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const assetId = toInt(req.params.assetId);
  if (!assetId) return res.status(400).json({ error: "Invalid assetId" });

  const { pictureBase64 } = req.body;
  const clearing = pictureBase64 == null || pictureBase64 === "";
  if (!clearing) {
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(pictureBase64)) {
      return res.status(400).json({ error: "Unsupported image — use JPG, JPEG, PNG or WEBP" });
    }
    if (pictureBase64.length > 6_000_000) {
      return res.status(400).json({ error: "Image is too large (max ~4 MB)" });
    }
  }

  try {
    const pool = getPool();
    const guard = await pool.request().input("AssetId", sql.Int, assetId).query(
      `SELECT AssetId, FAItemCode FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId AND Status <> 'Deleted' AND AssetCode IS NOT NULL`,
    );
    if (!guard.recordset.length) return res.status(404).json({ error: "Fixed Asset Record not found" });

    await pool.request()
      .input("AssetId",       sql.Int, assetId)
      .input("PictureBase64", sql.NVarChar(sql.MAX), clearing ? null : pictureBase64)
      .input("UpdatedBy",     sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetRecord
        SET PictureBase64 = @PictureBase64, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE AssetId = @AssetId
      `);

    await bumpCacheVersion("fixed-assets");
    await bumpCacheVersion("asset-transfer");
    res.json({ ok: true });
  } catch (err) {
    console.error("[assetTransfer] PUT /asset-picture/:assetId:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list transfer history ─────────────────────────────────────────────
router.get("/", requirePageRight("asset-transfer", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = ["h.Status <> 'Deleted'"];

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
        h.AssetId, fa.AssetName, fa.AssetCode, fa.AssetCategory, fa.FAItemCode,
        h.FromUserId, fu.name AS FromUserName, fu.avatar_url AS FromUserAvatar,
        h.ToUserId, tu.name AS ToUserName, tu.avatar_url AS ToUserAvatar,
        h.TransferredBy, bu.name AS TransferredByName,
        h.DepartmentId, dm.DepartmentName
      FROM dbo.AssetTransferHistory h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      LEFT JOIN dbo.users bu ON bu.id = h.TransferredBy
      LEFT JOIN dbo.DepartmentMaster dm ON dm.Id = h.DepartmentId
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
        fa.AssetName, fa.AssetCode, fa.AssetCategory, fa.FAItemCode,
        fu.name AS FromUserName, fu.avatar_url AS FromUserAvatar,
        tu.name AS ToUserName, tu.avatar_url AS ToUserAvatar,
        bu.name AS TransferredByName,
        dm.DepartmentName
      FROM dbo.AssetTransferHistory h
      LEFT JOIN dbo.enterprise co ON co.id = h.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = h.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = h.AssetId
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      LEFT JOIN dbo.users bu ON bu.id = h.TransferredBy
      LEFT JOIN dbo.DepartmentMaster dm ON dm.Id = h.DepartmentId
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
    assetId, fromUserId, toUserId, departmentId, remarks,
  } = req.body;

  const assetIdVal = toInt(assetId);
  const projectIdVal = toInt(projectId);
  const fromUserIdVal = toInt(fromUserId);
  const toUserIdVal = toInt(toUserId);
  const departmentIdVal = toInt(departmentId);

  if (!assetIdVal) return res.status(400).json({ error: "assetId is required" });
  if (!projectIdVal) return res.status(400).json({ error: "projectId is required" });
  if (!fromUserIdVal || !toUserIdVal) return res.status(400).json({ error: "fromUserId and toUserId are required" });
  if (fromUserIdVal === toUserIdVal) return res.status(400).json({ error: "From User and To User must be different" });
  if (!departmentIdVal) return res.status(400).json({ error: "departmentId is required" });
  if (!remarks || !String(remarks).trim()) return res.status(400).json({ error: "Remarks are required" });

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

    const deptCheck = await pool.request().input("DepartmentId", sql.Int, departmentIdVal).query(`
      SELECT DepartmentName FROM dbo.DepartmentMaster WHERE Id = @DepartmentId AND IsActive = 1
    `);
    const departmentName = deptCheck.recordset[0]?.DepartmentName;
    if (!departmentName) return res.status(400).json({ error: "Selected department is not valid" });

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
        .input("Department", sql.NVarChar(100), departmentName)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET CustodianUserId = @ToUserId, Custodian = @ToUserName,
              Department = @Department,
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
        .input("DepartmentId", sql.Int, departmentIdVal)
        .input("TransferredBy", sql.Int, transferredBy ? parseInt(transferredBy, 10) : null)
        .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
        .query(`
          INSERT INTO dbo.AssetTransferHistory
            (DocNo, DocDate, TransferDate, CompanyId, ProjectId, FinYear, AssetId, FromUserId, ToUserId, DepartmentId, TransferredBy, Remarks, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES
            (@DocNo, @DocDate, @TransferDate, @CompanyId, @ProjectId, @FinYear, @AssetId, @FromUserId, @ToUserId, @DepartmentId, @TransferredBy, @Remarks, SYSDATETIME())
        `);
      const newId = insert.recordset[0].Id;

      const asn = await upsertAssignmentForTransfer(tx, pool, {
        transferId: newId, assetId: assetIdVal, toUserId: toUserIdVal,
        companyId: companyId ? parseInt(companyId, 10) : null,
        projectId: projectIdVal, finYear: finYear || null,
        departmentId: departmentIdVal,
        transferDate: transferDate || docDate || null, email,
      });

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "AssetTransferHistory", newId);
      if (asn) await backPatchRecordId(pool, sql, asn.docNo, "FixedAssetAssignment", asn.assignmentId);
      await bumpCacheVersion("asset-transfer");
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ id: newId, docNo });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[assetTransfer] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id — full edit of a transfer transaction ────────────────────────────
// Edits the stored row in place (never inserts a new one) and immediately
// re-syncs FixedAssetRecord.CustodianUserId for whichever asset(s) are
// affected — the one being edited, and if the asset itself was reassigned,
// the one it moved away from too. See recomputeCustodianForAsset() above.
router.put("/:id", requirePageRight("asset-transfer", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;

  const {
    docDate, transferDate, companyId, projectId, finYear,
    assetId, fromUserId, toUserId, departmentId, remarks,
  } = req.body;

  const assetIdVal = toInt(assetId);
  const projectIdVal = toInt(projectId);
  const fromUserIdVal = toInt(fromUserId);
  const toUserIdVal = toInt(toUserId);
  const departmentIdVal = toInt(departmentId);

  if (!assetIdVal) return res.status(400).json({ error: "assetId is required" });
  if (!projectIdVal) return res.status(400).json({ error: "projectId is required" });
  if (!fromUserIdVal || !toUserIdVal) return res.status(400).json({ error: "fromUserId and toUserId are required" });
  if (fromUserIdVal === toUserIdVal) return res.status(400).json({ error: "From User and To User must be different" });
  if (!departmentIdVal) return res.status(400).json({ error: "departmentId is required" });
  if (!remarks || !String(remarks).trim()) return res.status(400).json({ error: "Remarks are required" });

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

    const deptCheck = await pool.request().input("DepartmentId", sql.Int, departmentIdVal).query(`
      SELECT DepartmentName FROM dbo.DepartmentMaster WHERE Id = @DepartmentId AND IsActive = 1
    `);
    if (!deptCheck.recordset[0]?.DepartmentName) return res.status(400).json({ error: "Selected department is not valid" });

    const tx = pool.transaction();
    await tx.begin();
    try {
      const rowRes = await tx.request()
        .input("Id", sql.Int, id)
        .query(`
          SELECT Id, AssetId, FromUserId, ToUserId, Status
          FROM dbo.AssetTransferHistory WITH (UPDLOCK, HOLDLOCK)
          WHERE Id = @Id
        `);
      const row = rowRes.recordset[0];
      if (!row) { await tx.rollback(); return res.status(404).json({ error: "Transfer not found" }); }
      if (row.Status === "Deleted") { await tx.rollback(); return res.status(400).json({ error: "This transfer has been deleted and can no longer be edited" }); }

      const oldAssetId = row.AssetId;
      const assetChanged = oldAssetId !== assetIdVal;

      // Lock + validate the asset the row will point to after this edit —
      // same checks POST applies to a brand-new transfer.
      const newAssetRes = await tx.request()
        .input("AssetId", sql.Int, assetIdVal)
        .query(`
          SELECT AssetId, AssetName, ProjectId, AssetStatus
          FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
          WHERE AssetId = @AssetId
        `);
      const newAsset = newAssetRes.recordset[0];
      if (!newAsset) { await tx.rollback(); return res.status(404).json({ error: "Asset not found" }); }
      if (newAsset.ProjectId !== projectIdVal) {
        await tx.rollback();
        return res.status(400).json({ error: `"${newAsset.AssetName}" does not belong to the selected project` });
      }
      if (newAsset.AssetStatus !== "Active") {
        await tx.rollback();
        return res.status(400).json({ error: `"${newAsset.AssetName}" is ${newAsset.AssetStatus} and can't be transferred` });
      }

      // Also lock the old asset up front (before any writes) if it differs,
      // so both rows are held for the rest of the transaction.
      if (assetChanged) {
        await tx.request()
          .input("AssetId", sql.Int, oldAssetId)
          .query(`SELECT AssetId FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK) WHERE AssetId = @AssetId`);
      }

      const toUserName = userCheck.recordset.find((u) => u.id === toUserIdVal)?.name || null;

      await tx.request()
        .input("Id", sql.Int, id)
        .input("DocDate", sql.Date, docDate || null)
        .input("TransferDate", sql.Date, transferDate || docDate || null)
        .input("CompanyId", sql.Int, companyId ? parseInt(companyId, 10) : null)
        .input("ProjectId", sql.Int, projectIdVal)
        .input("FinYear", sql.NVarChar(20), finYear || null)
        .input("AssetId", sql.Int, assetIdVal)
        .input("FromUserId", sql.Int, fromUserIdVal)
        .input("ToUserId", sql.Int, toUserIdVal)
        .input("DepartmentId", sql.Int, departmentIdVal)
        .input("Remarks", sql.NVarChar(sql.MAX), remarks.trim())
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.AssetTransferHistory SET
            DocDate = @DocDate, TransferDate = @TransferDate,
            CompanyId = @CompanyId, ProjectId = @ProjectId, FinYear = @FinYear,
            AssetId = @AssetId, FromUserId = @FromUserId, ToUserId = @ToUserId,
            DepartmentId = @DepartmentId, Remarks = @Remarks,
            UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @Id
        `);

      // Re-sync current custodian(s) from history — never from the delta,
      // so this stays correct regardless of how many other transfers exist.
      if (assetChanged) {
        const oldStillHasHistory = await recomputeCustodianForAsset(tx, oldAssetId);
        if (oldStillHasHistory == null) {
          // No transfers left pointing at the old asset — it reverts to
          // whoever held it before this (now relocated) transfer.
          await applyCustodian(tx, oldAssetId, row.FromUserId);
        }
        await recomputeCustodianForAsset(tx, assetIdVal);
      } else {
        await recomputeCustodianForAsset(tx, assetIdVal);
      }

      // Keep this transfer's linked Assignment row in step with the edit.
      const asn = await upsertAssignmentForTransfer(tx, pool, {
        transferId: id, assetId: assetIdVal, toUserId: toUserIdVal,
        companyId: companyId ? parseInt(companyId, 10) : null,
        projectId: projectIdVal, finYear: finYear || null,
        departmentId: departmentIdVal,
        transferDate: transferDate || docDate || null, email,
      });

      await tx.commit();
      if (asn) await backPatchRecordId(pool, sql, asn.docNo, "FixedAssetAssignment", asn.assignmentId);
      await bumpCacheVersion("asset-transfer");
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true, toUserName });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[assetTransfer] PUT /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /:id — soft-delete a transfer transaction ──────────────────────────
// Rows are never hard-deleted (audit trail); Status flips to 'Deleted' and
// the affected asset's current custodian is recalculated from whatever
// transfer history remains, falling back to the deleted row's own FromUserId
// (the holder before this transfer ever happened) if none is left.
router.delete("/:id", requirePageRight("asset-transfer", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;

  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const rowRes = await tx.request()
        .input("Id", sql.Int, id)
        .query(`
          SELECT Id, AssetId, FromUserId, Status
          FROM dbo.AssetTransferHistory WITH (UPDLOCK, HOLDLOCK)
          WHERE Id = @Id
        `);
      const row = rowRes.recordset[0];
      if (!row) { await tx.rollback(); return res.status(404).json({ error: "Transfer not found" }); }
      if (row.Status === "Deleted") { await tx.rollback(); return res.status(400).json({ error: "This transfer has already been deleted" }); }

      await tx.request()
        .input("AssetId", sql.Int, row.AssetId)
        .query(`SELECT AssetId FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK) WHERE AssetId = @AssetId`);

      await tx.request()
        .input("Id", sql.Int, id)
        .input("DeletedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.AssetTransferHistory SET
            Status = 'Deleted', DeletedBy = @DeletedBy, DeletedAt = SYSDATETIME()
          WHERE Id = @Id
        `);

      const remainingCustodian = await recomputeCustodianForAsset(tx, row.AssetId);
      if (remainingCustodian == null) {
        // This was the only (remaining) transfer for the asset — restore
        // whoever held it beforehand.
        await applyCustodian(tx, row.AssetId, row.FromUserId);
      }

      // Roll back the Assignment this transfer created — the previous
      // holder's assignment becomes Current again automatically (it's
      // derived from the custodian we just restored above).
      await softDeleteAssignmentForTransfer(tx, id);

      await tx.commit();
      await bumpCacheVersion("asset-transfer");
      await bumpCacheVersion("fixed-asset-assignment");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[assetTransfer] DELETE /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
