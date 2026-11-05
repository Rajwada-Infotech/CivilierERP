// "Is this booking still alive?" has one answer, DEAD_BOOKING_STATUSES. The
// screens below once wrote their own list and forgot Expired / Transferred,
// so a resold seller's dues stayed on the collections list and a resale was
// counted twice in the booking register. This pins them to the shared list.
const fs = require("fs");
const path = require("path");
const { DEAD_BOOKING_STATUSES, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");

describe("dead booking statuses", () => {
  test("the shared list covers every terminal booking status", () => {
    expect([...DEAD_BOOKING_STATUSES].sort()).toEqual(["Cancelled", "Expired", "Rejected", "Transferred"]);
    expect(DEAD_BOOKING_SQL).toBe("(N'Cancelled', N'Rejected', N'Expired', N'Transferred')");
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
});
