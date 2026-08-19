const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

// GET all menu entries
router.get("/", authMiddleware, cache("menu-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Name, Description, CreatedBy, UpdatedBy, CreatedAt, UpdatedAt
      FROM dbo.MenuMaster
      ORDER BY Name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("MenuMaster GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET single
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(`SELECT * FROM dbo.MenuMaster WHERE Id = @Id`);
    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Menu entry not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("MenuMaster GET/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST - create new menu entry
router.post("/", authMiddleware, checkPermission("Rights", "Menu", "CanAdd"), async (req, res) => {
  const { Name, Description } = req.body;
  const createdBy = req.user?.userId || null;

  if (!Name || !Name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(200), Name.trim())
      .input("Description", sql.NVarChar(500), Description?.trim() || null)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date())
      .query(`
        INSERT INTO dbo.MenuMaster (Name, Description, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@Name, @Description, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("menu-master");
    res.status(201).json({ id: result.recordset[0].Id, message: "Menu entry created successfully" });
  } catch (err) {
    console.error("MenuMaster POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT - update menu entry
router.put("/:id", authMiddleware, checkPermission("Rights", "Menu", "CanEdit"), async (req, res) => {
  const { Name, Description } = req.body;
  const updatedBy = req.user?.userId || null;

  if (!Name || !Name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("Name", sql.NVarChar(200), Name.trim())
      .input("Description", sql.NVarChar(500), Description?.trim() || null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date())
      .query(`
        UPDATE dbo.MenuMaster SET
          Name        = @Name,
          Description = @Description,
          UpdatedBy   = @UpdatedBy,
          UpdatedAt   = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("menu-master");
    res.json({ message: "Menu entry updated successfully" });
  } catch (err) {
    console.error("MenuMaster PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", authMiddleware, checkPermission("Rights", "Menu", "CanDelete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(`DELETE FROM dbo.MenuMaster WHERE Id = @Id`);
    await bumpCacheVersion("menu-master");
    res.json({ message: "Menu entry deleted successfully" });
  } catch (err) {
    console.error("MenuMaster DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




