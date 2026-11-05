import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { isChunkLoadError, reloadForNewVersion } from "./chunkReload";

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://civiliererp.in/assets/Reports-AbC123.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    "Loading chunk 42 failed.",
    "Unable to preload CSS for /assets/x.css",
  ])("recognises %s", (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
    expect(isChunkLoadError(message)).toBe(true);
  });

  it("does not mistake an ordinary error for a stale tab", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new Error("Network error. Please check your connection."))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe("reloadForNewVersion", () => {
  const reload = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    reload.mockReset();
    toastMock.info.mockReset();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => vi.useRealTimers());

  it("tells the person, then reloads once", () => {
    expect(reloadForNewVersion()).toBe(true);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads twice in quick succession, so a real error can't cause a loop", () => {
    expect(reloadForNewVersion()).toBe(true);
    expect(reloadForNewVersion()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is allowed again once the window has passed", () => {
    expect(reloadForNewVersion()).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(reloadForNewVersion()).toBe(true);
  });
});
