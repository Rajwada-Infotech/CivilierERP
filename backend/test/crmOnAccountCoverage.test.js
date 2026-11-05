// On-account money held against each milestone, in milestone order (shown on the plan; nothing is moved).
jest.mock("../db", () => ({ sql: { Int: "Int" } }));
jest.mock("../services/crmPaymentFunding", () => ({ onAccountWithAvailableSql: () => "x" }));

const { getMilestoneMoneyStages } = require("../services/crmOnAccountCoverage");

function poolWith(milestones, onAccount, pending = []) {
  return {
    request: () => ({
      input() { return this; },
      async query(text) {
        if (/FROM dbo\.CrmPaymentMilestone WHERE BookingId/.test(text)) return { recordset: milestones };
        if (/TotalOnAccount/.test(text)) return { recordset: [{ TotalOnAccount: onAccount }] };
        return { recordset: pending };
      },
    }),
  };
}

const plan = [
  { Id: 1, MilestoneNo: 1, AmountDue: 10000, AmountPaid: 0, Status: "Pending" },
  { Id: 2, MilestoneNo: 2, AmountDue: 630150, AmountPaid: 0, Status: "Pending" },
  { Id: 3, MilestoneNo: 3, AmountDue: 630150, AmountPaid: 0, Status: "Pending" },
  { Id: 4, MilestoneNo: 4, AmountDue: 630150, AmountPaid: 0, Status: "Pending" },
];

test("money held on account fills milestones in order; the first one it can't fill is part held", async () => {
  const { milestones } = await getMilestoneMoneyStages(poolWith(plan, 1241000), 9);
  expect(milestones.map((m) => m.HeldOnAccount)).toEqual([10000, 630150, 600850, 0]);
  expect(milestones.map((m) => m.MoneyStage)).toEqual(["Verified", "Verified", null, null]);
});

test("a settled or waived milestone holds nothing and keeps its own stage", async () => {
  const rows = [
    { Id: 1, MilestoneNo: 1, AmountDue: 10000, AmountPaid: 10000, Status: "Paid" },
    { Id: 2, MilestoneNo: 2, AmountDue: 5000, AmountPaid: 0, Status: "Waived" },
    { Id: 3, MilestoneNo: 3, AmountDue: 20000, AmountPaid: 0, Status: "Pending" },
  ];
  const { milestones } = await getMilestoneMoneyStages(poolWith(rows, 25000), 9);
  expect(milestones.map((m) => m.HeldOnAccount)).toEqual([0, 0, 20000]);
  expect(milestones.map((m) => m.MoneyStage)).toEqual(["Adjusted", "Waived", "Verified"]);
});

test("money entered but not verified yet does not count as held", async () => {
  const { milestones } = await getMilestoneMoneyStages(poolWith(plan.slice(0, 1), 0, [{ RPAmount: 10000 }]), 9);
  expect(milestones[0].HeldOnAccount).toBe(0);
  expect(milestones[0].MoneyStage).toBe("InVerification");
});
