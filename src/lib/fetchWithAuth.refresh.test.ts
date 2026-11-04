import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));
vi.mock("./queryClient", async (orig) => ({ ...(await orig<typeof import("./queryClient")>()), refreshAfterWrite: vi.fn() }));

import { fetchWithAuth } from "./fetchWithAuth";
import { refreshAfterWrite } from "./queryClient";

const ok = (headers: Record<string, string> = {}) =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(refreshAfterWrite).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// After a save every list on screen reads again. A POST that only looks
// something up (a price quote) must not count as one: a screen that reads it as
// a query re-asked it after every answer — twice a second, 809 times for one user.
describe("which replies make the screen read everything again", () => {
  it("a save does", async () => {
    fetchMock.mockResolvedValue(ok());
    await fetchWithAuth("/api/crm/applications", { method: "POST", body: "{}" });
    expect(refreshAfterWrite).toHaveBeenCalledTimes(1);
  });

  it("a look-up the server marks X-Changes-Nothing does not", async () => {
    fetchMock.mockResolvedValue(ok({ "X-Changes-Nothing": "1" }));
    await fetchWithAuth("/api/crm/applications/price-quote", { method: "POST", body: "{}" });
    expect(refreshAfterWrite).not.toHaveBeenCalled();
  });

  it("a read never does", async () => {
    fetchMock.mockResolvedValue(ok());
    await fetchWithAuth("/api/crm/applications");
    expect(refreshAfterWrite).not.toHaveBeenCalled();
  });
});
