process.env.NODE_ENV = "test";

/**
 * Home "Actions this week" totals: one entry per India day for the last 7
 * days, zero-filled, with rows from the database bucketed to the right day.
 * The DB pool is faked; the SQL itself is exercised on the live server.
 */

const express = require("express");
const request = require("supertest");

let mockRows = [];
let mockLastQuery = "";
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          mockLastQuery = text;
          return { recordset: mockRows };
        },
      };
      return r;
    },
  }),
}));

const router = require("../routes/homeActivity");
const app = express().use("/api/home", router);

const istDate = (offsetDays) => {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe("GET /api/home/activity-week", () => {
  test("returns the last 7 India days, oldest first, zero-filled", async () => {
    mockRows = [];
    const res = await request(app).get("/api/home/activity-week");
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days.map((d) => d.date)).toEqual([-6, -5, -4, -3, -2, -1, 0].map(istDate));
    expect(res.body.days.every((d) => d.count === 0 && d.amount === 0)).toBe(true);
  });

  test("puts each day's count and value on the right day - not just the latest two", async () => {
    mockRows = [
      { Day: new Date(`${istDate(0)}T00:00:00Z`), Cnt: 1, Amt: 1500.4 },
      { Day: new Date(`${istDate(-1)}T00:00:00Z`), Cnt: 44, Amt: 2800000 },
      { Day: new Date(`${istDate(-4)}T00:00:00Z`), Cnt: 17, Amt: 120000 },
      { Day: new Date(`${istDate(-6)}T00:00:00Z`), Cnt: 9, Amt: 0 },
    ];
    const res = await request(app).get("/api/home/activity-week");
    const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d]));
    expect(byDate[istDate(0)]).toMatchObject({ count: 1, amount: 1500 });
    expect(byDate[istDate(-1)]).toMatchObject({ count: 44, amount: 2800000 });
    expect(byDate[istDate(-4)]).toMatchObject({ count: 17, amount: 120000 });
    expect(byDate[istDate(-6)]).toMatchObject({ count: 9, amount: 0 });
    expect(byDate[istDate(-2)]).toMatchObject({ count: 0, amount: 0 });
  });

  test("aggregates in SQL by India day rather than reading the feed", async () => {
    mockRows = [];
    await request(app).get("/api/home/activity-week");
    expect(mockLastQuery).toMatch(/GROUP BY CAST\(DATEADD\(MINUTE, 330/i);
    expect(mockLastQuery).toMatch(/UNION ALL/i);
  });

  test("an unknown module list gives an empty (all zero) week, not an error", async () => {
    const res = await request(app).get("/api/home/activity-week?modules=nonexistent");
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
  });
});
