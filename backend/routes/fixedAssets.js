const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { buildReversalPlan, executeReversal } = require("../services/fixedAssetReversal");

router.use(authenticateToken);

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}

// Custodian is stored two ways: CustodianUserId (FK, drives Asset Transfer
// eligibility) and Custodian (free-text display name). Resolving the name
// here whenever a user id is supplied keeps the two from drifting apart.
async function resolveCustodianName(pool, custodianUserId) {
  if (!custodianUserId) return null;
  const result = await pool.request()
    .input("Id", sql.Int, custodianUserId)
    .query(`SELECT name FROM dbo.users WHERE id = @Id AND ISNULL(discontinue, 0) = 0`);
  return result.recordset[0]?.name || null;
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
    // GRN/Inventory-Import auto-allocation (services/fixedAssetAutoAlloc.js,
    // routes/fixedAssetInventoryImport.js) creates an internal "batch" row
    // here purely so FA Inventory has untagged stock to tag — it is NEVER a
    // Fixed Asset on its own (no AssetCode/DocNo are ever assigned to one).
    // A GRN alone must never surface in the Asset Register; only a row a
    // user explicitly created (always AssetCode-bearing) qualifies.
    let where = ["fa.AssetCode IS NOT NULL"];

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
        fa.Location, fa.Department, fa.Custodian, fa.CustodianUserId,
        fa.DepreciationSetupId, fa.DepreciationType, fa.DepreciationRate, fa.UsefulLife,
        fa.AssetStatus, fa.SellingPrice, fa.SaleDate, fa.BuyerName,
        fa.RepairType,
        fa.Status, fa.CreatedBy, fa.CreatedAt,
        fa.CompanyId, co.name AS CompanyName,
        fa.ProjectId, pr.name AS ProjectName,
        fa.SupplierId, sup.LHeadName AS SupplierName,
        fa.GodownID, gd.GodownName, fa.SourceTagId, fa.FAItemCode
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.enterprise co  ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr  ON pr.id = fa.ProjectId
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = fa.SupplierId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = fa.GodownID
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
        sup.LHeadCode AS SupplierCode,
        gd.GodownName
      FROM dbo.FixedAssetRecord fa
      LEFT JOIN dbo.enterprise co  ON co.id = fa.CompanyId
      LEFT JOIN dbo.enterprise pr  ON pr.id = fa.ProjectId
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = fa.SupplierId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = fa.GodownID
      WHERE fa.AssetId = @AssetId
    `);
    const row = result.recordset[0];
    // A batch row (no AssetCode) is FA Inventory's internal bookkeeping,
    // never a Fixed Asset — treat it as not-found here exactly like the
    // list above hides it, so it can't be viewed/edited by guessing an id.
    if (!row || !row.AssetCode) return res.status(404).json({ error: "Not found" });
    res.json(row);
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
      location, department, custodianUserId,
      depreciationSetupId, depreciationType, depreciationRate, usefulLife,
      remarks, sourceTagId, pictureBase64, repairType,
    } = req.body;

    if (!assetCategory)
      return res.status(400).json({ error: "assetCategory is required" });

    const sourceTagIdVal = sourceTagId ? parseInt(sourceTagId, 10) : null;
    if (!sourceTagIdVal && !assetName)
      return res.status(400).json({ error: "assetName is required when no FA Item Code is selected" });

    const custodianUserIdVal = custodianUserId ? parseInt(custodianUserId, 10) : null;
    const custodianName = await resolveCustodianName(pool, custodianUserIdVal);

    const tx = pool.transaction();
    await tx.begin();
    try {
      // Linking an FA Item Code: re-verify inside the lock that the code
      // still exists and is unassigned, and pull its item/company/project/
      // godown to populate the record — mirrors the same "select an
      // unassigned resource, re-check under UPDLOCK, insert" pattern used
      // by Asset Transfer's eligibility check.
      let sourceItemName = null, sourceCompanyId = null, sourceProjectId = null, sourceGodownId = null, sourceCode = null;
      if (sourceTagIdVal) {
        const tagRes = await tx.request().input("TagId", sql.Int, sourceTagIdVal).query(`
          SELECT t.TagId, t.FAItemCode, t.CompanyId, t.ProjectId, t.GodownId,
                 im.M_Name AS ItemName
          FROM dbo.FixedAssetTagging t WITH (UPDLOCK, HOLDLOCK)
          LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = t.ItemId
          WHERE t.TagId = @TagId AND t.FAItemCode IS NOT NULL AND t.Status = 'Tagged'
            AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted')
        `);
        const tag = tagRes.recordset[0];
        if (!tag) { await tx.rollback(); return res.status(400).json({ error: "This FA Item Code is no longer available — it may already be assigned" }); }
        sourceItemName   = tag.ItemName;
        sourceCompanyId  = tag.CompanyId;
        sourceProjectId  = tag.ProjectId;
        sourceGodownId   = tag.GodownId;
        sourceCode       = tag.FAItemCode;
      }

      const docTypeId = await resolveDocTypeId(pool, sql, "FA");
      const docNo     = await lockNextDocNumber(pool, sql, {
        docTypeId, finYear, tableName: "FixedAssetRecord", issuedBy: email,
      });
      const assetCode = await generateAssetCode(pool, assetCategory);

      const insert = await tx.request()
        .input("DocNo",               sql.NVarChar(100), docNo)
        .input("DocDate",             sql.Date,          docDate || null)
        .input("CompanyId",           sql.Int,           sourceTagIdVal ? sourceCompanyId : (companyId ? parseInt(companyId, 10) : null))
        .input("ProjectId",           sql.Int,           sourceTagIdVal ? sourceProjectId : (projectId ? parseInt(projectId, 10) : null))
        .input("FinYear",             sql.NVarChar(20),  finYear || null)
        .input("AssetName",           sql.NVarChar(200), sourceTagIdVal ? sourceItemName : assetName)
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
        .input("Custodian",           sql.NVarChar(200), custodianName)
        .input("CustodianUserId",     sql.Int,           custodianUserIdVal)
        .input("DepreciationSetupId", sql.Int,           depreciationSetupId ? parseInt(depreciationSetupId, 10) : null)
        .input("DepreciationType",    sql.NVarChar(50),  depreciationType || null)
        .input("DepreciationRate",    sql.Decimal(5,2),  depreciationRate != null ? parseFloat(depreciationRate) : null)
        .input("UsefulLife",          sql.Int,           usefulLife  ? parseInt(usefulLife, 10)  : null)
        .input("Remarks",             sql.NVarChar(sql.MAX), remarks || null)
        .input("PictureBase64",       sql.NVarChar(sql.MAX), pictureBase64 || null)
        .input("RepairType",          sql.NVarChar(50),  repairType || null)
        .input("CreatedBy",           sql.NVarChar(200), email)
        .input("GodownId",            sql.Int,           sourceGodownId)
        .input("SourceTagId",         sql.Int,           sourceTagIdVal)
        .input("FAItemCode",          sql.NVarChar(200), sourceCode)
        .query(`
          INSERT INTO dbo.FixedAssetRecord
            (DocNo, DocDate, CompanyId, ProjectId, FinYear,
             AssetName, AssetCategory, AssetCode, Brand, Model, SerialNumber,
             PurchaseDate, ActivationDate, PurchaseInvoiceRef, SupplierId, PurchaseCost, Quantity,
             Location, Department, Custodian, CustodianUserId,
             DepreciationSetupId, DepreciationType, DepreciationRate, UsefulLife,
             AssetStatus, Status, Remarks, PictureBase64, RepairType, CreatedBy, CreatedAt,
             GodownID, SourceTagId, FAItemCode)
          VALUES
            (@DocNo, @DocDate, @CompanyId, @ProjectId, @FinYear,
             @AssetName, @AssetCategory, @AssetCode, @Brand, @Model, @SerialNumber,
             @PurchaseDate, @ActivationDate, @PurchaseInvoiceRef, @SupplierId, @PurchaseCost, @Quantity,
             @Location, @Department, @Custodian, @CustodianUserId,
             @DepreciationSetupId, @DepreciationType, @DepreciationRate, @UsefulLife,
             'Active', 'Draft', @Remarks, @PictureBase64, @RepairType, @CreatedBy, SYSDATETIME(),
             @GodownId, @SourceTagId, @FAItemCode);
          SELECT SCOPE_IDENTITY() AS AssetId;
        `);

      const newId = insert.recordset[0]?.AssetId;
      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "FixedAssetRecord", newId);
      await bumpCacheVersion("fixed-assets");
      await bumpCacheVersion("fixed-asset-tagging");
      res.json({ assetId: newId, docNo, assetCode });
    } catch (e) { await tx.rollback(); throw e; }
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

    // A batch row (no AssetCode) is FA Inventory bookkeeping, not a Fixed
    // Asset — it must never be editable through this endpoint.
    const guard = await pool.request().input("AssetId", sql.Int, id).query(
      `SELECT AssetCode FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId`,
    );
    if (!guard.recordset.length) return res.status(404).json({ error: "Not found" });
    if (!guard.recordset[0].AssetCode) return res.status(404).json({ error: "Not found" });

    const {
      docDate, companyId, projectId, finYear,
      assetName, assetCategory, brand, model, serialNumber,
      purchaseDate, activationDate, purchaseInvoiceRef, supplierId, purchaseCost, quantity,
      location, department, custodianUserId,
      depreciationSetupId, depreciationType, depreciationRate, usefulLife,
      assetStatus, sellingPrice, saleDate, buyerName, saleRemarks,
      remarks, status, pictureBase64, repairType,
    } = req.body;

    const custodianUserIdVal = custodianUserId ? parseInt(custodianUserId, 10) : null;
    const custodianName = await resolveCustodianName(pool, custodianUserIdVal);

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
      .input("Custodian",          sql.NVarChar(200), custodianName)
      .input("CustodianUserId",    sql.Int,           custodianUserIdVal)
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
      .input("RepairType",         sql.NVarChar(50),  repairType || null)
      .input("PictureBase64",      sql.NVarChar(sql.MAX), pictureBase64 !== undefined ? (pictureBase64 || null) : null)
      .input("PictureProvided",    sql.Bit,           pictureBase64 !== undefined ? 1 : 0)
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
          CustodianUserId    = @CustodianUserId,
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
          RepairType         = @RepairType,
          PictureBase64      = CASE WHEN @PictureProvided = 1 THEN @PictureBase64 ELSE PictureBase64 END,
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

// ── DELETE /:id — soft-delete, and release any FA Item Code it consumed ──────
// An individual asset created by picking an unassigned FA Item Code
// (SourceTagId set) is the only thing standing between its FA Item Code and
// re-selectability — the code's dbo.FixedAssetTagging row is left exactly
// as-is (still Status='Tagged': it's still a real, physically-tagged unit,
// nothing about the tagging itself is undone). Soft-deleting the record is
// enough on its own: every "is this code available?" query (unassigned-codes,
// the create-time re-check, FA Inventory's Record column) is keyed off
// `NOT EXISTS a non-Deleted FixedAssetRecord with this SourceTagId`, so the
// same code reappears immediately and can be picked again for a new record —
// no new code is minted, and Godown-wise Stock's untagged count is untouched
// since the unit never stopped being tagged.
router.delete("/:id", requirePageRight("fixed-asset-record", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const assetRes = await tx.request().input("AssetId", sql.Int, id).query(`
        SELECT AssetId, Status, AssetCode
        FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
        WHERE AssetId = @AssetId
      `);
      const asset = assetRes.recordset[0];
      if (!asset) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
      // A batch row (no AssetCode) is FA Inventory bookkeeping, not a Fixed
      // Asset — this endpoint only deletes real records; use the "Delete &
      // Reverse GRN" reversal flow (or Inventory Import's own reverse) for
      // batches instead.
      if (!asset.AssetCode) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
      if (asset.Status === "Deleted") { await tx.rollback(); return res.json({ ok: true }); }

      // A batch record (auto-allocated from a GRN, or manually entered) that
      // still has live tagged units against it can't be deleted outright —
      // that would corrupt the Tagging Transaction History for every FA Item
      // Code cut from it. Those tags must be released individually first.
      const liveTagsRes = await tx.request().input("AssetId", sql.Int, id).query(`
        SELECT COUNT(*) AS Cnt FROM dbo.FixedAssetTagging WHERE AssetId = @AssetId AND Status = 'Tagged'
      `);
      if (liveTagsRes.recordset[0].Cnt > 0) {
        await tx.rollback();
        return res.status(400).json({ error: "This asset still has tagged units in Tagging Transaction History — release those tags first." });
      }

      await tx.request()
        .input("AssetId",   sql.Int,           id)
        .input("UpdatedBy", sql.NVarChar(200),  email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET Status = 'Deleted', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE AssetId = @AssetId
        `);

      await tx.commit();
      await bumpCacheVersion("fixed-assets");
      await bumpCacheVersion("fixed-asset-tagging");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssets] DELETE /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/can-reverse — dependency check for "Delete & Reverse GRN" ───────
// Separate, more destructive action from the plain DELETE above — see
// services/fixedAssetReversal.js for exactly what it does and why.
router.get("/:id/can-reverse", requirePageRight("fixed-asset-record", "reverse"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const plan = await buildReversalPlan(pool, id);
    res.json(plan);
  } catch (err) {
    console.error("[fixedAssets] GET /:id/can-reverse:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/reverse — hard-reverses the GRN/Import + tagging + records ─────
router.post("/:id/reverse", requirePageRight("fixed-asset-record", "reverse"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const result = await executeReversal(pool, id, email);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[fixedAssets] POST /:id/reverse:", err.message);
    const status = err.code === "BLOCKED" || err.code === "NOT_SOURCE_LINKED" || err.code === "ALREADY_DELETED" ? 409 : 500;
    res.status(status).json({ error: err.message, reason: err.reason || err.code });
  }
});

module.exports = router;
