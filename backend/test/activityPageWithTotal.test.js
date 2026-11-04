process.env.NODE_ENV = "test";
jest.mock("../db", () => ({ sql: require("mssql"), getPool: () => ({}) }));
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));

const { pageWithTotal } = require("../routes/userActivity");

// The Activity Browser's lists: the page and its total as two plain queries, never COUNT(*) OVER()
// (which read every row of the period, Details and all, just to count it).
function fakePool({ total, rows }) {
  const queries = [];
  return {
    queries,
    request() {
      const r = { inputs: {}, input(n, _t, v) { r.inputs[n] = v; return r; },
        async query(q) { queries.push({ q, inputs: r.inputs }); return { recordset: /COUNT\(\*\) AS total/.test(q) ? [{ total }] : rows }; } };
      return r;
    },
  };
}

test("one count and one page, both with the same filters; no window count", async () => {
  const pool = fakePool({ total: 250, rows: [{ id: 1 }, { id: 2 }] });
  const out = await pageWithTotal(pool, [["dateFrom", null, "2026-11-01"]], "CreatedAt >= @dateFrom", "Id AS id", "CreatedAt DESC", 100, 100);
  expect(out).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 250 });
  expect(pool.queries).toHaveLength(2);
  expect(pool.queries.every((x) => x.inputs.dateFrom === "2026-11-01")).toBe(true);
  expect(pool.queries.some((x) => /OVER\s*\(/.test(x.q))).toBe(false);
  expect(pool.queries.find((x) => /ORDER BY/.test(x.q)).q).toMatch(/OFFSET 100 ROWS FETCH NEXT 100 ROWS ONLY/);
});

test("a page past the end still gives the real total", async () => {
  const out = await pageWithTotal(fakePool({ total: 42, rows: [] }), [], "1 = 1", "Id AS id", "CreatedAt DESC", 900, 100);
  expect(out).toEqual({ rows: [], total: 42 });
});
