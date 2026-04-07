const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

// ✅ GET /api/user-activity
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT 
        Id AS id,
        UserId AS userId,
        UserName AS userName,
        UserEmail AS userEmail,
        UserRole AS userRole,
        EventType AS event,
        CreatedAt AS timestamp,
        IpAddress AS ipAddress,
        DeviceInfo AS deviceInfo
      FROM dbo.UserActivityLog
      ORDER BY CreatedAt DESC
    `);

    res.json(result.recordset); // always array
  } catch (err) {
    console.error("UserActivity GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST /api/user-activity (log activity)
router.post("/", authMiddleware, async (req, res) => {
  const { userId, userName, userEmail, userRole, event, ipAddress, deviceInfo } = req.body;

  try {
    const pool = getPool();

    await pool.request()
      .input("userId", sql.NVarChar(50), userId)
      .input("userName", sql.NVarChar(100), userName)
      .input("userEmail", sql.NVarChar(100), userEmail)
      .input("userRole", sql.NVarChar(50), userRole)
      .input("event", sql.NVarChar(20), event)
      .input("ipAddress", sql.NVarChar(50), ipAddress || "unknown")
      .input("deviceInfo", sql.NVarChar(255), deviceInfo || "unknown")
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.UserActivityLog 
        (UserId, UserName, UserEmail, UserRole, EventType, IpAddress, DeviceInfo, CreatedAt)
        VALUES (@userId, @userName, @userEmail, @userRole, @event, @ipAddress, @deviceInfo, @CreatedAt)
      `);

    res.json({ message: "Activity logged" });
  } catch (err) {
    console.error("UserActivity POST error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ SSE /api/user-activity/stream (real-time updates)
router.get("/stream", authMiddleware, async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendData = async () => {
      try {
        const pool = getPool();

        const result = await pool.request().query(`
          SELECT TOP 10
            Id AS id,
            UserId AS userId,
            UserName AS userName,
            UserEmail AS userEmail,
            UserRole AS userRole,
            EventType AS event,
            CreatedAt AS timestamp,
            IpAddress AS ipAddress,
            DeviceInfo AS deviceInfo
          FROM dbo.UserActivityLog
          ORDER BY CreatedAt DESC
        `);

        res.write(`data: ${JSON.stringify(result.recordset)}\n\n`);
      } catch (err) {
        console.error("SSE fetch error:", err);
      }
    };

    await sendData(); // initial push

    const interval = setInterval(sendData, 5000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  } catch (err) {
    console.error("SSE error:", err);
    res.end();
  }
});

module.exports = router;