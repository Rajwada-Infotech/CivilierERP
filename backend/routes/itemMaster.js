const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// Item Master uses the same dbo.Item_Master_Group table.
// Items are records that have a Parent_Id (they belong to a group).
// Groups are records where Parent_Id IS NULL (top-level).

// ─── GET all items (leaf records with a Parent_Id) ───────────────────────────
router.get("/", cache("item-master", 300), async (req, res) => {
  try {
    const pool = getPool();

    // Check whether M_UOM column exists (migration 005 may not have run yet)
    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    // Include a row if it has a parent group (proper item) OR is flagged as
    // an item via M_IdentityCode=1 (covers items saved without a Parent_Id).
    // Pure group-header rows (Parent_Id IS NULL AND M_IdentityCode=0) are excluded.
    const result = await pool.request().query(`
      SELECT
        item.M_Id,
        item.M_Name,
        item.M_Description,
        item.M_Type,
        item.M_BelongsTo,
        item.M_Group,
        item.M_IdentityCode,
        item.M_HSN,
        item.M_CGST,
        item.M_IGST,
        item.M_SGST,
        ${hasUOM ? "item.M_UOM" : "NULL AS M_UOM"},
        item.M_CreatedBy,
        item.M_CreatedDate,
        item.M_ApprovedBy,
        item.Parent_Id,
        grp.M_Name AS ParentGroupName
      FROM dbo.Item_Master_Group item
      LEFT JOIN dbo.Item_Master_Group grp ON grp.M_Id = item.Parent_Id
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

// ─── GET items by group (Parent_Id) ─────────────────────────────────────────
router.get("/by-group/:groupId", async (req, res) => {
  const { groupId } = req.params;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Parent_Id", sql.UniqueIdentifier, groupId).query(`
        SELECT
          M_Id, M_Name, M_Description, M_Type,
          M_BelongsTo, M_Group, M_IdentityCode,
          M_HSN, M_CGST, M_IGST, M_SGST,
          M_CreatedBy, M_CreatedDate, M_ApprovedBy, Parent_Id
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

// ─── GET single item by ID ───────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;
    const result = await pool.request().input("M_Id", sql.UniqueIdentifier, id)
      .query(`
        SELECT
          item.M_Id,
          item.M_Name,
          item.M_Description,
          item.M_Type,
          item.M_BelongsTo,
          item.M_Group,
          item.M_IdentityCode,
          item.M_HSN,
          item.M_CGST,
          item.M_IGST,
          item.M_SGST,
          ${hasUOM ? "item.M_UOM" : "NULL AS M_UOM"},
          item.M_CreatedBy,
          item.M_CreatedDate,
          item.M_ApprovedBy,
          item.Parent_Id,
          grp.M_Name AS ParentGroupName
        FROM dbo.Item_Master_Group item
        LEFT JOIN dbo.Item_Master_Group grp ON grp.M_Id = item.Parent_Id
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

// ─── POST create item ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    M_Name,
    M_Description,
    M_Type,
    M_BelongsTo, // FK uniqueidentifier — optional secondary reference
    M_Group,
    M_IdentityCode,
    M_HSN, // nvarchar(20)
    M_CGST, // decimal(5,2)
    M_IGST, // decimal(5,2)
    M_SGST, // decimal(5,2)
    M_UOM, // nvarchar(20) — UOM code from UOMMaster
    Parent_Id, // FK uniqueidentifier — REQUIRED for items (links to group)
  } = req.body;

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });
  if (!Parent_Id)
    return res
      .status(400)
      .json({ error: "Parent_Id (group) is required for items" });

  try {
    const pool = getPool();

    // Check if M_UOM column exists (migration 005 may not have run)
    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    const req2 = pool
      .request()
      .input("M_Name", sql.NVarChar(200), M_Name)
      .input("M_Description", sql.NVarChar(500), M_Description || null)
      .input("M_Type", sql.NVarChar(50), M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null)
      .input("M_Group", sql.NVarChar(200), M_Group || null)
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar(20), M_HSN || null)
      .input("M_CGST", sql.Decimal(5, 2), M_CGST ?? null)
      .input("M_IGST", sql.Decimal(5, 2), M_IGST ?? null)
      .input("M_SGST", sql.Decimal(5, 2), M_SGST ?? null)
      .input("M_CreatedDate", sql.DateTime2(3), new Date())
      .input("Parent_Id", sql.UniqueIdentifier, Parent_Id);

    if (hasUOM) req2.input("M_UOM", sql.NVarChar(20), M_UOM || null);

    const result = await req2.query(`
        INSERT INTO dbo.Item_Master_Group (
          M_Id,
          M_Name, M_Description, M_Type,
          M_BelongsTo, M_Group, M_IdentityCode,
          M_HSN, M_CGST, M_IGST, M_SGST,
          ${hasUOM ? "M_UOM," : ""}
          M_CreatedBy, M_CreatedDate,
          M_ApprovedBy, Parent_Id
        )
        OUTPUT INSERTED.M_Id
        VALUES (
          NEWID(),
          @M_Name, @M_Description, @M_Type,
          @M_BelongsTo, @M_Group, @M_IdentityCode,
          @M_HSN, @M_CGST, @M_IGST, @M_SGST,
          ${hasUOM ? "@M_UOM," : ""}
          NEWID(), @M_CreatedDate,
          NULL, @Parent_Id
        )
      `);
    res.status(201).json({
      message: "Item created successfully",
      M_Id: result.recordset[0].M_Id,
    });
  } catch (err) {
    console.error("ITEM_MASTER INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT update item ─────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    M_Name,
    M_Description,
    M_Type,
    M_BelongsTo,
    M_Group,
    M_IdentityCode,
    M_HSN,
    M_CGST,
    M_IGST,
    M_SGST,
    M_UOM, // nvarchar(20) — UOM code from UOMMaster
    M_ApprovedBy, // uniqueidentifier — set when approved
    Parent_Id,
  } = req.body;

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });

  try {
    const pool = getPool();

    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    const req2 = pool
      .request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .input("M_Name", sql.NVarChar(200), M_Name)
      .input("M_Description", sql.NVarChar(500), M_Description || null)
      .input("M_Type", sql.NVarChar(50), M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null)
      .input("M_Group", sql.NVarChar(200), M_Group || null)
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar(20), M_HSN || null)
      .input("M_CGST", sql.Decimal(5, 2), M_CGST ?? null)
      .input("M_IGST", sql.Decimal(5, 2), M_IGST ?? null)
      .input("M_SGST", sql.Decimal(5, 2), M_SGST ?? null)
      .input("M_ApprovedBy", sql.UniqueIdentifier, M_ApprovedBy || null)
      .input("Parent_Id", sql.UniqueIdentifier, Parent_Id || null);

    if (hasUOM) req2.input("M_UOM", sql.NVarChar(20), M_UOM || null);

    const result = await req2.query(`
        UPDATE dbo.Item_Master_Group SET
          M_Name         = @M_Name,
          M_Description  = @M_Description,
          M_Type         = @M_Type,
          M_BelongsTo    = @M_BelongsTo,
          M_Group        = @M_Group,
          M_IdentityCode = @M_IdentityCode,
          M_HSN          = @M_HSN,
          M_CGST         = @M_CGST,
          M_IGST         = @M_IGST,
          M_SGST         = @M_SGST,
          ${hasUOM ? "M_UOM = @M_UOM," : ""}
          M_ApprovedBy   = @M_ApprovedBy,
          Parent_Id      = @Parent_Id
        WHERE M_Id = @M_Id
      `);
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Item not found" });
    await redisDelPattern("cache:item-master:*");

    res.json({ message: "Item updated successfully" });
  } catch (err) {
    console.error("ITEM_MASTER UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE item ─────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Item_Master_Group WHERE M_Id = @M_Id");
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Item not found" });
    await redisDelPattern("cache:item-master:*");

    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    console.error("ITEM_MASTER DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
