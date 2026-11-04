process.env.NODE_ENV = "test";
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));
const { wantsFreshRead } = require("../middleware/cache");

// For a minute after a save the browser sends X-Fresh (ms since that save). A cache that clears on every save
// is fresh by then and skips itself only right after the save; any other cache skips itself the whole minute.
const req = (v) => ({ headers: v === undefined ? {} : { "x-fresh": String(v) } });

test("no recent save: every cache is used", () => {
  expect(wantsFreshRead(req(), true)).toBe(false);
  expect(wantsFreshRead(req(), false)).toBe(false);
});

test("a cache that does not clear on every save is skipped for the whole minute", () => {
  expect(wantsFreshRead(req(45000), false)).toBe(true);
});

test("one that clears on every save is skipped only right after it", () => {
  expect(wantsFreshRead(req(800), true)).toBe(true);
  expect(wantsFreshRead(req(5000), true)).toBe(false);
  expect(wantsFreshRead(req(45000), true)).toBe(false);
});

test("an older browser tab's plain '1' still means skip", () => {
  expect(wantsFreshRead(req(1), true)).toBe(true);
  expect(wantsFreshRead(req("yes"), true)).toBe(true);
});
