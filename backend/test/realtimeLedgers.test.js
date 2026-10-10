process.env.NODE_ENV = "test";

const fs = require("fs");
const path = require("path");

let mockIo = null;
const mockBump = jest.fn(async () => {});
jest.mock("../socket", () => ({
  getIo: () => {
    if (!mockIo) throw new Error("Socket.io not initialized");
    return mockIo;
  },
}));
jest.mock("../redis", () => ({ bumpCacheVersion: (...a) => mockBump(...a) }));

const realtime = require("../services/realtime");

beforeEach(() => {
  jest.useFakeTimers();
  mockIo = { emit: jest.fn() };
  mockBump.mockClear();
  realtime.resetRealtime();
});
afterEach(() => {
  realtime.resetRealtime();
  jest.useRealTimers();
});

describe("ledger changes are announced to every open page", () => {
  test.each(["account-head-master", "general-ledger", "general-ledger-detail", "partner-master", "bank-master"])(
    "a bump of %s sends one 'ledgers' signal",
    (ns) => {
      realtime.afterCacheBump(ns);
      expect(mockIo.emit).not.toHaveBeenCalled(); // coalesced, not instant
      jest.advanceTimersByTime(realtime.DEBOUNCE_MS + 1);
      expect(mockIo.emit).toHaveBeenCalledTimes(1);
      expect(mockIo.emit).toHaveBeenCalledWith("data:changed", expect.objectContaining({ topic: "ledgers" }));
    },
  );

  test("the signal carries a topic only - never any record data", () => {
    realtime.afterCacheBump("account-head-master");
    jest.advanceTimersByTime(realtime.DEBOUNCE_MS + 1);
    const payload = mockIo.emit.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(["at", "topic"]);
  });

  test("a burst of changes (a bulk import) is one signal, not hundreds", () => {
    for (let i = 0; i < 200; i++) realtime.afterCacheBump("account-head-master");
    realtime.afterCacheBump("general-ledger");
    jest.advanceTimersByTime(realtime.DEBOUNCE_MS + 1);
    expect(mockIo.emit).toHaveBeenCalledTimes(1);
  });

  test("changes to anything else do not announce anything", () => {
    for (const ns of ["new-payment", "expense-booking", "item-master", "crm-bookings"]) realtime.afterCacheBump(ns);
    jest.advanceTimersByTime(realtime.DEBOUNCE_MS + 1);
    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
  });

  test("creating a GL, bank or partner also refreshes the shared account-head list cache", () => {
    for (const ns of ["general-ledger", "general-ledger-detail", "partner-master", "bank-master"]) {
      mockBump.mockClear();
      realtime.afterCacheBump(ns);
      expect(mockBump).toHaveBeenCalledWith("account-head-master");
    }
  });

  test("the account-head cache itself is not bumped again (no loop)", () => {
    realtime.afterCacheBump("account-head-master");
    expect(mockBump).not.toHaveBeenCalled();
  });

  test("with sockets not running (tests, scripts) nothing throws", () => {
    mockIo = null;
    expect(() => {
      realtime.afterCacheBump("account-head-master");
      jest.advanceTimersByTime(realtime.DEBOUNCE_MS + 1);
    }).not.toThrow();
  });
});

describe("wiring", () => {
  test("bumpCacheVersion announces through the realtime service, guarded so a write can never fail because of it", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "redis.js"), "utf8");
    const bump = src.slice(src.indexOf("const bumpCacheVersion"), src.indexOf("function invalidateLocalCacheVersion"));
    expect(bump).toMatch(/require\("\.\/services\/realtime"\)\.afterCacheBump\(ns\)/);
    expect(bump).toMatch(/try \{[\s\S]*afterCacheBump[\s\S]*\} catch/);
  });
});
