import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCompassEntries } from "@/components/compass/compassRegistry";
import { isModuleId, moduleFromPath, rememberModuleForRoute } from "./moduleFromPath";

describe("moduleFromPath", () => {
  it.each([
    ["/finance/invoice", "finance"],
    ["/brs", "finance"],
    ["/fund-transfer", "finance"],
    ["/on-account-adjustment", "finance"],
    ["/balance-sheet", "finance"],
    ["/profit-and-loss", "finance"],
    ["/material/grn", "material"],
    ["/sales-automation/leads", "sales-automation"], // must not be swallowed by /sales
    ["/sales/customers", "sales"],
    ["/admin/approval/inbox", "admin"],
    ["/users", "admin"],
    ["/home", "none"],
    ["/", "none"],
    ["/masters/customers", "keep"],
    ["/reports", "keep"],
  ])("%s -> %s", (path, expected) => {
    expect(moduleFromPath(path)).toBe(expected);
  });
});

// Every sidebar/Setup page must land the user in its own module when opened by
// URL (bookmark, shared link, refresh). The only paths allowed to stay ambiguous
// are the shared /masters/* pages (resolved via the remembered module — see
// rememberModuleForRoute) and the DBA / Super-Admin consoles, which AppSidebar
// resolves on its own.
describe("every registry route resolves to a module shell", () => {
  const entries = buildCompassEntries({ role: "super_admin", canAccessPage: () => true });

  it("has no unexpected ambiguous route", () => {
    const stray = entries
      .filter((e) => isModuleId(e.moduleId))
      .filter((e) => moduleFromPath(e.route) === "keep" && !e.route.startsWith("/masters/"))
      .map((e) => e.route);
    expect(stray).toEqual([]);
  });

  it("never resolves a route to a different module than its own", () => {
    const wrong = entries
      .filter((e) => isModuleId(e.moduleId))
      .filter((e) => {
        const m = moduleFromPath(e.route);
        return m !== "keep" && m !== e.moduleId;
      })
      .map((e) => `${e.route}: ${e.moduleId} vs ${moduleFromPath(e.route)}`);
    // /admin/control-panel is listed under Super Admin but lives in the Admin shell.
    expect(wrong.filter((w) => !w.startsWith("/admin/control-panel"))).toEqual([]);
  });
});

describe("rememberModuleForRoute", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the module for an ambiguous /masters page", () => {
    rememberModuleForRoute("/masters/customers", "sales");
    expect(store.get("activeModule")).toBe("sales");
  });

  it("leaves URL-resolved routes alone (the URL already decides)", () => {
    store.set("activeModule", "material");
    rememberModuleForRoute("/finance/invoice", "finance");
    expect(store.get("activeModule")).toBe("material");
  });

  it("ignores ids that aren't real modules (dba / super_admin)", () => {
    rememberModuleForRoute("/dba", "dba");
    expect(store.has("activeModule")).toBe(false);
  });
});
