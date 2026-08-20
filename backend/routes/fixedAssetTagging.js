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

// ── GET /eligible-items — Pending FixedAssetRecord batches with untagged qty > 0 ──
router.get("/eligible-items", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = ["fa.AssetStatus = 'Pending'", "fa.Status <> 'Deleted'"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    if (req.query.finYear)   { request.input("FinYear",   sql.NVarChar(20), req.query.finYear);        where.push("fa.FinYear = @FinYear"); }

    const result = await request.query(`
      SELECT
        fa.AssetId, fa.AssetName, fa.AssetCategory, fa.AssetCode,
        fa.SourceItemId AS ItemId, im.M_Name AS ItemName,
        fa.Quantity,
        ISNULL(tagged.Qty, 0) AS TaggedQty,
        fa.Quantity - ISNULL(tagged.Qty, 0) AS UntaggedQty,
        fa.CompanyId, co.name AS CompanyName,
        fa.ProjectId, pr.name AS ProjectName,
        fa.FinYear, fa.PurchaseDate, fa.DocNo
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = fa.SourceItemId
      LEFT JOIN dbo.enterprise co ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = fa.ProjectId
      OUTER APPLY (
        SELECT SUM(t.TaggedQty) AS Qty
        FROM dbo.FixedAssetTagging t
        WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged'
      ) tagged
      WHERE ${where.join(" AND ")}
        AND (fa.Quantity - ISNULL(tagged.Qty, 0)) > 0
      ORDER BY fa.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /eligible-items:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list tagging transactions (audit trail) ──────────────────────────
router.get("/", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = [];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("t.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("t.ProjectId = @ProjectId"); }
    if (req.query.finYear)   { request.input("FinYear",   sql.NVarChar(20), req.query.finYear);        where.push("t.FinYear = @FinYear"); }
    if (req.query.assetId)   { request.input("AssetId",   sql.Int, parseInt(req.query.assetId, 10));   where.push("t.AssetId = @AssetId"); }
    if (req.query.fromDate)  { request.input("FromDate",  sql.Date, req.query.fromDate);                where.push("t.DocDate >= @FromDate"); }
    if (req.query.toDate)    { request.input("ToDate",    sql.Date, req.query.toDate);                  where.push("t.DocDate <= @ToDate"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        t.TagId, t.DocNo, t.DocDate, t.FinYear, t.TaggedQty, t.Remarks, t.Status,
        t.CreatedBy, t.CreatedAt,
        t.CompanyId, co.name AS CompanyName,
        t.ProjectId, pr.name AS ProjectName,
        t.AssetId, fa.AssetName, fa.AssetCategory, fa.AssetCode
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = t.AssetId
      ${whereClause}
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("TagId", sql.Int, id).query(`
      SELECT
        t.*,
        co.name AS CompanyName,
        pr.name AS ProjectName,
        fa.AssetName, fa.AssetCategory, fa.AssetCode, fa.Quantity AS BatchQuantity
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = t.AssetId
      WHERE t.TagId = @TagId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create a tagging entry ───────────────────────────────────────────
router.post("/", requirePageRight("fixed-asset-tagging", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;

  const {
    docDate, companyId, projectId, finYear, assetId, taggedQty, remarks,
  } = req.body;

  const assetIdVal = toInt(assetId);
  const qtyVal = parseFloat(taggedQty);

  if (!assetIdVal) return res.status(400).json({ error: "assetId is required" });
  if (!Number.isFinite(qtyVal) || qtyVal <= 0) return res.status(400).json({ error: "taggedQty must be a positive number" });

  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Lock the batch row + re-derive UntaggedQty inside the transaction so
      // two concurrent tagging requests against the same batch can't both pass
      // validation and jointly over-tag it.
      const batchRes = await tx.request().input("AssetId", sql.Int, assetIdVal).query(`
        SELECT fa.AssetId, fa.Quantity, fa.AssetStatus, fa.SourceItemId,
               ISNULL((SELECT SUM(t.TaggedQty) FROM dbo.FixedAssetTagging t WITH (UPDLOCK, HOLDLOCK)
                       WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged'), 0) AS TaggedSoFar
        FROM dbo.FixedAssetRecord fa WITH (UPDLOCK, HOLDLOCK)
        WHERE fa.AssetId = @AssetId
      `);
      const batch = batchRes.recordset[0];
      if (!batch) { await tx.rollback(); return res.status(404).json({ error: "Fixed asset batch not found" }); }
      if (batch.AssetStatus !== "Pending") { await tx.rollback(); return res.status(400).json({ error: "This batch is not open for tagging" }); }

      const untagged = Number(batch.Quantity) - Number(batch.TaggedSoFar);
      if (qtyVal > untagged) {
        await tx.rollback();
        return res.status(400).json({ error: `Cannot tag ${qtyVal} — only ${untagged} untagged unit(s) available for this item` });
      }

      const docTypeId = await resolveDocTypeId(pool, sql, "FAT");
      const docNo = await lockNextDocNumber(pool, sql, {
        docTypeId, finYear, tableName: "FixedAssetTagging", issuedBy: email,
      });

      const insert = await tx.request()
        .input("DocNo",     sql.NVarChar(100), docNo)
        .input("DocDate",   sql.Date,          docDate || null)
        .input("CompanyId", sql.Int,           companyId ? parseInt(companyId, 10) : null)
        .input("ProjectId", sql.Int,           projectId ? parseInt(projectId, 10) : null)
        .input("FinYear",   sql.NVarChar(20),  finYear || null)
        .input("AssetId",   sql.Int,           assetIdVal)
        .input("ItemId",    sql.NVarChar(100), batch.SourceItemId || null)
        .input("TaggedQty", sql.Decimal(18,3), qtyVal)
        .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
        .input("CreatedBy", sql.NVarChar(200), email)
        .query(`
          INSERT INTO dbo.FixedAssetTagging
            (DocNo, DocDate, CompanyId, ProjectId, FinYear, AssetId, ItemId, TaggedQty, Remarks, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.TagId
          VALUES
            (@DocNo, @DocDate, @CompanyId, @ProjectId, @FinYear, @AssetId, @ItemId, @TaggedQty, @Remarks, 'Tagged', @CreatedBy, SYSDATETIME())
        `);
      const newId = insert.recordset[0].TagId;

      const newTaggedTotal = Number(batch.TaggedSoFar) + qtyVal;
      if (newTaggedTotal >= Number(batch.Quantity)) {
        await tx.request()
          .input("AssetId",       sql.Int,  assetIdVal)
          .input("ActivationDate", sql.Date, docDate || null)
          .input("UpdatedBy",     sql.NVarChar(200), email)
          .query(`
            UPDATE dbo.FixedAssetRecord
            SET AssetStatus = 'Active',
                ActivationDate = ISNULL(ActivationDate, @ActivationDate),
                UpdatedBy = @UpdatedBy,
                UpdatedAt = SYSDATETIME()
            WHERE AssetId = @AssetId
          `);
      }

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "FixedAssetTagging", newId);
      await bumpCacheVersion("fixed-asset-tagging");
      await bumpCacheVersion("fixed-assets");
      res.json({ tagId: newId, docNo });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetTagging] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — edit date/remarks only ─────────────────────────────────────────
router.put("/:id", requirePageRight("fixed-asset-tagging", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const { docDate, remarks } = req.body;
    await pool.request()
      .input("TagId",     sql.Int, id)
      .input("DocDate",   sql.Date, docDate || null)
      .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
      .input("UpdatedBy", sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetTagging SET
          DocDate   = ISNULL(@DocDate, DocDate),
          Remarks   = @Remarks,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE TagId = @TagId
      `);
    await bumpCacheVersion("fixed-asset-tagging");
    res.json({ ok: true });
  } catch (err) {
    console.error("[fixedAssetTagging] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — soft-cancel, frees the tagged qty back to the batch ────────
router.delete("/:id", requirePageRight("fixed-asset-tagging", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const tagRes = await tx.request().input("TagId", sql.Int, id).query(`
        SELECT t.TagId, t.AssetId, t.Status, fa.Quantity,
               ISNULL((SELECT SUM(t2.TaggedQty) FROM dbo.FixedAssetTagging t2 WITH (UPDLOCK, HOLDLOCK)
                       WHERE t2.AssetId = t.AssetId AND t2.Status = 'Tagged'), 0) AS TaggedSoFar
        FROM dbo.FixedAssetTagging t WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.FixedAssetRecord fa WITH (UPDLOCK, HOLDLOCK) ON fa.AssetId = t.AssetId
        WHERE t.TagId = @TagId
      `);
      const tag = tagRes.recordset[0];
      if (!tag) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
      if (tag.Status === "Cancelled") { await tx.rollback(); return res.json({ ok: true }); }

      await tx.request()
        .input("TagId",     sql.Int, id)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetTagging
          SET Status = 'Cancelled', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE TagId = @TagId
        `);

      // Freeing this qty means the batch can no longer be fully tagged —
      // revert it to Pending if it had been auto-flipped to Active.
      await tx.request()
        .input("AssetId",   sql.Int, tag.AssetId)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET AssetStatus = 'Pending', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE AssetId = @AssetId AND AssetStatus = 'Active'
        `);

      await tx.commit();
      await bumpCacheVersion("fixed-asset-tagging");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetTagging] DELETE /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
