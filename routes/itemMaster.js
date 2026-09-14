const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// Item_Master_Group has grown several optional columns via migration over
// time (M_UOM, default_supplier_id, and now M_GLHeadId/M_CostCenterId) — this
// probes all of them in one round trip so every handler below can safely
// interpolate them into its SQL only when the migration has actually run.
async function getItemOptionalCols(pool) {
  const result = await pool.request().query(`
    SELECT name FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group')
      AND name IN (N'M_UOM', N'default_supplier_id', N'M_GLHeadId', N'M_CostCenterId')
  `);
  const names = new Set(result.recordset.map((r) => r.name));
  return {
    hasUOM: names.has("M_UOM"),
    hasDS: names.has("default_supplier_id"),
    hasGL: names.has("M_GLHeadId"),
    hasCC: names.has("M_CostCenterId"),
  };
}

// ─── GET all items ────────────────────────────────────────────────────────────
router.get("/", cache("item-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const { hasUOM, hasDS, hasGL, hasCC } = await getItemOptionalCols(pool);

    const result = await pool.request().query(`
      SELECT
        item.M_Id,
        item.M_Name,
        item.M_Description,
        item.M_Type,
        item.M_BelongsTo,
        item.M_Group,
        item.M_code,
        item.M_IdentityCode,
        item.M_HSN,
        item.M_CGST,
        item.M_IGST,
        item.M_SGST,
        ${hasUOM ? "item.M_UOM," : "NULL AS M_UOM,"}
        item.M_CreatedBy,
        item.M_CreatedDate,
        item.M_UpdatedBy,
        item.UpdatedAt,
        item.M_ApprovedBy,
        item.ApprovedAt,
        item.Parent_Id,
        grp.M_Name AS ParentGroupName,
        ${hasDS ? "item.default_supplier_id," : "NULL AS default_supplier_id,"}
        ${hasDS ? "supp.LHeadName AS DefaultSupplierName," : "NULL AS DefaultSupplierName,"}
        ${hasGL ? "item.M_GLHeadId," : "NULL AS M_GLHeadId,"}
        ${hasGL ? "gl.LHeadName AS GLHeadName," : "NULL AS GLHeadName,"}
        ${hasCC ? "item.M_CostCenterId," : "NULL AS M_CostCenterId,"}
        ${hasCC ? "cc.Name AS CostCenterName" : "NULL AS CostCenterName"}
      FROM dbo.Item_Master_Group item
      LEFT JOIN dbo.Item_Master_Group grp ON grp.M_Id = item.Parent_Id
      ${hasDS ? "LEFT JOIN dbo.AccountHeadMaster supp ON supp.LHeadId = item.default_supplier_id" : ""}
      ${hasGL ? "LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = item.M_GLHeadId" : ""}
      ${hasCC ? "LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = item.M_CostCenterId" : ""}
      WHERE item.Parent_Id IS NOT NULL
         OR item.M_IdentityCode = 1
      ORDER BY grp.M_Name, item.M_Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ITEM_MASTER GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET items by group ───────────────────────────────────────────────────────
router.get("/by-group/:groupId", async (req, res) => {
  const { groupId } = req.params;
  try {
    const pool = getPool();
    const { hasGL, hasCC } = await getItemOptionalCols(pool);
    const result = await pool
      .request()
      .input("Parent_Id", sql.UniqueIdentifier, groupId).query(`
        SELECT
          M_Id, M_Name, M_Description, M_Type,
          M_BelongsTo, M_Group, M_code,
          M_IdentityCode,
          M_HSN, M_CGST, M_IGST, M_SGST,
          M_UOM, M_CreatedBy, M_CreatedDate,
          M_UpdatedBy, UpdatedAt, M_ApprovedBy, ApprovedAt, Parent_Id
          ${hasGL ? ", M_GLHeadId" : ""}
          ${hasCC ? ", M_CostCenterId" : ""}
        FROM dbo.Item_Master_Group
        WHERE Parent_Id = @Parent_Id
        ORDER BY M_Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ITEM_MASTER BY_GROUP ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET single item by ID ────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const { hasUOM, hasGL, hasCC } = await getItemOptionalCols(pool);

    const result = await pool.request().input("M_Id", sql.UniqueIdentifier, id)
      .query(`
        SELECT
          item.M_Id,
          item.M_Name,
          item.M_Description,
          item.M_Type,
          item.M_BelongsTo,
          item.M_Group,
          item.M_code,
          item.M_IdentityCode,
          item.M_HSN,
          item.M_CGST,
          item.M_IGST,
          item.M_SGST,
          ${hasUOM ? "item.M_UOM," : "NULL AS M_UOM,"}
          item.M_CreatedBy,
          item.M_CreatedDate,
          item.M_UpdatedBy,
          item.UpdatedAt,
          item.M_ApprovedBy,
          item.ApprovedAt,
          item.Parent_Id,
          grp.M_Name AS ParentGroupName,
          item.default_supplier_id,
          supp.LHeadName AS DefaultSupplierName,
          ${hasGL ? "item.M_GLHeadId," : "NULL AS M_GLHeadId,"}
          ${hasGL ? "gl.LHeadName AS GLHeadName," : "NULL AS GLHeadName,"}
          ${hasCC ? "item.M_CostCenterId," : "NULL AS M_CostCenterId,"}
          ${hasCC ? "cc.Name AS CostCenterName" : "NULL AS CostCenterName"}
        FROM dbo.Item_Master_Group item
        LEFT JOIN dbo.Item_Master_Group grp ON grp.M_Id = item.Parent_Id
        LEFT JOIN dbo.AccountHeadMaster supp ON supp.LHeadId = item.default_supplier_id
        ${hasGL ? "LEFT JOIN dbo.AccountHeadMaster gl ON gl.LHeadId = item.M_GLHeadId" : ""}
        ${hasCC ? "LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = item.M_CostCenterId" : ""}
        WHERE item.M_Id = @M_Id
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Item not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("ITEM_MASTER GET_ONE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST create item ─────────────────────────────────────────────────────────
router.post("/", requirePageRight("item-master", "create"), async (req, res) => {
  const {
    M_Name,
    M_Description,
    M_Type,
    M_BelongsTo, // ← group M_Id (UUID)
    M_Group, // ← group Name (string)
    M_code, // ← short code
    M_IdentityCode,
    M_HSN,
    M_CGST,
    M_IGST,
    M_SGST,
    M_UOM,
    Parent_Id, // ← group M_Id (UUID)
    default_supplier_id,
    M_GLHeadId,
    M_CostCenterId,
  } = req.body;

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });
  if (!Parent_Id)
    return res
      .status(400)
      .json({ error: "Parent_Id (group) is required for items" });

  try {
    const pool = getPool();
    const { hasUOM, hasDS, hasGL, hasCC } = await getItemOptionalCols(pool);

    const req2 = pool
      .request()
      .input("M_Name", sql.NVarChar(200), M_Name)
      .input("M_Description", sql.NVarChar(500), M_Description || null)
      .input("M_Type", sql.NVarChar(50), M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null) // ← UUID
      .input("M_Group", sql.NVarChar(200), M_Group || null) // ← Name
      .input("M_code", sql.NVarChar(20), M_code || null) // ← short code
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar(20), M_HSN || null)
      .input("M_CGST", sql.Decimal(5, 2), M_CGST ?? null)
      .input("M_IGST", sql.Decimal(5, 2), M_IGST ?? null)
      .input("M_SGST", sql.Decimal(5, 2), M_SGST ?? null)
      .input("M_CreatedBy", sql.Int, req.user?.userId || null)
      .input("M_CreatedDate", sql.DateTime2(3), new Date())
      .input("Parent_Id", sql.UniqueIdentifier, Parent_Id); // ← UUID

    if (hasUOM) req2.input("M_UOM", sql.NVarChar(20), M_UOM || null);
    if (hasDS)
      req2.input(
        "default_supplier_id",
        sql.Int,
        default_supplier_id ? parseInt(default_supplier_id) : null,
      );
    if (hasGL)
      req2.input("M_GLHeadId", sql.Int, M_GLHeadId ? parseInt(M_GLHeadId, 10) : null);
    if (hasCC)
      req2.input("M_CostCenterId", sql.Int, M_CostCenterId ? parseInt(M_CostCenterId, 10) : null);

    const result = await req2.query(`
      INSERT INTO dbo.Item_Master_Group (
        M_Id,
        M_Name, M_Description, M_Type,
        M_BelongsTo, M_Group, M_code,
        M_IdentityCode,
        M_HSN, M_CGST, M_IGST, M_SGST,
        ${hasUOM ? "M_UOM," : ""}
        ${hasDS ? "default_supplier_id," : ""}
        ${hasGL ? "M_GLHeadId," : ""}
        ${hasCC ? "M_CostCenterId," : ""}
        M_CreatedBy, M_CreatedDate, Parent_Id
      )
      OUTPUT INSERTED.M_Id
      VALUES (
        NEWID(),
        @M_Name, @M_Description, @M_Type,
        @M_BelongsTo, @M_Group, @M_code,
        @M_IdentityCode,
        @M_HSN, @M_CGST, @M_IGST, @M_SGST,
        ${hasUOM ? "@M_UOM," : ""}
        ${hasDS ? "@default_supplier_id," : ""}
        ${hasGL ? "@M_GLHeadId," : ""}
        ${hasCC ? "@M_CostCenterId," : ""}
        @M_CreatedBy, @M_CreatedDate, @Parent_Id
      )
    `);

    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");

    res.status(201).json({
      message: "Item created successfully",
      M_Id: result.recordset[0].M_Id,
    });
  } catch (err) {
    console.error("ITEM_MASTER INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT update item ──────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("item-master", "edit"), async (req, res) => {
  const { id } = req.params;
  const {
    M_Name,
    M_Description,
    M_Type,
    M_BelongsTo, // ← group M_Id (UUID)
    M_Group, // ← group Name (string)
    M_code, // ← short code
    M_IdentityCode,
    M_HSN,
    M_CGST,
    M_IGST,
    M_SGST,
    M_UOM,
    M_ApprovedBy,
    Parent_Id, // ← group M_Id (UUID)
    default_supplier_id,
    M_GLHeadId,
    M_CostCenterId,
  } = req.body;

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });

  try {
    const pool = getPool();
    const { hasUOM, hasDS, hasGL, hasCC } = await getItemOptionalCols(pool);

    const req2 = pool
      .request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .input("M_Name", sql.NVarChar(200), M_Name)
      .input("M_Description", sql.NVarChar(500), M_Description || null)
      .input("M_Type", sql.NVarChar(50), M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null) // ← UUID
      .input("M_Group", sql.NVarChar(200), M_Group || null) // ← Name
      .input("M_code", sql.NVarChar(20), M_code || null) // ← short code
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar(20), M_HSN || null)
      .input("M_CGST", sql.Decimal(5, 2), M_CGST ?? null)
      .input("M_IGST", sql.Decimal(5, 2), M_IGST ?? null)
      .input("M_SGST", sql.Decimal(5, 2), M_SGST ?? null)
      .input("M_UpdatedBy", sql.Int, req.user?.userId || null)
      .input("UpdatedAt", sql.DateTime2(3), new Date())
      .input("M_ApprovedBy", sql.Int, M_ApprovedBy || null)
      .input("Parent_Id", sql.UniqueIdentifier, Parent_Id || null); // ← UUID

    if (hasUOM) req2.input("M_UOM", sql.NVarChar(20), M_UOM || null);
    if (hasDS)
      req2.input(
        "default_supplier_id",
        sql.Int,
        default_supplier_id ? parseInt(default_supplier_id) : null,
      );
    if (hasGL)
      req2.input("M_GLHeadId", sql.Int, M_GLHeadId ? parseInt(M_GLHeadId, 10) : null);
    if (hasCC)
      req2.input("M_CostCenterId", sql.Int, M_CostCenterId ? parseInt(M_CostCenterId, 10) : null);

    const result = await req2.query(`
      UPDATE dbo.Item_Master_Group SET
        M_Name         = @M_Name,
        M_Description  = @M_Description,
        M_Type         = @M_Type,
        M_BelongsTo    = @M_BelongsTo,
        M_Group        = @M_Group,
        M_code         = @M_code,
        M_IdentityCode = @M_IdentityCode,
        M_HSN          = @M_HSN,
        M_CGST         = @M_CGST,
        M_IGST         = @M_IGST,
        M_SGST         = @M_SGST,
        ${hasUOM ? "M_UOM = @M_UOM," : ""}
        ${hasDS ? "default_supplier_id = @default_supplier_id," : ""}
        ${hasGL ? "M_GLHeadId = @M_GLHeadId," : ""}
        ${hasCC ? "M_CostCenterId = @M_CostCenterId," : ""}
        M_UpdatedBy    = @M_UpdatedBy,
        UpdatedAt      = @UpdatedAt,
        M_ApprovedBy   = @M_ApprovedBy,
        Parent_Id      = @Parent_Id
      WHERE M_Id = @M_Id
    `);

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Item not found" });

    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");

    res.json({ message: "Item updated successfully" });
  } catch (err) {
    console.error("ITEM_MASTER UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE item ──────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("item-master", "delete"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Item_Master_Group WHERE M_Id = @M_Id");
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Item not found" });

    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");

    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    console.error("ITEM_MASTER DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
