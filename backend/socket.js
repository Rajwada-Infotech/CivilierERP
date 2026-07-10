/**
 * socket.js — Socket.io singleton for CivilierERP
 *
 * Usage:
 *   const { initSocket, getIo } = require('./socket');
 *   initSocket(httpServer);          // call once in startServer()
 *   getIo().emit('activity:new', …); // call anywhere
 */

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const logger = require("./logger");
const { getPool, sql } = require("./db");
const { normalizeRole } = require("./middleware/role");
const { ALLOWED_ORIGINS } = require("./config/origins");
const { redisGetStrict } = require("./redis");
const BLACKLIST_PREFIX = "bl:";
async function isTokenBlacklisted(token) {
  try {
    const val = await redisGetStrict(`${BLACKLIST_PREFIX}${token}`);
    return val === "1";
  } catch (err) {
    // Fail-open: a Redis outage must not silently block all socket connections.
    // Log the problem so ops can investigate, but allow the connection through
    // since the JWT signature is still verified above.
    logger.warn(
      { event: "REDIS_BLACKLIST_CHECK_FAILED", err: err?.message },
      "Redis unavailable for blacklist check — allowing socket connection",
    );
    return false;
  }
}

/** @type {import('socket.io').Server | null} */
let io = null;

function isTicketAdmin(role) {
  return ["admin", "super_admin", "dba", "engineer"].includes(
    normalizeRole(role),
  );
}

async function canAccessTicket(ticketId, user) {
  if (!user?.userId && !user?.id) return false;
  if (isTicketAdmin(user.role)) return true;

  const userId = Number(user.userId ?? user.id);
  if (!Number.isInteger(userId) || userId <= 0) return false;

  const pool = getPool();
  const result = await pool
    .request()
    .input("ticketId", sql.Int, ticketId)
    .input("userId", sql.Int, userId).query(`
      SELECT TOP 1 id
      FROM dbo.tickets
      WHERE id = @ticketId
        AND (created_by_id = @userId OR assigned_to_id = @userId)
    `);

  return result.recordset.length > 0;
}

// Staff with Material module access can see any PO's chat; a supplier user
// may only join the room for a PO addressed to their own AccountHeadMaster
// link (dbo.users.LinkedLHeadId === PurchaseOrders.SupplierID).
async function canAccessPO(poId, user) {
  if (!user?.userId && !user?.id) return false;
  const role = normalizeRole(user.role);
  if (role !== "supplier") return true; // staff — page-right already gated the REST endpoints

  const userId = Number(user.userId ?? user.id);
  if (!Number.isInteger(userId) || userId <= 0) return false;

  const pool = getPool();
  const result = await pool
    .request()
    .input("poId", sql.Int, poId)
    .input("userId", sql.Int, userId).query(`
      SELECT TOP 1 po.PurchaseOrderID
      FROM dbo.PurchaseOrders po
      JOIN dbo.users u ON u.LinkedLHeadId = po.SupplierID
      WHERE po.PurchaseOrderID = @poId AND u.id = @userId
    `);

  return result.recordset.length > 0;
}

