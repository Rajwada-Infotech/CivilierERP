import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIdleLogout } from "./useIdleLogout";

// Real production timing (44 min warning + 60s countdown) exercised via fake
// timers rather than shrinking the constants — this is the actual behavior
// shipped to users, not an approximation of it.
const WARNING_AFTER_MS = 44 * 60 * 1000;
const COUNTDOWN_MS = 60 * 1000;
const TOTAL_MS = WARNING_AFTER_MS + COUNTDOWN_MS;

describe("useIdleLogout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing while disabled", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleLogout(false, onTimeout));

    expect(result.current.secondsLeft).toBeNull();

    act(() => {
      vi.advanceTimersByTime(TOTAL_MS + 60_000);
    });

    expect(result.current.secondsLeft).toBeNull();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("stays hidden before the warning threshold", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleLogout(true, onTimeout));

    act(() => {
      vi.advanceTimersByTime(WARNING_AFTER_MS - 2000);
    });

    expect(result.current.secondsLeft).toBeNull();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("shows a counting-down warning once the idle threshold is crossed", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleLogout(true, onTimeout));

    act(() => {
      vi.advanceTimersByTime(WARNING_AFTER_MS + 1000);
    });
    expect(result.current.secondsLeft).not.toBeNull();
    expect(result.current.secondsLeft).toBeLessThanOrEqual(60);
    expect(result.current.secondsLeft).toBeGreaterThan(55);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Countdown should have decreased by roughly 10 seconds.
    expect(result.current.secondsLeft).toBeLessThanOrEqual(50);
  });

  it("calls onTimeout exactly once when the countdown reaches zero", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleLogout(true, onTimeout));

    act(() => {
      vi.advanceTimersByTime(TOTAL_MS + 1000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // Further idle time must not re-fire the timeout.
    act(() => {
      vi.advanceTimersByTime(TOTAL_MS);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("resetTimer() dismisses an active warning and prevents timeout", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useIdleLogout(true, onTimeout));

    act(() => {
      vi.advanceTimersByTime(WARNING_AFTER_MS + 5000);
    });
    expect(result.current.secondsLeft).not.toBeNull();

    act(() => {
      result.current.resetTimer();
    });
    expect(result.current.secondsLeft).toBeNull();

    // A further COUNTDOWN_MS from the reset point must NOT trigger logout —
    // only WARNING_AFTER_MS + COUNTDOWN_MS from the *reset* timestamp should.
    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_MS);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("is cross-tab aware: activity written to localStorage by another tab resets the clock", () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleLogout(true, onTimeout));

    // Idle for most of the warning window...
    act(() => {
      vi.advanceTimersByTime(WARNING_AFTER_MS - 1000);
    });

    // ...then a DIFFERENT tab records activity by writing the shared key.
    act(() => {
      localStorage.setItem("lastActivityAt", String(Date.now()));
    });

    // The next second of polling should see the fresh timestamp and NOT
    // cross into warning territory even though enough wall-clock time has
    // now passed since this hook's own start.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not throw and still tracks idle time when localStorage access throws", () => {
    // Simulates locked-down iframes / strict browser privacy policies where
    // localStorage.getItem/setItem throw a SecurityError. The interval tick
    // must not propagate an uncaught exception, and idle detection should
    // keep working via the in-memory fallback.
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError: storage disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("SecurityError: storage disabled");
    };

    try {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useIdleLogout(true, onTimeout));

      expect(() => {
        act(() => {
          vi.advanceTimersByTime(WARNING_AFTER_MS + 1000);
        });
      }).not.toThrow();

      expect(result.current.secondsLeft).not.toBeNull();

      expect(() => {
        act(() => {
          vi.advanceTimersByTime(COUNTDOWN_MS);
        });
      }).not.toThrow();

      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
