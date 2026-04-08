const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

function normalizePositiveInt(value, fallback) {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

let activeStreams = [];

function mapActivityRow(row) {
  return {
    id: String(row.id || row.Id),
    userId: row.userId || row.UserId,
    userName: row.userName || row.UserName,
    userEmail: row.userEmail || row.UserEmail,
    userRole: row.userRole || row.UserRole,
    event: row.event || row.EventType,
    timestamp: row.timestamp || row.CreatedAt,
    ipAddress: row.ipAddress || row.IpAddress,
    deviceInfo: row.deviceInfo || row.DeviceInfo,
    deviceFingerprint: row.deviceFingerprint || row.DeviceFingerprint,
    actionType: row.actionType || row.ActionType,
    resource: row.resource || row.Resource,
    details: row.details || row.Details,
    sessionId: row.sessionId || row.SessionId,
    sessionDuration: row.sessionDuration || row.SessionDuration,
    requestMethod: row.requestMethod || row.RequestMethod,
    requestUrl: row.requestUrl || row.RequestUrl,
  };
}

// ====================== GET Activity Logs (Merged) ======================
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();

    // Dev branch pagination + search + filters
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 1000);
    const offset = (page - 1) * limit;

    const search = (req.query.search || "").trim().toLowerCase();
    const eventFilter = req.query.event || "";
    const roleFilter = req.query.role || "";
    const sortField = req.query.sort || "timestamp";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    // Backend branch: Period presets + manual date range
    let computedDateFrom = req.query.dateFrom;
    let computedDateTo = req.query.dateTo;
    const period = req.query.period;

    if (period) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      switch (period) {
        case "today":
          computedDateFrom = now.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case "yesterday":
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          computedDateFrom = yesterday.toISOString().slice(0, 10);
          computedDateTo = now.toISOString().slice(0, 10);
          break;
        case "this-week":
          const thisWeekStart = new Date(now);
          thisWeekStart.setDate(now.getDate() - now.getDay());
          computedDateFrom = thisWeekStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case "this-month":
          const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          computedDateFrom = thisMonthStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case "last-month":
          const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          computedDateFrom = lastMonthStart.toISOString().slice(0, 10);
          computedDateTo = new Date(lastMonthEnd.getTime() + 86400000).toISOString().slice(0, 10);
          break;
        case "this-year":
          const thisYearStart = new Date(now.getFullYear(), 0, 1);
          computedDateFrom = thisYearStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
      }
    }

    // Build dynamic WHERE clause
    let whereConditions = ["1 = 1"];
    let request = pool.request();

    if (search) {
      whereConditions.push("(LOWER(UserName) LIKE @searchTerm OR LOWER(UserEmail) LIKE @searchTerm OR LOWER(IpAddress) LIKE @searchTerm OR LOWER(DeviceInfo) LIKE @searchTerm)");
      request.input("searchTerm", sql.NVarChar, `%${search}%`);
    }
    if (eventFilter) {
      whereConditions.push("EventType = @eventFilter");
      request.input("eventFilter", sql.NVarChar(20), eventFilter);
    }
    if (roleFilter) {
      whereConditions.push("UserRole = @roleFilter");
      request.input("roleFilter", sql.NVarChar(50), roleFilter);
    }
    if (computedDateFrom) {
      whereConditions.push("CreatedAt >= @dateFrom");
      request.input("dateFrom", sql.DateTime2, new Date(computedDateFrom));
    }
    if (computedDateTo) {
      const dateToObj = new Date(computedDateTo);
      dateToObj.setHours(23, 59, 59, 999);
      whereConditions.push("CreatedAt <= @dateTo");
      request.input("dateTo", sql.DateTime2, dateToObj);
    }

    const whereClause = whereConditions.join(" AND ");

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM dbo.UserActivityLog WHERE ${whereClause}`;
    const countResult = await request.query(countQuery);
    const total = countResult.recordset[0].total;

    // Main query with pagination
    const sortColumn = sortField === "userName" ? "UserName" : sortField === "event" ? "EventType" : "CreatedAt";

    const dataQuery = `
      SELECT
        Id AS id, UserId AS userId, UserName AS userName, UserEmail AS userEmail, UserRole AS userRole,
        EventType AS event, CreatedAt AS timestamp, IpAddress AS ipAddress, DeviceInfo AS deviceInfo,
        DeviceFingerprint AS deviceFingerprint, ActionType AS actionType, Resource AS resource,
        Details AS details, SessionId AS sessionId, SessionDuration AS sessionDuration,
        RequestMethod AS requestMethod, RequestUrl AS requestUrl
      FROM dbo.UserActivityLog
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${order}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;

    const dataResult = await request.query(dataQuery);

    res.json({
      data: dataResult.recordset.map(mapActivityRow),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("UserActivity GET error:", err);
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
});

