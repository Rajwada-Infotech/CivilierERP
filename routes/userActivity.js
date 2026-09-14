const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const crypto = require("crypto");
const { getPool, sql } = require("../db");
const {
  redisZScore,
  redisZIncrBy,
  getSystemMetrics,
  getPredictedRPM,
  getDynamicLimit,
} = require("../redis");

const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { cache } = require("../middleware/cache");

// Socket.io — lazy-loaded so the route module works even before initSocket()
// is called (e.g. during unit tests).  getIo() will throw only if it's
// actually called without initSocket() having run first.
let _getIo = null;
function getIo() {
  if (!_getIo) {
    _getIo = require("../socket").getIo;
  }
  return _getIo();
}

const ALLOWED_ACTION_TYPES = new Set([
  "read",
  "create",
  "update",
  "delete",
  "export",
  "settings_change",
]);

const SORT_MAP = {
  userName: "UserName",
  event: "EventType",
  timestamp: "CreatedAt",
};

const ORDER_MAP = {
  asc: "ASC",
  desc: "DESC",
};

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

function computeDateRange(period) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  switch (period) {
    case "today":
      return [new Date(Date.UTC(y, m, d)), new Date(Date.UTC(y, m, d + 1))];
    case "yesterday":
      return [new Date(Date.UTC(y, m, d - 1)), new Date(Date.UTC(y, m, d))];
    case "this-week": {
      const dow = now.getUTCDay() || 7;
      const monday = d - (dow - 1);
      return [
        new Date(Date.UTC(y, m, monday)),
        new Date(Date.UTC(y, m, monday + 7)),
      ];
    }
    case "this-month":
      return [new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1))];
    case "last-month":
      return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1))];
    case "this-year":
      return [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1))];
    default:
      return [null, null];
  }
}

function parseDateBoundary(value, { exclusiveEnd = false } = {}) {
  if (!value) return null;

  const raw = String(value).trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day) + (exclusiveEnd ? 1 : 0),
      ),
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
  cache("user-activity", 10),
  async (req, res) => {
    try {
      const pool = getPool();

      const page = Math.max(1, normalizePositiveInt(req.query.page, 1));

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
      const sortColumn = SORT_MAP[req.query.sort] ?? "CreatedAt";
      const order = ORDER_MAP[req.query.order] ?? "DESC";

      const period = req.query.period;
      const [periodDateFrom, periodDateTo] = computeDateRange(period);
      const computedDateFrom =
        periodDateFrom ?? parseDateBoundary(req.query.dateFrom);
      const computedDateTo =
        periodDateTo ??
        parseDateBoundary(req.query.dateTo, { exclusiveEnd: true });

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
        queryInputs.push(["dateFrom", sql.DateTime2, computedDateFrom]);
      }

      if (computedDateTo) {
        whereConditions.push("CreatedAt < @dateTo");
        queryInputs.push(["dateTo", sql.DateTime2, computedDateTo]);
      }

      const whereClause = whereConditions.join(" AND ");

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

// DELETE activity logs.
//
// Behaviour depends on the caller's role:
//   super_admin  → deletes ALL rows across all users (full wipe)
//   admin        → deletes only their own rows (UserId = req.user.userId)
//
// The "CanDelete" permission gate ensures only authorised roles can reach
// this route at all.  Within that gate, we apply the row-level scope above
// so a regular admin cannot inadvertently (or maliciously) erase another
// user's audit trail.
router.delete(
  "/",
  checkPermission("UserActivity", "List", "CanDelete"),
  async (req, res) => {
    try {
      const pool = getPool();

      const isSuperAdmin =
        req.user?.role === "super_admin" || req.user?.isSuperAdmin === true;

      const userId = normalizeNullableString(
        req.user?.userId ?? req.user?.id,
        50,
      );

      if (!isSuperAdmin && !userId) {
        return res.status(400).json({
          error: "Cannot determine requesting user for scoped delete",
        });
      }

      let deleteResult;

      if (isSuperAdmin) {
        // Full wipe — super_admin only
        deleteResult = await pool
          .request()
          .query(`DELETE FROM dbo.UserActivityLog`);
      } else {
        // Row-level scope: only the requesting user's own records
        deleteResult = await pool
          .request()
          .input("userId", sql.NVarChar(50), userId)
          .query(`DELETE FROM dbo.UserActivityLog WHERE UserId = @userId`);
      }

      const deletedCount = deleteResult.rowsAffected?.[0] ?? 0;

      const { bumpCacheVersion } = require("../redis");
      bumpCacheVersion("user-activity").catch(() => {});

      res.json({
        message: "Activity history cleared",
        deletedCount,
        scope: isSuperAdmin ? "all" : "self",
      });
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("DELETE activity error:", err.message);
      }
      res.status(500).json({ error: "Failed to clear activity history" });
    }
  },
);

