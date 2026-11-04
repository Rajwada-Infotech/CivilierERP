process.env.NODE_ENV = "test";
jest.mock("../db", () => ({ sql: {}, getPool: () => ({}) }));
const mockBump = jest.fn(async () => {});
jest.mock("../redis", () => ({ bumpCacheVersion: (...a) => mockBump(...a), redisZIncrBy: () => {} }));
jest.mock("../middleware/cache", () => ({ ANY_WRITE_NAMESPACE: "any-write" }));
const mockEmit = jest.fn();
jest.mock("../services/realtime", () => ({ emitDataChanged: (...a) => mockEmit(...a) }));

const { writeInvalidator } = require("../middleware/writeInvalidator");

// A successful write drops every cache and tells open pages to re-read — but not for writes that change no
// business data: housekeeping (activity log, page visits, sign-in) and look-ups sent as POST (price quotes).
// They used to drop every user's cached lists on each page visit, and twice a second during a quote loop.
function write(url, method = "POST") {
  let finish;
  const res = { statusCode: 200, on: (ev, fn) => { if (ev === "finish") finish = fn; } };
  writeInvalidator({ method, originalUrl: url }, res, () => {});
  if (finish) finish();
}

beforeEach(() => { mockBump.mockClear(); mockEmit.mockClear(); });

test.each(["/api/crm/applications", "/api/dependency-activity-assignment/5/progress", "/api/script-console/run"])(
  "a real save (%s) drops every cache and tells open pages", (url) => {
    write(url);
    expect(mockBump).toHaveBeenCalledWith("any-write");
    expect(mockEmit).toHaveBeenCalledWith("any");
  });

test.each(["/api/home/usage", "/api/user-activity", "/api/users/login", "/api/crm/applications/price-quote", "/api/unit-layout-override/preview"])(
  "%s changes no business data: no cache dropped, nobody told", (url) => {
    write(url);
    expect(mockBump).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

test("a read never does", () => {
  write("/api/crm/applications", "GET");
  expect(mockBump).not.toHaveBeenCalled();
});
