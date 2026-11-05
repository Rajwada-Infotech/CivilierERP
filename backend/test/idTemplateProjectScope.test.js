process.env.NODE_ENV = "test";

/**
 * ID Template Master keeps to the user's projects: the list shows only theirs, a template of another
 * project can't be changed or deleted, one can't be made for another project, and an alias can't
 * hold "/" (it separates the parts of an FA Item Code). The DB pool is faked.
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
jest.mock("../services/fixedAssetAutoAlloc", () => ({ autoTagPendingBatchesForProject: async () => ({ tagged: 0 }) }));
jest.mock("../db", () => {
  const run = async (text) => {
    mockQueries.push(text);
    // Template 5 belongs to project 20; the user may only see project 10.
    if (/SELECT ProjectId FROM dbo\.IDTemplateMaster WHERE Id = @id/.test(text)) return { recordset: [{ ProjectId: 20 }] };
    if (/OUTPUT INSERTED\.Id/.test(text)) return { recordset: [{ id: 1 }] };
    return { recordset: [], rowsAffected: [1] };
  };
  const req = () => { const r = { input: () => r, query: run }; return r; };
  return { sql: require("mssql"), getPool: () => ({ request: req }) };
});

const router = require("../routes/idTemplateMaster");
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.projectScope = scope; next(); });
app.use("/api/id-template-master", router);

beforeEach(() => { scope = [10]; mockQueries.length = 0; });

test("the list keeps to the user's projects", async () => {
  await request(app).get("/api/id-template-master");
  expect(mockQueries[0]).toMatch(/t\.ProjectId IN \(10\)/);
});

test("another project's template can't be changed or deleted", async () => {
  expect((await request(app).put("/api/id-template-master/5").send({ projectId: 10, projectAlias: "RG" })).status).toBe(403);
  expect((await request(app).delete("/api/id-template-master/5")).status).toBe(403);
});

test("a template can't be made for, or looked up in, another project", async () => {
  expect((await request(app).post("/api/id-template-master").send({ projectId: 20, projectAlias: "RG" })).status).toBe(403);
  expect((await request(app).get("/api/id-template-master/by-project/20")).status).toBe(403);
});

test("an alias with a slash is refused", async () => {
  const res = await request(app).post("/api/id-template-master").send({ projectId: 10, projectAlias: "RG/A" });
  expect(res.status).toBe(400);
});

test("inside the user's projects it saves", async () => {
  const res = await request(app).post("/api/id-template-master").send({ projectId: 10, projectAlias: "RG" });
  expect(res.status).toBe(201);
});
