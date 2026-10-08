process.env.NODE_ENV = "test";

/**
 * Attaching / detaching a checkpoint on an activity used to be guarded by "dpr-activity-master", a page key with no
 * definition, so nobody but an admin could ever pass. It is now guarded by the real Activity Master pages.
 */
const mockAnyGuards = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (_req, _res, next) => next());
jest.mock("../db", () => ({ sql: require("mssql"), getPool: () => ({}) }));
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: (keys, action) => {
    mockAnyGuards.push({ keys, action });
    return (_req, _res, next) => next();
  },
}));

require("../routes/activityCheckpoint");

describe("activityCheckpoint template routes", () => {
  it("attach and detach are guarded by the Activity Master pages, not a missing key", () => {
    expect(mockAnyGuards).toHaveLength(2);
    for (const g of mockAnyGuards) {
      expect(g.action).toBe("edit");
      expect(g.keys).toEqual(["activity-master", "engineering-activity-master"]);
      expect(g.keys).not.toContain("dpr-activity-master");
    }
  });
});
