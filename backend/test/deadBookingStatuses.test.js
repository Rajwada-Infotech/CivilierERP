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
  const files = ["crmPayments.js", "crmSalesDeed.js", "crmPrePossession.js", "crmReports.js"];
  const handWritten = /b\.Status NOT IN \((?![^)]*Expired)(?![^)]*Transferred)[^)]*Cancelled[^)]*\)/;
  test.each(files)("%s has no booking filter that misses Expired or Transferred", (file) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
    const bad = src.split("\n").filter((line) => handWritten.test(line));
    expect(bad).toEqual([]);
  });
});
