const express = require("express");
const router = express.Router();
const rateLimit = require("../middleware/rateLimiter");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");

// Tags for Civil Work DPR activities (dbo.DprTagMaster). A tag is linked to an activity through
// dbo.ActivityMaster.TagId; new tags are also auto-created from the Activity Master form.

const cleanName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 100);

// Finds a tag by name (case-insensitive) or creates it. Shared with the Activity Master route so a tag
// typed there is saved here automatically. Returns the tag id (null for a blank name).
async function findOrCreateTag(pool, rawName, actor) {
  const name = cleanName(rawName);
  if (!name) return null;
  const existing = await pool.request().input("n", sql.NVarChar(100), name)
    .query("SELECT Id FROM dbo.DprTagMaster WHERE TagName = @n");
  if (existing.recordset[0]) return existing.recordset[0].Id;
  try {
    const ins = await pool.request()
      .input("n", sql.NVarChar(100), name)
      .input("by", sql.NVarChar(200), actor || "system")
      .query("INSERT INTO dbo.DprTagMaster (TagName, CreatedBy) OUTPUT INSERTED.Id AS id VALUES (@n, @by)");
    return ins.recordset[0].id;
  } catch (err) {
    // Lost a race with a concurrent create of the same name — use theirs.
    if (err.number === 2627 || err.number === 2601) {
      const again = await pool.request().input("n", sql.NVarChar(100), name)
        .query("SELECT Id FROM dbo.DprTagMaster WHERE TagName = @n");
      if (again.recordset[0]) return again.recordset[0].Id;
    }
    throw err;
  }
}

// GET / — every tag with how many activities use it
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT t.Id AS id, t.TagName AS tagName, t.IsActive AS isActive,
             t.CreatedBy AS createdBy, t.CreatedAt AS createdAt, t.UpdatedBy AS updatedBy, t.UpdatedAt AS updatedAt,
             (SELECT COUNT(*) FROM dbo.ActivityMaster am WHERE am.TagId = t.Id) AS activityCount
      FROM dbo.DprTagMaster t
      ORDER BY t.TagName`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[dpr-tag-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST / — add a tag (409 when the name already exists)
router.post("/", authMiddleware, requirePageRight("dpr-tag-master", "create"), async (req, res) => {
  const name = cleanName(req.body?.tagName);
  if (!name) return res.status(400).json({ error: "Tag name is required" });
  try {
    const pool = await getPool();
    const dup = await pool.request().input("n", sql.NVarChar(100), name)
      .query("SELECT Id FROM dbo.DprTagMaster WHERE TagName = @n");
    if (dup.recordset[0]) return res.status(409).json({ error: `Tag "${name}" already exists` });
    const actor = req.user?.email || req.user?.name || "system";
    const id = await findOrCreateTag(pool, name, actor);
    await bumpCacheVersion("dpr-tag-master");
    res.status(201).json({ id, message: "Tag added" });
  } catch (err) {
    console.error("[dpr-tag-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — rename / (de)activate. Activities keep pointing at the same tag row, so a rename shows
// everywhere (including reports) straight away.
router.put("/:id", authMiddleware, requirePageRight("dpr-tag-master", "edit"), async (req, res) => {
  const name = cleanName(req.body?.tagName);
  if (!name) return res.status(400).json({ error: "Tag name is required" });
  try {
    const pool = await getPool();
    const dup = await pool.request().input("n", sql.NVarChar(100), name).input("id", sql.Int, req.params.id)
      .query("SELECT Id FROM dbo.DprTagMaster WHERE TagName = @n AND Id <> @id");
    if (dup.recordset[0]) return res.status(409).json({ error: `Tag "${name}" already exists` });
    const r = await pool.request()
      .input("id", sql.Int, req.params.id)
      .input("n", sql.NVarChar(100), name)
      .input("active", sql.Bit, req.body?.isActive === false ? 0 : 1)
      .input("by", sql.NVarChar(200), req.user?.email || req.user?.name || "system")
      .query("UPDATE dbo.DprTagMaster SET TagName = @n, IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Tag not found" });
    await bumpCacheVersion("dpr-tag-master");
    await bumpCacheVersion("activity-master");
    res.json({ message: "Tag updated" });
  } catch (err) {
    console.error("[dpr-tag-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — only an unused tag can go; one linked to activities must be re-tagged first
router.delete("/:id", authMiddleware, requirePageRight("dpr-tag-master", "delete"), async (req, res) => {
  try {
    const pool = await getPool();
    const used = await pool.request().input("id", sql.Int, req.params.id)
      .query("SELECT COUNT(*) AS n FROM dbo.ActivityMaster WHERE TagId = @id");
    const n = used.recordset[0].n;
    if (n > 0) {
      return res.status(409).json({ error: `This tag is used by ${n} activit${n === 1 ? "y" : "ies"} — change their tag first.` });
    }
    const r = await pool.request().input("id", sql.Int, req.params.id).query("DELETE FROM dbo.DprTagMaster WHERE Id = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Tag not found" });
    await bumpCacheVersion("dpr-tag-master");
    res.json({ message: "Tag deleted" });
  } catch (err) {
    console.error("[dpr-tag-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.findOrCreateTag = findOrCreateTag;
