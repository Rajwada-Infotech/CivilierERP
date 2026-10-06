// Every CRM router that serves a record by id must check the user's project
// access on it (services/projectScope.js). A new router, or a new :param on
// an old one, that skips the guard fails here instead of leaking another
// project's bookings, money or customers.
jest.mock("../db", () => ({ sql: new Proxy({}, { get: () => () => "type" }), getPool: () => null, connectDB: async () => {}, closeDB: async () => {} }));
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {}, getCacheVersion: async () => 0, client: null }));
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "routes");
// Params that are not records of a project (a document inside a record already
// guarded by its parent id, a workflow step name, a portal-only route).
// invoiceId / attId / itemKey only appear nested under a guarded /:id and are
// matched against that parent (e.g. WHERE Id = @iid AND BookingId = @bid).
const NOT_A_RECORD = new Set(["step", "docId", "snagId", "attachId", "holdId", "invoiceId", "attId", "itemKey"]);
// Routers that are not project data, or are guarded differently.
const EXEMPT = new Set(["crmPortal.js", "crmGstRule.js", "crmMilestoneMaster.js", "crmNamingPattern.js",
  "crmPaymentPlans.js", "crmProjectBanks.js", "crmProjectAutoSetup.js", "crmBrokerageRateTiers.js", "crmSlaEngine.js"]);

const files = fs.readdirSync(dir).filter((f) => /^crm.*\.js$/.test(f) && !EXEMPT.has(f));

describe("CRM project guards", () => {
  test.each(files)("%s guards every record param it serves", (file) => {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const params = new Set([...src.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*"[^"]*:([A-Za-z]+)/g)].map((m) => m[1]));
    const needed = [...params].filter((p) => !NOT_A_RECORD.has(p));
    const guarded = new Set([...src.matchAll(/router\.param\("([A-Za-z]+)"/g)].map((m) => m[1]));
    if (/crmProjectGuards\(router/.test(src)) { guarded.add("bookingId"); guarded.add("applicationId"); }
    if (/crmProjectGuards\(router, (?!null)/.test(src)) guarded.add("id");
    expect(needed.filter((p) => !guarded.has(p))).toEqual([]);
  });
});
