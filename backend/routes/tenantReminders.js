const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET /api/tenant-reminders
// Returns rows shaped for RemindersManager.tsx:
//   id, tenantName, amountDue, status, dueDate, lastSentOn
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        ReminderId          AS id,
        Title               AS tenantName,
        Message             AS message,
        Module              AS module,
        RefId               AS refId,
        CONVERT(VARCHAR(10), DueDate, 120)  AS dueDate,
        CONVERT(VARCHAR(10), SentAt,  120)  AS lastSentOn,
        IsSent,
        CreatedBy,
        CreatedAt,
        -- Derive status: overdue if due date passed and not sent, else scheduled
        CASE
          WHEN IsSent = 1                          THEN 'sent'
          WHEN DueDate < CAST(GETDATE() AS DATE)   THEN 'overdue'
          ELSE 'scheduled'
        END AS status,
        -- AmountDue stored in RefId column if numeric, else 0
        ISNULL(TRY_CAST(RefId AS DECIMAL(18,2)), 0) AS amountDue
      FROM dbo.TenantReminders
      ORDER BY
        CASE WHEN IsSent = 0 AND DueDate < CAST(GETDATE() AS DATE) THEN 0 ELSE 1 END,
        DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("TENANT REMINDERS GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tenant-reminders  — create a new reminder
router.post("/", async (req, res) => {
  const { title, message, module, refId, dueDate, createdBy } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const pool = getPool();
    await pool.request()
      .input("Title",     sql.NVarChar(255), title)
      .input("Message",   sql.NVarChar(sql.MAX), message   || null)
      .input("Module",    sql.NVarChar(100),     module    || null)
      .input("RefId",     sql.Int,               refId     || null)
      .input("DueDate",   sql.Date,              dueDate   ? new Date(dueDate) : null)
      .input("CreatedBy", sql.NVarChar(100),     createdBy || null)
      .query(`
        INSERT INTO dbo.TenantReminders (Title, Message, Module, RefId, DueDate, IsSent, CreatedBy)
        VALUES (@Title, @Message, @Module, @RefId, @DueDate, 0, @CreatedBy)
      `);
    res.status(201).json({ message: "Reminder created" });
  } catch (err) {
    console.error("REMINDER CREATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reminders/send/:id  (also reachable as /api/tenant-reminders/send/:id)
// Marks reminder as sent + records timestamp
router.post("/send/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const check = await pool.request()
      .input("ReminderId", sql.Int, id)
      .query("SELECT ReminderId FROM dbo.TenantReminders WHERE ReminderId = @ReminderId");
    if (!check.recordset.length)
      return res.status(404).json({ error: "Reminder not found" });

    await pool.request()
      .input("ReminderId", sql.Int, id)
      .input("SentAt",     sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.TenantReminders
        SET IsSent = 1, SentAt = @SentAt
        WHERE ReminderId = @ReminderId
      `);
    res.json({ message: "Reminder marked as sent", id });
  } catch (err) {
    console.error("REMINDER SEND ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tenant-reminders/:id
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    await pool.request()
      .input("ReminderId", sql.Int, id)
      .query("DELETE FROM dbo.TenantReminders WHERE ReminderId = @ReminderId");
    res.json({ message: "Reminder deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
