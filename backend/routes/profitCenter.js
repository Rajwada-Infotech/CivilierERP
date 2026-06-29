const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// Profit Center master (Finance module). Mirrors costCenter.js — GL accounts
// (dbo.AccountHeadMaster WHERE LHeadType='GL') are tagged to a Profit Center
// via the master's own "GL Accounts" multiselect.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", cache("profit-center", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        pc.ProfitCenterId, pc.Code, pc.Name, pc.Description, pc.IsActive,
        pc.ProjectId, ent.name AS ProjectName,
        pc.CreatedBy, pc.CreatedAt, pc.UpdatedBy, pc.UpdatedAt,
        (
          SELECT COUNT(*) FROM dbo.AccountHeadMaster ahm
          WHERE ahm.ProfitCenterId = pc.ProfitCenterId
        ) AS GLAccountCount,
        (
          SELECT STRING_AGG(CAST(ahm.LHeadId AS NVARCHAR(20)), ',')
          FROM dbo.AccountHeadMaster ahm
          WHERE ahm.ProfitCenterId = pc.ProfitCenterId
        ) AS GLAccountIds,
        (
          SELECT STRING_AGG(ahm.LHeadName, ', ')
          FROM dbo.AccountHeadMaster ahm
          WHERE ahm.ProfitCenterId = pc.ProfitCenterId
        ) AS GLAccountNames
      FROM dbo.ProfitCenter pc
      LEFT JOIN dbo.enterprise ent ON ent.id = pc.ProjectId
      ORDER BY pc.Name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ProfitCenterId AS id, Name AS label, Code AS code
      FROM dbo.ProfitCenter
      WHERE IsActive = 1
      ORDER BY Name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function syncGLTagging(pool, profitCenterId, glAccountIds) {
  await pool
    .request()
    .input("ProfitCenterId", sql.Int, profitCenterId)
    .query(
      "UPDATE dbo.AccountHeadMaster SET ProfitCenterId = NULL WHERE ProfitCenterId = @ProfitCenterId",
    );
  if (!glAccountIds || glAccountIds.length === 0) return;
  const ids = glAccountIds.map((v) => parseInt(v, 10)).filter(Number.isFinite);
  if (ids.length === 0) return;
  await pool
    .request()
    .input("ProfitCenterId", sql.Int, profitCenterId)
    .query(
      `UPDATE dbo.AccountHeadMaster SET ProfitCenterId = @ProfitCenterId WHERE LHeadId IN (${ids.join(",")}) AND LHeadType = 'GL'`,
    );
}

router.post("/", requirePageRight("profit-center", "create"), async (req, res) => {
  const { Code, Name, Description, IsActive, GLAccountIds, ProjectId } = req.body;
  if (!Code || !Name)
    return res.status(400).json({ error: "Code and Name are required" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Code", sql.NVarChar(50), Code)
      .input("Name", sql.NVarChar(200), Name)
      .input("Description", sql.NVarChar(500), Description || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("CreatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        INSERT INTO dbo.ProfitCenter (Code, Name, Description, IsActive, ProjectId, CreatedBy, CreatedAt)
        OUTPUT INSERTED.ProfitCenterId
        VALUES (@Code, @Name, @Description, @IsActive, @ProjectId, @CreatedBy, SYSDATETIME())
      `);
    const newId = result.recordset[0].ProfitCenterId;
    await syncGLTagging(pool, newId, GLAccountIds);
    await bumpCacheVersion("profit-center");
    res.json({ message: "Profit center added", id: newId });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "A profit center with this code already exists" });
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("profit-center", "edit"), async (req, res) => {
  const { Code, Name, Description, IsActive, GLAccountIds, ProjectId } = req.body;
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    await pool
      .request()
      .input("ProfitCenterId", sql.Int, id)
      .input("Code", sql.NVarChar(50), Code)
      .input("Name", sql.NVarChar(200), Name)
      .input("Description", sql.NVarChar(500), Description || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("UpdatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        UPDATE dbo.ProfitCenter
        SET Code = @Code, Name = @Name, Description = @Description,
            IsActive = @IsActive, ProjectId = @ProjectId, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE ProfitCenterId = @ProfitCenterId
      `);
    await syncGLTagging(pool, id, GLAccountIds);
    await bumpCacheVersion("profit-center");
    res.json({ message: "Profit center updated" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "A profit center with this code already exists" });
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("profit-center", "delete"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    await pool
      .request()
      .input("ProfitCenterId", sql.Int, id)
      .query("UPDATE dbo.AccountHeadMaster SET ProfitCenterId = NULL WHERE ProfitCenterId = @ProfitCenterId");
    const delResult = await pool
      .request()
      .input("ProfitCenterId", sql.Int, id)
      .query("DELETE FROM dbo.ProfitCenter WHERE ProfitCenterId = @ProfitCenterId");
    if (delResult.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Profit center not found" });
    await bumpCacheVersion("profit-center");
    res.json({ message: "Profit center deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
