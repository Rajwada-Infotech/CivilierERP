const express = require("express");
const router = express.Router();
const logger = require("../logger");
const { getPool, sql } = require("../db");
const {
  redisZScore,
  redisZIncrBy,
  getSystemMetrics,
  getPredictedRPM,
  getDynamicLimit,
} = require("../redis");

const { checkPermission } = require("../middleware/permissions");
const { cache } = require("../middleware/cache"); // ← FIX 1: import cache

const ALLOWED_ACTION_TYPES = new Set([
  "read",
  "create",
  "update",
  "delete",
  "export",
  "settings_change",
]);

function normalizePositiveInt(value, fallback) {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeNullableString(value, maxLength) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

let activeStreams = [];

function mapActivityRow(row) {
  return {
    id: String(row.id ?? row.Id ?? ""),
    userId: row.userId ?? row.UserId,
    userName: row.userName ?? row.UserName,
    userEmail: row.userEmail ?? row.UserEmail,
    userRole: row.userRole ?? row.UserRole,
    event: row.event ?? row.EventType,
    timestamp: row.timestamp ?? row.CreatedAt,
    ipAddress: row.ipAddress ?? row.IpAddress,
    deviceInfo: row.deviceInfo ?? row.DeviceInfo,
    deviceFingerprint: row.deviceFingerprint ?? row.DeviceFingerprint,
    actionType: row.actionType ?? row.ActionType,
    resource: row.resource ?? row.Resource,
    details: row.details ?? row.Details,
    sessionId: row.sessionId ?? row.SessionId,
    sessionDuration: row.sessionDuration ?? row.SessionDuration,
    requestMethod: row.requestMethod ?? row.RequestMethod,
    requestUrl: row.requestUrl ?? row.RequestUrl,
  };
}

// GET paginated activity logs
router.get(
  "/",
  checkPermission("UserActivity", "List", "CanView"),
  // FIX 1: Add cache middleware — 60-second TTL, scoped per user.
  // Short TTL keeps data fresh; cache busts automatically when a new
  // activity is posted (bump cache version in POST handler below).
  cache("user-activity", 60),
  async (req, res) => {
    let whereClause = "1 = 1";

    try {
      const pool = getPool();

      const page = Math.max(1, normalizePositiveInt(req.query.page, 1));

      // FIX 2: Run all Redis pre-flight calls in parallel instead of serially.
      // Original code awaited each one sequentially (~3 round trips).
      // Promise.all collapses them into a single wait (~1 round trip).
      const [engagementScore, metrics, predictedRPM] = await Promise.all([
        req.user?.userId
          ? redisZScore("engagement:score", req.user.userId).then((s) =>
              Number(s || 0),
            )
          : Promise.resolve(0),
        getSystemMetrics(),
        getPredictedRPM(),
      ]);

      const dynamicDefault = getDynamicLimit(
        engagementScore,
        predictedRPM || metrics.rpm,
        metrics.memoryUsage,
      );
      const limit = Math.min(
        normalizePositiveInt(req.query.limit, dynamicDefault),
        1000,
      );
      const offset = (page - 1) * limit;

      const search = (req.query.search || "").trim().toLowerCase();
      const eventFilter = req.query.event || "";
      const roleFilter = req.query.role || "";
      const sortField = req.query.sort || "timestamp";
      const order = req.query.order === "asc" ? "ASC" : "DESC";

      let computedDateFrom = req.query.dateFrom;
      let computedDateTo = req.query.dateTo;
      const period = req.query.period;

      if (period) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (period === "today") {
          computedDateFrom = now.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
        } else if (period === "yesterday") {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          computedDateFrom = yesterday.toISOString().slice(0, 10);
          computedDateTo = now.toISOString().slice(0, 10);
        } else if (period === "this-week") {
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          computedDateFrom = weekStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
        } else if (period === "this-month") {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          computedDateFrom = monthStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
        } else if (period === "last-month") {
          const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          computedDateFrom = lmStart.toISOString().slice(0, 10);
          computedDateTo = new Date(lmEnd.getTime() + 86400000)
            .toISOString()
            .slice(0, 10);
        } else if (period === "this-year") {
          const yearStart = new Date(now.getFullYear(), 0, 1);
          computedDateFrom = yearStart.toISOString().slice(0, 10);
          computedDateTo = tomorrow.toISOString().slice(0, 10);
        }
      }

      const whereConditions = ["1 = 1"];
      const queryInputs = [];

      if (search) {
        whereConditions.push(
          "(LOWER(UserName) LIKE @searchTerm OR LOWER(UserEmail) LIKE @searchTerm OR LOWER(IpAddress) LIKE @searchTerm OR LOWER(DeviceInfo) LIKE @searchTerm)",
        );
        queryInputs.push(["searchTerm", sql.NVarChar, `%${search}%`]);
      }

      if (eventFilter) {
        whereConditions.push("EventType = @eventFilter");
        queryInputs.push(["eventFilter", sql.NVarChar(20), eventFilter]);
      }

      if (roleFilter) {
        whereConditions.push("UserRole = @roleFilter");
        queryInputs.push(["roleFilter", sql.NVarChar(50), roleFilter]);
      }

      if (computedDateFrom) {
        whereConditions.push("CreatedAt >= @dateFrom");
        queryInputs.push([
          "dateFrom",
          sql.DateTime2,
          new Date(computedDateFrom),
        ]);
      }

      if (computedDateTo) {
        const dateToObj = new Date(computedDateTo);
        dateToObj.setHours(23, 59, 59, 999);
        whereConditions.push("CreatedAt <= @dateTo");
        queryInputs.push(["dateTo", sql.DateTime2, dateToObj]);
      }

      whereClause = whereConditions.join(" AND ");

      const sortColumn =
        sortField === "userName"
          ? "UserName"
          : sortField === "event"
            ? "EventType"
            : "CreatedAt";

      // FIX 3: Single query using COUNT(*) OVER() as a window function.
      // The original code ran two separate round-trips to SQL Server:
      //   • SELECT COUNT(*) … (full index scan)
      //   • SELECT … OFFSET … FETCH NEXT … (second full scan + key lookup)
      // With COUNT(*) OVER() the engine scans the filtered set once and
      // returns total alongside each data row — half the DB round-trips.
      const dataRequest = pool.request();
      for (const [name, type, value] of queryInputs) {
        dataRequest.input(name, type, value);
      }

      const dataResult = await dataRequest.query(`
        SELECT
          Id AS id, UserId AS userId, UserName AS userName,
          UserEmail AS userEmail, UserRole AS userRole,
          EventType AS event, CreatedAt AS timestamp,
          IpAddress AS ipAddress, DeviceInfo AS deviceInfo,
          DeviceFingerprint AS deviceFingerprint,
          ActionType AS actionType, Resource AS resource,
          Details AS details, SessionId AS sessionId,
          SessionDuration AS sessionDuration,
          RequestMethod AS requestMethod, RequestUrl AS requestUrl,
          COUNT(*) OVER() AS totalCount
        FROM dbo.UserActivityLog
        WHERE ${whereClause}
        ORDER BY ${sortColumn} ${order}
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);

      // totalCount is on every row; read from first row (0 if result empty)
      const total = dataResult.recordset[0]?.totalCount ?? 0;

      res.json({
        data: dataResult.recordset.map(mapActivityRow),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      });
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("UserActivity error:", err.message);
      }
      res.status(500).json({
        error: "Failed to fetch activity logs",
        details:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Internal error",
      });
    }
  },
);

// SSE stream - IMPROVED FOR VERCEL
router.get(
  "/stream",
  checkPermission("UserActivity", "List", "CanView"),
  async (req, res) => {
    let pingInterval;
    let dataInterval;

    const safeWrite = (payload) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(payload);
      } catch (err) {
        logger.error({ err, requestId: req.id }, "SSE write failed");
        cleanup();
      }
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (res.flushHeaders) {
      res.flushHeaders();
    }

    res.setTimeout(0);
    safeWrite(":ok\n\n");
    activeStreams.push(res);

    const sendLatest = async () => {
      if (res.writableEnded || res.destroyed) return;

      try {
        const pool = getPool();
        const result = await pool
          .request()
          .query(
            "SELECT TOP 25 * FROM dbo.UserActivityLog ORDER BY CreatedAt DESC",
          );

        if (!res.writableEnded && !res.destroyed) {
          safeWrite(
            `data: ${JSON.stringify(result.recordset.map(mapActivityRow))}\n\n`,
          );
        }
      } catch (err) {
        logger.error({ err, requestId: req.id }, "SSE data error");
      }
    };

    const sendPing = () => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(":ping\n\n");
      } catch (err) {
        logger.error({ err, requestId: req.id }, "SSE ping failed");
        cleanup();
      }
    };

    try {
      await sendLatest();
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("SSE initial send error:", err.message);
      }
    }

    pingInterval = setInterval(sendPing, 15000);
    dataInterval = setInterval(sendLatest, 5000);

    const cleanup = () => {
      activeStreams = activeStreams.filter((stream) => stream !== res);
      if (pingInterval) clearInterval(pingInterval);
      if (dataInterval) clearInterval(dataInterval);
      pingInterval = null;
      dataInterval = null;
    };

    req.on("close", () => {
      cleanup();
    });

    req.on("error", (err) => {
      if (err.code !== "ECONNRESET") {
        if (process.env.NODE_ENV === "development") {
          console.error("SSE request error:", err.message);
        }
      }
      cleanup();
    });

    res.on("error", (err) => {
      if (err.code !== "ECONNRESET") {
        if (process.env.NODE_ENV === "development") {
          console.error("SSE response error:", err.message);
        }
      }
      cleanup();
    });
  },
);

// Session timeline
router.get(
  "/session/:sessionId",
  checkPermission("UserActivity", "List", "CanView"),
  async (req, res) => {
    try {
      const pool = getPool();

      const result = await pool
        .request()
        .input("sessionId", sql.NVarChar(50), req.params.sessionId)
        .query(
          "SELECT * FROM dbo.UserActivityLog WHERE SessionId = @sessionId ORDER BY CreatedAt ASC",
        );

      res.json(result.recordset.map(mapActivityRow));
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Session error:", err.message);
      }
      res.status(500).json({ error: "Failed to fetch session activity" });
    }
  },
);

// POST activity
router.post("/", async (req, res) => {
  const { userId, userName, userEmail, userRole, event, ...rest } =
    req.body || {};

  const resolvedUserId = normalizeNullableString(
    userId ?? req.user?.userId ?? req.user?.id,
    50,
  );
  const resolvedUserName =
    normalizeNullableString(
      userName ?? req.user?.name ?? req.user?.email ?? "Unknown User",
      100,
    ) || "Unknown User";
  const resolvedUserEmail = normalizeNullableString(
    userEmail ?? req.user?.email,
    100,
  );
  const resolvedUserRole = normalizeNullableString(
    userRole ?? req.user?.role,
    50,
  );
  const normalizedEvent = normalizeNullableString(event, 20);
  const normalizedActionType = ALLOWED_ACTION_TYPES.has(rest.actionType)
    ? rest.actionType
    : null;

  if (!resolvedUserId || !resolvedUserName || !normalizedEvent) {
    return res
      .status(400)
      .json({ error: "userId, userName and event are required" });
  }

  if (normalizedActionType && resolvedUserId) {
    const WEIGHTS = {
      read: 1,
      settings_change: 3,
      export: 5,
      update: 8,
      create: 10,
      delete: 15,
    };
    const weight = WEIGHTS[normalizedActionType] || 2;
    await redisZIncrBy("engagement:score", weight, resolvedUserId, 2592000);
  }

  try {
    const pool = getPool();

    const insertResult = await pool
      .request()
      .input("userId", sql.NVarChar(50), resolvedUserId)
      .input("userName", sql.NVarChar(100), resolvedUserName)
      .input("userEmail", sql.NVarChar(100), resolvedUserEmail)
      .input("userRole", sql.NVarChar(50), resolvedUserRole)
      .input("event", sql.NVarChar(20), normalizedEvent)
      .input(
        "ipAddress",
        sql.NVarChar(50),
        normalizeNullableString(rest.ipAddress, 50) || "unknown",
      )
      .input(
        "deviceInfo",
        sql.NVarChar(255),
        normalizeNullableString(rest.deviceInfo, 255) || "unknown",
      )
      .input(
        "deviceFingerprint",
        sql.NVarChar(100),
        normalizeNullableString(rest.deviceFingerprint, 100),
      )
      .input("actionType", sql.NVarChar(50), normalizedActionType)
      .input(
        "resource",
        sql.NVarChar(200),
        normalizeNullableString(rest.resource, 200),
      )
      .input(
        "details",
        sql.NVarChar(sql.MAX),
        normalizeNullableString(rest.details),
      )
      .input(
        "sessionId",
        sql.NVarChar(50),
        normalizeNullableString(rest.sessionId, 50),
      )
      .input(
        "sessionDuration",
        sql.Int,
        normalizeNullableInt(rest.sessionDuration),
      )
      .input(
        "requestMethod",
        sql.NVarChar(10),
        normalizeNullableString(rest.requestMethod, 10),
      )
      .input(
        "requestUrl",
        sql.NVarChar(500),
        normalizeNullableString(rest.requestUrl, 500),
      )
      .input("createdAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.UserActivityLog (
          UserId, UserName, UserEmail, UserRole, EventType,
          IpAddress, DeviceInfo, DeviceFingerprint,
          ActionType, Resource, Details,
          SessionId, SessionDuration,
          RequestMethod, RequestUrl, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @userId, @userName, @userEmail, @userRole, @event,
          @ipAddress, @deviceInfo, @deviceFingerprint,
          @actionType, @resource, @details,
          @sessionId, @sessionDuration,
          @requestMethod, @requestUrl, @createdAt
        )
      `);

    const insertedId = insertResult.recordset?.[0]?.Id ?? null;

    // FIX 1 (cont.): Bump cache version so the next GET sees fresh data.
    // This is fire-and-forget — we don't await it so the POST response
    // is not delayed by the Redis round-trip.
    const { bumpCacheVersion } = require("../redis");
    bumpCacheVersion("user-activity").catch(() => {});

    res.json({ message: "Activity logged", id: insertedId });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("POST activity error:", err.message);
    }
    res.status(500).json({
      error: "Failed to log activity",
      details:
        process.env.NODE_ENV === "development" ? err.message : "Internal error",
    });
  }
});

module.exports = router;
