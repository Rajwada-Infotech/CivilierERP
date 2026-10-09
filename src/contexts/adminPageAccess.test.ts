import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_KEYS,
  ADMIN_PATH_PAGE_KEYS,
  MODULE_SAMPLE_PAGES,
  firstAccessibleAdminPath,
  hasAnyAdminPageRight,
  userHasModuleAccess,
} from "./module.utils";
import { buildAdminNavItems, filterAdminNavItems } from "@/components/layout/sidebars/AdminSidebar";

const rightsFor = (...keys: string[]) => (pk: string) => keys.includes(pk);
const labels = (items: { label: string; children?: { label: string }[] }[]) =>
  items.map((i) => (i.children ? `${i.label}: ${i.children.map((c) => c.label).join(", ")}` : i.label));

describe("Admin pages follow Menu Rights for roles that are not admin-tier", () => {
  it("the Admin module opens for anyone holding at least one Admin page right", () => {
    expect(userHasModuleAccess("admin", false, rightsFor("approval-setup"))).toBe(true);
    expect(userHasModuleAccess("admin", false, rightsFor("grn"))).toBe(false); // a Material right is not an Admin right
    expect(userHasModuleAccess("admin", true, () => false)).toBe(true); // admin-tier always
    expect(MODULE_SAMPLE_PAGES.admin).toBe(ADMIN_PAGE_KEYS);
    expect(hasAnyAdminPageRight(rightsFor("users"))).toBe(true);
    expect(hasAnyAdminPageRight(rightsFor())).toBe(false);
  });

  it("lands on the first ticked page, not on a page they cannot open", () => {
    expect(firstAccessibleAdminPath(rightsFor("approval-setup", "users"))).toBe("/users");
    expect(firstAccessibleAdminPath(rightsFor("approval-setup"))).toBe("/admin/approval/setup");
    expect(firstAccessibleAdminPath(rightsFor("admin-dashboard"))).toBe("/admin/dashboard"); // "/admin" is skipped: it is the same page
    expect(firstAccessibleAdminPath(rightsFor())).toBeNull();
  });

  it("the sidebar shows only the ticked pages, and groups with nothing ticked disappear", () => {
    const menu = filterAdminNavItems(buildAdminNavItems(0), rightsFor("approval-setup", "project-master", "metrics-dashboard"));
    expect(labels(menu)).toEqual(["Enterprise: Project", "Approval: Approval Setup", "Live Metrics"]);
  });

  it("pages with no right to tick (APK Manager, System Maintenance, tickets) never reach a non-admin menu", () => {
    const everything = rightsFor(...ADMIN_PAGE_KEYS);
    const menu = filterAdminNavItems(buildAdminNavItems(0), everything);
    const text = JSON.stringify(menu);
    expect(text).not.toContain("APK Manager");
    expect(text).not.toContain("System Maintenance");
    expect(text).not.toContain("Resolution");
  });

  it("keeps the Inbox badge for someone who may open it", () => {
    const menu = filterAdminNavItems(buildAdminNavItems(7), rightsFor("approval-inbox"));
    expect(menu[0].children?.[0]).toMatchObject({ label: "Inbox", badge: 7 });
  });

  it("every page key used is one Menu Rights can tick (kebab-case, no duplicates beyond the two dashboard paths)", () => {
    for (const key of Object.values(ADMIN_PATH_PAGE_KEYS)) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(Object.values(ADMIN_PATH_PAGE_KEYS).filter((k) => k === "admin-dashboard")).toHaveLength(2);
  });
});
