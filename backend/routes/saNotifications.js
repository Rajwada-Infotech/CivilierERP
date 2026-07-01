const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

const rateLimit = require("express-rate-limit");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

// GET / — list user's recent notifications (latest 50)
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const pool = getPool();
    const result = await pool.request()
      .input("UserId", sql.Int, parseInt(userId))
      .query(`
        SELECT TOP 50 Id, UserId, Type, Title, Body, RefId, RefType, IsRead, CreatedAt
        FROM dbo.SaNotification
        WHERE UserId = @UserId
        ORDER BY CreatedAt DESC
      `);
    res.json(result.recordset.map((n) => ({
      id: n.Id,
      userId: n.UserId,
      type: n.Type,
      title: n.Title,
      body: n.Body,
      refId: n.RefId,
      refType: n.RefType,
      isRead: !!n.IsRead,
      createdAt: n.CreatedAt,
    })));
  } catch (e) {
    console.error("[sa-notifications] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /read-all — mark all user notifications as read
router.put("/read-all", async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const pool = getPool();
    await pool.request()
      .input("UserId", sql.Int, parseInt(userId))
      .query("UPDATE dbo.SaNotification SET IsRead = 1 WHERE UserId = @UserId AND IsRead = 0");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-notifications] PUT read-all error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/read — mark one notification as read
router.put("/:id/read", async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const pool = getPool();
    await pool.request()
      .input("Id",     sql.Int, parseInt(req.params.id))
      .input("UserId", sql.Int, parseInt(userId))
      .query("UPDATE dbo.SaNotification SET IsRead = 1 WHERE Id = @Id AND UserId = @UserId");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-notifications] PUT /:id/read error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
