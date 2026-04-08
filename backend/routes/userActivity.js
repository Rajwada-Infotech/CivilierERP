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
    id: String(row.id),
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    userRole: row.userRole,
    event: row.event,
    timestamp: row.timestamp,
    ipAddress: row.ipAddress,
    deviceInfo: row.deviceInfo,
    deviceFingerprint: row.deviceFingerprint,
    actionType: row.actionType,
    resource: row.resource,
    details: row.details,
    sessionId: row.sessionId,
    sessionDuration: row.sessionDuration,
    requestMethod: row.requestMethod,
    requestUrl: row.requestUrl,
  };
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const {
      limit = 100,
      offset = 0,
      event,
      actionType,
      resource,
      sessionId,
      userId,
      dateFrom,
      dateTo,
      period
    } = req.query;

    // Compute date range from period preset
    let computedDateFrom = dateFrom;
    let computedDateTo = dateTo;
    if (period) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      switch (period) {
        case 'today':
          computedDateFrom = now.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case 'yesterday':
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayEnd = new Date(now);
          computedDateFrom = yesterday.toISOString().slice(0, 10);
          computedDateTo = yesterdayEnd.toISOString().slice(0, 10);
          break;
        case 'this-week':
          const thisWeekStart = new Date(now);
          thisWeekStart.setDate(now.getDate() - now.getDay());
          computedDateFrom = thisWeekStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case 'this-month':
          const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          computedDateFrom = thisMonthStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        case 'last-month':
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          computedDateFrom = lastMonth.toISOString().slice(0, 10);
          computedDateTo = new Date(lastMonthEnd.getTime() + 86400000).toISOString().slice(0, 10);
          break;
        case 'this-year':
          const thisYearStart = new Date(now.getFullYear(), 0, 1);
          computedDateFrom = thisYearStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
          break;
        default:
          break;
      }
    }

    const limitNum = normalizePositiveInt(limit, 100);
    const offsetNum = normalizePositiveInt(offset, 0);
    const request = pool.request();

    let query = `
      SELECT
        Id AS id,
        UserId AS userId,
        UserName AS userName,
        UserEmail AS userEmail,
        UserRole AS userRole,
        EventType AS event,
        CreatedAt AS timestamp,
        IpAddress AS ipAddress,
        DeviceInfo AS deviceInfo,
        DeviceFingerprint AS deviceFingerprint,
        ActionType AS actionType,
        Resource AS resource,
        Details AS details,
        SessionId AS sessionId,
        SessionDuration AS sessionDuration,
        RequestMethod AS requestMethod,
        RequestUrl AS requestUrl
      FROM dbo.UserActivityLog
      WHERE 1 = 1
    `;

    if (event) {
      query += " AND EventType = @event";
      request.input("event", sql.NVarChar(20), String(event));
    }

    if (actionType) {
      query += " AND ActionType = @actionType";
      request.input("actionType", sql.NVarChar(50), String(actionType));
    }

    if (resource) {
      query += " AND Resource LIKE @resource";
      request.input("resource", sql.NVarChar(200), `%${String(resource)}%`);
    }

    if (sessionId) {
      query += " AND SessionId = @sessionId";
      request.input("sessionId", sql.NVarChar(50), String(sessionId));
    }

    if (userId) {
      query += " AND UserId = @userId";
      request.input("userId", sql.NVarChar(50), String(userId));
    }

    if (computedDateFrom) {
      query += " AND CreatedAt >= @dateFrom";
      request.input("dateFrom", sql.DateTime2, new Date(computedDateFrom + (computedDateFrom.includes('T') ? '' : "T00:00:00Z")));
    }
    if (computedDateTo) {
      let dateToObj = new Date(computedDateTo + (computedDateTo.includes('T') ? '' : "T00:00:00Z"));
      // If manual date entry (custom range from UI), length is 10 (YYYY-MM-DD).
      // We make it inclusive by adding 1 day since we use the '<' operator.
      if (!period && computedDateTo.length === 10) {
        dateToObj.setDate(dateToObj.getDate() + 1);
      }
      query += " AND CreatedAt < @dateTo";
      request.input("dateTo", sql.DateTime2, dateToObj);
    }

    query += `
      ORDER BY CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    request.input("offset", sql.Int, offsetNum);
    request.input("limit", sql.Int, limitNum);

    const result = await request.query(query);
    res.json(result.recordset.map(mapActivityRow));
  } catch (err) {
    console.error("UserActivity GET error:", err);
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
});

router.get("/export", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    // Fetch last 1000 logs for export
    const result = await pool.request().query(`
      SELECT TOP 1000
        UserName, UserEmail, UserRole, EventType, ActionType, Resource, 
        Details, IpAddress, DeviceInfo, SessionId, CreatedAt
      FROM dbo.UserActivityLog
      ORDER BY CreatedAt DESC
    `);

    const rows = result.recordset;
    if (!rows.length) return res.status(404).send("No data to export");

    const headers = Object.keys(rows[0]).join(",");
    const csvData = rows.map(row => 
      Object.values(row).map(val => {
        const str = String(val ?? "");
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=activity_audit_log.csv");
    res.status(200).send(`${headers}\n${csvData}`);
  } catch (err) {
    res.status(500).json({ error: "Export failed" });
  }
});

router.post("/", authMiddleware, async (req, res) => {
  const {
    userId,
    userName,
    userEmail,
    userRole,
    event,
    ipAddress,
    deviceInfo,
    deviceFingerprint,
    actionType,
    resource,
    details,
    sessionId,
    sessionDuration,
    requestMethod,
    requestUrl,
  } = req.body || {};

  if (!userId || !userName || !event) {
    return res.status(400).json({
      error: "userId, userName and event are required",
    });
  }

  try {
    const pool = getPool();

    await pool
      .request()
      .input("userId", sql.NVarChar(50), String(userId))
      .input("userName", sql.NVarChar(100), String(userName))
      .input("userEmail", sql.NVarChar(100), userEmail ? String(userEmail) : null)
      .input("userRole", sql.NVarChar(50), userRole ? String(userRole) : null)
      .input("event", sql.NVarChar(20), String(event))
      .input("ipAddress", sql.NVarChar(50), ipAddress ? String(ipAddress) : "unknown")
      .input("deviceInfo", sql.NVarChar(255), deviceInfo ? String(deviceInfo) : "unknown")
      .input(
        "deviceFingerprint",
        sql.NVarChar(100),
        deviceFingerprint ? String(deviceFingerprint) : null,
      )
      .input("actionType", sql.NVarChar(50), actionType ? String(actionType) : null)
      .input("resource", sql.NVarChar(200), resource ? String(resource) : null)
      .input("details", sql.NVarChar(sql.MAX), details ? String(details) : null)
      .input("sessionId", sql.NVarChar(50), sessionId ? String(sessionId) : null)
      .input(
        "sessionDuration",
        sql.Int,
        Number.isFinite(Number(sessionDuration)) ? Number(sessionDuration) : null,
      )
      .input(
        "requestMethod",
        sql.NVarChar(10),
        requestMethod ? String(requestMethod).toUpperCase() : null,
      )
      .input("requestUrl", sql.NVarChar(500), requestUrl ? String(requestUrl) : null)
      .input("createdAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.UserActivityLog (
          UserId,
          UserName,
          UserEmail,
          UserRole,
          EventType,
          IpAddress,
          DeviceInfo,
          DeviceFingerprint,
          ActionType,
          Resource,
          Details,
          SessionId,
          SessionDuration,
          RequestMethod,
          RequestUrl,
          CreatedAt
        ) VALUES (
          @userId,
          @userName,
          @userEmail,
          @userRole,
          @event,
          @ipAddress,
          @deviceInfo,
          @deviceFingerprint,
          @actionType,
          @resource,
          @details,
          @sessionId,
          @sessionDuration,
          @requestMethod,
          @requestUrl,
          @createdAt
        )
      `);

    // Broadcast to active SSE streams
    const newLog = { ...req.body, id: Date.now(), timestamp: new Date().toISOString() };
    activeStreams.forEach(client => {
      client.write(`data: ${JSON.stringify([mapActivityRow(newLog)])}\n\n`);
    });

    res.json({ message: "Activity logged successfully" });
  } catch (err) {
    console.error("UserActivity POST error:", err);
    res.status(500).json({ error: "Failed to log activity" });
  }
});

