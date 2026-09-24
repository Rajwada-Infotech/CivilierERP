const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");

// GET /api/audit-trail?entityType=AccountGroup — read-only, newest first.
router.get("/", authenticateToken, async (req, res) => {
  const entityType = req.query.entityType;
  if (!entityType) {
    return res.status(400).json({ error: "entityType is required" });
  }
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("EntityType", sql.NVarChar(50), entityType)
      .query(`
        SELECT Id, EntityType, EntityId, EntityName, Action, UserId, UserName, Details, CreatedAt
        FROM dbo.AuditTrail
        WHERE EntityType = @EntityType
        ORDER BY CreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
