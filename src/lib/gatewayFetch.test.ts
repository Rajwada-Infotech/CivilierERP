import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayFetch, installGatewayFetch, isGatewayFailure, rateLimitWaitMs } from "./gatewayFetch";
import { getSystemStatus, resetSystemStatus, setHealthCheck } from "./systemStatus";

const html = (status: number) =>
  new Response("<html>Bad Gateway</html>", { status, headers: { "content-type": "text/html" } });
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let native: ReturnType<typeof vi.fn>;
let gatewayFetch: ReturnType<typeof createGatewayFetch>;

beforeEach(() => {
  vi.useFakeTimers();
  resetSystemStatus();
  native = vi.fn();
  gatewayFetch = createGatewayFetch(native as never);
});
afterEach(() => {
  vi.useRealTimers();
  resetSystemStatus();
});

describe("isGatewayFailure", () => {
  it("is the gateway's 502 / 504, or an HTML 503, and nothing else", () => {
    expect(isGatewayFailure(html(502))).toBe(true);
    expect(isGatewayFailure(html(504))).toBe(true);
    expect(isGatewayFailure(html(503))).toBe(true);
    expect(isGatewayFailure(json(503, { error: "Needs migration 545" }))).toBe(false);
    expect(isGatewayFailure(json(500))).toBe(false);
    expect(isGatewayFailure(json(404))).toBe(false);
    expect(isGatewayFailure(json(200))).toBe(false);
  });
});

describe("a read during a deploy", () => {
  it("is retried quietly, shows the 'updating' state meanwhile, and succeeds once the system is back", async () => {
    native.mockResolvedValueOnce(html(502)).mockResolvedValueOnce(html(502)).mockResolvedValueOnce(json(200, { ok: true }));
    const promise = gatewayFetch("/api/things");
    await vi.advanceTimersByTimeAsync(10);
    expect(getSystemStatus()).toBe("updating");
    await vi.advanceTimersByTimeAsync(1500 + 3000);
    expect((await promise).status).toBe(200);
    expect(native).toHaveBeenCalledTimes(3);
    expect(getSystemStatus()).toBe("ok");
  });

  it("gives back the gateway's answer after the last retry, and stays 'updating' until /health answers", async () => {
    native.mockResolvedValue(html(502));
    const promise = gatewayFetch("/api/things");
    await vi.advanceTimersByTimeAsync(1500 + 3000 + 5000);
    const res = await promise;
    expect(res.status).toBe(502);
    expect(native).toHaveBeenCalledTimes(4); // the first try + 3 retries
    expect(getSystemStatus()).toBe("updating");
  });

  it("a 504 is treated the same way", async () => {
    native.mockResolvedValueOnce(html(504)).mockResolvedValueOnce(json(200));
    const promise = gatewayFetch("/api/things");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await promise).status).toBe(200);
  });

  it("stops waiting when the caller aborts", async () => {
    native.mockResolvedValue(html(502));
    const controller = new AbortController();
    const settled = gatewayFetch("/api/things", { signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await settled).name).toBe("AbortError");
    expect(native).toHaveBeenCalledTimes(1);
  });
});

describe("what it leaves alone", () => {
  it("never retries a write (it could save twice), though the banner still shows", async () => {
    native.mockResolvedValue(html(502));
    const res = await gatewayFetch("/api/things", { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
    expect(native).toHaveBeenCalledTimes(1);
    expect(getSystemStatus()).toBe("updating");
  });

  it("passes the backend's own JSON 503, and ordinary errors, straight through", async () => {
    native.mockResolvedValueOnce(json(503, { error: "Needs migration 545" }));
    expect((await gatewayFetch("/api/things")).status).toBe(503);
    native.mockResolvedValueOnce(json(500, { error: "boom" }));
    expect((await gatewayFetch("/api/things")).status).toBe(500);
    expect(native).toHaveBeenCalledTimes(2);
    expect(getSystemStatus()).toBe("ok");
  });

  it("only touches our own API: other sites and the page's own files are not retried", async () => {
    native.mockResolvedValue(html(502));
    expect((await gatewayFetch("https://example.com/api/x")).status).toBe(502);
    expect((await gatewayFetch("/assets/app.js")).status).toBe(502);
    expect(native).toHaveBeenCalledTimes(2);
    expect(getSystemStatus()).toBe("ok");
  });
});

describe("recovery", () => {
  it("polls /health while updating and clears the state when it answers", async () => {
    const healthy = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setHealthCheck(healthy);
    native.mockResolvedValue(html(502));
    await gatewayFetch("/api/things", { method: "POST" });
    expect(getSystemStatus()).toBe("updating");
    await vi.advanceTimersByTimeAsync(3000 * 2);
    expect(getSystemStatus()).toBe("updating");
    await vi.advanceTimersByTimeAsync(3000);
    expect(healthy).toHaveBeenCalledTimes(3);
    expect(getSystemStatus()).toBe("ok");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(healthy).toHaveBeenCalledTimes(3); // stops polling once it is back
  });
});

describe("installGatewayFetch", () => {
  it("wraps the browser's fetch once, so raw fetch('/api/…') calls are covered too", async () => {
    const original = window.fetch;
    const fake = vi.fn().mockResolvedValueOnce(html(502)).mockResolvedValueOnce(json(200));
    window.fetch = fake as never;
    try {
      installGatewayFetch();
      installGatewayFetch(); // a second call changes nothing
      const promise = window.fetch("/api/anything");
      await vi.advanceTimersByTimeAsync(1500);
      expect((await promise).status).toBe(200);
      expect(fake).toHaveBeenCalledTimes(2);
    } finally {
      window.fetch = original;
    }
  });
});

describe("429 Too many requests", () => {
  const tooMany = (retryAfter?: string) =>
    new Response("Too many requests", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

  it("waits as long as the server asked (kept between 1.5 and 10 seconds)", () => {
    expect(rateLimitWaitMs(tooMany("4"))).toBe(4000);
    expect(rateLimitWaitMs(tooMany("0"))).toBe(1500);
    expect(rateLimitWaitMs(tooMany())).toBe(1500);
    expect(rateLimitWaitMs(tooMany("60"))).toBe(10_000);
  });

  it("a read is retried after the wait, with no 'updating' banner, and succeeds", async () => {
    native.mockResolvedValueOnce(tooMany("2")).mockResolvedValueOnce(json(200, { ok: true }));
    const promise = gatewayFetch("/api/things");
    await vi.advanceTimersByTimeAsync(10);
    expect(native).toHaveBeenCalledTimes(1);
    expect(getSystemStatus()).toBe("ok");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await promise).status).toBe(200);
    expect(native).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries and hands back the 429, so the page can say why", async () => {
    native.mockResolvedValue(tooMany("1"));
    const promise = gatewayFetch("/api/things");
    await vi.advanceTimersByTimeAsync(1500 + 1500 + 10);
    expect((await promise).status).toBe(429);
    expect(native).toHaveBeenCalledTimes(3);
  });

  it("a write is never retried", async () => {
    native.mockResolvedValue(tooMany("1"));
    const res = await gatewayFetch("/api/things", { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect(native).toHaveBeenCalledTimes(1);
  });
});