router.get("/session/:sessionId", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const { sessionId } = req.params;

    const result = await pool.request().input("sessionId", sql.NVarChar(50), sessionId).query(`
        SELECT
          Id AS id,
          UserId AS userId,
          UserName AS userName,
          UserEmail AS userEmail,
          UserRole AS userRole,
          EventType AS event,
          CreatedAt AS timestamp,
          IpAddress AS ipAddress,
          DeviceInfo AS deviceInfo,
          DeviceFingerprint AS deviceFingerprint,
          ActionType AS actionType,
          Resource AS resource,
          Details AS details,
          SessionId AS sessionId,
          SessionDuration AS sessionDuration,
          RequestMethod AS requestMethod,
          RequestUrl AS requestUrl
        FROM dbo.UserActivityLog
        WHERE SessionId = @sessionId
        ORDER BY CreatedAt ASC
      `);

    res.json(result.recordset.map(mapActivityRow));
  } catch (err) {
    console.error("UserActivity session GET error:", err);
    res.status(500).json({ error: "Failed to fetch session activity" });
  }
});

router.get("/stream", authMiddleware, async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    activeStreams.push(res);

    const sendData = async () => {
      try {
        const pool = getPool();
        const result = await pool.request().query(`
            SELECT TOP 25
              Id AS id,
              UserId AS userId,
              UserName AS userName,
              UserEmail AS userEmail,
              UserRole AS userRole,
              EventType AS event,
              CreatedAt AS timestamp,
              IpAddress AS ipAddress,
              DeviceInfo AS deviceInfo,
              DeviceFingerprint AS deviceFingerprint,
              ActionType AS actionType,
              Resource AS resource,
              Details AS details,
              SessionId AS sessionId,
              SessionDuration AS sessionDuration,
              RequestMethod AS requestMethod,
              RequestUrl AS requestUrl
            FROM dbo.UserActivityLog
            ORDER BY CreatedAt DESC
          `);

        res.write(`data: ${JSON.stringify(result.recordset.map(mapActivityRow))}\n\n`);
      } catch (err) {
        console.error("SSE fetch error:", err);
      }
    };

    await sendData();

    const interval = setInterval(sendData, 5000);
    activeStreams.push(res);

    req.on("close", () => {
      activeStreams = activeStreams.filter(s => s !== res);
      clearInterval(interval);
      res.end();
    });
  } catch (err) {
    console.error("SSE error:", err);
    res.end();
  }
});

module.exports = router;
