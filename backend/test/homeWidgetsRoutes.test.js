process.env.NODE_ENV = "test";

/**
 * Home personalisation: POST /usage records a module visit, GET
 * /module-ranking orders the user's accessible modules by how much they work
 * in them. The DB pool is faked; the MERGE itself is exercised on the live
 * server.
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
    const res = await request(app).post("/api/home/usage").send({ module: "finance" });
    expect(res.status).toBe(200);
    expect(mockQueries.some((q) => /MERGE dbo\.UserModuleUsage/.test(q))).toBe(true);
  });

  test("rejects an unknown module", async () => {
    const res = await request(app).post("/api/home/usage").send({ module: "admin" });
    expect(res.status).toBe(400);
    expect(mockQueries).toHaveLength(0);
  });
});

describe("GET /api/home/module-ranking", () => {
  test("puts the module the user works in first", async () => {
    mockUsageRows = [{ module: "material", visitCount: 12, lastVisitedAt: new Date().toISOString() }];
    const res = await request(app).get("/api/home/module-ranking").query({ modules: "finance,material" });
    expect(res.status).toBe(200);
    expect(res.body.personalized).toBe(true);
    expect(res.body.modules[0].module).toBe("material");
  });

  test("only ranks modules the caller listed as accessible", async () => {
    mockUsageRows = [{ module: "finance", visitCount: 50, lastVisitedAt: new Date().toISOString() }];
    const res = await request(app).get("/api/home/module-ranking").query({ modules: "crm" });
    expect(res.body.modules.map((m) => m.module)).toEqual(["crm"]);
  });
});
