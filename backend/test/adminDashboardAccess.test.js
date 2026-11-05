process.env.NODE_ENV = "test";

/**
 * Control Center totals (GET /api/admin-dashboard): admin-tier roles always, any other role only with the
 * "admin-dashboard" page ticked in Menu Rights. It used to be admin-tier only, so a role that Admin pages let in
 * (Admin pages follow Menu Rights) saw "Failed to load dashboard data" and the server answered 403 every poll.
 */
const express = require("express");
const request = require("supertest");

let mockRights = [];
jest.mock("../middleware/permissions", () => ({
  getEffectivePagePermissions: async () => mockRights,
}));
jest.mock("../redis", () => ({ redisGet: async () => null, redisSet: async () => {} }));
jest.mock("../db", () => ({
  getPool: () => ({
    request: () => ({
      query: async (text) => {
        if (/totalUsers/.test(text)) return { recordset: [{ totalUsers: 30 }] };
        if (/totalRoles/.test(text)) return { recordset: [{ totalRoles: 14 }] };
        if (/activeUsers/.test(text)) return { recordset: [{ activeUsers: 29 }] };
        return { recordset: [{ id: 1, name: "Asha" }] };
      },
    }),
  }),
}));

const router = require("../routes/adminDashboard");

const appAs = (user) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/admin-dashboard", router);
  return app;
};
const get = (user) => request(appAs(user)).get("/api/admin-dashboard");
const tick = (page, actions = ["view"]) => [{ page, actions }];

beforeEach(() => {
  mockRights = [];
});

describe("GET /api/admin-dashboard", () => {
  test.each(["admin", "super_admin", "dba", "Super Admin", "super-admin"])("admin-tier role %s always gets the totals", async (role) => {
    const res = await get({ userId: 1, roleId: 1, role });
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({ totalUsers: 30, totalRoles: 14, activeUsers: 29 });
  });

  test("another role with the Admin Dashboard page ticked gets them too", async () => {
    mockRights = tick("admin-dashboard");
    const res = await get({ userId: 3143, roleId: 9, role: "software_engineer" });
    expect(res.status).toBe(200);
    expect(res.body.stats.totalUsers).toBe(30);
  });

  test("another role without that tick is refused, whatever else it holds", async () => {
    mockRights = [...tick("approval-setup"), ...tick("users")];
    const res = await get({ userId: 3143, roleId: 9, role: "software_engineer" });
    expect(res.status).toBe(403);
  });

  test("a tick for the page but not the view action is refused", async () => {
    mockRights = tick("admin-dashboard", ["create"]);
    expect((await get({ userId: 3143, roleId: 9, role: "software_engineer" })).status).toBe(403);
  });

  test("someone with no user id at all is turned away", async () => {
    expect((await get({ role: "software_engineer" })).status).toBe(401);
  });
});
