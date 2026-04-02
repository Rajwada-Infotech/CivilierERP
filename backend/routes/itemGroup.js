const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all item groups
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      "SELECT M_Id, M_Name, M_Description, M_Type, M_BelongsTo, M_Group, M_IdentityCode, M_HSN, M_CGST, M_IGST, M_SGST, M_CreatedBy, M_CreatedDate, M_ApprovedBy, Parent_Id FROM dbo.Item_Master_Group"
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD item group
router.post("/", async (req, res) => {
  console.log("POST BODY:", req.body);
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
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input("M_Name", sql.NVarChar, M_Name)
      .input("M_Description", sql.NVarChar, M_Description || null)
      .input("M_Type", sql.NVarChar, M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null)
      .input("M_Group", sql.NVarChar, M_Group || null)
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar, M_HSN || null)
      .input("M_CGST", sql.Decimal, M_CGST || null)
      .input("M_IGST", sql.Decimal, M_IGST || null)
      .input("M_SGST", sql.Decimal, M_SGST || null)
      .input("M_CreatedDate", sql.DateTime2, new Date())
      .query(`
        INSERT INTO dbo.Item_Master_Group (
          M_Id, M_Name, M_Description, M_Type, M_BelongsTo, M_Group,
          M_IdentityCode, M_HSN, M_CGST, M_IGST, M_SGST,
          M_CreatedBy, M_CreatedDate, Parent_Id
        ) VALUES (
          NEWID(), @M_Name, @M_Description, @M_Type, @M_BelongsTo, @M_Group,
          @M_IdentityCode, @M_HSN, @M_CGST, @M_IGST, @M_SGST,
          NEWID(), @M_CreatedDate, NULL
        )
      `);
    res.json({ message: "Item group added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE item group
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
    Parent_Id,
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .input("M_Name", sql.NVarChar, M_Name)
      .input("M_Description", sql.NVarChar, M_Description || null)
      .input("M_Type", sql.NVarChar, M_Type || null)
      .input("M_BelongsTo", sql.UniqueIdentifier, M_BelongsTo || null)
      .input("M_Group", sql.NVarChar, M_Group || null)
      .input("M_IdentityCode", sql.Bit, M_IdentityCode ? 1 : 0)
      .input("M_HSN", sql.NVarChar, M_HSN || null)
      .input("M_CGST", sql.Decimal, M_CGST || null)
      .input("M_IGST", sql.Decimal, M_IGST || null)
      .input("M_SGST", sql.Decimal, M_SGST || null)
      .input("Parent_Id", sql.UniqueIdentifier, Parent_Id || null)
      .query(`
        UPDATE dbo.Item_Master_Group SET
          M_Name        = @M_Name,
          M_Description = @M_Description,
          M_Type        = @M_Type,
          M_BelongsTo   = @M_BelongsTo,
          M_Group       = @M_Group,
          M_IdentityCode= @M_IdentityCode,
          M_HSN         = @M_HSN,
          M_CGST        = @M_CGST,
          M_IGST        = @M_IGST,
          M_SGST        = @M_SGST,
          Parent_Id     = @Parent_Id
        WHERE M_Id = @M_Id
      `);
    res.json({ message: "Item group updated successfully" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE item group
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool.request()
      .input("M_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Item_Master_Group WHERE M_Id = @M_Id");
    res.json({ message: "Item group deleted successfully" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
