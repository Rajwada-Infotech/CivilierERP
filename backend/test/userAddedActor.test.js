process.env.NODE_ENV = "test";

/**
 * Home › Recent Activity "User added — <name>" showed no "By": the feed hard-coded a NULL
 * actor. dbo.users.CreatedBy (migration 535) now records the admin who added the user.
 * The pool is faked; the SQL itself is exercised on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockHasColumn = true;
let mockQueries = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 7, role: "super_admin" }; next(); });
jest.mock("../middleware/permissions", () => ({
  checkPermission: () => (_req, _res, next) => next(),
  userPermissionCache: { invalidate: () => {} },
  permissionCache: { invalidateAll: () => {}, invalidateRole: () => {} },
}));
jest.mock("../redis", () => ({
  redisGet: jest.fn(), redisSet: jest.fn(), redisDel: jest.fn(), invalidateUserSession: jest.fn(),
  bumpCacheVersion: jest.fn().mockResolvedValue(), getCacheVersion: jest.fn().mockResolvedValue(1), getRedis: () => null,
}));
jest.mock("../middleware/blacklist", () => ({ blacklistToken: jest.fn() }));
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        inputs: {},
        input(name, _t, v) { r.inputs[name] = v; return r; },
        query: async (text) => {
          mockQueries.push({ text, inputs: { ...r.inputs } });
          if (/COL_LENGTH\('dbo\.users', 'CreatedBy'\)/.test(text)) {
            return { recordset: [{ len: mockHasColumn ? 4 : null }] };
          }
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));

const { resetUsersCreatedByCache } = require("../services/usersCreatedBy");

const feedApp = () => express().use("/api/home", require("../routes/homeActivity"));
const feedSql = () => mockQueries.find((q) => /User added/.test(q.text))?.text ?? "";

beforeEach(() => {
  mockQueries = [];
  mockHasColumn = true;
  resetUsersCreatedByCache();
});

describe("Recent Activity: who added the user", () => {
  it("shows the creating admin as the actor once dbo.users.CreatedBy exists", async () => {
    await request(feedApp()).get("/api/home/activity-feed");
    const q = feedSql();
    expect(q).toMatch(/FROM dbo\.users cu WHERE cu\.id = u\.CreatedBy\) AS Actor/);
    expect(q).not.toMatch(/USER_ACTOR/);
  });

  it("keeps working (no actor) on a server where migration 535 hasn't run", async () => {
    mockHasColumn = false;
    await request(feedApp()).get("/api/home/activity-feed");
    const q = feedSql();
    expect(q).toMatch(/NULL AS Actor/);
    expect(q).not.toMatch(/u\.CreatedBy/);
  });
});

describe("POST /api/users records who added the user", () => {
  const usersApp = () => express().use(express.json()).use("/api/users", require("../routes/users"));
  const body = { name: "Subesh Ghosh", email: "s@x.in", password: "pw12345!", RoleId: 3 };

  it("stores the signed-in admin as CreatedBy", async () => {
    const res = await request(usersApp()).post("/api/users").send(body);
    expect(res.status).toBe(200);
    const ins = mockQueries.find((q) => /INSERT INTO dbo\.users/.test(q.text));
    expect(ins.text).toMatch(/, CreatedBy\)/);
    expect(ins.inputs.createdBy).toBe(7);
  });

  it("still creates users before migration 535 has run", async () => {
    mockHasColumn = false;
    const res = await request(usersApp()).post("/api/users").send(body);
    expect(res.status).toBe(200);
    const ins = mockQueries.find((q) => /INSERT INTO dbo\.users/.test(q.text));
    expect(ins.text).not.toMatch(/CreatedBy/);
  });
});
