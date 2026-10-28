const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");

bumpCacheVersion("extra-charge-master").catch(() => {});

// Extra Charge Master's own rights (admins always pass). Writes used to be admin-only while the page offered them to
// anyone holding these rights, so everyone else got "Forbidden".
const PAGE = "followup-extra-charge-master";

// GET all extra charge types
router.get("/", cache("extra-charge-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT m.Id, m.ChargeName, m.DefaultAmount, m.GstRate, m.IsActive, m.CreatedAt, m.UpdatedAt,
        -- How many booking charges use it: those can't delete it (deactivate instead), so the page says so up front.
        (SELECT COUNT(*) FROM dbo.CrmExtraCharge c WHERE c.ExtraChargeMasterId = m.Id) AS UseCount
      FROM dbo.ExtraChargeMaster m
      ORDER BY m.ChargeName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[extra-charge-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add charge type
router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  const { ChargeName, DefaultAmount, GstRate, IsActive } = req.body;
  if (!ChargeName?.trim()) return res.status(400).json({ error: "ChargeName is required" });
  if (GstRate != null && GstRate !== "" && !(Number(GstRate) >= 0 && Number(GstRate) <= 100)) return res.status(400).json({ error: "GST rate must be between 0 and 100" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name",      sql.NVarChar(200), ChargeName.trim())
      .input("Default",   sql.Decimal(18, 2), DefaultAmount != null && DefaultAmount !== "" ? parseFloat(DefaultAmount) : null)
      .input("Gst",       sql.Decimal(5, 2), GstRate != null && GstRate !== "" ? parseFloat(GstRate) : 18)
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
router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { ChargeName, DefaultAmount, GstRate, IsActive } = req.body;
  if (!ChargeName?.trim()) return res.status(400).json({ error: "ChargeName is required" });
  if (GstRate != null && GstRate !== "" && !(Number(GstRate) >= 0 && Number(GstRate) <= 100)) return res.status(400).json({ error: "GST rate must be between 0 and 100" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const upd = await pool
      .request()
      .input("Id",       sql.Int, id)
      .input("Name",     sql.NVarChar(200), ChargeName.trim())
      .input("Default",  sql.Decimal(18, 2), DefaultAmount != null && DefaultAmount !== "" ? parseFloat(DefaultAmount) : null)
      .input("Gst",      sql.Decimal(5, 2), GstRate != null && GstRate !== "" ? parseFloat(GstRate) : 18)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy",sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ExtraChargeMaster SET
          ChargeName = @Name, DefaultAmount = @Default, GstRate = @Gst, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    // A missing charge type used to answer "updated successfully".
    if (!upd.rowsAffected[0]) return res.status(404).json({ error: "Charge type not found" });
    await bumpCacheVersion("extra-charge-master");
    res.json({ message: "Extra charge type updated successfully" });
  } catch (err) {
    console.error("[extra-charge-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
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
