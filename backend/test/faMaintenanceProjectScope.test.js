process.env.NODE_ENV = "test";

/**
 * FA Maintenance & Repair keeps to the user's projects: the list and the asset pickers only
 * show their projects, a record in another project can't be opened, edited, posted or deleted,
 * and create / edit refuse a project outside them. The DB pool is faked.
 */

const express = require("express");
const request = require("supertest");

let scope = null;
const mockQueries = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => ({ requirePageRight: () => (_req, _res, next) => next() }));
jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { id: 7, email: "site@x.com", role: "user" };
  next();
});
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));
jest.mock("../services/fixedAssetMaintenancePosting", () => ({
  buildPostingPlan: async () => ({ entries: [] }),
  postMaintenance: async () => { throw new Error("posting reached"); },
  reverseMaintenancePosting: async () => { throw new Error("reversal reached"); },
  resolveGstConfig: async () => ({ sacCode: null, ratePct: 0 }),
}));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          mockQueries.push(text);
          // Record 5 sits in project 20; the user may only see project 10.
          if (/SELECT ProjectId FROM dbo\.FixedAssetMaintenance/.test(text)) return { recordset: [{ ProjectId: 20 }] };
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));

const router = require("../routes/fixedAssetMaintenance");
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.projectScope = scope; next(); });
app.use("/api/fixed-asset-maintenance", router);

const body = { companyId: 1, projectId: 20, docDate: "2026-10-23", itemName: "Crane", assetId: 3, vendorId: 4, repairExpenseType: "Direct", amount: 100 };

beforeEach(() => { scope = [10]; mockQueries.length = 0; });

test("list and pickers keep to the user's projects", async () => {
  await request(app).get("/api/fixed-asset-maintenance");
  await request(app).get("/api/fixed-asset-maintenance/assets");
  await request(app).get("/api/fixed-asset-maintenance/fa-item-codes?itemName=Crane");
  expect(mockQueries[0]).toMatch(/m\.ProjectId IN \(10\)/);
  expect(mockQueries[1]).toMatch(/fa\.ProjectId IN \(10\)/);
  expect(mockQueries[2]).toMatch(/fa\.ProjectId IN \(10\)/);
});

test.each([
  ["get", ""],
  ["get", "/posting-preview"],
  ["put", ""],
  ["post", "/post"],
  ["delete", ""],
])("%s /:id%s refuses a record in another project", async (method, suffix) => {
  const res = await request(app)[method](`/api/fixed-asset-maintenance/5${suffix}`).send({ ...body, projectId: 10 });
  expect(res.status).toBe(403);
});

test("create refuses a project outside the user's", async () => {
  const res = await request(app).post("/api/fixed-asset-maintenance").send(body);
  expect(res.status).toBe(403);
  expect(mockQueries).toHaveLength(0);
});

test("an unrestricted user is not filtered", async () => {
  scope = null;
  await request(app).get("/api/fixed-asset-maintenance");
  expect(mockQueries[0]).not.toMatch(/ProjectId IN/);
  const res = await request(app).get("/api/fixed-asset-maintenance/5");
  expect(res.status).toBe(404);
});
