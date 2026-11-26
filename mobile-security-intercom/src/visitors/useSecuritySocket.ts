// The app's live line to the server (backend/socket.js). One connection for the app, opened with the signed-in token:
// staff land in the room user:<id>, residents (customer-portal token) in customer:<id>. Events:
//   "security:visitor" { requestId, status, ... }  a request was raised, escalated, decided or timed out
//   "security:call"    { callId, status }          a call is ringing for you, or changed
// Push notifications and the screens' own re-reading still cover anything the socket misses.
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";

export type VisitorEvent = { requestId: number; status: string; escalated?: boolean; decidedBy?: string | null };

let socket: Socket | null = null;
let users = 0;

async function connect() {
  if (socket) return socket;
  const token = await getToken();
  if (!token) return null;
  socket = io(API_BASE_URL, { auth: { token }, transports: ["websocket", "polling"], reconnection: true });
  return socket;
}

/** Calls `onEvent` for every visitor event while mounted. */
export function useVisitorEvents(enabled: boolean, onEvent: (e: VisitorEvent) => void) {
  useSocketEvent<VisitorEvent>("security:visitor", enabled, onEvent);
}

/** Any server event on the shared socket ("security:visitor", "security:call", …) while mounted. */
export function useSocketEvent<T>(event: string, enabled: boolean, onEvent: (e: T) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    let s: Socket | null = null;
    const handler = (e: T) => ref.current(e);
    let cancelled = false;
    users++;
    void connect().then((c) => {
      if (cancelled || !c) return;
      s = c;
      c.on(event, handler);
    });
    return () => {
      cancelled = true;
      s?.off(event, handler);
      users--;
      if (users <= 0 && socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, [enabled, event]);
}
