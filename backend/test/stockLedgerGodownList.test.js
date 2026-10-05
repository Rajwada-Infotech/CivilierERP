process.env.NODE_ENV = "test";

const mockQueries = [];
jest.mock("../db", () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q) => {
        mockQueries.push(q);
        if (/COUNT\(1\) AS cnt/.test(q)) return { recordset: [{ cnt: 1 }] };
        if (/COUNT\(\*\) AS total/.test(q)) return { recordset: [{ total: 0 }] };
        if (/SELECT DISTINCT/.test(q)) return { recordset: [] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return { getPool: () => ({ request }), sql: require("mssql") };
});
jest.mock("../redis", () => ({ bumpCacheVersion: jest.fn().mockResolvedValue(), getCacheVersion: jest.fn().mockResolvedValue(1), getRedis: () => null }));
jest.mock("../middleware/cache", () => ({ cache: () => (req, res, next) => next() }));
jest.mock("../middleware/routePermission", () => ({ checkPermissionForMethod: () => (req, res, next) => next() }));

const express = require("express");
const request = require("supertest");

describe("GET /api/stock-ledger godown list", () => {
  it("only orders by columns that are in the SELECT DISTINCT list (SQL Server rejects anything else)", async () => {
    const app = express();
    app.use("/api/stock-ledger", require("../routes/stockLedger"));
    const res = await request(app).get("/api/stock-ledger?page=1&limit=20&itemId=abc&godownId=1&dateTo=2026-10-05");
    expect(res.status).toBe(200);
    const q = mockQueries.find((x) => /SELECT DISTINCT/.test(x));
    expect(q).toBeDefined();
    expect(q).toMatch(/ISNULL\(gd\.IsMain, 0\) AS IsMain/);
    expect(q).toMatch(/ORDER BY ISNULL\(gd\.IsMain, 0\) DESC, ISNULL\(gd\.GodownName, 'Main Godown'\) ASC/);
    expect(q).not.toMatch(/ORDER BY gd\.IsMain/);
  });
});
