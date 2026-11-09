// On-account money held against each milestone, in milestone order (shown on the plan; nothing is moved).
jest.mock("../db", () => ({ sql: { Int: "Int" } }));
jest.mock("../services/crmPaymentFunding", () => ({ onAccountWithAvailableSql: () => "x", recordedMoneySql: () => "RECORDED_SQL" }));

const { getMilestoneMoneyStages, stageMilestones, getBookingMoneyTrail } = require("../services/crmOnAccountCoverage");

function poolWith(milestones, onAccount, pending = []) {
  return {
    request: () => ({
      input() { return this; },
      async query(text) {
        if (/FROM dbo\.CrmPaymentMilestone WHERE BookingId/.test(text)) return { recordset: milestones };
        if (/TotalOnAccount/.test(text)) return { recordset: [{ TotalOnAccount: onAccount }] };
        if (/RECORDED_SQL/.test(text)) return { recordset: [{ Recorded: 0 }] };
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

test("money entered but not yet with Finance covers milestones after what is held and with Finance", () => {
  const out = stageMilestones(plan, 10000, 5000, 100000);
  expect(out.map((m) => [m.HeldOnAccount, m.WithFinanceCover, m.RecordedCover])).toEqual([[10000, 0, 0], [0, 5000, 100000], [0, 0, 0], [0, 0, 0]]);
  expect(stageMilestones(plan.slice(0, 1), 0, 0, 100000)[0].MoneyStage).toBe("Recorded");
  expect(stageMilestones(plan.slice(0, 1), 0, 0, 0)[0].MoneyStage).toBeNull();
});

function trailPool({ booking = { TokenType: "Amount", TokenValue: 25000 }, receipts = [], entries = [], deposits = [], refunds = [] }) {
  return {
    request: () => ({
      input() { return this; },
      async query(text) {
        if (/FROM dbo\.CrmBooking/.test(text)) return { recordset: [booking] };
        if (/FROM dbo\.CrmRefund/.test(text)) return { recordset: refunds };
        if (/FROM dbo\.CrmMoneyReceipt/.test(text)) return { recordset: receipts };
        if (/FROM dbo\.ReceivedPayment/.test(text)) return { recordset: entries };
        return { recordset: deposits };
      },
    }),
  };
}

describe("the money trail", () => {
  test("a receipt waiting to go to Finance shows as entered, and is counted as received", async () => {
    const t = await getBookingMoneyTrail(trailPool({ receipts: [{ Id: 1, ReceiptNo: "MR-1", Amount: 100000, Status: "Pending", ReceivedPaymentId: null }] }), 9);
    expect(t.rows.map((r) => [r.docs[0], r.stage, r.amount])).toEqual([["MR-1", "recorded", 100000]]);
    expect(t.totals).toMatchObject({ received: 100000, recorded: 100000, held: 0 });
    expect(t.applicationToken).toBe(25000);
    expect(t.receiptAmount).toBe(100000);
  });
  test("a token with no receipt yet still shows", async () => {
    const t = await getBookingMoneyTrail(trailPool({}), 9);
    expect(t.rows.map((r) => [r.stage, r.amount])).toEqual([["recorded", 25000]]);
  });
  test("receipt, Finance entry and deposit are one row; a refund out of the deposit is shown", async () => {
    const t = await getBookingMoneyTrail(trailPool({
      receipts: [{ Id: 1, ReceiptNo: "MR-1", Amount: 10000, Status: "Approved", ReceivedPaymentId: 5 }],
      entries: [{ RPPaymentID: 5, RPDocNo: "REC-1", RPAmount: 10000, RPStatus: "Approved" }],
      deposits: [{ Id: 7, ReceiptNo: "OACC-1", Amount: 10000, AppliedAmount: 1702.12, AvailableAmount: 3297.88, SourceReceivedPaymentId: 5 }],
    }), 9);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ docs: ["MR-1", "REC-1", "OACC-1"], settled: 1702.12, held: 3297.88, out: 5000, stage: "split" });
  });
  test("a paid refund is not settled money; a credit note or cancellation hold is listed but not counted", async () => {
    const t = await getBookingMoneyTrail(trailPool({
      booking: {},
      entries: [{ RPPaymentID: 5, RPAmount: 10000, RPStatus: "Approved" }],
      deposits: [
        { Id: 7, ReceiptNo: "OACC-1", Amount: 10000, AppliedAmount: 6702.12, AvailableAmount: 3297.88, SourceReceivedPaymentId: 5 },
        { Id: 8, ReceiptNo: "CRN-1", Amount: 50000, AppliedAmount: 50000, AvailableAmount: 0, SourceReceivedPaymentId: null },
      ],
      refunds: [{ SourceOnAccountId: 7, Paid: 5000 }],
    }), 9);
    expect(t.rows.find((r) => r.id === "rp-5")).toMatchObject({ settled: 1702.12, held: 3297.88, out: 5000, stage: "split" });
    expect(t.rows.find((r) => r.id === "oa-8").stage).toBe("adjustment");
    expect(t.totals).toMatchObject({ received: 10000, settled: 1702.12, held: 3297.88, out: 5000 });
  });
  test("on a cancelled booking nothing shows as settled", async () => {
    const t = await getBookingMoneyTrail(trailPool({
      booking: { Status: "Cancelled" },
      entries: [{ RPPaymentID: 5, RPAmount: 10000, RPStatus: "Approved" }],
      deposits: [{ Id: 7, ReceiptNo: "OACC-1", Amount: 10000, AppliedAmount: 10000, AvailableAmount: 0, SourceReceivedPaymentId: 5 }],
    }), 9);
    expect(t.rows[0]).toMatchObject({ settled: 0, out: 10000, stage: "out" });
  });
  test("money Finance returned is listed but not counted as received", async () => {
    const t = await getBookingMoneyTrail(trailPool({ receipts: [{ Id: 2, ReceiptNo: "MR-2", Status: "Bounced", Amount: 1 }], entries: [{ RPPaymentID: 6, RPAmount: 10000, RPStatus: "Rejected", RPRejectionNote: "UTR wrong" }] }), 9);
    expect(t.rows.map((r) => r.stage).sort()).toEqual(["bounced", "returned"]);
    expect(t.totals.received).toBe(0);
  });
});
