const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// UQ_TagMaster_Name enforces uniqueness at the DB level — this just gives a
// friendly 409 instead of surfacing the raw SQL constraint error.
const isUniqueViolation = (err) => /UQ_TagMaster_Name/i.test(err.message || "");

// GET all tags — Setup admin list (includes inactive, for management).
router.get("/", cache("tag-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Name, IsActive, CreatedAt, UpdatedAt
      FROM dbo.TagMaster
      ORDER BY Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[tag-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /active — lightweight {Id, Name} list of active tags only, for the
// task drawer's tag picker. Open to any authenticated user, same reasoning
// as taskMaster.js's /assignable-users (anyone tagging a task needs the
// full active tag list, not just what admins can see).
router.get("/active", cache("tag-master-active", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Name FROM dbo.TagMaster WHERE IsActive = 1 ORDER BY Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[tag-master] GET active error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function bumpTagCaches() {
  return Promise.all([
    bumpCacheVersion("tag-master"),
    bumpCacheVersion("tag-master-active"),
  ]);
}

// POST — add tag
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { Name, IsActive } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar(60), Name.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.TagMaster (Name, IsActive, CreatedBy, CreatedAt)
        VALUES (@Name, @IsActive, @CreatedBy, SYSUTCDATETIME())
      `);
    await bumpTagCaches();
    res.json({ message: "Tag added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A tag with this name already exists" });
    }
    console.error("[tag-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update tag (name and/or active status)
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { Name, IsActive } = req.body;
  if (!Name?.trim()) return res.status(400).json({ error: "Name is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id, 10))
      .input("Name", sql.NVarChar(60), Name.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.TagMaster SET
          Name = @Name, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id
      `);
    await bumpTagCaches();
    res.json({ message: "Tag updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A tag with this name already exists" });
    }
    console.error("[tag-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — hard delete. TaskTags rows referencing this tag are removed
// automatically (ON DELETE CASCADE) — Activate/Deactivate is the
// non-destructive alternative for retiring a tag without wiping its
// history off existing tasks.
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Name FROM dbo.TagMaster WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Tag not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.TagMaster WHERE Id = @Id");
    await bumpTagCaches();
    res.json({ message: `Tag "${existing.recordset[0].Name}" deleted successfully` });
  } catch (err) {
    console.error("[tag-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
