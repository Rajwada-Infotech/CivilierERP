const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// Cost Center master (Finance module). GL accounts (dbo.AccountHeadMaster
// WHERE LHeadType='GL') are tagged to a Cost Center via the master's own
// "GL Accounts" multiselect — saving a Cost Center re-points
// AccountHeadMaster.CostCenterId for exactly the GL ids passed in, and clears
// it for any GL accounts previously tagged to this center that were removed.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", cache("cost-center", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        cc.CostCenterId, cc.Code, cc.Name, cc.Description, cc.IsActive,
        cc.CreatedBy, cc.CreatedAt, cc.UpdatedBy, cc.UpdatedAt,
        (
          SELECT COUNT(*) FROM dbo.AccountHeadMaster ahm
          WHERE ahm.CostCenterId = cc.CostCenterId
        ) AS GLAccountCount,
        (
          SELECT STRING_AGG(CAST(ahm.LHeadId AS NVARCHAR(20)), ',')
          FROM dbo.AccountHeadMaster ahm
          WHERE ahm.CostCenterId = cc.CostCenterId
        ) AS GLAccountIds,
        (
          SELECT STRING_AGG(ahm.LHeadName, ', ')
          FROM dbo.AccountHeadMaster ahm
          WHERE ahm.CostCenterId = cc.CostCenterId
        ) AS GLAccountNames
      FROM dbo.CostCenter cc
      ORDER BY cc.Name
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
      SELECT CostCenterId AS id, Name AS label, Code AS code
      FROM dbo.CostCenter
      WHERE IsActive = 1
      ORDER BY Name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function syncGLTagging(pool, costCenterId, glAccountIds) {
  // Clear this center's tag from any GL account no longer in the list.
  await pool
    .request()
    .input("CostCenterId", sql.Int, costCenterId)
    .query(
      "UPDATE dbo.AccountHeadMaster SET CostCenterId = NULL WHERE CostCenterId = @CostCenterId",
    );
  if (!glAccountIds || glAccountIds.length === 0) return;
  const ids = glAccountIds.map((v) => parseInt(v, 10)).filter(Number.isFinite);
  if (ids.length === 0) return;
  await pool
    .request()
    .input("CostCenterId", sql.Int, costCenterId)
    .query(
      `UPDATE dbo.AccountHeadMaster SET CostCenterId = @CostCenterId WHERE LHeadId IN (${ids.join(",")}) AND LHeadType = 'GL'`,
    );
}

router.post("/", requirePageRight("cost-center", "create"), async (req, res) => {
  const { Code, Name, Description, IsActive, GLAccountIds } = req.body;
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
      .input("CreatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        INSERT INTO dbo.CostCenter (Code, Name, Description, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.CostCenterId
        VALUES (@Code, @Name, @Description, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    const newId = result.recordset[0].CostCenterId;
    await syncGLTagging(pool, newId, GLAccountIds);
    await bumpCacheVersion("cost-center");
    res.json({ message: "Cost center added", id: newId });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "A cost center with this code already exists" });
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("cost-center", "edit"), async (req, res) => {
  const { Code, Name, Description, IsActive, GLAccountIds } = req.body;
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    await pool
      .request()
      .input("CostCenterId", sql.Int, id)
      .input("Code", sql.NVarChar(50), Code)
      .input("Name", sql.NVarChar(200), Name)
      .input("Description", sql.NVarChar(500), Description || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        UPDATE dbo.CostCenter
        SET Code = @Code, Name = @Name, Description = @Description,
            IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE CostCenterId = @CostCenterId
      `);
    await syncGLTagging(pool, id, GLAccountIds);
    await bumpCacheVersion("cost-center");
    res.json({ message: "Cost center updated" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "A cost center with this code already exists" });
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("cost-center", "delete"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    // Untag any GL accounts pointing at this center before deleting it.
    await pool
      .request()
      .input("CostCenterId", sql.Int, id)
      .query("UPDATE dbo.AccountHeadMaster SET CostCenterId = NULL WHERE CostCenterId = @CostCenterId");
    const delResult = await pool
      .request()
      .input("CostCenterId", sql.Int, id)
      .query("DELETE FROM dbo.CostCenter WHERE CostCenterId = @CostCenterId");
    if (delResult.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Cost center not found" });
    await bumpCacheVersion("cost-center");
    res.json({ message: "Cost center deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
