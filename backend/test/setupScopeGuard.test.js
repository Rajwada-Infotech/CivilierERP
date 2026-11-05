// Setup / plot / villa routes refuse a restricted user anything outside their
// projects, whether the id comes in the path, the query or the body.
jest.mock("../db", () => {
  // plot 1 -> project 10, plot 2 -> project 20, block 5 -> project 20
  const owner = { "PlotMaster:1": 10, "PlotMaster:2": 20, "BlockMaster:5": 20 };
  return {
    sql: { Int: "Int" },
    getPool: () => ({
      request() {
        let id;
        const req = {
          input(_n, _t, v) { id = v; return req; },
          async query(text) {
            const table = /FROM dbo\.(\w+)/.exec(text)[1];
            const p = owner[`${table}:${id}`];
            return { recordset: p == null ? [] : [{ ProjectId: p }] };
          },
        };
        return req;
      },
    }),
  };
});
const express = require("express");
const request = require("supertest");
const { setupScopeGuard } = require("../services/projectScope");

function app(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.projectScope = scope; next(); });
  const r = express.Router();
  setupScopeGuard(r, { params: { blockId: "block" }, idPaths: [["/plots", "plot"]] });
  r.get("/plots/:id", (_q, s) => s.json({ ok: true }));
  r.get("/blocks/:blockId/plots", (_q, s) => s.json({ ok: true }));
  r.post("/plots/convert", (_q, s) => s.json({ ok: true }));
  r.get("/summary", (_q, s) => s.json({ ok: true }));
  a.use(r);
  return a;
}

describe("setup scope guard", () => {
  const limited = () => app([10]);
  test("own project by path id is allowed", async () => {
    expect((await request(limited()).get("/plots/1")).status).toBe(200);
  });
  test("another project's plot by path id is refused", async () => {
    expect((await request(limited()).get("/plots/2")).status).toBe(403);
  });
  test("another project's block by named param is refused", async () => {
    expect((await request(limited()).get("/blocks/5/plots")).status).toBe(403);
  });
  test("a plot list in the body with one foreign plot is refused", async () => {
    expect((await request(limited()).post("/plots/convert").send({ PlotIds: [1, 2] })).status).toBe(403);
    expect((await request(limited()).post("/plots/convert").send({ PlotIds: [1] })).status).toBe(200);
  });
  test("a foreign projectId in the query is refused", async () => {
    expect((await request(limited()).get("/summary?projectId=20")).status).toBe(403);
    expect((await request(limited()).get("/summary?projectId=10")).status).toBe(200);
  });
  test("an unrestricted user passes everything", async () => {
    expect((await request(app(null)).get("/plots/2")).status).toBe(200);
    expect((await request(app(null)).post("/plots/convert").send({ PlotIds: [2] })).status).toBe(200);
  });
});
