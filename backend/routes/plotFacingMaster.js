// Plot Facing master — the vocabulary of plot orientations, and what each one
// is worth as a premium.
//
// Replaces a free-text Facing box on PlotMaster. Beyond spelling consistency,
// the point is that PremiumPercent lives HERE: a layout where east plots carry
// 5% is a row edit, not a pricing-code change, and nothing in the codebase holds
// its own opinion about which direction is worth what.
//
// Facings are referenced by Code (PlotMaster.Facing is an NVARCHAR holding it),
// not by id, so existing rows and spreadsheet imports keep working without a
// backfill.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { parseId } = require("../middleware/validateRequest");

const adminOnly = allowRoles("admin", "super_admin", "dba");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Usage count is returned alongside each row so the UI can say WHY a facing
// cannot be removed before anyone tries, rather than only after the refusal.
const SELECT = `
  SELECT f.Id, f.Code, f.Name, f.PremiumPercent, f.SortOrder, f.IsActive,
         (SELECT COUNT(*) FROM dbo.PlotMaster p WHERE p.Facing = f.Code AND p.IsActive = 1) AS PlotCount
  FROM dbo.PlotFacingMaster f
`;

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    // Default to active only: every dropdown in the app wants the live
    // vocabulary, while the master screen asks for all with ?all=1.
    const where = req.query.all === "1" ? "" : "WHERE f.IsActive = 1";
    const r = await pool.request().query(`${SELECT} ${where} ORDER BY f.SortOrder, f.Name`);
    res.json(r.recordset);
  } catch (e) {
    console.error("[plot-facing-master] GET:", e.message);
    res.status(500).json({ error: "Failed to load plot facings" });
  }
});

router.post("/", adminOnly, async (req, res) => {
  const b = req.body || {};
  const code = String(b.Code || b.code || "").trim().toUpperCase();
  const name = String(b.Name || b.name || "").trim();
  if (!code) return res.status(400).json({ error: "Code is required" });
  if (!name) return res.status(400).json({ error: "Name is required" });
  try {
    const pool = getPool();
    const dup = await pool.request().input("c", sql.NVarChar(20), code)
      .query("SELECT TOP 1 Id FROM dbo.PlotFacingMaster WHERE Code = @c AND IsActive = 1");
    if (dup.recordset.length) return res.status(400).json({ error: `Facing code "${code}" already exists` });

    const r = await pool.request()
      .input("code", sql.NVarChar(20), code)
      .input("name", sql.NVarChar(50), name)
      .input("prem", sql.Decimal(6, 3), b.PremiumPercent != null && b.PremiumPercent !== "" ? Number(b.PremiumPercent) : 0)
      .input("sort", sql.Int, b.SortOrder != null && b.SortOrder !== "" ? parseInt(b.SortOrder, 10) : 100)
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`INSERT INTO dbo.PlotFacingMaster (Code, Name, PremiumPercent, SortOrder, CreatedBy)
              OUTPUT INSERTED.Id VALUES (@code, @name, @prem, @sort, @by)`);
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error("[plot-facing-master] POST:", e.message);
    res.status(500).json({ error: "Failed to create the facing" });
  }
});

router.put("/:id", adminOnly, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const b = req.body || {};
  const code = String(b.Code || b.code || "").trim().toUpperCase();
  const name = String(b.Name || b.name || "").trim();
  if (!code) return res.status(400).json({ error: "Code is required" });
  if (!name) return res.status(400).json({ error: "Name is required" });
  try {
    const pool = getPool();

    // Changing a Code would orphan every plot still holding the old one, since
    // PlotMaster.Facing stores the code rather than an id. Refused while in use;
    // the premium and display name stay freely editable, which is what actually
    // changes in practice.
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Code FROM dbo.PlotFacingMaster WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Facing not found" });
    const oldCode = cur.recordset[0].Code;
    if (oldCode !== code) {
      const used = await pool.request().input("c", sql.NVarChar(20), oldCode)
        .query("SELECT COUNT(*) AS n FROM dbo.PlotMaster WHERE Facing = @c AND IsActive = 1");
      if (used.recordset[0].n > 0)
        return res.status(400).json({ error: `${used.recordset[0].n} plot(s) use code "${oldCode}" — rename is blocked, but the name and premium can still be changed.` });
    }

    const dup = await pool.request().input("c", sql.NVarChar(20), code).input("id", sql.Int, id)
      .query("SELECT TOP 1 Id FROM dbo.PlotFacingMaster WHERE Code = @c AND IsActive = 1 AND Id <> @id");
    if (dup.recordset.length) return res.status(400).json({ error: `Facing code "${code}" already exists` });

    await pool.request()
      .input("id", sql.Int, id)
      .input("code", sql.NVarChar(20), code)
      .input("name", sql.NVarChar(50), name)
      .input("prem", sql.Decimal(6, 3), b.PremiumPercent != null && b.PremiumPercent !== "" ? Number(b.PremiumPercent) : 0)
      .input("sort", sql.Int, b.SortOrder != null && b.SortOrder !== "" ? parseInt(b.SortOrder, 10) : 100)
      .input("active", sql.Bit, b.IsActive === false || b.IsActive === 0 || b.IsActive === "false" ? 0 : 1)
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`UPDATE dbo.PlotFacingMaster
              SET Code = @code, Name = @name, PremiumPercent = @prem, SortOrder = @sort,
                  IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
    res.json({ success: true });
  } catch (e) {
    console.error("[plot-facing-master] PUT:", e.message);
    res.status(500).json({ error: "Failed to update the facing" });
  }
});

// Soft delete, refused while plots still carry the code — removing it would
// leave those plots pointing at a vocabulary entry that no longer exists.
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT Code FROM dbo.PlotFacingMaster WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Facing not found" });
    const used = await pool.request().input("c", sql.NVarChar(20), row.recordset[0].Code)
      .query("SELECT COUNT(*) AS n FROM dbo.PlotMaster WHERE Facing = @c AND IsActive = 1");
    if (used.recordset[0].n > 0)
      return res.status(400).json({ error: `In use by ${used.recordset[0].n} plot(s) — reassign them before removing this facing.` });

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.PlotFacingMaster SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[plot-facing-master] DELETE:", e.message);
    res.status(500).json({ error: "Failed to remove the facing" });
  }
});

module.exports = router;