/**
 * Attach socket.io to an existing http.Server.
 * Must be called before startServer resolves.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Vercel / reverse-proxy: prefer polling so the upgrade stays optional
    transports: ["polling", "websocket"],
    // Keep pings frequent — avoids proxy 30-second idle timeouts
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // ── JWT handshake ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    // Clients send token via auth object: socket({ auth: { token } })
    const token = socket.handshake.auth?.token || null;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const blacklisted = await isTokenBlacklisted(token);
      if (blacklisted) return next(new Error("Token has been revoked"));
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  // ── Connection lifecycle ─────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const { userId, role, roleId } = socket.data.user || {};
    logger.info(
      { event: "SOCKET_CONNECT", socketId: socket.id, userId, role },
      "Socket connected"
    );

    // Each user automatically joins their personal room for targeted emits.
    if (userId) socket.join(`user:${userId}`);

    // Every user also joins a room scoped to their RoleId, so a change to
    // role-level rights (RoleRights) can be pushed to everyone holding that
    // role in one emit, without needing to look up each user's socket.
    if (roleId) socket.join(`role:${roleId}`);

    // Ticket admins watch ticket/activity broadcasts.
    if (isTicketAdmin(role)) {
      socket.join("activity-watchers");
    }

    socket.on("ticket:join", async (ticketId, ack) => {
      const id = Number(ticketId);
      if (!Number.isInteger(id) || id <= 0) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid ticket id" });
        return;
      }

      try {
        const allowed = await canAccessTicket(id, socket.data.user);
        if (!allowed) {
          if (typeof ack === "function") ack({ ok: false, error: "Access denied" });
          return;
        }

        socket.join(`ticket:${id}`);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        logger.warn(
          { event: "SOCKET_TICKET_JOIN_ERROR", socketId: socket.id, ticketId: id, err },
          "Ticket room join failed",
        );
        if (typeof ack === "function") ack({ ok: false, error: "Join failed" });
      }
    });

    socket.on("ticket:leave", (ticketId) => {
      const id = Number(ticketId);
      if (Number.isInteger(id) && id > 0) {
        socket.leave(`ticket:${id}`);
      }
    });

    socket.on("ticket:typing", async (payload = {}) => {
      const id = Number(payload.ticketId);
      if (!Number.isInteger(id) || id <= 0) return;

      try {
        const allowed = await canAccessTicket(id, socket.data.user);
        if (!allowed) return;

        // SEC-002: always derive identity from the authenticated JWT token.
        // Never trust client-supplied name/role/userId — they can be spoofed
        // to impersonate other users in the typing indicator UI.
        const authedUser = socket.data.user || {};
        socket.to(`ticket:${id}`).emit("ticket:typing", {
          ticketId: id,
          userId: Number(authedUser.userId ?? authedUser.id ?? null) || null,
          name: String(authedUser.name ?? authedUser.username ?? "Unknown"),
          role: String(authedUser.role ?? "user"),
          isTyping: Boolean(payload.isTyping),
        });
      } catch (err) {
        logger.warn(
          {
            event: "SOCKET_TICKET_TYPING_ERROR",
            socketId: socket.id,
            ticketId: id,
            err,
          },
          "Ticket typing broadcast failed",
        );
      }
    });

    socket.on("po:join", async (poId, ack) => {
      const id = Number(poId);
      if (!Number.isInteger(id) || id <= 0) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid order id" });
        return;
      }

      try {
        const allowed = await canAccessPO(id, socket.data.user);
        if (!allowed) {
          if (typeof ack === "function") ack({ ok: false, error: "Access denied" });
          return;
        }

        socket.join(`po:${id}`);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        logger.warn(
          { event: "SOCKET_PO_JOIN_ERROR", socketId: socket.id, poId: id, err },
          "PO room join failed",
        );
        if (typeof ack === "function") ack({ ok: false, error: "Join failed" });
      }
    });

    socket.on("po:leave", (poId) => {
      const id = Number(poId);
      if (Number.isInteger(id) && id > 0) {
        socket.leave(`po:${id}`);
      }
    });

    socket.on("po:typing", async (payload = {}) => {
      const id = Number(payload.poId);
      if (!Number.isInteger(id) || id <= 0) return;

      try {
        const allowed = await canAccessPO(id, socket.data.user);
        if (!allowed) return;

        const authedUser = socket.data.user || {};
        socket.to(`po:${id}`).emit("po:typing", {
          poId: id,
          userId: Number(authedUser.userId ?? authedUser.id ?? null) || null,
          name: String(authedUser.name ?? authedUser.username ?? "Unknown"),
          role: String(authedUser.role ?? "user"),
          isTyping: Boolean(payload.isTyping),
        });
      } catch (err) {
        logger.warn(
          { event: "SOCKET_PO_TYPING_ERROR", socketId: socket.id, poId: id, err },
          "PO typing broadcast failed",
        );
      }
    });

    // ── DBA session tracking ─────────────────────────────────────────────────
    // DBA / super_admin users can join a shared room to see who else is active
    // and get a live feed of executed queries across all DBA sessions.
    const isDba = ["dba", "super_admin"].includes(
      normalizeRole(socket.data.user?.role)
    );

    if (isDba) {
      socket.on("dba:join", () => {
        socket.join("dba-sessions");
        // Tell every other DBA that this user joined
        socket.to("dba-sessions").emit("dba:session-update", {
          type: "join",
          socketId: socket.id,
          userId,
          name: socket.data.user?.name ?? socket.data.user?.username ?? "DBA",
          joinedAt: new Date().toISOString(),
        });
      });

      // Client emits this after a query completes so all DBA sessions see it
      socket.on("dba:query", (payload) => {
        socket.to("dba-sessions").emit("dba:query-log", {
          socketId: socket.id,
          userId,
          name: socket.data.user?.name ?? socket.data.user?.username ?? "DBA",
          query: String(payload?.query ?? "").slice(0, 500),
          rowCount: payload?.rowCount ?? 0,
          duration: payload?.duration ?? 0,
          status: payload?.status ?? "success",
          at: new Date().toISOString(),
        });
      });
    }

    socket.on("disconnect", (reason) => {
      logger.info(
        { event: "SOCKET_DISCONNECT", socketId: socket.id, userId, reason },
        "Socket disconnected"
      );
      if (isDba) {
        socket.to("dba-sessions").emit("dba:session-update", {
          type: "leave",
          socketId: socket.id,
          userId,
        });
      }
    });
  });

  logger.info("[SOCKET] Socket.io initialized");
  return io;
}

/** Returns the io instance. Throws if initSocket() was never called. */
function getIo() {
  if (!io) throw new Error("Socket.io not initialized. Call initSocket() first.");
  return io;
}

module.exports = { initSocket, getIo };
