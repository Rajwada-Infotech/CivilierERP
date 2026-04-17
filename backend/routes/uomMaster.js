const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all UOM
router.get("/", cache("uom-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      `SELECT Id, UOMName, UOMCode, CreatedAt, Symbol, UOMType,
              DecimalPlaces, ConversionFactor, IsBaseUnit, Remarks, IsActive
       FROM dbo.UOMMaster`
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ADD UOM
router.post("/", async (req, res) => {
  console.log("POST BODY:", req.body);
  const {
    UOMName,
    UOMCode,
    Symbol,
    UOMType,
    DecimalPlaces,
    ConversionFactor,
    IsBaseUnit,
    Remarks,
    IsActive,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("UOMName", sql.NVarChar(50), UOMName)
      .input("UOMCode", sql.NVarChar(20), UOMCode)
      .input("Symbol", sql.NVarChar(20), Symbol || null)
      .input("UOMType", sql.NVarChar(20), UOMType || null)
      .input("DecimalPlaces", sql.Int, DecimalPlaces ?? 0)
      .input("ConversionFactor", sql.Decimal(18, 6), ConversionFactor ?? null)
      .input("IsBaseUnit", sql.Bit, IsBaseUnit ? 1 : 0)
      .input("Remarks", sql.NVarChar(250), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.UOMMaster
          (UOMName, UOMCode, Symbol, UOMType, DecimalPlaces,
           ConversionFactor, IsBaseUnit, Remarks, IsActive, CreatedAt)
        VALUES
          (@UOMName, @UOMCode, @Symbol, @UOMType, @DecimalPlaces,
           @ConversionFactor, @IsBaseUnit, @Remarks, @IsActive, @CreatedAt)
      `);
    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");

    res.json({ message: "UOM added successfully" });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE UOM
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    UOMName,
    UOMCode,
    Symbol,
    UOMType,
    DecimalPlaces,
    ConversionFactor,
    IsBaseUnit,
    Remarks,
    IsActive,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("UOMName", sql.NVarChar(50), UOMName)
      .input("UOMCode", sql.NVarChar(20), UOMCode)
      .input("Symbol", sql.NVarChar(20), Symbol || null)
      .input("UOMType", sql.NVarChar(20), UOMType || null)
      .input("DecimalPlaces", sql.Int, DecimalPlaces ?? 0)
      .input("ConversionFactor", sql.Decimal(18, 6), ConversionFactor ?? null)
      .input("IsBaseUnit", sql.Bit, IsBaseUnit ? 1 : 0)
      .input("Remarks", sql.NVarChar(250), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .query(`
        UPDATE dbo.UOMMaster SET
          UOMName          = @UOMName,
          UOMCode          = @UOMCode,
          Symbol           = @Symbol,
          UOMType          = @UOMType,
          DecimalPlaces    = @DecimalPlaces,
          ConversionFactor = @ConversionFactor,
          IsBaseUnit       = @IsBaseUnit,
          Remarks          = @Remarks,
          IsActive         = @IsActive
        WHERE Id = @Id
      `);
    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");

    res.json({ message: "UOM updated successfully" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE UOM
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .query("DELETE FROM dbo.UOMMaster WHERE Id = @Id");
    await bumpCacheVersion("uom-master");
    await bumpCacheVersion("stock-ledger");

    res.json({ message: "UOM deleted successfully" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
