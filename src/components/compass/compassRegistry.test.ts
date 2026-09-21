import { describe, expect, it } from "vitest";
import {
  COMPASS_KEYWORDS,
  buildCompassEntries,
  moduleLandings,
  type CompassEntry,
} from "./compassRegistry";

const allowNothing = () => false;
const allowOnly = (...keys: string[]) => (k: string) => keys.includes(k);

const superAdmin = buildCompassEntries({ role: "super_admin", canAccessPage: allowNothing });
const admin = buildCompassEntries({ role: "admin", canAccessPage: allowNothing });
const routes = (list: CompassEntry[]) => list.map((e) => e.route);

describe("buildCompassEntries — shape", () => {
  it("has no duplicate routes", () => {
    const r = routes(superAdmin);
    expect(new Set(r).size).toBe(r.length);
  });

  it("only lists literal, navigable paths (no params/wildcards)", () => {
    for (const e of superAdmin) {
      expect(e.route.startsWith("/")).toBe(true);
      expect(e.route).not.toMatch(/[:*]/);
    }
  });

  it("includes Setup-menu pages that no sidebar contains", () => {
    const customers = superAdmin.find((e) => e.route === "/masters/customers");
    expect(customers).toBeDefined();
    expect(customers?.group).toBe("Setup");
  });

  it("every alias in COMPASS_KEYWORDS points at a real route", () => {
    const known = new Set(routes(superAdmin));
    const missing = Object.keys(COMPASS_KEYWORDS).filter((r) => !known.has(r));
    expect(missing).toEqual([]);
  });

  it("attaches aliases to entries", () => {
    expect(superAdmin.find((e) => e.route === "/brs")?.keywords).toContain("bank reconciliation");
  });
});

describe("buildCompassEntries — permissions", () => {
  it("shows a regular user nothing when they have no page rights", () => {
    expect(buildCompassEntries({ role: "engineer", canAccessPage: allowNothing })).toEqual([]);
  });

  it("shows only pages the user's rights allow", () => {
    const brs = superAdmin.find((e) => e.route === "/brs")!;
    const list = buildCompassEntries({ role: "accountant", canAccessPage: allowOnly(brs.pageKey!) });
    const r = routes(list);
    expect(r).toContain("/brs");
    expect(r).not.toContain("/material/grn");
    expect(list.every((e) => e.pageKey === brs.pageKey || !e.pageKey)).toBe(true);
  });

  it("never gives regular users admin, DBA or super-admin pages", () => {
    const everything = () => true;
    const list = buildCompassEntries({ role: "engineer", canAccessPage: everything });
    expect(list.some((e) => e.moduleId === "dba" || e.moduleId === "super_admin")).toBe(false);
    expect(list.some((e) => e.route.startsWith("/dba") || e.route.startsWith("/superadmin"))).toBe(false);
  });

  it("limits an approval-inbox-only user to the Inbox page in Admin", () => {
    const list = buildCompassEntries({ role: "engineer", canAccessPage: allowOnly("approval-inbox") });
    const adminEntries = list.filter((e) => e.moduleId === "admin");
    expect(routes(adminEntries)).toEqual(["/admin/approval/inbox"]);
  });

  it("gives admin-tier the DBA section but only super_admin the super-admin section", () => {
    expect(admin.some((e) => e.moduleId === "dba")).toBe(true);
    expect(admin.some((e) => e.moduleId === "super_admin")).toBe(false);
    expect(superAdmin.some((e) => e.moduleId === "super_admin")).toBe(true);
  });

  it("treats marketing_head as admin inside Sales Automation only", () => {
    const list = buildCompassEntries({ role: "marketing_head", canAccessPage: allowNothing });
    expect(list.some((e) => e.moduleId === "sales-automation")).toBe(true);
    expect(list.some((e) => e.moduleId === "finance")).toBe(false);
  });

  it("adds Pending Tickets for admin-tier only", () => {
    const pending = "/ticket/pending";
    expect(routes(superAdmin)).toContain(pending);
    const ticketKey = superAdmin.find((e) => e.route === "/ticket/my-tickets")!.pageKey!;
    const regular = buildCompassEntries({ role: "engineer", canAccessPage: allowOnly(ticketKey) });
    expect(routes(regular)).toContain("/ticket/my-tickets");
    expect(routes(regular)).not.toContain(pending);
  });

  it("shows an un-keyed entry only when the user can reach that module", () => {
    const unkeyed = superAdmin.find((e) => e.moduleId === "hr-payroll" && !e.pageKey);
    if (!unkeyed) return; // sidebar has since been fully keyed — nothing to assert
    const keyed = superAdmin.find((e) => e.moduleId === "hr-payroll" && e.pageKey)!;
    const withAccess = buildCompassEntries({ role: "hr", canAccessPage: allowOnly(keyed.pageKey!) });
    const without = buildCompassEntries({ role: "hr", canAccessPage: allowNothing });
    expect(routes(withAccess)).toContain(unkeyed.route);
    expect(routes(without)).not.toContain(unkeyed.route);
  });
});

describe("moduleLandings", () => {
  it("returns one entry per module, preferring its dashboard", () => {
    const landings = moduleLandings(superAdmin);
    const ids = landings.map((l) => l.moduleId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of landings) {
      const hasDashboard = superAdmin.some((e) => e.moduleId === l.moduleId && e.isDashboard);
      if (hasDashboard) expect(l.isDashboard).toBe(true);
    }
  });
});
