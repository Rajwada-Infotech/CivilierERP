import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Handler = (...args: unknown[]) => void;
const handlers = new Map<string, Set<Handler>>();
const ioHandlers = new Map<string, Set<Handler>>();
const add = (m: Map<string, Set<Handler>>, e: string, h: Handler) => (m.get(e) ?? m.set(e, new Set()).get(e)!).add(h);
const del = (m: Map<string, Set<Handler>>, e: string, h: Handler) => m.get(e)?.delete(h);
const fire = (m: Map<string, Set<Handler>>, e: string, ...a: unknown[]) => m.get(e)?.forEach((h) => h(...a));

let socket: unknown = null;
vi.mock("@/lib/socket", () => ({
  getSocket: () => socket,
  connectSocket: () => socket,
}));

import { LIVE_DELAY_MIN_MS, LIVE_DELAY_SPREAD_MS, useLiveData } from "./useLiveData";

const WAIT = LIVE_DELAY_MIN_MS + LIVE_DELAY_SPREAD_MS + 5;

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  ioHandlers.clear();
  socket = {
    on: (e: string, h: Handler) => add(handlers, e, h),
    off: (e: string, h: Handler) => del(handlers, e, h),
    io: { on: (e: string, h: Handler) => add(ioHandlers, e, h), off: (e: string, h: Handler) => del(ioHandlers, e, h) },
  };
});
afterEach(() => vi.useRealTimers());

describe("useLiveData", () => {
  it("re-reads when its topic changes, after a short spread-out delay", () => {
    const reload = vi.fn();
    renderHook(() => useLiveData("ledgers", reload));
    act(() => fire(handlers, "data:changed", { topic: "ledgers", at: 1 }));
    expect(reload).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores other topics and malformed signals", () => {
    const reload = vi.fn();
    renderHook(() => useLiveData("ledgers", reload));
    act(() => {
      fire(handlers, "data:changed", { topic: "something-else" });
      fire(handlers, "data:changed", undefined);
      fire(handlers, "data:changed", {});
    });
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(reload).not.toHaveBeenCalled();
  });

  it("several signals close together become one reload", () => {
    const reload = vi.fn();
    renderHook(() => useLiveData("ledgers", reload));
    act(() => {
      for (let i = 0; i < 5; i++) fire(handlers, "data:changed", { topic: "ledgers" });
    });
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once after the connection drops and comes back (a change in the gap would be missed)", () => {
    const reload = vi.fn();
    renderHook(() => useLiveData("ledgers", reload));
    act(() => fire(ioHandlers, "reconnect"));
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("always calls the latest callback, without re-subscribing on every render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useLiveData("ledgers", cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    expect(handlers.get("data:changed")?.size).toBe(1);
    act(() => fire(handlers, "data:changed", { topic: "ledgers" }));
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening, and cancels a pending reload, when the page closes", () => {
    const reload = vi.fn();
    const { unmount } = renderHook(() => useLiveData("ledgers", reload));
    act(() => fire(handlers, "data:changed", { topic: "ledgers" }));
    unmount();
    expect(handlers.get("data:changed")?.size ?? 0).toBe(0);
    expect(ioHandlers.get("reconnect")?.size ?? 0).toBe(0);
    act(() => void vi.advanceTimersByTime(WAIT));
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing, and does not crash, when there is no socket (not signed in)", () => {
    socket = null;
    const reload = vi.fn();
    expect(() => renderHook(() => useLiveData("ledgers", reload))).not.toThrow();
  });
});
