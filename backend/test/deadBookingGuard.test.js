// Every dead booking status — Cancelled, Rejected, Expired, Transferred — stops
// further workflow and money actions; a live booking passes.
jest.mock("../db", () => ({ sql: { Int: "Int" }, getPool: () => ({}) }));
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

const poolWith = (row) => ({
  request() {
    const req = { input() { return req; }, async query() { return { recordset: row ? [row] : [] }; } };
    return req;
  },
});
const booking = (Status) => ({ Status, IsActive: true, IsFrozen: false });

describe("requireActiveBooking", () => {
  test.each(["Cancelled", "Rejected", "Expired", "Transferred"])("%s booking is refused", async (status) => {
    await expect(requireActiveBooking(poolWith(booking(status)), 1)).resolves.toMatch(/no further workflow actions/);
  });
  test.each(["Pending", "Approved"])("%s booking passes", async (status) => {
    await expect(requireActiveBooking(poolWith(booking(status)), 1)).resolves.toBeNull();
  });
  test("an inactive booking is refused", async () => {
    await expect(requireActiveBooking(poolWith({ ...booking("Approved"), IsActive: false }), 1)).resolves.toMatch(/no longer active/);
  });
});
