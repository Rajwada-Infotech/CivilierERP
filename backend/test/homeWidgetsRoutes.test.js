process.env.NODE_ENV = "test";

/**
 * Home personalised widgets: POST /usage records a module visit, GET /widgets
 * returns the catalog widgets for the modules the user works in. The DB pool
 * is faked; the MERGE itself is exercised on the live server.
 */

const express = require("express");
const request = require("supertest");

let mockUsageRows = [];
let mockQueries = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          mockQueries.push(text);
          return { recordset: mockUsageRows };
        },
      };
      return r;
    },
  }),
}));

const router = require("../routes/homeActivity");

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { userId: 7 };
  next();
});
app.use("/api/home", router);

beforeEach(() => {
  mockUsageRows = [];
  mockQueries = [];
});

describe("POST /api/home/usage", () => {
  test("records a visit to a known module", async () => {
    const res = await request(app).post("/api/home/usage").send({ module: "Finance" });
    expect(res.status).toBe(200);
    expect(mockQueries.some((q) => /MERGE dbo\.UserModuleUsage/.test(q))).toBe(true);
  });

  test("rejects a module that has no widgets", async () => {
    const res = await request(app).post("/api/home/usage").send({ module: "Admin" });
    expect(res.status).toBe(400);
    expect(mockQueries).toHaveLength(0);
  });
});

describe("GET /api/home/widgets", () => {
  test("returns the widgets of the module the user works in", async () => {
    mockUsageRows = [{ module: "Material", visitCount: 12, lastVisitedAt: new Date().toISOString() }];
    const res = await request(app).get("/api/home/widgets").query({ modules: "Finance,Material" });
    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    expect(res.body.widgets.length).toBeGreaterThan(0);
    expect(res.body.widgets.every((w) => w.module === "Material")).toBe(true);
  });

  test("never offers a module the caller did not list as accessible", async () => {
    mockUsageRows = [{ module: "Finance", visitCount: 50, lastVisitedAt: new Date().toISOString() }];
    const res = await request(app).get("/api/home/widgets").query({ modules: "CRM" });
    expect(res.body.widgets.every((w) => w.module === "CRM")).toBe(true);
  });
});
