import { describe, expect, it } from "vitest";
import { daysLate, isOverdue, milestoneFill, nextOpenMilestone } from "./config";
import { pendingWaiverIds, planCoverage, todayStr, waiverState } from "./config";

const dayOffset = (n: number) => {
  const d = new Date(`${todayStr()}T00:00:00`);
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}T00:00:00.000Z`;
};

describe("a milestone's lateness", () => {
  it("a milestone due today is not late; yesterday is one day late", () => {
    expect(daysLate({ DueDate: dayOffset(0) })).toBe(0);
    expect(daysLate({ DueDate: dayOffset(-1) })).toBe(1);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: dayOffset(0) })).toBe(false);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: dayOffset(-1) })).toBe(true);
  });
  it("money against it, or no due date, is never overdue", () => {
    expect(isOverdue({ MoneyStage: "Verified", Status: "Pending", DueDate: dayOffset(-9) })).toBe(false);
    expect(isOverdue({ MoneyStage: "InVerification", Status: "Pending", DueDate: dayOffset(-9) })).toBe(false);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: null })).toBe(false);
  });
});

describe("what a milestone's amount is made of", () => {
  it("settled, held and with Finance leave the missing money, to the paisa", () => {
    expect(milestoneFill({ AmountDue: 630150.5, AmountPaid: 100, HeldOnAccount: 600000, WithFinanceCover: 20000.25 }))
      .toMatchObject({ settled: 100, held: 600000, finance: 20000.25, missing: 10050.25, waived: false });
  });
  it("the next open milestone is the first with money missing, skipping waived and covered ones", () => {
    const plan = [
      { Id: 1, AmountDue: 10, HeldOnAccount: 10, Status: "Pending" },
      { Id: 2, AmountDue: 10, Status: "Waived" },
      { Id: 3, AmountDue: 10, HeldOnAccount: 4, Status: "Pending" },
      { Id: 4, AmountDue: 10, Status: "Pending" },
    ];
    expect(nextOpenMilestone(plan)?.Id).toBe(3);
    expect(nextOpenMilestone([plan[0], plan[1]])).toBeNull();
  });
});

describe("money received against the plans of many bookings", () => {
  it("splits out what is above what the bookings owe, so received plus balance adds up", () => {
    const c = planCoverage(25146425.53, 53484627.65, 31894000);
    expect(c.excess).toBe(3555797.88);
    expect(c.covered + 31894000).toBeCloseTo(53484627.65, 2);
  });
  it("nothing above what is owed: nothing to split", () => {
    expect(planCoverage(40, 100, 60)).toEqual({ excess: 0, covered: 40 });
  });
});

describe("where a waiver stands", () => {
  it("only a request still waiting counts as waiting", () => {
    expect([...pendingWaiverIds([{ Status: "Pending", MilestoneId: 3 }, { Status: "Approved", MilestoneId: 2 }, { Status: "Rejected", MilestoneId: 1 }])]).toEqual([3]);
    expect(pendingWaiverIds(undefined).size).toBe(0);
  });
  it("only an approved waiver with no reversal under way can be reversed", () => {
    expect(waiverState({ Status: "Approved" })).toMatchObject({ label: "Waived", reversible: true });
    expect(waiverState({ Status: "Approved", ReversalStatus: "Rejected" })).toMatchObject({ label: "Waived", reversible: true });
    expect(waiverState({ Status: "Pending" })).toMatchObject({ label: "Awaiting approval", reversible: false });
    expect(waiverState({ Status: "Rejected" })).toMatchObject({ label: "Rejected", reversible: false });
    expect(waiverState({ Status: "Approved", ReversalStatus: "Pending" })).toMatchObject({ label: "Reversal awaiting approval", reversible: false });
    expect(waiverState({ Status: "Approved", ReversalStatus: "Approved" })).toMatchObject({ label: "Reversed", reversible: false });
  });
});
