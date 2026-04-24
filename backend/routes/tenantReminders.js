const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET /api/tenant-reminders
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        ReminderId, Title, Message, Module,
        RefId, DueDate, SentAt, IsSent,
        CreatedBy, CreatedAt
      FROM dbo.TenantReminders
      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("TENANT REMINDERS GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reminders/send/:id
router.post("/send/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("ReminderId", sql.Int, req.params.id)
      .input("SentAt", sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.TenantReminders
        SET IsSent = 1, SentAt = @SentAt
        WHERE ReminderId = @ReminderId
      `);
    res.json({ message: "Reminder marked as sent" });
  } catch (err) {
    console.error("REMINDER SEND ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

