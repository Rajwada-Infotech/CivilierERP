/**
 * src/lib/socket.ts
 *
 * Singleton socket.io-client instance for CivilierERP.
 *
 * Usage:
 *   import { getSocket, connectSocket, disconnectSocket } from '@/lib/socket';
 *
 *   connectSocket();                            // call after login
 *   getSocket()?.on('activity:new', handler);   // listen anywhere
 *   disconnectSocket();                          // call on logout
 */

import { io, type Socket } from "socket.io-client";

// Derive the socket server origin from VITE_API_URL (same host as REST API).
// If the env var is "/api" (Vite proxy) we fall back to window.location.origin
// so socket.io connects to the dev server that proxies /api.
function resolveSocketOrigin(): string {
  const raw = import.meta.env.VITE_API_URL || "";
  if (!raw || raw === "/api" || raw.startsWith("/")) {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
  // Strip trailing /api path if present
  return raw.replace(/\/api\/?$/, "");
}

let socket: Socket | null = null;

/** Connect (or reconnect) with the current JWT token. */
export function connectSocket(): Socket | null {
  if (socket?.connected) return socket;

  const token = localStorage.getItem("token");
  if (!token) {
    // No JWT => don't start socket connection (prevents connect_error spam)
    return null;
  }


  const origin = resolveSocketOrigin();

  socket = io(origin, {
    auth: { token },
    transports: ["polling", "websocket"],
    withCredentials: true,
    // Reconnect with exponential back-off, cap at 30 s
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  });

  if (import.meta.env.DEV) {
    socket.on("connect", () =>
      console.log("[socket] connected", socket?.id),
    );
    socket.on("disconnect", (reason) =>
      console.log("[socket] disconnected", reason),
    );
    socket.on("connect_error", (err) =>
      console.warn("[socket] connect_error", err.message),
    );
  }

  return socket;
}

/** Returns the current socket instance (may be null before connectSocket()). */
export function getSocket(): Socket | null {
  return socket;
}

/** Disconnect and destroy the socket (call on logout). */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
