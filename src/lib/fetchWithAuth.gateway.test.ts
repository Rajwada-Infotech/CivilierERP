import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ApiError, STABILISING_MESSAGE, fetchWithAuth } from "./fetchWithAuth";

const html = (status: number) =>
  new Response("<html>Bad Gateway</html>", { status, headers: { "content-type": "text/html" } });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  Object.values(toastMock).forEach((f) => f.mockReset());
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithAuth during a deploy (502 / 504 from the gateway)", () => {
  it("a read that hits a 502 is retried quietly and succeeds once the system is back", async () => {
    fetchMock
      .mockResolvedValueOnce(html(502))
      .mockResolvedValueOnce(html(502))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const promise = fetchWithAuth("/api/things");
    await vi.advanceTimersByTimeAsync(1500 + 3000);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(toastMock.warning).toHaveBeenCalledWith(STABILISING_MESSAGE, expect.objectContaining({ id: "system-stabilising" }));
    expect(toastMock.dismiss).toHaveBeenCalledWith("system-stabilising"); // the message goes away once it recovers
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("gives up after a few tries with the same plain message, never a raw 502", async () => {
    fetchMock.mockResolvedValue(html(502));
    const promise = fetchWithAuth("/api/things");
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1500 + 3000 + 5000);
    const err = await settled;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Please wait a few seconds for the system to stabilise.");
    expect(err.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(4); // the first try + 3 retries
  });

  it("a 504 is treated the same way", async () => {
    fetchMock.mockResolvedValueOnce(html(504)).mockResolvedValueOnce(json(200, {}));
    const promise = fetchWithAuth("/api/things");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await promise).status).toBe(200);
  });

  it("a write is never retried (it could save twice) but gets the same message", async () => {
    fetchMock.mockResolvedValue(html(502));
    const err = await fetchWithAuth("/api/things", { method: "POST", body: "{}" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe(STABILISING_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("an HTML 503 (the gateway) is retried, but the backend's own JSON 503 reaches the screen untouched", async () => {
    fetchMock.mockResolvedValueOnce(html(503)).mockResolvedValueOnce(json(200, {}));
    const retried = fetchWithAuth("/api/things");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await retried).status).toBe(200);

    fetchMock.mockReset();
    toastMock.warning.mockReset();
    fetchMock.mockResolvedValueOnce(json(503, { error: "Needs migration 545" }));
    const res = await fetchWithAuth("/api/things");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Needs migration 545");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("leaves other errors alone (404, 500 are real answers)", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: "boom" }));
    expect((await fetchWithAuth("/api/things")).status).toBe(500);
    fetchMock.mockResolvedValueOnce(json(404, { error: "nope" }));
    expect((await fetchWithAuth("/api/things")).status).toBe(404);
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("stops waiting when the caller aborts the request", async () => {
    fetchMock.mockResolvedValue(html(502));
    const controller = new AbortController();
    const settled = fetchWithAuth("/api/things", { signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const err = await settled;
    expect(err.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
