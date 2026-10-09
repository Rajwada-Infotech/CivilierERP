import { useEffect, useRef } from "react";
import { connectSocket, getSocket } from "@/lib/socket";

/**
 * Re-read a list the moment someone changes it, without a page refresh.
 *
 * The server only says WHICH kind of data changed (see backend/services/realtime.js) - never the data itself. This
 * hook calls `onChange` so the page can re-fetch through its normal, permission-checked request. Pages that are not
 * open do nothing, so a change costs one request per page that is actually showing that list.
 *
 *   useLiveData("ledgers", () => reloadLedgerOptions());
 *
 * Topics:
 *   "ledgers" - a ledger / vendor / contractor / customer / partner / bank account head was added, changed or removed
 *
 * Calls are spread out by a short random delay, so fifty people with the page open don't all hit the server in the
 * same instant, and several signals close together become one reload. After the connection drops and comes back the
 * page reloads once as well, since a change during the gap would otherwise be missed.
 */
export type LiveTopic = "ledgers";

export const LIVE_EVENT = "data:changed";
export const LIVE_DELAY_MIN_MS = 150;
export const LIVE_DELAY_SPREAD_MS = 1000;

export function useLiveData(topic: LiveTopic, onChange: () => void): void {
  // Always call the latest callback without re-subscribing every render.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const socket = getSocket() ?? connectSocket();
    if (!socket) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return; // a reload is already coming
      timer = setTimeout(() => {
        timer = undefined;
        latest.current();
      }, LIVE_DELAY_MIN_MS + Math.random() * LIVE_DELAY_SPREAD_MS);
    };
    const onEvent = (payload: { topic?: string } | undefined) => {
      if (payload?.topic === topic) schedule();
    };

    socket.on(LIVE_EVENT, onEvent);
    socket.io.on("reconnect", schedule);
    return () => {
      socket.off(LIVE_EVENT, onEvent);
      socket.io.off("reconnect", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [topic]);
}
