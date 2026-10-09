// A plot and the villa built on it, held by one customer, are one property:
// one schedule with the land balance first, one price / paid / due.
jest.mock("../db", () => ({ sql: { Int: "Int" }, getPool: () => ({}) }));
const { propertyOfBooking } = require("../services/villaLand");

const poolWith = (bookings, milestones) => ({
  request() {
    const req = {
      input() { return req; },
      async query(text) { return { recordset: (/CrmPaymentMilestone/.test(text) ? milestones : bookings).map((r) => ({ ...r })) }; },
    };
    return req;
  },
});

describe("plot + villa as one property", () => {
  const bookings = [
    { Id: 20, BookingNo: "BKG-20", UnitNo: "SW/A/PLOT-21", TotalValue: 6000000, IsLand: 0 },
    { Id: 10, BookingNo: "BKG-10", UnitNo: "Plot 21", TotalValue: 3000000, IsLand: 1 },
  ];
  const milestones = [
    { Id: 3, BookingId: 20, MilestoneNo: 1, MilestoneName: "Booking", AmountDue: 600000, AmountPaid: 0, Status: "Pending" },
    { Id: 2, BookingId: 10, MilestoneNo: 2, MilestoneName: "Balance", AmountDue: 500000, AmountPaid: 0, Status: "Pending" },
    { Id: 1, BookingId: 10, MilestoneNo: 1, MilestoneName: "Booking", AmountDue: 2500000, AmountPaid: 2500000, Status: "Paid" },
  ];

  test("land booking first, its milestones ahead of the villa's", async () => {
    const p = await propertyOfBooking(poolWith(bookings, milestones), 20);
    expect(p.combined).toBe(true);
    expect(p.bookings.map((b) => b.Id)).toEqual([10, 20]);
    expect(p.schedule.map((m) => m.Id)).toEqual([1, 2, 3]);
    expect(p.schedule[1].Label).toBe("Land balance – Plot 21 · Balance");
    expect(p.schedule[2].Part).toBe("Villa");
  });

  test("one price / paid / due across both", async () => {
    const p = await propertyOfBooking(poolWith(bookings, milestones), 10);
    expect(p.totals).toEqual({ price: 9000000, paid: 2500000, due: 1100000 });
  });

  test("a booking on its own is not combined", async () => {
    const p = await propertyOfBooking(poolWith([bookings.find((b) => b.Id === 10)], milestones.filter((m) => m.BookingId === 10)), 10);
    expect(p.combined).toBe(false);
    expect(p.schedule[1].Label).toBe("Balance");
  });
});