// Export (kept from backend)
router.get("/export", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TOP 1000 UserName, UserEmail, UserRole, EventType, ActionType, Resource, Details, 
             IpAddress, DeviceInfo, SessionId, CreatedAt
      FROM dbo.UserActivityLog ORDER BY CreatedAt DESC
    `);

    const rows = result.recordset;
    if (!rows.length) return res.status(404).send("No data to export");

    const headers = Object.keys(rows[0]).join(",");
    const csvData = rows.map(row =>
      Object.values(row).map(val => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=activity_audit_log.csv");
    res.send(`${headers}\n${csvData}`);
  } catch (err) {
    res.status(500).json({ error: "Export failed" });
  }
});

// POST - Log Activity (kept from backend with broadcast)
router.post("/", authMiddleware, async (req, res) => {
  const { userId, userName, userEmail, userRole, event, ...rest } = req.body || {};

  if (!userId || !userName || !event) {
    return res.status(400).json({ error: "userId, userName and event are required" });
  }

  try {
    const pool = getPool();
    await pool.request()
      .input("userId", sql.NVarChar(50), String(userId))
      .input("userName", sql.NVarChar(100), String(userName))
      .input("userEmail", sql.NVarChar(100), userEmail ? String(userEmail) : null)
      .input("userRole", sql.NVarChar(50), userRole ? String(userRole) : null)
      .input("event", sql.NVarChar(20), String(event))
      .input("ipAddress", sql.NVarChar(50), rest.ipAddress || "unknown")
      .input("deviceInfo", sql.NVarChar(255), rest.deviceInfo || "unknown")
      .input("deviceFingerprint", sql.NVarChar(100), rest.deviceFingerprint || null)
      .input("actionType", sql.NVarChar(50), rest.actionType || null)
      .input("resource", sql.NVarChar(200), rest.resource || null)
      .input("details", sql.NVarChar(sql.MAX), rest.details || null)
      .input("sessionId", sql.NVarChar(50), rest.sessionId || null)
      .input("sessionDuration", sql.Int, Number.isFinite(Number(rest.sessionDuration)) ? Number(rest.sessionDuration) : null)
      .input("requestMethod", sql.NVarChar(10), rest.requestMethod ? String(rest.requestMethod).toUpperCase() : null)
      .input("requestUrl", sql.NVarChar(500), rest.requestUrl || null)
      .input("createdAt", sql.DateTime2, new Date())
      .query(`
        INSERT INTO dbo.UserActivityLog (UserId, UserName, UserEmail, UserRole, EventType, IpAddress, DeviceInfo,
          DeviceFingerprint, ActionType, Resource, Details, SessionId, SessionDuration, RequestMethod, RequestUrl, CreatedAt)
        VALUES (@userId, @userName, @userEmail, @userRole, @event, @ipAddress, @deviceInfo, @deviceFingerprint,
          @actionType, @resource, @details, @sessionId, @sessionDuration, @requestMethod, @requestUrl, @createdAt)
      `);

    // Broadcast to SSE
    const newLog = { ...req.body, id: Date.now(), timestamp: new Date().toISOString() };
    activeStreams.forEach(client => {
      if (!client.writableEnded) {
        client.write(`data: ${JSON.stringify([mapActivityRow(newLog)])}\n\n`);
      }
    });

    res.json({ message: "Activity logged successfully" });
  } catch (err) {
    console.error("UserActivity POST error:", err);
    res.status(500).json({ error: "Failed to log activity" });
  }
});

// Session details
router.get("/session/:sessionId", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("sessionId", sql.NVarChar(50), req.params.sessionId)
      .query(`SELECT * FROM dbo.UserActivityLog WHERE SessionId = @sessionId ORDER BY CreatedAt ASC`);
    res.json(result.recordset.map(mapActivityRow));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch session activity" });
  }
});

// SSE Stream
router.get("/stream", authMiddleware, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  activeStreams.push(res);

  const sendLatest = async () => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`SELECT TOP 25 * FROM dbo.UserActivityLog ORDER BY CreatedAt DESC`);
      res.write(`data: ${JSON.stringify(result.recordset.map(mapActivityRow))}\n\n`);
    } catch (err) {
      console.error("SSE error:", err);
    }
  };

  await sendLatest();
  const interval = setInterval(sendLatest, 5000);

  req.on("close", () => {
    activeStreams = activeStreams.filter(s => s !== res);
    clearInterval(interval);
    res.end();
  });
});

module.exports = router;