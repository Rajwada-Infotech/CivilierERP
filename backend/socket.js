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

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "https://civiliererp.vercel.app",
  "https://civiliererp.in",
];

/** @type {import('socket.io').Server | null} */
let io = null;

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
  io.use((socket, next) => {
    // Clients send token via auth object: socket({ auth: { token } })
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      null;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  // ── Connection lifecycle ─────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const { userId, role } = socket.data.user || {};
    logger.info(
      { event: "SOCKET_CONNECT", socketId: socket.id, userId, role },
      "Socket connected"
    );

    // Only admins/super_admins watch the activity feed
    if (role === "admin" || role === "super_admin" || role === "dba") {
      socket.join("activity-watchers");
    }

    socket.on("disconnect", (reason) => {
      logger.info(
        { event: "SOCKET_DISCONNECT", socketId: socket.id, userId, reason },
        "Socket disconnected"
      );
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
