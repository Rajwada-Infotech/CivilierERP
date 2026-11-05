import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMaintenanceStatus } from "./maintenanceModeApi";

const off = { active: false, enforced: false, title: null, message: null, startedAt: null, startsAt: null, endsAt: null, updatedBy: null };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(off), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("getMaintenanceStatus", () => {
  it("sends no Authorization header when nobody is signed in", async () => {
    await getMaintenanceStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/system-maintenance/status", { cache: "no-store", headers: undefined });
  });

  it("sends the token when there is one, so the request counts against that person's rate limit", async () => {
    sessionStorage.setItem("token", "abc.def.ghi");
    await getMaintenanceStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/system-maintenance/status", {
      cache: "no-store",
      headers: { Authorization: "Bearer abc.def.ghi" },
    });
  });

  it("still answers with the state, and throws a plain message when the server cannot be reached", async () => {
    expect((await getMaintenanceStatus()).active).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await expect(getMaintenanceStatus()).rejects.toThrow("Could not check the system status");
  });
});
