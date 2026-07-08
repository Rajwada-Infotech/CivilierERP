const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

bumpCacheVersion("extra-charge-master").catch(() => {});

// GET all extra charge types
router.get("/", cache("extra-charge-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, ChargeName, DefaultAmount, GstRate, IsActive, CreatedAt, UpdatedAt
      FROM dbo.ExtraChargeMaster
      ORDER BY ChargeName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[extra-charge-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add charge type
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ChargeName, DefaultAmount, GstRate, IsActive } = req.body;
  if (!ChargeName?.trim()) return res.status(400).json({ error: "ChargeName is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name",      sql.NVarChar(200), ChargeName.trim())
      .input("Default",   sql.Decimal(18, 2), DefaultAmount != null && DefaultAmount !== "" ? parseFloat(DefaultAmount) : null)
      .input("Gst",       sql.Decimal(5, 2), GstRate != null ? parseFloat(GstRate) : 18)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.ExtraChargeMaster (ChargeName, DefaultAmount, GstRate, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @Default, @Gst, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    await bumpCacheVersion("extra-charge-master");
    res.json({ message: "Extra charge type added successfully" });
  } catch (err) {
    console.error("[extra-charge-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update charge type
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ChargeName, DefaultAmount, GstRate, IsActive } = req.body;
  if (!ChargeName?.trim()) return res.status(400).json({ error: "ChargeName is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",       sql.Int, parseInt(id))
      .input("Name",     sql.NVarChar(200), ChargeName.trim())
      .input("Default",  sql.Decimal(18, 2), DefaultAmount != null && DefaultAmount !== "" ? parseFloat(DefaultAmount) : null)
      .input("Gst",      sql.Decimal(5, 2), GstRate != null ? parseFloat(GstRate) : 18)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy",sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ExtraChargeMaster SET
          ChargeName = @Name, DefaultAmount = @Default, GstRate = @Gst, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("extra-charge-master");
    res.json({ message: "Extra charge type updated successfully" });
  } catch (err) {
    console.error("[extra-charge-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const inUse = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmExtraCharge WHERE ExtraChargeMasterId = @id");
    if (inUse.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This charge type has already been used on bookings and cannot be deleted. Deactivate it instead." });
    }
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT ChargeName FROM dbo.ExtraChargeMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Charge type not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.ExtraChargeMaster WHERE Id = @Id");
    await bumpCacheVersion("extra-charge-master");
    res.json({ message: `Charge type "${existing.recordset[0].ChargeName}" deleted successfully` });
  } catch (err) {
    console.error("[extra-charge-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
