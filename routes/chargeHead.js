const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const SELECT_COLUMNS = `
  ch.Id, ch.Name, ch.Rate, ch.TaxPct, ch.HsnId, ch.Status,
  h.HCode, h.HDescription, h.HIsSAC,
  ch.CreatedBy, ch.CreatedAt, ch.UpdatedBy, ch.UpdatedAt
`;

router.get("/", requirePageRight("charge-head-master", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ${SELECT_COLUMNS}
      FROM dbo.MaintenanceChargeHead ch
      LEFT JOIN dbo.HSN h ON h.HId = ch.HsnId
      ORDER BY ch.Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("charge-head-master", "create"), async (req, res) => {
  const { Name, Rate, TaxPct, HsnId, Status } = req.body;
  const createdBy = req.user?.userId ?? req.user?.id ?? null;
  if (!createdBy) {
    return res.status(401).json({ error: "User context missing — please sign in again." });
  }
  if (!Name || !String(Name).trim()) {
    return res.status(400).json({ error: "Charge Head name is required" });
  }

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar, String(Name).trim())
      .input("Rate", sql.Decimal(18, 2), Rate || 0)
      .input("TaxPct", sql.Decimal(5, 2), TaxPct || 0)
      .input("HsnId", sql.Int, HsnId || null)
      .input("Status", sql.Bit, Status === false ? 0 : 1)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, HsnId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@Name, @Rate, @TaxPct, @HsnId, @Status, @CreatedBy, @CreatedAt)
      `);
    res.json({ message: "Charge Head added successfully", Id: result.recordset[0]?.Id });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("charge-head-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid Charge Head id" });
  const { Name, Rate, TaxPct, HsnId, Status } = req.body;
  if (!Name || !String(Name).trim()) {
    return res.status(400).json({ error: "Charge Head name is required" });
  }
  const updatedBy = req.user?.userId ?? req.user?.id ?? null;

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar, String(Name).trim())
      .input("Rate", sql.Decimal(18, 2), Rate || 0)
      .input("TaxPct", sql.Decimal(5, 2), TaxPct || 0)
      .input("HsnId", sql.Int, HsnId || null)
      .input("Status", sql.Bit, Status === false ? 0 : 1)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime, new Date())
      .query(`
        UPDATE dbo.MaintenanceChargeHead SET
          Name = @Name, Rate = @Rate, TaxPct = @TaxPct, HsnId = @HsnId,
          Status = @Status, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Charge Head not found" });
    res.json({ message: "Charge Head updated successfully" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Charge Heads already used against a customer are never hard-deleted —
// Status is flipped to Inactive instead, so the historical
// MaintenanceCustomerCharge rows that reference them stay meaningful.
router.delete("/:id", requirePageRight("charge-head-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid Charge Head id" });
  const updatedBy = req.user?.userId ?? req.user?.id ?? null;

  try {
    const pool = getPool();
    const used = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT TOP 1 1 AS x FROM dbo.MaintenanceCustomerCharge WHERE ChargeHeadId = @Id");

    if (used.recordset.length) {
      const result = await pool
        .request()
        .input("Id", sql.Int, id)
        .input("UpdatedBy", sql.Int, updatedBy)
        .input("UpdatedAt", sql.DateTime, new Date())
        .query(`
          UPDATE dbo.MaintenanceChargeHead SET Status = 0, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
          WHERE Id = @Id
        `);
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Charge Head not found" });
      return res.json({ message: "Charge Head is in use — marked Inactive instead of deleted." });
    }

    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.MaintenanceChargeHead WHERE Id = @Id");
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Charge Head not found" });
    res.json({ message: "Charge Head deleted successfully" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