// POST activity — logs to DB then broadcasts to activity-watchers room via socket.io
router.post("/", authMiddleware, async (req, res) => {
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

    // Resolve the real client IP: trust X-Forwarded-For (set by proxies/load
    // balancers) first, fall back to the socket remote address, then to the
    // client-supplied value, and finally "unknown".
    const serverIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;
    const resolvedIp =
      serverIp || normalizeNullableString(rest.ipAddress, 50) || "unknown";

    // Prefer the real User-Agent header over whatever the client sent in the
    // body, since the body value is just a JS-parsed string anyway.
    const serverUA = req.headers["user-agent"] || null;
    const resolvedDeviceInfo =
      serverUA || normalizeNullableString(rest.deviceInfo, 255) || "unknown";

    const activityId = crypto.randomUUID();

    const insertResult = await pool
      .request()
      .input("id", sql.NVarChar(50), activityId)
      .input("userId", sql.NVarChar(50), resolvedUserId)
      .input("userName", sql.NVarChar(100), resolvedUserName)
      .input("userEmail", sql.NVarChar(100), resolvedUserEmail)
      .input("userRole", sql.NVarChar(50), resolvedUserRole)
      .input("event", sql.NVarChar(20), normalizedEvent)
      .input("ipAddress", sql.NVarChar(50), resolvedIp)
      .input("deviceInfo", sql.NVarChar(255), resolvedDeviceInfo.slice(0, 255))
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
          Id,
          UserId, UserName, UserEmail, UserRole, EventType,
          IpAddress, DeviceInfo, DeviceFingerprint,
          ActionType, Resource, Details,
          SessionId, SessionDuration,
          RequestMethod, RequestUrl, CreatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @id,
          @userId, @userName, @userEmail, @userRole, @event,
          @ipAddress, @deviceInfo, @deviceFingerprint,
          @actionType, @resource, @details,
          @sessionId, @sessionDuration,
          @requestMethod, @requestUrl, @createdAt
        )
      `);

    const insertedId = insertResult.recordset?.[0]?.Id ?? null;

    // Bump cache version (fire-and-forget)
    const { bumpCacheVersion } = require("../redis");
    bumpCacheVersion("user-activity").catch(() => {});

    // ── Socket.io broadcast ───────────────────────────────────────────────
    // Emit the new activity row to all admin/super_admin sockets so the
    // Activity Browser updates in real-time without polling.
    try {
      const newEntry = {
        id: String(insertedId ?? ""),
        userId: resolvedUserId,
        userName: resolvedUserName,
        userEmail: resolvedUserEmail,
        userRole: resolvedUserRole,
        event: normalizedEvent,
        timestamp: new Date().toISOString(),
        ipAddress: resolvedIp,
        deviceInfo: resolvedDeviceInfo.slice(0, 255),
        deviceFingerprint: normalizeNullableString(rest.deviceFingerprint, 100),
        actionType: normalizedActionType,
        resource: normalizeNullableString(rest.resource, 200),
        details: normalizeNullableString(rest.details),
        sessionId: normalizeNullableString(rest.sessionId, 50),
        sessionDuration: normalizeNullableInt(rest.sessionDuration),
        requestMethod: normalizeNullableString(rest.requestMethod, 10),
        requestUrl: normalizeNullableString(rest.requestUrl, 500),
      };

      getIo().to("activity-watchers").emit("activity:new", newEntry);
    } catch (socketErr) {
      // Never let a socket error fail the HTTP response
      if (process.env.NODE_ENV === "development") {
        console.warn("Socket emit skipped:", socketErr.message);
      }
    }

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
