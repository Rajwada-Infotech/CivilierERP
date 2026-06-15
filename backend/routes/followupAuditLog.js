/**
 * followupAuditLog.js
 * Read-only endpoint — returns audit history for a record.
 * Drop at: backend/routes/followupAuditLog.js
 * Wire in server.js: { path: "/api/followup-audit-log", file: "./routes/followupAuditLog" }
 */

const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const rateLimit = require("express-rate-limit");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false }));
router.use(authMiddleware);

// GET /api/followup-audit-log?module=Booking&recordId=42&page=1&pageSize=50
router.get("/", async (req, res) => {
  try {
    const module   = req.query.module   ? String(req.query.module).trim()   : null;
    const recordId = req.query.recordId ? parseInt(req.query.recordId, 10)  : null;
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const offset   = (page - 1) * pageSize;

    if (!module || !recordId) {
      return res.status(400).json({ error: "module and recordId are required" });
    }

    const pool = getPool();

    const countResult = await pool
      .request()
      .input("Module",   sql.NVarChar(50), module)
      .input("RecordId", sql.Int,          recordId)
      .query(`
        SELECT COUNT(*) AS Total
        FROM dbo.FollowupAuditLog
        WHERE Module = @Module AND RecordId = @RecordId
      `);

    const dataResult = await pool
      .request()
      .input("Module",   sql.NVarChar(50), module)
      .input("RecordId", sql.Int,          recordId)
      .input("Offset",   sql.Int,          offset)
      .input("PageSize", sql.Int,          pageSize)
      .query(`
        SELECT
          Id, Module, RecordId, RecordNo,
          Action, FieldName, OldValue, NewValue,
          StepName, Notes, ChangedBy,
          CONVERT(VARCHAR(19), ChangedAt, 120) AS ChangedAt
        FROM dbo.FollowupAuditLog
        WHERE Module = @Module AND RecordId = @RecordId
        ORDER BY ChangedAt DESC, Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `);

    const total = Number(countResult.recordset[0]?.Total ?? 0);
    res.json({
      data: dataResult.recordset,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("followupAuditLog GET error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

module.exports = router;