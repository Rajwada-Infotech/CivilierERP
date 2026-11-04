process.env.NODE_ENV = "test";
jest.mock("../db", () => ({ sql: {}, getPool: () => ({}) }));
jest.mock("../redis", () => ({ bumpCacheVersion: () => {}, redisZIncrBy: () => {} }));

const { activityAudit, isLookup } = require("../middleware/activityAudit");

// A POST that only looks something up: not logged as a "create", and its reply
// tells the app it saved nothing (so the app doesn't re-read every list).
const run = (method, url) => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, on: () => {}, json: () => {} };
  let nexted = false;
  activityAudit({ method, originalUrl: url, headers: {} }, res, () => { nexted = true; });
  return { headers, nexted };
};

test.each([
  "/api/crm/applications/price-quote",
  "/api/doc-search/find",
  "/api/unit-layout-override/preview",
  "/api/x/validate?y=1",
])("%s is a look-up: marked X-Changes-Nothing", (url) => {
  expect(isLookup({ originalUrl: url })).toBe(true);
  expect(run("POST", url).headers["X-Changes-Nothing"]).toBe("1");
});

test.each(["/api/crm/applications", "/api/crm/bookings/5/approve", "/api/user-activity"])("%s is not marked", (url) => {
  expect(run("POST", url).headers["X-Changes-Nothing"]).toBeUndefined();
});
