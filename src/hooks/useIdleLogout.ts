import { useCallback, useEffect, useRef, useState } from "react";

// ── Tunables ─────────────────────────────────────────────────────────────────
// Total time from the user's last interaction to forced logout is
// WARNING_AFTER_MS + COUNTDOWN_SECONDS*1000. Adjust these two constants to
// change the idle policy app-wide.
const WARNING_AFTER_MS = 44 * 60 * 1000; // 44 minutes of inactivity -> show warning
const COUNTDOWN_SECONDS = 60;            // 1 minute to respond before auto-logout
const TICK_MS = 1000;

// Shared across browser tabs: activity in ANY tab (same origin) resets the
// idle clock for ALL tabs, so a user actively working in one tab doesn't get
// logged out because a second, idle tab is open.
const STORAGE_KEY = "lastActivityAt";

// Events that count as "the user is doing something". Deliberately excludes
// network/background activity (sockets, polling) — this must reflect genuine
// human interaction, not app activity.
const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
];

// Throttle localStorage writes — mousemove fires far too often to write on
// every event without this.
const WRITE_THROTTLE_MS = 5000;

// Fallback for environments where localStorage access throws (locked-down
// iframes, some enterprise browser policies). Without this, a read failure
// inside the setInterval tick would go uncaught and silently disable the
// whole feature (idleMs would never advance, or worse, the tick itself would
// throw). With it, idle detection still works correctly within this single
// tab — it just loses the cross-tab synchronization localStorage provides.
let memoryFallback = Date.now();

function readLastActivity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : memoryFallback;
  } catch {
    return memoryFallback;
  }
}

function writeLastActivity(ts: number) {
  memoryFallback = ts;
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // localStorage unavailable (private mode / quota) — idle detection still
    // works within this tab via memoryFallback, just not cross-tab.
  }
}

/**
 * Detects genuine user inactivity and drives a warning-then-logout sequence.
 *
 * enabled: pass false to fully disable listeners/ticking (e.g. when there's
 * no authenticated user — no point tracking idle time on the login page).
 * onTimeout: called once when the countdown reaches zero. The caller is
 * responsible for actually logging the user out and redirecting.
 */
export function useIdleLogout(enabled: boolean, onTimeout: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const lastWriteRef = useRef(0);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  // Mirrors `secondsLeft !== null` so the activity listener (bound once per
  // effect run) can check "is the warning currently showing" without being
  // re-bound every time secondsLeft changes.
  const warningShownRef = useRef(false);
  warningShownRef.current = secondsLeft !== null;

  const resetTimer = useCallback(() => {
    firedRef.current = false;
    const now = Date.now();
    lastWriteRef.current = now;
    writeLastActivity(now);
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSecondsLeft(null);
      return;
    }

    // Start each mount from a clean slate rather than inheriting a stale
    // timestamp from a previous session (e.g. right after login).
    resetTimer();

    const handleActivity = () => {
      // Never auto-clear the shared timestamp while the warning is showing —
      // only the explicit "Stay logged in" action (which calls resetTimer
      // directly) should dismiss it. Otherwise routine background mouse
      // jitter would silently clear a warning the user hasn't acknowledged.
      if (warningShownRef.current) return;
      const now = Date.now();
      if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      writeLastActivity(now);
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      document.addEventListener(evt, handleActivity, { passive: true }),
    );

    const interval = setInterval(() => {
      const idleMs = Date.now() - readLastActivity();
      const totalMs = WARNING_AFTER_MS + COUNTDOWN_SECONDS * 1000;

      if (idleMs >= totalMs) {
        if (!firedRef.current) {
          firedRef.current = true;
          setSecondsLeft(0);
          onTimeoutRef.current();
        }
        return;
      }

      if (idleMs >= WARNING_AFTER_MS) {
        setSecondsLeft(Math.ceil((totalMs - idleMs) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        document.removeEventListener(evt, handleActivity),
      );
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { secondsLeft, resetTimer };
}
