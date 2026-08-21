const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_CancelTemplateMaster_Reason/i.test(err.message || "");

// GET all — Setup admin list (includes inactive, for management).
router.get("/", cache("cancel-template-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Reason, IsActive, CreatedAt, UpdatedAt
      FROM dbo.CancelTemplateMaster
      ORDER BY Reason
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[cancel-template-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /active — lightweight {Id, Reason} list for the "must select a reason
// to cancel" picker. Open to any authenticated user, same reasoning as
// taskMaster.js's /assignable-users — anyone who can cancel a task needs
// the current reason list, not just admins.
router.get("/active", cache("cancel-template-master-active", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Reason FROM dbo.CancelTemplateMaster WHERE IsActive = 1 ORDER BY Reason
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[cancel-template-master] GET active error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function bumpCancelTemplateCaches() {
  return Promise.all([
    bumpCacheVersion("cancel-template-master"),
    bumpCacheVersion("cancel-template-master-active"),
  ]);
}

router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { Reason, IsActive } = req.body;
  if (!Reason?.trim()) return res.status(400).json({ error: "Reason is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Reason", sql.NVarChar(255), Reason.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.CancelTemplateMaster (Reason, IsActive, CreatedBy, CreatedAt)
        VALUES (@Reason, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpCancelTemplateCaches();
    res.json({ message: "Cancel template added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A cancel template with this reason already exists" });
    }
    console.error("[cancel-template-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { Reason, IsActive } = req.body;
  if (!Reason?.trim()) return res.status(400).json({ error: "Reason is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id, 10))
      .input("Reason", sql.NVarChar(255), Reason.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.CancelTemplateMaster SET
          Reason = @Reason, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);
    await bumpCancelTemplateCaches();
    res.json({ message: "Cancel template updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A cancel template with this reason already exists" });
    }
    console.error("[cancel-template-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — blocked if any task actually cites this reason (unlike Tag,
// where deleting just drops the association — here the reason is audit
// evidence on a cancelled task, so silently orphaning it is worse than
// telling the admin to deactivate instead).
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Reason FROM dbo.CancelTemplateMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Cancel template not found" });

    const inUse = await pool.request().input("Id", sql.Int, id)
      .query("SELECT TOP 1 1 AS x FROM dbo.TaskMaster WHERE CancelReasonId = @Id");
    if (inUse.recordset.length) {
      return res.status(409).json({ error: "This reason is used on cancelled tasks — deactivate it instead of deleting." });
    }

    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.CancelTemplateMaster WHERE Id = @Id");
    await bumpCancelTemplateCaches();
    res.json({ message: `Cancel template "${existing.recordset[0].Reason}" deleted successfully` });
  } catch (err) {
    console.error("[cancel-template-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
