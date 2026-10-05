process.env.NODE_ENV = "test";

const mockQueries = [];
jest.mock("../db", () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q) => {
        mockQueries.push(q);
        if (/COUNT\(1\) AS cnt/.test(q)) return { recordset: [{ cnt: 1 }] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return { getPool: () => ({ request }), sql: require("mssql") };
});
jest.mock("../redis", () => ({ bumpCacheVersion: jest.fn().mockResolvedValue(), getCacheVersion: jest.fn().mockResolvedValue(1), getRedis: () => null }));
jest.mock("../middleware/cache", () => ({ cache: () => (req, res, next) => next() }));

const express = require("express");
const request = require("supertest");

describe("inventory master UOM grouping", () => {
  it("files a blank-UOM movement under the item's only known UOM instead of a separate line", async () => {
    const app = express();
    app.use("/api/inventory-master", require("../routes/inventoryMaster"));
    const res = await request(app).get("/api/inventory-master?date=2026-10-05&godownId=7");
    expect(res.status).toBe(200);
    const main = mockQueries.find((q) => /FROM dbo\.Item_Master_Group img/.test(q));
    expect(main).toBeDefined();
    // ledger UOM resolves by code / name / symbol; blank or unknown text falls back to the item's own unit
    expect(main).toMatch(/UPPER\(um\.UOMName\) = UPPER\(sl\.UOM\)/);
    expect(main).toMatch(/COALESCE\(ucan\.UOMCode, img\.M_UOM, solo\.OnlyUom, NULLIF\(sl\.UOM, ''\)\)/);
    // the "only UOM" lookup only applies when an item has exactly ONE distinct UOM (never merges real units)
    expect(main).toMatch(/HAVING COUNT\(DISTINCT UOM\) = 1/);
    // and the grouping key uses the same expression
    expect(main).toMatch(/GROUP BY[\s\S]*COALESCE\(ucan\.UOMCode, img\.M_UOM, solo\.OnlyUom, NULLIF\(sl\.UOM, ''\)\)/);
  });
});
