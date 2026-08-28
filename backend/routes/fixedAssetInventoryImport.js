const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { autoTagBatch, deriveFinYear } = require("../services/fixedAssetAutoAlloc");
const { buildReversalPlan, executeReversal } = require("../services/fixedAssetReversal");

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

// ── GET / — list imports (audit trail) ────────────────────────────────────────
router.get("/", requirePageRight("fixed-asset-inventory-import", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = [];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("i.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("i.ProjectId = @ProjectId"); }
    if (req.query.godownId)  { request.input("GodownId",  sql.Int, parseInt(req.query.godownId, 10));  where.push("i.GodownId = @GodownId"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        i.ImportId, i.DocNo, i.DocDate, i.Quantity, i.Rate, i.Remarks, i.Status,
        i.CreatedBy, i.CreatedAt, i.ReversedBy, i.ReversedAt, i.AssetId,
        i.CompanyId, co.name AS CompanyName,
        i.ProjectId, pr.name AS ProjectName,
        i.GodownId, gd.GodownName,
        i.ItemId, ISNULL(i.ItemName, im.M_Name) AS ItemName,
        fa.AssetCategory
      FROM dbo.FixedAssetInventoryImport i
      LEFT JOIN dbo.enterprise co ON co.id = i.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = i.ProjectId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = i.GodownId
      LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = i.ItemId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = i.AssetId
      ${whereClause}
      ORDER BY i.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetInventoryImport] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("fixed-asset-inventory-import", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("ImportId", sql.Int, id).query(`
      SELECT i.*, co.name AS CompanyName, pr.name AS ProjectName, gd.GodownName,
             ISNULL(i.ItemName, im.M_Name) AS ResolvedItemName
      FROM dbo.FixedAssetInventoryImport i
      LEFT JOIN dbo.enterprise co ON co.id = i.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = i.ProjectId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = i.GodownId
      LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = i.ItemId
      WHERE i.ImportId = @ImportId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[fixedAssetInventoryImport] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — manually bring a Fixed-Asset item into inventory ────────────────
// Mirrors what GRN approval does for a Fixed-Asset-category item
// (services/fixedAssetAutoAlloc.js): a StockLedger 'IN' entry + a batch
// dbo.FixedAssetRecord row, then the same auto-tagging attempt — so an
// item imported here follows the identical downstream tagging/record
// workflow as one received through a GRN.
router.post("/", requirePageRight("fixed-asset-inventory-import", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;

  const { docDate, companyId, projectId, godownId, itemId, quantity, rate, remarks } = req.body;

  const godownIdVal = toInt(godownId);
  const itemIdVal = itemId ? String(itemId) : null;
  const qtyVal = parseFloat(quantity);
  const rateVal = rate != null && rate !== "" ? parseFloat(rate) : null;

  if (!docDate) return res.status(400).json({ error: "docDate is required" });
  if (!godownIdVal) return res.status(400).json({ error: "godownId is required" });
  if (!itemIdVal) return res.status(400).json({ error: "itemId is required" });
  if (!Number.isFinite(qtyVal) || qtyVal <= 0) return res.status(400).json({ error: "quantity must be a positive number" });

  try {
    const pool = getPool();

    const itemRes = await pool.request().input("ItemId", sql.NVarChar(100), itemIdVal).query(`
      SELECT M_Name, M_Group, M_Type FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100), M_Id) = @ItemId
    `);
    const item = itemRes.recordset[0];
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.M_Type !== "Fixed Asset") {
      return res.status(400).json({ error: `"${item.M_Name}" is not a Fixed-Asset-category item` });
    }

    const docTypeId = await resolveDocTypeId(pool, sql, "FAI");
    const finYearForDoc = (await deriveFinYear(pool, docDate)) || undefined;
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId, finYear: finYearForDoc, tableName: "FixedAssetInventoryImport", issuedBy: email,
    });

    const companyIdVal = companyId ? parseInt(companyId, 10) : null;
    const projectIdVal = projectId ? parseInt(projectId, 10) : null;
    const purchaseCost = rateVal != null ? rateVal * qtyVal : 0;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const importInsert = await tx.request()
        .input("DocNo",     sql.NVarChar(100), docNo)
        .input("DocDate",   sql.Date,          docDate)
        .input("CompanyId", sql.Int,           companyIdVal)
        .input("ProjectId", sql.Int,           projectIdVal)
        .input("GodownId",  sql.Int,           godownIdVal)
        .input("ItemId",    sql.NVarChar(100), itemIdVal)
        .input("ItemName",  sql.NVarChar(200), item.M_Name)
        .input("Quantity",  sql.Decimal(18,3), qtyVal)
        .input("Rate",      sql.Decimal(18,2), rateVal)
        .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
        .input("CreatedBy", sql.NVarChar(200), email)
        .query(`
          INSERT INTO dbo.FixedAssetInventoryImport
            (DocNo, DocDate, CompanyId, ProjectId, GodownId, ItemId, ItemName, Quantity, Rate, Remarks, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.ImportId
          VALUES
            (@DocNo, @DocDate, @CompanyId, @ProjectId, @GodownId, @ItemId, @ItemName, @Quantity, @Rate, @Remarks, 'Active', @CreatedBy, SYSDATETIME())
        `);
      const importId = importInsert.recordset[0].ImportId;

      await tx.request()
        .input("ItemID",   sql.NVarChar(50),  itemIdVal)
        .input("Qty",      sql.Decimal(18,2), qtyVal)
        .input("Type",     sql.NVarChar(10),  "IN")
        .input("RefType",  sql.NVarChar(20),  "FA_IMPORT")
        .input("RefID",    sql.Int,           importId)
        .input("DocNo",    sql.NVarChar(100), docNo)
        .input("GodownID", sql.Int,           godownIdVal)
        .query(`
          INSERT INTO StockLedger (ItemID, Qty, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
          VALUES (@ItemID, @Qty, @Type, @RefType, @RefID, @DocNo, @GodownID, GETDATE())
        `);

      const assetInsert = await tx.request()
        .input("DocDate",           sql.Date, docDate)
        .input("CompanyId",         sql.Int, companyIdVal)
        .input("ProjectId",         sql.Int, projectIdVal)
        .input("AssetName",         sql.NVarChar(200), item.M_Name)
        .input("AssetCategory",     sql.NVarChar(100), item.M_Group || "Uncategorized")
        .input("PurchaseDate",      sql.Date, docDate)
        .input("PurchaseInvoiceRef",sql.NVarChar(100), docNo)
        .input("PurchaseCost",      sql.Decimal(18,2), purchaseCost)
        .input("Quantity",          sql.Decimal(18,3), qtyVal)
        .input("AssetStatus",       sql.NVarChar(30), "Pending")
        .input("Remarks",           sql.NVarChar(sql.MAX), `Manually imported via Inventory Import ${docNo}${remarks ? " — " + remarks : ""}`)
        .input("SourceType",        sql.NVarChar(20), "IMPORT")
        .input("SourceId",          sql.Int, importId)
        .input("SourceItemId",      sql.NVarChar(100), itemIdVal)
        .input("GodownId",          sql.Int, godownIdVal)
        .input("CreatedBy",         sql.NVarChar(200), email)
        .query(`
          INSERT INTO dbo.FixedAssetRecord
            (DocDate, CompanyId, ProjectId, AssetName, AssetCategory,
             PurchaseDate, PurchaseInvoiceRef, PurchaseCost, Quantity,
             AssetStatus, Remarks, SourceType, SourceId, SourceItemId, GodownID, CreatedBy)
          OUTPUT INSERTED.AssetId
          VALUES
            (@DocDate, @CompanyId, @ProjectId, @AssetName, @AssetCategory,
             @PurchaseDate, @PurchaseInvoiceRef, @PurchaseCost, @Quantity,
             @AssetStatus, @Remarks, @SourceType, @SourceId, @SourceItemId, @GodownId, @CreatedBy)
        `);
      const assetId = assetInsert.recordset[0].AssetId;

      await tx.request()
        .input("ImportId", sql.Int, importId)
        .input("AssetId",  sql.Int, assetId)
        .query(`UPDATE dbo.FixedAssetInventoryImport SET AssetId = @AssetId WHERE ImportId = @ImportId`);

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "FixedAssetInventoryImport", importId);

      // Same best-effort auto-tagging GRN receipt gets — needs a Project
      // Alias + Financial Year configured, else the batch is left Pending
      // for manual tagging via FA Inventory (identical GRN-path fallback).
      let tagged = 0;
      if (projectIdVal && godownIdVal) {
        try {
          const result = await autoTagBatch(pool, {
            assetId, itemId: itemIdVal, itemName: item.M_Name, qty: qtyVal,
            companyId: companyIdVal, projectId: projectIdVal, godownId: godownIdVal,
            docDate, sourceDocNo: docNo, userEmail: email,
          });
          tagged = result.tagged;
        } catch (err) {
          console.error(`[fixedAssetInventoryImport] auto-tagging failed for import ${importId} (asset ${assetId} left Pending):`, err.message);
        }
      }

      await bumpCacheVersion("fixed-asset-inventory-import");
      await bumpCacheVersion("fixed-assets");
      await bumpCacheVersion("fixed-asset-tagging");
      await bumpCacheVersion("stock-ledger");
      res.json({ importId, assetId, docNo, tagged });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetInventoryImport] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/can-reverse / DELETE /:id — reverse an import ────────────────────
// Thin wrappers around the same shared service Fixed Asset Record's
// "Delete & Reverse" uses — kept as one cascade regardless of entry point.
router.get("/:id/can-reverse", requirePageRight("fixed-asset-inventory-import", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const importRes = await pool.request().input("ImportId", sql.Int, id).query(`
      SELECT AssetId FROM dbo.FixedAssetInventoryImport WHERE ImportId = @ImportId
    `);
    const assetId = importRes.recordset[0]?.AssetId;
    if (!assetId) return res.status(404).json({ error: "Not found" });
    const plan = await buildReversalPlan(pool, assetId);
    res.json(plan);
  } catch (err) {
    console.error("[fixedAssetInventoryImport] GET /:id/can-reverse:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("fixed-asset-inventory-import", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const importRes = await pool.request().input("ImportId", sql.Int, id).query(`
      SELECT AssetId, Status FROM dbo.FixedAssetInventoryImport WHERE ImportId = @ImportId
    `);
    const importRow = importRes.recordset[0];
    if (!importRow) return res.status(404).json({ error: "Not found" });
    if (importRow.Status === "Reversed") return res.json({ ok: true });
    if (!importRow.AssetId) return res.status(400).json({ error: "This import has no linked asset to reverse" });

    const result = await executeReversal(pool, importRow.AssetId, email);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[fixedAssetInventoryImport] DELETE /:id:", err.message);
    const status = err.code === "BLOCKED" || err.code === "NOT_SOURCE_LINKED" || err.code === "ALREADY_DELETED" ? 409 : 500;
    res.status(status).json({ error: err.message, reason: err.reason || err.code });
  }
});

module.exports = router;
