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

// Generate AssetCode from category prefix + sequence, e.g. LAP-0001
const CATEGORY_PREFIX = {
  "Laptop":       "LAP",
  "Desktop":      "DSK",
  "Mobile Phone": "MOB",
  "Printer":      "PRN",
  "Scanner":      "SCN",
  "Furniture":    "FRN",
  "Vehicle":      "VEH",
  "Machinery":    "MCH",
  "Other":        "OTH",
};

async function generateAssetCode(pool, category) {
  const prefix = CATEGORY_PREFIX[category] || "AST";
  const result = await pool.request()
    .input("Prefix", sql.NVarChar(10), prefix)
    .query(`
      SELECT COUNT(*) AS Cnt FROM dbo.FixedAssetRecord
      WHERE AssetCode LIKE @Prefix + '-%'
    `);
  const seq = (result.recordset[0]?.Cnt || 0) + 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// ── GET / — list ──────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = [];

    if (req.query.companyId)  { request.input("CompanyId",  sql.Int,          parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId)  { request.input("ProjectId",  sql.Int,          parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    if (req.query.category)   { request.input("Category",   sql.NVarChar(100), req.query.category);               where.push("fa.AssetCategory = @Category"); }
    if (req.query.assetStatus){ request.input("AssetStatus",sql.NVarChar(30),  req.query.assetStatus);             where.push("fa.AssetStatus = @AssetStatus"); }
    if (req.query.finYear)    { request.input("FinYear",    sql.NVarChar(20),  req.query.finYear);                 where.push("fa.FinYear = @FinYear"); }
    if (req.query.fromDate)   { request.input("FromDate",   sql.Date,          req.query.fromDate);                where.push("fa.PurchaseDate >= @FromDate"); }
    if (req.query.toDate)     { request.input("ToDate",     sql.Date,          req.query.toDate);                  where.push("fa.PurchaseDate <= @ToDate"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        fa.AssetId, fa.DocNo, fa.DocDate, fa.FinYear,
        fa.AssetName, fa.AssetCategory, fa.AssetCode,
        fa.Brand, fa.Model, fa.SerialNumber,
        fa.PurchaseDate, fa.ActivationDate, fa.PurchaseCost, fa.Quantity,
        fa.Location, fa.Department, fa.Custodian,
        fa.DepreciationSetupId, fa.DepreciationType, fa.DepreciationRate, fa.UsefulLife,
        fa.AssetStatus, fa.SellingPrice, fa.SaleDate, fa.BuyerName,
        fa.Status, fa.CreatedBy, fa.CreatedAt,
        fa.CompanyId, co.name AS CompanyName,
        fa.ProjectId, pr.name AS ProjectName,
        fa.SupplierId, sup.LHeadName AS SupplierName
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.enterprise co  ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr  ON pr.id = fa.ProjectId
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = fa.SupplierId
      ${whereClause}
      ORDER BY fa.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("AssetId", sql.Int, id).query(`
      SELECT
        fa.*,
        co.name AS CompanyName,
        pr.name AS ProjectName,
        sup.LHeadName AS SupplierName,
        sup.LHeadCode AS SupplierCode
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.enterprise co  ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr  ON pr.id = fa.ProjectId
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = fa.SupplierId
      WHERE fa.AssetId = @AssetId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", requirePageRight("fixed-asset-record", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const {
      docDate, companyId, projectId, finYear,
      assetName, assetCategory, brand, model, serialNumber,
      purchaseDate, activationDate, purchaseInvoiceRef, supplierId, purchaseCost, quantity,
      location, department, custodian,
      depreciationSetupId, depreciationType, depreciationRate, usefulLife,
      remarks,
    } = req.body;

    if (!assetName || !assetCategory)
      return res.status(400).json({ error: "assetName and assetCategory are required" });

    const docTypeId = await resolveDocTypeId(pool, sql, "FA");
    const docNo     = await lockNextDocNumber(pool, sql, {
      docTypeId, finYear, tableName: "FixedAssetRecord", issuedBy: email,
    });
    const assetCode = await generateAssetCode(pool, assetCategory);

    const insert = await pool.request()
      .input("DocNo",               sql.NVarChar(100), docNo)
      .input("DocDate",             sql.Date,          docDate || null)
      .input("CompanyId",           sql.Int,           companyId   ? parseInt(companyId, 10)   : null)
      .input("ProjectId",           sql.Int,           projectId   ? parseInt(projectId, 10)   : null)
      .input("FinYear",             sql.NVarChar(20),  finYear || null)
      .input("AssetName",           sql.NVarChar(200), assetName)
      .input("AssetCategory",       sql.NVarChar(100), assetCategory)
      .input("AssetCode",           sql.NVarChar(50),  assetCode)
      .input("Brand",               sql.NVarChar(100), brand || null)
      .input("Model",               sql.NVarChar(100), model || null)
      .input("SerialNumber",        sql.NVarChar(100), serialNumber || null)
      .input("PurchaseDate",        sql.Date,          purchaseDate || null)
      .input("ActivationDate",      sql.Date,          activationDate || null)
      .input("PurchaseInvoiceRef",  sql.NVarChar(100), purchaseInvoiceRef || null)
      .input("SupplierId",          sql.Int,           supplierId  ? parseInt(supplierId, 10)  : null)
      .input("PurchaseCost",        sql.Decimal(18,2), purchaseCost ? parseFloat(purchaseCost) : 0)
      .input("Quantity",            sql.Decimal(18,3), quantity    ? parseFloat(quantity)      : 1)
      .input("Location",            sql.NVarChar(200), location || null)
      .input("Department",          sql.NVarChar(100), department || null)
      .input("Custodian",           sql.NVarChar(200), custodian || null)
      .input("DepreciationSetupId", sql.Int,           depreciationSetupId ? parseInt(depreciationSetupId, 10) : null)
      .input("DepreciationType",    sql.NVarChar(50),  depreciationType || null)
      .input("DepreciationRate",    sql.Decimal(5,2),  depreciationRate != null ? parseFloat(depreciationRate) : null)
      .input("UsefulLife",          sql.Int,           usefulLife  ? parseInt(usefulLife, 10)  : null)
      .input("Remarks",             sql.NVarChar(sql.MAX), remarks || null)
      .input("CreatedBy",           sql.NVarChar(200), email)
      .query(`
        INSERT INTO dbo.FixedAssetRecord
          (DocNo, DocDate, CompanyId, ProjectId, FinYear,
           AssetName, AssetCategory, AssetCode, Brand, Model, SerialNumber,
           PurchaseDate, ActivationDate, PurchaseInvoiceRef, SupplierId, PurchaseCost, Quantity,
           Location, Department, Custodian,
           DepreciationSetupId, DepreciationType, DepreciationRate, UsefulLife,
           AssetStatus, Status, Remarks, CreatedBy, CreatedAt)
        VALUES
          (@DocNo, @DocDate, @CompanyId, @ProjectId, @FinYear,
           @AssetName, @AssetCategory, @AssetCode, @Brand, @Model, @SerialNumber,
           @PurchaseDate, @ActivationDate, @PurchaseInvoiceRef, @SupplierId, @PurchaseCost, @Quantity,
           @Location, @Department, @Custodian,
           @DepreciationSetupId, @DepreciationType, @DepreciationRate, @UsefulLife,
           'Active', 'Draft', @Remarks, @CreatedBy, SYSDATETIME());
        SELECT SCOPE_IDENTITY() AS AssetId;
      `);

    const newId = insert.recordset[0]?.AssetId;
    await backPatchRecordId(pool, sql, docNo, "FixedAssetRecord", newId);
    await bumpCacheVersion("fixed-assets");
    res.json({ assetId: newId, docNo, assetCode });
  } catch (err) {
    console.error("[fixedAssets] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("fixed-asset-record", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const {
      docDate, companyId, projectId, finYear,
      assetName, assetCategory, brand, model, serialNumber,
      purchaseDate, activationDate, purchaseInvoiceRef, supplierId, purchaseCost, quantity,
      location, department, custodian,
      depreciationSetupId, depreciationType, depreciationRate, usefulLife,
      assetStatus, sellingPrice, saleDate, buyerName, saleRemarks,
      remarks, status,
    } = req.body;

    await pool.request()
      .input("AssetId",            sql.Int,           id)
      .input("DocDate",            sql.Date,          docDate || null)
      .input("CompanyId",          sql.Int,           companyId   ? parseInt(companyId, 10)   : null)
      .input("ProjectId",          sql.Int,           projectId   ? parseInt(projectId, 10)   : null)
      .input("FinYear",            sql.NVarChar(20),  finYear || null)
      .input("AssetName",          sql.NVarChar(200), assetName || null)
      .input("AssetCategory",      sql.NVarChar(100), assetCategory || null)
      .input("Brand",              sql.NVarChar(100), brand || null)
      .input("Model",              sql.NVarChar(100), model || null)
      .input("SerialNumber",       sql.NVarChar(100), serialNumber || null)
      .input("PurchaseDate",       sql.Date,          purchaseDate || null)
      .input("ActivationDate",     sql.Date,          activationDate || null)
      .input("PurchaseInvoiceRef", sql.NVarChar(100), purchaseInvoiceRef || null)
      .input("SupplierId",         sql.Int,           supplierId  ? parseInt(supplierId, 10)  : null)
      .input("PurchaseCost",       sql.Decimal(18,2), purchaseCost != null ? parseFloat(purchaseCost) : null)
      .input("Quantity",           sql.Decimal(18,3), quantity    != null ? parseFloat(quantity)      : null)
      .input("Location",           sql.NVarChar(200), location || null)
      .input("Department",         sql.NVarChar(100), department || null)
      .input("Custodian",          sql.NVarChar(200), custodian || null)
      .input("DepreciationSetupId",sql.Int,           depreciationSetupId ? parseInt(depreciationSetupId, 10) : null)
      .input("DepreciationType",   sql.NVarChar(50),  depreciationType || null)
      .input("DepreciationRate",   sql.Decimal(5,2),  depreciationRate != null ? parseFloat(depreciationRate) : null)
      .input("UsefulLife",         sql.Int,           usefulLife  ? parseInt(usefulLife, 10)  : null)
      .input("AssetStatus",        sql.NVarChar(30),  assetStatus || null)
      .input("SellingPrice",       sql.Decimal(18,2), sellingPrice != null ? parseFloat(sellingPrice) : null)
      .input("SaleDate",           sql.Date,          saleDate || null)
      .input("BuyerName",          sql.NVarChar(200), buyerName || null)
      .input("SaleRemarks",        sql.NVarChar(sql.MAX), saleRemarks || null)
      .input("Remarks",            sql.NVarChar(sql.MAX), remarks || null)
      .input("Status",             sql.NVarChar(30),  status || null)
      .input("UpdatedBy",          sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetRecord SET
          DocDate            = ISNULL(@DocDate,            DocDate),
          CompanyId          = @CompanyId,
          ProjectId          = @ProjectId,
          FinYear            = ISNULL(@FinYear,            FinYear),
          AssetName          = ISNULL(@AssetName,          AssetName),
          AssetCategory      = ISNULL(@AssetCategory,      AssetCategory),
          Brand              = @Brand,
          Model              = @Model,
          SerialNumber       = @SerialNumber,
          PurchaseDate       = @PurchaseDate,
          ActivationDate     = @ActivationDate,
          PurchaseInvoiceRef = @PurchaseInvoiceRef,
          SupplierId         = @SupplierId,
          PurchaseCost       = ISNULL(@PurchaseCost,       PurchaseCost),
          Quantity           = ISNULL(@Quantity,           Quantity),
          Location           = @Location,
          Department         = @Department,
          Custodian          = @Custodian,
          DepreciationSetupId= @DepreciationSetupId,
          DepreciationType   = @DepreciationType,
          DepreciationRate   = @DepreciationRate,
          UsefulLife         = @UsefulLife,
          AssetStatus        = ISNULL(@AssetStatus,        AssetStatus),
          SellingPrice       = @SellingPrice,
          SaleDate           = @SaleDate,
          BuyerName          = @BuyerName,
          SaleRemarks        = @SaleRemarks,
          Remarks            = @Remarks,
          Status             = ISNULL(@Status,             Status),
          UpdatedBy          = @UpdatedBy,
          UpdatedAt          = SYSDATETIME()
        WHERE AssetId = @AssetId
      `);

    await bumpCacheVersion("fixed-assets");
    res.json({ ok: true });
  } catch (err) {
    console.error("[fixedAssets] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("fixed-asset-record", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    await pool.request()
      .input("AssetId",   sql.Int,           id)
      .input("UpdatedBy", sql.NVarChar(200),  email)
      .query(`
        UPDATE dbo.FixedAssetRecord
        SET Status = 'Deleted', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE AssetId = @AssetId
      `);
    await bumpCacheVersion("fixed-assets");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
