import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));

import { ApiError, STABILISING_MESSAGE, fetchWithAuth } from "./fetchWithAuth";

const html = (status: number) =>
  new Response("<html>Bad Gateway</html>", { status, headers: { "content-type": "text/html" } });
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchWithAuth when the gateway is down (after the wrapped fetch has already retried)", () => {
  it("fails with the plain sentence instead of handing back the gateway's error page", async () => {
    fetchMock.mockResolvedValue(html(502));
    const err = await fetchWithAuth("/api/things").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Please wait a few seconds for the system to stabilise.");
    expect(err.message).toBe(STABILISING_MESSAGE);
    expect(err.status).toBe(502);
  });

  it("does the same for a write", async () => {
    fetchMock.mockResolvedValue(html(504));
    const err = await fetchWithAuth("/api/things", { method: "POST", body: "{}" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands the backend's own JSON 503, and ordinary errors, back untouched", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: "Needs migration 545" }));
    const res = await fetchWithAuth("/api/things");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Needs migration 545");
    fetchMock.mockResolvedValueOnce(json(500, { error: "boom" }));
    expect((await fetchWithAuth("/api/things")).status).toBe(500);
  });
});
