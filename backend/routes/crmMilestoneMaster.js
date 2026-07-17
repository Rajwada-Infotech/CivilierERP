const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — the reusable milestone catalog, sorted for display in the Payment
// Plan Master's step picker.
router.get("/", requirePageRight("crm-milestone-master", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Name, DefaultPercent, SortOrder, IsActive, CreatedAt, UpdatedAt
      FROM dbo.CrmMilestoneMaster
      ORDER BY SortOrder, Name
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-milestone-master] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-milestone-master", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Name is required" });

    const result = await pool.request()
      .input("name", sql.NVarChar(200), b.Name.trim())
      .input("pct",  sql.Decimal(5,2),  b.DefaultPercent != null && b.DefaultPercent !== "" ? parseFloat(b.DefaultPercent) : null)
      .input("sort", sql.Int,           b.SortOrder != null ? parseInt(b.SortOrder) : 0)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmMilestoneMaster (Name, DefaultPercent, SortOrder, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@name, @pct, @sort, 1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A milestone with this name already exists" });
    console.error("[crm-milestone-master] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-milestone-master", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    await pool.request()
      .input("id",   sql.Int,           id)
      .input("name", sql.NVarChar(200), b.Name || null)
      .input("pct",  sql.Decimal(5,2),  b.DefaultPercent != null && b.DefaultPercent !== "" ? parseFloat(b.DefaultPercent) : null)
      .input("sort", sql.Int,           b.SortOrder != null ? parseInt(b.SortOrder) : null)
      .input("active", sql.Bit,        b.IsActive !== false ? 1 : 0)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmMilestoneMaster SET
          Name = ISNULL(@name, Name), DefaultPercent = @pct,
          SortOrder = ISNULL(@sort, SortOrder), IsActive = @active,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A milestone with this name already exists" });
    console.error("[crm-milestone-master] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", requirePageRight("crm-milestone-master", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const usage = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentPlanTemplateItem WHERE MilestoneMasterId = @id");
    if (usage.recordset[0].Cnt > 0) {
      return res.status(409).json({ error: "This milestone is used by one or more payment plans — deactivate it instead of deleting." });
    }
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmMilestoneMaster WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-milestone-master] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
