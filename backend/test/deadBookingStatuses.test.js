// "Is this booking still alive?" has one answer, DEAD_BOOKING_STATUSES. The
// screens below once wrote their own list and forgot Expired / Transferred,
// so a resold seller's dues stayed on the collections list and a resale was
// counted twice in the booking register. This pins them to the shared list.
const fs = require("fs");
const path = require("path");
const { DEAD_BOOKING_STATUSES, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");

describe("dead booking statuses", () => {
  test("the shared list covers every terminal booking status", () => {
    expect([...DEAD_BOOKING_STATUSES].sort()).toEqual(["Cancelled", "Expired", "Rejected", "Transferred", "UnitChanged"]);
    expect(DEAD_BOOKING_SQL).toBe("(N'Cancelled', N'Rejected', N'Expired', N'Transferred', N'UnitChanged')");
  });

  // Live-booking filters that must use the shared list, never a hand-written one.
  const files = [
    "crmPayments.js",
    "crmSalesDeed.js",
    "crmPrePossession.js",
    "crmReports.js",
    "crmLoanSummary.js",
    "crmApplications.js",
    "crmCustomer360.js",
  ];

  test.each(files)("%s has no booking filter that misses Expired or Transferred", (file) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
    const bad = src.split("\n").filter((line) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("--")) return false;
      const isBookingStatus = /(b|bk|ob)\.Status\s+NOT\s+IN/i.test(line) ||
        (/CrmBooking/i.test(line) && /Status\s+NOT\s+IN/i.test(line));
      if (!isBookingStatus) return false;
      if (!/Cancelled/i.test(line)) return false;
      if (line.includes("DEAD_BOOKING_SQL")) return false;
      const hasExpired = /Expired/i.test(line);
      const hasTransferred = /Transferred/i.test(line);
      return !hasExpired || !hasTransferred;
    });
    expect(bad).toEqual([]);
  });

  // No route or service writes the list out by hand: a new closed status (UnitChanged, 2026-11-12) has to reach every
  // "live booking" filter through DEAD_BOOKING_SQL / DEAD_BOOKING_STATUSES.
  test("no hand-written closed-status list anywhere in routes or services", () => {
    const listRe = /Cancelled['"]?\s*,\s*N?['"]?(?:\$\{CrmStatus\.REJECTED\}|Rejected)['"]?\s*,\s*N?['"]Expired['"]\s*,\s*N?['"]Transferred/;
    const offenders = [];
    for (const dir of ["routes", "services"]) {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const full = path.join(d, e.name);
        if (e.isDirectory()) return walk(full);
        if (!e.name.endsWith(".js")) return;
        fs.readFileSync(full, "utf8").split(/\r?\n/).forEach((line, i) => {
          if (!line.trim().startsWith("//") && listRe.test(line)) offenders.push(`${path.relative(path.join(__dirname, ".."), full)}:${i + 1}`);
        });
      });
      walk(path.join(__dirname, "..", dir));
    }
    expect(offenders).toEqual([]);
  });
});
