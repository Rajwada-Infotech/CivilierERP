const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all signatures
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, Name, Owner, Status, ImageData, AddedAt
      FROM dbo.Signatures
      WHERE IsDeleted = 0
      ORDER BY AddedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post("/", adminOnly, async (req, res) => {
  const { name, owner, imageData } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (imageData && imageData.length > 2_000_000)
    return res.status(413).json({ error: "Image too large (max ~1.5 MB)" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(200), name)
      .input("Owner", sql.NVarChar(200), owner || null)
      .input("Status", sql.NVarChar(20), "active")
      .input("ImageData", sql.NVarChar(sql.MAX), imageData || null).query(`
        INSERT INTO dbo.Signatures (Name, Owner, Status, ImageData, IsDeleted, AddedAt)
        OUTPUT INSERTED.Id
        VALUES (@Name, @Owner, @Status, @ImageData, 0, GETDATE())
      `);
    res.json({ success: true, id: result.recordset[0].Id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put("/:id", adminOnly, async (req, res) => {
  const { name, owner, status, imageData } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("Name", sql.NVarChar(200), name || null)
      .input("Owner", sql.NVarChar(200), owner || null)
      .input("Status", sql.NVarChar(20), status || "active")
      .input("ImageData", sql.NVarChar(sql.MAX), imageData || null).query(`
        UPDATE dbo.Signatures
        SET Name=@Name, Owner=@Owner, Status=@Status,
            ImageData=CASE WHEN @ImageData IS NOT NULL THEN @ImageData ELSE ImageData END,
            UpdatedAt=GETDATE()
        WHERE Id=@Id AND IsDeleted=0
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH toggle status
router.patch("/:id/status", adminOnly, async (req, res) => {
  const { status } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("Status", sql.NVarChar(20), status)
      .query(
        "UPDATE dbo.Signatures SET Status=@Status, UpdatedAt=GETDATE() WHERE Id=@Id",
      );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .query(
        "UPDATE dbo.Signatures SET IsDeleted=1, UpdatedAt=GETDATE() WHERE Id=@Id",
      );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




