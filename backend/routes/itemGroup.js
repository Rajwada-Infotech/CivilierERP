const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

router.get("/", cache("item-groups", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        M_Id, M_Name, M_Description, M_Type,
        M_BelongsTo, M_Group, M_IdentityCode,
        M_HSN, M_CGST, M_IGST, M_SGST,
        M_CreatedBy, M_CreatedDate, M_ApprovedBy,
        ApprovedAt, Parent_Id, M_code
      FROM dbo.Item_Master_Group
      WHERE Parent_Id IS NULL
      ORDER BY M_Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /item-groups ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .query(`
        SELECT
          M_Id, M_Name, M_Description, M_Type,
          M_BelongsTo, M_Group, M_IdentityCode,
          M_HSN, M_CGST, M_IGST, M_SGST,
          M_CreatedBy, M_CreatedDate, M_ApprovedBy,
          ApprovedAt, Parent_Id, M_code
        FROM dbo.Item_Master_Group
        WHERE M_Id = @M_Id AND Parent_Id IS NULL
      `);
    if (!result.recordset.length) {
      return res.status(404).json({ error: "Item group not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("GET /:id /item-groups ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("item-group", "create"), async (req, res) => {
  const {
    M_Name, M_Description, M_code,
    M_Type, M_BelongsTo, M_Group,
    M_IdentityCode, M_HSN, M_CGST, M_IGST, M_SGST,
    M_ApprovedBy, // ✅ fixed - was missing before
  } = req.body;

  const createdBy = req.user?.userId || null; // ✅ from JWT

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("M_Name",         sql.NVarChar(200),    M_Name)
      .input("M_Description",  sql.NVarChar(500),    M_Description || null)
      .input("M_code",         sql.NVarChar(20),     M_code        || null)
      .input("M_Type",         sql.NVarChar(50),     M_Type        || null)
      .input("M_BelongsTo",    sql.UniqueIdentifier, M_BelongsTo   || null)
      .input("M_Group",        sql.NVarChar(200),    M_Group       || null)
      .input("M_IdentityCode", sql.Bit,              M_IdentityCode ? 1 : 0)
      .input("M_HSN",          sql.NVarChar(20),     M_HSN         || null)
      .input("M_CGST",         sql.Decimal(5, 2),    M_CGST        != null ? M_CGST : null)
      .input("M_IGST",         sql.Decimal(5, 2),    M_IGST        != null ? M_IGST : null)
      .input("M_SGST",         sql.Decimal(5, 2),    M_SGST        != null ? M_SGST : null)
      .input("M_CreatedBy",    sql.Int,              createdBy)          // ✅ from JWT
      .input("M_CreatedDate",  sql.DateTime2(3),     new Date())
      .input("M_ApprovedBy",   sql.Int,              M_ApprovedBy  || null)
      .input("ApprovedAt",     sql.DateTime2(3),     M_ApprovedBy ? new Date() : null) // ✅ set only if approved
      .query(`
        INSERT INTO dbo.Item_Master_Group (
          M_Id, M_Name, M_Description, M_code, M_Type,
          M_BelongsTo, M_Group, M_IdentityCode,
          M_HSN, M_CGST, M_IGST, M_SGST,
          M_CreatedBy, M_CreatedDate,
          M_ApprovedBy, ApprovedAt,
          Parent_Id
        )
        OUTPUT INSERTED.M_Id
        VALUES (
          NEWID(),
          @M_Name, @M_Description, @M_code, @M_Type,
          @M_BelongsTo, @M_Group, @M_IdentityCode,
          @M_HSN, @M_CGST, @M_IGST, @M_SGST,
          @M_CreatedBy, @M_CreatedDate,
          @M_ApprovedBy, @ApprovedAt,
          NULL
        )
      `);
    await bumpCacheVersion("item-groups");
    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");
    res.status(201).json({
      message: "Item group added successfully",
      M_Id: result.recordset[0].M_Id,
    });
  } catch (err) {
    console.error("POST /item-groups ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("item-group", "edit"), async (req, res) => {
  const { id } = req.params;
  const {
    M_Name, M_Description, M_code,
    M_Type, M_BelongsTo, M_Group,
    M_IdentityCode, M_HSN, M_CGST, M_IGST, M_SGST,
    M_ApprovedBy,
  } = req.body;

  const updatedBy = req.user?.userId || null; // ✅ from JWT

  if (!M_Name) return res.status(400).json({ error: "M_Name is required" });

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("M_Id",           sql.UniqueIdentifier, id)
      .input("M_Name",         sql.NVarChar(200),    M_Name)
      .input("M_Description",  sql.NVarChar(500),    M_Description || null)
      .input("M_code",         sql.NVarChar(20),     M_code        || null)
      .input("M_Type",         sql.NVarChar(50),     M_Type        || null)
      .input("M_BelongsTo",    sql.UniqueIdentifier, M_BelongsTo   || null)
      .input("M_Group",        sql.NVarChar(200),    M_Group       || null)
      .input("M_IdentityCode", sql.Bit,              M_IdentityCode ? 1 : 0)
      .input("M_HSN",          sql.NVarChar(20),     M_HSN         || null)
      .input("M_CGST",         sql.Decimal(5, 2),    M_CGST        != null ? M_CGST : null)
      .input("M_IGST",         sql.Decimal(5, 2),    M_IGST        != null ? M_IGST : null)
      .input("M_SGST",         sql.Decimal(5, 2),    M_SGST        != null ? M_SGST : null)
      .input("M_UpdatedBy",    sql.Int,              updatedBy)          // ✅ from JWT
      .input("UpdatedAt",      sql.DateTime2(3),     new Date())         // ✅ always set on update
      .input("M_ApprovedBy",   sql.Int,              M_ApprovedBy  || null)
      .input("ApprovedAt",     sql.DateTime2(3),     M_ApprovedBy ? new Date() : null) // ✅ set only if approved
      .query(`
        UPDATE dbo.Item_Master_Group SET
          M_Name         = @M_Name,
          M_Description  = @M_Description,
          M_code         = @M_code,
          M_Type         = @M_Type,
          M_BelongsTo    = @M_BelongsTo,
          M_Group        = @M_Group,
          M_IdentityCode = @M_IdentityCode,
          M_HSN          = @M_HSN,
          M_CGST         = @M_CGST,
          M_IGST         = @M_IGST,
          M_SGST         = @M_SGST,
          M_UpdatedBy    = @M_UpdatedBy,
          UpdatedAt      = @UpdatedAt,
          M_ApprovedBy   = @M_ApprovedBy,
          ApprovedAt     = @ApprovedAt
        WHERE M_Id = @M_Id AND Parent_Id IS NULL
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Item group not found" });
    }
    await bumpCacheVersion("item-groups");
    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "Item group updated successfully" });
  } catch (err) {
    console.error("PUT /item-groups ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("item-group", "delete"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const childCheck = await pool
      .request()
      .input("Parent_Id", sql.UniqueIdentifier, id)
      .query("SELECT COUNT(*) AS cnt FROM dbo.Item_Master_Group WHERE Parent_Id = @Parent_Id");
    if (childCheck.recordset[0].cnt > 0) {
      return res.status(409).json({
        error: "Cannot delete group — it still has items. Remove all items first.",
      });
    }
    const result = await pool
      .request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Item_Master_Group WHERE M_Id = @M_Id AND Parent_Id IS NULL");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Item group not found" });
    }
    await bumpCacheVersion("item-groups");
    await bumpCacheVersion("item-master");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "Item group deleted successfully" });
  } catch (err) {
    console.error("DELETE /item-groups ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



